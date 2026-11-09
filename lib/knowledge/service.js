// 长期知识协调与质量治理：把三个模块接到生活插件上，各自独立运行、各自退避。
//   整理失败 → 聊天照常，继续用上一份完好的索引快照；
//   排序失败 → 沿用上一份排序，没有删除路径；
//   评估失败 → 只写评估文件，不改变正式记忆的有效状态。
// 聊天路径只读本地快照，不在聊天时同步调用模型。
import fs from 'node:fs';
import path from 'node:path';
import {dir, readJson, sid, bjText, timeOf} from './common.js';
import {KnowledgeConsolidator} from './consolidate.js';
import {KnowledgeSalience, searchHybrid, searchSources, openQuestions, describe, contextBlock, contextItems} from './salience.js';
import {parseTimeRange, resolveTimeRange} from './time-range.js';
import {idfScorer} from './retrieval.js';
const searchLexical = (idx, q, rows) => { const lex = idfScorer([q, ...rows.map(i => i.subject + ' ' + i.content)]); return rows.filter(i => lex(q, i.subject + ' ' + i.content) > 0.02).map(i => i.id); };
import {createLocalEmbedder, createGeminiEmbedder, VectorStore} from './embedding.js';
import {StrategyStore} from './strategy.js';
import {ActivityReviewer} from './activity-review.js';
import {KnowledgeSynthesizer} from './synthesis.js';
import {terraReview, independentReviewStatus} from '../terra-review.js';
import {randomUUID} from 'node:crypto';
import {recordCall, addUsage} from '../gemini-telemetry.js';
import {KnowledgeEvaluator} from './evaluate.js';
import {trialConsolidation, trialReplay} from './dry-run.js';

const MIN = 60000;
const DEFAULT_OPENVIKING = 'E:/DSH-Workspace/openviking-local/data/viking';

