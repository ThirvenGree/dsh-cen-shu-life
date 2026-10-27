import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {modes,chooseMode,defaultThresholds} from './modes.js';
export {modes,chooseMode};
const data=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
export const dims=['happy','calm','sweet','heartache','worry','sad','jealous'];
export const defaults={version:1,enabled:true,sessionIds:[],timezone:'Asia/Shanghai',checkMinutes:30,maxDaily:2,maxActive:2,probability:.22,categories:{work:true,personal:true,hobby:true,periodic:true,travel:true},context:true,moodLinked:true,moodSlot:'censhu',thresholds:defaultThresholds,modeRules:{},mentionCooldownMinutes:180,travelEnabled:false,payday:0,weather:null};
const clone=x=>structuredClone(x);
const sid=x=>String(x||'').replace(/^session-/,'');
export function validateConfig(raw={}) {
  if(raw.version!==undefined&&raw.version!==1)throw Error('不支持的配置版本');
  const c={...clone(defaults),...raw,categories:{...defaults.categories,...raw.categories},thresholds:{...defaultThresholds,...raw.thresholds}};
  new Intl.DateTimeFormat('en',{timeZone:c.timezone}).format();
  for(const k of ['enabled','context','moodLinked','travelEnabled'])if(typeof c[k]!=='boolean')throw Error(k+' 必须是布尔值');
  for(const [k,lo,hi]of[['checkMinutes',1,1440],['maxDaily',0,20],['maxActive',0,10],['probability',0,1],['mentionCooldownMinutes',1,10080],['payday',0,31]])if(!Number.isFinite(c[k])||c[k]<lo||c[k]>hi)throw Error(k+' 超出范围');
  if(!Array.isArray(c.sessionIds)||c.sessionIds.some(x=>typeof x!=='string'||x.length>200))throw Error('无效会话绑定');
  for(const v of Object.values(c.categories))if(typeof v!=='boolean')throw Error('无效事件分类');
  for(const [k,v]of Object.entries(c.thresholds))if(!Object.hasOwn(defaultThresholds,k)||!Number.isFinite(v)||v<0||v>1440)throw Error('无效阈值 '+k);
  if(typeof c.moodSlot!=='string'||!c.moodSlot||c.moodSlot.length>120)throw Error('无效心情记录');
  if(!c.modeRules||typeof c.modeRules!=='object'||Array.isArray(c.modeRules)||Object.entries(c.modeRules).some(([k,v])=>!modes[k]||typeof v!=='string'||v.length>2000))throw Error('行为规则须为模式键到文本的映射');
  if(c.weather!==null&&(!['rain','humid','hot','cold'].includes(c.weather.kind)||!Number.isFinite(c.weather.expiresAt)))throw Error('天气须由操作者注明类型及过期时间');
  return c;
}
export function clock(now,timezone='Asia/Shanghai') {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
  const minute=+p.hour*60 + +p.minute,weekend=['Sat','Sun'].includes(p.weekday);
  let activity=minute<60?'睡前放下手机':minute<420?'睡觉':minute<540?'起床、准备上班':!weekend&&minute<720?'档案馆日常工作':minute<840?'午饭与午休':!weekend&&minute<1050?'档案馆日常工作':minute<1170?'下班、回家和晚饭':minute<1380?'在家休息，看书或纪录片':'睡前休息';
  if(weekend&&minute>=540&&minute<720)activity=p.weekday==='Sat'?'周六上午，可出门或在家':'周日上午休息';
  if(weekend&&minute>=840&&minute<1050)activity='周末自由活动';
  const lunar=Object.fromEntries(new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{timeZone:timezone,month:'numeric',day:'numeric'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
  return {...p,date:`${p.year}-${p.month}-${p.day}`,minute,weekend,activity,season: +p.month>=3&&+p.month<=5?'春':+p.month<=8&&+p.month>=6?'夏':+p.month<=11&&+p.month>=9?'秋':'冬',springFestival:['正月','1'].includes(lunar.month)&&+lunar.day<=7};
}
export function readMood(home,config,sessionId) {
  try {
    const cfg=JSON.parse(fs.readFileSync(path.join(home,'feiyu-mood/config.json'),'utf8'));
    const store=JSON.parse(fs.readFileSync(path.join(home,'feiyu-mood/state.json'),'utf8'));
    if(store.version!==2||!store.moods||!Array.isArray(cfg.slots))throw Error('心情文件版本或结构不兼容');
    const slot=cfg.slots.find(x=>x.id===config.moodSlot);
    if(!slot||!(slot.sessions||[]).some(x=>sid(x)===sid(sessionId)))throw Error('目标会话与心情记录未匹配');
    const s=store.moods[slot.id];
    if(!s||!Number.isFinite(s.mood)||s.mood<0||s.mood>100||!Number.isFinite(s.updatedAt)||!Number.isFinite(s.lastConfidence)||!s.dims||dims.some(k=>!Number.isFinite(s.dims[k])||s.dims[k]<0||s.dims[k]>100))throw Error('心情数值格式无效');
    const last=(s.timeline||[]).at(-1)||{};
    return {ok:true,source:'readonly-file-v2',slot:slot.id,mood:s.mood,baseline:Number(cfg.moodBase)||70,dims:clone(s.dims),delta:last.dimsDelta||{},reason:String(s.lastReason||'').slice(0,300),confidence:s.lastConfidence,updatedAt:s.updatedAt};
  } catch(e) {return {ok:false,source:'readonly-file-v2',error:e.message};}
}
export function dialogueSignals(text='') {
  // Narrow explicit scenarios, not standalone words such as 岑舒 or a quoted script.
  if(/只读.*(?:复核|验收)|诊断|模拟测试|本机操作者|```|【测试/.test(text))return {};
  return {
    needsCare:/(?:我|今天).{0,8}(?:好累|难受|生病|发烧|撑不住|想哭|很害怕)|(?:半夜|睡不着).{0,12}想你/.test(text),
    confession:!/(?:不是|不|没)喜欢你|剧本|台词/.test(text)&&/(?:我(?:真的|认真地|认真)?喜欢你|你(?:是不是|到底|真的)喜欢我|认真.{0,6}(?:喜欢|感情))/.test(text),
    offense:/(?:你真是|你就是|你这个).{0,3}(?:废物|蠢货|垃圾)|闭嘴.{0,3}(?:烦死|恶心)/.test(text),
    flirt:!/(?:不|没)(?:好看|可爱)|台词|剧本/.test(text)&&/(?:你.{0,4}(?:好看|可爱|漂亮)|想亲你|被我说中心事)/.test(text),
    romance:/我(?:喜欢的人|暗恋的人)|我和.{1,8}(?:约会|谈恋爱)|我的(?:女朋友|男朋友)/.test(text)
  };
}
export function freshState(){return {version:1,active:[],daily:{},cooldowns:{},mode:null,lastCheck:0,life:null};}
export class LifeEngine {
  constructor({home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),random=Math.random,now=()=>Date.now()}={}) {
    this.home=home;this.dir=path.join(home,'cen-shu-life');this.random=random;this.now=now;fs.mkdirSync(this.dir,{recursive:true});
    try{this.config=validateConfig(this.read('config.json',defaults));}catch(e){this.backup('config.json');this.config=clone(defaults);this.log('配置无效，恢复默认且不绑定会话：'+e.message);this.write('config.json',this.config);}
    this.profile=this.read('profile.json',JSON.parse(fs.readFileSync(path.join(data,'profile.json'))));
    this.templates=this.read('events.json',JSON.parse(fs.readFileSync(path.join(data,'events.json'))));
    try{this.validateTemplates(this.templates);}catch(e){this.backup('events.json');this.templates=JSON.parse(fs.readFileSync(path.join(data,'events.json')));this.log('事件库无效，恢复内置模板：'+e.message);this.write('events.json',this.templates);}
    this.state=this.read('state.json',freshState());this.history=this.read('history.json',{version:1,events:[],mentions:[]});
    if(this.state.version!==1||!Array.isArray(this.state.active)||!this.state.daily||!this.state.cooldowns||this.state.active.some(e=>!e.id||!Array.isArray(e.stages)||!e.stages.length||!Number.isFinite(e.startedAt)||!Number.isFinite(e.endsAt))){this.log('状态版本或事件结构不兼容，备份后恢复默认');this.backup('state.json');this.state=freshState();}
    if(this.history.version!==1||!Array.isArray(this.history.events)||!Array.isArray(this.history.mentions)){this.backup('history.json');this.history={version:1,events:[],mentions:[]};}
    for(const [f,x]of[['config.json',this.config],['profile.json',this.profile],['events.json',this.templates]])if(!fs.existsSync(path.join(this.dir,f)))this.write(f,x);
    this.persist();
  }
  backup(f){try{fs.copyFileSync(path.join(this.dir,f),path.join(this.dir,f+'.corrupt-'+Date.now()+'.bak'));}catch{}}
  read(f,fallback){try{return JSON.parse(fs.readFileSync(path.join(this.dir,f),'utf8'));}catch(e){if(e.code!=='ENOENT'){this.log(f+' 读取失败，已保留损坏备份：'+e.message);this.backup(f);}return clone(fallback);}}
  write(f,x){const dest=path.join(this.dir,f),tmp=dest+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(x,null,2));fs.renameSync(tmp,dest);}
  log(text){const f=path.join(this.dir,'diag.log');try{if(fs.existsSync(f)&&fs.statSync(f).size>512000)fs.renameSync(f,f+'.1');fs.appendFileSync(f,new Date(this.now()).toISOString()+' '+text+'\n');}catch{}}
  persist(){this.history.events=this.history.events.slice(-300);this.history.mentions=this.history.mentions.slice(-300);this.write('history.json',this.history);this.write('state.json',this.state);}
  bound(id){return this.config.sessionIds.some(x=>sid(x)===sid(id));}
  saveConfig(patch){this.config=validateConfig({...this.config,...patch,thresholds:{...this.config.thresholds,...patch.thresholds},categories:{...this.config.categories,...patch.categories}});this.write('config.json',this.config);return this.config;}
  validateTemplates(t){if(t.version!==1||!Array.isArray(t.events))throw Error('事件库版本或结构无效');const ids=new Set();for(const e of t.events){if(!e.id||ids.has(e.id)||!e.name||!Object.hasOwn(defaults.categories,e.category)||!Array.isArray(e.stages)||!e.stages.length||e.stages.some(s=>!s.text||!Number.isFinite(s.minutes)||s.minutes<=0)||!Number.isFinite(e.weight)||e.weight<=0||!Number.isFinite(e.cooldownHours)||e.cooldownHours<0)throw Error('事件模板无效 '+e.id);ids.add(e.id);}}
  eligible(e,c,now){const r=e.when||{};return this.config.categories[e.category]&&(!r.days||r.days.includes(c.weekday))&&(!r.weekday||!c.weekend)&&(!r.hours||(+c.hour>=r.hours[0]&&+c.hour<r.hours[1]))&&(!r.seasons||r.seasons.includes(c.season))&&(!r.springFestival||c.springFestival)&&(!r.payday||(+c.day===this.config.payday&&this.config.payday>0))&&(!r.travel||this.config.travelEnabled)&&(!r.weather||(this.config.weather?.kind===r.weather&&this.config.weather.expiresAt>now))&&Number(this.state.cooldowns[e.id]||0)<=now&&!this.state.active.some(a=>a.templateId===e.id);}
  add(templateId,{manual=false,now=this.now()}={}) {
    const e=this.templates.events.find(e=>e.id===templateId);if(!e)throw Error('事件模板不存在');
    const c=clock(now,this.config.timezone),count=this.state.daily[c.date]||0;
    if(this.state.active.length>=this.config.maxActive||count>=this.config.maxDaily)throw Error('进行中或每日事件上限已到');
    if(!this.eligible(e,c,now))throw Error('事件条件或冷却不满足');
    const duration=e.stages.reduce((n,s)=>n+s.minutes*60000,0);
    const event={id:randomUUID(),templateId:e.id,name:e.name,category:e.category,status:'active',startedAt:now,endsAt:now+duration,stage:0,stageText:e.stages[0].text,stages:clone(e.stages),effect:e.effect||'',aliases:e.aliases||[e.name],lastMentionAt:0,manual};
    this.state.active.push(event);this.state.daily[c.date]=count+1;this.state.cooldowns[e.id]=event.endsAt+e.cooldownHours*3600000;this.log('事件开始 '+e.name);this.persist();return event;
  }
  end(id,reason='自然结束',now=this.now()) {const i=this.state.active.findIndex(x=>x.id===id);if(i<0)throw Error('进行中事件不存在');const [e]=this.state.active.splice(i,1);e.status='ended';e.endedAt=now;e.endReason=reason;this.history.events.push(e);this.log('事件结束 '+e.name+' '+reason);this.persist();return e;}
  advance(now){for(const e of [...this.state.active]){if(now>=e.endsAt){this.end(e.id,'到期结束',now);continue;}let elapsed=now-e.startedAt,stage=0;while(stage<e.stages.length-1&&elapsed>=e.stages[stage].minutes*60000){elapsed-=e.stages[stage].minutes*60000;stage++;}if(stage!==e.stage){e.stage=stage;e.stageText=e.stages[stage].text;this.log('事件推进 '+e.name+' '+stage);}}}
  tick(now=this.now()) {
    if(!this.config.enabled)return;
    const before=JSON.stringify(this.state.active);
    this.advance(now);const c=clock(now,this.config.timezone);this.state.life=c;
    if(now-this.state.lastCheck<this.config.checkMinutes*60000&&before===JSON.stringify(this.state.active))return;
    if(now-this.state.lastCheck>=this.config.checkMinutes*60000){this.state.lastCheck=now;
      if(this.state.active.length<this.config.maxActive&&(this.state.daily[c.date]||0)<this.config.maxDaily&&this.random()<this.config.probability){const candidates=this.templates.events.filter(e=>this.eligible(e,c,now));const total=candidates.reduce((n,e)=>n+e.weight,0);let draw=this.random()*total;for(const e of candidates){draw-=e.weight;if(draw<=0){this.add(e.id,{now});break;}}}
      this.state.daily=Object.fromEntries(Object.entries(this.state.daily).filter(([k])=>k>=new Date(now-45*86400000).toISOString().slice(0,10)));
    }this.persist();
  }
  life(now=this.now()){const c=clock(now,this.config.timezone);return {...c,fatigue:(c.minute>=60&&c.minute<420)||this.state.active.some(e=>e.effect==='fatigue'),annoyed:this.state.active.some(e=>e.effect==='annoyed')};}
  evaluate(sessionId,{now=this.now(),dialogue={}}={}) {
    const mood=this.config.moodLinked?readMood(this.home,this.config,sessionId):{ok:false,error:'心情联动已关闭'};
    if(!mood.ok&&this.lastMoodError!==mood.error){this.log('心情适配：'+mood.error);this.lastMoodError=mood.error;}else if(mood.ok)this.lastMoodError=null;
    const before=this.state.mode;const mode=chooseMode({mood,previous:before,dialogue,life:this.life(now),thresholds:this.config.thresholds,now,linked:this.config.moodLinked});
    this.state.mode=mode;if(before?.id!==mode.id)this.log('模式 '+mode.id+'：'+mode.reason);this.persist();return {mood,mode};
  }
  context(sessionId,{now=this.now(),dialogue={}}={}) {
    if(!this.config.enabled||!this.config.context||!this.bound(sessionId))return '';
    this.tick(now);const {mode}=this.evaluate(sessionId,{now,dialogue});return this.render(mode,now);
  }
  render(mode,now=this.now(),simulation=null) {
    const c=this.life(now),active=(simulation?.active||this.state.active).map(e=>({name:e.name,stage:e.stageText,mayMention:!e.lastMentionAt||now-e.lastMentionAt>=this.config.mentionCooldownMinutes*60000}));
    const ended=(simulation?.ended||this.history.events).slice(-2).map(e=>({name:e.name,status:'已结束',endedAt:e.endedAt}));
    return `【岑舒生活与行为】${c.date} ${c.hour}:${c.minute%60<10?'0':''}${c.minute%60} ${c.weekday}，${this.config.timezone}。通常日程：${c.activity}（日程只是倾向，具体事件以下列记录为准）。\n当前行为模式：${modes[mode.id].label}。依据：${mode.reason}。${mode.recovering?'正在恢复，逐渐增加话量、减少特殊标点，不突然跳到兴奋。':''}\n行为要求：${this.config.modeRules[mode.id]||modes[mode.id].text}\n角色生活模拟记录（非青枔现实事实）：${JSON.stringify(active)}；近期结束：${JSON.stringify(ended)}。mayMention=false 则近期已经提过，除非青枔追问不要重复。没有事件可以什么也不讲，不强制汇报。已结束的事不能当新发生，同一事件前后接续。事件只供自然接话，不直接触发发消息。\n${this.profile.rules}\n${this.profile.boundaries} 当前消息的明确关心/认真感情情境优先于旧状态；只把对青枔说的话作为回复，不输出模式名称、判定步骤、心想或括号动作。不借用角色示例里的经历：没有事件记录就不能声称今天扫了一下午、好久没吃火锅、刚接电话等。不得说自己处于某模式，不捏造已经等待或明天必回。`;
  }
  noteMention(text,now=this.now()){for(const e of this.state.active){if(e.aliases.some(a=>a&&text.includes(a))&&now-e.lastMentionAt>60000){e.lastMentionAt=now;this.history.mentions.push({eventId:e.id,at:now});this.log('事件已提及 '+e.name);}}this.persist();}
  // Pure, detached simulation: never reads/writes real mood or changes live events.
  simulate({mood,dialogue={},life={},previous=null,now=this.now(),eventId}={}){const mode=chooseMode({mood,dialogue,life,previous,now,thresholds:this.config.thresholds,linked:true});const template=eventId?this.templates.events.find(e=>e.id===eventId):null;return {mode,context:this.render(mode,now,{active:template?[{name:template.name,stageText:template.stages[0].text}]:[],ended:[]}),event:template?{...clone(template),simulation:true}:null,simulation:true};}
  snapshot(sessionId=this.config.sessionIds[0]) {const context=sessionId?this.context(sessionId):'';return {ok:true,version:1,config:clone(this.config),state:clone(this.state),history:clone(this.history),mood:this.config.moodLinked?readMood(this.home,this.config,sessionId):{ok:false,error:'联动关闭'},life:this.life(),templates:this.templates.events,context};}
  hashReadOnlyInputs(){return ['config.json','state.json'].map(f=>{try{return createHash('sha256').update(fs.readFileSync(path.join(this.home,'feiyu-mood',f))).digest('hex');}catch{return null;}});}
}
