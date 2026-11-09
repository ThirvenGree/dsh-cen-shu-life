import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const digest=x=>createHash('sha256').update(x).digest('hex');
// State-directory scoped: a probe workspace never drains into the real platform's queue.
export function socialReceipt(root,entry){
 if(!root||process.env.DSH_SOCIAL_EXPERIENCE_DISABLED==='1')return false;
 if(!entry.recordId||!entry.scope||!entry.text||!['bili','douyin'].includes(entry.platform)||!['comment','dm'].includes(entry.channel)||!['read','confirmed'].includes(entry.status))return false;
 const id=digest(JSON.stringify([entry.platform,entry.channel,entry.scope,String(entry.recordId)]));
 const dir=path.join(root,'social-outbox');fs.mkdirSync(dir,{recursive:true});
 if(fs.existsSync(path.join(dir,id+'.done'))||fs.existsSync(path.join(dir,id+'.json')))return false;
 const tmp=path.join(dir,id+'.'+randomUUID()+'.tmp');
 try{fs.writeFileSync(tmp,JSON.stringify({...entry,id,at:Date.now(),text:String(entry.text).slice(0,8000)}),{mode:0o600,flag:'wx'});fs.renameSync(tmp,path.join(dir,id+'.json'));return true;}finally{fs.rmSync(tmp,{force:true});}
}
export function safeSocialReceipt(root,entry){try{return socialReceipt(root,entry);}catch(error){console.warn('[social-experience] 实际互动已发生，但经历收据保存失败：'+error.message);return false;}}
export function drainSocial(root,life){
 const dir=path.join(root,'social-outbox');if(!life?.observePlatformInteraction||!fs.existsSync(dir))return 0;
 let count=0;
 for(const name of fs.readdirSync(dir).filter(x=>/^[a-f0-9]{64}\.json$/.test(x)).slice(0,100)){
  const file=path.join(dir,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('互动收据文件类型或大小无效');const entry=JSON.parse(fs.readFileSync(file,'utf8'));
  if(entry.id!==name.slice(0,-5)||!['bili','douyin'].includes(entry.platform))throw Error('互动收据来源编号不匹配');
  if(life.observePlatformInteraction(entry)){fs.writeFileSync(path.join(dir,entry.id+'.done'),String(Date.now()));fs.unlinkSync(file);count++;}
 }
 // Receipt tombstones last as long as the retained source evidence; no message bodies retained twice.
 for(const name of fs.readdirSync(dir).filter(x=>/^[a-f0-9]{64}\.done$/.test(x))){const file=path.join(dir,name);if(Date.now()-fs.statSync(file).mtimeMs>30*86400000)fs.unlinkSync(file);}
 return count;
}
