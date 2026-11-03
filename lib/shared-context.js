import {planCandidates,choosePlan} from './agency-plan-choice.js';
import {owner as agencyOwner,signal as agencySignal,current as agencyCurrent} from './censhu-control.mjs';
import {engineTiming} from './rhythm.js';
import {personalitySources} from './personality-sources.js';
import {syncPersonality} from './personality-sync.js';
import {projectEvidence} from './project-evidence.js';
import {deliverInnerEffects} from './inner-effects.js';
import {intentionView,applyIntentionChanges} from './life-intentions.js';
import {readPersonaCandidates,readPersonaEvidence} from './persona-evolution.js';
import {clock} from './engine.js';
import {readMood} from './engine.js';
import {googleStructured as monitoredGoogle} from './situation.js';
const googleStructured=(system,schema,input,config,options={})=>monitoredGoogle(system,schema,input,config,{feature:'shared',...options});
import {timedJudgment} from './timed-input.js';

// In-process integration only: snapshots do not assemble or modify another agent's turn.
export function sharedLifeContext(engine,writeback){
 const resolve=request=>{
  const id=request?.sessionId||engine.config.sessionIds[0];
  if(!engine.config.enabled||!engine.config.context||!id||!engine.bound(id))throw Error('共享生活会话未启用或未绑定');
  return id;
 };
 return {
  agencyLife(request){
   const id=resolve(request);if(!agencyOwner(id))throw Error('主动控制未绑定');
   const now=engine.now(), c=clock(now,engine.config.timezone);
   if(request.action==='start')return engine.add(request.templateId,{now,id:request.eventId});
   const ev=engine.state.active.find(x=>x.id===request.eventId);
   if(request.action==='end'){if(!ev)throw Error('事件已结束');return engine.end(ev.id,'自然结束',now);}
   if(request.action==='advance'){
     if(!ev||ev.stage!==request.stage)throw Error('阶段已变化');
     const next=ev.stages?.[ev.stage+1];if(!next)throw Error('已是最后阶段');
     ev.stage++;ev.stageText=next.text;engine.publishMoodEvent(ev,'stage',now);engine.changes.append('event-stage',{eventId:ev.id,name:ev.name,stage:ev.stage,stageText:ev.stageText,...engine.observation(ev)},now);engine.persist();return {id:ev.id,stage:ev.stage};
   }
   return {available:engine.allTemplates().filter(t=>engine.eligible(t,c,now)).map(t=>({id:t.id,name:t.name})),ongoing:engine.state.active.map(x=>({id:x.id,name:x.name,stage:x.stage,detail:x.stageText}))};
  },
  agencyPlan(request){
   const id=resolve(request);if(!agencyOwner(id))throw Error('当前会话未接手');
   return request.decision==='list'?planCandidates(engine,engine.now()):choosePlan(engine,request);
  },
  notifyInnerState({id}){if(typeof id!=='string'||!id.startsWith('inner-state:'))throw Error('内在状态编号无效');if(engine.director){engine.director.record.nextAt=0;engine.director.save();}if(engine.rhythm){engine.rhythm.record.revision='';engine.rhythm.save();}const receipt={id,at:engine.now(),lifeReconsideration:!!engine.director,rhythmReconsideration:!!engine.rhythm};engine.write('inner-state-receipt.json',receipt);return receipt;},
  timing:(key,fallback)=>engineTiming(engine,key,fallback),
  contract:'censhu.life-integration',version:2,capabilities:{independentEffects:1,attentionContext:1,personalGrowth:1,projectEvidence:1,personality:1},
  projectEvidence(request={}){const sessionId=resolve(request);return projectEvidence(engine,sessionId);},
  personalitySources(request={}){const sessionId=resolve(request);return personalitySources(engine,writeback,sessionId,String(request.query||'岑舒的性格与生活变化').slice(0,800),Array.isArray(request.excludedTraits)?request.excludedTraits.filter(x=>typeof x==='string').slice(-500):[]);},
  syncPersonality(request){resolve(request);return syncPersonality(engine.personalSettings,request);},
  personalSettings(){return engine.personalSettings.snapshot();},
  syncPersonalGrowth(request){resolve(request);return engine.personalSettings.sync(request);},
  attentionContext(request={}){
   resolve(request);
   if(!Array.isArray(request.eventIds)||request.eventIds.length>80||request.eventIds.some(id=>typeof id!=='string'||id.length>200))throw Error('注意上下文事件编号无效');
   const ids=[...new Set(request.eventIds)],now=engine.now();
   const active=new Map(engine.state.active.map(x=>[x.id,x])),history=new Map(engine.history.events.map(x=>[x.id,x]));
   const mood=readMood(engine.home,engine.config,request.sessionId||engine.config.sessionIds[0],now);
   return {version:1,at:now,events:ids.map(id=>{
    const event=active.get(id)||history.get(id);
    const observations=engine.changes.record.items.filter(x=>x.data?.eventId===id&&/^event-(start|stage|end)$/.test(x.kind)).slice(-16);
    return {id,status:active.has(id)?'active':history.has(id)?'ended':'unknown',
     ...(event?{name:event.name,stage:event.stage,stageText:event.stageText,startedAt:event.startedAt,endsAt:event.endsAt,endedAt:event.endedAt,...engine.observation(event,mood)}:{}),
     timeline:observations.map(x=>({id:x.id,at:x.at,kind:x.kind,stage:x.data.stage,text:x.data.stageText}))};
   })};
  },
  searchEvents({sessionId,...query}){if(!engine.bound(sessionId))throw Error('会话未绑定');return engine.changes.searchEvents(query);},
  eventPage({sessionId,eventId,before}){if(!engine.bound(sessionId))throw Error('会话未绑定');return engine.changes.eventPage(eventId,before);},
  changesSince(cursor=0){return engine.changes.since(cursor);},
  status(){const mood=readMood(engine.home,engine.config,engine.config.sessionIds[0],engine.now());const activity=engine.read('recent-activity.json',{});activity.recent=(activity.recent||[]).filter(x=>engine.now()-x.at<2*3600000).slice(-8);return {enabled:engine.config.enabled&&engine.config.context,sessionIds:[...engine.config.sessionIds],timezone:engine.config.timezone,life:engine.life(),mood,weather:engine.weatherSummary(),intentions:intentionView(engine),events:structuredClone(engine.state.active),moodAccounting:Object.fromEntries([...engine.history.events.slice(-40),...engine.state.active].map(event=>[event.id,engine.observation(event,mood)])),innerMoodIds:engine.moodEvents.events.filter(x=>x.templateId==='inner-reflection').map(x=>x.id),activity,drawing:engine.drawingInspiration?.view()||null};},
  setInnerLifeProvider(provider,prepare,planning){if(typeof provider!=='function')throw Error('需要独处生活上下文提供器');engine.innerLifeProvider=provider;engine.innerLifePrepare=prepare;engine.innerLifePlanning=planning;return ()=>{if(engine.innerLifeProvider===provider){delete engine.innerLifeProvider;delete engine.innerLifePrepare;delete engine.innerLifePlanning;}};},
  judge(system,schema,input,options={}){if(!engine.config.enabled||!engine.config.semanticEnabled)throw Error('生活语义辅助已关闭');return googleStructured(system,schema,input,engine.config,options);},
  submitInnerResult(request){
   const sessionId=resolve(request),{id,memory,mood}=request;
   if(typeof id!=='string'||!/^inner:[a-zA-Z0-9-]+$/.test(id))throw Error('独处记录身份无效');
   if(request.effectsProtocol===1)return deliverInnerEffects(engine,{...request,sessionId},part=>this.submitInnerResult(part));
   const result={memory:'none',mood:'none'};if(request.intentionChanges?.length)result.intentions=applyIntentionChanges(engine,request);
   if(memory&&engine.config.memoryWritebackEnabled){
    if(typeof memory.text!=='string'||memory.text.length>200||typeof memory.quote!=='string'||memory.quote.length>1000||!Number.isInteger(memory.importance)||memory.importance<75||memory.importance>100)throw Error('独处记忆无效');
    writeback.enqueue(sessionId,{...memory,kind:'fact',origin:'character-life'},id);writeback.save();result.memory='queued';
   }
   if(mood&&engine.config.lifeMoodEnabled&&engine.config.moodLinked){
    const origin=mood.eventId;
    if(typeof origin!=='string'||!origin||origin.startsWith('inner:'))throw Error('独处心情缺少原始生活事件');
    const receipt=engine.read('inner-mood-receipts.json',{events:{},daily:{}}),day=engine.life().date;
    const reserved=receipt.events[origin];
    if(reserved){
     if(reserved.id!==id||!reserved.event||reserved.published)return {...result,mood:'duplicate'};
     // Recover a persisted reservation without charging the daily budget again.
     if(!engine.moodEvents.events.some(x=>x.id===reserved.event.id))engine.moodEvents.events.push(reserved.event);
     engine.write('mood-events.json',engine.moodEvents);
     reserved.published=true;engine.write('inner-mood-receipts.json',receipt);
     return {...result,mood:'queued'};
    }
    const source=[...engine.state.active,...engine.history.events].find(x=>x.id===origin),base=engine.moodEvents.events.filter(x=>x.eventId===origin&&x.templateId!=='inner-reflection');
    if(source?.moodAdmission==='daily-limit')return {...result,mood:'source-daily-limit'};
    if(!base.length&&source?.moodAdmission!=='admitted')return {...result,mood:'source-not-admitted'};
    if(typeof mood.reflectionEvidence!=='string'||!mood.reflectionEvidence.trim()||mood.reflectionEvidence.length>300||typeof mood.distinctReason!=='string'||!mood.distinctReason.trim()||mood.distinctReason.length>200)throw Error('独处新感受缺少独立反思依据');
    const usage=receipt.daily[day]||{mood:0,dims:{happy:0,calm:0,sad:0}};
    if(!Number.isFinite(mood.confidence)||mood.confidence<70||mood.confidence>100||typeof mood.reason!=='string'||mood.reason.length>200||Object.keys(mood.dims||{}).some(k=>!['happy','calm','sad'].includes(k))||!Number.isInteger(mood.moodDelta)||Math.abs(mood.moodDelta)>3||!['happy','calm','sad'].every(k=>Number.isInteger(mood.dims?.[k])&&Math.abs(mood.dims[k])<=6))throw Error('独处心情数值无效');
    if(usage.mood+Math.abs(mood.moodDelta)>6||['happy','calm','sad'].some(k=>usage.dims[k]+Math.abs(mood.dims[k])>12))return {...result,mood:'daily-limit'};
    const event={id:origin+':reflection',eventId:origin,origin:'character-life',innerId:id,templateId:'inner-reflection',name:'独处后的新感受',phase:'reflection',stage:0,stageText:mood.reason,at:engine.now(),day:engine.life().date,modelJudgment:{version:1,confidence:mood.confidence,moodDelta:mood.moodDelta,dims:mood.dims,reason:mood.reason},reaction:{id:'inner-reflection',label:'独处反思',text:mood.reason,moodDelta:mood.moodDelta,dims:mood.dims}};
    timedJudgment(event);
    receipt.events[origin]={id,at:engine.now(),event,published:false};usage.mood+=Math.abs(mood.moodDelta);for(const k of ['happy','calm','sad'])usage.dims[k]+=Math.abs(mood.dims[k]);receipt.daily[day]=usage;receipt.daily=Object.fromEntries(Object.entries(receipt.daily).slice(-14));engine.write('inner-mood-receipts.json',receipt);
    if(!engine.moodEvents.events.some(x=>x.id===event.id))engine.moodEvents.events.push(event);
    engine.write('mood-events.json',engine.moodEvents);
    receipt.events[origin].published=true;engine.write('inner-mood-receipts.json',receipt);result.mood='queued';
   }
   return result;
  },
  snapshot(request={}){
   const sessionId=resolve(request),now=engine.now();
   const {files,runtime}=readPersonaCandidates(engine);
   const candidates=[...files,...runtime.filter(x=>String(x.sessionId).replace(/^session-/,'')===String(sessionId).replace(/^session-/,''))];
   const byId=new Map(candidates.map(x=>[x.id,x]));
   const selected=(engine.read('memory-selection.json',{}).selectedIds||[]).flatMap(id=>byId.has(id)?[byId.get(id)]:[]);
   const seen=new Set(),memories=[];let budget=8000;
   for(const row of [...selected,...readPersonaEvidence(engine)]){
    if(!byId.has(row.id)||seen.has(row.id)||row.text.length>budget)continue;
    if(row.sessionId&&String(row.sessionId).replace(/^session-/,'')!==String(sessionId).replace(/^session-/,''))continue;
    seen.add(row.id);budget-=row.text.length;memories.push({source:row.source,text:row.text});
    if(memories.length>=32)break;
   }
   const hour=Number(clock(now,engine.config.timezone).hour);
   return {sessionId,name:engine.profile.name,lifeIntentions:intentionView(engine,now),context:engine.context(sessionId,{now}),memories,quiet:hour>=2&&hour<6,at:now};
  },
  observe(request){
   resolve(request);
   if(typeof request.text!=='string'||!request.text.trim()||request.text.length>3000)throw Error('需要1至3000字的真实桌宠来信');
   // Compatibility barrier: old Pet clients must not alter global state either.
   return {accepted:false,reason:'pet-read-only'};
  },
 };
}
