import {createHash} from 'node:crypto';
import {memoryEntries,revokeDeletedMemory} from './persona-evolution.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function evidenceFrom(backend,source=''){
 if(backend==='engram')return /engram/i.test(source);
 if(backend==='mnemon')return /mnemon/i.test(source);
 if(backend==='qq')return /qq_memory/i.test(source);
 if(backend==='openviking')return /openviking/i.test(source);
 return /(?:^|\/)(?:MEMORY|KEY|USER|DAILY)\.md$/i.test(source)||/memory:(?:snapshot|(?:tool:)?(?:memory|de_memory)(?:$|:))/.test(source);
}
export function rememberRecord(engine,sid,selector,text){
 if(typeof text!=='string'||!text.trim()||selector.backend==='lingshu')return;
 const {backend,target,id}=selector,key=hash(JSON.stringify([sid,backend,target,id||'',text]));
 const rows=engine.read('memory-source-tracking.json',{});if(rows[key])return;
 rows[key]={sid,backend,target,id,...(selector.file?{file:selector.file}:{}),text,checked:0};engine.write('memory-source-tracking.json',rows);
}
export function revokeRecord(engine,selector,text,revoke=revokeDeletedMemory){
 const backend=selector.backend;
 for(const entry of new Set([text,...memoryEntries(text).map(e=>e.text)])){
   const key='verified-source:'+hash(JSON.stringify([backend,selector.target,selector.id||'',selector.revision||'',entry]));
   const ledger=engine.read('memory-corrections.json',{});
   ledger[key]={phase:'done',backend,scoped:true,recordId:selector.id,scope:selector.target,action:selector.action,version:selector.revision,...(selector.file?{file:selector.file}:{}),revokedHash:hash(entry.normalize('NFKC').trim().replace(/\s+/g,' ')),at:ledger[key]?.at??engine.now()};engine.write('memory-corrections.json',ledger);
   const receipts=Object.values(ledger);
   revoke(engine,entry,backend,e=>{
    if(e.records?.length)return e.records.every(r=>receipts.some(c=>c.phase==='done'&&c.backend===r.provider&&c.recordId===r.id&&(!r.scope||r.scope===c.scope)&&(r.versionKind==='native'&&c.version?r.version===c.version:r.contentHash===c.revokedHash||(r.observedAt>0&&r.observedAt<=(c.applyAt||c.at)&&['remove','replace'].includes(c.action)))));
    if(!selector.file&&selector.id&&['openviking','engram'].includes(backend)){
     return e.originalRecords?.length>0&&e.originalRecords.every(r=>r.backend===backend&&r.id===selector.id&&r.target===selector.target);
    }
    return selector.file?(e.source===selector.file||e.originalRecords?.some(r=>r.file===selector.file)):evidenceFrom(backend,e.source);
   });
 }
}
export function externalChecker(engine,inspect){
 let busy=false;
 return async()=>{
  if(busy)return;busy=true;
  try{
   const rows=engine.read('memory-source-tracking.json',{}),todo=Object.entries(rows).filter(([,r])=>engine.bound(r.sid)&&engine.now()-r.checked>=60000).sort((a,b)=>a[1].checked-b[1].checked).slice(0,8);
   for(const [key,row] of todo){
    let absent=false;
    try{absent=(await inspect(row)).absent===true;}catch{/* An unavailable store does not prove a deletion. */}
    const live=engine.read('memory-source-tracking.json',{});if(!live[key])continue;
    if(absent){revokeRecord(engine,row,row.text);delete live[key];}else live[key].checked=engine.now();
    engine.write('memory-source-tracking.json',live);
   }
  }finally{busy=false;}
 };
}
