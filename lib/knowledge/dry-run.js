// 2026-11-07 设置页“测试”键：长期记忆整理试跑、三路回放试跑。
// 两者都只在内存里的临时副本上进行：不写 index.json、评估结果、整理策略、回归题库，也不保存向量缓存。
// 会真实调用模型（Gemini；三路回放还会调用作答模型），所以结果和花费都是真的，只是不落盘。
import {bjText, cleanError} from './common.js';
import {collectSources} from './sources.js';
import {replayReal, runSuite, equivalentPrompt, equivalentSchema} from './evaluate.js';
import {summarize, harvestReal, LANES} from './replay.js';
import {generateSuite, suiteView} from './synthetic.js';

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const STORE_OF = {memoryEvolve: 'memory-evolve', innerLife: 'inner-life'};

/** A vector store view that computes vectors but never persists the cache. */
const readOnlyVectors = vs => vs && ({
  localVectors: (...a) => vs.localVectors(...a),
  geminiVectors: (...a) => vs.geminiVectors(...a),
  get geminiError() { return vs.geminiError; },
  save() {},
});

/**
 * Read every enabled store (read-only), then let Gemini judge one small batch against a temporary copy of the index.
 * @returns what would be created or merged; the formal index is never saved.
 */
export async function trialConsolidation({consolidator, sourceOptions, sample = 6, signal, now = () => Date.now()}) {
  const started = Date.now(), out = {kind: 'consolidation', at: now(), atText: bjText(now()), written: false};
  const done = extra => ({...out, ...extra, ms: Date.now() - started});
  let collected;
  try { collected = await collectSources(sourceOptions()); }
  catch (e) { return done({ok: false, stage: 'read', error: cleanError(e)}); }
  out.stores = Object.entries(collected.status || {}).map(([name, s]) => ({name: STORE_OF[name] || name, ok: Boolean(s.ok), disabled: Boolean(s.disabled), count: s.count || 0, error: s.error ? clip(s.error, 160) : null}));
  out.sources = collected.sources.length;
  // 临时副本 + 不保存的整理器视图：同一套提示、策略和候选挑选，只是全部不落盘。
  const copy = JSON.parse(JSON.stringify(consolidator.load()));
  const temp = Object.create(consolidator);
  temp.vectorStore = readOnlyVectors(consolidator.vectorStore);
  temp.save = () => {};
  const pending = temp.sync(copy, collected);
  out.pending = pending.length;
  const batch = pending.slice(0, Math.max(1, Math.min(8, Number(sample) || 6)));
  out.sampled = batch.length;
  if (!batch.length) return done({ok: true, decisions: [], note: '没有新的或改动过的来源需要整理'});
  const before = new Set(Object.keys(copy.items));
  try {
    const decisions = await temp.processBatch(copy, batch, {signal});
    out.signals = copy.retrieval?.signals || null;
    if (copy.retrieval?.geminiError) out.geminiError = clip(copy.retrieval.geminiError, 160);
    out.decisions = decisions.map(d => {
      const s = copy.sources[d.sourceKey] || {};
      const item = Object.values(copy.items).find(i => i.sources.includes(d.sourceKey));
      return {store: s.store, origin: s.origin, visibility: s.visibility, text: clip(s.text, 160), relation: d.relation, reason: clip(d.reason, 200),
        item: item && d.relation !== 'irrelevant' ? {subject: clip(item.subject, 60), content: clip(item.content, 200), kind: item.kind, stage: item.stage, status: item.status, created: !before.has(item.id)} : null};
    });
    out.undecided = batch.length - decisions.length;
    return done({ok: true});
  } catch (e) { return done({ok: false, stage: 'model', error: cleanError(e)}); }
}

/**
 * Three-way replay (raw / consolidated / recall) on the synthetic suite under the active strategy,
 * plus up to `realCases` harvested real questions when a formal index exists.
 * No regression is learned, no strategy is proposed or recorded, and nothing is written.
 */
export async function trialReplay({evaluator, index, ranking, realCases = 2, signal, now = () => Date.now()}) {
  const started = Date.now(), out = {kind: 'replay', at: now(), atText: bjText(now()), written: false, answerModel: evaluator.answerModel?.() || null};
  let geminiCalls = 0, answerCalls = 0;
  const done = extra => ({...out, ...extra, calls: {gemini: geminiCalls, answer: answerCalls}, ms: Date.now() - started});
  if (!evaluator.answer) return done({ok: false, stage: 'answer', error: '没有可用的作答模型（岑舒会话未载入，也没有在设置里指定）'});
  const gemini = (...a) => { geminiCalls++; return evaluator.generate(...a); };
  const answer = (...a) => { answerCalls++; return evaluator.answer(...a); };
  const judgeEquivalent = async x => { try { const v = await gemini(equivalentPrompt, equivalentSchema, x, {signal, maxOutputTokens: 300}); return v?.equivalent === true; } catch { return null; } };
  const active = evaluator.strategy?.active?.() || null;
  out.strategy = active ? {version: active.version, id: active.id} : null;
  try {
    // 与正式评估一样，题目现出现用；生成不合格时用内置题。
    const questions = await generateSuite({generate: gemini, review: gemini, realTexts: Object.values(index?.sources || {}).map(s => s.text), avoidThemes: evaluator.state?.().suiteThemes || [], signal, now});
    out.suite = suiteView(questions);
    const suite = await runSuite({notes: active?.notes || '', generate: gemini, answer, judgeEquivalent, learned: [], suite: questions, signal, now});
    let real = [], realError = null;
    if (index && Object.keys(index.items || {}).length && realCases > 0) {
      try {
        const harvested = await harvestReal({index, generate: gemini, review: gemini, limit: realCases, signal});
        real = await replayReal({index, ranking, cases: harvested, answer, judgeEquivalent, signal});
      } catch (e) { realError = cleanError(e); }
    }
    const synthetic = suite.cases.filter(c => !c.holdout), holdout = suite.cases.filter(c => c.holdout);
    const all = [...suite.cases, ...real];
    const view = c => ({id: c.id, kind: c.kind, holdout: c.holdout, learned: c.learned, real: String(c.id).startsWith('real-'), question: c.question, expected: c.expected, diagnosis: c.diagnosis,
      lanes: Object.fromEntries(LANES.map(l => [l, {status: c.grades[l].status, reason: c.grades[l].reason, answer: c.grades[l].answer, recalls: c.grades[l].recalls?.length || 0}]))});
    const replay = {status: 'done', strategy: out.strategy, suite: out.suite, synthetic: summarize(synthetic), holdout: summarize(holdout), real: real.length ? summarize(real) : null, checks: suite.checks, cases: all.map(view)};
    const extra = {replay, ...(realError ? {realError} : {}), realSkipped: !index || !Object.keys(index.items || {}).length};
    if (all.length && all.every(c => c.diagnosis === 'call-error')) return done({ok: false, stage: 'answer', error: '作答模型调用全部失败：' + clip(all[0]?.grades?.raw?.reason || '', 200), ...extra});
    return done({ok: true, ...extra});
  } catch (e) { return done({ok: false, stage: 'model', error: cleanError(e)}); }
}
