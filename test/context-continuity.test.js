import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine,chooseMode,dims} from '../lib/engine.js';import {createHost} from '../lib/host.js';import {SituationClassifier,unknownSituation} from '../lib/situation.js';import {readLifeSituation} from '../lib/mood-link.js';
const signal=extra=>({version:1,confidence:95,needsCare:false,careResolved:false,confession:false,offense:false,flirt:false,romance:false,resolvedModes:[],source:'semantic-model',semanticState:'trusted',...extra});
async function fixture(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-care-'));try{return await fn(home);}finally{fs.rmSync(home,{recursive:true,force:true});}}
function moodFiles(home,now){fs.mkdirSync(path.join(home,'feiyu-mood'),{recursive:true});const situation={...signal({needsCare:true}),at:now};const d=Object.fromEntries(dims.map(k=>[k,['worry','heartache'].includes(k)?20:0]));fs.writeFileSync(path.join(home,'feiyu-mood/config.json'),JSON.stringify({moodBase:70,slots:[{id:'censhu',sessions:['target']}]}));fs.writeFileSync(path.join(home,'feiyu-mood/state.json'),JSON.stringify({version:2,moods:{censhu:{mood:70,dims:d,lastConfidence:95,updatedAt:now,behaviorContext:situation}}}));}
function harness(e,classifier){const listeners=new Map(),effects=[];let timer;const agent={session:{id:'target'},ctx:{systemPrompt:{context:()=>()=>{}},on(k,fn){listeners.set(k,fn);return()=>{};}}};createHost({agents:{roots:()=>[agent]},tools:{register:()=>()=>{}},webServer:{register:()=>()=>{}},effect:fn=>{const off=fn();if(typeof off==='function')effects.push(off);},interval:fn=>{timer=fn;return()=>{};},on:()=>()=>{}},{engine:e,classifier});return {tick:()=>timer(),inbox:text=>listeners.get('agent/inbox/inserted')({message:{content:[{type:'text',text}]}}),assemble:()=>listeners.get('system-prompt/assemble')({contexts:[]}),end:()=>listeners.get('agent/turn-stopping')(),dispose:()=>effects.reverse().forEach(fn=>fn())};}
test('soft survives turn end, pending acknowledgement and trusted neutral; original evidence expires into recovery',()=>fixture(async home=>{
 let now=Date.now(),start=now,release;const pending=new Promise(r=>release=r);moodFiles(home,now);const e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['target'],probability:0,contentEvolutionEnabled:false});
 const c=new SituationClassifier({now:()=>now,classify:async text=>{if(text==='嗯'){await pending;return signal();}return signal({needsCare:true});}});const h=harness(e,c);
 try{
 h.inbox('今天好难受');await h.assemble();assert.equal(e.state.mode.id,'soft');const evidenceAt=e.situations.records.target.evidenceAt.needsCare;h.end();now+=61000;h.tick();assert.equal(e.state.mode.id,'soft');assert.equal(e.state.mode.recovering,false);
 h.inbox('嗯');now+=61000;h.tick();assert.equal(e.state.mode.id,'soft');assert.match(e.context('target'),/当前行为模式：心软/);release();await h.assemble();assert.equal(e.state.mode.id,'soft');assert.equal(e.situations.records.target.evidenceAt.needsCare,evidenceAt);h.end();now+=61000;h.tick();assert.equal(e.state.mode.id,'soft');
 now=start+16*60000;h.tick();assert.equal(e.state.mode.id,'soft');assert.equal(e.state.mode.recovering,true);const releaseAt=e.state.mode.releaseAt;
 now=releaseAt-1000;h.tick();assert.equal(e.state.mode.id,'soft');assert.equal(e.state.mode.recovering,true);now=releaseAt+61000;h.tick();assert.equal(e.state.mode.id,'normal');
 }finally{h.dispose();}
}));
test('explicit recovery revokes soft immediately and survives subsequent turn end and acknowledgements',()=>fixture(async home=>{
 let now=Date.now();moodFiles(home,now);const e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['target'],probability:0,contentEvolutionEnabled:false});const h=harness(e,new SituationClassifier({now:()=>now,classify:async text=>signal(text==='我已经好多了'?{careResolved:true}:text==='难受'?{needsCare:true}:{})}));
 try{h.inbox('难受');await h.assemble();assert.equal(e.state.mode.id,'soft');h.end();now+=1000;h.inbox('我已经好多了');await h.assemble();assert.equal(e.state.mode.id,'normal');assert.equal(e.state.mode.recovering,false);h.end();now+=61000;h.tick();assert.equal(e.state.mode.id,'normal');h.inbox('嗯');await h.assemble();assert.equal(e.state.mode.id,'normal');assert.equal(readLifeSituation(home,'target','censhu',now).needsCare,false);}finally{h.dispose();}
}));
test('unknown classifications do not erase evidence, and acknowledgements never extend its lifetime',()=>fixture(home=>{
 let now=1000000;const e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['target']});e.storeSituation('target',signal({needsCare:true}));const original=fs.readFileSync(path.join(e.dir,'semantic-situations.json'),'utf8');
 for(const source of ['pending','unavailable','low-confidence','disabled'])e.storeSituation('target',unknownSituation(source));assert.equal(fs.readFileSync(path.join(e.dir,'semantic-situations.json'),'utf8'),original);
 now+=14*60000;e.storeSituation('target',signal());assert.equal(readLifeSituation(home,'target','censhu',now).needsCare,true);now+=2*60000;assert.equal(readLifeSituation(home,'target','censhu',now).needsCare,false);
}));
test('absent or untrusted dialogue preserves mood-side care, flirt, romance and normal holds',()=>{
 const now=Date.now(),mood={ok:true,mood:70,baseline:70,confidence:95,updatedAt:now,dims:{worry:20,sweet:20,jealous:20},situation:signal({needsCare:true})};
 for(const dialogue of [{},unknownSituation('pending'),unknownSituation('unavailable'),signal()])assert.equal(chooseMode({now,mood,dialogue}).id,'soft');
 for(const [key,id]of [['flirt','embarrassed'],['romance','jealous']])assert.equal(chooseMode({now,mood:{...mood,situation:signal({[key]:true})},dialogue:unknownSituation()}).id,id);
 const previous=chooseMode({now,mood:{...mood,situation:{}},dialogue:signal({confession:true})});for(const dialogue of [{},unknownSituation(),signal()])assert.equal(chooseMode({now:now+1000,mood:{...mood,situation:{},dims:{}},previous,dialogue}).id,'panicked');
 assert.equal(chooseMode({now:now+1000,mood,previous:{id:'soft',since:now,priority:100},dialogue:signal({careResolved:true})}).id,'pleased');
});
test('explicit corrections are mode-specific and cannot remove care without careResolved',()=>{
 const now=Date.now(),mood={ok:true,mood:70,baseline:70,confidence:95,updatedAt:now,dims:{}};
 for(const id of ['panicked','hurt','embarrassed','jealous']){const previous={id,since:now,priority:90};assert.equal(chooseMode({now:now+1000,mood,previous,dialogue:signal({resolvedModes:[id]})}).id,'normal');}
 const previous={id:'soft',since:now,priority:100};assert.equal(chooseMode({now:now+1000,mood,previous,dialogue:signal({resolvedModes:['soft']})}).id,'soft');assert.equal(chooseMode({now:now+1000,mood,previous,dialogue:signal({careResolved:true})}).id,'normal');
});
test('event behavior sampling survives every combination of mood linkage toggles without writing mood inputs',()=>fixture(home=>{
 for(const moodLinked of [false,true])for(const lifeMoodEnabled of [false,true]){
 const child=path.join(home,String(moodLinked)+'-'+String(lifeMoodEnabled));let now=Date.parse('2026-10-27T12:00:00Z');const e=new LifeEngine({home:child,now:()=>now,random:()=>0});e.saveConfig({moodLinked,lifeMoodEnabled,lifeMoodChance:1,probability:0});e.templates.events.push({id:'annoying-test',name:'烦心小事',category:'personal',when:{},weight:1,cooldownHours:0,effect:'annoyed',stages:[{minutes:10,text:'开始'},{minutes:10,text:'继续'}]});const event=e.add('annoying-test');assert.equal(event.reaction.id,'annoyed');assert.equal(e.life().annoyed,true);assert.equal(e.evaluate('target').mode.id,'annoyed');const first=structuredClone(event.reaction);now+=11*60000;e.advance(now);assert.deepEqual(event.reaction,first);assert.equal(e.moodEvents.events.length,moodLinked&&lifeMoodEnabled?2:0);
 const reloaded=new LifeEngine({home:child,now:()=>now,random:()=>.99});assert.equal(reloaded.life().annoyed,true);assert.deepEqual(reloaded.state.active[0].reaction,first);
 }
}));

 test('failed classification of a new turn leaves established care active',()=>fixture(async home=>{
 const now=Date.now();moodFiles(home,now);const e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['target'],probability:0,contentEvolutionEnabled:false});e.storeSituation('target',signal({needsCare:true}));const original=fs.readFileSync(path.join(e.dir,'semantic-situations.json'),'utf8');const h=harness(e,new SituationClassifier({classify:async()=>{throw Error('network failure');}}));
 try{h.inbox('嗯');const result=await h.assemble();assert.match(result.contexts[0].text,/当前行为模式：心软/);h.end();h.tick();assert.equal(e.state.mode.id,'soft');assert.equal(fs.readFileSync(path.join(e.dir,'semantic-situations.json'),'utf8'),original);}finally{h.dispose();}
 }));
