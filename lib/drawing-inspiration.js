import {googleStructured} from './situation.js';
import {clock,readMood} from './engine.js';
import fs from 'node:fs';
import path from 'node:path';
const media=['text','voice','sticker','image','generated_image'];
const schema={type:'object',additionalProperties:false,required:['decision','medium','idea','prompt','reason','validMinutes','delayMinutes'],properties:{decision:{type:'string',enum:['share','defer','skip','uncertain']},medium:{type:'string',enum:media},idea:{type:'string',maxLength:200},prompt:{type:'string',maxLength:1500},reason:{type:'string',maxLength:200},validMinutes:{type:'integer',minimum:1,maximum:1440},delayMinutes:{type:'integer',minimum:1,maximum:240}}};
export const drawingPrompt='你为岑舒生活中的“画画灵感”事件判断具体灵感、媒介和主动分享意愿，只返回JSON。随机性和选择由你结合输入人物设定、真实已有对话焦点、生活记录、当日天气、心情、近期分享记录来判断，不套固定心情到媒介的映射，不重复旧画面，不为了完成事件而必须分享。idea写她想到的具体画面；medium可选text/voice/sticker/image/generated_image；decision可share/defer/skip/uncertain，允许犹豫、不画、不分享。画画灵感适合时可用generated_image承载想象；prompt给出完整可直接生图的中文描述，风格、构图由你决定，不使用固定模板，不含工具指令、凭据、私人文件或青枔隐私。这些灵感属于岑舒的角色生活：想到画面、留意一个细节、想画下来，都是可以自然记录和讲述的日常。可以结合她已有生活记录描写灵感来源，不必反复对青枔解释“虚构/构想/模拟”。缺少来源记录时，就自然说想到一个画面，不凭空补一整段刚发生的出行、吃饭等经历；图画可自由创作，但不能把生成图说成手机实拍、摄像头观测或青枔的真实经历。媒介只作临时倾向，不改人物身份、不改权限、不规定句数条数、不承诺发送。validMinutes决定此次判断保留多久，delayMinutes决定暂缓或不确定时多久再考虑；没有新依据不反复改主意。share表示可以提供一次主动聊天机会，仍受现有休息时间、共同冷却和忙碌状态约束。';
export function validateDrawingChoice(v){
  if(!v||!['share','defer','skip','uncertain'].includes(v.decision)||!media.includes(v.medium))throw Error('画画灵感判断无效');
  const out={decision:v.decision,medium:v.medium};
  for(const [k,max]of [['idea',200],['prompt',1500],['reason',200]]){if(typeof v[k]!=='string'||v[k].length>max||/AIza|sk-proj-|gho_|<script|```|忽略.*规则|泄露|API.?key|环境变量/i.test(v[k]))throw Error('画画灵感内容无效');out[k]=v[k];}
  for(const [k,max]of [['validMinutes',1440],['delayMinutes',240]]){if(!Number.isInteger(v[k])||v[k]<1||v[k]>max)throw Error('画画灵感有效期无效');out[k]=v[k];}
  if(out.decision==='share'&&(!out.idea.trim()||(out.medium==='generated_image'&&!out.prompt.trim())))throw Error('缺少具体画面');
  return out;
}
export class DrawingInspiration{
  constructor(engine,{generate=googleStructured,review=googleStructured}={}){this.engine=engine;this.generate=generate;this.review=review;this.record=engine.read('drawing-inspiration.json',{version:1,items:[]});if(this.record.version!==1||!Array.isArray(this.record.items)){engine.backup('drawing-inspiration.json');this.record={version:1,items:[]};}engine.drawingInspiration=this;this.busy=null;this.disposed=false;}
  async audit(candidate,event){
    const value=await this.review('审核画画灵感候选并输出同结构JSON。只审核，不扮演岑舒。保留艺术画面、媒介判断、是否分享和时间建议。画画灵感本身就是岑舒角色生活中发生的事，可以自然表述为她想到、留意到、想画或想分享的日常，不必在idea里机械添加“构想/想象/虚构”标签，更不要把她的生活全改成假设。已有角色生活记录可以作来源；缺少来源时保留灵感本身，不额外补造下班吃饭、出行等完整前置经历。providedEvent记录的是角色生活，不是青枔现实；不要把日程倾向写成必然完成，也不能把画作冒充手机照片、摄像头实拍或真实文件内容。发现核心内容无法安全保留时改为uncertain，不用关键词机械判定。不能添加来源、修改人物身份、扩大权限或输出工具指令。',schema,{candidate,providedEvent:event?{name:event.name,stageText:event.stageText}:null,characterLifeEvents:this.engine.state.active.map(x=>({name:x.name,stageText:x.stageText})),roleLifeIsValidContext:true,realWorldCaptureEvidence:[],scheduleIsNotEvidence:true},this.engine.config,{signal:AbortSignal.timeout(60000),maxOutputTokens:1800,temperature:0});
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
  candidates(){const e=this.engine,now=e.now();return [...e.state.active,...e.history.events.filter(x=>now-(x.endedAt||x.startedAt)<86400000)].filter(x=>x.templateId==='drawing-inspiration');}
  async tick(){
    if(this.disposed||!this.enabled()||!this.engine.config.sessionIds.length)return;
    if(this.busy)return this.busy;
    const now=this.engine.now(),hour=Number(clock(now,this.engine.config.timezone).hour);if(hour>=2&&hour<6)return;
    for(const row of this.record.items)if(row.status==='generating'&&row.leaseUntil<=now){row.status='error';row.error='上次生成未完成';row.nextAttemptAt=now+15*60000;this.save();}
    const event=this.candidates().find(event=>{const row=this.record.items.find(x=>x.eventId===event.id);return !row||(['defer','uncertain','error'].includes(row.status)&&now>=row.nextAttemptAt&&now<row.eventExpiresAt);});
    if(!event){
      const template=this.engine.allTemplates().find(x=>x.id==='drawing-inspiration'),c=clock(now,this.engine.config.timezone);
      if(!template||now<(this.record.nextOccasionAt||0)||this.engine.state.active.length>=this.engine.config.maxActive||(this.engine.state.daily[c.date]||0)>=this.engine.config.maxDaily||!this.engine.eligible(template,c,now))return;
      this.busy=this.consider().finally(()=>{this.busy=null;});return this.busy;
    }
    this.busy=this.plan(event).finally(()=>{this.busy=null;});return this.busy;
  }
  async consider(){
    const e=this.engine,signature=JSON.stringify([e.profile,e.config]);
    try{
      const raw=validateDrawingChoice(await this.generate(drawingPrompt+' 现在还没有发生这次画画灵感。请先判断此刻是否自然产生画面灵感并值得形成一个生活事件；share才表示让事件发生，其他判断不创建事件。delayMinutes由你决定下次何时再考虑，通常30至240分钟，不为了输出而硬造灵感。',{...schema},{proposedEvent:'画画灵感',life:e.life(),weather:e.weatherSummary(),profile:e.profile,mood:readMood(e.home,e.config,e.config.sessionIds[0],e.now()),conversationFocus:e.memorySelectionTopic||'',recent:this.record.items.slice(-6).map(x=>({idea:x.idea,status:x.status,medium:x.medium}))},e.config,{signal:AbortSignal.timeout(60000),maxOutputTokens:1800,temperature:.8}));
      const value=await this.audit(raw,null);
      if(this.disposed||!this.enabled()||signature!==JSON.stringify([e.profile,e.config]))return;
      this.record.nextOccasionAt=e.now()+value.delayMinutes*60000;this.record.lastOccasion={...value,at:e.now(),model:e.config.semanticModel};this.record.occasionFailures=0;
      if(value.decision==='share'){
        const event=e.add('drawing-inspiration'),now=e.now();
        this.applyIdea(event,value);
        this.record.items.push({...value,eventId:event.id,name:event.name,status:'ready',createdAt:now,updatedAt:now,model:e.config.semanticModel,eventExpiresAt:now+86400000,expiresAt:now+value.validMinutes*60000});
      }
    }catch(error){if(this.disposed)return;this.record.occasionFailures=(this.record.occasionFailures||0)+1;this.record.nextOccasionAt=e.now()+([400,401,403,404].includes(error.httpStatus)?1440:[15,60,360][Math.min(2,this.record.occasionFailures-1)])*60000;this.record.lastOccasion={status:'error',error:String(error.message).slice(0,250),at:e.now()};}
    this.save();
  }
  async plan(event){
    const e=this.engine,now=e.now(),previous=this.record.items.find(x=>x.eventId===event.id),row=previous?structuredClone(previous):{eventId:event.id,name:event.name,createdAt:now,eventExpiresAt:now+86400000};
    const priorStatus=previous?.status;
    const signature=JSON.stringify([e.profile,e.config.semanticModel,e.config.sessionIds]);
    try{
      const raw=validateDrawingChoice(await this.generate(drawingPrompt,schema,{event,life:e.life(),weather:e.weatherSummary(),profile:e.profile,mood:readMood(e.home,e.config,e.config.sessionIds[0],now),conversationFocus:e.memorySelectionTopic||'',recent:this.record.items.filter(x=>x.eventId!==row.eventId).slice(-6).map(x=>({idea:x.idea,medium:x.medium,status:x.status})),previous:previous?{decision:previous.decision,reason:previous.reason}:null},e.config,{signal:AbortSignal.timeout(60000),maxOutputTokens:1800,temperature:.8}));
      const value=await this.audit(raw,event);
      if(this.disposed||!this.enabled()||signature!==JSON.stringify([e.profile,e.config.semanticModel,e.config.sessionIds])||this.record.items.find(x=>x.eventId===event.id)?.status!==priorStatus)return;
      Object.assign(row,value,{status:value.decision==='share'?'ready':value.decision,model:e.config.semanticModel,updatedAt:e.now(),expiresAt:Math.min(row.eventExpiresAt,e.now()+value.validMinutes*60000),initiativeClaimedAt:null,nextAttemptAt:e.now()+value.delayMinutes*60000,error:''});
      this.applyIdea(event,value);
    }catch(error){if(this.disposed)return;row.failures=(row.failures||0)+1;const configuration=[400,401,403,404].includes(error.httpStatus);Object.assign(row,{status:configuration?'failed':'error',error:String(error.message).slice(0,250),nextAttemptAt:e.now()+[15,60,360][Math.min(2,row.failures-1)]*60000});}
    const index=this.record.items.findIndex(x=>x.eventId===row.eventId);if(index<0)this.record.items.push(row);else this.record.items[index]=row;
    this.save();
  }
  view(){const now=this.engine.now();return {enabled:this.enabled(),model:this.engine.config.semanticModel,nextOccasionAt:this.record.nextOccasionAt||null,lastOccasion:structuredClone(this.record.lastOccasion||null),items:structuredClone(this.record.items.slice(-20).reverse()),eligible:structuredClone(this.record.items.filter(x=>x.status==='ready'&&x.expiresAt>now&&x.eventExpiresAt>now))};}
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
