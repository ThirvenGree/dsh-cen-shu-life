import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {revokeDeletedMemory} from '../lib/persona-evolution.js';
import {sharedLifeContext} from '../lib/shared-context.js';
import {LifeEngine} from '../lib/engine.js';import {ContentEvolution} from '../lib/content-evolution.js';import {filterIntentions,intentionChoice,intentionView} from '../lib/life-intentions.js';
const raw={version:1,templates:[],scheduleNotes:[],behaviorNotes:[],intentions:[{text:'晚点想把旧书理一理',startHour:18,endHour:21,validMinutes:120,templateNames:['整理旧书'],priority:2}],personaFacts:[]};
const template=(id,name)=>({id,name,category:'personal',when:{hours:[7,23]},weight:1,cooldownHours:0,stages:[{minutes:20,text:'整理桌边的小东西'}]});
async function fixture(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-intentions-'));let now=Date.parse('2026-10-30T18:00:00+08:00');try{const e=new LifeEngine({home,now:()=>now,random:()=>0});e.saveConfig({sessionIds:['main'],personaEvolutionEnabled:false,probability:1,maxDaily:4,maxActive:2});e.templates.events=[template('books','整理旧书'),template('desk','整理桌面')];await fn({e,home,now:()=>now,advance:ms=>now+=ms});}finally{fs.rmSync(home,{recursive:true,force:true});}}
test('model intentions change real lottery weights, obey gates and link only actual events',()=>fixture(async({e})=>{
 let calls=0;const manager=new ContentEvolution(e,{generate:async()=>{calls++;return {...raw,intentions:[...raw.intentions,{...raw.intentions[0],text:'桌面可以改天再理',templateNames:['整理桌面'],priority:0}]};}});await manager.refresh(true);
 assert.equal(e.state.active.length,0);assert.equal(e.changes.since(0).items.length,0);assert.match(e.context('main'),/尚未发生/);assert.equal(intentionChoice(e,'books').priority,2);assert.equal(intentionChoice(e,'desk').priority,0);
 e.tick();assert.equal(e.state.active.length,1);assert.equal(e.state.active[0].templateId,'books');assert.equal(e.state.active[0].intentionIds.length,1);assert.equal(intentionView(e).find(x=>x.templateIds.includes('books')).status,'linked');assert.equal(e.state.lastSelection.candidates.find(x=>x.id==='desk').weight,0);assert.equal(calls,1);
 e.add('desk');assert.equal(e.state.active.length,2);assert.throws(()=>e.add('books'),/上限/);
}));
test('priority cannot bypass event hours or cooldown and unknown template names never create events',()=>fixture(async({e})=>{
 e.templates.events[0].when.hours=[7,8];e.state.cooldowns.desk=e.now()+3600000;
 await new ContentEvolution(e,{generate:async()=>({...raw,intentions:[...raw.intentions,{...raw.intentions[0],text:'有空再看看',templateNames:['不存在的事情']}]})}).refresh(true);
 e.tick();assert.equal(e.state.active.length,0);assert.equal(intentionView(e)[1].unresolvedNames[0],'不存在的事情');assert.equal(e.moodEvents.events.length,0);
}));
test('intentions expire, switches stop influence immediately, and reads never mutate state',()=>fixture(async({e,advance})=>{
 await new ContentEvolution(e,{generate:async()=>raw}).refresh(true);const before=fs.readFileSync(path.join(e.dir,'state.json'),'utf8');intentionView(e);e.context('main');assert.equal(fs.readFileSync(path.join(e.dir,'state.json'),'utf8'),before);
 e.saveConfig({lifePlanningEnabled:false});assert.equal(intentionChoice(e,'books').priority,1);assert.equal(intentionView(e).length,0);assert.doesNotMatch(e.context('main'),/当前生活意向/);e.saveConfig({lifePlanningEnabled:true});advance(121*60000);assert.equal(intentionView(e).length,0);
}));
test('bad intention items are rejected independently and duplicate entries are bounded',()=>{
 const rejected=[],good=raw.intentions[0],rows=filterIntentions([good,null,{...good,priority:99},good,{...good,text:'另外的轻量打算'}],rejected);assert.equal(rows.length,2);assert.equal(rejected.length,3);
});
test('an evening batch schedules a morning intention for the next occurrence',()=>fixture(async({e,advance})=>{
 await new ContentEvolution(e,{generate:async()=>({...raw,intentions:[{...raw.intentions[0],startHour:9,endHour:11,validMinutes:120}]})}).refresh(true);assert.equal(intentionView(e)[0].status,'upcoming');assert.equal(intentionChoice(e,'books').priority,1);advance(15.5*3600000);assert.equal(intentionView(e)[0].status,'available');assert.equal(intentionChoice(e,'books').priority,2);
}));
test('restart resumes a generated draft without another model call or extending note life',()=>fixture(async({e,home,advance,now})=>{
 let calls=0;const generate=async()=>{calls++;return raw;};e.activateBehaviorNotes=()=>{throw Error('temporary local apply failure');};const manager=new ContentEvolution(e,{generate});const generatedAt=now();await manager.refresh(true);assert.equal(manager.view().checkpoint.phase,'generated');assert.equal(calls,1);advance(10*60000);
 const restarted=new LifeEngine({home,now,random:()=>0});restarted.templates.events=e.templates.events;const resumed=new ContentEvolution(restarted,{generate});await resumed.refresh(true);assert.equal(calls,1);assert.equal(resumed.view().status,'ready');assert.equal(resumed.view().checkpoint,null);assert.equal(restarted.content.generatedAt,generatedAt);assert.equal(restarted.content.intentions[0].expiresAt,generatedAt+120*60000);
}));
test('changed semantic settings discard an old draft; retry uses the new model once',()=>fixture(async({e,home,now})=>{
 let calls=0;const generate=async()=>{calls++;return raw;};e.activateBehaviorNotes=()=>{throw Error('apply failure');};await new ContentEvolution(e,{generate}).refresh(true);const restarted=new LifeEngine({home,now});restarted.saveConfig({semanticModel:'gemini-replacement'});await new ContentEvolution(restarted,{generate}).refresh(true);assert.equal(calls,2);
}));
test('expired generated drafts are replaced rather than revived',()=>fixture(async({e,home,advance,now})=>{
 let calls=0;const generate=async()=>{calls++;return raw;};e.activateBehaviorNotes=()=>{throw Error('apply failure');};await new ContentEvolution(e,{generate}).refresh(true);advance(25*3600000);const restarted=new LifeEngine({home,now});await new ContentEvolution(restarted,{generate}).refresh(true);assert.equal(calls,2);assert.equal(restarted.content.generatedAt,now());
}));
test('partial persona application is idempotent when a generated draft resumes',()=>fixture(async({e,home,advance,now})=>{
 e.saveConfig({personaEvolutionEnabled:true});const evidence=[{id:'fact-a',source:'memory',text:'青枔说喜欢看旧照片'}],data={...raw,personaFacts:[{kind:'preference',text:'记得青枔喜欢旧照片',evidenceIds:['fact-a'],confidence:95,validDays:2}]};let calls=0;const generate=async()=>{calls++;return data;},save=e.saveProfile.bind(e);e.saveProfile=patch=>{save(patch);throw Error('stopped after persona save');};const pending=await new ContentEvolution(e,{generate,selectMemory:async()=>evidence}).refresh(true);assert.equal(pending.checkpoint.phase,'generated');const expires=e.profile.evolvingFacts[0].expiresAt;advance(10*60000);const restarted=new LifeEngine({home,now});await new ContentEvolution(restarted,{generate,selectMemory:async()=>{throw Error('must reuse draft evidence');}}).refresh(true);assert.equal(calls,1);assert.equal(restarted.profile.evolvingFacts[0].expiresAt,expires);assert.equal(restarted.evolutionStatus.status,'ready');
}));

test('explicitly deleted draft evidence cannot recreate a persona fact after recovery',()=>fixture(async({e,home,now})=>{
 e.saveConfig({personaEvolutionEnabled:true});const evidence=[{id:'draft-fact',source:'memory',text:'青枔说喜欢看旧照片'}],data={...raw,personaFacts:[{kind:'preference',text:'记得青枔喜欢旧照片',evidenceIds:['draft-fact'],confidence:95,validDays:2}]};const original=e.write.bind(e);e.write=(file,value)=>{original(file,value);if(file==='model-content.json'&&value.status==='applying')throw Error('after draft save');};await new ContentEvolution(e,{generate:async()=>data,selectMemory:async()=>evidence}).refresh(true);assert.equal(e.profile.evolvingFacts,undefined);assert.equal(revokeDeletedMemory(e,evidence[0].text),true);e.write=original;
 const restarted=new LifeEngine({home,now});await new ContentEvolution(restarted,{generate:async()=>{throw Error('must reuse existing draft');}}).refresh(true);assert.equal((restarted.profile.evolvingFacts||[]).length,0);assert.equal(restarted.evolutionStatus.status,'ready');
}));

test('audited cancel edits the existing intention and changes actual lottery without ending real events',()=>fixture(async({e})=>{
 await new ContentEvolution(e,{generate:async()=>raw}).refresh(true);const item=e.content.intentions[0],service=sharedLifeContext(e,{}),change={id:item.id,generatedAt:item.generatedAt,expectedRevision:0,action:'cancel',priority:0,reason:'独处时改主意，今晚想早点休息'};
 const result=service.submitInnerResult({sessionId:'main',id:'inner:cancel',intentionChanges:[change]});assert.equal(result.intentions.accepted.length,1);assert.equal(intentionView(e)[0].status,'cancelled');assert.equal(intentionChoice(e,'books').priority,0);assert.equal(e.moodEvents.events.length,0);e.tick();assert.equal(e.state.active[0].templateId,'desk');
 assert.equal(service.submitInnerResult({sessionId:'main',id:'inner:cancel',intentionChanges:[change]}).intentions.replayed,true);assert.equal(e.content.intentions[0].revision,1);
}));
test('only versions and allowed directions can change; invalid siblings do not discard a valid edit',()=>fixture(async({e})=>{
 await new ContentEvolution(e,{generate:async()=>raw}).refresh(true);const item=e.content.intentions[0],service=sharedLifeContext(e,{}),base={id:item.id,generatedAt:item.generatedAt,expectedRevision:0,action:'lower',priority:1,reason:'先放慢一点'};
 const result=service.submitInnerResult({sessionId:'main',id:'inner:lower',intentionChanges:[{...base,id:'intention:unknown'},base]});assert.equal(result.intentions.accepted.length,1);assert.equal(result.intentions.rejected.length,1);assert.equal(e.content.intentions[0].priority,1);
 const stale=service.submitInnerResult({sessionId:'main',id:'inner:stale',intentionChanges:[{...base,action:'raise',priority:2}]});assert.equal(stale.intentions.accepted.length,0);assert.match(stale.intentions.rejected[0].reason,/版本/);
 const raised=service.submitInnerResult({sessionId:'main',id:'inner:raise',intentionChanges:[{...base,action:'raise',priority:2,expectedRevision:1}]});assert.equal(raised.intentions.accepted.length,1);assert.throws(()=>service.submitInnerResult({sessionId:'main',id:'inner:raise',intentionChanges:[{...base,priority:0}]}),/不能替换/);
}));
test('cancelled wishes survive new daily content and the planner receives current private thoughts',()=>fixture(async({e,advance})=>{
 const manager=new ContentEvolution(e,{generate:async()=>raw});await manager.refresh(true);const item=e.content.intentions[0],service=sharedLifeContext(e,{});service.submitInnerResult({sessionId:'main',id:'inner:keep-cancel',intentionChanges:[{id:item.id,generatedAt:item.generatedAt,expectedRevision:0,action:'cancel',priority:0,reason:'今晚改为休息'}]});e.innerLifeProvider=()=>({records:[{id:'inner:thought',source:'character-life',intention:'今晚不想看了，早点睡'}]});advance(10*60000);
 manager.generate=async(_p,_s,input)=>{assert.equal(input.privateReflections[0].intention,'今晚不想看了，早点睡');return raw;};await manager.refresh(true);assert.equal(e.content.intentions.length,1);assert.equal(e.content.intentions[0].id,item.id);assert.equal(intentionView(e)[0].status,'cancelled');assert.equal(intentionChoice(e,'books').priority,0);
}));
test('mention cooldown follows actual text and persists; refresh does not reset same-wish cooldown',()=>fixture(async({e,home,advance,now})=>{
 const manager=new ContentEvolution(e,{generate:async()=>raw});await manager.refresh(true);e.noteMention('晚上想整理旧书');assert.equal(intentionView(e)[0].mayMention,false);assert.match(e.context('main'),/"mayMention":false/);advance(10*60000);await manager.refresh(true);assert.equal(intentionView(e)[0].mayMention,false);
 const restarted=new LifeEngine({home,now});new ContentEvolution(restarted,{generate:async()=>raw});assert.equal(intentionView(restarted)[0].mayMention,false);advance(181*60000);assert.equal(intentionView(restarted).length,0);
}));
test('linked and expired intentions reject edits; retry after receipt failure does not double-apply',()=>fixture(async({e,advance})=>{
 await new ContentEvolution(e,{generate:async()=>raw}).refresh(true);const item=e.content.intentions[0],service=sharedLifeContext(e,{}),change={id:item.id,generatedAt:item.generatedAt,expectedRevision:0,action:'lower',priority:1,reason:'降低倾向'};const write=e.write.bind(e);let fail=true;e.write=(file,value)=>{if(file==='intention-change-receipts.json'&&fail){fail=false;throw Error('receipt save failure');}write(file,value);};assert.throws(()=>service.submitInnerResult({sessionId:'main',id:'inner:once',intentionChanges:[change]}),/receipt save/);const retry=service.submitInnerResult({sessionId:'main',id:'inner:once',intentionChanges:[change]});assert.equal(retry.intentions.accepted[0].replayed,true);assert.equal(e.content.intentions[0].revision,1);
 e.add('books');const linked=service.submitInnerResult({sessionId:'main',id:'inner:linked',intentionChanges:[{...change,expectedRevision:1,action:'cancel',priority:0}]});assert.equal(linked.intentions.accepted.length,0);advance(121*60000);const expired=service.submitInnerResult({sessionId:'main',id:'inner:expired',intentionChanges:[{...change,expectedRevision:1,action:'cancel',priority:0}]});assert.equal(expired.intentions.accepted.length,0);
}));

test('an unexpired wish becomes mentionable again after the configured three-hour cooldown',()=>fixture(async({e,advance})=>{
 await new ContentEvolution(e,{generate:async()=>({...raw,intentions:[{...raw.intentions[0],endHour:24,validMinutes:360}]})}).refresh(true);e.noteMention('我晚上想整理旧书');assert.equal(intentionView(e)[0].mayMention,false);advance(179*60000);assert.equal(intentionView(e)[0].mayMention,false);advance(60000);assert.equal(intentionView(e)[0].mayMention,true);
}));

test('a cancellation made while a daily request is running survives its stale result',()=>fixture(async({e})=>{
 const manager=new ContentEvolution(e,{generate:async()=>raw});await manager.refresh(true);let finish;manager.generate=()=>new Promise(resolve=>finish=resolve);const pending=manager.refresh(true);await Promise.resolve();const item=e.content.intentions[0];sharedLifeContext(e,{}).submitInnerResult({sessionId:'main',id:'inner:in-flight',intentionChanges:[{id:item.id,generatedAt:item.generatedAt,expectedRevision:0,action:'cancel',priority:0,reason:'生成期间改为早休息'}]});finish(raw);await pending;assert.equal(e.content.intentions.length,1);assert.equal(e.content.intentions[0].id,item.id);assert.equal(intentionView(e)[0].status,'cancelled');assert.equal(intentionChoice(e,'books').priority,0);
}));
