/** Request-only projections at the native adapter boundary.
 * Cordis llm/stream next() accepts no replacement arguments. Keep that waterfall,
 * its original loop-request identity, and its prepared adapter registration intact.
 * The installed DSH runtime funnels prepared and ordinary calls into adapterStream.
 */
const registryKey=Symbol.for('dsh.censhu.request-projectors.v1');
const originalKey=Symbol.for('cordis.original');

function acceptProjection(previous,value){
 if(value===undefined||value===previous)return previous;
 if(!value||typeof value!=='object'||!Array.isArray(value.messages))throw Error('请求投影必须返回包含 messages 的请求');
 for(const key of ['provider','model','sessionId','signal','reasoningEffort','temperature','maxTokens','stop']){
   if(value[key]!==previous[key])throw Error('请求投影不得修改路由或执行字段：'+key);
 }
 const projected={...previous,...value,messages:Object.freeze([...value.messages])};
 if(Array.isArray(projected.tools))projected.tools=Object.freeze([...projected.tools]);
 return Object.freeze(projected);
}

const runtimeOf=llm=>llm?.[originalKey]||llm;
const ordered=registry=>[...registry?.entries.values()||[]].sort((a,b)=>a.priority-b.priority||a.order-b.order);
async function projectRequest(entries,options,{prepared,phase='dispatch'}={}){
 let request=options;
 for(const entry of entries){
   if(phase==='dispatch'){entry.calls++;entry.lastAt=Date.now();}
   try{
     const projected=acceptProjection(request,await entry.project(request,{prepared,phase}));
     if(projected!==request)entry.preserveIdentity?.(request,projected);
     if(projected!==request&&phase==='dispatch')entry.changed++;
     request=projected;
   }catch(error){
     if(phase==='dispatch'){entry.failures++;entry.lastError=String(error?.message||error).slice(0,300);}
     try{entry.onError?.(error,{id:entry.id,request,phase});}catch{}
   }
 }
 return request;
}

/** Reuse earlier projections for budgeting without dispatching an adapter or
 * counting a request. Projectors receive phase='budget' and must avoid receipts.
 */
export async function previewRequestProjectors(llm,request,{beforePriority=Infinity}={}){
 const runtime=runtimeOf(llm),registry=runtime?.[registryKey];
 // If another plugin replaced the boundary, a cheaper preview would promise a
 // projection that the actual request may never receive. Fall back intact.
 if(!registry||runtime.adapterStream!==registry.wrapped)return request;
 const entries=ordered(registry).filter(entry=>entry.priority<beforePriority);
 return projectRequest(entries,request,{phase:'budget'});
}

/** Register an ordered, optionally async projection. An individual failure keeps
 * the preceding request; onError is diagnostic and cannot disrupt dispatch.
 * Replacing an id is HMR-safe: disposing the old owner never removes the new one.
 * Projectors must be pure and may replace messages/tools, never durable history.
 */
export function installRequestProjector(llm,{id,priority=50,project,onError,preserveIdentity}){
 const runtime=runtimeOf(llm);
 if(!runtime||typeof runtime.adapterStream!=='function')throw Error('DSH 最终请求投影接口不可用');
 if(typeof id!=='string'||!id||typeof project!=='function'||!Number.isFinite(priority))throw Error('请求投影注册参数无效');
 let registry=runtime[registryKey];
 if(!registry){
   const own=Object.getOwnPropertyDescriptor(runtime,'adapterStream'),original=runtime.adapterStream;
   registry={entries:new Map(),sequence:0,own,original};
   const wrapped=function(options,prepared){
     const receiver=this,entries=ordered(registry);
     return (async function*(){
       const request=await projectRequest(entries,options,{prepared,phase:'dispatch'});
       yield* original.call(receiver,request,prepared);
     })();
   };
   registry.wrapped=wrapped;
   Object.defineProperty(runtime,'adapterStream',{configurable:true,writable:true,value:wrapped});
   Object.defineProperty(runtime,registryKey,{configurable:true,value:registry});
 }
 const entry={id,priority,project,onError,preserveIdentity,order:registry.sequence++,calls:0,changed:0,failures:0};
 registry.entries.set(id,entry);
 let disposed=false;
 return ()=>{
   if(disposed)return;disposed=true;
   if(registry.entries.get(id)===entry)registry.entries.delete(id);
   if(registry.entries.size||runtime.adapterStream!==registry.wrapped)return;
   if(registry.own)Object.defineProperty(runtime,'adapterStream',registry.own);
   else delete runtime.adapterStream;
   if(runtime[registryKey]===registry)delete runtime[registryKey];
 };
}

export function requestProjectorStatus(llm){
 const runtime=runtimeOf(llm),registry=runtime?.[registryKey];
 return {available:typeof runtime?.adapterStream==='function',installed:!!registry&&runtime.adapterStream===registry.wrapped,boundary:'adapterStream',
   projectors:ordered(registry)
     .map(({id,priority,calls,changed,failures,lastAt,lastError})=>({id,priority,calls,changed,failures,lastAt,lastError}))};
}
