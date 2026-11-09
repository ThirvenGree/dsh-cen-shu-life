// 2026-11-08：censhu_current_state 的内容：她此刻的全部状态。只读：不调用模型、不刷新、不写任何记录。
import {readMood} from './engine.js';
import {intentionView} from './life-intentions.js';
import {current as agencyCurrent} from './censhu-control.mjs';
import {planView} from './plan-view.js';

const when = (t, zone) => Number.isFinite(t) ? new Date(t).toLocaleString('zh-CN', {timeZone: zone || 'Asia/Shanghai', hour12: false}) : null;

export function currentStateView(engine, {sessionId, recovery = null, now = engine.now()} = {}) {
  const zone = engine.config.timezone, at = t => when(t, zone);
  const planning = engine.innerLifePlanning?.({sessionId, now}) || {};
  const mood = readMood(engine.home, engine.config, sessionId, now);
  const life = engine.life(now), mode = engine.director ? engine.director.mode(sessionId, now) : engine.state.mode;
  const self = agencyCurrent(engine.home, sessionId);
  const paused = !!recovery?.pending, pausedAt = recovery?.manualPause?.at || recovery?.interruption?.pausedAt;
  return {
    readAt: at(now),
    note: '这是你自己的私人状态，不要对外转述。只读，不会刷新或改动任何东西。',
    background: paused ? {paused: true, since: at(pausedAt), note: '后台暂停中：心情、事件、内在状态和想法不会自动更新，可能是旧的。'} : {paused: false},
    time: {date: life.date, hour: life.hour, minute: life.minute, weekday: life.weekday, season: life.season},
    schedule: life.scheduledActivity || life.activity || null,
    behaviorMode: mode ? {id: mode.id, reason: mode.reason || null} : null,
    doingNow: self ? {activity: self.activity, thought: self.thought || null, energy: self.energy || null, judgment: self.judgment || null, until: at(self.until)} : null,
    mood: mood?.ok ? {expired: !!mood.expired, updatedAt: mood.updatedText || null, mixedMood: mood.mixedMood || null, reason: mood.reason || null, undertone: mood.undertone || null} : {available: false},
    activeEvents: (engine.state.active || []).map(e => ({name: e.name, stage: e.stageText || null, startedAt: at(e.startedAt), expectedEnd: at(e.endsAt), ...(Number.isFinite(e.endsAt) && now >= e.endsAt ? {overdue: true} : {})})),
    recentlyEnded: (engine.history.events || []).slice(-3).map(e => ({name: e.name, endedAt: at(e.endedAt)})),
    intentions: intentionView(engine, now).filter(x => ['upcoming', 'available'].includes(x.status)).slice(0, 8).map(x => ({text: x.text, status: x.status})),
    innerState: planning.innerState || null,
    thoughts: (planning.thoughts || []).slice(-8).map(x => ({subject: x.subject, view: x.summary})),
    interests: planning.interests || [],
    privatePlans: (planning.records || []).filter(x => x.intention).slice(-4).map(x => String(x.intention).slice(0, 180)),
    personality: (engine.profile.personalityDevelopment || []).filter(x => x.expiresAt > now).map(x => x.text),
    weather: engine.weatherSummary?.(now)?.summary || null,
    plan: planView(engine, {sessionId, now}),
  };
}
