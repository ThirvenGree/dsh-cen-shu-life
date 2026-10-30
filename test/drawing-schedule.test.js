import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine,clock} from '../lib/engine.js';import {DrawingInspiration} from '../lib/drawing-inspiration.js';import {qqDayActivity,pickDrawingTime} from '../lib/drawing-schedule.js';
async function fixture(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'drawing-day-'));let now=Date.parse('2026-10-30T09:00:00+08:00');const engine=new LifeEngine({home,now:()=>now,random:()=>.37});engine.saveConfig({sessionIds:['target'],probability:0});
 const write=(name,v)=>{const file=path.join(home,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(v));};
 try{await fn({home,engine,write,now:()=>now,advance:ms=>now+=ms});}finally{fs.rmSync(home,{recursive:true,force:true});}}
const window={startMinutes:73,endMinutes:191,skipToday:false,reason:'晚些再自然想起'};
test('no genuine message means no spontaneous planning, while ordinary events remain available',()=>fixture(async({engine})=>{
 let calls=0;const d=new DrawingInspiration(engine,{activity:()=>[],generate:async()=>{calls++;return window;}});await d.tick();assert.equal(calls,0);assert.equal(d.view().day,null);engine.add('drawing-inspiration');assert.equal(engine.state.active.length,1);
}));
test('first real activity plans a random window instead of creating an immediate inspiration',()=>fixture(async({engine,now,advance})=>{
 let calls=0;const activity=()=>[{at:now(),messageId:'1',direction:'received',sessionId:'target'}];const generate=async(_s,_schema,input)=>{calls++;assert.equal(input.purpose,'drawing-day-schedule');return window;};
 let d=new DrawingInspiration(engine,{activity,generate});await d.tick();assert.equal(calls,1);assert.equal(engine.state.active.length,0);const at=d.day().nextAt;assert.ok(at>=now()+73*60000&&at<=now()+191*60000);const anchor=d.day().firstMessageAt;
 advance(10*60000);d=new DrawingInspiration(engine,{activity,generate});await d.tick();assert.equal(calls,1);assert.equal(d.day().nextAt,at);assert.equal(d.day().firstMessageAt,anchor);
}));
test('Gemini can skip the rest of a day; next day requires a new genuine message',()=>fixture(async({engine,now,advance})=>{
 let hasMessage=true,calls=0;const d=new DrawingInspiration(engine,{activity:()=>hasMessage?[{at:now(),messageId:'1',direction:'sent'}]:[],generate:async()=>{calls++;return {...window,skipToday:true};}});
 await d.tick();assert.equal(d.day().status,'paused');advance(3*3600000);await d.tick();assert.equal(calls,1);
 hasMessage=false;advance(24*3600000);await d.tick();assert.equal(d.day(),null);assert.equal(calls,1);
}));
test('spontaneous judgment may schedule another window or stop for today independently of inspiration',()=>fixture(async({engine,now,advance})=>{
 let calls=0;const d=new DrawingInspiration(engine,{activity:()=>[{at:now(),messageId:'1',direction:'received'}],review:async(_s,_schema,input)=>input.candidate,generate:async(_s,_schema,input)=>{
   calls++;if(input.purpose)return window;return {inspiration:'absent',decision:'skip',medium:'text',idea:'',prompt:'',reason:'今天没有想画的内容',validMinutes:60,delayMinutes:83,windowEndMinutes:173,skipToday:calls===3};}});
 await d.tick();advance(d.day().nextAt-now()+1);await d.tick();assert.equal(calls,2);assert.equal(d.day().status,'scheduled');const next=d.day().nextAt;assert.ok(next>now()+83*60000);
 advance(next-now()+1);await d.tick();assert.equal(calls,3);assert.equal(d.day().status,'paused');assert.equal(engine.state.active.length,0);
}));
test('timestamps vary within a window and night-only windows move into randomized waking time',()=>{
 const now=Date.parse('2026-10-30T09:00:00+08:00');assert.notEqual(pickDrawingTime(now,60,180,()=>.1),pickDrawingTime(now,60,180,()=>.9));
 const night=Date.parse('2026-10-30T22:00:00+08:00'),a=pickDrawingTime(night,120,180,()=>.1),b=pickDrawingTime(night,120,180,()=>.9);
 assert.notEqual(a,b);assert.equal(clock(a).date,'2026-10-31');assert.ok(Number(clock(a).hour)>=6&&Number(clock(a).hour)<23);assert.throws(()=>pickDrawingTime(now,30,90));
});
test('versioned activity interface supplies bound records without any DSH cache or bridge state access',()=>fixture(async({home,write,now})=>{
 write('cen-shu-life/qq-activity-v1.json',{contract:'qq-bridge/life-activity',version:1,timeUnit:'ms',updatedAt:now(),bindings:[{sessionId:'session-target'}],firstByDay:{},messages:[{at:now()-2000,sessionId:'target',direction:'received',messageId:'received'},{at:now()-500,sessionId:'target',direction:'sent',messageId:'sent'}]});
 const rows=qqDayActivity(home,['target'],now(),'Asia/Shanghai');assert.equal(rows.length,2);assert.equal(rows[0].messageId,'received');assert.equal(rows.health.ready,true);assert.equal(qqDayActivity(home,['other'],now(),'Asia/Shanghai').health.code,'unbound');
}));
test('failed day scheduling is persisted and does not retry every background poll',()=>fixture(async({engine,now,advance})=>{
 let calls=0;const options={activity:()=>[{at:now(),messageId:'1',direction:'sent'}],generate:async()=>{calls++;throw Error('network');}};
 let d=new DrawingInspiration(engine,options);await d.tick();advance(30*60000);d=new DrawingInspiration(engine,options);await d.tick();assert.equal(calls,1);advance(31*60000);await d.tick();assert.equal(calls,2);
}));

