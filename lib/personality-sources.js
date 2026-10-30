import {createHash,randomUUID} from 'node:crypto';
import {readPersonaCandidates} from './persona-evolution.js';
import {unwrapMemoryResult} from './memory-writeback.js';
const hash=x=>createHash('sha256').update(x).digest('hex').slice(0,24);
export const isPersonalityDerived=text=>/personality-evolution|性格发展·自动同步|性格发展审核结果/.test(String(text||''));
export function evidenceRows(value,source,excluded=[]){
 const rows=[],seen=new Set();
 const add=text=>{if(typeof text!=='string'||!text.trim()||isPersonalityDerived(text)||excluded.some(x=>x&&text.includes(x))||/AIza[\w-]+|sk-[\w-]{12}|gh[pous]_|密码\s*[:：]|API.?key\s*[:：]/i.test(text))return;
  text=text.trim().slice(0,1600);const key=hash(text.replace(/\s+/g,' '));if(seen.has(key))return;seen.add(key);rows.push({id:source+':'+key,source,text});};
 const walk=(v,depth=0)=>{if(depth>7||rows.length>=30||!v)return;if(typeof v==='string'){add(v);return;}if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}if(typeof v!=='object'||isPersonalityDerived(JSON.stringify([v.origin,v.source,v.tags]))||v.ok===false||v.isError)return;
  let found=false;for(const key of ['text','content','summary','memory','excerpt','rendered','context'])if(typeof v[key]==='string'){add(v[key]);found=true;}if(!found)for(const key of ['entries','items','results','memories','records','nodes','data','result','value','content','hits','matches','excerpts'])if(v[key])walk(v[key],depth+1);};walk(value);return rows.slice(0,30);
}
export async function personalitySources(engine,writeback,sessionId,query,excludedTraits=[]){
 const excluded=[...(engine.profile.personalityDevelopment||[]).map(x=>x.text),...excludedTraits],{files,runtime}=readPersonaCandidates(engine),rows=[],health=[];
 const groups=new Map();for(const r of [...files,...runtime.filter(x=>String(x.sessionId).replace(/^session-/,'')===String(sessionId).replace(/^session-/,''))]){if(!groups.has(r.source))groups.set(r.source,[]);groups.get(r.source).push(r);}
 for(const [source,items]of groups){rows.push(...evidenceRows(items,'memory:'+source,excluded));health.push({name:source,status:'read',mode:'bounded-file-or-context'});}
 const agent=writeback.agents?.().find(a=>String(a.session?.id||a.id).replace(/^session-/,'')===String(sessionId).replace(/^session-/,''));
 const calls=[['memory',{action:'list',target:'project'}],['de_memory',{action:'list',target:'project'}],['engram_search',{query,limit:20}],['mdcg_recall',{query,k:20,budget_tokens:4000}],['openviking_search',{query,limit:20}],['mnemon_recall',{query,limit:6}]];
 for(const [name,args]of calls){if(!agent||!writeback.tools?.get?.(name,agent)){health.push({name,status:'unavailable'});continue;}
  try{const raw=await writeback.tools.execute({name,arguments:args,agent,callId:'personality-read-'+randomUUID(),signal:AbortSignal.timeout(20000)}),v=unwrapMemoryResult(raw);if(v?.ok===false||v?.error)throw Error('来源未确认读取');const part=evidenceRows(v,'memory:'+name,excluded);rows.push(...part);health.push({name,status:'read',count:part.length,mode:'bounded-recall'});}catch(error){health.push({name,status:'unavailable',error:String(error.message).slice(0,160)});}
 }
 const ov=writeback.getService?.('openvikingMemory');if(ov?.client?.fetchJSON&&!health.some(x=>x.name==='openviking_search'&&x.status==='read')){try{const response=await ov.client.fetchJSON('/api/v1/search/recall',{method:'POST',body:JSON.stringify({query,quotas:{experiences:4,preferences:4,entities:4,events:8},max_chars:12000,min_score:0.2,render:true})},{timeoutMs:20000});if(!response.ok)throw Error('OpenViking召回未成功');const part=evidenceRows(response.result,'memory:openviking',excluded);rows.push(...part);health.push({name:'openviking-native',status:'read',count:part.length,mode:'bounded-recall'});}catch(error){health.push({name:'openviking-native',status:'unavailable',error:String(error.message).slice(0,160)});}}
 // Deduplicate identical returned facts while retaining every plugin provenance.
 const unique=new Map();for(const row of rows){const k=hash(row.text.replace(/\s+/g,' '));if(unique.has(k))unique.get(k).sources.push(row.source);else unique.set(k,{...row,id:'memory:'+k,sources:[row.source]});}
 return {memories:[...unique.values()].slice(0,300),health,at:engine.now()};
}
