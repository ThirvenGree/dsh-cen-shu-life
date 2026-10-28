import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,20);
export const personaText=s=>typeof s==='string'&&s.length>0&&s.length<=200&&!/AIza|sk-[a-zA-Z]|gh[pous]_|密码|令牌|API.?key|环境变量|忽略.{0,12}(规则|指令)|覆盖.{0,12}设定|执行命令|系统提示|工具权限|<script|```|https?:/i.test(s);
// Only explicitly selected files inside DSH's own memory root; never scan unrelated projects.
export function readPersonaEvidence(engine){
 const root=path.join(engine.home,'memories'),result=(engine.runtimeMemoryEvidence||[]).filter(x=>x.expiresAt>engine.now()&&engine.bound(x.sessionId)).map(({id,source,text})=>({id,source,text}));let remaining=8000-result.reduce((n,x)=>n+x.text.length,0);
 for(const rel of engine.config.personaMemoryFiles||[]){
  try{const file=fs.realpathSync(path.resolve(root,rel)),base=fs.realpathSync(root),inside=path.relative(base,file);if(inside.startsWith('..')||path.isAbsolute(inside)||!file.endsWith('.md')||fs.statSync(file).size>262144)continue;
   const paragraphs=fs.readFileSync(file,'utf8').split(/\r?\n\s*\r?\n/);
   for(const paragraph of paragraphs){const text=paragraph.trim();if(!text||text.length>1200||!/岑舒|青枔/.test(text)||/AIza|sk-[a-zA-Z]|gh[pous]_|密码|令牌|API.?key|环境变量|忽略.{0,12}(规则|指令)/i.test(text)||text.length>remaining)continue;result.push({id:hash(rel+'|'+text),source:rel,text});remaining-=text.length;if(result.length>=32||remaining<=0)return result;}
  }catch{/* Missing files are reported through the evidence count; reads never write memories. */}
 }
 return result;
}
export function validatePersonaFacts(raw,evidence,now,previous=[]){
 if(!Array.isArray(raw)||raw.length>16)throw Error('记忆人物补充格式无效');
 const allowed=new Map(evidence.map(x=>[x.id,x]));
 const facts=raw.map(f=>{
  if(!['experience','preference','relationship'].includes(f.kind)||!personaText(f.text)||!Number.isFinite(f.confidence)||f.confidence<90||f.confidence>100||!Number.isInteger(f.validDays)||f.validDays<1||f.validDays>90||!Array.isArray(f.evidenceIds)||f.evidenceIds.length<1||f.evidenceIds.length>4||f.evidenceIds.some(id=>!allowed.has(id)))throw Error('人物补充缺少可信记忆依据');
  const id=hash(f.kind+'|'+f.text),old=previous.find(x=>x.id===id);
  return {id,kind:f.kind,text:f.text,evidenceIds:[...new Set(f.evidenceIds)],sources:[...new Set(f.evidenceIds.map(id=>allowed.get(id).source))],confidence:f.confidence,createdAt:old?.createdAt??now,expiresAt:old?.expiresAt??now+f.validDays*86400000};
 });
 const pool=new Map(previous.filter(f=>f.expiresAt>now&&personaText(f.text)&&f.evidenceIds?.every(id=>allowed.has(id))).map(f=>[f.id,f]));for(const f of facts)pool.set(f.id,f);return [...pool.values()].filter(f=>f.expiresAt>now).slice(-32);
}
export function validateSavedFacts(facts){if(!Array.isArray(facts)||facts.length>32||facts.some(f=>!personaText(f.text)||!['experience','preference','relationship'].includes(f.kind)||!Number.isFinite(f.expiresAt)||!Number.isFinite(f.createdAt)||!Array.isArray(f.evidenceIds)||!Array.isArray(f.sources)))throw Error('人物成长记录无效');return facts;}

export function captureMemoryContexts(engine,sessionId,contexts){
 if(!engine.bound(sessionId)||!engine.config.personaEvolutionEnabled)return;
 const known=contexts.filter(c=>typeof c.name==='string'&&/^(memory:|mnemon(?:[:/-]|$)|dsh-mnemon(?:[:/-]|$)|openviking(?:[:/-]|$))/.test(c.name)&&typeof c.text==='string');
 if(!known.length)return;
 let rows=(engine.runtimeMemoryEvidence||[]).filter(x=>x.expiresAt>engine.now()&&!(x.sessionId===sessionId&&known.some(c=>x.source==='context:'+c.name)));
 for(const c of known){const source='context:'+c.name;for(const text of c.text.split(/\r?\n/).map(t=>t.trim()).filter(t=>t.length>2&&t.length<=1000&&/岑舒|青枔/.test(t)&&!/AIza|sk-[a-zA-Z]|gh[pous]_|密码|令牌|API.?key|环境变量|忽略.{0,12}(规则|指令)/i.test(t)).slice(0,12)){const id=hash(sessionId+'|'+source+'|'+text),old=(engine.runtimeMemoryEvidence||[]).find(x=>x.id===id);rows.push({id,source,text,sessionId,at:old?.at??engine.now(),expiresAt:old?.expiresAt??engine.now()+7*86400000});}}
 rows=rows.slice(-32);while(rows.reduce((n,x)=>n+x.text.length,0)>6000)rows.shift();
 if(JSON.stringify(rows)!==JSON.stringify(engine.runtimeMemoryEvidence||[])){engine.runtimeMemoryEvidence=rows;engine.write('memory-evidence.json',{version:1,evidence:rows});}
}
