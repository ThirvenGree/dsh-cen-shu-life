// 2026-11-09: inner-life rest/daily counts join the Gemini rhythm plan; recall candidates by meaning; persona evidence without names.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {timingCatalog,validateRhythm,rhythmPrompt} from '../lib/rhythm.js';
import {LifeEngine} from '../lib/engine.js';
import {readPersonaEvidence,readPersonaCandidates,captureMemoryContexts} from '../lib/persona-evolution.js';
import {personaExtractPrompt,personaReviewPrompt} from '../lib/persona-learning.js';
import {createSemanticRanker} from '../lib/knowledge/semantic-rank.js';

async function fixture(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-four-'));try{await fn(home);}finally{fs.rmSync(home,{recursive:true,force:true});}}
const plan=(over={})=>({reason:'测试',nextReviewMinutes:30,validMinutes:60,initiativeDecision:'wait',policies:Object.entries(timingCatalog).map(([key,rule])=>({key,value:Object.hasOwn(over,key)?over[key]:rule[1],reason:'测试'}))});

test('rhythm plan now covers the inner-life rest window and daily counts, with no fixed rest in the prompt',()=>{
 for(const key of ['innerQuietStartHour','innerQuietEndHour','innerJudgmentsDaily','innerReflectionsDaily'])assert.ok(timingCatalog[key],key);
 const v=validateRhythm(plan({innerQuietStartHour:23.5,innerQuietEndHour:7.25,innerJudgmentsDaily:9,innerReflectionsDaily:4}),0).values;
 assert.equal(v.innerQuietStartHour,23.5);assert.equal(v.innerReflectionsDaily,4);
 assert.throws(()=>validateRhythm(plan({innerJudgmentsDaily:2.5}),0),/innerJudgmentsDaily/);
 assert.throws(()=>validateRhythm(plan({innerReflectionsDaily:13}),0),/innerReflectionsDaily/);
 assert.match(rhythmPrompt,/独处的休息时段同样没有固定值/);
});

test('extract and review prompts tell Gemini to settle who an unnamed entry is about',()=>{
 assert.match(personaExtractPrompt,/代称/);assert.match(personaReviewPrompt,/代称/);
});

test('captured memory contexts accept unnamed entries for Gemini selection; the no-Gemini fallback stays named-only',()=>fixture(async home=>{
 const e=new LifeEngine({home});e.saveConfig({sessionIds:['target']});
 captureMemoryContexts(e,'target',[{name:'memory:snapshot',text:'- 青枔喜欢看旧照片\n- 她不爱吃香菜'}]);
 assert.deepEqual(readPersonaCandidates(e).runtime.map(r=>r.text).sort(),['- 她不爱吃香菜','- 青枔喜欢看旧照片']);
 assert.deepEqual(readPersonaEvidence(e).map(r=>r.text),['- 青枔喜欢看旧照片']);
 const list=(prefix,n)=>Array.from({length:n},(_,i)=>'- '+prefix+i).join('\n');
 captureMemoryContexts(e,'target',[{name:'memory:a',text:list('她的旧习惯',12)},{name:'memory:b',text:list('青枔说过的话',12)},{name:'memory:c',text:list('岑舒记得的事',12)}]);
 const rows=e.runtimeMemoryEvidence;assert.equal(rows.length,32);
 assert.equal(rows.filter(r=>/青枔|岑舒/.test(r.text)).length,25,'all named rows survive');
 assert.equal(rows.filter(r=>!/青枔|岑舒/.test(r.text)).length,7);
 assert.ok(!rows.some(r=>/她不爱吃香菜/.test(r.text)),'oldest unnamed row is dropped first');
 assert.ok(rows.some(r=>/青枔喜欢看旧照片/.test(r.text)),'older named row is kept');
}));

test('semantic ranker puts a same-meaning document ahead of an unrelated one and caches vectors separately',()=>fixture(async home=>{
 const vec=t=>Float32Array.from(/摄影|拍照/.test(t)?[1,0]:[0,1]);
 let calls=0;const embedder={id:'local:fake',embed:async texts=>{calls++;return texts.map(vec);}};
 const rank=createSemanticRanker({home,embedder});
 const docs=[{id:'a',text:'周末去公园摄影'},{id:'b',text:'整理抽屉里的纸片'},{id:'c',text:'今天拍照了吗'}];
 const r=await rank({queries:['拍照'],docs});assert.deepEqual(r.signals,['lexical','local']);
 assert.ok(r.ids.indexOf('a')<r.ids.indexOf('b'),'no shared characters, but same meaning');
 assert.ok(fs.existsSync(path.join(home,'cen-shu-life','knowledge','recall-vectors.json')));
 assert.ok(!fs.existsSync(path.join(home,'cen-shu-life','knowledge','vectors.json')),'knowledge vectors untouched');
 await rank({queries:['拍照'],docs});assert.equal(calls,1,'cached vectors are reused');
 assert.equal(await rank({queries:[''],docs}),null);
 const broken=createSemanticRanker({home:path.join(home,'x'),embedder:{id:'local:broken',embed:async()=>{throw Error('model missing');}}});
 assert.equal(await broken({queries:['拍照'],docs}),null);
}));
