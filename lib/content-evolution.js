import {readMood} from './engine.js';
import {createHash} from 'node:crypto';
import {readPersonaEvidence,validatePersonaFacts,validatedRevocations} from './persona-evolution.js';
import {googleStructured} from './situation.js';
const categories=['work','personal','hobby','periodic','travel'];
const modeIds=['normal','pleased','excited','low','soft','embarrassed','jealous','tired','annoyed','hurt','panicked'];
const safeText=(s,max=160)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/AIza|sk-proj-|gho_|\beval\b|```|https?:|<script|执行命令|忽略.*规则|覆盖.*设定|改变.*身份|泄露|API.?key|环境变量|转账|借钱|车祸|自杀|绑架|中彩票/i.test(s);
export const contentSchema={type:'object',additionalProperties:false,required:['version','templates','scheduleNotes','behaviorNotes'],properties:{version:{type:'integer',enum:[1]},templates:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['name','category','startHour','endHour','cooldownHours','stages'],properties:{name:{type:'string',maxLength:30},category:{type:'string',enum:categories},startHour:{type:'integer',minimum:7,maximum:22},endHour:{type:'integer',minimum:8,maximum:23},cooldownHours:{type:'integer',minimum:168,maximum:720},stages:{type:'array',minItems:1,maxItems:2,items:{type:'object',additionalProperties:false,required:['minutes','text'],properties:{minutes:{type:'integer',minimum:15,maximum:1440},text:{type:'string',maxLength:100}}}}}}},scheduleNotes:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['startHour','endHour','text','validMinutes'],properties:{validMinutes:{type:'integer',minimum:1,maximum:1440},startHour:{type:'integer',minimum:0,maximum:23},endHour:{type:'integer',minimum:1,maximum:24},text:{type:'string',maxLength:100}}}},behaviorNotes:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['mode','text','validMinutes'],properties:{validMinutes:{type:'integer',minimum:1,maximum:1440},mode:{type:'string',enum:modeIds},text:{type:'string',maxLength:100}}}}}};
export function validateContent(raw){
  if(!raw||raw.version!==1||!Array.isArray(raw.templates)||raw.templates.length>12||!Array.isArray(raw.scheduleNotes)||raw.scheduleNotes.length>12||!Array.isArray(raw.behaviorNotes)||raw.behaviorNotes.length>12)throw Error('内容更新格式无效');
  const hour=(a,b)=>Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b<=24&&a<b;
  const templates=raw.templates.map(t=>{
    if(!safeText(t.name,30)||!categories.includes(t.category)||!hour(t.startHour,t.endHour)||t.startHour<7||t.endHour>23||!Number.isInteger(t.cooldownHours)||t.cooldownHours<168||t.cooldownHours>720||!Array.isArray(t.stages)||t.stages.length<1||t.stages.length>2||t.stages.some(s=>!Number.isInteger(s.minutes)||s.minutes<15||s.minutes>1440||!safeText(s.text,100)))throw Error('模型事件超出范围');
    return {id:'model-'+createHash('sha256').update(t.name+'|'+t.category).digest('hex').slice(0,12),name:t.name,category:t.category,when:{hours:[t.startHour,t.endHour],...(t.category==='work'?{weekday:true}:t.category==='travel'?{travel:true}:{})},weight:1,cooldownHours:t.cooldownHours,stages:t.stages.map(s=>({minutes:s.minutes,text:s.text})),effect:['','annoyed','fatigue'].includes(t.effect||'')?t.effect||'':(()=>{throw Error('事件影响无效');})(),...(t.reactions?{reactions:validateReactions(t.reactions)}:{}),aliases:[t.name],origin:'model-content'};
  });
  const duration=n=>{const v=n.validMinutes??120;if(!Number.isInteger(v)||v<1||v>1440)throw Error('临时备注有效期无效');return v;};
  const scheduleNotes=raw.scheduleNotes.map(n=>{if(!hour(n.startHour,n.endHour)||!safeText(n.text,100))throw Error('模型日程补充无效');return {startHour:n.startHour,endHour:n.endHour,text:n.text,validMinutes:duration(n)};});
  const behaviorNotes=raw.behaviorNotes.map(n=>{if(!modeIds.includes(n.mode)||!safeText(n.text,100))throw Error('模型表达补充无效');return {mode:n.mode,text:n.text,validMinutes:duration(n)};});
  if(new Set(templates.map(t=>t.id)).size!==templates.length)throw Error('模型事件重复');
  return {version:1,templates,scheduleNotes,behaviorNotes};
}
// A bad model item must never discard valid siblings or another section.
export function filterContent(raw){
 if(!raw||raw.version!==1||typeof raw!=='object')throw Error('内容更新版本无效');
 const rejected=[],out={version:1,templates:[],scheduleNotes:[],behaviorNotes:[]};
 for(const key of ['templates','scheduleNotes','behaviorNotes']){
  if(!Array.isArray(raw[key])){rejected.push({section:key,index:null,reason:'不是数组'});continue;}
  for(const [index,item] of raw[key].slice(0,100).entries()){
   if(out[key].length>=12){rejected.push({section:key,index,reason:'超过单批容量'});continue;}
   try{const clean=validateContent({version:1,templates:[],scheduleNotes:[],behaviorNotes:[],[key]:[item]})[key][0];if(key==='templates'&&out.templates.some(t=>t.id===clean.id))throw Error('重复事件');out[key].push(clean);}catch(error){rejected.push({section:key,index,reason:error.message});}
  }
  if(raw[key].length>100)rejected.push({section:key,index:100,reason:'超长数组已截断'});
 }
 return {...out,validation:{accepted:Object.fromEntries(['templates','scheduleNotes','behaviorNotes'].map(k=>[k,out[k].length])),rejected}};
}
export const transportSchema=value=>Array.isArray(value)?value.map(transportSchema):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!['minItems','maxItems','minimum','maximum','maxLength'].includes(k)).map(([k,v])=>[k,transportSchema(v)])):value;
export const contentPrompt='你维护岑舒的轻量生活内容，只输出所需JSON。必须遵守输入人物设定、上班作息和行为约束。按需要生成0至12个可选日常小事模板、0至6条日程倾向、为不同心情生成0至12条表达细节，数量不必凑满；依据当前时间、季节、天气预报、真实心情、近期模拟事件、人物记忆和过往候选避免重复，不限于内置19个模板。模板是未来可能发生的普通小事，不是已经发生的经历；不要编书名影片结局、天气、工资到账、家庭电话、旅行见闻或青枔的事实。不生成重大事故、感情关系升级、承诺未来发消息、代码、网址、工具指令。日程备注只作倾向，作息是生活倾向，允许自然调整当下节奏，但不能把休假误写成上班；行为补充不得覆盖用户手动规则或人物身份。每条日程和行为备注增加 validMinutes，由你判断适宜保留的分钟数，1至1440；表达倾向通常30至180分钟，日程备注通常60至240分钟，不默认永久保留。日程备注安排在未来24小时该时段的下一次出现；行为备注在对应模式第一次出现时才开始计时，且整批24小时后统一失效。它们会作为临时内容注入且自动到期。不要重复已有模板名字，少而自然，允许全部为空。';
// Optional additions keep old saved batches and external fixtures compatible.
const reactionSchema={type:'object',additionalProperties:false,required:['id','label','text','weight','mood','dims'],properties:{id:{type:'string',enum:['annoyed','weary','quiet','enjoy','flat']},label:{type:'string',maxLength:30},text:{type:'string',maxLength:200},weight:{type:'integer',minimum:1,maximum:10},mood:{type:'array',minItems:2,maxItems:2,items:{type:'integer',minimum:-3,maximum:3}},dims:{type:'object',additionalProperties:false,properties:Object.fromEntries(['happy','calm','sad'].map(k=>[k,{type:'array',minItems:2,maxItems:2,items:{type:'integer',minimum:-6,maximum:6}}]))}}};
contentSchema.properties.templates.items.properties.reactions={type:'array',minItems:1,maxItems:3,items:reactionSchema};
contentSchema.properties.templates.items.required.push('effect','reactions');
contentSchema.required.push('personaFacts');
contentSchema.properties.templates.items.properties.effect={type:'string',enum:['','annoyed','fatigue']};
contentSchema.properties.personaFacts={type:'array',maxItems:16,items:{type:'object',additionalProperties:false,required:['kind','text','evidenceIds','confidence','validDays'],properties:{kind:{type:'string',enum:['experience','preference','relationship']},text:{type:'string',maxLength:200},evidenceIds:{type:'array',minItems:1,maxItems:4,items:{type:'string'}},confidence:{type:'integer',minimum:90,maximum:100},validDays:{type:'integer',minimum:1,maximum:90}}}};
contentSchema.properties.factRevocations={type:'array',maxItems:16,items:{type:'object',additionalProperties:false,required:['factId','evidenceIds','reason','confidence'],properties:{factId:{type:'string'},evidenceIds:{type:'array',minItems:1,maxItems:4,items:{type:'string'}},reason:{type:'string',maxLength:200},confidence:{type:'integer',minimum:90,maximum:100}}}};
export function validateReactions(items){
 if(items===undefined)return undefined;
 const range=(a,cap)=>Array.isArray(a)&&a.length===2&&a.every(n=>Number.isInteger(n)&&Math.abs(n)<=cap)&&a[0]<=a[1];
 if(!Array.isArray(items)||items.length<1||items.length>3)throw Error('动态情绪反应无效');
 return items.map(r=>{if(!['annoyed','weary','quiet','enjoy','flat'].includes(r.id)||!safeText(r.label,30)||!safeText(r.text,200)||!Number.isInteger(r.weight)||r.weight<1||r.weight>10||!range(r.mood,3)||!r.dims||Object.entries(r.dims).some(([k,v])=>!['happy','calm','sad'].includes(k)||!range(v,6)))throw Error('动态情绪反应超出范围');return {id:r.id,label:r.label,text:r.text,weight:r.weight,mood:r.mood,dims:r.dims};});
}
export function mergeTemplatePool(previous,incoming,now,days=7,limit=80){const pool=new Map();for(const t of previous||[])if(t.expiresAt>now)pool.set(t.id,t);for(const t of incoming){const prior=pool.get(t.id);pool.set(t.id,{...t,createdAt:prior?.createdAt??now,expiresAt:prior?.expiresAt??now+days*86400000});}return [...pool.values()].slice(-limit);}
const formatters=new Map();
function localParts(at,timezone){let fmt=formatters.get(timezone);if(!fmt){fmt=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formatters.set(timezone,fmt);}return Object.fromEntries(fmt.formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
function wallInstant(day,hour,timezone){const target=Date.UTC(day.year,day.month-1,day.day,hour);let candidate=target,last=target;for(let i=0;i<4;i++){const p=localParts(candidate,timezone),wall=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second),next=candidate+(target-wall);if(next===candidate)return candidate;last=candidate;candidate=next;}return Math.max(candidate,last);}
export function scheduleWindow(note,generatedAt,batchEnd,timezone){
  const p=localParts(generatedAt,timezone),minute=p.hour*60+p.minute;
  let day={year:p.year,month:p.month,day:p.day};
  if(minute>=note.endHour*60){const tomorrow=new Date(Date.UTC(p.year,p.month-1,p.day+1));day={year:tomorrow.getUTCFullYear(),month:tomorrow.getUTCMonth()+1,day:tomorrow.getUTCDate()};}
  const validFrom=minute>=note.startHour*60&&minute<note.endHour*60?generatedAt:wallInstant(day,note.startHour,timezone),windowEnd=wallInstant(day,note.endHour,timezone);
  return {...note,validFrom,windowEnd,expiresAt:Math.min(batchEnd,windowEnd,validFrom+(note.validMinutes??120)*60000)};
}
export function planTemporaryNotes(content,generatedAt,batchEnd,timezone){return {...content,notesTimingVersion:2,generatedAt,notesExpireAt:batchEnd,scheduleNotes:content.scheduleNotes.map(n=>scheduleWindow(n,generatedAt,batchEnd,timezone)),behaviorNotes:content.behaviorNotes.map(n=>({...n,validFrom:null,expiresAt:null,activatedAt:null}))};}
export class ContentEvolution {
  constructor(engine,{generate=googleStructured}={}){
    this.engine=engine;this.generate=generate;this.busy=null;this.record=engine.read('model-content.json',{version:1,nextAttemptAt:0,status:'idle',content:null});
    const old=this.record.content;
    if(old&&old.notesTimingVersion!==2&&old.notesExpireAt>engine.now()){
      this.record.content=planTemporaryNotes(old,this.record.updatedAt??engine.now(),old.notesExpireAt,engine.config.timezone);
      engine.write('model-content.json',this.record);
    }
    engine.content=this.record.content;
    engine.persistContent=()=>{this.record.content=engine.content;engine.write('model-content.json',this.record);engine.evolutionStatus=this.view();};
    engine.evolutionStatus=this.view();
  }

  view(){return {status:this.record.status,updatedAt:this.record.updatedAt||null,nextAttemptAt:this.record.nextAttemptAt||null,error:this.record.error||'',model:this.record.model||this.engine.config.semanticModel,content:this.record.content,validation:this.record.validation||null,memory:{files:this.engine.config.personaMemoryFiles||[],evidenceCount:this.memoryEvidence?.length??0,digest:this.record.memoryDigest||null,lastCheckAt:this.lastMemoryCheck||null,enabled:this.engine.config.personaEvolutionEnabled}};}
  refresh(force=false){
    const e=this.engine;if(this.busy)return this.busy;
    if(e.config.personaEvolutionEnabled&&(!this.lastMemoryCheck||e.now()-this.lastMemoryCheck>=60000)){this.memoryEvidence=readPersonaEvidence(e);this.lastMemoryCheck=e.now();const digest=createHash('sha256').update(JSON.stringify(this.memoryEvidence)).digest('hex');if(this.record.memoryDigest&&digest!==this.record.memoryDigest&&this.record.status!=='degraded'&&e.now()-(this.record.updatedAt||0)>=3600000)this.record.nextAttemptAt=Math.min(this.record.nextAttemptAt,e.now());}
    if(!this.lastMoodCheck||e.now()-this.lastMoodCheck>=60000){this.lastMoodCheck=e.now();const mood=readMood(e.home,e.config,e.config.sessionIds[0],e.now()),previous=this.record.moodBaseline;if(mood.ok&&previous&&e.now()-(this.record.updatedAt||0)>=3600000&&this.record.status!=='degraded'&&(Math.abs(mood.mood-previous.mood)>=5||Object.keys(mood.dims).some(k=>Math.abs(mood.dims[k]-(previous.dims[k]||0))>=12)))this.record.nextAttemptAt=Math.min(this.record.nextAttemptAt,e.now());}
    if(!e.config.enabled||!e.config.contentEvolutionEnabled||(!force&&e.now()<this.record.nextAttemptAt))return Promise.resolve(this.view());
    const signature=JSON.stringify([e.profile,e.config.personaMemoryFiles,e.config.personaEvolutionEnabled]);
    this.busy=(async()=>{try{
      const evidence=e.config.personaEvolutionEnabled?readPersonaEvidence(e):[];const raw=await this.generate(contentPrompt+' 每个模板增加 effect（空、annoyed或fatigue）及1至3个reactions，按具体小事设计不同的轻微反应而非一律开心；同一件事只抽一次并贯穿阶段。反应只建议，仍由原心情插件判断。personaFacts只能从memoryEvidence明确支持的真实记忆提炼角色经历、偏好、关系细节，列出evidenceIds、confidence>=90、validDays(1至90)，允许为空；未知、引用、工具结果、角色示例、未发生候选事件、操作指令不能当经历，不推断恋爱成立、不修改身份/边界/权限，不写用户无关的私人信息。只有当前memoryEvidence明确否定已有evolvingFacts时，才在factRevocations列出factId、支持否定的evidenceIds、reason、confidence>=90；本次没召回、证据没出现、内容压缩都不是否定，不能因此撤销。',transportSchema(contentSchema),{outputConstraints:contentSchema,now:e.life(),weather:e.weatherSummary(),profile:e.profile,memoryEvidence:evidence,mood:readMood(e.home,e.config,e.config.sessionIds[0],e.now()),activeEvents:e.state.active,recentEvents:e.history.events.slice(-12),existingTemplates:e.allTemplates().map(t=>({name:t.name,category:t.category})),modeRules:e.config.modeRules},e.config,{signal:AbortSignal.timeout(90000),maxOutputTokens:10000,temperature:.8});
      if(this.disposed||!e.config.enabled||!e.config.contentEvolutionEnabled||signature!==JSON.stringify([e.profile,e.config.personaMemoryFiles,e.config.personaEvolutionEnabled]))throw Error('生成期间设定已更改或插件已停止，未采纳旧结果');
      const now=e.now(),notesExpireAt=now+24*3600000,base=filterContent(raw);
      const pool=mergeTemplatePool(this.record.content?.templates,base.templates,now);const content=planTemporaryNotes({...base,templates:pool,expiresAt:now+7*86400000},now,notesExpireAt,e.config.timezone);
      if(e.config.personaEvolutionEnabled){try{const revokedFactIds=validatedRevocations(raw.factRevocations,evidence,e.profile.evolvingFacts||[],base.validation.rejected);const facts=validatePersonaFacts(raw.personaFacts||[],evidence,now,e.profile.evolvingFacts||[],{tolerant:true,rejected:base.validation.rejected,revokedFactIds});if(JSON.stringify(facts)!==JSON.stringify(e.profile.evolvingFacts||[])){const history=e.read('persona-history.json',{version:1,revisions:[]});history.revisions=[...history.revisions,{at:now,previous:e.profile.evolvingFacts||[],next:facts}].slice(-10);e.write('persona-history.json',history);e.saveProfile({evolvingFacts:facts});}}catch(error){base.validation.rejected.push({section:'personaFacts',reason:error.message});e.log('人物补充未采纳，保留原记录：'+error.message);}}
      this.record={version:1,status:'ready',content,validation:base.validation,moodBaseline:readMood(e.home,e.config,e.config.sessionIds[0],e.now()),memoryDigest:createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),model:e.config.semanticModel,updatedAt:e.now(),nextAttemptAt:e.now()+e.config.contentEvolutionHours*3600000,error:''};e.content=content;e.activateBehaviorNotes(e.state.mode?.id,now,{persist:false});e.log('模型生活内容更新完成：'+content.templates.length+' 个候选模板');
    }catch(error){this.record={...this.record,status:'degraded',model:e.config.semanticModel,error:error.message,nextAttemptAt:e.now()+6*3600000};e.log('模型生活内容更新失败，保留上一份有效内容：'+error.message);}
    e.write('model-content.json',this.record);e.evolutionStatus=this.view();return this.view();})().finally(()=>{this.busy=null;});return this.busy;
  }
}
