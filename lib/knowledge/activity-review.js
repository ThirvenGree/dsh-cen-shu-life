// 活跃度判断：强弱信号不再用固定数字，由 Gemini 结合每条知识的内容与真实使用情况动态给出。
//   使用情况：被回忆工具调出、被上下文预算选中阅读、提供给预算但没被选中（各自的次数与最近时间，北京时间文字）；
//   Gemini 给出：活跃度权重、哪种使用会让它“重新变新”（淡出时间从哪里算）、保持多久不淡出、多久后再判断一次。
// 只影响排序与注入优先级，没有删除或改写任何记忆的路径。
// 失败（402、超时、格式错误）只记录退避，继续用上一次的判断；从没判断过的条目用固定的兜底规则。
import path from 'node:path';
import {KIND_TEXT, STAGE_TEXT, bjText, dir, readJson, writeJson, safeText, backoff, cleanError} from './common.js';

const DAY = 86400000, BATCH = 20;
const str = {type: 'string'};
export const FADE_FROM = ['last-recall', 'last-use', 'event'];
export const LIMITS = {weight: [0.5, 2], holdDays: [1, 365], reviewAfterDays: [1, 60]};
export const activitySchema = {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['id', 'weight', 'fadeFrom', 'holdDays', 'reviewAfterDays', 'reason'], properties: {
  id: str, weight: {type: 'number'}, fadeFrom: {type: 'string', enum: FADE_FROM}, holdDays: {type: 'integer'}, reviewAfterDays: {type: 'integer'}, reason: str}}}}};
export const activityPrompt = '你在为岑舒的长期知识判断“活跃度”，它只影响这些知识在上下文里的排序先后，不删除也不修改任何记忆。input.now 是现在（北京时间）；input.items 每条有内容、类型、阶段、长期重要度与分类、当前保持天数、发生与更新时间，以及真实使用情况：recalled 是被回忆工具主动调出的次数，selected 是被上下文预算选中阅读的次数，passed 是提供给预算但没被选中的次数，各自附最近一次时间；previous 是上次的判断。请逐条综合判断（不要套用固定公式，不同条目可以差别很大）：weight 活跃度权重（0.5–2，1 为中性；经常被真正用到、和近况相关的高一些，总被略过或已经过时的低一些）；fadeFrom 哪种使用能让它“重新变新”：last-recall 只有被主动调出才算，last-use 被预算选中阅读也算，event 使用都不算、只看事情本身的时间；holdDays 从那个时间点起保持多少天不淡出（1–365）；reviewAfterDays 多少天后再判断一次（1–60，变化快的短一些）；reason 最多80字。只判断给出的条目，id 原样返回。只返回JSON。';

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const usageOf = a => ({recalled: Number(a?.recalled || 0), selected: Number(a?.selected || 0), passed: Number(a?.passed || 0)});

export class ActivityReviewer {
  constructor({home, generate, now = () => Date.now()}) {
    Object.assign(this, {home, generate, now});
    this.file = path.join(dir(home), 'activity-review.json');
    this.indexFile = path.join(dir(home), 'index.json');
    this.activityFile = path.join(dir(home), 'activity.json');
  }
  load() { return readJson(this.file, {version: 1, judgments: {}, status: {}}); }
  judgments() { try { return this.load().judgments || {}; } catch { return {}; } }
  status() { const s = this.load(); return {...(s.status || {}), judged: Object.keys(s.judgments || {}).length}; }

  /** Items that have real usage and are new, due, or were recalled again since the last judgment. */
  due(index, activity, judgments, now) {
    return Object.values(index?.items || {}).filter(i => ['active', 'uncertain'].includes(i.status)).filter(i => {
      const a = activity[i.id]; if (!a) return false;
      const u = usageOf(a); if (!u.recalled && !u.selected && !u.passed) return false;
      const j = judgments[i.id]; if (!j) return true;
      return Number(j.reviewAt || 0) <= now || u.recalled > Number(j.basis?.recalled || 0);
    }).sort((x, y) => Math.max(...Object.values(activity[y.id]).filter(Number.isFinite)) - Math.max(...Object.values(activity[x.id]).filter(Number.isFinite))).slice(0, BATCH);
  }

  async tick({signal, force = false} = {}) {
    const st = this.load(), now = this.now();
    if (!force && Number(st.status?.retryAt || 0) > now) return {skipped: 'backoff'};
    const index = readJson(this.indexFile, null); if (!index) return {skipped: 'no-index'};
    const activity = readJson(this.activityFile, {items: {}}).items || {};
    // 条目已不在索引里或已失效：它的判断不再需要
    for (const id of Object.keys(st.judgments || {})) if (!['active', 'uncertain'].includes(index.items[id]?.status)) delete st.judgments[id];
    const due = this.due(index, activity, st.judgments || {}, now);
    if (!due.length) { st.status = {...st.status, state: 'idle', at: now, reviewed: 0, error: '', retryAt: 0}; writeJson(this.file, st); return {reviewed: 0}; }
    const input = {now: bjText(now), items: due.map(i => {
      const a = activity[i.id] || {}, j = st.judgments?.[i.id];
      return {id: i.id, subject: i.subject, kind: KIND_TEXT[i.kind] || i.kind, stage: STAGE_TEXT[i.stage] || '', content: String(i.content || '').slice(0, 160), importance: i.importance ? {level: i.importance.level, class: i.importance.class} : null,
        holdDays: j?.holdDays || i.importance?.holdDays || 30, eventText: i.eventText || null, updatedText: bjText(i.updatedAt),
        usage: {...usageOf(a), lastRecalled: bjText(a.lastUsedAt), lastSelected: bjText(a.lastSelectedAt), lastPassed: bjText(a.lastPassedAt)},
        previous: j ? {weight: j.weight, fadeFrom: j.fadeFrom, holdDays: j.holdDays, reason: j.reason, at: bjText(j.at)} : null};
    })};
    const failures = Number(st.status?.failures || 0) + 1;
    const fail = error => { st.status = {...st.status, state: 'retry', error: cleanError(error), failures, retryAt: backoff(error, failures, now)}; writeJson(this.file, st); return {error: st.status.error}; };
    let raw;
    try { raw = await this.generate(activityPrompt, activitySchema, input, {signal, maxOutputTokens: 3000}); } catch (e) { return fail(e); }
    const ids = new Set(due.map(i => i.id)), out = {};
    for (const v of Array.isArray(raw?.items) ? raw.items : []) {
      if (!ids.has(v?.id) || out[v.id] || !Number.isFinite(v.weight) || !FADE_FROM.includes(v.fadeFrom) || !Number.isInteger(v.holdDays) || !Number.isInteger(v.reviewAfterDays) || !safeText(v.reason, 200)) continue;
      out[v.id] = {weight: Number(clamp(v.weight, LIMITS.weight).toFixed(3)), fadeFrom: v.fadeFrom, holdDays: clamp(v.holdDays, LIMITS.holdDays), reason: v.reason.trim(), at: now,
        reviewAt: now + clamp(v.reviewAfterDays, LIMITS.reviewAfterDays) * DAY, basis: usageOf(activity[v.id])};
    }
    if (!Object.keys(out).length) return fail(Object.assign(Error('活跃度判断格式无效'), {code: 'MODEL_OUTPUT_FORMAT'}));
    st.judgments = {...(st.judgments || {}), ...out};
    st.status = {state: 'idle', at: now, reviewed: Object.keys(out).length, asked: due.length, error: '', failures: 0, retryAt: 0};
    writeJson(this.file, st);
    return {reviewed: Object.keys(out).length};
  }
}
