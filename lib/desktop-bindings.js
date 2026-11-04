import path from 'node:path';
import os from 'node:os';
// Reuse the existing role binding contract across plugins. Automatic desktop
// bindings never replace the first (QQ) role or admit private/test workers.
export const sessionKey=value=>String(value||'').replace(/^session-/,'');
const idOf=a=>a?.session?.id||a?.id;
export function interactiveDesktop(agent,privateIds,hasHuman){
 const id=idOf(agent),header=agent?.session?.header||{};
 if(/^(?:dsh-automation-session-|bili-whale$|dsh-pet$)/.test(String(id||'')))return false;
 const cwd=header.cwd||agent?.session?.cwd;
 if(typeof cwd==='string'&&path.relative(os.tmpdir(),path.dirname(path.resolve(cwd)))===''&&/^qq-bridge-(?:probe-[a-z0-9-]+|self-test)$/i.test(path.basename(cwd)))return false;
 return !!id&&!agent.parent&&!header.parentSession&&!privateIds.has(sessionKey(id))&&hasHuman===true;
}
export function createDesktopBindings(engine,getCosplay){
 const human=new WeakMap();let status={enabled:false,sessions:[],reason:'等待角色服务'};
 function sync(agents,incoming){
  const isolation=engine.read('../censhu-inner-life/isolation.json',{sessions:[]});
  const display=engine.read('../censhu-inner-life/display-session.json',{}).sessionId;
  const workers=engine.read('../censhu-inner-life/state.json',{});
  const privateIds=new Set([...(isolation.sessions||[]),display,workers.worker?.sessionId,...(workers.workers||[]).map(w=>w.sessionId)].filter(Boolean).map(sessionKey));
  let state;try{state=getCosplay()?.getState?.();}catch{}
  const role=state?.roles?.find(r=>r.id===state.activeRole),expected=engine.read('self-growth-sync.json',{}).roleId;
  const enabled=engine.config.enabled&&state?.enabled===true&&!!role&&(expected?role.id===expected:role.name===engine.profile.name);
  const previous=engine.config.desktopSessionIds||[],auto=new Map(previous.map(id=>[sessionKey(id),id]));
  for(const id of privateIds)auto.delete(id);
  if(enabled)for(const agent of agents){
   if(incoming?.agent===agent&&incoming.message?.source?.kind==='user')human.set(agent,true);
   if(!human.has(agent)){let found=false;try{found=!!agent.session?.snapshotEvents?.().findLast(e=>e.type==='user/message'&&e.data?.source?.kind==='user');}catch{}human.set(agent,found);}
   if(interactiveDesktop(agent,privateIds,human.get(agent))&&!engine.config.sessionIds.some(id=>sessionKey(id)===sessionKey(idOf(agent))))auto.set(sessionKey(idOf(agent)),idOf(agent));
  }
  const manual=engine.config.sessionIds.filter(id=>!previous.some(p=>sessionKey(p)===sessionKey(id)));
  const active=enabled?[...auto.values()]:[];
  const next=[...manual,...active.filter(id=>!manual.some(p=>sessionKey(p)===sessionKey(id)))];
  if(JSON.stringify(next)!==JSON.stringify(engine.config.sessionIds)||JSON.stringify(active)!==JSON.stringify(previous))engine.saveConfig({sessionIds:next,desktopSessionIds:active});
  status={enabled,sessions:active,reason:enabled?'当前Cosplay的真实桌面会话共享生活、情境、审核记忆与心情；测试/子代理/生活工作会话独立隔离':'当前角色未启用或不匹配；保留手动绑定',petInputEffects:false};
  return status;
 }
 return {sync,view:()=>status};
}

// Short answers are linked by the current message id, never by equal text.
export function desktopReplyPair(agent,message){
 if(!message?.id||message.source?.kind!=='user')return undefined;
 const events=agent.session?.snapshotEvents?.()||[];
 const end=events.findLastIndex(e=>e.type==='user/message'&&e.data?.id===message.id);
 if(end<0)return undefined;
 for(let i=end-1;i>=0;i--){const e=events[i],m=e.data?.message||e.data;
  if(e.type==='user/message'&&m?.source?.kind==='user')return undefined;
  if(e.type==='assistant/message'){const text=(m?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
   if(m?.id&&text.trim())return {messageId:message.id,id:m.id,text};
  }
 }
 return undefined;
}
