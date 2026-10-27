import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LifeEngine,defaults} from '../lib/engine.js';
import {sampleLifeReaction,readLifeMoodInputs,mergeLifeContribution,recordLifeMoodReceipts,lifeMoodJudgeContext} from '../lib/mood-link.js';
const library=JSON.parse(fs.readFileSync(new URL('../data/mood-reactions.json',import.meta.url)));
const normal=()=>({moodDelta:0,dims:{happy:0,calm:0,sweet:0,heartache:0,worry:0,sad:0,jealous:0},reason:'普通对话',confidence:90});
const fixture=fn=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-mood-link-'));try{return fn(home);}finally{fs.rmSync(home,{recursive:true,force:true});}};
test('random reactions include change and no change, bounded and non-romantic',()=>{
 let seed=123;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296),seen=new Set();
 for(let i=0;i<1000;i++){const r=sampleLifeReaction({category:'hobby'},'start',library,defaults,random);seen.add(r.id);assert.ok(Math.abs(r.moodDelta)<=3);assert.ok(Object.values(r.dims).every(v=>Math.abs(v)<=6));assert.ok(!r.dims.sweet&&!r.dims.jealous);}
 assert.ok(seen.size>=3);assert.ok(seen.has('neutral')||seen.has('flat'));assert.ok(seen.has('enjoy'));
});
test('zero intensity and zero reaction chance never create a mood change',()=>{for(const config of [{...defaults,lifeMoodIntensity:0},{...defaults,lifeMoodChance:0}]){const r=sampleLifeReaction({category:'hobby'},'start',library,config,()=>0);assert.equal(r.moodDelta,0);assert.ok(Object.values(r.dims).every(x=>x===0));}});
test('events persist a single sampled reaction through refresh/restart and cap daily candidates',()=>fixture(home=>{
 const now=Date.parse('2026-10-27T12:00:00Z');let e=new LifeEngine({home,now:()=>now,random:()=>0});e.saveConfig({sessionIds:['target'],probability:0,lifeMoodDailyLimit:1});const event=e.add('reading');const first=structuredClone(event.reaction);e.publishMoodEvent(event,'start',now);e.context('target');assert.equal(e.moodEvents.events.length,1);e=new LifeEngine({home,now:()=>now,random:()=>.99});assert.deepEqual(e.state.active[0].reaction,first);e.add('tidy');assert.equal(e.moodEvents.events.length,1);
}));
test('only matching, unconsumed, unexpired life events enter native mood judgment',()=>fixture(home=>{
 const now=Date.parse('2026-10-27T12:00:00Z'),e=new LifeEngine({home,now:()=>now,random:()=>0});e.saveConfig({sessionIds:['target'],probability:0});e.add('reading');const state={};assert.equal(readLifeMoodInputs(home,'target','censhu',state,now).length,1);assert.equal(readLifeMoodInputs(home,'other','censhu',state,now).length,0);assert.equal(readLifeMoodInputs(home,'target','other',state,now).length,0);assert.equal(readLifeMoodInputs(home,'target','censhu',state,now+25*3600000).length,0);state.lifeEventReceipts=[e.moodEvents.events[0].id];assert.equal(readLifeMoodInputs(home,'target','censhu',state,now).length,0);e.saveConfig({lifeMoodEnabled:false});assert.equal(readLifeMoodInputs(home,'target','censhu',{},now).length,0);
}));
test('accepted native judgments have bounded contribution, receipts, no duplicate apply',()=>{
 const batch=[{id:'a'}],state={timeline:[]},d={...normal(),life:{eventIds:['a'],moodDelta:99,dims:{happy:99,sweet:99,jealous:99,sad:-99},reason:'事件',confidence:95}};
 const merged=mergeLifeContribution(d,batch,state);assert.equal(merged.moodDelta,3);assert.equal(merged.dims.happy,6);assert.equal(merged.dims.sad,-6);assert.equal(merged.dims.sweet,0);assert.equal(merged.dims.jealous,0);recordLifeMoodReceipts(state,merged);assert.deepEqual(state.lifeEventReceipts,['a']);assert.equal(mergeLifeContribution(d,batch,state).moodDelta,0);
});
test('unreliable, forged and mixed stale event IDs never count as an emotion contribution',()=>{
 for(const life of [{eventIds:['forged'],confidence:90,moodDelta:3},{eventIds:['a'],confidence:30,moodDelta:3},{eventIds:['a','stale'],confidence:90,moodDelta:3}])assert.equal(mergeLifeContribution({...normal(),life},[{id:'a'}],{lifeEventReceipts:['stale']}).lifeAcceptedIds.length,0);
});
test('a confidently neutral judgment is consumed once without manufacturing emotion',()=>{
 const state={timeline:[]},d=mergeLifeContribution({...normal(),life:{eventIds:['a'],confidence:90,moodDelta:0,dims:{},reason:'这件事很平常'}},[{id:'a'}],state);assert.equal(d.moodDelta,0);recordLifeMoodReceipts(state,d);assert.deepEqual(state.lifeEventReceipts,['a']);assert.equal(state.timeline.length,0);
});
test('a zero-change sampled reaction cannot be turned into a random score jump',()=>{const batch=[{id:'a',reaction:{suggestedMoodDelta:0,suggestedDims:{}}}],d=mergeLifeContribution({...normal(),life:{eventIds:['a'],confidence:90,moodDelta:3,dims:{happy:6}}},batch,{});assert.equal(d.moodDelta,0);assert.equal(d.dims.happy,0);assert.deepEqual(d.lifeAcceptedIds,['a']);});
test('life plugin never writes original mood data, and judgment prompt separates its contribution',()=>fixture(home=>{
 const dir=path.join(home,'feiyu-mood');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'state.json'),'original-marker');const e=new LifeEngine({home,now:()=>Date.parse('2026-10-27T12:00:00Z')});e.add('reading');assert.equal(fs.readFileSync(path.join(dir,'state.json'),'utf8'),'original-marker');const text=lifeMoodJudgeContext([{id:'one',stage:'读书'}]);assert.match(text,/主字段 moodDelta\/dims\/reason 只计算本轮实际对话贡献/);assert.match(text,/不额外|一次心情判断/);assert.match(text,/life:/);
}));
