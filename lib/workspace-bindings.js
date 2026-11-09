import fs from 'node:fs';
import path from 'node:path';
const key=x=>String(x||'').replace(/^session-/,'');
const canonical=x=>{if(!x)return '';try{return fs.realpathSync(x).replaceAll('\\','/').toLowerCase();}catch{return path.resolve(x).replaceAll('\\','/').toLowerCase();}};
export function workspacePolicy(engine){return engine.read('workspace-bindings.json',{enabled:false,workspaces:[]});}
export function matchesRoleWorkspace(agent,policy,registry){
 const h=agent?.session?.header||{},id=agent?.session?.id||agent?.id;
 if(!policy?.enabled||!id||agent.parent||h.parentSession||h.origin==='subagent')return false;
 if((registry?.archivedSessionIds||[]).some(x=>key(x)===key(id)))return false;
 const records=registry?.list?.()||[];
 return (policy.workspaces||[]).some(rule=>{
  const w=records.find(x=>(x.id||x.workspaceId)===rule.id);
  return (w?.sessionIds||[]).some(x=>key(x)===key(id))||canonical(h.cwd||agent.session.cwd)===canonical(w?.path||rule.path);
 });
}
// Resolve persisted roots once; creation events cover new sessions before their first turn.
// Polling reconciles archive/move events without starting any model turn.
export function syncWorkspaceTargets(engine,ids){
 const file=path.join(engine.home,'speak-up-config.json');
 if(!fs.existsSync(file))return;
 const config=JSON.parse(fs.readFileSync(file,'utf8'));
 const old=engine.read('workspace-binding-targets.json',{sessions:[]}).sessions;
 const targets=[...new Set([...(config.目标会话||[]).filter(id=>!old.some(x=>key(x)===key(id))),...ids])];
 if(JSON.stringify(targets)!==JSON.stringify(config.目标会话)){
  const tmp=file+'.workspace.tmp';fs.writeFileSync(tmp,JSON.stringify({...config,目标会话:targets},null,2));fs.renameSync(tmp,file);
 }
 if(JSON.stringify(old)!==JSON.stringify(ids))engine.write('workspace-binding-targets.json',{sessions:ids});
}
export function installWorkspaceBindings(ctx,engine,mount){
 if(typeof ctx.inject!=='function')return;
 ctx.inject(['agents','sandboxPolicy','sessionQuery','sessionController','workspaceRegistry'],child=>{
  let stopped=false,busy=false;const visited=new Set();
  const bind=agent=>{
   if(stopped||!matchesRoleWorkspace(agent,workspacePolicy(engine),child.workspaceRegistry))return;
   if(child.sandboxPolicy.overrideOf(agent.session)!=='danger-full-access')agent.session.append('sandbox/mode',{mode:'danger-full-access'});
   mount([...new Set([...child.agents.roots(),agent])]);
  };
  child.on('agent/created',({agent})=>bind(agent));
  const sync=async()=>{
   if(stopped||busy)return;busy=true;
   try{
    const policy=workspacePolicy(engine);if(!policy.enabled)return;
    const records=await child.sessionQuery.listSessions();if(stopped)return;
    const ids=[];
    for(const record of records){
     const h=record.header;if(!matchesRoleWorkspace({session:{id:h?.id,header:h}},policy,child.workspaceRegistry))continue;
     ids.push(h.id);
     if(!visited.has(h.id)){
      const result=await child.sessionController.resolveAgent(h.id);if(stopped)return;
      if(result.agent){bind(result.agent);visited.add(h.id);}
     }
    }
    for(const a of child.agents.roots())bind(a);
    syncWorkspaceTargets(engine,ids);
    engine.workspaceBindingStatus={enabled:true,workspaces:policy.workspaces,sessions:ids,permissions:'danger-full-access',at:Date.now()};
   }catch(error){engine.workspaceBindingStatus={enabled:true,error:error.message,at:Date.now()};}
   finally{busy=false;}
  };
  child.effect(()=>{void sync();const timer=setInterval(()=>void sync(),5000);return()=>{stopped=true;clearInterval(timer);};});
 });
}
