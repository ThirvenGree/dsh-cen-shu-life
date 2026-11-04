import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {timingCatalog,validateRhythm,readRhythm,timingValue} from '../lib/rhythm.js';
const response=()=>({reason:'聊天结束后留一点独处时间',nextReviewMinutes:12,validMinutes:60,initiativeDecision:'wait',policies:Object.entries(timingCatalog).map(([key,r])=>({key,value:(r[1]+r[2])/2,reason:'本轮判断'}))});
test('rhythm rejects missing, duplicate and out of bounds policies without partial adoption',()=>{const r=response();assert.equal(Object.keys(validateRhythm(r,100).values).length,Object.keys(timingCatalog).length);assert.throws(()=>validateRhythm({...r,policies:r.policies.slice(1)},100),/遗漏/);assert.throws(()=>validateRhythm({...r,policies:[...r.policies,r.policies[0]]},100),/无效/);assert.throws(()=>validateRhythm({...r,validMinutes:1},100));});
test('shared consumers read the same valid decision and expiry does not silently extend it',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rhythm-'));try{fs.mkdirSync(path.join(dir,'cen-shu-life'));const plan=validateRhythm(response(),1000);fs.writeFileSync(path.join(dir,'cen-shu-life/rhythm.json'),JSON.stringify({plan}));assert.equal(timingValue('initiativeCooldownMinutes',60,dir,2000),plan.values.initiativeCooldownMinutes);assert.equal(readRhythm(dir,plan.expiresAt),null);assert.equal(timingValue('initiativeCooldownMinutes',60,dir,plan.expiresAt),60);assert.equal(readRhythm(dir,2000).at,1000);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
import {initiativeInputs} from '../lib/rhythm.js';
test('initiative planning includes current wishes and private intentions but excludes cancelled or completed wishes',()=>{
 const now=1000;
 const item=(id,extra={})=>({id,text:'想聊聊一本书',templateIds:[],priority:1,validFrom:500,expiresAt:2000,generatedAt:500,...extra});
 const inner={records:[{id:'private',intention:'想留给自己的画',shareState:'private'}]};
 const e={now:()=>now,config:{enabled:true,contentEvolutionEnabled:true,lifePlanningEnabled:true,sessionIds:['main'],mentionCooldownMinutes:60},state:{active:[{id:'event',startedAt:600,intentionIds:['done']}]},history:{events:[],mentions:[]},activeContent:()=>({intentions:[item('current'),item('cancelled',{cancelledAt:800}),item('expired',{expiresAt:900}),item('done'),item('future',{validFrom:1500})]}),innerLifePlanning:()=>inner};
 const input=initiativeInputs(e);assert.deepEqual(input.lifeIntentions.map(x=>x.id),['current','future']);assert.equal(input.inner,inner);
 e.config.lifePlanningEnabled=false;assert.deepEqual(initiativeInputs(e).lifeIntentions,[]);
});
