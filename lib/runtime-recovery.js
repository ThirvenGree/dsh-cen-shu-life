import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {recoverySnapshot} from './recovery-snapshot.js';

// Only runtime bookkeeping lives here. Never rewrite another plugin's records.
export class RuntimeRecovery {
 constructor(home,{now=()=>Date.now(),bootId=randomUUID(),capture=()=>recoverySnapshot(home,now())}={}){
  this.now=now;this.capture=capture;this.file=path.join(home,'runtime-recovery/state.json');
  let old;try{old=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const at=now(),pausedAt=old?.manualPause?.at||old?.stoppedAt||old?.heartbeatAt||null;
  this.state={version:1,bootId,startedAt:at,heartbeatAt:at,pending:!!old,
   interruption:old?{pausedAt,restartedAt:at,gapMs:Math.max(0,at-pausedAt),estimated:!old.manualPause&&!old.stoppedAt,reason:old.manualPause?'用户暂停后台运行':old.stoppedAt?'软件已关闭':'进程退出或热重载；按最后心跳估计'}:null,
   manualPause:old?.manualPause||null,
   exitSnapshot:old?.manualPause?(old.exitSnapshot||old.snapshot):old?.snapshot||old?.exitSnapshot||null,
   faults:old?.faults||[],lastRecovery:old?.lastRecovery||null,history:old?.history||[],restartRequested:old?.restartRequested||null};
  this.captureState();
  this.save();
 }
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.state,null,2));fs.renameSync(tmp,this.file);}
 captureState(){try{this.state.snapshot=this.capture();delete this.state.snapshotError;}catch(e){this.state.snapshotError=String(e.code||'snapshot-failed');}}
 pause(){
  if(this.busy)throw Error('恢复正在执行，请等待本次结果后暂停');
  if(this.state.manualPause)return this.view();
  if(this.state.pending&&this.state.interruption){
   this.state.manualPause={at:this.state.interruption.pausedAt,requestedAt:this.now()};
   this.state.restartRequested=null;this.save();return this.view();
  }
  const at=this.now();this.captureState();this.state.exitSnapshot=this.state.snapshot;
  this.state.manualPause={at};this.state.pending=true;this.state.restartRequested=null;
  this.state.interruption={pausedAt:at,restartedAt:null,gapMs:0,estimated:false,reason:'用户暂停后台运行'};
  this.save();return this.view();
 }
 heartbeat(){const at=this.now();if(at-this.state.heartbeatAt<15000)return;
  if(!this.state.manualPause&&at-this.state.heartbeatAt>120000){this.state.exitSnapshot=this.state.snapshot;this.state.interruption={pausedAt:this.state.heartbeatAt,restartedAt:at,gapMs:at-this.state.heartbeatAt,estimated:true,reason:'电脑休眠或后台长时间未运行'};this.state.pending=true;}
  this.captureState();this.state.heartbeatAt=at;this.save();
 }
 stop(){this.captureState();this.state.stoppedAt=this.now();this.save();}
 view(){return structuredClone({...this.state,busy:!!this.busy,at:this.now()});}
 async recover(jobs){
  if(this.busy)throw Error('恢复正在执行，请等待本次结果');this.busy=true;
  const at=this.now(),id=this.state.restartRequested?.id||randomUUID();
  this.captureState();
  const context={id,now:at,...this.state.interruption,recoveredAt:at,elapsedUntilRecoveryMs:this.state.interruption?.pausedAt?Math.max(0,at-this.state.interruption.pausedAt):0,exitSnapshot:this.state.exitSnapshot,currentSnapshot:this.state.snapshot,unresolvedFaults:this.state.faults,offlineIsNotExperience:true};
  this.state.pending=true;this.state.lastRecovery={id,at,status:'preparing',results:[]};this.save();
  try{
   for(const [name,fn] of jobs){
    try{if(typeof fn!=='function')throw Error('插件未载入或不支持恢复接口，请重启软件或修复适配');
     const result=await fn(context);this.state.lastRecovery.results.push({name,...result});
    }catch(e){this.state.lastRecovery.results.push({name,status:'blocked',error:String(e.message).replace(/AIza[\w-]+|sk-[\w-]+/g,'[隐藏]').slice(0,240)});}
    this.save();
   }
   const blocked=this.state.lastRecovery.results.some(x=>x.status==='blocked');
   this.state.lastRecovery.status=blocked?'blocked':'scheduled';this.state.pending=blocked;
   if(!blocked){this.state.restartRequested=null;this.state.manualPause=null;}
   this.state.history=[...this.state.history,this.state.lastRecovery].slice(-20);this.save();
   return {...this.view(),busy:false};
  }finally{this.busy=false;}
 }
}
const instances=new Map();
export function runtimeRecovery(home){const key=path.resolve(home);if(!instances.has(key)){const r=new RuntimeRecovery(key);instances.set(key,r);process.once('exit',()=>{try{r.stop();}catch{}});}return instances.get(key);}

export function resetFailure(record){if(!record)return;record.retryAt=0;record.configurationError=false;/* preserve error until a real successful request */}
