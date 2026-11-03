import {createHash,randomUUID} from 'node:crypto';
import {readPersonaCandidates} from './persona-evolution.js';
import {unwrapMemoryResult} from './memory-writeback.js';
const hash=x=>createHash('sha256').update(x).digest('hex').slice(0,24);
export const isPersonalityDerived=text=>/personality-evolution|性格发展·自动同步|性格发展审核结果/.test(String(text||''));
export function evidenceRows(value,source,excluded=[]){
 const rows=new Map();
 const provider=/openviking/i.test(source)?'openviking':/engram/i.test(source)?'engram':/mnemon/i.test(source)?'mnemon':/mdcg|lingshu/i.test(source)?'lingshu':'memory';
 const add=(text,record)=>{
  if(typeof text!=='string'||!text.trim()||isPersonalityDerived(text)||excluded.some(x=>x&&text.includes(x))||/AIza[\w-]+|sk-[\w-]{12}|gh[pous]_|密码\s*[:：]|API.?key\s*[:：]/i.test(text))return;
  const full=text.trim();text=full.slice(0,1600);const key=hash(text.replace(/\s+/g,' '));
  if(!rows.has(key)){if(rows.size>=30)return;rows.set(key,{id:source+':'+key,source,text,records:[]});}
  if(provider==='memory'&&record?.source)return;
  const id=record?.uri||record?.node_id||record?.memory_id||record?.id;
  if(typeof id!=='string'||!id)return;
  const scope=record.scope||record.layer||(provider==='openviking'&&id.startsWith('viking://user/')?'user':null);
  const contentHash=createHash('sha256').update(full.normalize('NFKC').replace(/\s+/g,' ')).digest('hex');
  const origin={provider,scope,id,observedAt:Date.now(),version:String(record.revision||record.sha256||record.version||contentHash),versionKind:record.revision||record.sha256||record.version?'native':'content',contentHash};
  const refs=rows.get(key).records;if(!refs.some(r=>r.provider===provider&&r.scope===scope&&r.id===id&&r.version===origin.version))refs.push(origin);
 };
 const walk=(v,depth=0)=>{
  if(depth>7||!v)return;
  if(typeof v==='string'){if(/^[\s]*[\[{]/.test(v)){try{const parsed=JSON.parse(v);if(parsed&&typeof parsed==='object'){walk(parsed,depth+1);return;}}catch{}}add(v);return;}
  if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}
  if(typeof v!=='object'||isPersonalityDerived(JSON.stringify([v.origin,v.source,v.tags]))||v.ok===false||v.isError)return;
  const children=['entries','items','results','memories','records','nodes','data','result','value','hits','matches','excerpts','preferences','experiences','entities','events'].filter(k=>v[k]&&typeof v[k]==='object');
  if(children.length&&!v.uri&&!v.id){for(const k of children)walk(v[k],depth+1);return;}
  let found=false;for(const k of ['text','content','summary','abstract','memory','excerpt','rendered','context'])if(typeof v[k]==='string'){add(v[k],v);found=true;}
  if(!found){for(const k of children)walk(v[k],depth+1);if(Array.isArray(v.content))walk(v.content,depth+1);}
 };walk(value);return [...rows.values()];
}
export async function personalitySources(engine,writeback,sessionId,query,excludedTraits=[]){
 const excluded=[...(engine.profile.personalityDevelopment||[]).map(x=>x.text),...excludedTraits],{files,runtime}=readPersonaCandidates(engine),rows=[],health=[];
 const groups=new Map();for(const r of [...files,...runtime.filter(x=>String(x.sessionId).replace(/^session-/,'')===String(sessionId).replace(/^session-/,''))]){if(!groups.has(r.source))groups.set(r.source,[]);groups.get(r.source).push(r);}
 for(const [source,items]of groups){rows.push(...evidenceRows(items,'memory:'+source,excluded));health.push({name:source,status:'read',mode:'bounded-file-or-context'});}
 const agent=writeback.agents?.().find(a=>String(a.session?.id||a.session?.sessionId||a.id).replace(/^session-/,'')===String(sessionId).replace(/^session-/,''));
 if(!agent)throw Error('绑定会话尚未载入，稍后读取全部可用记忆接口');
 const calls=[['memory',{action:'list',target:'project'}],['de_memory',{action:'list',target:'project'}],['engram_search',{query,limit:20}],['mdcg_recall',{query,k:20,budget_tokens:4000}],['openviking_search',{query,limit:20}],['mnemon_recall',{query,limit:6}]];
 for(const [name,args]of calls){
  // Background reads have no pinned turn View. Use Mnemon's scoped read-only
  // management service, preserving its capability checks and session routing.
  const mnemon=name==='mnemon_recall'?writeback.getService?.('mnemonRemote'):null;
  if(typeof mnemon?.read==='function'){
   try{const result=await mnemon.read('search',{...args,sessionId:agent.session?.id||agent.session?.sessionId||agent.id},AbortSignal.timeout(20000));if(result?.ok!==true)throw Error(result?.error?.message||'Mnemon后台读取未确认');const part=evidenceRows(result.value,'memory:'+name,excluded);rows.push(...part);health.push({name,status:'read',count:part.length,mode:'scoped-background-read'});}catch(error){health.push({name,status:'unavailable',error:String(error.message).slice(0,160)});}
   continue;
  }
  if(!agent||!writeback.tools?.get?.(name,agent)){health.push({name,status:'unavailable'});continue;}
  try{const raw=await writeback.tools.execute({name,arguments:args,agent,callId:'personality-read-'+randomUUID(),signal:AbortSignal.timeout(20000)}),v=unwrapMemoryResult(raw);if(v?.ok===false||v?.error)throw Error('来源未确认读取');const part=evidenceRows(v,'memory:'+name,excluded);rows.push(...part);health.push({name,status:'read',count:part.length,mode:'bounded-recall'});}catch(error){health.push({name,status:'unavailable',error:String(error.message).slice(0,160)});}
 }
 const ov=writeback.getService?.('openvikingMemory');if(ov?.client?.fetchJSON&&!health.some(x=>x.name==='openviking_search'&&x.status==='read')){try{const response=await ov.client.fetchJSON('/api/v1/search/recall',{method:'POST',body:JSON.stringify({query,quotas:{experiences:4,preferences:4,entities:4,events:8},max_chars:12000,min_score:0.2,render:true})},{timeoutMs:20000});if(!response.ok)throw Error('OpenViking召回未成功');const part=evidenceRows(response.result,'memory:openviking',excluded);rows.push(...part);health.push({name:'openviking-native',status:'read',count:part.length,mode:'bounded-recall'});}catch(error){health.push({name:'openviking-native',status:'unavailable',error:String(error.message).slice(0,160)});}}
 // Deduplicate identical returned facts while retaining every plugin provenance.
 const unique=new Map();for(const row of rows){const k=hash(row.text.replace(/\s+/g,' '));if(unique.has(k)){const prior=unique.get(k);if(!prior.sources.includes(row.source))prior.sources.push(row.source);for(const ref of row.records)if(!prior.records.some(r=>r.provider===ref.provider&&r.id===ref.id&&r.scope===ref.scope&&r.version===ref.version))prior.records.push(ref);}else unique.set(k,{...row,id:'memory:'+k,sources:[row.source]});}
 return {memories:[...unique.values()].slice(0,300),health,at:engine.now()};
}
