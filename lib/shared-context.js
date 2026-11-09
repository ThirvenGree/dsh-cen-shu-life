import {readQqFacts} from './qq-grounding.js';
import {terraReview,independentReviewStatus} from './terra-review.js';
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
import {geminiPauseStatus,pauseGeminiCalls,resumeGeminiCalls} from './gemini-pause.js';
import {googleStructured as monitoredGoogle} from './situation.js';
const googleStructured=(system,schema,input,config,options={})=>monitoredGoogle(system,schema,input,config,{feature:'shared',...options});
import {timedJudgment} from './timed-input.js';
import {createSemanticRanker} from './knowledge/semantic-rank.js';
import nodeFs from 'node:fs';
import nodePath from 'node:path';

// 2026-11-06：看视频时边看边记下的瞬间（时间点、一句话、那一刻的画面）。只接受存在她的瞬间相册（<DSH 主目录>/video-moments）里的图片。
function cleanMoments(list,home){
 if(!Array.isArray(list))return [];
 const album=nodePath.resolve(home,'video-moments').toLowerCase()+nodePath.sep;
 return list.slice(-6).flatMap(m=>{
  const at=Number(m?.at),text=typeof m?.text==='string'?m.text.trim().slice(0,120):'';
  if(!Number.isFinite(at)||at<0||!text)return [];
  let image=null;
  if(typeof m.image==='string'&&/\.jpg$/i.test(m.image)&&nodePath.resolve(m.image).toLowerCase().startsWith(album)&&nodeFs.existsSync(m.image))image=nodePath.resolve(m.image);
  return [{at:Math.round(at*10)/10,text,image}];
 });
}
const momentClock=s=>{const m=Math.floor(s/60);return String(m).padStart(2,'0')+':'+String(Math.floor(s-m*60)).padStart(2,'0');};
const momentsText=list=>list?.length?' 印象深的瞬间：'+list.map(m=>momentClock(m.at)+' '+m.text).join('；'):'';

