const validId=id=>typeof id==='string'&&id.length>0;
const identity=id=>validId(id)?id.replace(/^session-/,''):null;
const archiveSet=value=>Array.isArray(value)&&value.every(validId)?new Map(value.map(id=>[identity(id),id])):null;
const validTurn=turn=>Number.isSafeInteger(turn)&&turn>0;

/** The installed DSH workspace registry publishes archival through its durable
 * singleton domain change, not a session/archive event. Session detachment
 * publishes session/disposed; api-session/removed is merely its UI forwarding.
 * Clearing only these ephemeral snapshots never removes persisted history. */
export function installContextLifecycle(ctx,forget,{startTurn,endTurn}={}){
 if(typeof forget!=='function')throw Error('上下文快照生命周期缺少清理函数');
 let archived=new Map(),disposed=false;const offs=[],activeTurns=new Map(),retiredSessions=new WeakSet();
 const update=next=>{
  if(disposed||!next)return;
  const previous=archived;archived=next;
  for(const [key,id] of next)if(!previous.has(key)){activeTurns.delete(key);forget(id);}
 };
 try{
  offs.push(ctx.on('domain/changed',change=>{
   if(change?.domain!=='workspace'||change.table!==''||change.operation!=='put')return;
   update(archiveSet(change.value?.archivedSessionIds));
  },{global:true}));
  offs.push(ctx.on('session/disposed',session=>{
   if(!disposed&&validId(session?.id)){retiredSessions.add(session);activeTurns.delete(identity(session.id));forget(session.id);}
  },{global:true}));
  offs.push(ctx.on('session/event',(session,event)=>{
   if(disposed||!validId(session?.id)||retiredSessions.has(session)||!validTurn(event?.data?.turn))return;
   const key=identity(session.id),turn=event.data.turn;
   if(archived.has(key))return;
   const current=activeTurns.get(key);
   if(event.type==='turn/start'){
    // Repeated or late notifications must not reset an existing turn's reads.
    if(current!==undefined&&current>=turn)return;
    activeTurns.set(key,turn);startTurn?.(session.id,turn);
   }else if(event.type==='turn/end'&&(current===undefined||current===turn)){
    activeTurns.delete(key);endTurn?.(session.id,turn);
   }
  },{global:true}));
  // Register first so a domain update cannot be missed while taking baseline.
  // Optional service lookup keeps the recall tool usable in lightweight hosts.
  update(archiveSet(ctx.get?.('workspaceRegistry')?.archivedSessionIds));
 }catch(error){
  disposed=true;for(const off of offs.reverse())if(typeof off==='function')off();
  throw error;
 }
 return {
  isArchived:id=>!disposed&&archived.has(identity(id)),
  isRetired:session=>disposed||Boolean(session&&retiredSessions.has(session)),
  currentTurn(session){
   if(disposed||!validId(session?.id)||retiredSessions.has(session)||archived.has(identity(session.id)))return undefined;
   const key=identity(session.id),active=activeTurns.get(key);if(active!==undefined)return active;
   // Hot reload may attach after turn/start. Use the registered host projection,
   // never private agent.phase, deprecated event snapshots, or message guessing.
   try{
    const state=ctx.get?.('sessionProjections')?.stateOf?.(session,'turnBoundary');
    if(validTurn(state?.lastTurn)&&Number.isSafeInteger(state.openTurnStartSeq)&&state.openTurnStartSeq>=0){
     activeTurns.set(key,state.lastTurn);return state.lastTurn;
    }
   }catch{}
   return undefined;
  },
  dispose(){if(disposed)return;disposed=true;for(const off of offs.reverse())if(typeof off==='function')off();archived.clear();activeTurns.clear();}
 };
}
