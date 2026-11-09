// 2026-11-09: what was said around a message when it is reviewed for long-term memory, so a later
// correction or retraction reaches the review. Read-only; used as meaning, never as a quotable source.
import {readQqFacts} from './qq-grounding.js';
const BEFORE = 3, AFTER = 6, MAX_TEXT = 500;
const same = (a, b) => String(a || '').replace(/^session-/, '') === String(b || '').replace(/^session-/, '');
const textOf = message => (message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

/** Rows around `at`, oldest first, excluding the message itself. */
export function windowAround(rows, at, {before = BEFORE, after = AFTER} = {}) {
  if (at < 0) return [];
  const pick = (list, position) => list.filter(r => r.text.trim()).map(r => ({position, speaker: r.role === 'self' ? '岑舒' : '青枔', ...(r.at ? {at: r.at} : {}), text: r.text.slice(0, MAX_TEXT)}));
  return [...pick(rows.slice(Math.max(0, at - before), at), 'before'), ...pick(rows.slice(at + 1, at + 1 + after), 'after')];
}
const locate = (rows, source) => {
  if (source.messageId != null) { const found = rows.findIndex(r => r.id != null && String(r.id) === String(source.messageId)); if (found >= 0) return found; }
  return rows.findLastIndex(r => r.role === 'user' && r.text === source.text);
};
function desktopRows(agent) {
  const out = [];
  for (const e of agent?.session?.snapshotEvents?.() || []) {
    const m = e.data?.message || e.data;
    if (e.type === 'user/message' && m?.source?.kind === 'user') out.push({id: m.id, role: 'user', text: textOf(m)});
    if (e.type === 'assistant/message') { const text = textOf(m); if (text.trim()) out.push({id: m?.id, role: 'self', text}); }
  }
  return out;
}
export function writebackContext({agents = () => [], idOf = a => a?.session?.id || a?.id, qqFacts = readQqFacts} = {}) {
  return source => {
    const qq = qqFacts(source.sessionId);
    if (qq?.messages?.length) { const at = locate(qq.messages, source); if (at >= 0) return windowAround(qq.messages, at); }
    const rows = desktopRows(agents().find(a => same(idOf(a), source.sessionId)));
    return windowAround(rows, locate(rows, source));
  };
}
