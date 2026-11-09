// ② 重要度与活跃度：只影响候选排序与注入优先级，没有任何删除或改写原记忆的路径。
// 三个概念分开（参考 Generative Agents 的 recency/importance/relevance 与 MemoryOS 的热度，但不混成一个分数）：
//   长期重要度：整理时由 Gemini 按来源、内容、实际影响给出，不因时间过去而降低；
//   当前相关性：交给现有的 Gemini 动态上下文预算决定，这里只提供候选；
//   活跃度：记录真实使用（被回忆工具调出、被上下文预算选中阅读、提供了但没被选中），强弱怎么算由 Gemini 判断（activity-review.js）：
//     权重、哪种使用会让它重新变新、保持多久不淡出，都是 Gemini 按每条知识的内容与使用情况给出的，不同条目可以不同。
//     Gemini 还没判断过的条目，用下面的兜底规则（调出算强信号并重置淡出时间；预算选中只在 7 天内加一点权重）。
// 分类衰减：stable 稳定事实与约定、method 验证过的方法不按时间淡出；experience、situational 超过保持天数后召回优先级逐步降低。
import path from 'node:path';
import {KIND_TEXT, STAGE_TEXT, bjText, dir, readJson, writeJson, timeOf} from './common.js';
import {hybridRank, idfScorer} from './retrieval.js';
const itemText = i => i.subject + ' ' + i.content;

const DAY = 86400000, LEVEL_WEIGHT = {low: 1, medium: 2, high: 3, core: 4};
// 2026-11-09: how a result was found, so she can weigh a loose match herself instead of a score cut-off deciding for her.
const MATCH_TEXT = {lexical: '字面命中', semantic: '只是意思相近'};
// 2026-11-09: said where the item is read, so a belief is not repeated back as a fact.
const STANCE_TEXT = {opinion: '这是主观判断，不是已证实的事实', feeling: '这是当时的感受，以后可能会变'};
export const STORE_TEXT = {engram: 'engram', lingshu: '灵枢', mnemon: 'mnemon', openviking: 'OpenViking', 'memory-evolve': 'memory-evolve', life: '生活', 'inner-life': '私人生活', agency: '主动进行', mood: '心情'};

/** judgment: Gemini's activity judgment for this item (or null → fallback rule). */
export function freshness(item, activity, now, judgment = null) {
  const cls = item.importance?.class || 'experience';
  if (cls === 'stable' || cls === 'method') return 1;
  const hold = Math.max(1, Number(judgment?.holdDays) || Number(item.importance?.holdDays) || 30);
  const own = Math.max(Number(item.eventAt || 0), Number(item.updatedAt || item.firstAt || 0));
  const fadeFrom = judgment?.fadeFrom || 'last-recall';
  const used = fadeFrom === 'event' ? 0 : fadeFrom === 'last-use' ? Math.max(Number(activity?.lastUsedAt || 0), Number(activity?.lastSelectedAt || 0)) : Number(activity?.lastUsedAt || 0);
  const days = (now - Math.max(own, used)) / DAY;
  return days <= hold ? 1 : Math.max(0.05, 0.5 ** ((days - hold) / hold));
}

/** Fallback when Gemini has not judged an item yet. */
export function ruleWeight(activity, now) {
  const recentlySelected = now - Number(activity?.lastSelectedAt || 0) <= 7 * DAY;
  return 1 + 0.1 * Math.min(5, Number(activity?.recalled || 0)) + (recentlySelected ? 0.02 * Math.min(10, Number(activity?.selected || 0)) : 0);
}

export function score(item, activity, now, judgment = null) {
  if (!['active', 'uncertain'].includes(item.status)) return 0;
  const base = LEVEL_WEIGHT[item.importance?.level] || 1;
  const use = Number.isFinite(judgment?.weight) ? Math.min(2, Math.max(0.5, judgment.weight)) : ruleWeight(activity, now);
  return base * freshness(item, activity, now, judgment) * use * (item.status === 'uncertain' || item.changeType === 'uncertain' ? 0.6 : 1);
}

export class KnowledgeSalience {
  constructor({home, now = () => Date.now(), judgments = () => ({})}) { Object.assign(this, {home, now, judgments}); this.activityFile = path.join(dir(home), 'activity.json'); this.rankingFile = path.join(dir(home), 'ranking.json'); this.indexFile = path.join(dir(home), 'index.json'); }
  activity() { return readJson(this.activityFile, {version: 1, items: {}}); }
  /** Usage feedback: recalled (tool), selected (budget read it), passed (offered, not chosen). Failure is swallowed: activity is only a ranking hint. */
  recordUse(ids, kind) {
    const stamp = {recalled: 'lastUsedAt', selected: 'lastSelectedAt', passed: 'lastPassedAt'}[kind]; if (!stamp) return;
    try { const a = this.activity(), now = this.now(); for (const id of ids) { const r = a.items[id] ||= {recalled: 0, selected: 0, passed: 0}; r[kind] = (r[kind] || 0) + 1; r[stamp] = now; } writeJson(this.activityFile, a); } catch {}
  }
  /** Recompute the ranking snapshot. On failure the previous snapshot stays in use. */
  tick() {
    try {
      const index = readJson(this.indexFile, null); if (!index) return {skipped: 'no-index'};
      const act = this.activity().items, now = this.now();
      let judged = {}; try { judged = this.judgments() || {}; } catch {}
      const rows = Object.values(index.items).map(i => ({id: i.id, score: Number(score(i, act[i.id], now, judged[i.id]).toFixed(4)), fresh: Number(freshness(i, act[i.id], now, judged[i.id]).toFixed(3)), ...(judged[i.id] ? {judged: true} : {})})).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
      writeJson(this.rankingFile, {version: 1, at: now, indexRevision: index.revision, rows});
      return {ranked: rows.length};
    } catch (e) { return {error: String(e?.message || e).slice(0, 200)}; }
  }
  ranking() { return readJson(this.rankingFile, {rows: []}); }
}

