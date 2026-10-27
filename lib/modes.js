import fs from 'node:fs';
const definitions=JSON.parse(fs.readFileSync(new URL('../data/behaviors.json',import.meta.url),'utf8'));
export const modes=definitions.modes;
export const defaultThresholds = {confidence:70, happy:10, excited:22, sweet:10, calm:8, sad:12, worry:12, heartache:12, jealous:12, delta:4, moodHigh:8, moodLow:12, minHoldMinutes:15, releaseMinutes:30, maxHoldMinutes:180, evidenceMinutes:120};

export function chooseMode({mood, previous, dialogue={}, life={}, thresholds={}, now=Date.now(), linked=true}) {
  const t={...defaultThresholds,...thresholds};
  let id='normal', reason='没有明显且可信的触发条件，保持平常';
  const d=mood?.dims||{}, diff=mood?.delta||{};
  const fresh=mood?.ok && now-Number(mood.updatedAt)<=t.evidenceMinutes*60000 && now>=Number(mood.updatedAt)-60000;
  const trusted=linked && fresh && mood.confidence>=t.confidence;
  const strong=k=>Number(d[k]||0)>=t[k] || Number(diff[k]||0)>=t.delta;
  const why=String(mood?.reason||'');
  const careFromMood=trusted&&(strong('heartache')||strong('worry'))&&/(?:青枔|对方|她|枔).{0,24}(?:难受|好累|生病|发烧|受委屈|需要陪伴|想哭|睡不着|遇到困难)/.test(why);
  const flirtFromMood=trusted&&strong('sweet')&&/(?:被夸|夸(?:她|岑舒|我)|被撩|暧昧|说中心事)/.test(why);
  const romanceFromMood=trusted&&strong('jealous')&&/(?:喜欢的人|暗恋|约会|女朋友|男朋友|感情话题)/.test(why);
  let priority=0;
  if (dialogue.needsCare || (careFromMood&&!dialogue.careResolved)) {id='soft';reason='青枔明确需要关心，或最新可信心疼/担心记录有具体困难依据，优先于自己的情绪';priority=100;}
  else if (dialogue.confession) {id='panicked';reason='青枔认真表达喜欢或直接询问感情';priority=90;}
  else if (dialogue.offense) {id='hurt';reason='当前对话有明确冒犯';priority=80;}
  else if ((dialogue.flirt || flirtFromMood) && trusted && strong('sweet')) {id='embarrassed';reason='有夸奖或暧昧情境，且可信甜蜜信号上升';priority=80;}
  else if ((dialogue.romance || romanceFromMood) && trusted && strong('jealous')) {id='jealous';reason='相关感情话题和可信吃醋信号共同触发';priority=75;}
  else if (life.fatigue) {id='tired';reason='当前处于疲惫日程或有效生活事件';priority=60;}
  else if (life.annoyed) {id='annoyed';reason='进行中的生活事件明确带来烦闷';priority=60;}
  else if (trusted && (strong('sad') || mood.mood<=mood.baseline-t.moodLow)) {id='low';reason='最近可信难过信号或持续低于心情基线';priority=40;}
  else if (trusted && strong('happy') && d.happy>=t.excited && mood.mood>=mood.baseline+t.moodHigh) {id='excited';reason='明显开心且总心情高于基线';priority=40;}
  else if (trusted && (strong('happy') || strong('sweet'))) {id='pleased';reason='可信开心或甜蜜适度上升';priority=40;}
  else if (trusted && d.calm>=t.calm) reason='踏实较高且没有冲突情绪';
  // A missing/broken adapter must never lock a previous emotional mode.
  const validPrevious=previous && modes[previous.id] && now-previous.since<t.maxHoldMinutes*60000;
  if (linked && !mood?.ok && priority<60) return {id:'normal',reason:'心情读取失败，降级平常；不伪造心情',since:now,updatedAt:now,priority:0,recovering:false};
  if (validPrevious && previous.id!==id && priority<75 && (priority<Number(previous.priority||0) || (priority===Number(previous.priority||0)&&Number(mood?.confidence)<85)) && now-previous.since<t.minHoldMinutes*60000) {
    return {...previous,updatedAt:now,reason:previous.reason+'；短时维持，避免轻微波动跳变'};
  }
  if (validPrevious && id==='normal' && previous.id!=='normal' && !previous.recovering) return {...previous,recovering:true,releaseAt:now+t.releaseMinutes*60000,updatedAt:now,reason:'触发条件消退，逐步恢复平常'};
  if (validPrevious && previous.recovering && id==='normal' && now<previous.releaseAt) return {...previous,updatedAt:now};
  return {id,reason,since:previous?.id===id?previous.since:now,updatedAt:now,priority,recovering:false};
}
