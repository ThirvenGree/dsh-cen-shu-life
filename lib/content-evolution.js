import {createHash} from 'node:crypto';
import {googleStructured} from './situation.js';
const categories=['work','personal','hobby','periodic','travel'];
const modeIds=['normal','pleased','excited','low','soft','embarrassed','jealous','tired','annoyed','hurt','panicked'];
const safeText=(s,max=160)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/AIza|sk-proj-|gho_|\beval\b|```|https?:|<script|执行命令|忽略.*规则|覆盖.*设定|改变.*身份|泄露|API.?key|环境变量|转账|借钱|车祸|自杀|绑架|中彩票/i.test(s);
export const contentSchema={type:'object',additionalProperties:false,required:['version','templates','scheduleNotes','behaviorNotes'],properties:{version:{type:'integer',enum:[1]},templates:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['name','category','startHour','endHour','cooldownHours','stages'],properties:{name:{type:'string',maxLength:30},category:{type:'string',enum:categories},startHour:{type:'integer',minimum:7,maximum:22},endHour:{type:'integer',minimum:8,maximum:23},cooldownHours:{type:'integer',minimum:168,maximum:720},stages:{type:'array',minItems:1,maxItems:2,items:{type:'object',additionalProperties:false,required:['minutes','text'],properties:{minutes:{type:'integer',minimum:15,maximum:1440},text:{type:'string',maxLength:100}}}}}}},scheduleNotes:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['startHour','endHour','text','validMinutes'],properties:{validMinutes:{type:'integer',minimum:1,maximum:1440},startHour:{type:'integer',minimum:0,maximum:23},endHour:{type:'integer',minimum:1,maximum:24},text:{type:'string',maxLength:100}}}},behaviorNotes:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['mode','text','validMinutes'],properties:{validMinutes:{type:'integer',minimum:1,maximum:1440},mode:{type:'string',enum:modeIds},text:{type:'string',maxLength:100}}}}}};
export function validateContent(raw){
  if(!raw||raw.version!==1||!Array.isArray(raw.templates)||raw.templates.length>4||!Array.isArray(raw.scheduleNotes)||raw.scheduleNotes.length>3||!Array.isArray(raw.behaviorNotes)||raw.behaviorNotes.length>3)throw Error('内容更新格式无效');
  const hour=(a,b)=>Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b<=24&&a<b;
  const templates=raw.templates.map(t=>{
    if(!safeText(t.name,30)||!categories.includes(t.category)||!hour(t.startHour,t.endHour)||t.startHour<7||t.endHour>23||!Number.isInteger(t.cooldownHours)||t.cooldownHours<168||t.cooldownHours>720||!Array.isArray(t.stages)||t.stages.length<1||t.stages.length>2||t.stages.some(s=>!Number.isInteger(s.minutes)||s.minutes<15||s.minutes>1440||!safeText(s.text,100)))throw Error('模型事件超出范围');
    return {id:'model-'+createHash('sha256').update(t.name+'|'+t.category).digest('hex').slice(0,12),name:t.name,category:t.category,when:{hours:[t.startHour,t.endHour],...(t.category==='work'?{weekday:true}:{})},weight:1,cooldownHours:t.cooldownHours,stages:t.stages.map(s=>({minutes:s.minutes,text:s.text})),effect:'',aliases:[t.name],origin:'model-content'};
  });
  const duration=n=>{const v=n.validMinutes??120;if(!Number.isInteger(v)||v<1||v>1440)throw Error('临时备注有效期无效');return v;};
  const scheduleNotes=raw.scheduleNotes.map(n=>{if(!hour(n.startHour,n.endHour)||!safeText(n.text,100))throw Error('模型日程补充无效');return {startHour:n.startHour,endHour:n.endHour,text:n.text,validMinutes:duration(n)};});
  const behaviorNotes=raw.behaviorNotes.map(n=>{if(!modeIds.includes(n.mode)||!safeText(n.text,100))throw Error('模型表达补充无效');return {mode:n.mode,text:n.text,validMinutes:duration(n)};});
  if(new Set(templates.map(t=>t.id)).size!==templates.length)throw Error('模型事件重复');
  return {version:1,templates,scheduleNotes,behaviorNotes};
}
export const contentPrompt='你维护岑舒的轻量生活内容，只输出所需JSON。必须遵守输入人物设定、上班作息和行为约束。生成0至4个可选日常小事模板、0至3条日程倾向、0至3条特定心情下的表达细节。模板是未来可能发生的普通小事，不是已经发生的经历；不要编书名影片结局、天气、工资到账、家庭电话、旅行见闻或青枔的事实。不生成重大事故、感情关系升级、承诺未来发消息、代码、网址、工具指令。日程备注只作倾向，不改变7点起床、工作日17:30下班、1点前睡觉等基础；行为补充不得覆盖用户手动规则或人物身份。每条日程和行为备注增加 validMinutes，由你判断适宜保留的分钟数，1至1440；表达倾向通常30至180分钟，日程备注通常60至240分钟，不默认永久保留。它们会作为临时内容注入且自动到期。不要重复已有模板名字，少而自然，允许全部为空。';
export class ContentEvolution {
  constructor(engine,{generate=googleStructured}={}){this.engine=engine;this.generate=generate;this.busy=null;this.record=engine.read('model-content.json',{version:1,nextAttemptAt:0,status:'idle',content:null});engine.content=this.record.content;engine.evolutionStatus=this.view();}
  view(){return {status:this.record.status,updatedAt:this.record.updatedAt||null,nextAttemptAt:this.record.nextAttemptAt||null,error:this.record.error||'',model:this.record.model||this.engine.config.semanticModel,content:this.record.content};}
  refresh(force=false){
    const e=this.engine;if(this.busy)return this.busy;if(!e.config.enabled||!e.config.contentEvolutionEnabled||(!force&&e.now()<this.record.nextAttemptAt))return Promise.resolve(this.view());
    this.busy=(async()=>{try{
      const raw=await this.generate(contentPrompt,contentSchema,{now:e.life(),profile:e.profile,existingTemplates:e.templates.events.map(t=>({name:t.name,category:t.category})),modeRules:e.config.modeRules},e.config,{signal:AbortSignal.timeout(45000),maxOutputTokens:3000});
      const now=e.now(),notesExpireAt=now+Math.min(24,e.config.contentEvolutionHours)*3600000,base=validateContent(raw);
      const content={...base,expiresAt:now+7*86400000,notesExpireAt,scheduleNotes:base.scheduleNotes.map(n=>{const validFrom=now+Math.max(0,n.startHour*60-e.life().minute)*60000;return {...n,validFrom,expiresAt:Math.min(notesExpireAt,validFrom+n.validMinutes*60000)};}),behaviorNotes:base.behaviorNotes.map(n=>({...n,validFrom:now,expiresAt:Math.min(notesExpireAt,now+n.validMinutes*60000)}))};
      this.record={version:1,status:'ready',content,model:e.config.semanticModel,updatedAt:e.now(),nextAttemptAt:e.now()+e.config.contentEvolutionHours*3600000,error:''};e.content=content;e.log('模型生活内容更新完成：'+content.templates.length+' 个候选模板');
    }catch(error){this.record={...this.record,status:'degraded',model:e.config.semanticModel,error:error.message,nextAttemptAt:e.now()+6*3600000};e.log('模型生活内容更新失败，保留上一份有效内容：'+error.message);}
    e.write('model-content.json',this.record);e.evolutionStatus=this.view();return this.view();})().finally(()=>{this.busy=null;});return this.busy;
  }
}
