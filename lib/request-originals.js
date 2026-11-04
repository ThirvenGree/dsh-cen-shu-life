import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=(reason,message)=>({available:false,reason,message});
const identity=id=>typeof id==='string'&&id.length>0&&id.length<=512?id.replace(/^session-/,''):null;
const splitSurrogate=(text,offset)=>offset>0&&offset<text.length&&text.charCodeAt(offset)>=0xdc00&&text.charCodeAt(offset)<=0xdfff&&text.charCodeAt(offset-1)>=0xd800&&text.charCodeAt(offset-1)<=0xdbff;

/** Content-addressed exact text originals. No model output is stored as source,
 * and a failed durable write never authorizes replacing request content. Files
 * are session-scoped and retained across reload; lifecycle cleanup only clears
 * the bounded memory cache. The original DSH history also remains unchanged. */
export function createRequestOriginals({directory,maxEntryBytes=16*1024*1024,maxCacheBytes=8*1024*1024}={}){
 if(!Number.isSafeInteger(maxEntryBytes)||maxEntryBytes<1||!Number.isSafeInteger(maxCacheBytes)||maxCacheBytes<1)throw Error('工具原文容量无效');
 const cache=new Map();let cacheBytes=0,disposed=false;
 const fileFor=(sessionId,version)=>path.join(directory,hash(sessionId),version+'.json');
 const remember=(key,row)=>{
  const size=JSON.stringify(row).length*2;
  const old=cache.get(key);if(old){cacheBytes-=old.size;cache.delete(key);}
  if(size>maxCacheBytes)return;
  while(cache.size&&cacheBytes+size>maxCacheBytes){const first=cache.keys().next().value;cacheBytes-=cache.get(first).size;cache.delete(first);}
  cache.set(key,{row,size});cacheBytes+=size;
 };
 const sourceKey=(sessionId,version)=>sessionId+'\n'+version;
 function save(sessionId,{name,callId,texts}){
  sessionId=identity(sessionId);
  if(disposed||!sessionId)return fail('inactive','原文服务或会话不可用。');
  if(!Array.isArray(texts)||texts.some(row=>!Number.isSafeInteger(row?.index)||row.index<0||typeof row.text!=='string'))return fail('invalid_original','原文格式无效。');
  const source={name:String(name||''),callId:String(callId||''),texts:texts.map(row=>({index:row.index,text:row.text}))};
  const version=hash(JSON.stringify(source)),record={sessionId,version,...source},encoded=JSON.stringify(record);
  if(Buffer.byteLength(encoded)>maxEntryBytes)return fail('original_too_large','原文超过快照容量，保留请求全文。');
  // Durable storage is required for a promise of recall that survives HMR.
  if(!directory)return fail('storage_unconfigured','未配置持久原文目录，保留请求全文。');
  const target=fileFor(sessionId,version);let temp;
  try{
   fs.mkdirSync(path.dirname(target),{recursive:true});
   let same=false;
   if(fs.existsSync(target))same=fs.readFileSync(target,'utf8')===encoded;
   if(!same){temp=target+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,encoded,{flag:'wx',mode:0o600});fs.renameSync(temp,target);temp=undefined;}
   remember(sourceKey(sessionId,version),record);
   return {available:true,snapshotId:version,version,parts:source.texts.map(row=>({index:row.index,totalChars:row.text.length}))};
  }catch{return fail('storage_failed','原文保存失败，保留请求全文。');}
  finally{if(temp)try{fs.unlinkSync(temp);}catch{}}
 }
 function read(sessionId,args={}){
  sessionId=identity(sessionId);
  if(disposed||!sessionId)return fail('inactive','原文服务或当前会话不可用。');
  const {snapshotId,version,part,offset=0,limit=4000}=args||{};
  if(!validHash(snapshotId)||!validHash(version)||snapshotId!==version||!Number.isSafeInteger(part)||part<0||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>8000)return fail('invalid_request','请使用结果中的 snapshotId、version、part 和 nextOffset，limit 为 1 至 8000。');
  const key=sourceKey(sessionId,version);let row=cache.get(key)?.row;
  if(!row){
   if(!directory)return fail('unavailable','原文存储未配置。');
   try{
    const target=fileFor(sessionId,version);if(fs.statSync(target).size>maxEntryBytes)return fail('invalid_original','原文文件超过容量。');
    row=JSON.parse(fs.readFileSync(target,'utf8'));
    const {name,callId,texts}=row;
    if(row.sessionId!==sessionId||row.version!==version||hash(JSON.stringify({name,callId,texts}))!==version)return fail('version_mismatch','原文版本或会话不匹配；未返回其他内容。');
    remember(key,row);
   }catch{return fail('unavailable','指定原文不在当前会话中或已不可用；未按相似内容替换。');}
  }
  const text=row.texts.find(item=>item.index===part)?.text;
  if(typeof text!=='string')return fail('missing_part','指定原文部分不存在。');
  if(offset>text.length||splitSurrogate(text,offset))return fail('invalid_offset','偏移超出原文或切开完整字符，请使用 nextOffset。');
  let end=Math.min(text.length,offset+limit);if(splitSurrogate(text,end))end--;
  if(end===offset&&end<text.length)end=Math.min(text.length,end+2);
  return {available:true,snapshotId,version,name:row.name,callId:row.callId,part,offset,text:text.slice(offset,end),totalChars:text.length,nextOffset:end<text.length?end:null,complete:end===text.length&&offset===0,sourceKind:'exact-tool-result-text'};
 }
 function forget(sessionId){sessionId=identity(sessionId);if(!sessionId)return;for(const [key,value] of cache)if(value.row.sessionId===sessionId){cacheBytes-=value.size;cache.delete(key);}}
 return {save,read,forget,dispose(){disposed=true;cache.clear();cacheBytes=0;}};
}
