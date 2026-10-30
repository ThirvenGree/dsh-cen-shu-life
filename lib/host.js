import {SemanticMentions} from './semantic-mentions.js';
import {captureProjectEvidence} from './project-evidence.js';
import {PersonalSettings} from './personal-settings.js';
import {LifeDirector} from './life-director.js';
import {PersonaLearning} from './persona-learning.js';
import {EventSharing} from './event-sharing.js';
import {DrawingInspiration} from './drawing-inspiration.js';
import {sharedLifeContext} from './shared-context.js';
import {MemoryWriteback,unwrapMemoryResult} from './memory-writeback.js';
import {TimedEvents} from './timed-events.js';
import {reviewMemory} from './memory-review.js';
import {captureMemoryContexts,revokeDeletedMemory,activePersonaFacts} from './persona-evolution.js';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {LifeEngine,readMood} from './engine.js';
import {sampleLifeReaction} from './mood-link.js';
import {SituationClassifier,authoritativeSituation,unknownSituation,situationLimits,situationFromRecord} from './situation.js';
import {createRequestGuard} from './request-guard.js';
import {weatherPolicyHealth} from './weather-policy-health.js';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {adapterHealth} from './adapter-health.js';
import {DailyWeather} from './weather.js';
import {ContentEvolution} from './content-evolution.js';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
export const name='cen-shu-life';
export const inject=['agents','webServer','timer','tools','llm'];
const idOf=a=>a?.session?.id||a?.session?.sessionId||a?.id||'';
function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>65536)reject(Error('请求过大'));});req.on('end',()=>{try{resolve(JSON.parse(b||'{}'));}catch{reject(Error('无效 JSON'));}});req.on('error',reject);});}
function textOf(message){return (message?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');}
export function incomingToolText(message){
  try{const text=textOf(message),start=text.indexOf('{');const p=JSON.parse(text.slice(start));return (p.newMessages||p.messages||p.unread||[]).filter(x=>!x.isSelf).map(x=>x.text||'').join('\n').slice(-3000);}catch{return '';}
}
export function incomingText(msg){
  const source=String(msg?.source?.kind||'');
  if(['plugin:censhu-inner-life','censhu-inner-life','censhu-inner-life-notice','speak-up','schedule','cron','memory','cen-shu-life','dsh-mnemon','dsh-memory-evolve','runtime-context','time-context','system-reminder','system','time-sampled','goal','goal-round','subagent','subagent-notice','tool-registry','cordis-host-runner','agent-instructions','system-prompt','model','plugin'].includes(source)||/^(subagent|goal|tool-|system-|schedule)/.test(source))return '';
  const text=textOf(msg),marker='【本次消息快照】';
  if(text.includes(marker)){
    try{const rest=text.split(marker)[1].trimStart(),line=rest.split('\n')[0],packet=JSON.parse(line);return (packet.messages||[]).filter(x=>!x.isSelf).map(x=>x.text||'').join('\n').slice(-3000);}catch{return '';}
  }
  // Bridge wakeups/reminders and operator metadata are not Qingqin speaking.
  if(/【会话令牌】|【引导唤醒】|【唤醒提醒】|【QQ/.test(text))return '';
  return text.slice(-3000);
}
export const apply=ctx=>createHost(ctx);
export function createHost(ctx,{engine=new LifeEngine(),classifier=new SituationClassifier(),director:providedDirector}={}){
  const mounted=new Map(),dialogues=new Map(),calls=new Map(),qqSessions=new Set(),simulations=new Map();let disposed=false,lastModeCheck=0,lastPersonaCheck=0,lastHealthCode='',lastWeatherHealthCode='',lastMoodRevision='';
  engine.personalSettings=new PersonalSettings(engine,()=>ctx.get?.('cosplay'));
  const mentions=new SemanticMentions(engine);const projectCalls=new Map();
  const director=providedDirector===false?null:(providedDirector||new LifeDirector(engine));
  const personaLearning=new PersonaLearning(engine),evolution=new ContentEvolution(engine),weather=new DailyWeather(engine),timedEvents=new TimedEvents(engine),sharing=new EventSharing(engine),drawing=new DrawingInspiration(engine);
  const signalsFor=id=>{const record=dialogues.get(id);const value=authoritativeSituation(record?.signals?.source==='semantic-model'?situationFromRecord({source:'semantic-model',at:record.at,value:record.signals,evidenceExpiresAt:Object.fromEntries(Object.entries(situationLimits(engine.config)).map(([k,cap])=>[k,record.at+Math.min(cap,record.signals.durationMinutes?.[k]??cap)*60000]))},engine.now(),engine.config.situationValidityMinutes*60000,situationLimits(engine.config)):record&&engine.now()-record.at<engine.config.careValidityMinutes*60000?record.signals:null);return ['trusted','care-fallback'].includes(value.semanticState)?value:{};};
  const classifyCurrent=async id=>{
    const record=dialogues.get(id);if(!record||/本机操作者|只读.*(?:复核|验收)|诊断|模拟测试/.test(record.text))return;
    const prior=engine.config.moodLinked?readMood(engine.home,engine.config,id,engine.now()):{};
    const open=engine.situations.interpretations?.[id.replace(/^session-/,'')],previousAssessment=open&&open.at<=engine.now()&&engine.now()<Math.min(open.expiresAt??open.at+20*60000,open.at+engine.config.situationValidityMinutes*60000)?open:null;
    const result=await classifier.resolve(id,record.text,engine.config,{previousSituation:prior.situation||null,previousMode:engine.state.mode?{id:engine.state.mode.id,recovering:!!engine.state.mode.recovering}:null,previousAssessment,durationLimits:situationLimits(engine.config),persona:{evolvingFacts:engine.config.personaEvolutionEnabled?activePersonaFacts(engine.profile.evolvingFacts,engine.now()).map(f=>({kind:f.kind,text:f.text})):[],name:engine.profile.name,background:String(engine.profile.background||'').slice(0,500),boundaries:String(engine.profile.boundaries||'').slice(0,1000),generalStyle:String(engine.profile.generalStyle||'').slice(0,3000)},lifeEvents:engine.state.active.map(e=>({name:e.name,stage:e.stageText,reaction:e.reaction?.label})),mood:prior.ok?{value:prior.mood,dims:prior.dims}:null,weather:engine.weatherSummary()});engine.semanticStatus={...classifier.status};
    if(disposed||dialogues.get(id)!==record)return;
    record.signals=authoritativeSituation(result);if(engine.bound(id)){engine.storeSituation(id,result);engine.evaluate(id,{dialogue:record.signals});}
  };
  const awaitCurrent=async id=>{while(!disposed){const record=dialogues.get(id);await record?.pending;if(dialogues.get(id)===record)return;}};
  const observe=(id,text)=>{
    if(!text)return;
    if(engine.bound(id)&&!(/本机操作者|诊断|模拟测试/.test(text)))engine.changes.activity(id,text,qqSessions.has(id)?'qq':'dsh');
    writeback.observe(id,text);
    dialogues.set(id,{text,at:engine.now(),signals:unknownSituation('pending')});
    if(engine.bound(id)){engine.currentDialogue={};engine.memorySelectionTopic=text.slice(-600);}
    if(engine.config.context||simulations.has(id)){const record=dialogues.get(id);record.pending=classifyCurrent(id).catch(e=>engine.log('情境处理失败：'+e.message));}
  };
  const list=()=>{try{return (ctx.agents.roots?.()||ctx.agents.list()||[]);}catch{return [];}};
  const writeback=new MemoryWriteback(engine,{tools:ctx.tools,agents:list});
  if(typeof ctx.provide==='function')ctx.provide('cenShuLifeShared',sharedLifeContext(engine,writeback));
  const tick=()=>{
    if(disposed)return;
    try{
      for(const [id,s]of simulations)if(s.expiresAt<engine.now())simulations.delete(id);
      engine.tick();void mentions.tick();void director?.refresh().catch(error=>engine.log('生活动态判断失败：'+error.message));sharing.sync();void drawing.tick()?.catch(error=>engine.log('画画灵感失败：'+error.message));void writeback.tick()?.catch(error=>engine.log('记忆写回失败：'+error.message));void timedEvents.tick();const agents=list();
      const moodTarget=engine.config.sessionIds[0];if(engine.config.enabled&&engine.config.moodLinked&&moodTarget){const m=readMood(engine.home,engine.config,moodTarget,engine.now());const revision=m.ok?JSON.stringify([m.updatedAt,Math.round(m.mood),Object.fromEntries(Object.entries(m.dims).map(([k,v])=>[k,Math.round(v)])),m.situation]):'';if(revision&&revision!==lastMoodRevision){lastMoodRevision=revision;engine.evaluate(moodTarget,{dialogue:signalsFor(moodTarget)});}}
      if(engine.config.sessionIds.length)void weather.refresh().catch(e=>engine.log('天气保存失败：'+e.message));
      if(engine.config.contentEvolutionEnabled&&engine.config.sessionIds.length)void evolution.refresh().catch(e=>engine.log('模型内容保存失败：'+e.message));
      if(engine.config.sessionIds.length&&engine.now()-lastPersonaCheck>=60000){lastPersonaCheck=engine.now();void personaLearning.refresh().catch(e=>engine.log('人物审核保存失败：'+e.message));}
      if(engine.now()-lastModeCheck>=60000){lastModeCheck=engine.now();const health=adapterHealth(engine.home,{startedAt:engine.startedAt});if(health.code!==lastHealthCode){engine.log('心情联动健康：'+health.message);lastHealthCode=health.code;}const weatherHealth=weatherPolicyHealth(engine.home,{startedAt:engine.startedAt});if(weatherHealth.code!==lastWeatherHealthCode){engine.log('天气主动策略健康：'+weatherHealth.message);lastWeatherHealthCode=weatherHealth.code;}if(engine.config.enabled&&engine.config.sessionIds[0]){const target=engine.config.sessionIds[0],last=dialogues.get(target);engine.evaluate(target,{dialogue:signalsFor(target)});}}
      for(const agent of agents){const sid=idOf(agent);if((!engine.bound(sid)&&!simulations.has(sid))||mounted.has(agent))continue;
        const offs=[];
        const safeContext=()=>{try{const current=dialogues.get(sid),fresh=current&&engine.now()-current.at<15*60000;const text=simulations.has(sid)?engine.simulate({...simulations.get(sid).fixture,...(fresh?{dialogue:signalsFor(sid)}:{})}).context:engine.context(sid,{dialogue:signalsFor(sid)});return text+(fresh?'\n【本轮对话焦点】刚收到的用户正文：'+JSON.stringify(current.text.slice(-500))+'。历史记忆和角色示例都不是本轮用户提问；先接这条消息的话题，心情只调整说法，不改变话题或补造事实。':'');}catch(e){engine.log('上下文失败 '+e.message);return '【岑舒生活】读取失败，保持角色卡平常口吻，不编造生活事件或心情。';}};
        offs.push(agent.ctx.systemPrompt.context({name:'cen-shu-life',order:925,text:()=>''}));
        offs.push(agent.ctx.on('system-prompt/assemble',async assembly=>{
          if(!engine.config.context&&!simulations.has(sid))return assembly;
          // Classification starts at inbox insertion. Await the same promise, then render once.
          await awaitCurrent(sid);if(disposed)return assembly;await director?.refresh({sessionId:sid,dialogue:signalsFor(sid),topic:dialogues.get(sid)?.text||''});await engine.innerLifePrepare?.({sessionId:sid,topic:dialogues.get(sid)?.text||''});if(disposed)return assembly;captureMemoryContexts(engine,sid,assembly.contexts||[]);
          const text=safeContext(),contexts=assembly.contexts||[];
          return {...assembly,contexts:contexts.some(c=>c.name==='cen-shu-life')?contexts.map(c=>c.name==='cen-shu-life'?{...c,text}:c):[...contexts,{name:'cen-shu-life',order:925,text}]};
        }));
        offs.push(agent.ctx.on('agent/inbox/inserted',p=>{const msg=p?.message||p;if(textOf(msg).includes('【会话令牌】'))qqSessions.add(sid);const text=incomingText(msg);observe(sid,text);}));
        // Observe only visible speech, including bridge send calls; never reasoning.
        offs.push(agent.ctx.on('agent/turn-stopping',()=>{dialogues.delete(sid);if(engine.bound(sid))engine.currentDialogue={};}));
        mounted.set(agent,{sid,offs});engine.log('已绑定动态上下文 '+sid);
      }
      for(const [agent,m]of mounted)if(!agents.includes(agent)||(!engine.bound(m.sid)&&!simulations.has(m.sid))){for(const off of m.offs)if(typeof off==='function')off();mounted.delete(agent);}
    }catch(e){engine.log('定时检查失败 '+e.message);}
  };
  tick();ctx.effect(()=>ctx.interval(tick,3000));
  ctx.effect(()=>ctx.on('session/event',(session,event)=>{
    const sid=session?.id||session?.sessionId;if(!engine.bound(sid)||!engine.config.enabled)return;
    const p=event?.data;
    if(event.type==='tool/call'&&p?.callId){projectCalls.set(p.callId,{name:p.name,at:engine.now()});if(projectCalls.size>200)projectCalls.delete(projectCalls.keys().next().value);}
    if(event.type==='tool/call'&&/^(memory|de_memory)$/.test(p?.name||'')){try{const args=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments;if(args?.action==='remove')calls.set(p.callId,{sid,memoryDelete:true,content:args.content,name:p.name});}catch{}}
    if(event.type==='tool/call'&&/^(memory|de_memory|qq_memory_query|mnemon_recall|memory_recall|openviking_search|engram_search|engram_facts|engram_neighbors|mdcg_recall|mdcg_search|lingshu_mdcg_recall|lingshu_mdcg_search|cg)$/.test(p?.name||'')){try{const args=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments;if((!args?.action||['list','expand','search','query','recall'].includes(args.action))&&(!args?.op||['read','route','recent','identity'].includes(args.op)))calls.set(p.callId,{sid,memory:true,name:p.name});}catch{}}
    if(event.type==='tool/call'&&/qq_(?:wait_for_messages|get_unread_messages)$/.test(p?.name||''))calls.set(p.callId,{sid,incoming:true});
    if(event.type==='assistant/message'&&!qqSessions.has(sid))engine.noteMention(textOf(p?.message),engine.now(),p?.message?.id);
    if(event.type==='tool/call'&&/qq_send_message|qq_reply$/.test(p?.name||'')){
      try{const a=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments;calls.set(p.callId,{sid,text:[a?.messages,a?.text].flat().filter(x=>typeof x==='string').join('\n')});qqSessions.add(sid);}catch{}
    }
    if(event.type==='tool/result'){
      const id=p?.message?.toolCallId,call=calls.get(id);calls.delete(id);const project=projectCalls.get(id);projectCalls.delete(id);if(project)captureProjectEvidence(engine,{id,name:project.name,sessionId:sid,message:p.message});
      if(call&&!p?.message?.isError){if(call.memoryDelete){try{const result=JSON.parse(textOf(p.message));if(result.ok===true)revokeDeletedMemory(engine,call.content,call.name);}catch{}}else if(call.memory){let text=textOf(p.message);try{const value=JSON.parse(text),rows=[];const walk=(v,depth=0)=>{if(depth>5)return;if(typeof v==='string'){if(v.length<=1000)rows.push(v);}else if(Array.isArray(v))v.slice(0,32).forEach(x=>walk(x,depth+1));else if(v&&typeof v==='object')for(const key of ['entries','items','results','memories','records','record','nodes','node','text','content','summary','memory'])if(v[key])walk(v[key],depth+1);};walk(value);text=rows.join('\n');}catch{}captureMemoryContexts(engine,sid,[{name:'memory:tool:'+call.name,text}]);}else if(call.incoming){const text=incomingToolText(p.message);observe(sid,text);}else{const result=textOf(p.message);if(!/"ok"\s*:\s*false|"error"\s*:/.test(result))engine.noteMention(call.text,engine.now(),id);}}
    }
  }));
  ctx.effect(()=>()=>{disposed=true;mentions.disposed=true;if(director)director.disposed=true;drawing.disposed=true;writeback.disposed=true;engine.memorySelectionDisposed=true;timedEvents.disposed=true;weather.disposed=true;evolution.disposed=true;personaLearning.disposed=true;for(const m of mounted.values())for(const off of m.offs)if(typeof off==='function')off();mounted.clear();});
  ctx.effect(()=>ctx.tools.register({
    name:'censhu_life_context',
    description:'读取本插件设置中最新的岑舒生活、事件及当前行为指令。每轮可直接调用，无需在聊天消息中复制设定。只读心情，不发送消息；仅对绑定的岑舒会话开放。',
    parameters:{type:'object',properties:{},additionalProperties:false},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(_args,exec){const sid=idOf(exec.agent);if(!simulations.has(sid)&&(!engine.bound(sid)||!engine.config.enabled))throw Error('当前会话未绑定岑舒生活插件');await awaitCurrent(sid);if(!simulations.has(sid)){await director?.refresh({sessionId:sid,dialogue:signalsFor(sid),topic:dialogues.get(sid)?.text||''});await engine.innerLifePrepare?.({sessionId:sid,topic:dialogues.get(sid)?.text||''});}if(simulations.has(sid))return engine.simulate({...simulations.get(sid).fixture,dialogue:signalsFor(sid)}).context;return engine.context(sid,{manual:true,dialogue:signalsFor(sid)});}
  }));
  ctx.effect(()=>ctx.tools.register({name:'censhu_memory_review',description:'使用已配置的Gemini审核、压缩、去重和过滤DSH记忆。适用于所有会话；提供从已安装记忆插件查询的条目，返回逐条决定及压缩文本，再通过原有memory/Mnemon/OpenViking工具保存，不另建记忆库。',parameters:{type:'object',additionalProperties:false,required:['entries'],properties:{entries:{type:'array',items:{type:'string'},minItems:1,maxItems:24}}},output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},async execute(args){if(!engine.config.enabled)throw Error('生活与记忆模型辅助已关闭');return JSON.stringify(await reviewMemory(args.entries,engine.config));}}));
  const guard=createRequestGuard();
  const send=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  const route=(suffix,handler)=>ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/dsh-cen-shu-life'+suffix,handler:async(req,res)=>{try{guard.check(req,suffix);await handler(req,res);}catch(e){if(!e.status)engine.log('设置请求失败 '+e.message);send(res,e.status||400,{ok:false,error:e.message});}}}));
  const postOnly=req=>{if(req.method!=='POST')throw Error('需要 POST');};
  route('/state',(req,res)=>{if(req.method!=='GET')return send(res,405,{ok:false,error:'需要 GET'});send(res,200,{...engine.snapshot(),memoryWriteback:writeback.view(),csrfToken:guard.token});});
  route('/memory/health',async(req,res)=>{postOnly(req);const agent=list().find(a=>engine.bound(idOf(a)));if(!agent)throw Error('请先载入岑舒会话');const results=[];for(const [name,args] of [['engram_stats',{}],['memory',{action:'list',target:'project'}],['mdcg_health',{}]]){if(!ctx.tools.get(name,agent)){results.push({name,ok:false,error:'工具未就绪'});continue;}try{const r=await ctx.tools.execute({name,arguments:args,agent,callId:'censhu-health-'+Date.now()+'-'+name,signal:AbortSignal.timeout(30000)});const value=unwrapMemoryResult(r);results.push({name,ok:value?.ok!==false&&value?.isError!==true,...(value?.ok===false?{error:value.error||value.message||'原插件健康检查未通过'}:{})});}catch(e){results.push({name,ok:false,error:e.message});}}try{const ov=ctx.get?.('openvikingMemory'),health=await ov?.client?.healthResult();results.push({name:'openviking',ok:health?.ok===true});}catch(e){results.push({name:'openviking',ok:false,error:e.message});}send(res,200,{ok:results.every(r=>r.ok),results});});
  route('/memory/retry',async(req,res)=>{postOnly(req);const count=writeback.retryFailed();void writeback.tick().catch(e=>engine.log('记忆重试失败：'+e.message));send(res,200,{ok:true,count,status:writeback.view()});});
  route('/memory/review',async(req,res)=>{postOnly(req);const b=await body(req);if(typeof b.text!=='string'||b.text.length<4||b.text.length>3000||!engine.bound(b.sessionId))throw Error('需要绑定会话和真实原话（4至3000字）');writeback.observe(b.sessionId,b.text);await writeback.tick();send(res,200,{ok:true,status:writeback.view()});});
  route('/semantic/test',async(req,res)=>{postOnly(req);const b=await body(req);if(typeof b.text!=='string'||!b.text.trim()||b.text.length>3000)throw Error('请输入1至3000字的测试发言');const value=await classifier.resolve('semantic-test',b.text,engine.config);engine.semanticStatus={...classifier.status};send(res,200,{ok:true,value,status:classifier.status});});
  route('/weather/update',async(req,res)=>{postOnly(req);send(res,200,{ok:true,result:await weather.refresh(true)});});
  route('/persona/update',async(req,res)=>{postOnly(req);send(res,200,{ok:true,result:await personaLearning.refresh(true)});});
  route('/content/update',async(req,res)=>{postOnly(req);send(res,200,{ok:true,result:await evolution.refresh(true)});});
  route('/integrations/weather-policy/repair',async(req,res)=>{
    postOnly(req);let root=fileURLToPath(new URL('../../dsh-censhu-policy',import.meta.url));
    const metaFile=path.join(engine.dir,'weather-policy-install.json');if(fs.existsSync(metaFile)){const meta=JSON.parse(fs.readFileSync(metaFile,'utf8'));const file=fileURLToPath(meta.moduleUrl);if(path.basename(file)!=='index.mjs')throw Error('天气主动策略目标文件无效');root=path.dirname(file);}
    if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).name!=='dsh-censhu-policy')throw Error('目标不是 dsh-censhu-policy');
    await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/install-weather-policy.mjs',import.meta.url)),root],{env:{...process.env,DSH_HOME:engine.home,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true});send(res,200,{ok:true,health:weatherPolicyHealth(engine.home,{startedAt:engine.startedAt})});
  });
  route('/integrations/mood/repair',async(req,res)=>{postOnly(req);const meta=JSON.parse(fs.readFileSync(path.join(engine.dir,'mood-link-install.json'),'utf8')),file=fileURLToPath(meta.moduleUrl),root=path.dirname(path.dirname(file));if(path.basename(file)!=='index.js'||JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).name!=='dsh-feiyu-mood')throw Error('适配目标不是 dsh-feiyu-mood');execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/install-mood-link.mjs',import.meta.url)),root],{env:{...process.env,DSH_HOME:engine.home,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});send(res,200,{ok:true,health:adapterHealth(engine.home,{startedAt:engine.startedAt})});});
  route('/config',async(req,res)=>{if(req.method==='GET')return send(res,200,{ok:true,config:engine.config});postOnly(req);engine.saveConfig(await body(req));tick();send(res,200,{ok:true,config:engine.config});});
  route('/qzone/decision',async(req,res)=>{postOnly(req);const value=sharing.decide(await body(req));send(res,200,{ok:true,value});});
  route('/qzone/receipt',async(req,res)=>{postOnly(req);const value=sharing.receipt(await body(req));send(res,200,{ok:true,value});});
  route('/drawing/claim',async(req,res)=>{postOnly(req);const b=await body(req);if(!engine.bound(b.sessionId))throw Error('灵感会话未绑定');send(res,200,{ok:true,value:drawing.claimInitiative(b.eventId)});});
  route('/drawing/begin',async(req,res)=>{postOnly(req);const b=await body(req);if(!engine.bound(b.sessionId))throw Error('灵感会话未绑定');send(res,200,{ok:true,value:drawing.begin(b.eventId)});});
  route('/drawing/result',async(req,res)=>{postOnly(req);const b=await body(req);if(!engine.bound(b.sessionId))throw Error('灵感会话未绑定');send(res,200,{ok:true,value:drawing.result(b)});});
  route('/profile',async(req,res)=>{if(req.method==='GET')return send(res,200,{ok:true,profile:engine.profile});postOnly(req);send(res,200,{ok:true,profile:engine.saveProfile(await body(req))});});
  route('/event',async(req,res)=>{postOnly(req);const b=await body(req);let value;if(b.action==='add')value=engine.add(b.templateId,{manual:true});else if(b.action==='end')value=engine.end(b.id,'操作者手动结束');else if(b.action==='reset'){for(const e of [...engine.state.active])engine.end(e.id,'操作者重置，保留历史与冷却');value=true;}else throw Error('未知事件操作');send(res,200,{ok:true,value});});
  route('/simulate',async(req,res)=>{postOnly(req);send(res,200,{ok:true,...engine.simulate(await body(req))});});
  route('/simulate/judge',async(req,res)=>{
    postOnly(req);const b=await body(req),install=engine.read('mood-link-install.json',{});
    if(!install.installed||!install.moduleUrl)throw Error('尚未安装原心情插件的生活联动适配');
    const agent=list().find(a=>engine.bound(idOf(a)));if(!agent)throw Error('请先载入岑舒会话');
    const template=engine.allTemplates().find(e=>e.id===b.templateId);if(!template)throw Error('请选择模拟事件');
    let seed=Number(b.seed)||42;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
    const reaction=sampleLifeReaction(template,'start',engine.reactions,{...engine.config,lifeMoodEnabled:true,lifeMoodChance:1},random);
    const id='simulation:'+engine.now(),lifeInputs=[{id,event:template.name,phase:'start',stage:template.stages[0].text,at:engine.now(),reaction:{label:reaction.label,text:reaction.text,suggestedMoodDelta:reaction.moodDelta,suggestedDims:reaction.dims}}];
    const {simulateLifeJudgment}=await import(install.moduleUrl);
    const judged=await simulateLifeJudgment(ctx,agent,{initialState:b.initialState,userText:b.userText,reply:b.reply,lifeInputs});
    const mood={ok:true,mood:judged.after.mood,baseline:70,dims:judged.after.dims,delta:judged.delta.dims,confidence:judged.after.lastConfidence,updatedAt:judged.after.updatedAt};
    const dialogue=await classifier.resolve('simulation-judge',b.nextUserText||'',engine.config);
    const behavior=engine.simulate({mood,dialogue,eventId:template.id});
    send(res,200,{ok:true,...judged,reaction,behavior,fixture:{mood,dialogue,eventId:template.id}});
  });
  route('/simulate/session',async(req,res)=>{postOnly(req);const b=await body(req);if(typeof b.sessionId!=='string'||!/^session-[a-zA-Z0-9-]+$/.test(b.sessionId)||engine.bound(b.sessionId))throw Error('仅允许独立测试会话，不能覆盖正式岑舒会话');if(b.clear)simulations.delete(b.sessionId);else{engine.simulate(b.fixture||{});simulations.set(b.sessionId,{fixture:b.fixture||{},expiresAt:engine.now()+20*60000});}tick();send(res,200,{ok:true,simulation:true,expiresMinutes:20});});
  // Local DSH plugin routes; modifications above enforce the request origin.
  route('/settings',(req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"frame-ancestors 'self'"});res.end(fs.readFileSync(fileURLToPath(new URL('../settings.html',import.meta.url))));});
  engine.log('生活插件启动；Gemini决策生活与行为，数值交给鱼的心情；不直接发送消息');
}