/** Read-only view for a role session: shared items only (private diary and thoughts never leave private life). */
export function visibleItems(index, {allowPrivate = false} = {}) {
  return Object.values(index?.items || {}).filter(i => allowPrivate || i.visibility === 'shared');
}
/** 2026-11-09: an item belongs to the time it happened; the processing time is only a fallback for items without one. */
const inRange = (item, {from, to}) => { if (from === undefined && to === undefined) return true; const t = Number(item.eventAt) || Number(item.validFrom) || Number(item.firstAt) || 0; return t >= (from ?? -Infinity) && t <= (to ?? Infinity); };

export function describe(index, item, {withSources = true, withHistory = false, allowPrivate = false} = {}) {
  const src = item.sources.map(k => index.sources[k]).filter(s => s && (allowPrivate || s.visibility === 'shared'));
  return {id: item.id, subject: item.subject, kind: KIND_TEXT[item.kind] || item.kind, stage: STAGE_TEXT[item.stage] || '', content: item.content, status: item.status, change: item.changeType, eventText: item.eventText || null, updatedText: bjText(item.updatedAt), validFromText: bjText(item.validFrom), ...(item.validTo ? {validToText: bjText(item.validTo)} : {}), ...(item.priorValues?.length ? {earlier: item.priorValues.map(p => ({content: p.content, when: p.eventText || bjText(p.at)}))} : {}), ...(item.feelings?.length ? {feelings: item.feelings.map(f => ({label: f.label, when: bjText(f.at)}))} : {}), ...(item.matchedBy ? {matchedBy: MATCH_TEXT[item.matchedBy]} : {}), ...(STANCE_TEXT[item.stance] ? {stance: STANCE_TEXT[item.stance]} : {}),
    importance: item.importance ? {level: item.importance.level, class: item.importance.class, reason: item.importance.reason} : null,
    ...(withSources ? {sources: src.map(s => ({store: STORE_TEXT[s.store] || s.store, recordId: s.recordId, reviewed: s.reviewed, origin: s.origin, learnedText: bjText(s.learnedAt), missing: Boolean(s.missingAt), excerpt: s.text.slice(0, 160)})), duplicateCount: (item.duplicateSources || []).length} : {}),
    links: item.links.filter(l => allowPrivate || index.items[l.to]?.visibility === 'shared').map(l => ({to: l.to, relation: l.relation, reason: l.reason})),
    ...(item.supersededBy ? {supersededBy: item.supersededBy} : {}),
    ...(withHistory ? {history: item.history.slice(-8).map(h => ({at: bjText(h.at), change: h.changeType, reason: h.reason, ...(h.before ? {before: h.before.content} : {})}))} : {})};
}

/** Lexical retrieval (IDF-weighted bigrams): relevance first, salience as the tie-breaker. Always available. */
export function search(index, ranking, query, {limit = 8, allowPrivate = false, includeInactive = false, from, to} = {}) {
  const sc = new Map((ranking?.rows || []).map(r => [r.id, r.score]));
  const pool = visibleItems(index, {allowPrivate}).filter(i => (includeInactive || ['active', 'uncertain'].includes(i.status)) && inRange(i, {from, to}));
  const lex = idfScorer([query, ...pool.map(itemText)]);
  return pool.map(i => ({i, rel: query ? lex(query, itemText(i)) : 0, s: sc.get(i.id) || 0}))
    .filter(x => !query || x.rel > 0.02)
    .sort((a, b) => (b.rel * 4 + b.s * 0.25) - (a.rel * 4 + a.s * 0.25))
    .slice(0, limit).map(x => x.i);
}

