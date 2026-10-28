import fs from 'node:fs';
import path from 'node:path';
import {trustedSituation,situationFromRecord,situationLimits,signalKeys} from './situation.js';
import {adapterHealth} from './adapter-health.js';
export function normalizeMoodContext(value,now=Date.now(),ttl=1440*60000,limits=Object.fromEntries(signalKeys.map(k=>[k,1440]))){return situationFromRecord({value,source:value?.source,at:value?.at,evidenceAt:value?.evidenceAt,resolvedAt:value?.resolvedAt,evidenceExpiresAt:value?.evidenceExpiresAt,resolvedExpiresAt:value?.resolvedExpiresAt},now,ttl,limits);}
const keys=['happy','calm','sweet','heartache','worry','sad','jealous'];
const canon=s=>String(s||'').replace(/^session-/,'');
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export function sampleLifeReaction(event,phase,library,config,random=Math.random){
  const neutral={id:'neutral',label:'平常看待',text:'只是普通生活小事，心情不必变化',moodDelta:0,dims:{}};
  if(!config.lifeMoodEnabled||random()>=config.lifeMoodChance)return neutral;
  const group=phase==='end'&&(event.effect==='annoyed'||event.effect==='fatigue')?'relief':event.effect||event.category;
  const choices=phase!=='end'&&event.reactions?.length?event.reactions:library.groups[group]||library.groups.personal;
  let draw=random()*choices.reduce((s,r)=>s+r.weight,0),picked=choices.at(-1);
  for(const r of choices){draw-=r.weight;if(draw<0){picked=r;break;}}
  const amount=range=>Math.round((range[0]+random()*(range[1]-range[0]))*config.lifeMoodIntensity);
  return {id:picked.id,label:picked.label,text:picked.text,moodDelta:clamp(amount(picked.mood),-3,3),dims:Object.fromEntries(Object.entries(picked.dims).map(([k,r])=>[k,clamp(amount(r),-6,6)]))};
}
// Called by feiyu-mood. Reads life inputs; never writes either plugin's files.
export function readLifeMoodInputs(home,sessionId,slotId,state,now=Date.now()){
  try{
    if(fs.existsSync(path.join(home,'cen-shu-life/mood-link-install.json'))&&!adapterHealth(home).ready)return [];
    const root=path.join(home,'cen-shu-life'),cfg=read(path.join(root,'config.json'));
    if(!cfg.enabled||!cfg.moodLinked||!cfg.lifeMoodEnabled||cfg.moodSlot!==slotId||!cfg.sessionIds?.some(s=>canon(s)===canon(sessionId)))return [];
    const outbox=read(path.join(root,'mood-events.json'));if(outbox.version!==1||!Array.isArray(outbox.events))return [];
    const seen=new Set(state.lifeEventReceipts||[]),age=clamp(Number(cfg.lifeMoodMaxAgeHours)||24,1,72)*3600000;
    return outbox.events.filter(e=>typeof e.id==='string'&&!seen.has(e.id)&&Number.isFinite(e.at)&&e.at>Number(state.lifeEventsResetAt||0)&&e.at<=now&&now-e.at<age&&e.reaction&&typeof e.reaction.text==='string').slice(0,2).map(e=>({id:e.id,event:e.name,phase:e.phase,stage:String(e.stageText||'').slice(0,200),at:e.at,reaction:{label:e.reaction.label,text:e.reaction.text.slice(0,300),suggestedMoodDelta:e.reaction.moodDelta,suggestedDims:e.reaction.dims}}));
  }catch{return [];}
}
export function readLifeSituation(home,sessionId,slotId,now=Date.now()){
  try{
    const root=path.join(home,'cen-shu-life'),cfg=read(path.join(root,'config.json'));
    if(!cfg.enabled||!cfg.moodLinked||cfg.moodSlot!==slotId||!cfg.sessionIds.some(s=>canon(s)===canon(sessionId)))return {};
    const packet=read(path.join(root,'semantic-situations.json'));if(packet.version!==1)return {};
    return situationFromRecord(packet.records[canon(sessionId)],now,(cfg.situationValidityMinutes??120)*60000,situationLimits(cfg));
  }catch{return {};}
}
export function lifeMoodJudgeContext(batch){
  const boundary='\n【生活心情去重边界】已经存在的生活事件、本人重复讲这件事、由既有心情造成的口吻，都不是新的情绪原因，不能因为回复更活跃就持续给自己加分。主字段只计青枔本轮新互动带来的变化；仅复述生活事件或既有状态应保持0，不从同一原因重复计分。';
  if(!batch.length)return boundary;
  return boundary+'\n【岑舒生活事件输入】以下是生活插件已经记录的角色生活模拟，不是青枔的发言，也不是现实外部证据。允许作为岑舒自己的生活心情依据，不编记录之外的情节。随机抽到的是一次固定的轻微反应建议，不强制发生变化，不因时钟或无人回复制造情绪。\n'+JSON.stringify(batch)+'\n仍只进行本轮这一次心情判断。主字段 moodDelta/dims/reason 只计算本轮实际对话贡献，不重复包含生活贡献。额外返回 life:{eventIds:[本次实际考虑过的记录ID],moodDelta:-3..3,dims:{happy:0,calm:0,sweet:0,heartache:0,worry:0,sad:0,jealous:0},reason:"生活记录造成的轻微变化，或为什么没变",confidence:0..100}。生活贡献允许全0；每维限制-6..6，避免大起大落。不能仅因生活事件制造暧昧、吃醋或认定恋爱关系。青枔需要关心时自己的情绪先放一边。';
}
export function mergeLifeContribution(delta,batch,state){
  const life=delta.life,allowed=new Set(batch.map(e=>e.id)),seen=new Set(state.lifeEventReceipts||[]);
  const processed=[...allowed].filter(id=>!seen.has(id));delta={...delta,lifeProcessedIds:processed};
  if(!life||!Number.isFinite(life.confidence)||life.confidence<70||!Array.isArray(life.eventIds))return {...delta,lifeAcceptedIds:[]};
  const ids=[...new Set(life.eventIds)];
  if(!ids.length||ids.some(id=>!allowed.has(id)||seen.has(id)))return {...delta,lifeAcceptedIds:[]};
  const num=(x,cap)=>Number.isFinite(x)?clamp(Math.round(x),-cap,cap):0;
  const contribution={moodDelta:num(life.moodDelta,3),dims:Object.fromEntries(keys.map(k=>[k,num(life.dims?.[k],6)])),reason:String(life.reason||'生活事件已考虑，心情未必变化').slice(0,120)};
  const selected=batch.filter(e=>ids.includes(e.id));contribution.events=selected.map(e=>({id:e.id,name:e.event||e.name||'生活小事',phase:e.phase}));
  if(selected.every(e=>e.reaction&&Number(e.reaction.suggestedMoodDelta||0)===0&&Object.values(e.reaction.suggestedDims||{}).every(v=>v===0))){contribution.moodDelta=0;for(const k of keys)contribution.dims[k]=0;}
  // Non-romantic life events cannot manufacture romance-related dimensions.
  for(const k of ['sweet','jealous','heartache','worry'])contribution.dims[k]=0;
  return {...delta,moodDelta:clamp(delta.moodDelta+contribution.moodDelta,-10,10),dims:Object.fromEntries(keys.map(k=>[k,clamp((delta.dims[k]||0)+contribution.dims[k],-10,10)])),confidence:Math.min(delta.confidence,clamp(life.confidence,0,100)),reason:[delta.reason,contribution.reason].filter(Boolean).join('；').slice(0,200),lifeAcceptedIds:ids,lifeContribution:contribution,lifeBefore:{mood:state.mood,dims:{...state.dims}}};
}
// Mutate only the feiyu-owned in-memory state; its own atomic save persists it.
export function recordLifeMoodReceipts(state,delta){state.lifeEventReceipts=[...new Set([...(state.lifeEventReceipts||[]),...(delta.lifeProcessedIds||delta.lifeAcceptedIds||[])])].slice(-300);if(delta.lifeAcceptedIds?.length){state.lastLifeInfluence={ids:delta.lifeAcceptedIds,at:Date.now(),...delta.lifeContribution,...(Number.isFinite(delta.lifeBefore?.mood)?{appliedTotal:{mood:state.mood-delta.lifeBefore.mood,dims:Object.fromEntries(keys.map(k=>[k,(state.dims[k]||0)-(delta.lifeBefore.dims[k]||0)]))},current:{mood:state.mood,dims:{...state.dims}}}:{})};const last=state.timeline?.at(-1);if(last&&last.at>=Date.now()-2000){last.lifeEventIds=delta.lifeAcceptedIds;last.life={...delta.lifeContribution,appliedTotal:state.lastLifeInfluence.appliedTotal};}}}

