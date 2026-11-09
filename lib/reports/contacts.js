// 2026-11-09：主动联系结果的只读汇总，命令行报告和设置页共用。
import fs from 'node:fs';
import path from 'node:path';

export const REPLY_KINDS = {engaged: '有内容地接话', question: '反过来问或想继续聊', brief: '简短应答', less: '让少发一些', declined: '明确不想聊', unclear: '看不出来'};
export function contactsReport(home) {
  let rows = []; try { rows = JSON.parse(fs.readFileSync(path.join(home, 'censhu-agency/state.json'), 'utf8')).awaitingReplies || []; } catch {}
  const kinds = {};
  for (const r of rows) if (r.observed) { const k = REPLY_KINDS[r.observed.kind] || '还没判断'; kinds[k] = (kinds[k] || 0) + 1; }
  const times = rows.map(r => r.observed?.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  return {sent: rows.length, answered: rows.filter(r => r.observed).length, kinds, medianMinutes: times.length ? Math.round(times[Math.floor((times.length - 1) / 2)] / 60000) : null, note: '没有回应的原因未知；回应的方式不等于对方的感受。'};
}
