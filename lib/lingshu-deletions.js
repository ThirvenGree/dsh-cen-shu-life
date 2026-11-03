import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {memoryEntries,revokeDeletedMemory} from './persona-evolution.js';
const sig=text=>createHash('sha1').update(text.trim()).digest('hex').slice(0,16);
export function graphRoot(engine){
 const state=process.env.MDCG_STATE_ROOT||path.join(engine.home,'.dsh-memory');
 const file=path.join(state,'paths.json');
 const settings=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 return process.env.MDCG_ROOT||settings.root||path.join(process.env.MDCG_DATA_ROOT||settings.data_root||path.join(state,'data'),'mdcg');
}
function ledgerRow(line){
 try{const r=JSON.parse(line);return typeof r.id==='string'&&/^[\p{L}\p{N}_.-]+$/u.test(r.id)&&/^[a-f0-9]{16}$/.test(r.hash)&&Number.isFinite(r.t)&&r.trash==='trash/'+r.id+'.md'?r:null;}catch{return null;}
}
export function deletedNode(engine,id,text,since=0){
 const file=path.join(graphRoot(engine),'_deletions.jsonl');
 if(!fs.existsSync(file))return false;
 return fs.readFileSync(file,'utf8').split('\n').some(line=>{const r=ledgerRow(line);return r?.id===id&&r.hash===sig(text)&&r.t*1000+1>=since;});
}
export function syncLingshuDeletes(engine){
 const root=graphRoot(engine),file=path.join(root,'_deletions.jsonl');
 if(!fs.existsSync(file))return;
 const stat=fs.statSync(file),saved=engine.read('lingshu-delete-cursor.json',{}),identity=['v2',root,stat.dev,stat.ino,stat.birthtimeMs].join(':');
 const offset=saved.identity===identity&&saved.offset<=stat.size?saved.offset:0;
 if(offset===stat.size)return;
 const buf=Buffer.alloc(Math.min(stat.size-offset,1024*1024)),fd=fs.openSync(file,'r');
 let bytes;try{bytes=fs.readSync(fd,buf,0,buf.length,offset);}finally{fs.closeSync(fd);}
 const end=buf.subarray(0,bytes).lastIndexOf(10)+1;if(!end)return;
 for(const line of buf.subarray(0,end).toString('utf8').split('\n')){
   const row=ledgerRow(line);if(!row)continue;
   const tagged=':lingshu-node:',node=e=>String(e.source||'').split(tagged)[1];
   const scope=e=>/lingshu|mdcg|灵枢/i.test(e.source||'')&&(!node(e)||node(e)===row.id)&&(!e.at||e.at<=row.t*1000+1);
   const file=path.join(root,row.trash);let body='';
   try{body=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/,'').trim();}catch(e){if(e.code!=='ENOENT')throw e;}
   const refs=[...(engine.runtimeMemoryEvidence||[]),...(engine.profile.evolvingFacts||[]).flatMap(f=>f.evidence||[]),...(engine.read('persona-learning.json',{}).pending?.evidence||[]),...(engine.read('model-content.json',{}).draft?.evidence||[])].filter(scope);
   const texts=new Set(refs.filter(e=>typeof e.text==='string'&&sig(e.text)===row.hash).map(e=>e.text));
   if(body&&sig(body)===row.hash){
     texts.add(body);for(const e of memoryEntries(body))texts.add(e.text);
     // Native recall decorates an entry with its layer/role. Compare exact bodies only.
     const normalized=t=>t.trim().replace(/^(?:[-*]\s+)?(?:\[(?:knowledge|contextual|structural|anchor|self|unresolved|user|assistant)\]\s*)+/,'').trim();
     const originals=new Set([...texts].map(normalized));
     for(const ref of refs)if(originals.has(normalized(ref.text)))texts.add(ref.text);
   }
   const corrections=engine.read('memory-corrections.json',{});let added=false;
   for(const ref of refs)if(node(ref)===row.id&&typeof ref.text==='string')texts.add(ref.text);
   for(const text of texts){
     revokeDeletedMemory(engine,text,'lingshu',scope);
     const hash=createHash('sha256').update(text.normalize('NFKC').trim().replace(/\s+/g,' ')).digest('hex');
     const key=['ls-delete',row.id,row.t,hash].join(':');
     if(!corrections[key]){corrections[key]={phase:'done',backend:'lingshu',nodeId:row.id,revokedHash:hash,at:row.t*1000};added=true;}
   }
   if(added)engine.write('memory-corrections.json',corrections);
 }
 engine.write('lingshu-delete-cursor.json',{identity,offset:offset+end});
}