/** Chat-time retrieval: lexical + local vectors only (never waits on the network). Falls back to lexical. */
export async function searchHybrid(index, ranking, query, {limit = 8, allowPrivate = false, includeInactive = false, vectorStore = null, from, to} = {}) {
  const lexical = rows => query ? rows.map(i => ({...i, matchedBy: 'lexical'})) : rows;
  if (!query || !vectorStore) return lexical(search(index, ranking, query, {limit, allowPrivate, includeInactive, from, to}));
  const pool = visibleItems(index, {allowPrivate}).filter(i => (includeInactive || ['active', 'uncertain'].includes(i.status)) && inRange(i, {from, to}));
  const local = await vectorStore.localVectors([query, ...pool.map(itemText)]);
  if (!local) return lexical(search(index, ranking, query, {limit, allowPrivate, includeInactive, from, to}));
  vectorStore.save();
  const sc = new Map((ranking?.rows || []).map(r => [r.id, r.score])), byId = new Map(pool.map(i => [i.id, i]));
  return hybridRank(query, pool.map(i => ({id: i.id, text: itemText(i)})), {local})
    .map(r => ({i: {...byId.get(r.id), matchedBy: r.ranks.lexical ? 'lexical' : 'semantic'}, v: r.score + 0.0005 * (sc.get(r.id) || 0)})).sort((a, b) => b.v - a.v).slice(0, limit).map(x => x.i);
}

/** 2026-11-09: the original records, found alongside the distilled items. Lexical + local vectors, no model call. */
export async function searchSources(index, query, {limit = 4, allowPrivate = false, vectorStore = null, from, to} = {}) {
  if (!query) return [];
  const inTime = s => (from === undefined && to === undefined) || (timeOf(s) >= (from ?? -Infinity) && timeOf(s) <= (to ?? Infinity));
  const pool = Object.values(index?.sources || {}).filter(s => s.text && !s.missingAt && !index.ignored?.[s.key] && (allowPrivate || s.visibility === 'shared') && inTime(s)), byKey = new Map(pool.map(s => [s.key, s]));
  if (!pool.length) return [];
  const local = vectorStore ? await vectorStore.localVectors([query, ...pool.map(s => s.text)]) : null;
  if (local) vectorStore.save();
  return hybridRank(query, pool.map(s => ({id: s.key, text: s.text})), {local}).slice(0, limit).map(r => { const s = byKey.get(r.id); return {store: STORE_TEXT[s.store] || s.store, recordId: s.recordId, time: bjText(s.eventAt || s.learnedAt), text: s.text, matchedBy: MATCH_TEXT[r.ranks.lexical ? 'lexical' : 'semantic']}; });
}

/** 2026-11-09: what the knowledge layer is unsure about. Whether any of it is worth asking is hers to decide. */
export function openQuestions(index, ranking, {limit = 6} = {}) {
  const order = new Map((ranking?.rows || []).map((r, n) => [r.id, n]));
  return visibleItems(index).filter(i => ['active', 'uncertain'].includes(i.status) && (i.status === 'uncertain' || i.changeType === 'uncertain')).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)).slice(0, limit).map(i => ({id: i.id, subject: i.subject, content: i.content, why: String(i.history?.at(-1)?.reason || '').slice(0, 120), since: bjText(i.updatedAt)}));
}

/** One line per item for the live budget: the existing Gemini context budget picks which items to read (each part is self-contained). */
export function contextItems(index, ranking, {limit = 10} = {}) {
  const items = new Map(visibleItems(index).map(i => [i.id, i]));
  return (ranking?.rows || []).map(r => items.get(r.id)).filter(Boolean).slice(0, limit).map(i => ({id: i.id, text: '【长期知识·跨记忆库整理，只读；来源与变化可用 censhu_knowledge_recall 查】' + itemLine(index, i)}));
}
const itemLine = (index, i) => '[' + (KIND_TEXT[i.kind] || i.kind) + (STAGE_TEXT[i.stage] ? '·' + STAGE_TEXT[i.stage] : '') + '] ' + i.content + '（来源：' + [...new Set(i.sources.map(k => STORE_TEXT[index.sources[k]?.store] || index.sources[k]?.store).filter(Boolean))].join('、') + (i.eventText ? '；' + i.eventText : '') + (i.status === 'uncertain' ? '；尚不确定' : '') + (STANCE_TEXT[i.stance] ? '；' + STANCE_TEXT[i.stance] : '') + (i.priorValues?.length ? '；之前的说法：' + [...i.priorValues].reverse().map(p => p.content.slice(0, 80) + (p.eventText || p.at ? '（' + (p.eventText || bjText(p.at)) + '）' : '')).join('；') : '') + '）';

/** Whole block (evaluation replay and the private-life session). */
export function contextBlock(index, ranking, {limit = 10, allowPrivate = false} = {}) {
  const items = new Map(visibleItems(index, {allowPrivate}).map(i => [i.id, i]));
  const top = (ranking?.rows || []).map(r => items.get(r.id)).filter(Boolean).slice(0, limit);
  if (!top.length) return {text: '', ids: []};
  const lines = top.map(i => '- ' + itemLine(index, i));
  return {text: (allowPrivate ? '【跨记忆库整理的长期知识（含私人日记与想法，只在私人生活会话里提供；按长期重要度与活跃度排序；只读资料）】\n' : '【跨记忆库整理的长期知识（按长期重要度与活跃度排序；只读资料）】\n') + lines.join('\n') + '\n需要核对来源、看变化过程或找更多时，用 censhu_knowledge_recall。', ids: top.map(i => i.id)};
}
