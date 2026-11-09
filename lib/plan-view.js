// 2026-11-09：把“原来打算的、现在打算的、实际发生的”放在一起看，结构借鉴 PersonaLife 的三份时间线。
// 只是从现有记录算出来的视图，不新建状态、不调用模型。话头按渠道列出，同一件事在别的渠道说过她自己看得到。
import {intentionView} from './life-intentions.js';
import {current as agencyCurrent} from './censhu-control.mjs';

const SURFACE = {qq: 'QQ', dsh: '桌面'};
const MENTIONS = 12, CHANGES = 5;
export function planView(engine, {sessionId, now = engine.now()} = {}) {
  const zone = engine.config.timezone, life = engine.life(now);
  const at = t => Number.isFinite(t) ? new Date(t).toLocaleString('zh-CN', {timeZone: zone || 'Asia/Shanghai', hour12: false}) : null;
  const day = t => new Intl.DateTimeFormat('sv-SE', {timeZone: zone || 'Asia/Shanghai'}).format(t), today = day(now);
  const self = sessionId ? agencyCurrent(engine.home, sessionId) : null;
  const intentions = intentionView(engine, now);
  const names = new Map([...(engine.state.active || []), ...(engine.history.events || [])].map(e => [e.id, e.name]));
  for (const i of intentions) names.set(i.id, i.text);
  const ledger = engine.read('intention-change-receipts.json', {receipts: {}}).receipts || {};
  return {
    note: '计划只是打算，只有实际发生的才算经历。',
    original: {schedule: life.scheduledActivity || life.activity || null, weekly: engine.profile.weekly?.[life.weekday] || null},
    current: {doing: self ? {activity: self.activity, until: at(self.until)} : null, intentions: intentions.filter(x => ['upcoming', 'available'].includes(x.status)).slice(0, 8).map(x => ({text: x.text, status: x.status}))},
    actual: {happening: (engine.state.active || []).map(e => ({name: e.name, stage: e.stageText || null, startedAt: at(e.startedAt)})), endedToday: (engine.history.events || []).filter(e => Number.isFinite(e.endedAt) && day(e.endedAt) === today).slice(-8).map(e => ({name: e.name, endedAt: at(e.endedAt), reason: e.endReason || null}))},
    changes: Object.values(ledger).filter(r => r?.at).sort((a, b) => a.at - b.at).slice(-CHANGES).flatMap(r => (r.result?.accepted || []).map(x => ({at: at(r.at), what: x.text || x.id || null, change: x.effectNote || x.effectStatus || null}))),
    mentioned: (engine.history.mentions || []).slice(-MENTIONS).map(m => ({what: names.get(m.eventId || m.intentionId) || null, at: at(m.at), surface: SURFACE[m.surface] || '未记录', ...(m.quote ? {quote: String(m.quote).slice(0, 60)} : {})})),
  };
}
