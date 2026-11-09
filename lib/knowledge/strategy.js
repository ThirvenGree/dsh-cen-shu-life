// 整理策略的版本管理，沿用协作压缩“回放怎样调整后续压缩”的做法：
//   只有发现可复现的失效，才请 Gemini 提出策略补充（只写一般规则，不写具体事实）；
//   新旧策略在同一批题上完整对照（本次生成的题、学到的回归题、留出题都算）：第一次新策略必须修好至少一项、且没有任何回退；
//   第二次换一套新生成的题再确认，没有任何回退才算通过（2026-11-07 起题目每次评估重新生成）；
//   需要连续两次验证都通过才切换为正式版本；只影响之后的整理，进行中的批次沿用开始时的快照；保留历史，可以回滚。
// 不需要人工确认：提案和语义判断交给 Gemini，是否切换由回放结果决定。
import path from 'node:path';
import {dir, readJson, writeJson, safeText, sha} from './common.js';

const str = {type: 'string'};
export const PASSES_REQUIRED = 2;
export const proposalSchema = {type: 'object', additionalProperties: false, required: ['decision', 'notes', 'reason'], properties: {decision: {type: 'string', enum: ['propose', 'skip']}, notes: str, reason: str}};
export const proposalPrompt = '你在改进岑舒长期知识整理的策略。input.failures 是三路回放中可复现的失效（题目、失效机制、整理组与原文组的差别、合成样例检查结果）；input.current 是当前生效的策略补充。请写一段新的“整理策略补充”（最多600字），会附加在整理提示之后：只写一般性的判断规则（例如如何识别更正、如何区分打算与已完成、跨库重复如何合并），不要写任何具体人物经历、日期或题目内容，不要放宽隐私与关系边界，不要要求编造。可以在当前补充上修改、合并或删减。若这些失效不是整理策略能解决的（例如检索或题目问题），decision=skip。reason 最多200字。只返回JSON。';

export class StrategyStore {
  constructor({home, now = () => Date.now()}) { this.file = path.join(dir(home), 'strategy.json'); this.now = now; }
  load() { return readJson(this.file, {version: 1, active: null, candidate: null, history: []}); }
  save(s) { writeJson(this.file, s); }
  active() { return this.load().active; }
  view() { const s = this.load(); return {active: s.active, candidate: s.candidate ? {...s.candidate, notes: s.candidate.notes} : null, history: (s.history || []).slice(-10)}; }

  /** Ask Gemini for a candidate when there are reproducible failures and no candidate is pending. */
  async propose({failures, generate, signal}) {
    const s = this.load();
    if (s.candidate || !failures.length) return s.candidate;
    const v = await generate(proposalPrompt, proposalSchema, {failures, current: s.active?.notes || ''}, {signal, maxOutputTokens: 900});
    if (v?.decision !== 'propose' || !safeText(v.notes, 600) || !safeText(v.reason, 200) || v.notes.trim() === (s.active?.notes || '').trim()) return null;
    s.candidate = {id: 'strategy-' + sha(v.notes).slice(0, 10), notes: v.notes.trim(), reason: v.reason, proposedAt: this.now(), passes: 0, results: []};
    this.save(s); return s.candidate;
  }

  /** Record one full comparison. Promotes after PASSES_REQUIRED passes; any failed comparison discards the candidate. */
  record(comparison) {
    const s = this.load(), c = s.candidate; if (!c) return null;
    c.results = [...(c.results || []), {at: this.now(), ...comparison}].slice(-4);
    if (!comparison.pass) {
      s.history = [...(s.history || []), {at: this.now(), event: 'rejected', id: c.id, notes: c.notes, reason: comparison.reason}].slice(-30);
      s.candidate = null; this.save(s); return {status: 'rejected', reason: comparison.reason};
    }
    c.passes = (c.passes || 0) + 1;
    if (c.passes < PASSES_REQUIRED) { this.save(s); return {status: 'pending', passes: c.passes}; }
    const version = (s.active?.version || 0) + 1;
    if (s.active) s.history = [...(s.history || []), {at: this.now(), event: 'replaced', ...s.active}].slice(-30);
    s.active = {id: c.id, version, notes: c.notes, reason: c.reason, promotedAt: this.now(), basis: c.results};
    s.history = [...(s.history || []), {at: this.now(), event: 'promoted', id: c.id, version}].slice(-30);
    s.candidate = null; this.save(s); return {status: 'promoted', version};
  }

  /** Roll back to the previous active version (or to no supplement). Only affects later consolidation. */
  rollback() {
    const s = this.load();
    const prev = [...(s.history || [])].reverse().find(h => h.event === 'replaced');
    const from = s.active;
    s.active = prev ? {id: prev.id, version: (from?.version || 0) + 1, notes: prev.notes, reason: '回滚到之前的版本', promotedAt: this.now(), basis: prev.basis || []} : null;
    s.history = [...(s.history || []), {at: this.now(), event: 'rolled-back', from: from?.id || null, to: s.active?.id || null}].slice(-30);
    s.candidate = null; this.save(s); return s.active;
  }
}

/**
 * Compare baseline vs candidate on the same cases.
 * pass = fixes at least one thing and regresses nothing (including holdouts and consolidation checks).
 * confirm (2026-11-07): the second comparison runs on a freshly generated suite, where the original failure
 * may not appear at all; there it only has to regress nothing.
 */
export function compareRuns(base, cand, {confirm = false} = {}) {
  const key = c => c.id, ok = (c, lane) => c?.grades?.[lane]?.status === 'correct';
  const bm = new Map(base.cases.map(c => [key(c), c])), cm = new Map(cand.cases.map(c => [key(c), c]));
  const fixed = [], regressed = [];
  for (const [id, b] of bm) {
    const c = cm.get(id); if (!c) continue;
    // 三路回放的规则：原文组本身答不出（unanswerable）或调用失败的题，不能作为“修好”或“回退”的证据。
    if (['call-error', 'unanswerable'].includes(c.diagnosis) || ['call-error', 'unanswerable'].includes(b.diagnosis)) continue;
    for (const lane of ['consolidated', 'recall']) {
      if (!ok(b, lane) && ok(c, lane)) fixed.push(id + '/' + lane);
      if (ok(b, lane) && !ok(c, lane)) regressed.push(id + '/' + lane);
    }
  }
  for (const [k, v] of Object.entries(base.checks || {})) { const n = cand.checks?.[k]; if (v === false && n === true) fixed.push('check/' + k); if (v === true && n === false) regressed.push('check/' + k); }
  const errors = cand.cases.filter(c => c.diagnosis === 'call-error').length;
  const pass = (confirm || fixed.length > 0) && regressed.length === 0 && errors === 0;
  const passText = confirm ? '换一套新题确认：没有回退' + (fixed.length ? '，另修好 ' + fixed.length + ' 项' : '') : '修好 ' + fixed.length + ' 项，没有回退';
  return {pass, fixed, regressed, errors, reason: pass ? passText : errors ? '对照时有 ' + errors + ' 道题调用失败，本次不算' : regressed.length ? '出现回退：' + regressed.join('、') : '没有修好任何一项'};
}
