import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';import {ContentEvolution,scheduleWindow} from '../lib/content-evolution.js';
const minute=60000,hour=60*minute,day=24*hour;
const local=t=>Date.parse(t+'+08:00');
const raw={version:1,templates:[],scheduleNotes:[{startHour:9,endHour:11,text:'上午备注样本',validMinutes:120},{startHour:21,endHour:23,text:'晚间备注样本',validMinutes:120}],behaviorNotes:[{mode:'normal',text:'等模式出现才开始样本',validMinutes:60}]};
async function fixture(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-window-'));try{return await fn(home);}finally{fs.rmSync(home,{recursive:true,force:true});}}
test('21:00 generation uses tonight 21–23 and tomorrow 9–11 within the same 24h batch',()=>fixture(async home=>{
 let now=local('2026-10-27T21:00:00'),start=now;const e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['target'],moodLinked:false,probability:0});await new ContentEvolution(e,{generate:async()=>raw}).refresh(true);
 assert.equal(e.content.scheduleNotes[0].validFrom,local('2026-10-28T09:00:00'));assert.equal(e.content.scheduleNotes[0].expiresAt,local('2026-10-28T11:00:00'));assert.match(e.context('target'),/晚间备注样本/);assert.doesNotMatch(e.context('target'),/上午备注样本/);
 now=local('2026-10-28T09:30:00');assert.match(e.context('target'),/上午备注样本/);assert.doesNotMatch(e.context('target'),/晚间备注样本/);now=local('2026-10-28T10:30:00');assert.match(e.context('target'),/上午备注样本/);now=local('2026-10-28T11:00:00');assert.doesNotMatch(e.context('target'),/上午备注样本/);now=start+day;assert.doesNotMatch(e.context('target'),/上午备注样本|晚间备注样本/);
}));
test('next occurrence handles seconds, exact end, midnight rollover and timezone',()=>{
 const note={startHour:9,endHour:11,validMinutes:120};let at=local('2026-12-31T21:00:30');assert.equal(scheduleWindow(note,at,at+day,'Asia/Shanghai').validFrom,local('2027-01-01T09:00:00'));
 at=local('2026-10-27T08:59:30');assert.equal(scheduleWindow(note,at,at+day,'Asia/Shanghai').validFrom,local('2026-10-27T09:00:00'));at=local('2026-10-27T10:15:30');const inside=scheduleWindow(note,at,at+day,'Asia/Shanghai');assert.equal(inside.validFrom,at);assert.equal(inside.expiresAt,local('2026-10-27T11:00:00'));at=local('2026-10-27T11:00:00');assert.equal(scheduleWindow(note,at,at+day,'Asia/Shanghai').validFrom,local('2026-10-28T09:00:00'));
 const utc=Date.parse('2026-10-27T21:00:00Z');assert.equal(scheduleWindow(note,utc,utc+day,'UTC').validFrom,Date.parse('2026-10-28T09:00:00Z'));
});
test('behavior waits for the first committed mode; reentry and restart never renew its clock',()=>fixture(async home=>{
 let now=local('2026-10-27T21:00:00'),start=now;let e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['target'],moodLinked:false,probability:0});await new ContentEvolution(e,{generate:async()=>raw}).refresh(true);assert.equal(e.content.behaviorNotes[0].activatedAt,null);
 const before=fs.readFileSync(path.join(e.dir,'model-content.json'),'utf8');e.snapshot();e.context('target');assert.equal(fs.readFileSync(path.join(e.dir,'model-content.json'),'utf8'),before);
 now=start+12*hour;e.evaluate('target');const activated=e.content.behaviorNotes[0].activatedAt,until=e.content.behaviorNotes[0].expiresAt;assert.equal(activated,now);assert.equal(until,now+hour);assert.match(e.context('target'),/等模式出现才开始样本/);
 now+=30*minute;e=new LifeEngine({home,now:()=>now});new ContentEvolution(e);e.evaluate('target');assert.equal(e.content.behaviorNotes[0].activatedAt,activated);assert.equal(e.content.behaviorNotes[0].expiresAt,until);assert.match(e.context('target'),/等模式出现才开始样本/);
 now=until;e.evaluate('target');assert.equal(e.content.behaviorNotes[0].expiresAt,until);assert.doesNotMatch(e.context('target'),/等模式出现才开始样本/);
}));
test('late activation is capped by batch expiry and expired batches cannot activate',()=>fixture(async home=>{
 let now=local('2026-10-27T21:00:00'),start=now;const e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['target'],moodLinked:false,probability:0});await new ContentEvolution(e,{generate:async()=>raw}).refresh(true);now=start+day-10*minute;e.evaluate('target');assert.equal(e.content.behaviorNotes[0].expiresAt,start+day);now=start+day;assert.doesNotMatch(e.context('target'),/等模式出现才开始样本/);const note={mode:'low',text:'永远未激活',validMinutes:60,activatedAt:null};e.content.behaviorNotes.push(note);assert.equal(e.activateBehaviorNotes('low'),false);assert.equal(note.activatedAt,null);
}));
test('old active batches migrate from original generation time once without extending batch expiry',()=>fixture(home=>{
 const generated=local('2026-10-27T21:00:00');let now=local('2026-10-28T09:30:00');const e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['target'],moodLinked:false});const record={version:1,status:'ready',updatedAt:generated,nextAttemptAt:generated+day,content:{...raw,expiresAt:generated+7*day,notesExpireAt:generated+day,scheduleNotes:raw.scheduleNotes.map(n=>({...n,validFrom:generated,expiresAt:generated+2*hour})),behaviorNotes:raw.behaviorNotes.map(n=>({...n,validFrom:generated,expiresAt:generated+hour}))}};e.write('model-content.json',record);new ContentEvolution(e);assert.equal(e.content.notesTimingVersion,2);assert.equal(e.content.notesExpireAt,generated+day);assert.match(e.context('target'),/上午备注样本/);assert.equal(e.content.behaviorNotes[0].activatedAt,null);e.evaluate('target');const until=e.content.behaviorNotes[0].expiresAt;now+=10*minute;const restarted=new LifeEngine({home,now:()=>now});new ContentEvolution(restarted);assert.equal(restarted.content.behaviorNotes[0].expiresAt,until);assert.equal(restarted.content.notesExpireAt,generated+day);
}));