const dimensionName=k=>({happy:'开心',calm:'踏实',sweet:'甜蜜',heartache:'心疼',worry:'担心',sad:'难过',jealous:'吃醋'}[k]||k);
const impactDims=d=>Object.entries(d||{}).filter(([,v])=>Math.round(v)).map(([k,v])=>dimensionName(k)+' '+(Math.round(v)>0?'+':'')+Math.round(v)).join('、')||'各维无变化';
export function readLifeFeedback(home,slotId,state,now=Date.now()){
 try{const root=path.join(home,'cen-shu-life'),cfg=read(path.join(root,'config.json'));if(cfg.moodSlot!==slotId)return null;const life=read(path.join(root,'state.json')),queue=read(path.join(root,'mood-events.json')),seen=new Set(state.lifeEventReceipts||[]),age=(cfg.lifeMoodMaxAgeHours||24)*3600000;const last=state.lastLifeInfluence,feedback=life.moodFeedback,confirmed=feedback&&feedback.sourceUpdatedAt===state.updatedAt&&Math.round(feedback.mood)===Math.round(state.mood)&&keys.every(k=>Math.round(feedback.dims[k]||0)===Math.round(state.dims[k]||0));const receivedText=last?'生活事件：'+(last.events?.map(e=>e.name).join('、')||'已有生活记录')+'；生活判定量 '+Math.round(last.moodDelta||0)+'，'+impactDims(last.dims)+'。'+(last.appliedTotal?'本轮实际（含对话）：总心情 '+Math.round(last.appliedTotal.mood||0)+'，'+impactDims(last.appliedTotal.dims)+'。':'')+last.reason:'尚无生活事件的实际判断记录';const emittedText=feedback?(confirmed?'生活插件已读取本次心情':'生活插件正在同步最新数值')+'；采用「'+feedback.mode.label+'」，'+feedback.mode.reason+'。这是行为上下文反馈，不代表已发送消息。':'等待生活插件读取心情';return {receivedText,emittedText,enabled:!!(cfg.enabled&&cfg.moodLinked&&cfg.lifeMoodEnabled),pending:(queue.events||[]).filter(e=>!seen.has(e.id)&&e.at>Number(state.lifeEventsResetAt||0)&&e.at<=now&&now-e.at<age).length,active:(life.active||[]).map(e=>({name:e.name,stage:e.stageText,reaction:e.reaction?.label||'平常'})),mode:life.mode||null,outbound:life.moodFeedback?{...life.moodFeedback,confirmed:life.moodFeedback.sourceUpdatedAt===state.updatedAt&&Math.round(life.moodFeedback.mood)===Math.round(state.mood)&&keys.every(k=>Math.round(life.moodFeedback.dims[k]||0)===Math.round(state.dims[k]||0))}:null,last:state.lastLifeInfluence||null};}catch{return null;}
}
