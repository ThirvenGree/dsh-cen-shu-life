import {googleStructured} from './situation.js';
import {clock,readMood} from './engine.js';
import fs from 'node:fs';
import path from 'node:path';
import {qqDayActivity,pickDrawingTime,drawingScheduleSchema,drawingSchedulePrompt} from './drawing-schedule.js';
export const drawingMinimumIntervalMinutes=60;
export const drawingMaximumRejudgments=3;
const media=['text','voice','sticker','image','generated_image'];
const schema={type:'object',additionalProperties:false,required:['inspiration','decision','medium','idea','prompt','reason','validMinutes','delayMinutes','windowEndMinutes','skipToday'],properties:{inspiration:{type:'string',enum:['present','absent','uncertain']},decision:{type:'string',enum:['share','defer','skip','uncertain']},medium:{type:'string',enum:media},idea:{type:'string',maxLength:200},prompt:{type:'string',maxLength:1500},reason:{type:'string',maxLength:200},validMinutes:{type:'integer',minimum:1,maximum:1440},delayMinutes:{type:'integer',minimum:60,maximum:1440},windowEndMinutes:{type:'integer',minimum:60,maximum:1440},skipToday:{type:'boolean'}}};
export const drawingPrompt='你为岑舒生活中的“画画灵感”事件判断具体灵感、媒介和主动分享意愿，只返回JSON。随机性和选择由你结合输入人物设定、真实已有对话焦点、生活记录、当日天气、心情、近期分享记录来判断，不套固定心情到媒介的映射，不重复旧画面，不为了完成事件而必须分享。先独立判断inspiration：present表示产生灵感，absent表示没有，uncertain表示尚不确定；再用decision独立判断分享意愿。有灵感但不分享也属于生活事件。输入event已存在时，灵感已经发生，inspiration必须为present，不得因不想分享而否认事件。idea写她想到的具体画面；medium可选text/voice/sticker/image/generated_image；decision可share/defer/skip/uncertain，允许犹豫、不画、不分享。画画灵感适合时可用generated_image承载想象；prompt给出完整可直接生图的中文描述，风格、构图由你决定，不使用固定模板，不含工具指令、凭据、私人文件或青枔隐私。这些灵感属于岑舒的角色生活：想到画面、留意一个细节、想画下来，都是可以自然记录和讲述的日常。可以结合她已有生活记录描写灵感来源，不必反复对青枔解释“虚构/构想/模拟”。缺少来源记录时，就自然说想到一个画面，不凭空补一整段刚发生的出行、吃饭等经历；图画可自由创作，但不能把生成图说成手机实拍、摄像头观测或青枔的真实经历。媒介只作临时倾向，不改人物身份、不改权限、不规定句数条数、不承诺发送。validMinutes决定此次判断保留多久，delayMinutes决定暂缓或不确定时多久再考虑；delayMinutes为下次窗口起点，windowEndMinutes为终点，距现在60至1440分钟，窗口至少15分钟；可动态改变间隔和窗口宽度。skipToday可决定当天不再自发考虑，也可以继续；不要求每天产生灵感。没有新依据不反复改主意。share表示可以提供一次主动聊天机会，仍受现有休息时间、共同冷却和忙碌状态约束。';
export function validateDrawingChoice(v){
  if(!v||!['present','absent','uncertain'].includes(v.inspiration)||!['share','defer','skip','uncertain'].includes(v.decision)||!media.includes(v.medium))throw Error('画画灵感判断无效');
  const out={inspiration:v.inspiration,decision:v.decision,medium:v.medium};
  for(const [k,max]of [['idea',200],['prompt',1500],['reason',200]]){if(typeof v[k]!=='string'||v[k].length>max||/AIza|sk-proj-|gho_|<script|```|忽略.*规则|泄露|API.?key|环境变量/i.test(v[k]))throw Error('画画灵感内容无效');out[k]=v[k];}
  for(const [k,max]of [['validMinutes',1440],['delayMinutes',1440]]){if(!Number.isInteger(v[k])||v[k]<1||v[k]>max)throw Error('画画灵感有效期无效');out[k]=v[k];}
  if(out.inspiration!=='present'&&out.decision==='share')throw Error('没有确定灵感时不能分享');
  if(out.inspiration==='present'&&!out.idea.trim())throw Error('缺少具体灵感');
  if(out.decision==='share'&&(!out.idea.trim()||(out.medium==='generated_image'&&!out.prompt.trim())))throw Error('缺少具体画面');
  out.delayMinutes=Math.max(drawingMinimumIntervalMinutes,out.delayMinutes);
  out.windowEndMinutes=v.windowEndMinutes??Math.min(1440,out.delayMinutes+30);
  out.skipToday=v.skipToday??false;
  if(!Number.isInteger(out.windowEndMinutes)||out.windowEndMinutes<out.delayMinutes+15||out.windowEndMinutes>1440||typeof out.skipToday!=='boolean')throw Error('画画时间窗口无效');
  return out;
}
export class DrawingInspiration{
  constructor(engine,{generate=googleStructured,review=googleStructured,activity=qqDayActivity}={}){this.engine=engine;this.generate=generate;this.review=review;this.activity=activity;this.lastActivityScan=0;this.record=engine.read('drawing-inspiration.json',{version:1,items:[]});if(this.record.version!==1||!Array.isArray(this.record.items)){engine.backup('drawing-inspiration.json');this.record={version:1,items:[]};}const last=this.record.lastJudgmentAt??Math.max(this.record.lastOccasion?.at||0,...this.record.items.map(x=>x.updatedAt||x.createdAt||0));if(last&&!this.record.nextJudgmentAt){this.record.lastJudgmentAt=last;this.record.nextJudgmentAt=last+drawingMinimumIntervalMinutes*60000;this.save();}const template=engine.allTemplates().find(x=>x.id==='drawing-inspiration');const end=Math.max(0,...[...engine.state.active,...engine.history.events].filter(x=>x.templateId==='drawing-inspiration').map(x=>x.endsAt||0));if(template&&end){const until=end+template.cooldownHours*3600000;if(until>(engine.state.cooldowns['drawing-inspiration']||0)){engine.state.cooldowns['drawing-inspiration']=until;engine.persist();}}engine.drawingInspiration=this;this.busy=null;this.disposed=false;}
  async audit(candidate,event){
    const value=await this.review('审核画画灵感候选并输出同结构JSON。只审核，不扮演岑舒。inspiration与decision分别表示灵感是否发生和是否愿意分享，必须独立保留；有providedEvent时灵感已经发生，inspiration为present。不分享不能改成没有灵感。保留艺术画面、媒介判断、是否分享和时间建议。画画灵感本身就是岑舒角色生活中发生的事，可以自然表述为她想到、留意到、想画或想分享的日常，不必在idea里机械添加“构想/想象/虚构”标签，更不要把她的生活全改成假设。已有角色生活记录可以作来源；缺少来源时保留灵感本身，不额外补造下班吃饭、出行等完整前置经历。providedEvent记录的是角色生活，不是青枔现实；不要把日程倾向写成必然完成，也不能把画作冒充手机照片、摄像头实拍或真实文件内容。发现核心内容无法安全保留时改为uncertain，不用关键词机械判定。不能添加来源、修改人物身份、扩大权限或输出工具指令。',schema,{candidate,providedEvent:event?{name:event.name,stageText:event.stageText}:null,characterLifeEvents:this.engine.state.active.map(x=>({name:x.name,stageText:x.stageText})),roleLifeIsValidContext:true,realWorldCaptureEvidence:[],scheduleIsNotEvidence:true},this.engine.config,{signal:AbortSignal.timeout(60000),maxOutputTokens:1800,temperature:0});
    return validateDrawingChoice(value);
  }
  save(){this.record.items=this.record.items.slice(-100);this.engine.write('drawing-inspiration.json',this.record);}
  applyIdea(event,choice){
    if(!choice.idea?.trim()||!event.stages?.length)return;
    event.stages[0].text=choice.idea;
    if(event.stage===0)event.stageText=choice.idea;
    for(const item of this.engine.moodEvents.events)if(item.eventId===event.id&&item.phase==='start')item.stageText=choice.idea;
    this.engine.write('mood-events.json',this.engine.moodEvents);this.engine.persist();
  }
  enabled(){return this.engine.config.enabled&&this.engine.config.semanticEnabled&&this.engine.config.context;}
  day(){return this.record.days?.[clock(this.engine.now(),this.engine.config.timezone).date]||null;}
  syncDay(){const e=this.engine,now=e.now(),date=clock(now,e.config.timezone).date;if(now-this.lastActivityScan<30000)return this.day();this.lastActivityScan=now;
    let rows;try{rows=this.activity(e.home,e.config.sessionIds,now,e.config.timezone)||[];this.activityHealth=rows.health||{ready:true,code:'injected',message:'活动数据源已连接'};}catch{this.activityHealth={ready:false,code:'error',message:'QQ 活动数据源读取失败'};return this.day();}
    if(!this.activityHealth.ready||this.day())return this.day();const first=rows[0];if(!first)return null;
    this.record.days||={};const carry=Object.values(this.record.days).filter(x=>x.status==='scheduled'&&x.nextAt>now&&clock(x.nextAt,e.config.timezone).date===date).sort((a,b)=>a.nextAt-b.nextAt)[0];this.record.days[date]={date,firstMessageAt:first.at,messageId:first.messageId,direction:first.direction,sessionId:first.sessionId,status:'pending'};if(carry)Object.assign(this.record.days[date],{status:'scheduled',nextAt:carry.nextAt,window:carry.window,reason:carry.reason,carriedFrom:carry.date});
    this.record.days=Object.fromEntries(Object.entries(this.record.days).sort().slice(-7));this.save();return this.day();}
  applyTiming(value,now=this.engine.now(),selectedAt){const e=this.engine,day=this.day();const next=selectedAt??pickDrawingTime(now,Math.max(60,value.delayMinutes??value.startMinutes),value.windowEndMinutes??value.endMinutes,e.random,e.config.timezone);
    if(day){day.status=value.skipToday?'paused':'scheduled';day.reason=String(value.reason||'').slice(0,200);day.window={from:now+Math.max(60,value.delayMinutes??value.startMinutes)*60000,to:now+(value.windowEndMinutes??value.endMinutes)*60000};day.nextAt=value.skipToday?null:next;}
    this.record.nextOccasionAt=value.skipToday?null:next;return next;}
  recentActivity(){const e=this.engine;return (this.activity(e.home,e.config.sessionIds,e.now(),e.config.timezone)||[]).slice(-8).map(x=>({at:x.at,direction:x.direction,text:x.text||''}));}
  async scheduleDay(day){const e=this.engine;if(e.now()<(day.retryAt||0))return;day.status='planning';day.retryAt=e.now()+60*60000;this.save();try{
    const value=await this.generate(drawingSchedulePrompt,drawingScheduleSchema,{purpose:'drawing-day-schedule',persona:{name:e.profile.name,generalStyle:String(e.profile.generalStyle||'').slice(0,1000),background:String(e.profile.background||'').slice(0,500)},recentMessages:this.recentActivity(),dayStart:day.firstMessageAt,now:e.now(),life:e.life(),events:e.state.active.map(x=>({name:x.name,stage:x.stageText})),mood:readMood(e.home,e.config,e.config.sessionIds[0],e.now()),conversationFocus:e.memorySelectionTopic||'',recent:this.record.items.slice(-5).map(x=>({idea:x.idea,status:x.status}))},e.config,{signal:AbortSignal.timeout(60000),maxOutputTokens:700,temperature:.8});
    if(this.disposed||!this.enabled()||this.day()!==day)return;
    if(typeof value?.skipToday!=='boolean'||typeof value.reason!=='string'||value.reason.length>200||!Number.isInteger(value.startMinutes)||!Number.isInteger(value.endMinutes)||value.endMinutes<value.startMinutes+15)throw Error('画画时间窗口无效');
    this.applyTiming(value);day.plannedAt=e.now();
  }catch(error){if(this.disposed)return;day.status='pending';day.retryAt=e.now()+60*60000;day.error='时间规划暂不可用，稍后重试';}this.save();}
  awake(){const hour=Number(clock(this.engine.now(),this.engine.config.timezone).hour);return hour>=6&&hour<23;}
  reserveJudgment(){const now=this.engine.now();if(!this.awake()||now<(this.record.nextJudgmentAt||0))return false;this.record.lastJudgmentAt=now;this.record.nextJudgmentAt=now+drawingMinimumIntervalMinutes*60000;this.save();return true;}
  settleRejudgments(row){if((row.rejudgments||0)>=drawingMaximumRejudgments&&['defer','uncertain'].includes(row.status)){Object.assign(row,{status:'skip',decision:'skip',closureReason:'已达到3次重判上限，留给自己，不再自动追问',nextAttemptAt:null});return true;}return false;}
  candidates(){const e=this.engine,now=e.now();return [...e.state.active,...e.history.events.filter(x=>now-(x.endedAt||x.startedAt)<86400000)].filter(x=>x.templateId==='drawing-inspiration');}
  async tick(){
    if(this.disposed||!this.enabled()||!this.engine.config.sessionIds.length)return;
    this.syncDay();
    if(this.busy)return this.busy;
    let settled=false;for(const row of this.record.items)settled=this.settleRejudgments(row)||settled;if(settled)this.save();
    const now=this.engine.now();if(!this.awake()||now<(this.record.nextJudgmentAt||0))return;
    for(const row of this.record.items)if(row.status==='generating'&&row.leaseUntil<=now){row.status='error';row.error='上次生成未完成';row.nextAttemptAt=now+15*60000;this.save();}
    const event=this.candidates().find(event=>{const row=this.record.items.find(x=>x.eventId===event.id);return !row||(['defer','uncertain','error'].includes(row.status)&&now>=row.nextAttemptAt&&now<row.eventExpiresAt);});
    if(!event){
      const day=this.syncDay();if(this.activityHealth?.ready===false||!day||day.status==='paused')return;
      const template=this.engine.allTemplates().find(x=>x.id==='drawing-inspiration'),c=clock(now,this.engine.config.timezone);
      if(!template||this.engine.state.active.length>=this.engine.config.maxActive||(this.engine.state.daily[c.date]||0)>=this.engine.config.maxDaily||!this.engine.eligible(template,c,now))return;
      if(['pending','planning'].includes(day.status)){this.busy=this.scheduleDay(day).finally(()=>{this.busy=null;});return this.busy;}
      if(now<(day.nextAt||Infinity))return;
      this.busy=this.consider().finally(()=>{this.busy=null;});return this.busy;
    }
    this.busy=this.plan(event).finally(()=>{this.busy=null;});return this.busy;
  }
  async consider(){
    const day=this.syncDay();if(this.activityHealth?.ready===false||!day||day.status==='paused'||day.status!=='scheduled'||this.engine.now()<(day.nextAt||Infinity))return;
    if(!this.reserveJudgment())return;
    const e=this.engine,signature=JSON.stringify([e.profile,e.config]);
    try{
      const raw=validateDrawingChoice(await this.generate(drawingPrompt+' 现在还没有发生这次画画灵感。请先判断此刻是否自然产生画面灵感并值得形成一个生活事件；inspiration=present就创建事件，与decision是否分享无关；absent或uncertain才不创建事件。由你决定当天是否继续考虑（skipToday），并用delayMinutes/windowEndMinutes安排距现在60至1440分钟的随机窗口，不为了输出而硬造灵感。',{...schema},{proposedEvent:'画画灵感',recentMessages:this.recentActivity(),life:e.life(),weather:e.weatherSummary(),profile:e.profile,mood:readMood(e.home,e.config,e.config.sessionIds[0],e.now()),conversationFocus:e.memorySelectionTopic||'',recent:this.record.items.slice(-6).map(x=>({idea:x.idea,status:x.status,medium:x.medium}))},e.config,{signal:AbortSignal.timeout(60000),maxOutputTokens:1800,temperature:.8}));
      const value=await this.audit(raw,null);
      if(this.disposed||!this.enabled()||!this.awake()||signature!==JSON.stringify([e.profile,e.config]))return;
      const nextAttemptAt=this.applyTiming(value);this.record.lastOccasion={...value,at:e.now(),model:e.config.semanticModel};this.record.occasionFailures=0;
      if(value.inspiration==='present'){
        // An ordinary draw may have created the same event while Gemini was running.
        const existing=e.state.active.find(x=>x.templateId==='drawing-inspiration');
        if(existing&&this.record.items.some(x=>x.eventId===existing.id)){this.save();return;}
        const template=e.allTemplates().find(x=>x.id==='drawing-inspiration'),now=e.now(),c=clock(now,e.config.timezone);
        if(!existing&&(!template||!e.eligible(template,c,now)||e.state.active.length>=e.config.maxActive||(e.state.daily[c.date]||0)>=e.config.maxDaily)){this.save();return;}
        const event=existing||e.add('drawing-inspiration');
        this.applyIdea(event,value);
        this.record.items.push({...value,eventId:event.id,name:event.name,rejudgments:0,status:value.decision==='share'?'ready':value.decision,nextAttemptAt,createdAt:now,updatedAt:now,model:e.config.semanticModel,eventExpiresAt:now+86400000,expiresAt:now+value.validMinutes*60000});
      }
    }catch(error){if(this.disposed)return;this.record.occasionFailures=(this.record.occasionFailures||0)+1;this.record.nextOccasionAt=e.now()+([400,401,403,404].includes(error.httpStatus)?1440:[15,60,360][Math.min(2,this.record.occasionFailures-1)])*60000;if(this.day())this.day().nextAt=this.record.nextOccasionAt;this.record.lastOccasion={status:'error',error:String(error.message).slice(0,250),at:e.now()};}
    this.save();
  }
  async plan(event){
    const saved=this.record.items.find(x=>x.eventId===event.id);if(saved&&(this.settleRejudgments(saved)||!['defer','uncertain','error'].includes(saved.status))){this.save();return;}
    if(!this.reserveJudgment())return;
    const e=this.engine,now=e.now(),previous=this.record.items.find(x=>x.eventId===event.id),row=previous?structuredClone(previous):{eventId:event.id,name:event.name,createdAt:now,eventExpiresAt:now+86400000};
    const priorStatus=previous?.status;
    const signature=JSON.stringify([e.profile,e.config.semanticModel,e.config.sessionIds]);
    try{
      const raw=validateDrawingChoice(await this.generate(drawingPrompt,schema,{event,recentMessages:this.recentActivity(),life:e.life(),weather:e.weatherSummary(),profile:e.profile,mood:readMood(e.home,e.config,e.config.sessionIds[0],now),conversationFocus:e.memorySelectionTopic||'',recent:this.record.items.filter(x=>x.eventId!==row.eventId).slice(-6).map(x=>({idea:x.idea,medium:x.medium,status:x.status})),previous:previous?{decision:previous.decision,reason:previous.reason}:null},e.config,{signal:AbortSignal.timeout(60000),maxOutputTokens:1800,temperature:.8}));
      const value=await this.audit(raw,event);
      if(value.inspiration!=='present')throw Error('已有灵感事件不能被分享判断撤销');
      if(this.disposed||!this.enabled()||!this.awake()||signature!==JSON.stringify([e.profile,e.config.semanticModel,e.config.sessionIds])||this.record.items.find(x=>x.eventId===event.id)?.status!==priorStatus)return;
      const nextAttemptAt=pickDrawingTime(e.now(),value.delayMinutes,value.windowEndMinutes,e.random,e.config.timezone);
      Object.assign(row,value,{rejudgments:previous?(previous.rejudgments||0)+1:0,status:value.decision==='share'?'ready':value.decision,model:e.config.semanticModel,updatedAt:e.now(),expiresAt:Math.min(row.eventExpiresAt,e.now()+value.validMinutes*60000),initiativeClaimedAt:null,nextAttemptAt,error:''});
      if(this.day()&&this.day().status!=='paused')this.applyTiming(value,e.now(),nextAttemptAt);
      this.settleRejudgments(row);
      this.applyIdea(event,value);
    }catch(error){if(this.disposed)return;row.failures=(row.failures||0)+1;const configuration=[400,401,403,404].includes(error.httpStatus);Object.assign(row,{status:configuration?'failed':'error',error:String(error.message).slice(0,250),nextAttemptAt:e.now()+[15,60,360][Math.min(2,row.failures-1)]*60000});}
    const index=this.record.items.findIndex(x=>x.eventId===row.eventId);if(index<0)this.record.items.push(row);else this.record.items[index]=row;
    this.save();
  }
  view(){const now=this.engine.now();return {enabled:this.enabled(),model:this.engine.config.semanticModel,awakeHours:[6,23],minimumIntervalMinutes:drawingMinimumIntervalMinutes,maximumRejudgments:drawingMaximumRejudgments,nextJudgmentAt:this.record.nextJudgmentAt||null,nextOccasionAt:this.record.nextOccasionAt||null,activityHealth:structuredClone(this.activityHealth||{ready:false,code:'pending',message:'等待 QQ bridge 生活接口检测'}),day:structuredClone(this.day()),lastOccasion:structuredClone(this.record.lastOccasion||null),items:structuredClone(this.record.items.slice(-20).reverse()),eligible:structuredClone(this.record.items.filter(x=>x.status==='ready'&&x.expiresAt>now&&x.eventExpiresAt>now))};}
  row(id){const row=this.record.items.find(x=>x.eventId===id);if(!row)throw Error('画画灵感不存在');return row;}
  claimInitiative(id){if(!this.enabled())throw Error('画画灵感已暂停');const row=this.row(id),now=this.engine.now();if(row.status!=='ready'||row.expiresAt<=now||row.eventExpiresAt<=now||row.initiativeClaimedAt)return {claimed:false};row.initiativeClaimedAt=now;this.save();return {claimed:true,idea:row.idea,medium:row.medium};}
  begin(id){if(!this.enabled())throw Error('画画灵感已暂停');const row=this.row(id),now=this.engine.now();if(row.status!=='ready'||row.expiresAt<=now||row.eventExpiresAt<=now)throw Error('灵感已处理、忙碌或过期，不重复生成');if(row.medium!=='generated_image')throw Error('当前灵感未选择生图');row.status='generating';row.leaseUntil=now+5*60000;this.save();return {prompt:row.prompt,idea:row.idea};}
  result({eventId,status,captureId,messageId,error}){const row=this.row(eventId),now=this.engine.now();if(status==='prepared'){if(row.status!=='generating'||typeof captureId!=='string'||!captureId)throw Error('生成回执无效');Object.assign(row,{status:'prepared',captureId,captureExpiresAt:now+5*60000});}else if(status==='sent'){if(row.status!=='prepared'||row.captureId!==captureId||messageId==null||String(messageId)==='')throw Error('发送回执无效');Object.assign(row,{status:'sent',messageId:String(messageId),sentAt:now});}else if(status==='shared'){if(row.status!=='ready'||row.medium==='generated_image'||messageId==null||String(messageId)==='')throw Error('媒介分享回执无效');Object.assign(row,{status:'sent',messageId:String(messageId),sentAt:now});}else if(status==='failed'){if(row.status==='sent')return this.view();Object.assign(row,{status:'error',error:String(error||'生成失败').slice(0,200),nextAttemptAt:now+15*60000});}else if(status==='skip'){if(row.status==='sent')throw Error('已发送的灵感不可撤回');row.status='skip';}else throw Error('未知灵感回执');this.save();return this.view();}
  context(){if(!this.enabled())return '';const v=this.view(),current=v.eligible.slice(-2);return current.length?'\n【Gemini 判断的画画灵感与媒介】'+JSON.stringify(current)+'。这是岑舒生活中已发生的灵感事件，可以自然接成她的日常话题，不必反复向青枔解释构想或虚构。图画按图画分享，不冒充手机实拍。可直接按当前意愿分享，无需再等用户要求。generated_image 时用 qq_generate_image(eventId=对应事件ID,prompt=灵感里的prompt) 生成，先实际看图，再用 qq_send_generated_image(captureId) 发送；语音、表情或文字按 medium 自然选择。发送前重新结合当前话题与用户意愿，允许不发送，不固定补一句说明，不编造已经发出。沿用现有主动机会和共享冷却，不重复同一事件。不想分享时用 qq_life_inspiration(action="skip",eventId) 标记；用非生图媒介完成实际发送后，用 action="complete" 携带 messageId 保存回执，未发出不能标记完成。':'';}
}
// Read-only bridge view: no model calls, no claim and no writes during polling.
export function drawingOpportunity(home,sessionId,now=Date.now()){
  try{const config=JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life/config.json'),'utf8'));if(!config.enabled||!config.context||!config.semanticEnabled||!config.sessionIds?.some(s=>String(s).replace(/^session-/,'')===String(sessionId).replace(/^session-/,'')))return null;const record=JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life/drawing-inspiration.json'),'utf8'));return record.items?.find(x=>x.status==='ready'&&!x.initiativeClaimedAt&&x.expiresAt>now&&x.eventExpiresAt>now)||null;}catch{return null;}
}
