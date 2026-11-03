/** Estimate DSH's model-facing text before provider-specific framing. Never tokenize binary media. */
export function estimateText(text=''){
 let ascii=0,wide=0;
 for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);if(code<128)ascii++;else wide++;}
 return Math.ceil(ascii/3+wide);
}
function estimate(value){
 if(typeof value==='string')return estimateText(value);
 if(!value||typeof value!=='object')return value==null?0:2;
 if(value.type==='image'||value.type==='image_url'||value.type==='audio')return 1024;
 if(Array.isArray(value))return value.reduce((n,v)=>n+estimate(v),0);
 let n=2;for(const [key,v] of Object.entries(value)){
  if(['source','replay','providerMetadata','reasoningSignature'].includes(key))continue;
  if(key==='data'&&typeof v==='string'&&v.length>16000){n+=1024;continue;}
  n+=estimateText(key)+estimate(v);
 }return n;
}
const scope=agent=>agent?.session?.id||agent?.id;
const compactHint='（本轮仅提供选中的资料。）';
export function roleContextBudget(){
 const origins=new WeakMap(),cache=new WeakMap(),stats=new Map();
 const cost=value=>{if(!value||typeof value!=='object'||!Object.isFrozen(value))return estimate(value);
  if(!cache.has(value))cache.set(value,estimate(value));return cache.get(value);};
 function historyCost(messages){
  let history=0,system=0,runtime=0;
  for(const msg of messages||[]){const n=cost(msg);if(msg.role==='system')system+=n;else if(msg.source?.kind==='runtime-context')runtime+=n;else history+=n;}
  return {history,system,runtime};
 }
 function add(assembly,agent,field,name,parts,hint,onAccepted){
  const groups=[],out={...assembly};
  let foreign=0;
  for(const key of ['contexts','sections']){
   out[key]=[];
   for(const entry of assembly[key]||[]){
    if(key===field&&entry.name===name)continue;
    const source=origins.get(entry);if(source)groups.push(source);else foreign+=estimateText(entry.text);
    out[key].push(entry);
   }
  }
  const fresh={field,name,parts,hint,onAccepted};groups.push(fresh);
  const session=agent?.session,header=session?.requestHeader?.()?.config||{},context=session?.requestContext?.()||{};
  const selected=agent?.options?.model||header.model;
  const knownWindow=Number.isFinite(context.contextWindow)&&context.contextWindow>0&&(!selected||context.model===selected);
  const window=knownWindow?context.contextWindow:32768;
  const tools=cost(assembly.tools||[]),prior=historyCost(session?.deriveMessages?.()||[]);
  const reserve=Math.max(2048,Math.min(window/2,Number(header.maxTokens)||Math.ceil(window*.12)));
  const task=groups.some(g=>g.name==='censhu-agency-current')?'life':'chat';
  const limit=Math.max(0,Math.floor(Math.min(task==='life'?12000:8000,window*(task==='life'?.09:.06),window-reserve-tools-foreign-prior.history-prior.system-prior.runtime)));
  const ranked=groups.flatMap(g=>g.parts.map((p,i)=>({...p,g,i}))).filter(x=>x.text).sort((a,b)=>Number(!!b.required)-Number(!!a.required)||(b.priority||0)-(a.priority||0));
  const selectedParts=new Map(groups.map(g=>[g,[]])),deferred=new Set(),seen=new Set();
  let used=0;
  // Reserve each recovery pointer before selecting optional content.
  let room=limit-groups.reduce((n,g)=>n+estimateText(g.hint||compactHint)+2,0);
  for(const p of ranked){
   if(p.key&&seen.has(p.key))continue;
   const n=estimateText(p.text)+2;
   if(!p.required&&n>room){deferred.add(p.g);continue;}
   if(p.key)seen.add(p.key);
   selectedParts.get(p.g).push(p);room-=n;
  }
  for(const g of groups){
   const ordered=selectedParts.get(g).sort((a,b)=>a.i-b.i);
   const text=[...ordered.map(x=>x.text),...(deferred.has(g)?[g.hint||compactHint]:[])].join('\n');
   const entry={name:g.name,text,interpolate:false,...(g.field==='contexts'?{order:925}:{})};
   const idx=out[g.field].findIndex(e=>origins.get(e)===g);
   if(idx===-1)out[g.field].push(entry);else out[g.field][idx]=entry;
   origins.set(entry,g);g.onAccepted?.(text);used+=estimateText(text);
  }
  for(const key of ['contexts','sections'])if(!groups.some(g=>g.field===key)){
   if(Object.hasOwn(assembly,key))out[key]=assembly[key];else delete out[key];}
  const id=scope(agent);if(id){if(!stats.has(id)&&stats.size>=32)stats.delete(stats.keys().next().value);
   stats.set(id,{...stats.get(id),at:Date.now(),task,model:selected||context.model||null,window,windowSource:knownWindow?'DSH':'fallback',limit,used,overBudget:Math.max(0,used-limit),tools,otherPrompt:foreign,prior,omitted:ranked.length-[...selectedParts.values()].reduce((n,s)=>n+s.length,0)});}
  return out;
 }
 function observe(request){
  const row=stats.get(request?.sessionId);if(!row)return;
  const messages=historyCost(request.messages||[]),tools=cost(request.tools||[]),sections={};
  const latest=request.messages?.findLast(msg=>msg.source?.kind==='runtime-context');
  for(const entry of latest?.source?.sections||[]){if(typeof entry.name==='string'&&typeof entry.text==='string')sections[entry.name]=estimateText(entry.text);}
  row.request={at:Date.now(),provider:request.provider,model:request.model,...messages,tools,sections,total:messages.history+messages.system+messages.runtime+tools};
 }
 function recordUsage(id,usage){
  const request=stats.get(id)?.request;
  if(request&&!request.reported&&Number.isFinite(usage?.inputTokens)){
   request.reported={inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,cacheReadTokens:usage.cacheReadTokens,cacheWriteTokens:usage.cacheWriteTokens};
  }
 }
 return {add,observe,recordUsage,status:()=>[...stats.entries()].map(([sessionId,row])=>({sessionId,...row}))};
}
