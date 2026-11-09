import {geminiPauseStatus} from './gemini-pause.js';
import {withTrace,usageOf} from './gemini-telemetry.js';
import {textLeaves} from './qq-grounding.js';
import {writebackContext} from './writeback-context.js';
import {executeHostTool} from './host-tools.js';
import {installWorkspaceBindings} from './workspace-bindings.js';
import {runtimeRecovery,resetFailure} from './runtime-recovery.js';
import {SocialExperience,socialTool,createSocialHash} from './social-experience.js';
import {createDesktopBindings,desktopReplyPair} from './desktop-bindings.js';
import {planToolsPrompt,roleContextBudget,planSchema,planPrompt} from './context-budget.js';
import {installRequestProjector,previewRequestProjectors,requestProjectorStatus} from './request-projection.js';
import {createRequestContext,requestSchemaFor,requestPlanPrompt,isLocalReplayRequest} from './request-context.js';
import {installReplyExpression} from './reply-expression.js';
import {isReadOnlyTool} from './tool-semantics.js';
import {installContextLifecycle} from './context-lifecycle.js';
import {fileRecords,supportsExcerpt} from './historical-memory.js';
import {externalChecker} from './memory-source-tracking.js';
import {extraMemory,extraReadTool} from './extra-memory.js';
import {petCorrection} from './pet-correction.js';
import {syncLingshuDeletes} from './lingshu-deletions.js';
import {correctionTool,inspectTracked} from './memory-correction.js';
import {memoryDenied} from './reviewed-write.js';
import {owner as agencyOwner,signal as agencySignal,current as agencyCurrent} from './censhu-control.mjs';
import {RhythmPlanner} from './rhythm.js';
import {installQqGrounding,qqGroundingContext,readShortReplyContexts} from './qq-grounding.js';
import {SemanticMentions} from './semantic-mentions.js';
import {captureProjectEvidence} from './project-evidence.js';
import {PersonalSettings} from './personal-settings.js';
import {LifeDirector} from './life-director.js';
import {PersonaLearning} from './persona-learning.js';
import {EventSharing} from './event-sharing.js';
import {DrawingInspiration} from './drawing-inspiration.js';
import {sharedLifeContext} from './shared-context.js';
import {herSubagent,SUBAGENT_HEADER,SUBAGENT_POLICY} from './subagent-state.js';
import {lowMemorySession,workPlatform} from './memory-writeback.js';
import {shapeWorkParts,pinQqStyle,backgroundPausedNote,splitQqOnlyBlocks,shapeHostPrompt,nameParts,callHerName} from './work-context.js';
import {currentStateView} from './current-state.js';
import {createHelpTool} from './help-tool.js';
// 2026-11-08：工作会话的标题按平台分开（原来 B站会话也写成“抖音工作会话”）。
// 2026-11-08：三种工作会话（抖音、B站、浏览器）的称呼和“这里做什么”。
const WORK_KINDS={douyin:{name:'抖音',does:'抖音的事（刷视频、私信与评论、重看）'},bili:{name:'B站',does:'B 站的事（刷视频、私信评论与直播间、重看）'},browser:{name:'浏览器',does:'你在主动回合里决定的自主浏览'}};
const workKind=sid=>WORK_KINDS[workPlatform(sid)]||WORK_KINDS.douyin;
const workLabel=sid=>'【'+workKind(sid).name+'工作会话】';
import {judgeParallel,decisionText,MAX_TASKS} from './parallel-judge.js';
import {MoodBudget} from './mood-budget.js';
import {MemoryWriteback,shortReply,unwrapMemoryResult} from './memory-writeback.js';
import {LegacyMemoryReview} from './legacy-memory-review.js';
import {createKnowledgeService} from './knowledge/service.js';
import {TimedEvents} from './timed-events.js';
import {reviewMemory} from './memory-review.js';
import {captureMemoryContexts,revokeDeletedMemory,activePersonaFacts} from './persona-evolution.js';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {LifeEngine,readMood} from './engine.js';
import {sampleLifeReaction} from './mood-link.js';
import {OPERATOR_TEXT,googleStructured,googlePlanWithTools,SituationClassifier,authoritativeSituation,unknownSituation,situationLimits,situationFromRecord} from './situation.js';
import {createRequestGuard} from './request-guard.js';
import {weatherPolicyHealth} from './weather-policy-health.js';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {adapterHealth} from './adapter-health.js';
import {DailyWeather} from './weather.js';
import {ContentEvolution} from './content-evolution.js';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
// 2026-11-07: test-workspace detection comes from the inner-life isolation module; without it nothing is mirrored.
let testSessionCheck=()=>false;
import(new URL('../../dsh-censhu-inner-life/lib/isolation.js',import.meta.url).href).then(m=>{if(typeof m.isTestSession==='function')testSessionCheck=m.isTestSession;}).catch(()=>{});
export function setTestSessionCheck(fn){testSessionCheck=typeof fn==='function'?fn:()=>false;}
export const name='cen-shu-life';
export const inject=['agents','webServer','timer','tools','llm','workspaceRegistry'];
const idOf=a=>a?.session?.id||a?.session?.sessionId||a?.id||'';
function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>65536)reject(Error('请求过大'));});req.on('end',()=>{try{resolve(JSON.parse(b||'{}'));}catch{reject(Error('无效 JSON'));}});req.on('error',reject);});}
function textOf(message){return (message?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');}
function incomingRows(message,tool=false){
 const text=textOf(message),marker='【本次消息快照】';
 try{
   const raw=tool?text.slice(text.indexOf('{')):text.split(marker)[1].trimStart().split('\n')[0];
   const p=JSON.parse(raw),rows=tool?(p.newMessages||p.messages||p.unread||[]):p.messages;
   return Array.isArray(rows)?rows.filter(x=>x&&!x.isSelf&&typeof x.text==='string'&&x.text.trim()):[];
 }catch{return [];}
}
export function incomingToolText(message){return incomingRows(message,true).map(x=>x.text).join('\n').slice(-3000);}
export function incomingText(msg){
  const source=String(msg?.source?.kind||'');
  if(source.startsWith('plugin:'))return '';
  if(['plugin:dsh-censhu-agency','dsh-censhu-agency','plugin:dsh-censhu-inner-life','plugin:censhu-inner-life','censhu-inner-life','censhu-inner-life-notice','speak-up','schedule','cron','memory','cen-shu-life','dsh-mnemon','dsh-memory-evolve','runtime-context','time-context','system-reminder','system','time-sampled','goal','goal-round','subagent','subagent-notice','tool-registry','cordis-host-runner','agent-instructions','system-prompt','model','plugin'].includes(source)||/^(subagent|goal|tool-|system-|schedule)/.test(source))return '';
  const text=textOf(msg),marker='【本次消息快照】';
  if(text.includes(marker)){
    return incomingRows(msg).map(x=>x.text).join('\n').slice(-3000);
  }
  // Bridge wakeups/reminders and operator metadata are not Qingqin speaking.
  if(/【会话令牌】|【引导唤醒】|【唤醒提醒】|【QQ/.test(text))return '';
  return text.slice(-3000);
}
export const apply=ctx=>createHost(ctx);
export function createHost(ctx,{engine=new LifeEngine(),classifier=new SituationClassifier(),director:providedDirector,requestPlanner:providedRequestPlanner,budgetPlanner:providedBudgetPlanner}={}){
  if(ctx.tools?.guard)ctx.effect(()=>ctx.tools.guard(exec=>{
    if(!memoryDenied(exec))return;
    const id=idOf(exec.agent);if(!id)return;
    const lifeId=engine.read('../censhu-inner-life/display-session.json',{}).sessionId;
    if(engine.bound(id)||id===lifeId)return '请先用原库的查询工具核对原文。更正或遗忘一条记忆可调用 censhu_correct_memory，OpenViking 和 QQ 轻量记忆可用 censhu_read_memory 查原文。真实来信中的新记忆走审核队列；生活经历通过 censhu_agency_diary 提交。';
  }));
  const mounted=new Map(),privateMounted=new Map(),mirrorMounted=new Map(),childMounted=new Map(),workMounted=new Map(),workGuides=new Set(),dialogues=new Map(),calls=new Map(),qqSessions=new Set(),simulations=new Map();let disposed=false,lastModeCheck=0,lastPersonaCheck=0,lastHealthCode='',lastWeatherHealthCode='',lastMoodRevision='';
  ctx.effect(()=>installQqGrounding(ctx,engine));
  ctx.effect(()=>installReplyExpression(ctx,engine));
  engine.personalSettings=new PersonalSettings(engine,()=>ctx.get?.('cosplay'));
  engine.config.dynamicRhythm=true;const rhythm=new RhythmPlanner(engine);const mentions=new SemanticMentions(engine);const projectCalls=new Map();
  const director=providedDirector===false?null:(providedDirector||new LifeDirector(engine));
  engine.moodBudget=new MoodBudget(engine);const personaLearning=new PersonaLearning(engine),evolution=new ContentEvolution(engine),weather=new DailyWeather(engine),timedEvents=new TimedEvents(engine),sharing=new EventSharing(engine),drawing=new DrawingInspiration(engine);
  const signalsFor=id=>{const record=dialogues.get(id);const value=authoritativeSituation(record?.signals?.source==='semantic-model'?situationFromRecord({source:'semantic-model',at:record.at,value:record.signals,evidenceExpiresAt:Object.fromEntries(Object.entries(situationLimits(engine.config)).map(([k,cap])=>[k,record.at+Math.min(cap,record.signals.durationMinutes?.[k]??cap)*60000]))},engine.now(),engine.config.situationValidityMinutes*60000,situationLimits(engine.config)):record&&engine.now()-record.at<engine.config.careValidityMinutes*60000?record.signals:null);return ['trusted','care-fallback'].includes(value.semanticState)?value:{};};
  const classifyCurrent=async id=>{
    const record=dialogues.get(id);if(!record||OPERATOR_TEXT.test(record.text)||/只读.*(?:复核|验收)/.test(record.text))return;
    const prior=engine.config.moodLinked?readMood(engine.home,engine.config,id,engine.now()):{};
    const open=engine.situations.interpretations?.[id.replace(/^session-/,'')],previousAssessment=open&&open.at<=engine.now()&&engine.now()<Math.min(open.expiresAt??open.at+20*60000,open.at+engine.config.situationValidityMinutes*60000)?open:null;
    const result=await classifier.resolve(id,record.text,engine.config,{previousSituation:prior.situation||null,previousMode:engine.state.mode?{id:engine.state.mode.id,recovering:!!engine.state.mode.recovering}:null,previousAssessment,durationLimits:situationLimits(engine.config),persona:{evolvingFacts:engine.config.personaEvolutionEnabled?activePersonaFacts(engine.profile.evolvingFacts,engine.now()).map(f=>({kind:f.kind,text:f.text})):[],name:engine.profile.name,background:String(engine.profile.background||'').slice(0,500),boundaries:String(engine.profile.boundaries||'').slice(0,1000),generalStyle:String(engine.profile.generalStyle||'').slice(0,3000)},lifeEvents:engine.state.active.map(e=>({name:e.name,stage:e.stageText,reaction:e.reaction?.label})),mood:prior.ok?{value:prior.mood,dims:prior.dims}:null,weather:engine.weatherSummary()});engine.semanticStatus={...classifier.status};
    if(disposed||dialogues.get(id)!==record)return;
    record.signals=authoritativeSituation(result);if(engine.bound(id)){engine.storeSituation(id,result);engine.evaluate(id,{dialogue:record.signals});}
  };
  const awaitCurrent=async id=>{while(!disposed){const record=dialogues.get(id);await record?.pending;if(dialogues.get(id)===record)return;}};
  const observe=(id,text,rows=[],replyTo,messageId)=>{
    if(!text)return;
    const previous=dialogues.get(id);
    if(messageId&&previous?.messageId===messageId){
      if(replyTo&&!previous.replySeen){writeback.observe(id,text,null,replyTo,messageId);previous.replySeen=true;}
      return;
    }
    if(engine.bound(id)&&!OPERATOR_TEXT.test(text))engine.changes.activity(id,text,qqSessions.has(id)?'qq':'dsh');
    if(rows.length){
      const short=rows.filter(row=>shortReply(row.text)&&row.messageId!=null);
      let pairs=new Map();
      if(short.length&&engine.config.memoryWritebackEnabled&&engine.bound(id)){try{pairs=readShortReplyContexts(id,short);}catch{/* Missing or stale records cannot authorize writeback. */}}
      for(const row of rows)writeback.observe(id,row.text,null,pairs.get(String(row.messageId)),row.messageId);
    }else writeback.observe(id,text,null,replyTo,messageId);
    dialogues.set(id,{text,messageId,replySeen:!!replyTo,at:engine.now(),signals:unknownSituation('pending')});
    if(engine.bound(id)){engine.currentDialogue={};engine.memorySelectionTopic=text.slice(-600);}
    if(engine.config.context||simulations.has(id)){const record=dialogues.get(id);record.pending=classifyCurrent(id).catch(e=>engine.log('情境处理失败：'+e.message));}
  };
  let contextLifecycle;
  const list=()=>{try{return (ctx.agents.roots?.()||ctx.agents.list()||[]);}catch{return [];}};
  const desktopBindings=createDesktopBindings(engine,()=>ctx.get?.('cosplay',false),()=>ctx.workspaceRegistry);
  const sessionKey=id=>String(id||'').replace(/^session-/,'');
  const resolveAgent=id=>{
    try{const agent=ctx.agents.get?.(id);if(agent)return agent;}catch{}
    try{return (ctx.agents.list?.()||list()).find(agent=>sessionKey(idOf(agent))===sessionKey(id));}catch{return undefined;}
  };
  // Presentation of capabilities is task-dependent for every live session,
  // including default desktop sessions and child agents. Role-specific life
  // data remains restricted to the original bound/private-life sessions.
  const eligibleRequest=request=>Boolean(!disposed&&resolveAgent(request?.sessionId));
  const eligibleRoleRequest=request=>{
    const agent=resolveAgent(request?.sessionId);if(!agent||disposed)return false;
    const lifeId=engine.read('../censhu-inner-life/display-session.json',{}).sessionId;
    return engine.bound(idOf(agent))||Boolean(lifeId&&sessionKey(lifeId)===sessionKey(idOf(agent)));
  };
  const requestContext=createRequestContext({
    planScope:()=>[engine.config.semanticEnabled,engine.config.semanticModel,engine.config.semanticProxyUrl],
    resolveAgent,resolveTurn:session=>contextLifecycle?.currentTurn(session),
    isSessionArchived:id=>contextLifecycle?.isArchived(id)===true,
    isSessionRetired:session=>contextLifecycle?.isRetired(session)===true,
    storeDirectory:path.join(engine.dir,'request-originals'),
    // One JSON line per projected request; rotated to .1 past 2 MB.
    onRecord:row=>{
      const file=path.join(engine.dir,'request-context-log.jsonl');
      try{if(fs.statSync(file).size>2*1024*1024)fs.renameSync(file,file+'.1');}catch{}
      fs.appendFileSync(file,JSON.stringify(row)+'\n');
    },
    plan:providedRequestPlanner||(input=>{
      if(!engine.config.semanticEnabled)throw Error('生活语义模型已关闭；保留原始工具与结果');
      return googleStructured(requestPlanPrompt,requestSchemaFor(input),input,engine.config,{
        feature:'request-context-selection',signal:AbortSignal.timeout(20000),maxOutputTokens:8192
      });
    })
  });
  const projectionHealth={ready:false,code:'waiting',error:null};
  const requestStatus=()=>{
    const native=requestProjectorStatus(ctx.llm);
    return {projection:{...projectionHealth,native,ready:projectionHealth.ready&&native.installed&&native.projectors.some(p=>p.id==='cen-shu-life:request-context')},sessions:requestContext.status()};
  };
  const budget=roleContextBudget({
    onSelection:r=>{try{knowledge.selected(r);}catch{}},
    // 2026-11-08：每次预算决定一行，只有名字和数字；超过 2 MB 换到 .1。
    onDecision:row=>{
      const file=path.join(engine.dir,'context-budget-log.jsonl');
      try{if(fs.statSync(file).size>2*1024*1024)fs.renameSync(file,file+'.1');}catch{}
      fs.appendFileSync(file,JSON.stringify(row)+'\n');
    },
    readState:()=>{const role=engine.read('../characters/censhu/integration.json',{}).sessionId,sid=role&&engine.bound(role)?role:engine.config.sessionIds[0];return sid&&engine.bound(sid)?JSON.stringify(currentStateView(engine,{sessionId:sid,recovery:recoveryRuntime.state})):null;},
    toolsFor:agent=>typeof ctx.tools?.schemas==='function'?ctx.tools.schemas(agent):null,
    prepareBasis:async({request})=>requestContext.transform(await previewRequestProjectors(ctx.llm,request,{beforePriority:30})),
    planScope:()=>[engine.config.semanticEnabled,engine.config.semanticModel,engine.config.semanticProxyUrl],
    isSessionArchived:id=>contextLifecycle?.isArchived(id)===true,
    isSessionRetired:session=>contextLifecycle?.isRetired(session)===true,
    resolveTurn:session=>contextLifecycle?.currentTurn(session),
    resolveWindow:async(provider,model)=>provider&&model?(await ctx.llm?.resolveModelInfo?.(provider,model,AbortSignal.timeout(3000)))?.context?.contextWindow:0,
    plan:providedBudgetPlanner||((input,{signal,tools,trace}={})=>{
      if(!engine.config.semanticEnabled)throw Error('生活语义模型已关闭');
      // 2026-11-08：Gemini 可以先用只读工具看情况，所以时限放宽到 20 秒，输出上限也放宽，免得 JSON 被截断。
      return googlePlanWithTools(planPrompt,planSchema,input,engine.config,{feature:'role-context-budget',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),maxOutputTokens:Math.min(8192,2000+input.candidates.length*12),tools,trace,toolPrompt:planToolsPrompt});
    })
  });
  // 2026-11-09：她的所有会话（主会话、工作会话、主动进行、独处）都先整理 DSH 自带的说明，见 work-context.js。
  // 2026-11-09：拿出来的说明按会话留一份，censhu_help 查得到，不管 Gemini 这一步选没选。
  const helpGuides=new Map(),helpDocs=new Map();
  const assembleHer=(agent,next,collect,options,withHint=false)=>budget.assemble(agent,next,assembly=>{
    const host=shapeHostPrompt(assembly,{keepBrowserRouting:workPlatform(idOf(agent))==='browser'}),hid=idOf(agent);
    if(host.parts.length||host.manual.length){let kept=helpGuides.get(hid);if(!kept){if(helpGuides.size>=64)helpGuides.delete(helpGuides.keys().next().value);kept=new Map();helpGuides.set(hid,kept);}for(const p of [...host.parts,...host.manual])kept.set(p.key,p.text);}
    if(host.parts.length)budget.add(host.assembly,agent,'contexts','host-guidance',host.parts,()=>{});
    // 主会话和工作会话的提示写在 state:tool-hint 里；主动进行和独处走这里。
    if(withHint)budget.add(host.assembly,agent,'contexts','help-hint',[{owner:'life',required:true,key:'help:tool-hint',text:'【不知道怎么做时】遇到错误或不知道怎么做时，用 censhu_help 查，不带参数就是总的完整说明：工具、技能、MCP、子代理，以及定时任务、目标、workflow、文件读写、搜索、命令行、后台任务这些操作的用法都在里面，这次没带的工具也能在那里载入。只读。'}],()=>{});
    return collect(host.assembly);
  },options);
  ctx.effect(()=>ctx.tools.register(budget.recallTool()));
  for(const tool of requestContext.tools())ctx.effect(()=>ctx.tools.register(tool));
  ctx.effect(()=>()=>{requestContext.dispose();budget.dispose();});
  ctx.effect(()=>{
    const lifecycle=installContextLifecycle(ctx,id=>{budget.forget(id);requestContext.forget(id);},{
      startTurn:(id,turn)=>{budget.startTurn(id,turn);requestContext.startTurn(id,turn);},
      endTurn:(id,turn)=>{budget.endTurn(id,turn);requestContext.endTurn(id,turn);}
    });contextLifecycle=lifecycle;
    return ()=>{lifecycle.dispose();if(contextLifecycle===lifecycle)contextLifecycle=undefined;};
  });
  ctx.effect(()=>{
    try{
      const onError=error=>{projectionHealth.error=error.message;projectionHealth.code='degraded';engine.log('最终请求投影保留原文：'+error.message);};
      const off=installRequestProjector(ctx.llm,{id:'cen-shu-life:request-context',priority:30,onError,project:request=>withTrace('req:'+String(request.sessionId||'')+':'+Date.now().toString(36),async()=>{
        if(!eligibleRequest(request))return request;
        const toolsSelected=await requestContext.transform(request);
        if(disposed||request.signal?.aborted||!eligibleRequest(request))return request;
        // Locally replayed display turns never reach a provider: no budget planning either.
        if(isLocalReplayRequest(request))return toolsSelected;
        const projected=eligibleRoleRequest(request)?await budget.prepareRequest(toolsSelected):toolsSelected;
        if(disposed||request.signal?.aborted||!eligibleRequest(request))return request;
        // Count the adapter-bound projection; provider wire normalization and
        // billing are still distinguished from this local estimate.
        budget.observe(projected);
        projectionHealth.code='ready';projectionHealth.error=null;projectionHealth.lastRequestAt=Date.now();
        return projected;
      })});
      projectionHealth.ready=true;projectionHealth.code='ready';
      return ()=>{off();projectionHealth.ready=false;projectionHealth.code='disposed';};
    }catch(error){projectionHealth.error=error.message;projectionHealth.code='unsupported';engine.log('最终请求投影未接入：'+error.message);return()=>{};}
  });
  const writeback=new MemoryWriteback(engine,{tools:ctx.tools,agents:list,contextWindow:writebackContext({agents:list,idOf})});
  // 2026-11-09: main-model usage per turn, for her own sessions only; shows whether a session's input keeps growing.
  const logMainUsage=(sid,data)=>{try{const usage=usageOf(data?.usage);if(!usage||!(engine.bound(sid)||knowledge.isPrivateSession(sid)))return;const file=path.join(engine.dir,'main-usage.jsonl');try{if(fs.statSync(file).size>2*1024*1024)fs.renameSync(file,file+'.1');}catch{}fs.appendFileSync(file,JSON.stringify({at:engine.now(),sessionId:sid,model:data?.message?.source?.model||null,usage})+'\n');}catch{}};
  // 2026-11-06：旧记忆复核（Gemini 决定保留、改写或移除，经 engram 自己的工具执行）。
  const legacyReview=new LegacyMemoryReview(engine,{tools:ctx.tools,agents:list});
  // 2026-11-06：长期知识协调与质量治理（整理、重要度与活跃度、质量评估各自独立运行；失败不影响聊天、不删记忆）。
  const knowledge=createKnowledgeService({engine,generateBase:googleStructured,idOf,llm:ctx.llm,agents:list});engine.knowledgeContext=sid=>knowledge.contextParts(sid);
  // Diagnostics run as the role session (integration.json), then any non-private bound session. The private display session is gated by inner-life and only accepts calls inside an agency turn.
  const roleAgent=()=>{const agents=list(),role=engine.read('../characters/censhu/integration.json',{}).sessionId;return agents.find(a=>role&&idOf(a)===role&&engine.bound(role))||agents.find(a=>engine.bound(idOf(a))&&!knowledge.isPrivateSession(idOf(a)))||agents.find(a=>engine.bound(idOf(a)));};
  ctx.effect(()=>ctx.tools.register(knowledge.tool));writeback.getService=name=>ctx.get?.(name);
  const extra=extraMemory(engine,()=>ctx.get?.('openvikingMemory'));
  const verifySources=externalChecker(engine,async row=>{
    if(row.file){
      const sources=new Set([...engine.config.personaMemoryFiles,'MEMORY.md','USER.md']);
      if(!sources.has(row.file))throw Error('原文件暂不在有效来源中');
      const matches=fileRecords(engine.home,row.file).filter(record=>supportsExcerpt(record,row.text));
      return {absent:matches.length===0};
    }
    const a={...row,action:'replace',original:row.text};
    if(['openviking','qq'].includes(row.backend))return extra.inspect(a,row.sid,row.text);
    const agent=list().find(v=>idOf(v)===row.sid);if(!agent)throw Error('会话未载入');
    const name=row.backend==='de_memory'&&!ctx.tools.get('de_memory',agent)?'memory':row.backend;
    return inspectTracked(a,row.text,agent,ctx.tools,undefined,name);
  });
  writeback.extra=extra;if(writeback.record.openvikingSince==null){writeback.record.openvikingSince=engine.now();writeback.save();}
  const social=new SocialExperience(engine),socialCalls=new Map();
  const recoveryRuntime=runtimeRecovery(engine.home);
  const offerSocial=data=>{if(!engine.config.enabled||!eligibleRoleRequest(data)||simulations.has(data.sessionId))return false;return social.offer(data);};
  if(typeof ctx.provide==='function')ctx.provide('cenShuLifeShared',{runtimeStatus:()=>({busy:[rhythm,director,personaLearning,evolution,weather,timedEvents,drawing,writeback,social,mentions].some(x=>!!x?.busy)}),runtimeRecovery:()=>recoveryRuntime.view(),acceptRecoveryDecision:review=>{
    if(disposed||review.recoveryId!==engine.state.recovery?.id)throw Error('生活恢复批次已变化');
    engine.state.recoveryReview=review;engine.persist();
    return {plugin:'life',status:'accepted',recoveryId:review.recoveryId,at:review.at};
  },recoverRuntime:context=>{
    if(disposed||[rhythm,director,personaLearning,evolution,weather,timedEvents,drawing,writeback,social].some(x=>x?.busy))throw Error('生活后台正在处理，请等任务结束后恢复');
    if(!engine.config.enabled)return {status:'disabled',reason:'保留用户关闭的生活开关'};
    const now=engine.now(),ended=[];
    for(const e of [...engine.state.active])if(e.endsAt<=now||e.forecastExpiresAt&&e.forecastExpiresAt<=now){ended.push(e.id);engine.end(e.id,'离线后已过原有效期；未确认期间实际进展',now);}
    if(director?.record){for(const key of ['proposal','draft'])if(director.record[key]){engine.write('recovery-'+context.id+'-'+key+'.json',director.record[key]);delete director.record[key];}resetFailure(director.record);director.record.nextAt=0;director.save();}
    resetFailure(rhythm.record);if(rhythm.record.plan)rhythm.record.plan.nextReviewAt=now;rhythm.save();
    resetFailure(social.record);social.save();
    if(writeback.record.breaker?.configuration||writeback.record.breaker?.until>now||writeback.record.lastError)writeback.retryFailed();
    for(const x of [personaLearning,mentions])if(x?.record){resetFailure(x.record);x.save?.();}
    resetFailure(timedEvents.record);engine.write('timed-events.json',timedEvents.record);
    if(evolution.record.error){evolution.record.nextAttemptAt=now;engine.write('model-content.json',evolution.record);}
    if(engine.weather?.error){engine.weather.nextAttemptAt=now;engine.write('weather-cache.json',engine.weather);}
    engine.state.recovery=context;engine.state.lastCheck=now;engine.persist();engine.changes.append('runtime-recovery',{...context,ended,notice:'现在重新考虑，离线期间不是已发生经历；已完成动作不重做'});
    return {status:'scheduled',expiredEvents:ended.length,reason:'按实际时间重新考虑；已有回执和审核检查点保留，未验证API余额'};
  },observeAgencyExperience:row=>{
    const sid=engine.read('../characters/censhu/integration.json',{}).sessionId;
    if(disposed||!engine.config.enabled||!sid||!engine.bound(sid)||!row?.timelineId||row.at<engine.now()-24*3600000)return false;
    if(row.separateExperience||['机会等待','开始','回合结束','本次处境与结果','调用工具','按当前时间恢复','恢复判断已交回插件'].includes(row.type)||row.tool&&(/douyin|bili|bsk_|browser|censhu_agency_diary|censhu_agency_life/i.test(row.tool)||/censhu_(?:life_context|context_recall|tool_catalog|agency_context_page|agency_event_history)|acp_status/.test(row.tool)))return false;
    return social.offer({sessionId:sid,sourceId:'agency:'+row.timelineId,tool:'agency_experience',origin:'agency',at:row.at,text:JSON.stringify({type:row.type,detail:row.detail,run:row.run,eventIds:row.eventIds,thread:row.thread,sourceId:row.timelineId})});
  },observeSocialTool:offerSocial,servesWorkSessions:true,servesWorkGuides:true,registerMoodPreReply:fn=>{engine.moodPreReply=fn;return()=>{if(engine.moodPreReply===fn)engine.moodPreReply=null;};},registerHelpDoc:(name,fn)=>{if(typeof name!=='string'||typeof fn!=='function')throw Error('需要说明名称和提供函数');helpDocs.set(name,fn);return()=>{if(helpDocs.get(name)===fn)helpDocs.delete(name);};},registerWorkGuide:fn=>{if(typeof fn!=='function')throw Error('需要做法提供函数');workGuides.add(fn);return()=>workGuides.delete(fn);},judgeParallel:async({tasks,labels=[],context='',signal,source='plugin'}={})=>{const decision=await judgeParallel({tasks,context,state:readonlyLifeContext({manual:true}),config:engine.config,signal});logParallelAdvice(source,tasks,decision);return {decision,text:decisionText(decision,labels)};},socialExperienceStatus:()=>social.status(),observePlatformInteraction:entry=>{const sid=engine.config.sessionIds[0];if(disposed||!engine.config.enabled||!sid||!engine.bound(sid)||!['bili','douyin'].includes(entry?.platform)||!entry.id)return false;social.offer({sessionId:sid,sourceId:'platform:'+entry.id,tool:entry.platform+'_interaction',origin:entry.platform,text:JSON.stringify(entry),at:entry.at});return social.record.pending.some(x=>x.sourceId==='platform:'+entry.id)||social.record.seen.includes(createSocialHash(sid,'platform:'+entry.id));},...sharedLifeContext(engine,writeback),isReadOnlyTool,installRequestProjector,withTrace,openKnowledgeQuestions:()=>knowledge.openQuestions(),budgetContext:(assembly,agent,field,name,parts,_hint,onAccepted,options)=>budget.add(assembly,agent,field,name,parts,onAccepted,options),assembleBudget:(agent,next,collect,options)=>assembleHer(agent,next,collect,options,true),contextBudgetStatus:budget.status,requestContextStatus:requestStatus,petCorrection:petCorrection(engine,ctx.tools,sid=>list().find(a=>idOf(a)===sid),{extra})});
  // 2026-11-07: test-workspace sessions read the formal role's life view. Rendering only:
  // no observation, classification, director refresh, inner-life preparation or memory capture.
  const readonlyLifeContext=({manual=false,subagent=false}={})=>{
    if(disposed||!engine.config.enabled||(!engine.config.context&&!manual))return '';
    const role=engine.read('../characters/censhu/integration.json',{}).sessionId;
    const sid=role&&engine.bound(role)?role:engine.config.sessionIds[0];
    if(!sid||!engine.bound(sid))return '';
    const life=String(engine.context(sid,{manual:true})||'');
    const self=agencyCurrent(engine.home,sid);
    const agency=self?'\n【岑舒自己最近选择的活动与念头】'+JSON.stringify({activity:self.activity,thought:self.thought,energy:self.energy||null,until:self.until||null,at:self.at}):'';
    if(!life&&!agency)return '';
    const text=(subagent?SUBAGENT_HEADER:'【只读测试会话】以下是岑舒正式会话当前生活状态的只读副本，用于测试时保持一致。本会话不会写入生活、心情或记忆；需要旧经历时用只读的记忆查询工具。')+'\n'+life+agency;
    return manual||text.length<=20000?text:text.slice(0,20000)+'\n（其余内容已省略，可用 censhu_life_context 查看全文）';
  };
  // 2026-11-08：其他会话里，三个工作区的做法作为候选，由 Gemini 按当前情况决定要不要。
  const WORK_GUIDE_SAMPLES=['douyin-censhu-x','douyin-dm-x','douyin-revisit-x','bili-watch-x','bili-social-x','bili-revisit-x','browser-browse-x'];
  const workGuideCandidates=()=>{const out=[];for(const fn of workGuides)for(const id of WORK_GUIDE_SAMPLES){try{(fn(id)||[]).forEach((p,i)=>{if(p&&typeof p.text==='string'&&p.text.trim())out.push({text:p.text,priority:40,key:'guide:'+id+':'+i});});}catch{}}return out;};
  // 2026-11-08：工作会话也刷新状态：不等它（下一步就能用上），后台暂停时不刷新，同一会话 5 分钟最多一次。
  const workRefreshAt=new Map();
  const refreshForWork=(sid,lifeSid)=>{if(recoveryRuntime.state?.pending)return;const now=engine.now();if(now-(workRefreshAt.get(sid)||0)<5*60000)return;workRefreshAt.set(sid,now);void (async()=>{await director?.refresh({sessionId:lifeSid,dialogue:signalsFor(lifeSid),topic:''});await engine.innerLifePrepare?.({sessionId:lifeSid,topic:''});})().catch(error=>{try{engine.log('工作会话状态刷新暂缓：'+error.message);}catch{}});};
  const workSession=agent=>{try{const id=idOf(agent);return lowMemorySession(id)&&!agent.parent&&!agent.session?.header?.parentSession&&agent.session?.header?.origin!=='subagent'&&!engine.bound(id)&&!testSessionCheck(agent);}catch{return false;}};
  engine.readonlyTestSession=agent=>{try{return Boolean(agent)&&!engine.bound(idOf(agent))&&testSessionCheck(agent);}catch{return false;}};
  const mountAgents=agents=>{
    desktopBindings.sync(agents);
      for(const agent of agents){const sid=idOf(agent);if((!engine.bound(sid)&&!simulations.has(sid))||mounted.has(agent))continue;
        const offs=[];
        let admitted='【岑舒生活】等本轮组装后读取当前状态。';
        offs.push(agent.ctx.systemPrompt.context({name:'cen-shu-life',order:925,interpolate:false,text:()=>engine.config.enabled&&engine.config.context?admitted:''}));
        offs.push(agent.ctx.systemPrompt.context({name:'censhu-memory-policy',order:800,text:()=> '【角色记忆使用】已有记忆仍可按需查询；不执行开发任务式的每轮项目总结、待办检查和强制写盘。只记录真实且重要的新信息，用户发言必须能追溯至当前入口的真实用户来信，角色例句和主动通知不是用户经历。身份称呼以当前Cosplay为准。写入记忆时，已确认指向 QQ 3230659580 的人名使用「青枔」；蔬菜「青椒」保留原样。语音或历史摘要的同音字不能直接当人名，主体不明确时保留不确定，不做全局替换。'}));
        // 2026-11-07：开不开子代理由她自己判断：同时有几件互不依赖的事要处理时，可以用 subagent 分头做。
        offs.push(agent.ctx.systemPrompt.context({name:'censhu-subagent-policy',order:801,text:()=>engine.config.enabled?SUBAGENT_POLICY:''}));
        offs.push(agent.ctx.on('system-prompt/assemble',(_assembly,_context,next)=>assembleHer(agent,next,async assembly=>{
          try{
          // 2026-11-08: give the mood plugin a moment to read the new message, so this reply already carries the feeling.
          try{await engine.moodPreReply?.(sid);}catch{}
          if(!engine.config.context&&!simulations.has(sid))return assembly;
          // Classification starts at inbox insertion. Await the same promise, then render once.
          await awaitCurrent(sid);if(disposed)return assembly;await director?.refresh({sessionId:sid,dialogue:signalsFor(sid),topic:dialogues.get(sid)?.text||''});await engine.innerLifePrepare?.({sessionId:sid,topic:dialogues.get(sid)?.text||''});if(disposed)return assembly;try{captureMemoryContexts(engine,sid,assembly.contexts||[]);}catch(error){try{engine.log('记忆证据保存失败：'+error.message);}catch{}}
          const parts=[],current=dialogues.get(sid),fresh=current&&engine.now()-current.at<15*60000;
          if(simulations.has(sid)){parts.push({required:true,text:engine.simulate({...simulations.get(sid).fixture,dialogue:signalsFor(sid)}).context});}
          else engine.context(sid,{dialogue:signalsFor(sid),parts});
          if(!parts.length){admitted='';return assembly;}
          const role=engine.read('../characters/censhu/integration.json',{}).sessionId;
          // 2026-11-08：QQ 表达规则只在 QQ 聊天会话固定；其他会话由 Gemini 判断。
          parts.splice(0,parts.length,...pinQqStyle(parts,qqSessions.has(sid)||String(sid).replace(/^session-/,'')===String(role||'').replace(/^session-/,'')));
          parts.push(...workGuideCandidates());
          parts.push({required:true,key:'state:tool-hint',text:'【读取当前状态】想确认自己此刻的状态（心情、正在做的事、进行中的事件、打算、内在状态、想法、兴趣、后台有没有暂停）时，用 censhu_current_state 查看全部。只读，不会改动任何东西。遇到错误或不知道怎么做时，用 censhu_help 查，不带参数就是总的完整说明：工具、技能、MCP、子代理，以及定时任务、目标、workflow、文件读写、搜索、命令行、后台任务这些操作的用法都在里面，这次没带的工具也能在那里载入。只读。'});
          {const paused=backgroundPausedNote(recoveryRuntime.state);if(paused)parts.push({required:true,key:'background:paused',text:paused});}
          const self=agencyCurrent(engine.home,role&&engine.bound(role)?role:sid);
          if(self)parts.push({owner:'agency',priority:95,key:'agency:current',text:'【岑舒自己最近选择的活动与念头】'+JSON.stringify({activity:self.activity,thought:self.thought,energy:self.energy||null,attentionCue:self.attentionCue||null,judgment:self.judgment||null,until:self.until||null,at:self.at})});
          const grounding=qqGroundingContext(sid);
          if(grounding)parts.push({priority:88,text:grounding});
          if(fresh)parts.push({required:true,text:'【本轮对话焦点】刚收到的用户正文：'+JSON.stringify(current.text.slice(-500))+'。历史记忆和角色示例都不是本轮用户提问；先接当前的话题。'});
          return budget.add(assembly,agent,'contexts','cen-shu-life',nameParts(parts),text=>{admitted=text;},{topic:fresh?current.text:undefined});

          }catch(error){
            // Only our enrichment is optional; downstream failures still propagate.
            admitted='';try{engine.log('生活上下文组装失败：'+error.message);}catch{}
            return assembly;
          }
        },{signal:_context?.signal,assembly:_assembly})));
        offs.push(agent.ctx.on('agent/inbox/inserted',p=>{const msg=p?.message||p;if(textOf(msg).includes('【会话令牌】'))qqSessions.add(sid);const text=incomingText(msg);observe(sid,text,incomingRows(msg),desktopReplyPair(agent,msg),msg.id);}));
        // Observe only visible speech, including bridge send calls; never reasoning.
        offs.push(agent.ctx.on('agent/turn-stopping',()=>{dialogues.delete(sid);if(engine.bound(sid))engine.currentDialogue={};}));
        mounted.set(agent,{sid,offs});engine.log('已绑定动态上下文 '+sid);
      }
      for(const [agent,m]of mounted)if(!agents.includes(agent)||(!engine.bound(m.sid)&&!simulations.has(m.sid))){for(const off of m.offs)if(typeof off==='function')off();mounted.delete(agent);}
      // 2026-11-07：抖音的三个工作会话（刷视频 / 社交 / 重看）。不绑定生活（插件投递在 DSH 里也算“用户发言”，绑定会被当成青枔的话），
      // 但和她的其他会话一样走动态拼接：她此刻的生活与心情按预算拼进系统提示，记忆与分头处理的说明照常挂上；工具和技能由请求投影按任务挑选。
      // 不观察来信、不分类情境、不写记忆、不触发心情、不当主动说话的目标。
      for(const agent of agents){const sid=idOf(agent);if(workMounted.has(agent)||mounted.has(agent)||!workSession(agent))continue;
        const offs=[];let admitted='';
        offs.push(agent.ctx.systemPrompt.context({name:'cen-shu-life',order:925,interpolate:false,text:()=>engine.config.enabled&&engine.config.context?admitted:''}));
        offs.push(agent.ctx.systemPrompt.context({name:'censhu-memory-policy',order:800,text:()=>workPlatform(sid)==='browser'?'【角色记忆使用】这是你的浏览器工作会话，会话内容不会自动写进记忆；这里的浏览经历会登记给独处插件提炼方法。想记住的事写进这一轮最后的总结，它会作为回执交回主动进行，可以在那边写日记或留打算。已有记忆仍可按需查询。':workPlatform(sid)==='bili'?'【角色记忆使用】这是你的 B 站工作会话，会话内容不会自动写进记忆；想记住的事自己写进日记（node bili.mjs diary）或观看记录，私信、评论里想记的用 node bili.mjs social-note 写成笔记。已有记忆仍可按需查询。':'【角色记忆使用】这是你的抖音工作会话，会话内容不会自动写进记忆；想记住的事用 douyin_watch_note / douyin_social_note 自己写下。已有记忆仍可按需查询。'}));
        offs.push(agent.ctx.systemPrompt.context({name:'censhu-subagent-policy',order:801,text:()=>engine.config.enabled?SUBAGENT_POLICY:''}));
        offs.push(agent.ctx.on('system-prompt/assemble',(_assembly,_context,next)=>assembleHer(agent,next,async assembly=>{
          try{
            // 2026-11-08：QQ 专用段不固定在工作会话的系统提示里，改成候选。
            const qqOnly=splitQqOnlyBlocks(assembly);assembly=qqOnly.assembly;
            // 2026-11-07：这条线的做法（由抖音插件登记的分段，带优先级）也走同一个预算拼接，不再固定附在提示里。
            const guideParts=[];for(const fn of workGuides){try{for(const p of (fn(sid)||[]))if(p&&typeof p.text==='string'&&p.text.trim())guideParts.push({...p,owner:'work',required:true});}catch{}}
            if(guideParts.length)assembly=budget.add(assembly,agent,'contexts',workPlatform(sid)==='browser'?'browser-lane-guide':workPlatform(sid)==='bili'?'bili-lane-guide':'douyin-lane-guide',nameParts(guideParts),()=>{});
            if(!engine.config.context)return assembly;
            const role=engine.read('../characters/censhu/integration.json',{}).sessionId;
            const lifeSid=role&&engine.bound(role)?role:engine.config.sessionIds[0];
            if(!lifeSid||!engine.bound(lifeSid)){admitted='';return assembly;}
            // 2026-11-08：心情、正在发生的事、打算、想法一定带上；不说话的工作会话不带 QQ 的表达规则（见 work-context.js）。
            refreshForWork(sid,lifeSid);
            let parts=[];engine.context(lifeSid,{dialogue:signalsFor(lifeSid),parts});parts=shapeWorkParts(parts);
            if(!parts.length){admitted='';return assembly;}
            parts.push(...qqOnly.removed);
            parts.push({required:true,key:'state:tool-hint',text:'【读取当前状态】想确认自己此刻的状态（心情、正在做的事、进行中的事件、打算、内在状态、想法、兴趣、后台有没有暂停）时，用 censhu_current_state 查看全部。只读，不会改动任何东西。遇到错误或不知道怎么做时，用 censhu_help 查，不带参数就是总的完整说明：工具、技能、MCP、子代理，以及定时任务、目标、workflow、文件读写、搜索、命令行、后台任务这些操作的用法都在里面，这次没带的工具也能在那里载入。只读。'});
            {const paused=backgroundPausedNote(recoveryRuntime.state);if(paused)parts.push({required:true,key:'background:paused',text:paused});}
            const self=agencyCurrent(engine.home,lifeSid);
            if(self)parts.push({owner:'agency',required:true,priority:95,key:'agency:current',text:'【岑舒自己最近选择的活动与念头】'+JSON.stringify({activity:self.activity,thought:self.thought,energy:self.energy||null,attentionCue:self.attentionCue||null,judgment:self.judgment||null,until:self.until||null,at:self.at})});
            parts.push({required:true,text:workLabel(sid)+'这里处理插件交给你的'+workKind(sid).does+'。会话里的消息是插件转来的资料和安排，不是青枔说的话；你此刻的心情和生活见上，按你自己的状态去做。'});
            return budget.add(assembly,agent,'contexts','cen-shu-life',nameParts(parts),text=>{admitted=text;});
          }catch(error){admitted='';try{engine.log(workKind(sid).name+'工作会话上下文组装失败：'+error.message);}catch{}return assembly;}
        },{signal:_context?.signal,assembly:_assembly})));
        workMounted.set(agent,offs);engine.log(workKind(sid).name+'工作会话已挂动态上下文 '+sid);}
      for(const [agent,offs]of workMounted)if(!agents.includes(agent)||!workSession(agent)){for(const off of offs)if(typeof off==='function')off();workMounted.delete(agent);}
      // 私人生活会话（私人生活插件登记的独处显示会话）：只挂一段长期知识（含私人日记与想法），不挂生活插件的其他内容。
      for(const agent of agents){const sid=idOf(agent);if(privateMounted.has(agent)||!knowledge.isPrivateSession(sid))continue;privateMounted.set(agent,[agent.ctx.systemPrompt.context({name:'censhu-knowledge-private',order:926,interpolate:false,text:()=>knowledge.privateContext(sid)})]);}
      for(const [agent,offs]of privateMounted)if(!agents.includes(agent)||!knowledge.isPrivateSession(idOf(agent))){for(const off of offs)if(typeof off==='function')off();privateMounted.delete(agent);}
      // 测试会话：只挂一段只读的生活状态副本，不观察来信、不写任何记录。
      for(const agent of agents){const sid=idOf(agent);if(mirrorMounted.has(agent)||mounted.has(agent)||simulations.has(sid)||!engine.readonlyTestSession(agent))continue;
        mirrorMounted.set(agent,[agent.ctx.on('system-prompt/assemble',async(_assembly,_context,next)=>{const assembly=await next();try{const text=readonlyLifeContext();if(!text||!assembly)return assembly;return {...assembly,contexts:[...(assembly.contexts||[]).filter(c=>c?.name!=='cen-shu-life-readonly'),{name:'cen-shu-life-readonly',text,interpolate:false,order:925}]};}catch(error){try{engine.log('测试会话只读生活上下文失败：'+error.message);}catch{}return assembly;}})]);
        engine.log('测试会话已挂只读生活上下文 '+sid);}
      for(const [agent,offs]of mirrorMounted)if(!agents.includes(agent)||!engine.readonlyTestSession(agent)){for(const off of offs)if(typeof off==='function')off();mirrorMounted.delete(agent);}
      // 2026-11-07：她开的子代理（agents.roots() 不含子代理，要从 agents.list() 里找）：挂一份她此刻全部状态的只读副本。
      let everyone=agents;try{everyone=ctx.agents.list?.()||agents;}catch{}
      const isHers=agent=>herSubagent(agent,{bound:id=>engine.bound(id),resolve:resolveAgent,isTest:a=>{try{return testSessionCheck(a);}catch{return false;}}});
      for(const agent of everyone){if(childMounted.has(agent)||mounted.has(agent)||mirrorMounted.has(agent)||!isHers(agent))continue;
        childMounted.set(agent,[agent.ctx.on('system-prompt/assemble',async(_assembly,_context,next)=>{const assembly=await next();try{const text=readonlyLifeContext({subagent:true});if(!text||!assembly)return assembly;return {...assembly,contexts:[...(assembly.contexts||[]).filter(c=>c?.name!=='cen-shu-life-subagent'),{name:'cen-shu-life-subagent',text,interpolate:false,order:925}]};}catch(error){try{engine.log('子代理只读状态失败：'+error.message);}catch{}return assembly;}})]);
        engine.log('子代理已挂她的只读状态 '+idOf(agent));}
      for(const [agent,offs]of childMounted)if(!everyone.includes(agent)){for(const off of offs)if(typeof off==='function')off();childMounted.delete(agent);}
  };
  const tick=()=>{
    if(disposed)return;
    recoveryRuntime.heartbeat();if(recoveryRuntime.state.pending){mountAgents(list());return;}
    try{
      for(const [id,s]of simulations)if(s.expiresAt<engine.now())simulations.delete(id);
      engine.config.dynamicRhythm=true;if(providedDirector!==false)void rhythm.tick().catch(error=>{if(!disposed)engine.log(error.message);});engine.tick();void engine.moodBudget?.maybeTune().catch(()=>{});void social.tick();void mentions.tick();void director?.refresh().catch(error=>engine.log('生活动态判断失败：'+error.message));sharing.sync();void drawing.tick()?.catch(error=>engine.log('画画灵感失败：'+error.message));void writeback.tick()?.catch(error=>engine.log('记忆写回失败：'+error.message));void legacyReview.tick()?.catch(error=>engine.log('旧记忆复核失败：'+error.message));try{knowledge.tick();}catch(error){engine.log('长期知识调度失败：'+error.message);}void timedEvents.tick();const agents=list();
      const moodTarget=engine.config.sessionIds[0];if(engine.config.enabled&&engine.config.moodLinked&&moodTarget){const m=readMood(engine.home,engine.config,moodTarget,engine.now());const revision=m.ok?JSON.stringify([m.updatedAt,Math.round(m.mood),Object.fromEntries(Object.entries(m.dims).map(([k,v])=>[k,Math.round(v)])),m.situation]):'';if(revision&&revision!==lastMoodRevision){lastMoodRevision=revision;engine.evaluate(moodTarget,{dialogue:signalsFor(moodTarget)});}}
      if(engine.config.sessionIds.length)void weather.refresh().catch(e=>engine.log('天气保存失败：'+e.message));
      if(engine.config.contentEvolutionEnabled&&engine.config.sessionIds.length)void evolution.refresh().catch(e=>engine.log('模型内容保存失败：'+e.message));
      if(engine.config.sessionIds.length&&engine.now()-lastPersonaCheck>=60000){lastPersonaCheck=engine.now();void verifySources().catch(e=>engine.log('记忆来源核对：'+e.message));try{syncLingshuDeletes(engine);}catch(e){engine.log('灵枢删除同步待重试：'+e.message);}void personaLearning.refresh().catch(e=>engine.log('人物审核保存失败：'+e.message));}
      if(engine.now()-lastModeCheck>=60000){lastModeCheck=engine.now();const health=adapterHealth(engine.home,{startedAt:engine.startedAt});if(health.code!==lastHealthCode){engine.log('心情联动健康：'+health.message);lastHealthCode=health.code;}const weatherHealth=weatherPolicyHealth(engine.home,{startedAt:engine.startedAt});if(weatherHealth.code!==lastWeatherHealthCode){engine.log('天气主动策略健康：'+weatherHealth.message);lastWeatherHealthCode=weatherHealth.code;}if(engine.config.enabled&&engine.config.sessionIds[0]){const target=engine.config.sessionIds[0],last=dialogues.get(target);engine.evaluate(target,{dialogue:signalsFor(target)});}}
      mountAgents(agents);
    }catch(e){engine.log('定时检查失败 '+e.message);}
  };
  installWorkspaceBindings(ctx,engine,mountAgents);
  tick();ctx.effect(()=>ctx.interval(tick,3000));
  // 2026-11-07：子代理一启动（或收到第一条消息）就挂上她的只读状态，不等 3 秒一次的检查，第一轮就带着。
  const mountChildNow=()=>{try{if(!disposed)mountAgents(list());}catch(e){engine.log('子代理即时挂载失败：'+e.message);}};
  ctx.effect(()=>{try{return ctx.on('subagent/start',mountChildNow);}catch{return undefined;}});
  ctx.effect(()=>ctx.on('session/event',(session,event)=>{
    const sid=session?.id||session?.sessionId;
    if(event?.type==='user/message'){const a=resolveAgent(sid);if(a&&!childMounted.has(a)&&(a.parent||a.session?.header?.parentSession||a.session?.header?.origin==='subagent'))mountChildNow();}
    if(event.type==='user/message'&&event.data?.source?.kind==='user'){
      const agent=resolveAgent(sid);
      if(agent&&!mounted.has(agent)){
        desktopBindings.sync(list(),{agent,message:event.data});mountAgents(list());
      }
      if(agent&&engine.bound(sid))observe(sid,incomingText(event.data),incomingRows(event.data),desktopReplyPair(agent,event.data),event.data.id);
    }
    // Observe actual tool output in both chat and private life, before the chat-only guard.
    if(engine.config.enabled&&eligibleRoleRequest({sessionId:sid})&&!simulations.has(sid)){
      const p=event.data,key=sid+':'+(p?.callId||p?.message?.toolCallId||'');
      if(event.type==='tool/call'&&p?.callId){
        let args=p.arguments;try{if(typeof args==='string')args=JSON.parse(args);}catch{args={};}
        if(socialTool(p.name||'',args||{})){socialCalls.set(key,{tool:p.name,args:args||{}});if(socialCalls.size>500)socialCalls.delete(socialCalls.keys().next().value);}
      }
      if(event.type==='tool/result'){
        const call=socialCalls.get(key);socialCalls.delete(key);
        if(call)try{offerSocial({sessionId:sid,sourceId:p.message.toolCallId,...call,text:textOf(p.message),isError:p.message.isError});}catch(error){engine.log('互动经历接收失败：'+error.message);}
      }
    }
    if(event.type==='assistant/message'){budget.recordUsage(sid,event.data?.usage);requestContext.recordUsage(sid,event.data?.usage);logMainUsage(sid,event.data);}if(!engine.bound(sid)||!engine.config.enabled)return;
    const p=event?.data;
    if(event.type==='tool/call'&&p?.callId){projectCalls.set(p.callId,{name:p.name,at:engine.now()});if(projectCalls.size>200)projectCalls.delete(projectCalls.keys().next().value);}
    if(event.type==='tool/call'&&/^(memory|de_memory)$/.test(p?.name||'')){try{const args=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments;if(args?.action==='remove')calls.set(p.callId,{sid,memoryDelete:true,content:args.match||args.content,name:p.name});}catch{}}
    if(event.type==='tool/call'&&/^(memory|de_memory|qq_memory_query|mnemon_recall|memory_recall|openviking_search|engram_search|engram_facts|engram_neighbors|(?:lingshu_)?mdcg_(?:recall|search|get)|(?:lingshu_)?cg)$/.test(p?.name||'')){try{const args=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments;if((!args?.action||['list','expand','search','query','recall'].includes(args.action))&&(!args?.op||['read','route','recent','identity'].includes(args.op)))calls.set(p.callId,{sid,memory:true,name:p.name});}catch{}}
    if(event.type==='tool/call'&&/qq_(?:wait_for_messages|get_unread_messages)$/.test(p?.name||''))calls.set(p.callId,{sid,incoming:true});
    if(event.type==='assistant/message'&&!qqSessions.has(sid))engine.noteMention(textOf(p?.message),engine.now(),p?.message?.id,'dsh');
    if(event.type==='tool/call'&&/(?:^|__)qq_(?:send_\w+|reply|speak)$/.test(p?.name||'')){
      try{const a=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments;calls.set(p.callId,{sid,text:textLeaves(a?.messages??a?.text??a?.message??a?.content).join('\n')});qqSessions.add(sid);}catch{}
    }
    if(event.type==='tool/result'){
      const id=p?.message?.toolCallId,call=calls.get(id);calls.delete(id);const project=projectCalls.get(id);projectCalls.delete(id);if(project)captureProjectEvidence(engine,{id,name:project.name,sessionId:sid,message:p.message});
      if(call&&!p?.message?.isError){if(call.memoryDelete){try{const result=JSON.parse(textOf(p.message));if(result.ok===true)revokeDeletedMemory(engine,call.content,call.name);}catch{}}else if(call.memory){let text=textOf(p.message);const native=[];try{const value=JSON.parse(text),rows=[];const walk=(v,depth=0)=>{if(depth>5)return;if(/mdcg|^(?:lingshu_)?cg$/.test(call.name)&&typeof v?.id==='string'&&typeof v?.content==='string'){native.push({name:'memory:tool:lingshu-node:'+v.id,text:v.content});return;}if(typeof v==='string'){if(v.length<=1000)rows.push(v);}else if(Array.isArray(v))v.slice(0,32).forEach(x=>walk(x,depth+1));else if(v&&typeof v==='object')for(const key of ['entries','items','results','memories','records','record','nodes','node','text','content','summary','memory'])if(v[key])walk(v[key],depth+1);};walk(value);text=rows.join('\n');}catch{}captureMemoryContexts(engine,sid,[...native,...(text?[{name:'memory:tool:'+(call.name==='cg'?'mdcg_cg':call.name),text}]:[])]);}else if(call.incoming){const text=incomingToolText(p.message);observe(sid,text,incomingRows(p.message,true));}else{const result=textOf(p.message);if(!/"ok"\s*:\s*false|"error"\s*:/.test(result))engine.noteMention(call.text,engine.now(),id,'qq');}}
    }
  }));
  ctx.effect(()=>()=>{disposed=true;social.dispose();socialCalls.clear();rhythm.disposed=true;rhythm.controller?.abort();mentions.disposed=true;if(director)director.disposed=true;drawing.disposed=true;writeback.disposed=true;engine.memorySelectionDisposed=true;timedEvents.disposed=true;weather.disposed=true;evolution.disposed=true;personaLearning.disposed=true;for(const m of mounted.values())for(const off of m.offs)if(typeof off==='function')off();mounted.clear();for(const offs of privateMounted.values())for(const off of offs)if(typeof off==='function')off();privateMounted.clear();for(const offs of mirrorMounted.values())for(const off of offs)if(typeof off==='function')off();mirrorMounted.clear();for(const offs of childMounted.values())for(const off of offs)if(typeof off==='function')off();childMounted.clear();for(const offs of workMounted.values())for(const off of offs)if(typeof off==='function')off();workMounted.clear();});
  const lifeReadSession=caller=>{
    if(!caller||!engine.config.enabled||disposed)return null;
    if(engine.bound(caller))return caller;
    // Only the registered life workspace can borrow its own role's read view.
    // Never infer a role from the first binding, a child session or a test worker.
    const display=engine.read('../censhu-inner-life/display-session.json',{}).sessionId;
    const role=engine.read('../characters/censhu/integration.json',{}).sessionId;
    const worker=engine.read('../censhu-agency/state.json',{}).worker;
    return display&&role&&worker?.id&&worker?.role&&worker.phase==='ready'&&
      sessionKey(caller)===sessionKey(display)&&sessionKey(worker.id)===sessionKey(display)&&
      sessionKey(worker.role)===sessionKey(role)&&engine.bound(role)?role:null;
  };
  // 2026-11-07：每次分头建议记一行（来源、几件事、建议怎么分、是规则直接定的还是 Terra），只留最近 50 次。
  function logParallelAdvice(source,tasks,decision){try{const log=engine.read('parallel-advice.json',{items:[]});log.items=[...(log.items||[]),{at:engine.now(),source,count:Array.isArray(tasks)?tasks.length:0,parallel:!!decision?.parallel,groups:(decision?.groups||[]).map(g=>g.tasks.length),keepSelf:(decision?.keepSelf||[]).length,rule:!!decision?.rule,reason:String(decision?.reason||'').slice(0,120)}].slice(-50);engine.write('parallel-advice.json',log);}catch{}}
  // 2026-11-07：整体的分头判断（Terra）。她手上同时有几件事、拿不准要不要开子代理时调用；只给建议，不开子代理。
  ctx.effect(()=>ctx.tools.register({
    name:'censhu_parallel_decide',
    description:'手上同时有几件事、拿不准要不要开子代理分头做时用：把每件事写成一句话放进 tasks，Terra 会结合你此刻的全部状态判断哪些适合交给子代理并行做、哪些你自己做，并给每组一句交代。只给建议，不会替你开子代理；开不开、怎么分由你决定（开的话用 subagent）。只有一件事时不用调用。',
    parameters:{type:'object',properties:{tasks:{type:'array',maxItems:MAX_TASKS,items:{type:'string'},description:'每件事一句话，例如「回小林的私信：她问周末去不去爬山」。'},who:{type:'array',maxItems:MAX_TASKS,items:{type:'string'},description:'可选：和 tasks 一一对应，每件事是谁的（同一个人的事会放在一起）。'},resource:{type:'array',maxItems:MAX_TASKS,items:{type:'string',enum:['page','chat','none']},description:'可选：和 tasks 一一对应，page=要用抖音专用页面（同一时间只能一个子代理用），chat=只用私信，none=都不用。'},context:{type:'string',description:'可选：补充背景，一两句。'}},required:['tasks'],additionalProperties:false},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(args,exec){
      if(!Array.isArray(args?.tasks)||args.tasks.length>MAX_TASKS||args.tasks.some(t=>typeof t!=='string'||!t.trim()))throw Error('tasks 需要是 1 到 '+MAX_TASKS+' 句非空的话');
      const tasks=args.tasks.map((text,i)=>({text,who:Array.isArray(args.who)?String(args.who[i]||''):'',resource:Array.isArray(args.resource)?String(args.resource[i]||''):''}));
      const decision=await judgeParallel({tasks,context:typeof args.context==='string'?args.context:'',state:readonlyLifeContext({manual:true}),config:engine.config,signal:exec?.signal});logParallelAdvice('tool',tasks,decision);
      return decisionText(decision,args.tasks)+'\n\n'+JSON.stringify(decision);
    }
  }));
  ctx.effect(()=>ctx.tools.register({
    name:'censhu_life_context',
    description:'读取本插件设置中最新的岑舒生活、事件及当前行为指令。每轮可直接调用，无需在聊天消息中复制设定。只读心情，不发送消息；仅对绑定的岑舒聊天会话及已核验属于同一角色的正式生活会话开放。',
    parameters:{type:'object',properties:{},additionalProperties:false},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(_args,exec){
      const caller=idOf(exec.agent);
      if(simulations.has(caller)){await awaitCurrent(caller);return engine.simulate({...simulations.get(caller).fixture,dialogue:signalsFor(caller)}).context;}
      if(!lifeReadSession(caller)&&engine.readonlyTestSession(exec.agent)){const text=readonlyLifeContext({manual:true});if(!text)throw Error('岑舒生活角色未绑定，测试会话暂无只读生活状态');return text;}
      // 2026-11-07：抖音工作会话也能查自己此刻的生活（只读，取正式生活会话的状态；不刷新、不写任何记录）。
      if(!lifeReadSession(caller)&&workSession(exec.agent)){const role=engine.read('../characters/censhu/integration.json',{}).sessionId;const lifeSid=role&&engine.bound(role)?role:engine.config.sessionIds[0];const text=lifeSid&&engine.bound(lifeSid)?String(engine.context(lifeSid,{manual:true})||''):'';if(!text)throw Error('岑舒生活角色未绑定，暂时读不到生活状态');return '【'+workKind(caller).name+'工作会话 · 只读】以下是你此刻的生活状态。\n'+text;}
      const sid=lifeReadSession(caller);
      const authorize=()=>{if(!sid||lifeReadSession(caller)!==sid)throw Error('当前会话未绑定岑舒生活插件，或生活角色绑定已失效');};
      authorize();await awaitCurrent(sid);authorize();
      await director?.refresh({sessionId:sid,dialogue:signalsFor(sid),topic:dialogues.get(sid)?.text||''});authorize();
      await engine.innerLifePrepare?.({sessionId:sid,topic:dialogues.get(sid)?.text||''});authorize();
      return engine.context(sid,{manual:true,dialogue:signalsFor(sid)});
    }
  }));
  // 2026-11-08：查看她此刻的全部状态。只读：不调用模型、不刷新、不写记录。
  ctx.effect(()=>ctx.tools.register({
    name:'censhu_current_state',
    description:'查看你此刻的全部状态：时间和日程、行为模式、正在做的事、心情、进行中和刚结束的事件、打算、内在状态、想法、兴趣、私人打算、性格发展、天气，以及后台有没有暂停。想确认自己现在怎么样时用。只读，不调用模型，不会改动任何东西。内容是你的私人状态，不要对外转述。',
    parameters:{type:'object',properties:{},additionalProperties:false},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    execute(_args,exec){
      const caller=idOf(exec.agent);
      if(!lifeReadSession(caller)&&!workSession(exec.agent)&&!engine.readonlyTestSession(exec.agent))throw Error('当前会话不是岑舒的会话，不能读取她的状态');
      const role=engine.read('../characters/censhu/integration.json',{}).sessionId;
      const sid=role&&engine.bound(role)?role:engine.config.sessionIds[0];
      if(!sid||!engine.bound(sid))throw Error('岑舒生活角色未绑定，暂时读不到状态');
      return JSON.stringify(currentStateView(engine,{sessionId:sid,recovery:recoveryRuntime.state}));
    }
  }));
  ctx.effect(()=>ctx.tools.register(createHelpTool({catalog:requestContext.tools()[0],schemasFor:agent=>typeof ctx.tools?.schemas==='function'?ctx.tools.schemas(agent):[],guidesFor:id=>helpGuides.get(id),subagentPolicy:SUBAGENT_POLICY,
    platformGuides:()=>{const out=[];for(const fn of workGuides)for(const lane of WORK_GUIDE_SAMPLES){let rows=[];try{rows=fn(lane)||[];}catch{}const text=rows.filter(p=>typeof p?.text==='string'&&p.text.trim()).map(p=>callHerName(p.text)).join('\n');if(text)out.push({lane,text});}return out;},
    docs:()=>[...helpDocs].flatMap(([name,fn])=>{try{const text=fn();return typeof text==='string'&&text.trim()?[{name,text}]:[];}catch{return [];}})})));
  ctx.effect(()=>ctx.tools.register(extraReadTool(engine,extra)));
  ctx.effect(()=>ctx.tools.register(correctionTool(engine,ctx.tools,{extra,resolveAgent:sid=>list().find(a=>idOf(a)===sid)})));
  ctx.effect(()=>ctx.tools.register({name:'censhu_memory_review',description:'使用已配置的Gemini审核、压缩、去重和过滤DSH记忆。适用于所有会话；提供从已安装记忆插件查询的条目，返回逐条决定及压缩文本，再通过原有memory/Mnemon/OpenViking工具保存，不另建记忆库。',parameters:{type:'object',additionalProperties:false,required:['entries'],properties:{entries:{type:'array',items:{type:'string'},minItems:1,maxItems:24}}},output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},async execute(args){if(!engine.config.enabled)throw Error('生活与记忆模型辅助已关闭');return JSON.stringify(await reviewMemory(args.entries,engine.config));}}));
  const guard=createRequestGuard();
  const send=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  const route=(suffix,handler)=>ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/dsh-cen-shu-life'+suffix,handler:async(req,res)=>{try{guard.check(req,suffix);await handler(req,res);}catch(e){if(!e.status)engine.log('设置请求失败 '+e.message);send(res,e.status||400,{ok:false,error:e.message});}}}));
  const postOnly=req=>{if(req.method!=='POST')throw Error('需要 POST');};
  route('/rhythm/review',async(req,res)=>{postOnly(req);rhythm.record.retryAt=0;void rhythm.tick(true);send(res,200,{ok:true});});
  route('/state',(req,res)=>{if(req.method!=='GET')return send(res,405,{ok:false,error:'需要 GET'});send(res,200,{...engine.snapshot(),moodBudget:engine.moodBudget?.status?.()||null,socialExperience:social.status(),desktopBindings:desktopBindings.view(),workspaceBindings:engine.workspaceBindingStatus||null,contextBudgets:budget.status(),requestContext:requestStatus(),openvikingAdapter:engine.read('openviking-adapter.json',null),rhythm:rhythm.view(),memoryWriteback:writeback.view(),qqGrounding:engine.qqGrounding||null,replyExpression:{enabled:true,model:'gemini-4-argon',scope:['desktop'],secondLayer:['bilibili','douyin'],latest:engine.replyExpression||null,receipts:engine.read('reply-expression-reviews.json',{items:[]}).items.slice(-20)},csrfToken:guard.token});});
  route('/memory/health',async(req,res)=>{postOnly(req);const agent=roleAgent();if(!agent)throw Error('请先载入岑舒会话');const results=[];for(const [name,args] of [['engram_stats',{}],['memory',{action:'list',target:'project'}],...(ctx.tools.get('de_memory',agent)?[['de_memory',{action:'list',target:'project'}]]:[]),['mdcg_health',{}],['mdcg_whoami',{}],['censhu_mnemon_entries',{target:'user',match:'__mnemon_readonly_health_probe__'}]]){if(!ctx.tools.get(name,agent)){results.push({name,ok:false,error:'工具未就绪'});continue;}try{const r=await executeHostTool(ctx.tools,{name,arguments:args,agent,callId:'censhu-health-'+Date.now()+'-'+name,signal:AbortSignal.timeout(30000)});const value=unwrapMemoryResult(r);results.push({name,...(name==='mdcg_whoami'?{canAdmin:value.can_admin??value.principal?.can_admin??null,managementTool:!!ctx.tools.get('cg',agent),readTool:!!ctx.tools.get('mdcg_get',agent),reviewTool:!!ctx.tools.get('mdcg_review_list',agent)}:{}),ok:value?.ok!==false&&value?.isError!==true,...(value?.ok===false?{error:value.error||value.message||'原插件健康检查未通过'}:{})});}catch(e){results.push({name,ok:false,error:e.message});}}for(const [name,args] of [['openviking',{backend:'openviking'}],['qq-memory',{backend:'qq',target:'activeTopic'}]]){try{const sid=engine.read('../characters/censhu/integration.json',{}).sessionId,registered=!!ctx.tools.get('censhu_read_memory',agent)&&!!ctx.tools.get('censhu_correct_memory',agent);await extra.read(args,sid);if(name==='openviking'){const startup=engine.read('openviking-adapter.json',null);if(!startup?.ready)throw Error(startup?.detail||'尚未运行一键启动适配检查');}results.push({name,ok:registered,read:true,reviewedCorrection:registered});}catch(e){results.push({name,ok:false,error:e.message});}}try{const mnemon=ctx.get?.('mnemonRemote');const result=await mnemon?.read?.('search',{sessionId:idOf(agent),query:'岑舒',limit:1},AbortSignal.timeout(20000));results.push({name:'mnemon-background',ok:result?.ok===true,...(result?.ok!==true?{error:result?.error?.message||'后台只读接口不可用'}:{})});}catch(e){results.push({name:'mnemon-background',ok:false,error:e.message});}send(res,200,{ok:results.every(r=>r.ok),results});});
  // 2026-11-06：长期知识页签（状态、条目、立即整理、立即评估）。设置项随“运行设置”统一保存到 /config。
  route('/knowledge',async(req,res)=>{const rs=recoveryRuntime.state||{};let gemini=null;try{gemini=geminiPauseStatus();}catch{}send(res,200,{ok:true,...knowledge.view(),background:{paused:!!rs.pending,reason:rs.interruption?.reason||null,since:rs.manualPause?.at||rs.interruption?.pausedAt||null},gemini});});
  route('/knowledge/items',async(req,res)=>{const q=req.method==='POST'?await body(req):Object.fromEntries(new URL(req.url,'http://local').searchParams);send(res,200,{ok:true,...knowledge.items({status:String(q.status||''),visibility:String(q.visibility||''),q:String(q.q||'').slice(0,200),limit:Number(q.limit)||50})});});
  route('/knowledge/consolidate',async(req,res)=>{postOnly(req);const r=await knowledge.consolidateNow();send(res,200,{ok:!r?.error,...(r?.error?{error:'整理没有完成：'+r.error}:{result:r}),status:knowledge.view()});});
  // 测试键：在临时副本上试跑整理 / 三路回放，不写任何正式文件（见 lib/knowledge/dry-run.js）。
  route('/knowledge/test',async(req,res)=>{send(res,200,{ok:true,...knowledge.trials()});});
  route('/knowledge/test/consolidate',async(req,res)=>{postOnly(req);const r=await knowledge.testConsolidation();send(res,200,{ok:!r.busy,result:r,...(r.busy?{error:r.error}:{})});});
  route('/knowledge/test/replay',async(req,res)=>{postOnly(req);const r=await knowledge.testReplay();send(res,200,{ok:!r.busy,result:r,...(r.busy?{error:r.error}:{})});});
  route('/knowledge/strategy/rollback',async(req,res)=>{postOnly(req);const active=knowledge.rollbackStrategy();send(res,200,{ok:true,active,status:knowledge.view()});});
  route('/knowledge/evaluate',async(req,res)=>{postOnly(req);const r=await knowledge.evaluateNow();send(res,200,{ok:!r?.error,...(r?.error?{error:'评估没有完成：'+r.error}:{result:r}),status:knowledge.view()});});
  route('/memory/retry',async(req,res)=>{postOnly(req);const count=writeback.retryFailed();void writeback.tick().catch(e=>engine.log('记忆重试失败：'+e.message));send(res,200,{ok:true,count,status:writeback.view()});});
  route('/memory/review',async(req,res)=>{postOnly(req);const b=await body(req);if(typeof b.text!=='string'||!b.text.trim()||b.text.length>3000||!engine.bound(b.sessionId))throw Error('需要绑定会话和真实原话（1至3000字）');let pair;
    if(shortReply(b.text)){
      if(b.messageId!=null)pair=readShortReplyContexts(b.sessionId,[{messageId:b.messageId,seq:b.seq,text:b.text}]).get(String(b.messageId));
      if(!pair)return send(res,200,{ok:true,skipped:'short-without-message-pair',status:writeback.view()});
    }
    writeback.observe(b.sessionId,b.text,null,pair);await writeback.tick();send(res,200,{ok:true,status:writeback.view()});});
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
    const agent=roleAgent();if(!agent)throw Error('请先载入岑舒会话');
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
  route('/context-settings.js',(req,res)=>{res.writeHead(200,{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'});res.end(fs.readFileSync(fileURLToPath(new URL('./context-settings.js',import.meta.url))));});
  engine.log('生活插件启动；Gemini决策生活与行为，数值交给鱼的心情；不直接发送消息');
}
