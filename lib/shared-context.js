import {readPersonaCandidates,readPersonaEvidence} from './persona-evolution.js';
import {clock} from './engine.js';

// In-process integration only: snapshots do not assemble or modify another agent's turn.
export function sharedLifeContext(engine,writeback){
 const resolve=request=>{
  const id=request?.sessionId||engine.config.sessionIds[0];
  if(!engine.config.enabled||!engine.config.context||!id||!engine.bound(id))throw Error('共享生活会话未启用或未绑定');
  return id;
 };
 return {
  snapshot(request={}){
   const sessionId=resolve(request),now=engine.now();
   const {files,runtime}=readPersonaCandidates(engine);
   const candidates=[...files,...runtime.filter(x=>String(x.sessionId).replace(/^session-/,'')===String(sessionId).replace(/^session-/,''))];
   const byId=new Map(candidates.map(x=>[x.id,x]));
   const selected=(engine.read('memory-selection.json',{}).selectedIds||[]).flatMap(id=>byId.has(id)?[byId.get(id)]:[]);
   const seen=new Set(),memories=[];let budget=8000;
   for(const row of [...selected,...readPersonaEvidence(engine)]){
    if(!byId.has(row.id)||seen.has(row.id)||row.text.length>budget)continue;
    if(row.sessionId&&String(row.sessionId).replace(/^session-/,'')!==String(sessionId).replace(/^session-/,''))continue;
    seen.add(row.id);budget-=row.text.length;memories.push({source:row.source,text:row.text});
    if(memories.length>=32)break;
   }
   const hour=Number(clock(now,engine.config.timezone).hour);
   return {sessionId,name:engine.profile.name,context:engine.context(sessionId,{now}),memories,quiet:hour>=2&&hour<6,at:now};
  },
  observe(request){
   const sessionId=resolve(request);
   if(typeof request.text!=='string'||!request.text.trim()||request.text.length>3000)throw Error('需要1至3000字的真实桌宠来信');
   // Only human input enters the existing model review queue, never generated pet replies.
   if(!engine.config.memoryWritebackEnabled)return {accepted:false};
   writeback.observe(sessionId,request.text);
   return {accepted:true};
  },
 };
}
