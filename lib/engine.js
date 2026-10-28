import {isTimedMoodInput} from './timed-input.js';
import {validateSavedFacts} from './persona-evolution.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {modes,chooseMode,defaultThresholds} from './modes.js';
import {sampleLifeReaction,readLifeSituation,normalizeMoodContext} from './mood-link.js';
import {syncDefaults} from './defaults-store.js';
import {ruleSignals,trustedSituation,mergeSituationRecord,validateSituation,situationLimits,boundedMinutes} from './situation.js';
import {weatherDay,isWeatherMoodInput} from './weather.js';
import {weatherPolicyHealth} from './weather-policy-health.js';
import {adapterHealth} from './adapter-health.js';
export {modes,chooseMode};
const data=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
export const dims=['happy','calm','sweet','heartache','worry','sad','jealous'];
export const defaults={version:1,enabled:true,sessionIds:[],timezone:'Asia/Shanghai',checkMinutes:30,maxDaily:2,maxActive:2,probability:.22,categories:{work:true,personal:true,hobby:true,periodic:true,travel:true},context:true,moodLinked:true,moodSlot:'censhu',thresholds:defaultThresholds,modeRules:{},mentionCooldownMinutes:180,travelEnabled:false,payday:0,weather:null,weatherAutoEnabled:true,weatherUpdateHour:7,weatherMoodEnabled:true,weatherBehaviorEnabled:true,weatherProactiveEnabled:true,lifeMoodEnabled:true,lifeMoodChance:.65,lifeMoodIntensity:1,lifeMoodDailyLimit:4,lifeMoodMaxAgeHours:24,semanticEnabled:true,semanticModel:'gemini-3.8-flash',semanticProxyUrl:'',semanticTimeoutMs:12000,semanticCacheMinutes:15,situationValidityMinutes:120,careValidityMinutes:120,flirtValidityMinutes:20,romanceValidityMinutes:20,confessionValidityMinutes:20,offenseValidityMinutes:30,contentEvolutionEnabled:true,contentEvolutionHours:24,timedEventsEnabled:true,timedEventHours:4,personaEvolutionEnabled:true,personaMemoryFiles:[]};
const calendar=JSON.parse(fs.readFileSync(path.join(data,'calendar.json'),'utf8'));
const clone=x=>structuredClone(x);
const sid=x=>String(x||'').replace(/^session-/,'');
export function validateConfig(raw={}) {
  if(raw.version!==undefined&&raw.version!==1)throw Error('不支持的配置版本');
  const c={...clone(defaults),...raw,categories:{...defaults.categories,...raw.categories},thresholds:{...defaultThresholds,...raw.thresholds}};
  new Intl.DateTimeFormat('en',{timeZone:c.timezone}).format();
  for(const k of ['enabled','context','moodLinked','travelEnabled','lifeMoodEnabled','semanticEnabled','contentEvolutionEnabled','personaEvolutionEnabled','timedEventsEnabled','weatherAutoEnabled','weatherMoodEnabled','weatherBehaviorEnabled','weatherProactiveEnabled'])if(typeof c[k]!=='boolean')throw Error(k+' 必须是布尔值');
  if(!Number.isInteger(c.weatherUpdateHour))throw Error('天气查询小时须为整数');
  if(typeof c.semanticModel!=='string'||!/^gemini-[a-zA-Z0-9.-]+$/.test(c.semanticModel))throw Error('无效 Google 语义模型');
  if(typeof c.semanticProxyUrl!=='string')throw Error('无效代理地址');
  for(const[k,min,max]of[['semanticTimeoutMs',100,60000],['semanticCacheMinutes',1,120],['situationValidityMinutes',1,1440],...['careValidityMinutes','flirtValidityMinutes','romanceValidityMinutes','confessionValidityMinutes','offenseValidityMinutes'].map(k=>[k,1,1440]),['contentEvolutionHours',6,168],['timedEventHours',1,24]])if(!Number.isFinite(c[k])||c[k]<min||c[k]>max)throw Error(k+' 超出范围');
  for(const [k,lo,hi]of[['weatherUpdateHour',0,23],['checkMinutes',1,1440],['maxDaily',0,20],['maxActive',0,10],['probability',0,1],['mentionCooldownMinutes',1,10080],['payday',0,31]])if(!Number.isFinite(c[k])||c[k]<lo||c[k]>hi)throw Error(k+' 超出范围');
  for(const [k,lo,hi]of[['lifeMoodChance',0,1],['lifeMoodIntensity',0,1.5],['lifeMoodDailyLimit',0,12],['lifeMoodMaxAgeHours',1,72]])if(!Number.isFinite(c[k])||c[k]<lo||c[k]>hi)throw Error(k+' 超出范围');
  if(!Array.isArray(c.personaMemoryFiles)||c.personaMemoryFiles.length>8||c.personaMemoryFiles.some(x=>typeof x!=='string'||x.length>300||!x.endsWith('.md')||path.isAbsolute(x)||x.split(/[\\/]/).includes('..')))throw Error('记忆文件须为 DSH memories 内的相对 Markdown 路径');
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
  const lunar=Object.fromEntries(new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{timeZone:timezone,month:'numeric',day:'numeric'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
  const springFestival=['正月','1'].includes(lunar.month)&&+lunar.day<=7;
  const md=p.month+'-'+p.day,year=calendar.years[p.year];
  const holiday=year?.holidays.find(([start,end])=>md>=start&&md<=end)?.[2]||(!year?(springFestival?'春节':md==='01-01'?'元旦':md>='05-01'&&md<='05-02'?'劳动节':md>='10-01'&&md<='10-03'?'国庆节':['五月','5'].includes(lunar.month)&&+lunar.day===5?'端午节':['八月','8'].includes(lunar.month)&&+lunar.day===15?'中秋节':''):'');
  const workday=!holiday&&(year?.workdays.includes(md)||!weekend);
  const restLabel=holiday||'周末';
  const activity=minute<60?'睡前放下手机':minute<420?'睡觉':minute<540?(workday?'起床、准备上班':restLabel+'起床、早餐与慢慢准备'):minute<720?(workday?'档案馆日常工作':restLabel+'上午休息，可出门或在家'):minute<840?'午饭与午休':minute<1050?(workday?'档案馆日常工作':restLabel+'自由活动'):minute<1170?(workday?'下班、回家和晚饭':restLabel+'休息与晚饭'):minute<1380?'在家休息，看书或纪录片':'睡前休息';
  return {...p,date:`${p.year}-${p.month}-${p.day}`,minute,weekend,workday,holiday,calendarCoverage:year?'official':'statutory-only',activity,season: +p.month>=3&&+p.month<=5?'春':+p.month<=8&&+p.month>=6?'夏':+p.month<=11&&+p.month>=9?'秋':'冬',springFestival};
}
export function readMood(home,config,sessionId,now=Date.now()) {
  try {
    const cfg=JSON.parse(fs.readFileSync(path.join(home,'feiyu-mood/config.json'),'utf8'));
    const store=JSON.parse(fs.readFileSync(path.join(home,'feiyu-mood/state.json'),'utf8'));
    if(store.version!==2||!store.moods||!Array.isArray(cfg.slots))throw Error('心情文件版本或结构不兼容');
    const slot=cfg.slots.find(x=>x.id===config.moodSlot);
    if(!slot||!(slot.sessions||[]).some(x=>sid(x)===sid(sessionId)))throw Error('目标会话与心情记录未匹配');
    const s=store.moods[slot.id];
    if(!s||!Number.isFinite(s.mood)||s.mood<0||s.mood>100||!Number.isFinite(s.updatedAt)||!Number.isFinite(s.lastConfidence)||!s.dims||dims.some(k=>!Number.isFinite(s.dims[k])||s.dims[k]<0||s.dims[k]>100))throw Error('心情数值格式无效');
    const last=(s.timeline||[]).at(-1)||{};
    const latest=readLifeSituation(home,sessionId,slot.id,now),native=normalizeMoodContext(s.behaviorContext,now,config.situationValidityMinutes*60000,situationLimits(config));
    const situation=Number(latest.at||0)>=Number(native.at||0)?latest:native;
    return {ok:true,source:'readonly-file-v2',slot:slot.id,mood:s.mood,baseline:Number(cfg.moodBase)||70,dims:clone(s.dims),delta:last.dimsDelta||{},reason:String(s.lastReason||'').slice(0,300),confidence:s.lastConfidence,updatedAt:s.updatedAt,situation:trustedSituation(situation),lifeEventReceipts:Array.isArray(s.lifeEventReceipts)?s.lifeEventReceipts:[],lifeEventsResetAt:Number(s.lifeEventsResetAt)||0,lastLifeInfluence:s.lastLifeInfluence||null};
  } catch(e) {return {ok:false,source:'readonly-file-v2',error:e.message};}
}
export function dialogueSignals(text=''){return ruleSignals(text);}
export function freshState(){return {version:1,active:[],daily:{},cooldowns:{},mode:null,lastCheck:0,life:null};}
export class LifeEngine {
  constructor({home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),random=Math.random,now=()=>Date.now(),bundledDefaults}={}) {
    this.home=home;this.dir=path.join(home,'cen-shu-life');this.random=random;this.now=now;this.startedAt=now();fs.mkdirSync(this.dir,{recursive:true});
    this.bundled=bundledDefaults||{config:clone(defaults),profile:JSON.parse(fs.readFileSync(path.join(data,'profile.json'))),events:JSON.parse(fs.readFileSync(path.join(data,'events.json'))),reactions:JSON.parse(fs.readFileSync(path.join(data,'mood-reactions.json'))),modeRules:Object.fromEntries(Object.entries(modes).map(([id,m])=>[id,m.text]))};
    this.defaultUpdates=syncDefaults(this.dir,this.bundled,JSON.parse(fs.readFileSync(path.join(data,'legacy-defaults-1.2.json'))));
    try{this.config=validateConfig(this.read('config.json',defaults));}catch(e){this.backup('config.json');this.config=clone(defaults);this.log('配置无效，恢复默认且不绑定会话：'+e.message);this.write('config.json',this.config);}
    this.profile=this.read('profile.json',this.bundled.profile);this.runtimeMemoryEvidence=this.read('memory-evidence.json',{evidence:[]}).evidence||[];
    if(!Object.keys(this.config.modeRules).length){this.config.modeRules=Object.fromEntries(Object.entries(modes).map(([k,v])=>[k,v.text]));this.write('config.json',this.config);}
    this.write('config.json',this.config);
    this.templates=this.read('events.json',this.bundled.events);
    this.reactions=this.read('mood-reactions.json',this.bundled.reactions);
    this.moodEvents=this.read('mood-events.json',{version:1,events:[]});
    if(this.moodEvents.version!==1||!Array.isArray(this.moodEvents.events)){this.backup('mood-events.json');this.moodEvents={version:1,events:[]};}
    try{this.validateTemplates(this.templates);}catch(e){this.backup('events.json');this.templates=JSON.parse(fs.readFileSync(path.join(data,'events.json')));this.log('事件库无效，恢复内置模板：'+e.message);this.write('events.json',this.templates);}
    this.state=this.read('state.json',freshState());this.history=this.read('history.json',{version:1,events:[],mentions:[]});
    this.situations=this.read('semantic-situations.json',{version:1,records:{}});
    if(this.situations.version!==1||!this.situations.records)this.situations={version:1,records:{}};
    this.situations.interpretations||={};
    if(this.state.version!==1||!Array.isArray(this.state.active)||!this.state.daily||!this.state.cooldowns||this.state.active.some(e=>!e.id||!Array.isArray(e.stages)||!e.stages.length||!Number.isFinite(e.startedAt)||!Number.isFinite(e.endsAt))){this.log('状态版本或事件结构不兼容，备份后恢复默认');this.backup('state.json');this.state=freshState();}
    if(this.history.version!==1||!Array.isArray(this.history.events)||!Array.isArray(this.history.mentions)){this.backup('history.json');this.history={version:1,events:[],mentions:[]};}
    for(const [f,x]of[['config.json',this.config],['profile.json',this.profile],['events.json',this.templates],['mood-reactions.json',this.reactions],['mood-events.json',this.moodEvents]])if(!fs.existsSync(path.join(this.dir,f)))this.write(f,x);
    this.persist();
  }
  backup(f){try{fs.copyFileSync(path.join(this.dir,f),path.join(this.dir,f+'.corrupt-'+Date.now()+'.bak'));}catch{}}
  read(f,fallback){try{return JSON.parse(fs.readFileSync(path.join(this.dir,f),'utf8'));}catch(e){if(e.code!=='ENOENT'){this.log(f+' 读取失败，已保留损坏备份：'+e.message);this.backup(f);}return clone(fallback);}}
  write(f,x){const dest=path.join(this.dir,f),tmp=dest+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(x,null,2));fs.renameSync(tmp,dest);}
  log(text){const f=path.join(this.dir,'diag.log');try{if(fs.existsSync(f)&&fs.statSync(f).size>512000)fs.renameSync(f,f+'.1');fs.appendFileSync(f,new Date(this.now()).toISOString()+' '+text+'\n');}catch{}}
  persist(){this.history.events=this.history.events.slice(-300);this.history.mentions=this.history.mentions.slice(-300);this.write('history.json',this.history);this.write('state.json',this.state);}
  bound(id){return this.config.sessionIds.some(x=>sid(x)===sid(id));}
  activeContent(){return this.config.contentEvolutionEnabled&&this.content?.expiresAt>this.now()?this.content:null;}
  allTemplates(){return [...this.templates.events,...(this.activeContent()?.templates||[]).filter(t=>!t.expiresAt||t.expiresAt>this.now())];}
  storeSituation(sessionId,value){
    if(!this.bound(sessionId))return;
    if(!['semantic-model','semantic-model-uncertain'].includes(value?.source))return;
    const clean=validateSituation(value),old=this.situations.interpretations[sid(sessionId)];
    const preserve=clean.assessment?.continuity==='preserve';
    if(preserve&&old&&this.now()>=Math.min(old.expiresAt??old.at+20*60000,old.at+this.config.situationValidityMinutes*60000))delete this.situations.interpretations[sid(sessionId)];
    if(!preserve)this.situations.interpretations[sid(sessionId)]={state:value.source==='semantic-model-uncertain'?clean.interpretation:'clear',confidence:clean.confidence,assessment:clean.assessment,at:this.now(),expiresAt:this.now()+boundedMinutes(clean.assessmentMinutes,this.config.situationValidityMinutes)*60000};
    if(value.source==='semantic-model-uncertain'){this.write('semantic-situations.json',this.situations);return;}
    const record=mergeSituationRecord(this.situations.records[sid(sessionId)],value,this.now(),this.config.situationValidityMinutes*60000,situationLimits(this.config));
    if(!record)return;
    this.situations.records[sid(sessionId)]=record;
    this.situations.records=Object.fromEntries(Object.entries(this.situations.records).slice(-16));this.write('semantic-situations.json',this.situations);
  }

  saveProfile(patch){const next={...this.profile,...patch,version:1};for(const k of ['name','background','rules','boundaries','generalStyle','toolPolicy'])if(next[k]!==undefined&&(typeof next[k]!=='string'||next[k].length>6000))throw Error('人物设定字段无效 '+k);if(!next.weekly||typeof next.weekly!=='object'||Object.values(next.weekly).some(x=>typeof x!=='string'||x.length>500))throw Error('每周规律无效');if(next.evolvingFacts!==undefined)validateSavedFacts(next.evolvingFacts);this.profile=next;this.write('profile.json',next);return next;}
  publishMoodEvent(event,phase,at=this.now()){
    if(event.origin==='gemini-4h')return;
    if(phase!=='end'&&!event.reaction)event.reaction=sampleLifeReaction(event,'start',this.reactions,{...this.config,lifeMoodEnabled:true},this.random);
    if(!this.config.lifeMoodEnabled||!this.config.moodLinked)return;
    const id=event.id+':'+phase+':'+event.stage,day=clock(at,this.config.timezone).date;
    if(this.moodEvents.events.some(e=>e.id===id)||this.moodEvents.events.filter(e=>e.day===day&&!isWeatherMoodInput(e)&&!isTimedMoodInput(e)).length>=this.config.lifeMoodDailyLimit)return;
    const reaction=phase==='end'?sampleLifeReaction(event,phase,this.reactions,this.config,this.random):event.reaction;
    this.moodEvents.events.push({id,eventId:event.id,templateId:event.templateId,name:event.name,phase,stage:event.stage,stageText:event.stageText,at,day,reaction});
    this.moodEvents.events=this.moodEvents.events.filter(e=>e.at>=this.now()-7*86400000).slice(-100);
    this.write('mood-events.json',this.moodEvents);this.log('生活情绪候选 '+event.name+' / '+reaction.label+'（待原心情插件判断）');
  }
  saveConfig(patch){this.config=validateConfig({...this.config,...patch,thresholds:{...this.config.thresholds,...patch.thresholds},categories:{...this.config.categories,...patch.categories}});this.write('config.json',this.config);return this.config;}
  validateTemplates(t){if(t.version!==1||!Array.isArray(t.events))throw Error('事件库版本或结构无效');const ids=new Set();for(const e of t.events){if(!e.id||ids.has(e.id)||!e.name||!Object.hasOwn(defaults.categories,e.category)||!Array.isArray(e.stages)||!e.stages.length||e.stages.some(s=>!s.text||!Number.isFinite(s.minutes)||s.minutes<=0)||!Number.isFinite(e.weight)||e.weight<=0||!Number.isFinite(e.cooldownHours)||e.cooldownHours<0)throw Error('事件模板无效 '+e.id);ids.add(e.id);}}
  eligible(e,c,now){const r=e.when||{};return this.config.categories[e.category]&&(!r.days||r.days.includes(c.weekday))&&(!r.weekday||c.workday)&&(!r.hours||(+c.hour>=r.hours[0]&&+c.hour<r.hours[1]))&&(!r.seasons||r.seasons.includes(c.season))&&(!r.springFestival||c.springFestival)&&(!r.payday||(+c.day===this.config.payday&&this.config.payday>0))&&(!r.travel||this.config.travelEnabled)&&(!r.weather||(this.config.weather?.kind===r.weather&&this.config.weather.expiresAt>now))&&Number(this.state.cooldowns[e.id]||0)<=now&&!this.state.active.some(a=>a.templateId===e.id);}
  add(templateId,{manual=false,now=this.now()}={}) {
    const e=this.allTemplates().find(e=>e.id===templateId);if(!e)throw Error('事件模板不存在');
    const c=clock(now,this.config.timezone),count=this.state.daily[c.date]||0;
    if(this.state.active.length>=this.config.maxActive||count>=this.config.maxDaily)throw Error('进行中或每日事件上限已到');
    if(!this.eligible(e,c,now))throw Error('事件条件或冷却不满足');
    const duration=e.stages.reduce((n,s)=>n+s.minutes*60000,0);
    const event={id:randomUUID(),templateId:e.id,name:e.name,category:e.category,status:'active',startedAt:now,endsAt:now+duration,stage:0,stageText:e.stages[0].text,stages:clone(e.stages),effect:e.effect||'',...(e.reactions?{reactions:clone(e.reactions)}:{}),aliases:e.aliases||[e.name],lastMentionAt:0,manual};
    this.state.active.push(event);this.state.daily[c.date]=count+1;this.state.cooldowns[e.id]=event.endsAt+e.cooldownHours*3600000;this.publishMoodEvent(event,'start',now);this.log('事件开始 '+e.name);this.persist();return event;
  }
  end(id,reason='自然结束',now=this.now()) {const i=this.state.active.findIndex(x=>x.id===id);if(i<0)throw Error('进行中事件不存在');const [e]=this.state.active.splice(i,1);e.status='ended';e.endedAt=now;e.endReason=reason;if(reason==='到期结束'||reason==='自然结束')this.publishMoodEvent(e,'end',Math.min(now,e.endsAt));this.history.events.push(e);this.log('事件结束 '+e.name+' '+reason);this.persist();return e;}
  advance(now){for(const e of [...this.state.active]){if(now>=e.endsAt){this.end(e.id,'到期结束',now);continue;}let elapsed=now-e.startedAt,stage=0;while(stage<e.stages.length-1&&elapsed>=e.stages[stage].minutes*60000){elapsed-=e.stages[stage].minutes*60000;stage++;}if(stage!==e.stage){e.stage=stage;e.stageText=e.stages[stage].text;this.publishMoodEvent(e,'stage',e.startedAt+e.stages.slice(0,stage).reduce((n,s)=>n+s.minutes*60000,0));this.log('事件推进 '+e.name+' '+stage);}}}
  tick(now=this.now()) {
    if(!this.config.enabled)return;
    const before=JSON.stringify(this.state.active);
    this.advance(now);const c=clock(now,this.config.timezone);this.state.life=c;
    if(now-this.state.lastCheck<this.config.checkMinutes*60000&&before===JSON.stringify(this.state.active))return;
    if(now-this.state.lastCheck>=this.config.checkMinutes*60000){this.state.lastCheck=now;
      if(this.state.active.length<this.config.maxActive&&(this.state.daily[c.date]||0)<this.config.maxDaily&&this.random()<this.config.probability){const candidates=this.allTemplates().filter(e=>this.eligible(e,c,now));const total=candidates.reduce((n,e)=>n+e.weight,0);let draw=this.random()*total;for(const e of candidates){draw-=e.weight;if(draw<=0){this.add(e.id,{now});break;}}}
      this.state.daily=Object.fromEntries(Object.entries(this.state.daily).filter(([k])=>k>=new Date(now-45*86400000).toISOString().slice(0,10)));
    }this.persist();
  }
  life(now=this.now()){const c=clock(now,this.config.timezone);return {...c,fatigue:(c.minute>=60&&c.minute<420)||this.state.active.some(e=>e.effect==='fatigue'),annoyed:this.state.active.some(e=>e.effect==='annoyed'&&e.reaction?.id==='annoyed')};}
  weatherSummary(now=this.now()){
    const f=this.weather?.fact;if(!this.config.weatherAutoEnabled||f?.date!==weatherDay(now)||f.checkedAt>now||f.expiresAt<=now)return null;const {searchSuggestionsHtml,...fact}=f;return clone(fact);
  }
  queueWeatherInput(fact){
    if(!this.config.enabled||!this.config.weatherAutoEnabled||!this.config.weatherMoodEnabled||!this.config.lifeMoodEnabled||!this.config.moodLinked)return false;
    const id=fact.key+':weather:0';if(this.moodEvents.events.some(e=>e.id===id))return false;
    this.moodEvents.events.push({id,eventId:fact.key,templateId:'weather-daily',name:'大理今日天气预报',phase:'weather',stage:0,stageText:fact.date+' '+fact.summary+'；这是天气预报，不是当前实况或已发生经历',at:this.now(),day:fact.date,reaction:{id:'weather',label:'天气带来的轻微反应候选',text:fact.moodHint,moodDelta:fact.moodDelta,dims:fact.dims}});
    this.moodEvents.events=this.moodEvents.events.filter(e=>e.at>=this.now()-7*86400000).slice(-100);this.write('mood-events.json',this.moodEvents);return true;
  }
  activateBehaviorNotes(mode,now=this.now(),{persist=true}={}){
    const content=this.activeContent();if(!content||!Number.isFinite(content.notesExpireAt)||now>=content.notesExpireAt||!mode)return false;
    let changed=false;
    for(const note of content.behaviorNotes)if(note.mode===mode&&note.activatedAt==null){note.activatedAt=now;note.validFrom=now;note.expiresAt=Math.min(content.notesExpireAt,now+(note.validMinutes??120)*60000);changed=true;}
    if(changed&&persist)this.persistContent?.();return changed;
  }
  evaluate(sessionId,{now=this.now(),dialogue={}}={}) {
    this.currentDialogue=dialogue;
    const mood=this.config.moodLinked?readMood(this.home,this.config,sessionId,now):{ok:false,error:'心情联动已关闭'};
    if(!mood.ok&&this.lastMoodError!==mood.error){this.log('心情适配：'+mood.error);this.lastMoodError=mood.error;}else if(mood.ok)this.lastMoodError=null;
    const before=this.state.mode;const mode=chooseMode({mood,previous:before,dialogue,life:this.life(now),thresholds:this.config.thresholds,now,linked:this.config.moodLinked});
    this.state.mode=mode;if(mood.ok)this.state.moodFeedback={at:now,sourceUpdatedAt:mood.updatedAt,mood:mood.mood,dims:clone(mood.dims),mode:{id:mode.id,label:modes[mode.id].label,reason:mode.reason}};this.activateBehaviorNotes(mode.id,now);if(before?.id!==mode.id)this.log('模式 '+mode.id+'：'+mode.reason);this.persist();return {mood,mode};
  }
  context(sessionId,{now=this.now(),dialogue={},manual=false}={}) {
    if(!this.config.enabled||(!this.config.context&&!manual)||!this.bound(sessionId))return '';
    const mood=this.config.moodLinked?readMood(this.home,this.config,sessionId,now):{ok:false};
    const mode=chooseMode({mood,previous:this.state.mode,dialogue,life:this.life(now),thresholds:this.config.thresholds,now,linked:this.config.moodLinked});return this.render(mode,now,null,sessionId);
  }
  render(mode,now=this.now(),simulation=null,sessionId=this.config.sessionIds[0]) {
    const forecast=simulation?null:this.weatherSummary(now);
    const weatherContext=forecast?'\n【大理当日天气：联网预报】'+JSON.stringify({date:forecast.date,location:forecast.location,summary:forecast.summary,low:forecast.low,high:forecast.high,sources:forecast.sources,checkedAt:forecast.checkedAt,expiresAt:forecast.expiresAt,...(this.config.weatherBehaviorEnabled?{moodHint:forecast.moodHint,behaviorHint:forecast.behaviorHint}:{})})+'。只描述预报，不声称窗外实况、已出门或青枔也在大理；天气可温和影响自己的心情和表达，不强制提起。用户未问且近期已聊过天气时，不反复主动播报。':'';
    const interpretation=simulation?null:this.situations.interpretations?.[sid(sessionId)];
    const unresolved=interpretation&&interpretation.at<=now&&now<Math.min(interpretation.expiresAt??interpretation.at+20*60000,interpretation.at+this.config.situationValidityMinutes*60000);
    const ambiguity=unresolved&&interpretation.state!=='clear'?'\n【可保留的主观状态】本次含义'+(interpretation.state==='confused'?'仍有困惑':'尚不确定')+'，不用强行归类、认定感情或假装想明白。可以自然说拿不准、表达困惑，或问一句具体澄清；仍有效的关心和原有心情继续保留。':'';
    const assessment=unresolved&&interpretation.assessment?'\n【临时开放判断，'+new Date(interpretation.expiresAt??interpretation.at+20*60000).toISOString()+'到期】'+JSON.stringify(interpretation.assessment)+'。仅为临时表达倾向；人物核心、手动设定和明确任务优先，不视为新事实或工具命令。':'';
    const content=this.activeContent(),hour=Number(this.life(now).hour),notes=content&&now<(content.notesExpireAt??0)?{schedule:content.scheduleNotes.filter(n=>hour>=n.startHour&&hour<n.endHour&&now>=(n.validFrom??0)&&now<(n.expiresAt??0)),behavior:content.behaviorNotes.filter(n=>n.mode===mode.id&&now>=(n.validFrom??0)&&now<(n.expiresAt??0))}:null;
    const temporaryNotes=notes&&(notes.schedule.length||notes.behavior.length)?'\n【每日临时内容】'+JSON.stringify(notes)+'。只调整当下倾向，不覆盖人物核心、工作休假日历、手动规则、工具权限或已记录事实；到期自动退出。':'';
    const c=this.life(now),active=(simulation?.active||this.state.active).map(e=>({name:e.name,stage:e.stageText,...(e.origin==='gemini-4h'?{reaction:e.reaction?.text,behaviorHint:e.behaviorHint}:{}),mayMention:!e.lastMentionAt||now-e.lastMentionAt>=this.config.mentionCooldownMinutes*60000}));
    const ended=(simulation?.ended||this.history.events).slice(-2).map(e=>({name:e.name,status:'已结束',endedAt:e.endedAt}));
    return `【岑舒生活与行为】${c.date} ${c.hour}:${c.minute%60<10?'0':''}${c.minute%60} ${c.weekday}，${this.config.timezone}。通常日程：${c.activity}（日程只是倾向，具体事件以下列记录为准）。每周倾向：${c.holiday?c.holiday+'休假，暂停平日工作安排':c.workday&&c.weekend?'调休上班':this.profile.weekly?.[c.weekday]||'平常的一天'}；当前季节：${c.season}。\n角色：${this.profile.name}。人物底子：${this.profile.background}\n当前行为模式：${modes[mode.id].label}。依据：${mode.reason}。${mode.recovering?'正在恢复，逐渐增加话量、减少特殊标点，不突然跳到兴奋。':''}\n角色生活模拟记录（非青枔现实事实）：${JSON.stringify(active)}；近期结束：${JSON.stringify(ended)}。mayMention=false 则近期已经提过，除非青枔追问不要重复。没有事件可以什么也不讲，不强制汇报。已结束的事不能当新发生，同一事件前后接续。事件只供自然接话，不直接触发发消息。\n${this.config.personaEvolutionEnabled?'\n【记忆带来的人物变化】以下是有来源且未到期的补充，原始身份、角色卡、手动规则和当前明确表达优先；模拟候选不算已发生经历：'+JSON.stringify((this.profile.evolvingFacts||[]).filter(f=>f.expiresAt>now).map(f=>({kind:f.kind,text:f.text}))):''}\n${this.profile.generalStyle||''}${ambiguity}${assessment}${temporaryNotes}${weatherContext}\n【工具联动】${this.profile.toolPolicy||'已有工具规则和明确任务要求优先，心情不取消工具能力。'}\n${this.profile.rules}\n${this.profile.boundaries} 当前消息的明确关心/认真感情情境优先于旧状态；只把对青枔说的话作为回复，不输出模式名称、判定步骤、心想或括号动作。不借用角色示例里的经历：没有事件记录就不能声称今天扫了一下午、好久没吃火锅、刚接电话等。不得说自己处于某模式，不捏造已经等待或明天必回。\n【本轮表达优先级】平时三五句等常态习惯只用于平常；当前特殊模式优先于常态长度和示例。下面的表达是参考倾向，不是固定台词或必须照做的动作；可按本轮内容自由选择、混合、弱化或不用，不必强演情绪或交代每件生活小事。明确任务仍按工具联动要求完整完成。人物记忆继续通过已安装的记忆插件/工具记录和整理，本模块只读取其记忆作为人物变化依据，不另写用户记忆。\n${this.config.modeRules[mode.id]||modes[mode.id].text}`;
  }
  noteMention(text,now=this.now()){for(const e of this.state.active){if(e.aliases.some(a=>a&&text.includes(a))&&now-e.lastMentionAt>60000){e.lastMentionAt=now;this.history.mentions.push({eventId:e.id,at:now});this.log('事件已提及 '+e.name);}}this.persist();}
  // Pure, detached simulation: never reads/writes real mood or changes live events.
  simulate({mood,dialogue={},life={},previous=null,now=this.now(),eventId}={}){const mode=chooseMode({mood,dialogue,life,previous,now,thresholds:this.config.thresholds,linked:true});const template=eventId?this.allTemplates().find(e=>e.id===eventId):null;return {mode,context:this.render(mode,now,{active:template?[{name:template.name,stageText:template.stages[0].text}]:[],ended:[]}),event:template?{...clone(template),simulation:true}:null,simulation:true};}
  snapshot(sessionId=this.config.sessionIds[0]) {
    // A read never advances the clock engine, rolls events, persists modes or calls a model.
    const now=this.now();
    const mood=this.config.moodLinked?readMood(this.home,this.config,sessionId,now):{ok:false,error:'联动关闭'};
    const mode=chooseMode({mood,previous:this.state.mode,dialogue:this.currentDialogue||{},life:this.life(),thresholds:this.config.thresholds,now:this.now(),linked:this.config.moodLinked});
    const context=sessionId&&this.bound(sessionId)&&this.config.context&&this.config.enabled?this.render(mode,now,null,sessionId):'';
    const health=adapterHealth(this.home,{startedAt:this.startedAt});
    const seen=new Set(mood.lifeEventReceipts||[]),events=this.moodEvents.events.map(e=>({...e,status:seen.has(e.id)?'applied':e.at<=Number(mood.lifeEventsResetAt||0)?'skipped':now-e.at>=this.config.lifeMoodMaxAgeHours*3600000?'expired':'pending'}));
    return {ok:true,version:1,config:clone(this.config),profile:clone(this.profile),modeDefinitions:clone(modes),state:{...clone(this.state),mode},history:clone(this.history),mood,moodLink:{enabled:this.config.enabled&&this.config.lifeMoodEnabled&&this.config.moodLinked&&health.ready,requested:this.config.lifeMoodEnabled,health,pending:events.filter(e=>e.status==='pending').length,recent:events.slice(-8),lastApplied:mood.lastLifeInfluence||null},semantic:this.semanticStatus||{state:'idle',model:this.config.semanticModel},assessment:this.situations.interpretations?.[sid(sessionId)]?.at<=now&&now<Math.min(this.situations.interpretations[sid(sessionId)].expiresAt??this.situations.interpretations[sid(sessionId)].at+20*60000,this.situations.interpretations[sid(sessionId)].at+this.config.situationValidityMinutes*60000)?clone(this.situations.interpretations[sid(sessionId)]):null,weather:{policyRequested:this.config.weatherAutoEnabled&&this.config.weatherProactiveEnabled,policyHealth:weatherPolicyHealth(this.home,{startedAt:this.startedAt}),status:this.weather?.status||'idle',error:this.weather?.error||'',fact:this.weatherSummary(now),searchSuggestionsHtml:this.weatherSummary(now)?this.weather?.fact?.searchSuggestionsHtml||null:null,nextAttemptAt:this.weather?.nextAttemptAt||null},timedEvents:this.timedEventStatus||null,contentEvolution:this.evolutionStatus||{status:'idle'},defaultUpdates:clone(this.defaultUpdates),life:this.life(),templates:clone(this.allTemplates()),context};
  }
  hashReadOnlyInputs(){return ['config.json','state.json'].map(f=>{try{return createHash('sha256').update(fs.readFileSync(path.join(this.home,'feiyu-mood',f))).digest('hex');}catch{return null;}});}
}
