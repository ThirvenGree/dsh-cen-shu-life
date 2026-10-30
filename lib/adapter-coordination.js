import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {verifyAdapterSource,sourceHash} from './adapter-health.js';
const real=file=>{try{const value=fs.realpathSync(file);return process.platform==='win32'?value.toLowerCase():value;}catch{return path.resolve(file);}};
export function verifyMoodIsolation(source){return [
 '// censhu-private-session-v1',
 "function mountFor(agent, sid, slot) {\n    if (isPrivateSession(agent)) return () => {};",
 'if (isInternalMessage(p)) return null',
 "if (isInternalMessage(msg)) { lastText = ''; lastSrc = msg.source.kind; return }",
 'if (!stillBound() || isInternalMessage({source:{kind:lastSrc}})) return',
 'import {isPrivateSession,isInternalMessage} from '
].every(x=>source.replace(/\r\n/g,'\n').includes(x));}
// Only explicit installers attest a new whole-file revision, after checking the
// other adapter's protocol. Health checks never re-sign changed source.
export function synchronizeMoodAdapters(home,file,source,{now=Date.now(),validateOnly=false}={}){
 const updated=[],skipped=[],writes=[];
 const readPeer=(target,kind)=>{try{return JSON.parse(fs.readFileSync(target,'utf8'));}catch(error){skipped.push({kind,reason:'登记无法读取：'+error.message});return null;}};
 const iso=path.join(home,'censhu-inner-life/isolation-adapters.json');
 if(fs.existsSync(iso)){
  const meta=readPeer(iso,'isolation'),row=Array.isArray(meta?.files)?meta.files.find(x=>x&&typeof x.file==='string'&&real(x.file)===real(file)):null;
  if(row){
   if(meta.version!==1||meta.protocol!=='censhu-private-session-v1'||!verifyMoodIsolation(source))skipped.push({kind:'isolation',reason:'隔离协议或守卫缺失，请运行隔离安装脚本'});
   else{row.hash=createHash('sha256').update(source).digest('hex');meta.at=now;writes.push([iso,meta]);updated.push('isolation');}
  }
 }
 const life=path.join(home,'cen-shu-life/mood-link-install.json');
 if(fs.existsSync(life)){
  const meta=readPeer(life,'life');let peer;
  try{peer=meta?.moduleUrl?fileURLToPath(meta.moduleUrl):null;}catch{skipped.push({kind:'life',reason:'生活适配模块地址无效，请运行心情联动安装脚本'});}
  if(peer&&real(peer)===real(file)){
   if(meta.protocol!==3||!verifyAdapterSource(source))skipped.push({kind:'life',reason:'生活心情适配缺失，请运行心情联动安装脚本'});
   else{meta.sourceSha256=sourceHash(source);meta.installedAt=now;writes.push([life,meta]);updated.push('life');}
  }
 }
 if(!validateOnly)for(const [target,value] of writes){const tmp=target+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,target);}
 return {updated,skipped};
}
