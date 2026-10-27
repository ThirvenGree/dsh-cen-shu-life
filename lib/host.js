import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {LifeEngine,dialogueSignals} from './engine.js';
import {sampleLifeReaction} from './mood-link.js';
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
  if(['speak-up','schedule','cron','memory','cen-shu-life','dsh-mnemon','dsh-memory-evolve','runtime-context','time-context','system-reminder','system','time-sampled','goal','goal-round','subagent','subagent-notice','tool-registry','cordis-host-runner','agent-instructions','system-prompt','model','plugin'].includes(source)||/^(subagent|goal|tool-|system-|schedule)/.test(source))return '';
  const text=textOf(msg),marker='【本次消息快照】';
  if(text.includes(marker)){
    try{const rest=text.split(marker)[1].trimStart(),line=rest.split('\n')[0],packet=JSON.parse(line);return (packet.messages||[]).filter(x=>!x.isSelf).map(x=>x.text||'').join('\n').slice(-3000);}catch{return '';}
  }
  // Bridge wakeups/reminders and operator metadata are not Qingqin speaking.
  if(/【会话令牌】|【引导唤醒】|【唤醒提醒】|【QQ/.test(text))return '';
  return text.slice(-3000);
}
export function apply(ctx){
  const engine=new LifeEngine(),mounted=new Map(),dialogues=new Map(),calls=new Map(),qqSessions=new Set(),simulations=new Map();let disposed=false,lastModeCheck=0;
  const list=()=>{try{return (ctx.agents.roots?.()||ctx.agents.list()||[]);}catch{return [];}};
  const tick=()=>{
    if(disposed)return;
    try{
      for(const [id,s]of simulations)if(s.expiresAt<Date.now())simulations.delete(id);
      engine.tick();const agents=list();
      if(engine.config.enabled&&engine.config.sessionIds[0]&&Date.now()-lastModeCheck>=60000){lastModeCheck=Date.now();const target=engine.config.sessionIds[0],last=dialogues.get(target);engine.evaluate(target,{dialogue:last&&Date.now()-last.at<15*60000?dialogueSignals(last.text):{}});}
      for(const agent of agents){const sid=idOf(agent);if((!engine.bound(sid)&&!simulations.has(sid))||mounted.has(agent))continue;
        const offs=[];
        const safeContext=()=>{try{const current=dialogues.get(sid),fresh=current&&Date.now()-current.at<15*60000;const text=simulations.has(sid)?engine.simulate(simulations.get(sid).fixture).context:engine.context(sid,{dialogue:fresh?dialogueSignals(current.text):{}});return text+(fresh?'\n【本轮对话焦点】刚收到的用户正文：'+JSON.stringify(current.text.slice(-500))+'。历史记忆和角色示例都不是本轮用户提问；先接这条消息的话题，心情只调整说法，不改变话题或补造事实。':'');}catch(e){engine.log('上下文失败 '+e.message);return '【岑舒生活】读取失败，保持角色卡平常口吻，不编造生活事件或心情。';}};
        offs.push(agent.ctx.systemPrompt.context({name:'cen-shu-life',order:925,text:safeContext}));
        offs.push(agent.ctx.on('agent/inbox/inserted',p=>{const msg=p?.message||p;if(textOf(msg).includes('【会话令牌】'))qqSessions.add(sid);const text=incomingText(msg);if(text)dialogues.set(sid,{text,at:Date.now()});}));
        // Observe only visible speech, including bridge send calls; never reasoning.
        offs.push(agent.ctx.on('agent/turn-stopping',()=>{dialogues.delete(sid);}));
        mounted.set(agent,{sid,offs});engine.log('已绑定动态上下文 '+sid);
      }
      for(const [agent,m]of mounted)if(!agents.includes(agent)||(!engine.bound(m.sid)&&!simulations.has(m.sid))){for(const off of m.offs)if(typeof off==='function')off();mounted.delete(agent);}
    }catch(e){engine.log('定时检查失败 '+e.message);}
  };
  tick();ctx.effect(()=>ctx.interval(tick,3000));
  ctx.effect(()=>ctx.on('session/event',(session,event)=>{
    const sid=session?.id||session?.sessionId;if(!engine.bound(sid)||!engine.config.enabled)return;
    const p=event?.data;
    if(event.type==='tool/call'&&/qq_(?:wait_for_messages|get_unread_messages)$/.test(p?.name||''))calls.set(p.callId,{sid,incoming:true});
    if(event.type==='assistant/message'&&!qqSessions.has(sid))engine.noteMention(textOf(p?.message));
    if(event.type==='tool/call'&&/qq_send_message|qq_reply$/.test(p?.name||'')){
      try{const a=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments;calls.set(p.callId,{sid,text:[a?.messages,a?.text].flat().filter(x=>typeof x==='string').join('\n')});qqSessions.add(sid);}catch{}
    }
    if(event.type==='tool/result'){
      const id=p?.message?.toolCallId,call=calls.get(id);calls.delete(id);
      if(call&&!p?.message?.isError){if(call.incoming){const text=incomingToolText(p.message);if(text)dialogues.set(sid,{text,at:Date.now()});}else{const result=textOf(p.message);if(!/"ok"\s*:\s*false|"error"\s*:/.test(result))engine.noteMention(call.text);}}
    }
  }));
  ctx.effect(()=>()=>{disposed=true;for(const m of mounted.values())for(const off of m.offs)if(typeof off==='function')off();mounted.clear();});
  ctx.effect(()=>ctx.tools.register({
    name:'censhu_life_context',
    description:'读取本插件设置中最新的岑舒生活、事件及当前行为指令。每轮可直接调用，无需在聊天消息中复制设定。只读心情，不发送消息；仅对绑定的岑舒会话开放。',
    parameters:{type:'object',properties:{},additionalProperties:false},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    execute(_args,exec){const sid=idOf(exec.agent);if(simulations.has(sid))return engine.simulate(simulations.get(sid).fixture).context;if(!engine.bound(sid)||!engine.config.enabled)throw Error('当前会话未绑定岑舒生活插件');return engine.context(sid,{manual:true,dialogue:dialogueSignals(dialogues.get(sid)?.text||'')});}
  }));
  const send=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  const route=(suffix,handler)=>ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/dsh-cen-shu-life'+suffix,handler:async(req,res)=>{try{await handler(req,res);}catch(e){engine.log('设置请求失败 '+e.message);send(res,400,{ok:false,error:e.message});}}}));
  const postOnly=req=>{if(req.method!=='POST')throw Error('需要 POST');const origin=req.headers?.origin,host=req.headers?.host;if(origin&&new URL(origin).host!==host)throw Error('拒绝跨来源修改');};
  route('/state',(req,res)=>send(res,200,engine.snapshot()));
  route('/config',async(req,res)=>{if(req.method==='GET')return send(res,200,{ok:true,config:engine.config});postOnly(req);engine.saveConfig(await body(req));tick();send(res,200,{ok:true,config:engine.config});});
  route('/profile',async(req,res)=>{if(req.method==='GET')return send(res,200,{ok:true,profile:engine.profile});postOnly(req);send(res,200,{ok:true,profile:engine.saveProfile(await body(req))});});
  route('/event',async(req,res)=>{postOnly(req);const b=await body(req);let value;if(b.action==='add')value=engine.add(b.templateId,{manual:true});else if(b.action==='end')value=engine.end(b.id,'操作者手动结束');else if(b.action==='reset'){for(const e of [...engine.state.active])engine.end(e.id,'操作者重置，保留历史与冷却');value=true;}else throw Error('未知事件操作');send(res,200,{ok:true,value});});
  route('/simulate',async(req,res)=>{postOnly(req);send(res,200,{ok:true,...engine.simulate(await body(req))});});
  route('/simulate/judge',async(req,res)=>{
    postOnly(req);const b=await body(req),install=engine.read('mood-link-install.json',{});
    if(!install.installed||!install.moduleUrl)throw Error('尚未安装原心情插件的生活联动适配');
    const agent=list().find(a=>engine.bound(idOf(a)));if(!agent)throw Error('请先载入岑舒会话');
    const template=engine.templates.events.find(e=>e.id===b.templateId);if(!template)throw Error('请选择模拟事件');
    let seed=Number(b.seed)||42;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
    const reaction=sampleLifeReaction(template,'start',engine.reactions,{...engine.config,lifeMoodEnabled:true,lifeMoodChance:1},random);
    const id='simulation:'+Date.now(),lifeInputs=[{id,event:template.name,phase:'start',stage:template.stages[0].text,at:Date.now(),reaction:{label:reaction.label,text:reaction.text,suggestedMoodDelta:reaction.moodDelta,suggestedDims:reaction.dims}}];
    const {simulateLifeJudgment}=await import(install.moduleUrl);
    const judged=await simulateLifeJudgment(ctx,agent,{initialState:b.initialState,userText:b.userText,reply:b.reply,lifeInputs});
    const mood={ok:true,mood:judged.after.mood,baseline:70,dims:judged.after.dims,delta:judged.delta.dims,confidence:judged.after.lastConfidence,updatedAt:judged.after.updatedAt};
    const behavior=engine.simulate({mood,dialogue:dialogueSignals(b.nextUserText||''),eventId:template.id});
    send(res,200,{ok:true,...judged,reaction,behavior,fixture:{mood,dialogue:dialogueSignals(b.nextUserText||''),eventId:template.id}});
  });
  route('/simulate/session',async(req,res)=>{postOnly(req);const b=await body(req);if(typeof b.sessionId!=='string'||!/^session-[a-zA-Z0-9-]+$/.test(b.sessionId)||engine.bound(b.sessionId))throw Error('仅允许独立测试会话，不能覆盖正式岑舒会话');if(b.clear)simulations.delete(b.sessionId);else{engine.simulate(b.fixture||{});simulations.set(b.sessionId,{fixture:b.fixture||{},expiresAt:Date.now()+20*60000});}tick();send(res,200,{ok:true,simulation:true,expiresMinutes:20});});
  // Local DSH plugin routes; modifications above enforce the request origin.
  route('/settings',(req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(fs.readFileSync(fileURLToPath(new URL('../settings.html',import.meta.url))));});
  engine.log('生活插件启动；只读心情 v2 适配；不会发送消息或运行心情判断');
}