export function createKnowledgeService({engine, generateBase, idOf = a => a?.session?.id || a?.id, llm = null, agents = () => []}) {
  const home = engine.home, now = () => engine.now();
  const enabled = () => engine.config.enabled && engine.config.semanticEnabled && engine.config.knowledgeEnabled !== false;
  const gen = feature => (prompt, schema, input, opts = {}) => generateBase(prompt, schema, input, engine.config, {feature, temperature: 0, ...opts});
  const sourceOptions = () => {
    const ov = engine.config.knowledgeOpenVikingRoot || DEFAULT_OPENVIKING;
    return {home, sessionIds: engine.config.sessionIds || [], openvikingRoot: fs.existsSync(ov) ? ov : null, stores: engine.config.knowledgeStores || {}};
  };
  // 向量：本地模型为基础层；Gemini 嵌入为可选第三路——设置里关掉，或最近一次评估显示它没带来提升时不使用。
  let evaluator;
  const geminiAllowed = () => engine.config.knowledgeGeminiEmbedding !== false && evaluator?.state().embedding?.geminiUseful !== false;
  const vectorStore = new VectorStore({home, local: createLocalEmbedder({home, now}), gemini: createGeminiEmbedder({config: () => engine.config}), geminiAllowed});
  // 三路回放的作答模型：默认用岑舒会话正在用的 DSH 对话模型（与协作压缩的三路回放一致），也可在设置里指定“提供方/模型”。
  const sidOf = x => String(x || '').replace(/^session-/, '');
  const resolveRoute = () => {
    const pick = String(engine.config.knowledgeReplayModel || '').trim();
    if (pick) { const i = pick.indexOf('/'); if (i > 0) return {provider: pick.slice(0, i), model: pick.slice(i + 1), source: '设置指定'}; }
    const ids = new Set((engine.config.sessionIds || []).map(sidOf));
    const agent = (agents() || []).find(a => ids.has(sidOf(idOf(a))));
    if (!agent) return null;
    const header = agent.session?.requestHeader?.()?.config || {}, rc = agent.session?.requestContext?.() || {};
    const provider = agent.options?.provider || header.provider || rc.provider, model = agent.options?.model || header.model || rc.model;
    return provider && model ? {provider, model, source: '岑舒会话'} : null;
  };
  const answer = llm?.stream ? async (system, input, {signal} = {}) => {
    const route = resolveRoute();
    if (!route) throw Error('没有可用的 DSH 对话模型（岑舒会话未载入，也没有在设置里指定）');
    let text = '', finished = false; const meta = {}, started = Date.now();
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000);
    for await (const part of llm.stream({provider: route.provider, model: route.model, system, messages: [{id: randomUUID(), role: 'user', source: {kind: 'plugin', plugin: 'dsh-cen-shu-life'}, content: [{type: 'text', text: JSON.stringify(input)}]}], maxTokens: 1200, reasoningEffort: 'low', signal: sig})) {
      if (part.type === 'text-delta') text += part.text;
      if (part.type === 'usage') addUsage(meta, part.usage || part);
      if (part.type === 'finish') { if (part.reason?.kind !== 'stop') { const f = part.reason?.failure || {}; throw Error('作答模型 ' + (part.reason?.kind || 'unknown') + ' ' + [f.code, f.status || f.statusCode, String(f.message || '').replace(/sk-[\w-]+|Bearer\s+\S+|AIza[\w-]+/gi, '[隐藏]').slice(0, 160)].filter(Boolean).join(' ')); } finished = true; }
    }
    if (!finished) throw Error('作答流不完整');
    void recordCall({at: Date.now(), feature: 'knowledge-replay-answer', model: route.model, status: 'success', durationMs: Date.now() - started, ...(meta.usage ? {usage: meta.usage} : {})});
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
  } : null;
  const strategyStore = new StrategyStore({home, now});
  const consolidator = new KnowledgeConsolidator({home, engine, generate: gen('knowledge-consolidation'), sourceOptions, vectorStore, strategy: () => strategyStore.active(), now});
  // 活跃度的强弱由 Gemini 判断（设置可关，关掉或还没判断过的条目用兜底规则）。
  const reviewer = new ActivityReviewer({home, generate: gen('knowledge-activity'), now});
  const synthesizer = new KnowledgeSynthesizer({consolidator, home, generate: gen('knowledge-synthesis'), review: (p, s, i, o = {}) => terraReview(p, s, i, engine.config, {...o, feature: 'knowledge-synthesis-review'}), reviewReady: () => independentReviewStatus().configured, now});
  const activityJudged = () => engine.config.knowledgeActivityReview !== false ? reviewer.judgments() : {};
  const salience = new KnowledgeSalience({home, now, judgments: activityJudged});
  evaluator = new KnowledgeEvaluator({home, generate: gen('knowledge-eval'), answer, vectorStore, intervalDays: () => engine.config.knowledgeEvaluationDays || 7,
    replayCases: () => engine.config.knowledgeReplayCases ?? 6, autoAdjust: () => engine.config.knowledgeAutoAdjust !== false, answerModel: () => { const r = resolveRoute(); return r ? r.provider + '/' + r.model + '（' + r.source + '）' : null; }, now});
  const next = {consolidate: 0, salience: 0, evaluate: 0, activity: 0, synthesis: 0};
  let cache = {key: '', index: null}, rankingCache = {key: '', value: {rows: []}};

  // 最后一份完好的快照：文件读坏了就继续用上一份。
  const snapshot = () => {
    const file = path.join(dir(home), 'index.json');
    try { const st = fs.statSync(file), key = st.mtimeMs + ':' + st.size; if (key !== cache.key) cache = {key, index: readJson(file, null)}; } catch {}
    return cache.index;
  };
  const ranking = () => {
    const file = path.join(dir(home), 'ranking.json');
    try { const st = fs.statSync(file), key = st.mtimeMs + ':' + st.size; if (key !== rankingCache.key) rankingCache = {key, value: readJson(file, {rows: []})}; } catch {}
    return rankingCache.value;
  };

  function tick() {
    if (!enabled()) return;
    const t = now();
    if (t >= next.consolidate) {
      next.consolidate = t + 2 * MIN;
      void consolidator.tick().then(r => { if (r?.pending === 0 || r?.skipped) next.consolidate = now() + 15 * MIN; if (r?.error) engine.log?.('知识整理稍后重试：' + r.error); }).catch(e => engine.log?.('知识整理失败：' + e.message));
    }
    if (t >= next.salience) { next.salience = t + 10 * MIN; try { salience.tick(); } catch {} }
    if (t >= next.activity && engine.config.knowledgeActivityReview !== false) {
      next.activity = t + 30 * MIN;
      void reviewer.tick().then(r => { if (r?.reviewed) { try { salience.tick(); } catch {} } if (r?.error) engine.log?.('活跃度判断稍后重试：' + r.error); }).catch(e => engine.log?.('活跃度判断失败：' + e.message));
    }
    if (t >= next.synthesis && engine.config.knowledgeSynthesis !== false) {
      next.synthesis = t + 60 * MIN;
      void synthesizer.tick().then(r => { if (r?.added) { try { salience.tick(); } catch {} } if (r?.error) engine.log?.('跨经历归纳稍后重试：' + r.error); }).catch(e => engine.log?.('跨经历归纳失败：' + e.message));
    }
    if (t >= next.evaluate) {
      next.evaluate = t + 60 * MIN;
      void evaluator.tick().then(r => { if (r?.error) engine.log?.('记忆质量评估稍后重试：' + r.error); }).catch(e => engine.log?.('记忆质量评估失败：' + e.message));
    }
  }

  // 私人生活会话：私人生活插件登记的独处显示会话。只有这里会提供私人日记与想法整理出的知识。
  const privateSessionId = () => { try { return sid(readJson(path.join(home, 'censhu-inner-life', 'display-session.json'), {}).sessionId); } catch { return ''; } };
  const isPrivateSession = id => Boolean(id) && sid(id) === privateSessionId();
  const offered = new Map(); // 会话 → 本轮提供给预算的知识 id，用来接收“预算选中”的反馈

  /** Optional block for the life context; the existing Gemini budget decides whether it is read. */
  function context(sessionId) {
    try {
      if (!enabled() || engine.config.knowledgeContextEnabled === false || !engine.bound(sessionId)) return '';
      const idx = snapshot(); if (!idx) return '';
      const block = contextBlock(idx, ranking(), {limit: engine.config.knowledgeContextLimit || 10});
      offered.set(sid(sessionId), {ids: block.ids, at: now()}); if (offered.size > 32) offered.delete(offered.keys().next().value);
      return block.text;
    } catch { return ''; }
  }
  /** 给生活上下文预算的逐条资料：每条知识单独一段，由现有 Gemini 预算按本轮相关性挑选读哪几条（条数设置只是候选上限）。 */
  function contextParts(sessionId) {
    try {
      if (!enabled() || engine.config.knowledgeContextEnabled === false || !engine.bound(sessionId)) return [];
      const idx = snapshot(); if (!idx) return [];
      const rows = contextItems(idx, ranking(), {limit: engine.config.knowledgeContextLimit || 10});
      offered.set(sid(sessionId), {ids: rows.map(r => r.id), at: now()}); if (offered.size > 32) offered.delete(offered.keys().next().value);
      return rows.map(r => ({key: 'knowledge:item:' + r.id, text: r.text}));
    } catch { return []; }
  }
  /** 私人生活会话专用：共享与私人知识一起提供（不经过生活上下文预算，条数同样受设置限制）。 */
  function privateContext(sessionId) {
    try {
      if (!enabled() || engine.config.knowledgeContextEnabled === false || !isPrivateSession(sessionId)) return '';
      const idx = snapshot(); return idx ? contextBlock(idx, ranking(), {limit: engine.config.knowledgeContextLimit || 10, allowPrivate: true}).text : '';
    } catch { return ''; }
  }
  /** 上下文预算的选择结果：知识块被选中阅读时，给这些条目记一次“被选中”（弱信号）。失败不影响任何东西。 */
  function selected({sessionId, decided, keys} = {}) {
    try {
      if (!decided || !Array.isArray(keys)) return;
      const o = offered.get(sid(sessionId)); if (!o?.ids?.length || now() - o.at > 10 * MIN) return;
      offered.delete(sid(sessionId));
      // 整块（旧格式）或逐条：被预算选中的记“被选中”，提供了但没被选中的记“略过”，强弱交给 Gemini 判断
      const chosen = new Set(keys.filter(k => typeof k === 'string' && k.startsWith('knowledge:item:')).map(k => k.slice('knowledge:item:'.length)));
      const picked = keys.includes('knowledge:long-term') ? o.ids : o.ids.filter(id => chosen.has(id)), passed = o.ids.filter(id => !picked.includes(id));
      if (picked.length) salience.recordUse(picked, 'selected'); if (passed.length) salience.recordUse(passed, 'passed');
    } catch {}
  }

  const tool = {
    name: 'censhu_knowledge_recall',
    description: '查跨记忆库整理过的长期知识：同一件事在不同时间、会话、记忆库里的记录被归在一起，区分想做、在做、已做完和更正。可按问题检索，或用 id 看一条知识的来源与变化过程。每条结果的 matchedBy 说明是字面命中还是只是意思相近，后者可能并不相关，请自己判断。只读，不改任何记忆；私人日记与想法只在私人生活会话里查得到。',
    parameters: {type: 'object', additionalProperties: false, properties: {query: {type: 'string', maxLength: 300}, id: {type: 'string', maxLength: 80}, limit: {type: 'integer', minimum: 1, maximum: 12}, includeInactive: {type: 'boolean', description: '包含已被更正、撤回或失去来源的条目'}, when: {type: 'string', maxLength: 40, description: '只看某段时间的事，例如：上个月、上周三、10月3日、最近三天、去年、去年夏天、刚认识那阵'}, includeRaw: {type: 'boolean', description: '同时返回最接近的原始记录，想核对原话或细节时用'}}},
    output: {schema: {type: 'string'}, render: (_a, v) => [{type: 'text', text: v}]},
    async execute(args = {}, exec) {
      const caller = idOf(exec?.agent), allowPrivate = isPrivateSession(caller);
      if (!engine.bound(caller) && !allowPrivate) throw Error('当前会话未绑定岑舒生活插件');
      const idx = snapshot();
      if (!idx) return JSON.stringify({status: '知识索引尚未建立（需要生活后台运行且 Gemini 可用）'});
      if (args.id) {
        const item = idx.items[args.id];
        if (!item || (item.visibility !== 'shared' && !allowPrivate)) return JSON.stringify({found: false});
        salience.recordUse([item.id], 'recalled');
        return JSON.stringify({found: true, ...describe(idx, item, {withHistory: true, allowPrivate})});
      }
      // 2026-11-09: a time named in the question narrows the search; if nothing falls in that time, search without it.
      const explicit = args.when ? await resolveTimeRange(args.when, now(), {generate: gen('knowledge-time-range'), earliest: Math.min(...Object.values(idx.sources).map(timeOf).filter(Boolean))}) : null, range = explicit || parseTimeRange(args.query, now());
      const options = {limit: args.limit || 6, includeInactive: args.includeInactive === true, vectorStore, allowPrivate};
      let rows = await searchHybrid(idx, ranking(), args.query || '', {...options, ...(range ? {from: range.from, to: range.to} : {})});
      const widened = Boolean(range && !explicit && !rows.length);
      if (widened) rows = await searchHybrid(idx, ranking(), args.query || '', options);
      salience.recordUse(rows.map(r => r.id), 'recalled');
      const raw = args.includeRaw === true ? await searchSources(idx, args.query || '', {vectorStore, allowPrivate, ...(range && !widened ? {from: range.from, to: range.to} : {})}) : null;
      return JSON.stringify({updatedAt: idx.updatedAt, ...(range && !widened ? {timeRange: range.label} : {}), items: rows.map(r => describe(idx, r, {allowPrivate})), ...(raw ? {raw} : {})});
    },
  };

  function view() {
    const idx = snapshot(), items = Object.values(idx?.items || {});
    const byStatus = {}; for (const i of items) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    const ev = evaluator.state();
    const report = ev.status === 'done' || ev.metrics ? {retrieval: ev.retrieval || null, replay: ev.replay || null, real: ev.real ? {activeItems: ev.real.activeItems, judged: ev.real.judged, problems: ev.real.problems || []} : null, history: (ev.history || []).slice(-8)} : null;
    const route = resolveRoute();
    return {enabled: enabled(), config: {knowledgeEnabled: engine.config.knowledgeEnabled !== false, knowledgeContextEnabled: engine.config.knowledgeContextEnabled !== false, knowledgeContextLimit: engine.config.knowledgeContextLimit || 10, knowledgeGeminiEmbedding: engine.config.knowledgeGeminiEmbedding !== false, knowledgeEvaluationDays: engine.config.knowledgeEvaluationDays || 7, knowledgeOpenVikingRoot: engine.config.knowledgeOpenVikingRoot || '', knowledgeStores: engine.config.knowledgeStores || {},
      knowledgeReplayModel: engine.config.knowledgeReplayModel || '', knowledgeReplayCases: engine.config.knowledgeReplayCases ?? 6, knowledgeAutoAdjust: engine.config.knowledgeAutoAdjust !== false, knowledgeActivityReview: engine.config.knowledgeActivityReview !== false, knowledgeSynthesis: engine.config.knowledgeSynthesis !== false}, synthesis: synthesizer.status(), openvikingDefault: DEFAULT_OPENVIKING, report,
      replayModel: route ? {provider: route.provider, model: route.model, source: route.source} : null, strategy: strategyStore.view(), learnedCases: (() => { try { return readJson(path.join(dir(home), 'eval', 'learned-cases.json'), {entries: []}).entries.map(e => ({id: e.id, kind: e.kind, question: e.question})); } catch { return []; } })(), stores: idx?.stores || {}, sources: Object.keys(idx?.sources || {}).length, items: items.length, byStatus, ignored: Object.keys(idx?.ignored || {}).length, consolidation: idx?.status || null, cost: idx?.cost || null,
      ranking: {at: ranking().at || null, count: (ranking().rows || []).length, judged: (ranking().rows || []).filter(r => r.judged).length}, activityReview: {enabled: engine.config.knowledgeActivityReview !== false, ...(() => { try { return reviewer.status(); } catch { return {}; } })()}, retrieval: {...(idx?.retrieval || {}), local: vectorStore.local.status(), geminiAllowed: geminiAllowed(), geminiDecision: ev.embedding || null}, evaluation: {status: ev.status, at: ev.at || null, metrics: ev.metrics || null, error: ev.error || '', retryAt: ev.retryAt || 0, proposals: ev.proposals || [], plan: ev.plan || null}};
  }

  /** 设置页：知识条目列表（本人查看，私人条目标注出来）。只读。 */
  function items({status = '', visibility = '', q = '', limit = 50} = {}) {
    const idx = snapshot(); if (!idx) return {total: 0, items: []};
    let rows = Object.values(idx.items).filter(i => (!status || i.status === status) && (!visibility || i.visibility === visibility));
    if (q) { const hits = new Set(searchLexical(idx, q, rows)); rows = rows.filter(i => hits.has(i.id)); }
    const rank = new Map((ranking().rows || []).map((r, n) => [r.id, n]));
    rows.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || (b.updatedAt || 0) - (a.updatedAt || 0));
    const act = (() => { try { return salience.activity().items || {}; } catch { return {}; } })(), judged = activityJudged();
    const activityOf = id => { const a = act[id], j = judged[id]; if (!a && !j) return null; return {recalled: a?.recalled || 0, selected: a?.selected || 0, passed: a?.passed || 0, lastRecalled: bjText(a?.lastUsedAt), lastSelected: bjText(a?.lastSelectedAt), judgment: j ? {weight: j.weight, fadeFrom: j.fadeFrom, holdDays: j.holdDays, reason: j.reason, at: bjText(j.at), reviewAt: bjText(j.reviewAt)} : null}; };
    return {total: rows.length, items: rows.slice(0, Math.min(200, limit)).map(i => ({...describe(idx, i, {withHistory: true, allowPrivate: true}), activity: activityOf(i.id), visibility: i.visibility, rank: rank.has(i.id) ? rank.get(i.id) + 1 : null}))};
  }
  /** 手动“立即整理”：清除退避后跑一批；失败照常记录退避，不影响聊天。 */
  async function consolidateNow() {
    const idx = consolidator.load(); if (idx.status?.retryAt) { idx.status = {...idx.status, retryAt: 0}; consolidator.save(idx); }
    const r = await consolidator.tick(); try { salience.tick(); } catch {} next.consolidate = now() + 2 * MIN; return r;
  }

  /** 2026-11-09：知识层还拿不准的事，交给主动回合，要不要问由她决定。 */
  const openKnowledgeQuestions = () => { try { if (!enabled()) return []; const idx = snapshot(); return idx ? openQuestions(idx, ranking()) : []; } catch { return []; } };

  /** 回滚整理策略到上一个版本（只影响之后的整理）。 */
  const rollbackStrategy = () => strategyStore.rollback();

  // 设置页“测试”键：只在临时副本上试跑，同一时间只跑一个，最多 10 分钟；结果只留在内存里给页面看。
  let trialBusy = null, lastTrial = {};
  const runTrial = (kind, fn) => {
    if (trialBusy) return Promise.resolve({ok: false, busy: trialBusy, error: '另一个测试正在进行，请等它结束'});
    trialBusy = kind;
    const signal = AbortSignal.timeout(10 * MIN);
    return fn(signal).then(r => (lastTrial[kind] = r), e => (lastTrial[kind] = {kind, ok: false, stage: 'model', error: String(e?.message || e).slice(0, 240)})).finally(() => { trialBusy = null; });
  };
  const testConsolidation = () => runTrial('consolidation', signal => trialConsolidation({consolidator, sourceOptions, sample: 6, signal, now}));
  const testReplay = () => runTrial('replay', signal => trialReplay({evaluator, index: snapshot(), ranking: ranking(), realCases: 2, signal, now}));
  const trials = () => ({busy: trialBusy, last: lastTrial});

  return {tick, context, contextParts, privateContext, isPrivateSession, openQuestions: openKnowledgeQuestions, selected, reviewer, tool, view, items, consolidateNow, rollbackStrategy, consolidator, salience, evaluator, evaluateNow: () => evaluator.tick({force: true}), testConsolidation, testReplay, trials};
}