test('night carryover preserves the chosen time but waits for next-day real interaction',()=>fixture(async({engine,now,advance})=>{
  advance(13*3600000);let hasMessage=true,calls=0;
  const options={activity:()=>hasMessage?[{at:now(),messageId:String(now()),direction:'sent'}]:[],generate:async()=>{calls++;return {...window,startMinutes:120,endMinutes:180};}};
  let d=new DrawingInspiration(engine,options);await d.tick();const chosen=d.day().nextAt;assert.equal(clock(chosen).date,'2026-10-31');
  hasMessage=false;advance(8*3600000+10*60000);await d.tick();assert.equal(d.day(),null);assert.equal(calls,1);
  hasMessage=true;advance(31000);d=new DrawingInspiration(engine,options);await d.tick();assert.equal(d.day().nextAt,chosen);assert.equal(d.day().carriedFrom,'2026-10-30');assert.equal(calls,1);
}));

test('activity protocol explicitly handles seconds, milliseconds, unknown versions and stale heartbeat',()=>fixture(async({home,write,now})=>{
 const source={contract:'qq-bridge/life-activity',version:1,timeUnit:'s',updatedAt:now()/1000,bindings:[{sessionId:'target'}],firstByDay:{},messages:[{at:(now()-2000)/1000,sessionId:'target',direction:'received',messageId:'one'}]};
 write('cen-shu-life/qq-activity-v1.json',source);let rows=qqDayActivity(home,['target'],now(),'Asia/Shanghai');assert.equal(rows[0].at,now()-2000);assert.equal(rows.health.ready,true);
 write('cen-shu-life/qq-activity-v1.json',{...source,version:2});assert.equal(qqDayActivity(home,['target'],now(),'Asia/Shanghai').health.code,'incompatible');
 write('cen-shu-life/qq-activity-v1.json',{...source,updatedAt:(now()-181000)/1000});assert.equal(qqDayActivity(home,['target'],now(),'Asia/Shanghai').health.code,'stale');
 write('cen-shu-life/qq-activity-v1.json',{...source,timeUnit:'ms',updatedAt:now()});const invalid=qqDayActivity(home,['target'],now(),'Asia/Shanghai');assert.equal(invalid.health.ready,true);assert.equal(invalid.health.skippedRows,1);assert.equal(invalid.length,0);
}));
test('healthy empty feed differs from missing feed and retained anchors survive an empty recent buffer',()=>fixture(async({home,write,now})=>{
 assert.equal(qqDayActivity(home,['target'],now(),'Asia/Shanghai').health.code,'unavailable');
 const base={contract:'qq-bridge/life-activity',version:1,timeUnit:'ms',updatedAt:now(),bindings:[{sessionId:'target'}],firstByDay:{},messages:[]};write('cen-shu-life/qq-activity-v1.json',base);
 assert.equal(qqDayActivity(home,['target'],now(),'Asia/Shanghai').health.ready,true);
 write('cen-shu-life/qq-activity-v1.json',{...base,firstByDay:{today:{at:now()-1000,sessionId:'target',direction:'sent',messageId:null,receiptId:'upload-confirmed'}}});
 assert.equal(qqDayActivity(home,['target'],now(),'Asia/Shanghai')[0].receiptId,'upload-confirmed');
}));
test('source failure remains visible even after daily anchor exists and pauses spontaneous requests',()=>fixture(async({engine,now,advance})=>{
 let ready=true,calls=0;const d=new DrawingInspiration(engine,{activity:()=>{const rows=ready?[{at:now(),messageId:'1',direction:'received'}]:[];rows.health={ready,code:ready?'ready':'incompatible',message:'test'};return rows;},generate:async()=>{calls++;return window;}});
 await d.tick();assert.equal(calls,1);const next=d.day().nextAt;ready=false;advance(next-now()+1);await d.tick();assert.equal(calls,1);assert.equal(d.view().activityHealth.code,'incompatible');assert.ok(d.day());
}));


test('malformed retained anchors and individual messages are skipped without losing genuine activity or planning',()=>fixture(async({home,engine,write,now})=>{
 const source={contract:'qq-bridge/life-activity',version:1,timeUnit:'ms',updatedAt:now(),bindings:[null,{sessionId:'target'}],firstByDay:{old:{at:now()-86400000,sessionId:'target',direction:'received'}},messages:[null,{at:now()-3000,sessionId:'target',direction:'received'},{at:'bad',sessionId:'target',direction:'received',messageId:'bad-time'},{at:now()-1000,sessionId:'target',direction:'received',messageId:'good'}]};
 write('cen-shu-life/qq-activity-v1.json',source);
 const rows=qqDayActivity(home,['target'],now(),'Asia/Shanghai');assert.equal(rows.length,1);assert.equal(rows[0].messageId,'good');assert.equal(rows.health.ready,true);assert.equal(rows.health.skippedRows,4);
 let calls=0;const d=new DrawingInspiration(engine,{generate:async()=>{calls++;return window;}});await d.tick();assert.equal(calls,1);assert.equal(d.view().activityHealth.skippedRows,4);assert.equal(d.day().firstMessageAt,now()-1000);
 write('cen-shu-life/qq-activity-v1.json',{...source,timeUnit:'unknown'});assert.equal(qqDayActivity(home,['target'],now(),'Asia/Shanghai').health.ready,false);
}));
