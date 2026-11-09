import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
// 2026-11-07：测试工作区（记忆隔离）不写主动行动观察；由各插件注册同一个全局检查函数。
const externalWritesBlocked=()=>{try{return process.env.DSH_EXTERNAL_WRITES_BLOCKED==='1'||globalThis[Symbol.for('dsh.externalWritesBlocked')]?.()===true;}catch{return false;}};
const base=()=>path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'censhu-agency');
export function owner(session){
 try{const r=JSON.parse(fs.readFileSync(path.join(base(),'control.json'),'utf8'));const lease=JSON.parse(fs.readFileSync(path.join(base(),'owner.json'),'utf8'));return r.version===2&&r.disabled!==true&&lease.until>Date.now()&&lease.sessionId===r.sessionId&&!!r.sessionId&&(!session||session===r.sessionId);}
 catch(e){if(e.code==='ENOENT')return false;throw e;}
}
export function signal(source,key,detail){
 if(externalWritesBlocked()||!owner())return false;
 const id=createHash('sha256').update(JSON.stringify([source,key])).digest('hex');
 const dir=path.join(base(),'observations');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,id+'.json'),tmp=path.join(dir,randomUUID()+'.tmp');
 if(fs.existsSync(file))return id;
 const sessionId=JSON.parse(fs.readFileSync(path.join(base(),'control.json'),'utf8')).sessionId;
 fs.writeFileSync(tmp,JSON.stringify({id,sessionId,source,at:Date.now(),detail:String(detail).slice(0,1400)}),{mode:0o600});
 try{fs.linkSync(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;}finally{fs.unlinkSync(tmp);}
 return id;
}
export function observations(home,sessionId,seen=[],now=Date.now()){
 const dir=path.join(home,'censhu-agency/observations');if(!fs.existsSync(dir))return [];
 const rows=[];
 for(const file of fs.readdirSync(dir).filter(x=>/^[a-f0-9]{64}\.json$/.test(x))){
   const full=path.join(dir,file),r=JSON.parse(fs.readFileSync(full,'utf8'));
   if(now-r.at>86400000){for(const ext of ['.reply','.reply.claimed','.json'])fs.rmSync(path.join(dir,r.id+ext),{force:true});continue;}
   if(r.sessionId===sessionId&&!seen.includes(r.id))rows.push(r); // 2026-11-08：B站通知也带上类型和预览（由 B站插件整理），不再换成一句空话。
 }
 return rows.sort((a,b)=>a.at-b.at).slice(0,20);
}
export function current(home,id){
 try{const r=JSON.parse(fs.readFileSync(path.join(home,'censhu-agency/current.json'),'utf8'));return r.sessionId===id&&r.until>Date.now()?r:null;}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function replyOrder(id,text,sessionId){
 if(!owner(sessionId)||!/^([a-f0-9]{64})$/.test(id)||typeof text!=='string'||!text.trim()||text.length>1200)throw Error('待答编号或回复正文无效');
 const folder=path.join(base(),'observations'),r=JSON.parse(fs.readFileSync(path.join(folder,id+'.json'),'utf8'));
 if(r.sessionId!==sessionId||!['抖音来信','抖音问候'].includes(r.source)||Date.now()-r.at>86400000)throw Error('待答已失效');
 const target=path.join(folder,id+'.reply');
 if(fs.existsSync(target+'.claimed'))throw Error('发送已取走，不重复提交');
 const tmp=target+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify({text,sessionId,at:Date.now()}),{mode:0o600});
 try{fs.linkSync(tmp,target);}finally{fs.unlinkSync(tmp);}
 return {status:'queued',id};
}
export function takeReply(id){
 if(!/^[a-f0-9]{64}$/.test(id))return null;
 const target=path.join(base(),'observations',id+'.reply');
 try{fs.linkSync(target,target+'.claimed');}catch(e){if(['ENOENT','EEXIST'].includes(e.code))return null;throw e;}
 const r=JSON.parse(fs.readFileSync(target,'utf8'));fs.unlinkSync(target);
 return Date.now()-r.at<86400000&&owner(r.sessionId)?r:null;
}

export function inspectAdapters(home,profile=path.join(home,'profiles/desktop')){
 const cfg=JSON.parse(fs.readFileSync(path.join(home,'censhu-agency/control.json'),'utf8'));
 return Object.entries(cfg.hashes||{}).map(([name,hash])=>{
   const file=path.resolve(profile,'node_modules',name);
   const rel=path.relative(path.join(profile,'node_modules'),file);
   if(rel.startsWith('..')||path.isAbsolute(rel))return {name,ok:false};
   try{
     const bytes=fs.readFileSync(file);
     if(createHash('sha256').update(bytes).digest('hex')===hash)return {name,ok:true};
     // Settings decorators may rewrite unrelated parts of either shared client on startup.
     const clients={'dsh-bili-whale/lib/client.js':'v.nextThought || v.reflection || choices[v.intent]', 'dsh-douyin-browser-local/client.js':"note(v.nextThought||v.reflection||({yes:"};
     const marker=clients[name.split(path.sep).join('/')];
     return {name,ok:Boolean(marker&&bytes.toString('utf8').includes(marker)),fileChanged:true};
   }
   catch{return {name,ok:false};}
 });
}
