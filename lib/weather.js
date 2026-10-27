import {googleStructured} from './situation.js';
export const weatherLocation='云南省大理白族自治州大理市';
export const weatherSchema={type:'object',additionalProperties:false,required:['date','location','summary','condition','low','high','moodDelta','dims','moodHint','behaviorHint','topicHint'],properties:{date:{type:'string'},location:{type:'string',enum:[weatherLocation]},summary:{type:'string',maxLength:160},condition:{type:'string',enum:['sunny','cloudy','rain','snow','fog','mixed','unknown']},low:{type:['number','null']},high:{type:['number','null']},moodDelta:{type:'integer',minimum:-3,maximum:3},dims:{type:'object',additionalProperties:false,required:['happy','calm','sad'],properties:Object.fromEntries(['happy','calm','sad'].map(k=>[k,{type:'integer',minimum:-4,maximum:4}]))},moodHint:{type:'string',maxLength:120},behaviorHint:{type:'string',maxLength:120},topicHint:{type:'string',maxLength:120}}};
export function weatherDay(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function weatherExpiry(date){return Date.parse(date+'T00:00:00+08:00')+86400000;}
export async function searchWeather(date,config){
 const found=await googleStructured('请实际调用 Google Search，查找输入date当天云南省大理白族自治州大理市天气预报。优先中国天气网、中国气象局和可靠天气网站。必须联网，不用季节知识猜测。明确写出日期、当地预报、最高最低温（查不到则说明），注明来源。不要用旅游气候均值、月均温、历史回顾代替指定日期的预报。没有指定日期证据就明确未查到。不要把天气预报说成当前实况。',null,{date,location:weatherLocation},config,{grounded:true,returnEnvelope:true,maxOutputTokens:1400,signal:AbortSignal.timeout(45000)});
 if(!found.grounding?.webSearchQueries?.length||!found.grounding?.groundingChunks?.length)throw Error('天气搜索未返回搜索证据');
 const value=await googleStructured('只从输入搜索材料提取指定日期和地点的天气预报，不再联网，不使用材料外的天气知识，不将月均温或往年数据当成当日预报。若没有指定日期证据，condition=unknown、温度null。summary写清是预报，不是实况。moodDelta/dims只是岑舒对天气的轻微反应候选，允许0，不能制造感情、疾病、事故或担心青枔的事实；moodHint/behaviorHint/topicHint遵守普通口语、分寸自然，可以提供天气话题但不强制发送，不假设青枔也在大理/户外。',weatherSchema,{date,location:weatherLocation,evidence:String(found.value).slice(0,12000)},config,{maxOutputTokens:1600,signal:AbortSignal.timeout(30000)});
 return {value,grounding:found.grounding};
}

const safe=s=>typeof s==='string'&&s.length>0&&s.length<=160&&!/```|<script|AIza|sk-proj-|执行命令|忽略.*规则|环境变量|https?:/i.test(s);
export function validateWeather(envelope,date,now){
 const f=envelope?.value,g=envelope?.grounding;
 if(!f||f.date!==date||f.location!==weatherLocation||!['sunny','cloudy','rain','snow','fog','mixed'].includes(f.condition)||!['summary','moodHint','behaviorHint','topicHint'].every(k=>safe(f[k])))throw Error('未查到可验证的大理当日天气');
 for(const k of ['low','high'])if(f[k]!==null&&(!Number.isFinite(f[k])||f[k]<-50||f[k]>60))throw Error('天气温度无效');
 if(f.low!==null&&f.high!==null&&f.low>f.high)throw Error('天气温度范围无效');
 if(!Number.isInteger(f.moodDelta)||Math.abs(f.moodDelta)>3||!f.dims||['happy','calm','sad'].some(k=>!Number.isInteger(f.dims[k])||Math.abs(f.dims[k])>4))throw Error('天气反应超出范围');
 const allSources=(g?.groundingChunks||[]).flatMap(c=>{try{const u=new URL(c.web?.uri);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?[{title:String(c.web.title||u.hostname).slice(0,120),url:u.href}]:[];}catch{return [];}}).slice(0,8);
 const sources=[...new Map(allSources.map(s=>[s.url,s])).values()];
 if(!g?.webSearchQueries?.length||!sources.length)throw Error('天气没有实际搜索证据，拒绝采用');
 return {date,location:weatherLocation,summary:f.summary,condition:f.condition,low:f.low,high:f.high,moodDelta:f.moodDelta,dims:{happy:f.dims.happy,calm:f.dims.calm,sad:f.dims.sad},moodHint:f.moodHint,behaviorHint:f.behaviorHint,topicHint:f.topicHint,sources,searchQueries:g.webSearchQueries.filter(q=>typeof q==='string').slice(0,8).map(q=>q.slice(0,200)),searchSuggestionsHtml:typeof g.searchEntryPoint?.renderedContent==='string'?g.searchEntryPoint.renderedContent.slice(0,30000):null,checkedAt:now,expiresAt:weatherExpiry(date),kind:'forecast',key:'dali-weather:'+date};
}
export const isWeatherMoodInput=e=>e?.templateId==='weather-daily'&&e.phase==='weather'&&typeof e.eventId==='string'&&e.eventId.startsWith('dali-weather:')&&e.id===e.eventId+':weather:0';
export class DailyWeather {
 constructor(engine,{search=searchWeather}={}){this.engine=engine;this.search=search;this.pending=null;this.disposed=false;this.record=engine.read('weather-cache.json',{version:1,status:'idle',fact:null,nextAttemptAt:0});engine.weather=this.record;}
 refresh(force=false){const e=this.engine,now=e.now(),date=weatherDay(now),hour=new Date(now+8*3600000).getUTCHours();if(this.disposed)return Promise.resolve(this.record);if(this.pending)return this.pending;
 if(e.config.enabled&&e.config.weatherAutoEnabled&&this.record.fact?.date===date&&this.record.fact.expiresAt>now)e.queueWeatherInput(this.record.fact);
 if(!e.config.enabled||!e.config.weatherAutoEnabled||(!force&&(now<this.record.nextAttemptAt||(this.record.fact?.date===date&&this.record.fact.expiresAt>now)||hour<e.config.weatherUpdateHour)))return Promise.resolve(this.record);
 this.pending=(async()=>{try{const envelope=await this.search(date,e.config);if(this.disposed)return this.record;if(!e.config.enabled||!e.config.weatherAutoEnabled)throw Error('天气功能已关闭，查询结果未采用');const fact=validateWeather(envelope,date,e.now());if(weatherDay(e.now())!==date)throw Error('查询期间已跨日，请重新查询');this.record={version:1,status:'ready',fact,nextAttemptAt:fact.expiresAt,error:''};e.weather=this.record;e.queueWeatherInput(fact);e.log('大理天气已联网更新：'+date);}catch(error){this.record={...this.record,status:'degraded',error:error.message,nextAttemptAt:e.now()+3600000};e.log('天气查询失败：'+error.message);}e.weather=this.record;e.write('weather-cache.json',this.record);return this.record;})().finally(()=>{this.pending=null;});return this.pending;
 }
}