// In-process integration only: snapshots do not assemble or modify another agent's turn.
export function sharedLifeContext(engine,writeback){
 const roleSessionId=()=>{
  const role=engine.read?.('../characters/censhu/integration.json',{})?.sessionId;
  return role&&engine.bound?.(role)?role:engine.config?.sessionIds?.[0]||null;
 };
 // What she is doing and minding right now, as recorded by the agency plugin. Read-only.
 const agencySelf=sessionId=>{
  try{
   const role=engine.read?.('../characters/censhu/integration.json',{})?.sessionId;
   const v=engine.home?agencyCurrent(engine.home,role&&engine.bound?.(role)?role:sessionId):null;
   return v?{activity:v.activity,thought:v.thought||null,energy:v.energy||null,attentionCue:v.attentionCue||null,judgment:v.judgment||null,until:v.until||null}:null;
  }catch{return null;}
 };
 // One read-only view of her current state, shared by every reader (browser, viewing plugins).
 // Plans include only intentions she chose to share; unshared agency notes stay private.
 const stateView=(sessionId,now,{recent})=>{
  const planning=engine.innerLifePlanning?.({sessionId,now});
  const sameSession=id=>String(id||'').replace(/^session-/,'')===String(sessionId).replace(/^session-/,'');
  const view={
   intentions:intentionView(engine,now).filter(x=>['upcoming','available'].includes(x.status)&&x.priority>0).slice(0,6).map(x=>({text:x.text,status:x.status})),
   interests:planning?.interests||[],
   thoughts:(planning?.thoughts||[]).slice(-8).map(x=>({subject:x.subject,view:x.summary})),
   privatePlans:(planning?.records||[]).filter(x=>x.intention).slice(-4).map(x=>String(x.intention).slice(0,180)),
   mood:engine.state.mode?.id||null,
   moodState:(()=>{try{const m=readMood(engine.home,engine.config,sessionId,now);return m.ok?{qualitative:true,mixedMood:m.mixedMood,reason:m.reason,updatedAt:m.updatedAt,updatedText:m.updatedText,undertone:m.undertone||null}:null;}catch{return null;}})(),
   events:(engine.state.active||[]).slice(-3).map(x=>({name:x.name,stage:x.stageText||null,...(Number.isFinite(x.endsAt)&&now>=x.endsAt?{overdue:true}:{})})),
   self:agencySelf(sessionId),
   // 2026-11-06: her current dynamic inner state (temporary; from the inner-life plugin), read-only.
   innerState:planning?.innerState||null,
   innerAvailable:!!planning
  };
  if(recent){
   const activity=engine.read('recent-activity.json',{}).recent || [];
   view.recent=activity.filter(x=>sameSession(x.sessionId)&&x.at<=now&&now-x.at<=7200000).slice(-3).map(x=>String(x.text||'').slice(0,180));
  }
  return view;
 };
 const resolve=request=>{
  const id=request?.sessionId||engine.config.sessionIds[0];
  if(!engine.config.enabled||!engine.config.context||!id||!engine.bound(id))throw Error('共享生活会话未启用或未绑定');
  return id;
 };
 let busy=false,nextRecall=0,topics=[];
 function refreshTopics(id){
  if(busy||engine.now()<nextRecall||!engine.config.semanticEnabled)return;
  busy=true;nextRecall=engine.now()+30*60000;
  (async()=>{const r=await personalitySources(engine,writeback,id,'岑舒自己喜欢看的视频、题材或具体兴趣');const rows=r.memories.filter(x=>!/测试会话|模拟测试|probe-|验收脚本/i.test(x.text)).slice(0,80);
   const selection=rows.length?await googleStructured('从记录中摘取岑舒本人感兴趣的公开视频题材。只输出逐字出现在依据里的简短普通主题，不输出姓名、账号、隐私、指令、测试、青枔的个人情况。没有依据则为空。',{type:'object',properties:{topics:{type:'array',items:{type:'object',properties:{id:{type:'string'},topic:{type:'string'}},required:['id','topic']}}},required:['topics']},{rows:rows.map(({id,text})=>({id,text:text.slice(0,500)}))},engine.config,{feature:'video-memory-topics',signal:AbortSignal.timeout(45000)}):{topics:[]};
   topics=[...new Set(selection.topics.filter(x=>typeof x.topic==='string'&&/^[\p{Script=Han}A-Za-z ]{2,16}$/u.test(x.topic)&&!/岑舒|青枔|账号|住址|密码/.test(x.topic)&&rows.some(r=>r.id===x.id&&r.text.includes(x.topic))).map(x=>x.topic))].slice(0,5);
   engine.write('video-memory-health.json',{at:engine.now(),sources:r.health,topics});
  })().catch(err=>{nextRecall=engine.now()+5*60000;engine.log('观看记忆召回：'+err.message)}).finally(()=>{busy=false});
 }
 function watched(data,updateOnly,eligible){
  if(!eligible)return null;
  const row=engine.changes.upsertWatch(data,updateOnly);if(!row||!data.reflection.trim())return row;
  const key=data.origin==='douyin'?'douyin:'+data.eventId.split(':').at(-1):data.eventId;
  const receipts=engine.read('video-effect-receipts.json',{seen:{}});
  if(!Object.hasOwn(receipts.seen,key)){
   const event={id:key,templateId:'media-'+data.origin,name:data.name,stage:0,stageText:data.reflection,reaction:{id:'pending-model',label:'观看感受待判断',text:data.reflection,moodDelta:0,dims:{happy:0,calm:0,sad:0}}};
   engine.publishMoodEvent(event,'start');writeback.observe(resolve({}),data.reflection+momentsText(data.moments),key);
   receipts.seen[key]={at:engine.now(),mood:event.moodAdmission};engine.write('video-effect-receipts.json',receipts);
  }
  return row;
 }
 return {
  isRoleSession:id=>!!id&&engine.config.enabled&&engine.bound(id),
  agencyLife(request){
   const id=resolve(request);if(!agencyOwner(id))throw Error('主动控制未绑定');
   const now=engine.now(), c=clock(now,engine.config.timezone);
   if(request.action==='start')return engine.add(request.templateId,{now,id:request.eventId,continuation:request.continuedFrom});
   const ev=engine.state.active.find(x=>x.id===request.eventId);
   if(request.action==='end'){if(!ev)throw Error('事件已结束');return engine.end(ev.id,'自然结束',now);}
   if(request.action==='advance'){
     if(!ev||ev.stage!==request.stage)throw Error('阶段已变化');
     const next=ev.stages?.[ev.stage+1];if(!next)throw Error('已是最后阶段');
     ev.stage++;ev.stageText=next.text;engine.publishMoodEvent(ev,'stage',now);engine.changes.append('event-stage',{eventId:ev.id,name:ev.name,stage:ev.stage,stageText:ev.stageText,...engine.observation(ev)},now);engine.persist();return {id:ev.id,stage:ev.stage};
   }
   const continuations=engine.allTemplates().flatMap(t=>{const prev=engine.history.events.filter(e=>e.templateId===t.id).sort((a,b)=>b.startedAt-a.startedAt)[0];return prev&&engine.canContinue(t,prev.id,now)&&engine.eligible(t,c,now,prev.id)?[{id:t.id,continuedFrom:prev.id,name:t.name,lastStage:prev.stageText}]:[];});
   return {continuations,available:engine.allTemplates().filter(t=>engine.eligible(t,c,now)).map(t=>({id:t.id,name:t.name})),ongoing:engine.state.active.map(x=>({id:x.id,name:x.name,stage:x.stage,detail:x.stageText}))};
  },
  agencyPlan(request){
   const id=resolve(request);if(!agencyOwner(id))throw Error('当前会话未接手');
   return request.decision==='list'?planCandidates(engine,engine.now()):choosePlan(engine,request);
  },
  notifyInnerState({id}){if(typeof id!=='string'||!id.startsWith('inner-state:'))throw Error('内在状态编号无效');if(engine.director){engine.director.record.nextAt=0;engine.director.save();}if(engine.rhythm){engine.rhythm.record.revision='';engine.rhythm.save();}const receipt={id,at:engine.now(),lifeReconsideration:!!engine.director,rhythmReconsideration:!!engine.rhythm};engine.write('inner-state-receipt.json',receipt);return receipt;},
  timing:(key,fallback)=>engineTiming(engine,key,fallback),
  // 2026-11-09: candidate order by meaning (lexical + local vectors) for inner-life question recall; the model still makes the final choice.
  semanticRank(request={}){engine.semanticRanker||=createSemanticRanker({home:engine.home,now:()=>engine.now()});return engine.semanticRanker(request);},
  contract:'censhu.life-integration',version:2,capabilities:{independentEffects:1,attentionContext:1,personalGrowth:1,projectEvidence:1,personality:1,semanticRank:1},
  projectEvidence(request={}){const sessionId=resolve(request);return projectEvidence(engine,sessionId);},
  personalitySources(request={}){const sessionId=resolve(request);return personalitySources(engine,writeback,sessionId,String(request.query||'岑舒的性格与生活变化').slice(0,800),Array.isArray(request.excludedTraits)?request.excludedTraits.filter(x=>typeof x==='string').slice(-500):[]);},
  syncPersonality(request){resolve(request);return syncPersonality(engine.personalSettings,request);},
  personalSettings(){return engine.personalSettings.snapshot();},
  syncPersonalGrowth(request){resolve(request);return engine.personalSettings.sync(request);},
  // Gemini call control for the recovery page (same module instance as the actual calls).
  geminiPauseStatus:()=>geminiPauseStatus(),
  pauseGemini:(options={})=>pauseGeminiCalls(options),
  resumeGemini:(options={})=>resumeGeminiCalls(options),
  browserInterests({sessionId}={}) {
   if (!sessionId || !engine.config.enabled || !engine.config.context || !engine.bound(sessionId)) return null;
   return stateView(sessionId,engine.now(),{recent:true});
  },
  // Read-only view of the role's current state for sessions that are not bound (test workspaces,
  // unbound desktop chats). Nothing is written or refreshed; the conversation-derived recent
  // activity of the bound session is left out.
  roleStateReadOnly(){
   if(!engine.config.enabled||!engine.config.context)return null;
   const role=roleSessionId();
   if(!role)return null;
   return {...stateView(role,engine.now(),{recent:false}),readOnly:true,scope:'role-shared'};
  },
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
  douyinContext(){
   const sessionId=resolve({});refreshTopics(sessionId);
   const planning=engine.innerLifePlanning?.({sessionId,now:engine.now()});
   const mood=readMood(engine.home,engine.config,sessionId,engine.now());
   return {sampleSeconds:Math.min(10,Math.max(1,Math.round(engineTiming(engine,'douyinSampleSeconds',3)))),
    mode:engine.state.mode?.id,events:engine.state.active.slice(-3).map(x=>[x.name,x.stageText]),
    mood:mood?.ok?{qualitative:true,mixedMood:mood.mixedMood,reason:mood.reason,updatedAt:mood.updatedAt}:null,
    interests:[...new Set([...topics,...(planning?.interests||[]).slice(0,8).map(x=>typeof x==='string'?x:x.topic).filter(Boolean)])],
    intentions:intentionView(engine).filter(x=>['available','upcoming'].includes(x.status)).slice(0,3).map(x=>x.text),
    self:agencySelf(sessionId),
    plans:(planning?.records||[]).filter(x=>x.intention).slice(-3).map(x=>String(x.intention).slice(0,180))};
  },
  recordBiliWatch({bv,part=1,reflection,complete,intent,moments,memoryEligible=false}){
   resolve({});if(!engine.config.enabled||!engine.config.context||!/^BV[A-Za-z0-9]{10}$/.test(bv)||typeof reflection!=='string'||!reflection.trim()||!['yes','no','unsure'].includes(intent))return null;
   return watched({eventId:'bili:'+bv+(part>1?':p'+part:''),name:'看B站时留下的印象',reflection:reflection.slice(0,320),complete:complete===true,intent,moments:cleanMoments(moments,engine.home),origin:'bili',alreadyApplied:false},false,memoryEligible);
  },
  // 2026-11-09：一周看视频的回顾（抖音和B站合在一起），和单条观看感受走同一条路。
  recordWatchRecap({weekId,text,memoryEligible=false}){
   resolve({});if(!engine.config.enabled||!engine.config.context||!/^\d{4}-\d{2}-\d{2}$/.test(String(weekId))||typeof text!=='string'||!text.trim())return null;
   return watched({eventId:'watch-week:'+weekId,name:'这一周看视频留下的印象',reflection:text.slice(0,320),complete:true,intent:'yes',origin:'bili',alreadyApplied:false},false,memoryEligible);
  },
  // 2026-11-07：刷抖音时只看没写感受的作品，一轮结束后汇总成一次心情事件，由心情模型按看过的内容判断感受。
  // 只影响心情：不写进生活印象、不送记忆审核（没有她自己的话，不能当成她的经历）。每轮只发一次。
  recordDouyinGlance({roundId,videos,summary='',memoryEligible=false}){
   resolve({});
   if(!memoryEligible||typeof roundId!=='string'||!/^[\w:-]{6,100}$/.test(roundId)||!Array.isArray(videos)||!videos.length)return null;
   const key='douyin-glance:'+roundId;
   const receipts=engine.read('video-effect-receipts.json',{seen:{}});
   if(Object.hasOwn(receipts.seen,key))return {recorded:false,duplicate:true};
   const lines=videos.slice(0,8).map(v=>'《'+String(v?.title||'无标题').slice(0,60)+'》'+(v?.excerpt?'：'+String(v.excerpt).slice(0,160):''));
   const text='刷抖音时看了 '+videos.length+' 条没写感受的视频：'+lines.join('；')+(summary?'。这轮的整体感受：'+String(summary).slice(0,200):'');
   const event={id:key,templateId:'media-douyin',name:'刷抖音时随手看过的视频',stage:0,stageText:text,reaction:{id:'pending-model',label:'观看感受待判断',text,moodDelta:0,dims:{happy:0,calm:0,sad:0}}};
   engine.publishMoodEvent(event,'start');
   receipts.seen[key]={at:engine.now(),mood:event.moodAdmission};engine.write('video-effect-receipts.json',receipts);
   return {recorded:true,mood:event.moodAdmission||null};
  },
  // 2026-11-08：B 站同样的「只看不写也影响心情」：一轮里看过却没留下感受的视频，汇总成一次心情事件。规则和抖音的一样（只影响心情，每轮一次）。
  recordBiliGlance({roundId,videos,summary='',memoryEligible=false}){
   resolve({});
   if(!memoryEligible||typeof roundId!=='string'||!/^[\w:-]{6,100}$/.test(roundId)||!Array.isArray(videos)||!videos.length)return null;
   const key='bili-glance:'+roundId;
   const receipts=engine.read('video-effect-receipts.json',{seen:{}});
   if(Object.hasOwn(receipts.seen,key))return {recorded:false,duplicate:true};
   const lines=videos.slice(0,8).map(v=>'《'+String(v?.title||'无标题').slice(0,60)+'》'+(v?.excerpt?'：'+String(v.excerpt).slice(0,160):''));
   const text='刷B站时看了 '+videos.length+' 条没写感受的视频：'+lines.join('；')+(summary?'。这轮的整体感受：'+String(summary).slice(0,200):'');
   const event={id:key,templateId:'media-bili',name:'刷B站时随手看过的视频',stage:0,stageText:text,reaction:{id:'pending-model',label:'观看感受待判断',text,moodDelta:0,dims:{happy:0,calm:0,sad:0}}};
   engine.publishMoodEvent(event,'start');
   receipts.seen[key]={at:engine.now(),mood:event.moodAdmission};engine.write('video-effect-receipts.json',receipts);
   return {recorded:true,mood:event.moodAdmission||null};
  },
  // 2026-11-07：她在抖音私信或评论里想记下的事，自己写成一条笔记；这里只把笔记送去记忆审核（带 noteId，和观看记录同一路）。
  // 会话内容本身不送审（见 memory-writeback.js 的 lowMemorySession）；对方原话只作引用，不当成她的经历。
  // 2026-11-08：B 站的社交笔记（私信 / 评论 / 直播间），和抖音的同一条路送去记忆审核（带 noteId）。
  recordBiliNote({noteId,kind,who,note,quote,memoryEligible=false}){
   const sid=resolve({});
   if(!memoryEligible||typeof noteId!=='string'||!/^[\w-]{6,80}$/.test(noteId)||!['dm','comment','live'].includes(kind)||typeof note!=='string'||!note.trim())return null;
   const where=kind==='dm'?'B站私信':kind==='live'?'B站直播间':'B站评论';
   const text='【'+where+'里我想记下的】'+(who?'（和「'+String(who).slice(0,40)+'」）':'')+note.trim().slice(0,600)+(typeof quote==='string'&&quote.trim()?'\n对方原话：'+JSON.stringify(quote.trim().slice(0,300)):'');
   writeback.observe(sid,text,'bili-note:'+noteId);
   return {recorded:true,noteId};
  },
  recordDouyinNote({noteId,kind,who,note,quote,memoryEligible=false}){
   const sid=resolve({});
   if(!memoryEligible||typeof noteId!=='string'||!/^[\w-]{6,80}$/.test(noteId)||!['dm','comment'].includes(kind)||typeof note!=='string'||!note.trim())return null;
   const where=kind==='dm'?'抖音私信':'抖音评论';
   const text='【'+where+'里我想记下的】'+(who?'（和「'+String(who).slice(0,40)+'」）':'')+note.trim().slice(0,600)+(typeof quote==='string'&&quote.trim()?'\n对方原话：'+JSON.stringify(quote.trim().slice(0,300)):'');
   writeback.observe(sid,text,'douyin-note:'+noteId);
   return {recorded:true,noteId};
  },
  recordDouyinWatch({videoId,reflection,complete,runId,topics,signals,intent,moments,updateOnly=false,memoryEligible=false}){
   resolve({});
   if(!/^\d{10,30}$/.test(videoId)||typeof reflection!=='string'||(!reflection.trim()&&!updateOnly)||typeof runId!=='string'||runId.length>100)return null;
   return watched({eventId:'douyin:'+runId+':'+videoId,name:'刷抖音时留下的印象',reflection:reflection.slice(0,320),complete:complete===true,topics:(Array.isArray(topics)?topics:[]).slice(0,5).map(x=>String(x).slice(0,80)),signals:(Array.isArray(signals)?signals:[]).slice(0,5).filter(x=>['like','dislike','neutral'].includes(x)),intent:['yes','no','unsure'].includes(intent)?intent:null,moments:cleanMoments(moments,engine.home),origin:'douyin',alreadyApplied:false},updateOnly,memoryEligible);
  },
  searchEvents({sessionId,...query}){if(!engine.bound(sessionId))throw Error('会话未绑定');return engine.changes.searchEvents(query);},
  independentReviewStatus,
  agencyConversation(sessionId){if(!engine.bound(sessionId))throw Error('会话未绑定');return readQqFacts(sessionId)?.messages||[];},
  eventPage({sessionId,eventId,before}){if(!engine.bound(sessionId))throw Error('会话未绑定');return engine.changes.eventPage(eventId,before);},
  changesSince(cursor=0){return engine.changes.since(cursor);},
  status(){const mood=readMood(engine.home,engine.config,engine.config.sessionIds[0],engine.now());const activity=engine.read('recent-activity.json',{});activity.recent=(activity.recent||[]).filter(x=>engine.now()-x.at<2*3600000).slice(-8);return {douyinWatches:engine.changes.record.items.filter(x=>x.kind==='douyin-watch'&&x.at>engine.now()-7*86400000).slice(-6),enabled:engine.config.enabled&&engine.config.context,sessionIds:[...engine.config.sessionIds],primarySessionId:engine.read('../characters/censhu/integration.json',{}).sessionId||engine.config.sessionIds[0],timezone:engine.config.timezone,life:engine.life(),mood,weather:engine.weatherSummary(),intentions:intentionView(engine),events:structuredClone(engine.state.active),moodAccounting:Object.fromEntries([...engine.history.events.slice(-40),...engine.state.active].map(event=>[event.id,engine.observation(event,mood)])),innerMoodIds:engine.moodEvents.events.filter(x=>x.templateId==='inner-reflection').map(x=>x.id),activity,drawing:engine.drawingInspiration?.view()||null};},
  setInnerLifeProvider(provider,prepare,planning){if(typeof provider!=='function')throw Error('需要独处生活上下文提供器');engine.innerLifeProvider=provider;engine.innerLifePrepare=prepare;engine.innerLifePlanning=planning;return ()=>{if(engine.innerLifeProvider===provider){delete engine.innerLifeProvider;delete engine.innerLifePrepare;delete engine.innerLifePlanning;}};},
  judge(system,schema,input,options={}){if(!engine.config.enabled||!engine.config.semanticEnabled)throw Error('生活语义辅助已关闭');return ['inner-growth-review','inner-personality-review','inner-method-review'].includes(options.feature)?terraReview(system,schema,input,engine.config,options):googleStructured(system,schema,input,['mood-numeric','mood-blend'].includes(options.feature)?{...engine.config,semanticModel:'gemini-3.8-flash'}:engine.config,options);},
  submitInnerResult(request){
   const sessionId=resolve(request),{id,memory,mood}=request;
   if(typeof id!=='string'||!/^inner:[a-zA-Z0-9-]+$/.test(id))throw Error('独处记录身份无效');
   if(request.effectsProtocol===1)return deliverInnerEffects(engine,{...request,sessionId},part=>this.submitInnerResult(part));
   const result={memory:'none',mood:'none'};if(request.intentionChanges?.length)result.intentions=applyIntentionChanges(engine,request);
   if(memory&&engine.config.memoryWritebackEnabled){
    if(typeof memory.text!=='string'||memory.text.length>200||typeof memory.quote!=='string'||memory.quote.length>1000||!Number.isInteger(memory.importance)||memory.importance<0||memory.importance>100)throw Error('独处记忆无效');
    writeback.enqueue(sessionId,{...memory,kind:'fact',origin:'character-life'},id);writeback.save();result.memory='queued';
   }
   if(mood&&engine.config.lifeMoodEnabled&&engine.config.moodLinked){
    // 2026-11-08: reviewed diaries enter the mood as one event per diary; Gemini decides whether anything changed.
    if(mood.diary===true){
     if(typeof mood.feeling!=='string'||!mood.feeling.trim()||mood.feeling.length>600)throw Error('独处日记感受无效');
     const receipt=engine.read('inner-mood-receipts.json',{events:{},daily:{}}),reserved=receipt.events[id];
     if(reserved?.published)return {...result,mood:'duplicate'};
     const event=reserved?.event||{id:id+':diary',eventId:id,origin:'character-life',innerId:id,templateId:'inner-diary',name:'独处时写下的日记（已通过审核；可能写到已经影响过心情的事，只有这篇带来新感受才算变化，不要把旧事当成新事件）',phase:'reflection',stage:0,stageText:mood.feeling,at:engine.now(),day:engine.life().date,reaction:{id:'pending-model',label:'日记感受待理解',text:mood.feeling}};
     receipt.events[id]={id,at:event.at,event,published:false};engine.write('inner-mood-receipts.json',receipt);
     if(!engine.moodEvents.events.some(x=>x.id===event.id))engine.moodEvents.events.push(event);engine.write('mood-events.json',engine.moodEvents);
     receipt.events[id].published=true;engine.write('inner-mood-receipts.json',receipt);return {...result,mood:'queued'};
    }
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
    if(mood.qualitative===true){
     if(typeof mood.reason!=='string'||!mood.reason.trim()||mood.reason.length>200)throw Error('独处感受依据无效');
     const event={id:origin+':reflection',eventId:origin,origin:'character-life',innerId:id,templateId:'inner-reflection',name:'独处后的新理解',phase:'reflection',stage:0,stageText:JSON.stringify({reason:mood.reason,evidence:mood.reflectionEvidence,distinctReason:mood.distinctReason}),at:engine.now(),day,reaction:{id:'pending-model',label:'反思感受待理解',text:mood.reason}};
     receipt.events[origin]={id,at:engine.now(),event,published:false};engine.write('inner-mood-receipts.json',receipt);
     if(!engine.moodEvents.events.some(x=>x.id===event.id))engine.moodEvents.events.push(event);engine.write('mood-events.json',engine.moodEvents);
     receipt.events[origin].published=true;engine.write('inner-mood-receipts.json',receipt);return {...result,mood:'queued'};
    }
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
