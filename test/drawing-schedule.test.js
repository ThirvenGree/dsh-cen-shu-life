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
test('only actual acknowledged send or received records count, with earliest timestamp and correct binding',()=>fixture(async({home,write,now})=>{
 write('storages/session_projcache/sessions/session-target.json',{record:{identity:{cwd:home}}});write('state/sessions.json',{sessions:{'private:3230659580':'session-target'}});
 write('state/social-v2.json',{conversations:{'private:3230659580':{recentMessages:[{time:now()-1000,isSelf:true,text:'发送失败'},{time:now()-2000,isSelf:false,messageId:'received'},{time:now()-500,isSelf:true,messageId:'sent'},{time:now()+60000,isSelf:false,messageId:'future'}]}}});
 const rows=qqDayActivity(home,['target'],now(),'Asia/Shanghai');assert.equal(rows.length,2);assert.equal(rows[0].messageId,'received');assert.equal(qqDayActivity(home,['other'],now(),'Asia/Shanghai').length,0);
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
