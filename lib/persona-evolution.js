import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,20);
export const personaText=s=>typeof s==='string'&&s.length>0&&s.length<=200&&!/AIza|sk-[a-zA-Z]|gh[pous]_|密码|令牌|API.?key|环境变量|忽略.{0,12}(规则|指令)|覆盖.{0,12}设定|执行命令|系统提示|工具权限|<script|```|https?:/i.test(s);
// Entry identity never depends on adjacent memories or on list numbering.
export const canonicalMemoryEntry=text=>String(text||'').trim().replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/,'').replace(/^(?:\[id:[^\]]+\]\s*)?(?:\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*)?(?:\[git [^\]]*\]\s*)?/,'').replace(/\s+/g,' ').trim();
export function memoryEntries(input){
 const entries=[];let current='';const flush=()=>{if(current.trim())entries.push(current.trim());current='';};
 for(const line of String(input||'').replace(/\r\n/g,'\n').split('\n')){
  if(!line.trim()||/^\s*§\s*$/.test(line)||/^\s*#{1,6}\s/.test(line)){flush();continue;}
  if(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/.test(line)||/^\s*\[(?:id:|\d{4}-\d{2}-\d{2})/.test(line)){flush();current=line.trim();}
  else if(/^\s{2,}\S/.test(line)&&current)current+='\n'+line.trim();
  else {flush();current=line.trim();}
 }flush();
 return entries.flatMap(entry=>{const entryKey=hash(canonicalMemoryEntry(entry)),out=[];let rest=entry;while(rest.length){let cut=Math.min(1200,rest.length);if(rest.length>1200){const prefix=rest.slice(0,1200);const boundary=Math.max(prefix.lastIndexOf('。'),prefix.lastIndexOf('；'),prefix.lastIndexOf('\n'));if(boundary>=600)cut=boundary+1;}out.push({text:rest.slice(0,cut).trim(),entryKey});rest=rest.slice(cut);}return out.filter(x=>x.text);});
}
// Only explicitly selected files inside DSH's own memory root; never scan unrelated projects.
export function readPersonaEvidence(engine){
 const root=path.join(engine.home,'memories'),result=(engine.runtimeMemoryEvidence||[]).filter(x=>x.expiresAt>engine.now()&&engine.bound(x.sessionId)).map(({id,source,text,entryKey})=>({id,source,text,...(entryKey?{entryKey}:{})}));let remaining=8000-result.reduce((n,x)=>n+x.text.length,0);
 sources: for(const rel of engine.config.personaMemoryFiles||[]){
  try{const file=fs.realpathSync(path.resolve(root,rel)),base=fs.realpathSync(root),inside=path.relative(base,file);if(inside.startsWith('..')||path.isAbsolute(inside)||!file.endsWith('.md')||fs.statSync(file).size>262144)continue;
   const entries=memoryEntries(fs.readFileSync(file,'utf8'));
   for(const {text,entryKey} of entries){if(!text||text.length>1200||!/岑舒|青枔/.test(text)||/AIza|sk-[a-zA-Z]|gh[pous]_|密码|令牌|API.?key|环境变量|忽略.{0,12}(规则|指令)/i.test(text)||text.length>remaining)continue;result.push({id:hash(rel+'|'+entryKey+'|'+canonicalMemoryEntry(text)),source:rel,text,entryKey});remaining-=text.length;if(result.length>=32||remaining<=0)break sources;}
  }catch{/* Missing files are reported through the evidence count; reads never write memories. */}
 }
 const revoked=new Set(engine.read('persona-revocations.json',{revokedEvidenceIds:[]}).revokedEvidenceIds||[]);return result.filter(e=>!revoked.has(e.id));
}
export function validatePersonaFacts(raw,evidence,now,previous=[],{tolerant=false,rejected=[],revokedEvidenceIds=[],revokedFactIds=[]}={}){
 if(!Array.isArray(raw)){if(!tolerant)throw Error('记忆人物补充格式无效');rejected.push({section:'personaFacts',reason:'不是数组'});raw=[];}
 if(raw.length>16&&!tolerant)throw Error('记忆人物补充格式无效');
 const allowed=new Map(evidence.map(x=>[x.id,x])),revokedFacts=new Set(revokedFactIds);
 const facts=raw.slice(0,16).flatMap((f,index)=>{try{
  if(!f||!['experience','preference','relationship'].includes(f.kind)||!personaText(f.text)||!Number.isFinite(f.confidence)||f.confidence<90||f.confidence>100||!Number.isInteger(f.validDays)||f.validDays<1||f.validDays>90||!Array.isArray(f.evidenceIds)||f.evidenceIds.length<1||f.evidenceIds.length>4||f.evidenceIds.some(id=>!allowed.has(id)))throw Error('人物补充缺少可信记忆依据');
  const id=hash(f.kind+'|'+f.text),old=previous.find(x=>x.id===id);if(revokedFacts.has(id))return [];
  return [{id,kind:f.kind,text:f.text,evidence:[...new Map([...(old?.evidence||[]),...f.evidenceIds.map(id=>({id,source:allowed.get(id).source,text:allowed.get(id).text,...(allowed.get(id).entryKey?{entryKey:allowed.get(id).entryKey}:{})}))].map(e=>[e.id,e])).values()],evidenceIds:[...new Set(f.evidenceIds)],sources:[...new Set(f.evidenceIds.map(id=>allowed.get(id).source))],confidence:f.confidence,createdAt:old?.createdAt??now,expiresAt:old?.expiresAt??now+f.validDays*86400000}];
 }catch(error){if(!tolerant)throw error;rejected.push({section:'personaFacts',index,reason:error.message});return [];}});
 const revoked=new Set(revokedEvidenceIds);
 const pool=new Map(previous.filter(f=>f.expiresAt>now&&personaText(f.text)&&!revokedFacts.has(f.id)&&!f.evidenceIds?.some(id=>revoked.has(id))).map(f=>[f.id,{...f,...(!f.evidence&&f.evidenceIds?.every(id=>allowed.has(id))?{evidence:f.evidenceIds.map(id=>({id,source:allowed.get(id).source,text:allowed.get(id).text,...(allowed.get(id).entryKey?{entryKey:allowed.get(id).entryKey}:{})}))}:{})}]));for(const f of facts)pool.set(f.id,f);return [...pool.values()].filter(f=>f.expiresAt>now).slice(0,32);
}
export function validateSavedFacts(facts){if(!Array.isArray(facts)||facts.length>32||facts.some(f=>!personaText(f.text)||!['experience','preference','relationship'].includes(f.kind)||!Number.isFinite(f.expiresAt)||!Number.isFinite(f.createdAt)||!Array.isArray(f.evidenceIds)||!Array.isArray(f.sources)||(f.evidence!==undefined&&(!Array.isArray(f.evidence)||f.evidence.some(e=>typeof e.id!=='string'||typeof e.source!=='string'||typeof e.text!=='string'||e.text.length>1200)))))throw Error('人物成长记录无效');return facts;}

export function captureMemoryContexts(engine,sessionId,contexts){
 if(!engine.bound(sessionId)||!engine.config.personaEvolutionEnabled)return;
 const known=contexts.filter(c=>typeof c.name==='string'&&/^(memory:|mnemon(?:[:/-]|$)|dsh-mnemon(?:[:/-]|$)|openviking(?:[:/-]|$))/.test(c.name)&&typeof c.text==='string');
 if(!known.length)return;
 let rows=(engine.runtimeMemoryEvidence||[]).filter(x=>x.expiresAt>engine.now()&&!(x.sessionId===sessionId&&known.some(c=>x.source==='context:'+c.name)));
 for(const c of known){const source='context:'+c.name;for(const {text,entryKey} of memoryEntries(c.text).filter(({text})=>text.length>2&&/岑舒|青枔/.test(text)&&!/AIza|sk-[a-zA-Z]|gh[pous]_|密码|令牌|API.?key|环境变量|忽略.{0,12}(规则|指令)/i.test(text)).slice(0,12)){const id=hash(sessionId+'|'+source+'|'+entryKey+'|'+canonicalMemoryEntry(text)),old=(engine.runtimeMemoryEvidence||[]).find(x=>x.id===id);rows.push({id,source,text,entryKey,sessionId,at:old?.at??engine.now(),expiresAt:old?.expiresAt??engine.now()+7*86400000});}}
 rows=rows.slice(-32);while(rows.reduce((n,x)=>n+x.text.length,0)>6000)rows.shift();
 if(JSON.stringify(rows)!==JSON.stringify(engine.runtimeMemoryEvidence||[])){engine.runtimeMemoryEvidence=rows;engine.write('memory-evidence.json',{version:1,evidence:rows});}
}

export function validatedRevocations(raw,evidence,previous,rejected=[]){
 if(raw===undefined)return [];if(!Array.isArray(raw)){rejected.push({section:'factRevocations',reason:'不是数组'});return [];}
 const allowed=new Set(evidence.map(e=>e.id));return raw.slice(0,16).flatMap((r,index)=>{if(!r||!previous.some(f=>f.id===r.factId)||!Number.isFinite(r.confidence)||r.confidence<90||!personaText(r.reason)||!Array.isArray(r.evidenceIds)||!r.evidenceIds.length||r.evidenceIds.some(id=>!allowed.has(id))){rejected.push({section:'factRevocations',index,reason:'撤销缺少明确的当前证据'});return [];}return [r.factId];});
}
export function revokeDeletedMemory(engine,content,source='memory'){
 if(typeof content!=='string'||!canonicalMemoryEntry(content))return false;
 const previous=engine.profile.evolvingFacts||[],revokedIds=new Set();
 const next=previous.map(f=>({...f,evidence:f.evidence?.map(e=>{if(e.entryKey?e.entryKey===hash(canonicalMemoryEntry(content)):canonicalMemoryEntry(e.text)===canonicalMemoryEntry(content)){revokedIds.add(e.id);return {...e,revokedAt:engine.now()};}return e;})}));
 if(!revokedIds.size)return false;
 const removed=next.filter(f=>f.evidence?.length&&f.evidence.every(e=>e.revokedAt));const ids=new Set(removed.map(f=>f.id));
 const history=engine.read('persona-revocations.json',{version:1,entries:[],revokedEvidenceIds:[]});history.entries=[...history.entries,{at:engine.now(),reason:'原记忆工具明确删除证据',source,removed}].slice(-32);history.revokedEvidenceIds=[...new Set([...(history.revokedEvidenceIds||[]),...revokedIds])].slice(-1000);engine.write('persona-revocations.json',history);engine.saveProfile({evolvingFacts:next.filter(f=>!ids.has(f.id))});return true;
}
