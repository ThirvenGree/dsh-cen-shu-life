import {createHash,randomUUID} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const text=value=>typeof value==='string'?value:'';
const clip=(value,max)=>{
 const s=text(value);let end=Math.min(max,s.length);
 if(end<s.length&&end>0&&s.charCodeAt(end-1)>=0xd800&&s.charCodeAt(end-1)<=0xdbff)end--;
 return s.slice(0,end);
};
const validSession=id=>typeof id==='string'&&id.length>0&&id.length<=512;
const outputLimit=16000;
const fail=(status,reason,message,more={})=>({status,available:false,reason,message,...more});
const meta=row=>({snapshotId:row.snapshotId,version:row.version,createdAt:row.createdAt,count:row.count,omitted:row.omitted,available:row.available});
const entryMeta=row=>({itemId:row.itemId,rowId:row.rowId,owner:row.owner,source:row.source,key:row.key,version:row.version,
 required:row.required,selected:row.selected,totalChars:row.text.length,excerpt:clip(row.text,100)});

/** Exact, session-local recall of already assembled material. No new retrieval,
 * model call, persistent file, or interpretation of a media description. */
export function createContextRecall({now=Date.now,maxBytes=8*1024*1024,maxSnapshots=64}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxSnapshots)||maxSnapshots<1)throw Error('上下文快照容量无效');
 const snapshots=new Map(),latest=new Map();let bytes=0,disposed=false;
 const latestLimit=Math.max(16,maxSnapshots*2);
 const updateLatest=(id,value)=>{
  latest.delete(id);latest.set(id,value);
  while(latest.size>latestLimit)latest.delete(latest.keys().next().value);
 };
 const drop=id=>{
  const row=snapshots.get(id);if(!row)return;
  snapshots.delete(id);bytes-=row.bytes;
  if(latest.get(row.sessionId)?.snapshotId===id)updateLatest(row.sessionId,{...meta(row),available:false,reason:'evicted'});
 };
 const touch=row=>{snapshots.delete(row.snapshotId);snapshots.set(row.snapshotId,row);};
 const current=id=>{const row=latest.get(id);return row?meta(row):null;};
 function publish(sessionId,rows,{selectedIds=[],topic}={}){
  if(disposed)return fail('unavailable','disposed','上下文服务已停止。');
  if(!validSession(sessionId)||!Array.isArray(rows))return fail('invalid_request','invalid_snapshot','会话或资料格式无效。');
  if(!(selectedIds instanceof Set)&&!Array.isArray(selectedIds))return fail('invalid_request','invalid_selection','已选资料编号格式无效。');
  const selected=selectedIds instanceof Set?selectedIds:new Set(selectedIds),items=[],ids=new Set();let size=512;
  const unavailable=(reason,message)=>{
   const value=fail('unavailable',reason,message,{count:rows.length,omitted:rows.filter(r=>!selected.has(r?.id)&&!r?.selected).length,createdAt:now(),entries:[]});
   updateLatest(sessionId,value);return value;
  };
  if(size>maxBytes)return unavailable('snapshot_too_large','内存快照容量不足，未建立可取回快照。');
  for(const row of rows){
   if(!row||!Number.isSafeInteger(row.id)||row.id<0||ids.has(row.id)||typeof row.text!=='string')return unavailable('invalid_rows','本轮资料编号或正文无效，未建立可取回快照。');
   ids.add(row.id);
   const owner=clip(row.owner,80),source=clip(row.source||row.g?.name,160),key=clip(row.key,512);
   size+=row.text.length*2+(owner.length+source.length+key.length)*2+512;
   if(size>maxBytes)return unavailable('snapshot_too_large','本轮资料超过内存快照容量，不能保证按编号取回；请使用来源原有查询入口。');
   const version=hash(JSON.stringify([owner,source,key,row.text]));
   items.push(Object.freeze({itemId:'item-'+row.id+'-'+version.slice(0,16),rowId:row.id,owner,source,key,version,
    required:!!row.required,selected:selected.has(row.id)||!!row.selected,text:row.text}));
  }
  // Keep hashes independent of timestamps; identical subsequent assemblies can
  // reuse the immutable source snapshot instead of consuming another slot.
  const version=hash(JSON.stringify(items.map(r=>[r.rowId,r.version])));
  const prior=latest.get(sessionId),same=prior?.available&&prior.version===version&&snapshots.get(prior.snapshotId);
  if(same){
   const updated=Object.freeze({...same,items:Object.freeze(items),omitted:items.filter(r=>!r.selected).length});
   touch(updated);updateLatest(sessionId,meta(updated));
   return {...meta(updated),status:'ready',entries:updated.items.map(entryMeta)};
  }
  while(snapshots.size>=maxSnapshots||bytes+size>maxBytes)drop(snapshots.keys().next().value);
  const record=Object.freeze({sessionId,snapshotId:'context-'+randomUUID(),version,createdAt:now(),count:items.length,
   omitted:items.filter(r=>!r.selected).length,available:true,bytes:size,items:Object.freeze(items)});
  snapshots.set(record.snapshotId,record);bytes+=size;updateLatest(sessionId,meta(record));
  return {...meta(record),status:'ready',entries:record.items.map(entryMeta)};
 }
 function finalizeSelection(sessionId,snapshotId,selectedIds){
  if(disposed)return fail('unavailable','disposed','上下文服务已停止。');
  const row=snapshots.get(snapshotId);
  if(!validSession(sessionId)||row&&row.sessionId!==sessionId)return fail('forbidden','wrong_session','不能修改其他会话的注入标记。');
  if(!row||latest.get(sessionId)?.snapshotId!==snapshotId)return fail('unavailable','snapshot_expired','只标记当前快照，未修改旧快照。');
  if(!(selectedIds instanceof Set)&&!Array.isArray(selectedIds))return fail('invalid_request','invalid_selection','已选资料编号格式无效。');
  const selected=new Set(selectedIds);
  if([...selected].some(id=>!row.items.some(item=>item.rowId===id)))return fail('invalid_request','invalid_selection','已选资料必须来自本次快照。');
  // Admission metadata can change after the compact manifest is budgeted; this
  // does not mean the model has read a source and never changes body versions.
  const items=Object.freeze(row.items.map(item=>Object.freeze({...item,selected:selected.has(item.rowId)})));
  const updated=Object.freeze({...row,items,omitted:items.filter(item=>!item.selected).length});
  touch(updated);updateLatest(sessionId,meta(updated));
  return {...meta(updated),status:'ready',entries:items.map(entryMeta)};
 }
 function read(sessionId,args={}){
  if(disposed)return fail('unavailable','disposed','上下文服务已停止，需等待新的组装快照。');
  if(!validSession(sessionId))return fail('forbidden','no_session','只允许读取当前调用会话的上下文快照。');
  if(!args||typeof args!=='object'||Array.isArray(args))return fail('invalid_request','invalid_arguments','参数格式无效。');
  const {action='catalog',snapshotId,version,itemId,offset=0,limit,query}=args;
  if(!['catalog','read'].includes(action)||!Number.isSafeInteger(offset)||offset<0||
   limit!==undefined&&(!Number.isSafeInteger(limit)||limit<1||limit>(action==='read'?4000:12))||
   query!==undefined&&(typeof query!=='string'||query.length>600)||
   snapshotId!==undefined&&(typeof snapshotId!=='string'||snapshotId.length>100)||
   version!==undefined&&(typeof version!=='string'||!/^[a-f0-9]{64}$/.test(version)))return fail('invalid_request','invalid_arguments','动作、页码、长度或版本参数无效。');
  const active=latest.get(sessionId),id=snapshotId||active?.snapshotId,row=id&&snapshots.get(id);
  if(row&&row.sessionId!==sessionId)return fail('forbidden','wrong_session','不能读取其他会话的上下文快照。');
  if(!row)return fail('unavailable',snapshotId?'snapshot_expired':active?.reason||'no_snapshot',
   snapshotId?'指定快照已过期、被淘汰或不存在；未替换成其他版本。':'本轮没有可读取的完整快照；这不代表原始资料不存在。',{currentSnapshot:current(sessionId)});
  if(version!==undefined&&version!==row.version)return fail('version_mismatch','version_mismatch','快照版本不匹配；未返回其他版本的正文。',{snapshot:meta(row),currentSnapshot:current(sessionId)});
  touch(row);
  const currentSnapshot=current(sessionId),result={status:'ready',available:true,...meta(row),current:active?.snapshotId===row.snapshotId,
   currentSnapshot,sourceKind:'assembly-snapshot',media:'text-only; a media description is not proof of image or audio reading'};
  if(action==='catalog'){
   const terms=(query||'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
   const matches=terms.length?row.items.filter(r=>terms.every(term=>(r.owner+'\n'+r.source+'\n'+r.key+'\n'+r.text).toLocaleLowerCase().includes(term))):row.items;
   if(offset>matches.length)return fail('invalid_request','offset_out_of_range','目录页码超出结果范围。',{snapshot:meta(row)});
   const entries=matches.slice(offset,offset+(limit??6)).map(entryMeta);
   const value={...result,action,total:matches.length,offset,entries,nextOffset:null,truncated:false};
   while(entries.length>1&&JSON.stringify(value).length>outputLimit-150)entries.pop();
   value.nextOffset=offset+entries.length<matches.length?offset+entries.length:null;value.truncated=value.nextOffset!==null;
   return value;
  }
  if(typeof itemId!=='string'||itemId.length>100)return fail('invalid_request','missing_item','请提供目录返回的 itemId。',{snapshot:meta(row)});
  const item=row.items.find(r=>r.itemId===itemId);
  if(!item)return fail('missing','item_missing','该资料不在指定快照中；未按相似内容替换。',{snapshot:meta(row),currentSnapshot});
  if(offset>item.text.length||offset>0&&offset<item.text.length&&item.text.charCodeAt(offset)>=0xdc00&&item.text.charCodeAt(offset)<=0xdfff&&item.text.charCodeAt(offset-1)>=0xd800&&item.text.charCodeAt(offset-1)<=0xdbff)
   return fail('invalid_request','offset_out_of_range','正文页码超出范围或切开了完整字符，请使用 nextOffset。',{snapshot:meta(row)});
  let count=Math.min(limit??1600,item.text.length-offset),body=clip(item.text.slice(offset),count);
  if(count>0&&!body&&offset<item.text.length)body=item.text.slice(offset,offset+2);
  const value={...result,action,item:{...entryMeta(item),excerpt:undefined},offset,text:body,totalChars:item.text.length,truncated:false,nextOffset:null};
  while(body.length>2&&JSON.stringify(value).length>outputLimit-150){count=Math.floor(body.length/2);body=clip(body,count);value.text=body;}
  const end=offset+body.length;value.truncated=end<item.text.length;value.nextOffset=value.truncated?end:null;
  return value;
 }
 function forget(sessionId){for(const [id,row] of snapshots)if(row.sessionId===sessionId)drop(id);latest.delete(sessionId);}
 function dispose(){disposed=true;snapshots.clear();latest.clear();bytes=0;}
 function tool(){return {
  name:'censhu_context_recall',
  description:'只读展开本轮预算省略的原文。先 catalog 看快照目录，再 read 指定 itemId；按返回的 snapshotId、version、nextOffset 继续，旧快照不替成新内容。可在目录 query 关键词。没有模型调用，不等同于长期记忆搜索；媒体说明不代表已经看图或听音频。',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['catalog','read']},snapshotId:{type:'string'},version:{type:'string'},itemId:{type:'string'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:4000,description:'catalog 每页1至12项；read 每页1至4000字符。'},query:{type:'string',maxLength:600}}},
  output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
  execute(args,exec){return JSON.stringify(read(exec?.agent?.session?.id||exec?.agent?.id,args));}
 };}
 return {publish,finalizeSelection,read,tool,forget,dispose};
}
