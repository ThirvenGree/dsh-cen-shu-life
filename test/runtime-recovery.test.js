import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {RuntimeRecovery} from '../lib/runtime-recovery.js';
import {recoverySnapshot} from '../lib/recovery-snapshot.js';
test('shutdown snapshot includes mood and its original validity without extending it',()=>fixture(async home=>{
 fs.mkdirSync(path.join(home,'feiyu-mood'),{recursive:true});fs.writeFileSync(path.join(home,'feiyu-mood/state.json'),JSON.stringify({moods:{censhu:{mixedMood:{label:'放松',expiresAt:123},updatedAt:100,secret:'do-not-copy'}}}));
 const s=recoverySnapshot(home,1000);assert.equal(s.moods[0].mixedMood.expiresAt,123);assert.equal(s.moods[0].key,'censhu');assert.equal(s.moods[0].secret,undefined);
}));
const fixture=async fn=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-recovery-'));try{await fn(home);}finally{fs.rmSync(home,{recursive:true,force:true});}};

test('manual pause persists across heartbeat and restart, recovery uses actual pause duration',()=>fixture(async home=>{
 let now=1000000,activity='整理旧书';const a=new RuntimeRecovery(home,{now:()=>now,capture:()=>({activity})});
 a.pause();const paused=now;activity='用户正在聊天';now+=3600000;a.heartbeat();a.pause();
 assert.equal(a.state.manualPause.at,paused);assert.equal(a.state.exitSnapshot.activity,'整理旧书');a.stop();now+=3600000;
 const b=new RuntimeRecovery(home,{now:()=>now,capture:()=>({activity})});assert.equal(b.state.pending,true);assert.equal(b.state.interruption.pausedAt,paused);
 await b.recover([['busy',()=>({status:'blocked'})]]);assert.ok(b.state.manualPause);assert.equal(b.state.pending,true);
 const result=await b.recover([['life',c=>{assert.equal(c.elapsedUntilRecoveryMs,7200000);assert.equal(c.exitSnapshot.activity,'整理旧书');return {status:'scheduled'};}]]);
 assert.equal(result.manualPause,null);assert.equal(result.pending,false);
}));

test('pause cancels an outstanding automatic restart recovery request',()=>fixture(async home=>{
 const r=new RuntimeRecovery(home);r.state.restartRequested={id:'old'};r.pause();assert.equal(r.state.restartRequested,null);
 let done;const pending=r.recover([['life',()=>new Promise(resolve=>done=resolve)]]);
 assert.throws(()=>r.pause(),/恢复正在执行/);done({status:'scheduled'});await pending;
}));

test('pausing an already interrupted runtime preserves the original interruption and exit evidence',()=>fixture(async home=>{
 let now=1000000;const a=new RuntimeRecovery(home,{now:()=>now,capture:()=>({activity:'原活动'})});a.stop();now+=86400000;
 const b=new RuntimeRecovery(home,{now:()=>now,capture:()=>({activity:'新状态'})});b.pause();
 assert.equal(b.state.manualPause.at,1000000);assert.equal(b.state.exitSnapshot.activity,'原活动');
 await b.recover([['life',c=>{assert.equal(c.elapsedUntilRecoveryMs,86400000);return {status:'scheduled'};}]]);
}));
test('exit snapshot and real elapsed time reach recovery without replacing fresh state',()=>fixture(async home=>{
 let now=1000000;const a=new RuntimeRecovery(home,{now:()=>now,capture:()=>({at:now,activity:'看旧书'})});a.stop();now+=3*86400000;
 const b=new RuntimeRecovery(home,{now:()=>now,capture:()=>({at:now,activity:'今天已经下雨'})});now+=30000;
 await b.recover([['model',c=>{assert.equal(c.exitSnapshot.activity,'看旧书');assert.equal(c.currentSnapshot.activity,'今天已经下雨');assert.equal(c.elapsedUntilRecoveryMs,3*86400000+30000);return {status:'scheduled'};}]]);
}));
test('restart preserves actual stopped and startup times and blocks automatic continuation',()=>fixture(async home=>{
 let now=1000000;const a=new RuntimeRecovery(home,{now:()=>now});now+=10000;a.stop();const stop=now;now+=3*86400000;
 const b=new RuntimeRecovery(home,{now:()=>now});assert.equal(b.state.pending,true);assert.equal(b.state.interruption.pausedAt,stop);assert.equal(b.state.interruption.gapMs,3*86400000);assert.equal(b.state.interruption.estimated,false);
 let calls=0;const v=await b.recover([['life',async context=>{calls++;assert.equal(context.recoveredAt,now);assert.equal(context.offlineIsNotExperience,true);return {status:'scheduled'};}]]);
 assert.equal(calls,1);assert.equal(v.pending,false);assert.equal(v.lastRecovery.status,'scheduled');assert.equal(v.interruption.pausedAt,stop);
}));
test('crash uses a marked estimate; sleep creates a new pending interruption',()=>fixture(async home=>{
 let now=1000000;const a=new RuntimeRecovery(home,{now:()=>now});now+=20000;a.heartbeat();now+=3600000;
 const b=new RuntimeRecovery(home,{now:()=>now});assert.equal(b.state.interruption.estimated,true);assert.equal(b.state.interruption.gapMs,3600000);
 await b.recover([]);now+=3600000;b.heartbeat();assert.equal(b.state.pending,true);assert.match(b.state.interruption.reason,/休眠/);
}));
test('failed or unavailable plugin stays pending; parallel clicks cannot duplicate recovery',()=>fixture(async home=>{
 const r=new RuntimeRecovery(home);let release;const wait=new Promise(resolve=>release=resolve);
 const a=r.recover([['life',async()=>{await wait;return {status:'scheduled'};}],['inner',null]]);
 await assert.rejects(r.recover([]),/正在执行/);release();await a;
 assert.equal(r.state.pending,true);assert.equal(r.state.lastRecovery.results[1].status,'blocked');
 assert.equal((await r.recover([['inner',()=>({status:'disabled'})]])).pending,false);
}));
test('restart consent survives process restart and recovery does not change historical action records',()=>fixture(async home=>{
 const a=new RuntimeRecovery(home);a.state.restartRequested={id:'r1',bootId:a.state.bootId};a.save();
 const actions={done:'receipt',unknown:'pending'};const b=new RuntimeRecovery(home);assert.equal(b.state.restartRequested.id,'r1');
 await b.recover([['agency',context=>{assert.equal(context.id,'r1');return {status:'scheduled'};}]]);
 assert.deepEqual(actions,{done:'receipt',unknown:'pending'});assert.equal(b.state.restartRequested,null);
}));
