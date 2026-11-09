import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {MemoryWriteback} from '../lib/memory-writeback.js';
import {readLifeMoodInputs} from '../lib/mood-link.js';
import {mixedMoodPrompt,mixedMoodSchema,validateMixedMood,applyMixedMood} from '../lib/mixed-mood.js';
// 2026-11-08: mood improvements: full watch summaries, steadier feelings, her guess about Qingfeng, feelings kept with memories.
const fixture=async fn=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'mood-seven-'));try{const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],moodLinked:true,lifeMoodEnabled:true,moodSlot:'censhu',memoryWritebackEnabled:true});return await fn(e);}finally{fs.rmSync(home,{recursive:true,force:true});}};
const blend=extra=>({decision:'proceed',reason:'r',label:'安稳',summary:'s',speech:'慢',action:'等',validMinutes:60,components:[],tensions:[],notice:{decision:'notice',reason:'r',revisitMinutes:15},...extra});

test('long watch summaries and diaries reach the mood whole; ordinary events keep the short limit',()=>fixture(e=>{
 const long='看过的内容'.repeat(200),at=e.now();
 e.moodEvents.events.push(...[['media-douyin','a'],['inner-diary','b'],['scan','c']].map(([templateId,id])=>({id,eventId:id,templateId,name:'n',phase:'start',stageText:long,at,reaction:{label:'l',text:'t'}})));e.write('mood-events.json',e.moodEvents);
 const stage=id=>[...readLifeMoodInputs(e.home,'target','censhu',{lifeEventReceipts:['a','b','c'].filter(x=>x!==id)},at)].find(x=>x.id===id).stage.length;
 assert.equal(stage('a'),1000);assert.equal(stage('b'),1000);assert.equal(stage('c'),200);
}));

test('her guess about Qingfeng is required from the model, limited, and optional in old records',()=>{
 assert.ok(mixedMoodSchema.required.includes('ownerImpression'));
 assert.equal(validateMixedMood(blend({ownerImpression:'青枔好像有点累'})).ownerImpression,'青枔好像有点累');
 assert.equal(validateMixedMood(blend({ownerImpression:''})).ownerImpression,'');
 assert.doesNotThrow(()=>validateMixedMood(blend()));
 assert.throws(()=>validateMixedMood(blend({ownerImpression:'累'.repeat(201)})),/揣测/);
 assert.match(mixedMoodPrompt,/只是她的揣测，不是事实/);
});

test('when nothing changed the model is told to keep the feeling, and skip keeps it',()=>{
 assert.match(mixedMoodPrompt,/decision=skip，保持原来的组合/);
 const state={};applyMixedMood(state,validateMixedMood(blend({label:'原来的'})));
 applyMixedMood(state,validateMixedMood({decision:'skip',reason:'没有变化',notice:{decision:'defer',reason:'r',revisitMinutes:30}}));
 assert.equal(state.mixedMood.label,'原来的');assert.equal(state.mixedMoodHistory.length,1);
});

const text='我希望重要记忆自动写入已有记忆插件',memory={text:'青枔希望重要记忆自动写入已有记忆插件',quote:text,kind:'preference',importance:90,confidence:96};
const writer=(e,calls)=>{const agent={session:{id:'target'}};return new MemoryWriteback(e,{tools:{get:()=>true,execute:async x=>{calls.push(x);if(x.name==='censhu_mnemon_entries')return {value:{ok:true,entries:[]}};return {value:x.name==='engram_save'?{id:'e1',disposition:'accept'}:{ok:true,committed:true}};}},agents:()=>[agent],generate:async()=>({memories:[memory]})});};
const saved=calls=>calls.find(c=>c.name==='engram_save').arguments.content;

test('a memory keeps the feeling from when it happened, marked as not a fact',()=>fixture(async e=>{
 let feeling='挂念青枔';e.currentFeeling=()=>feeling;const calls=[],w=writer(e,calls);
 w.observe('target',text);feeling='后来的心情';await w.tick();
 assert.equal(w.record.facts[0].feeling,'挂念青枔');assert.equal(w.record.facts[0].text,memory.text,'the fact itself is untouched');
 assert.match(saved(calls),/\[当时的感受（只是她当时的心情，不是事实）：挂念青枔\]/);assert.doesNotMatch(saved(calls),/后来的心情/);
}));

test('without a current feeling the memory is written exactly as before',()=>fixture(async e=>{
 e.currentFeeling=()=>'';const calls=[],w=writer(e,calls);w.observe('target',text);await w.tick();assert.equal(w.record.facts[0].feeling,undefined);assert.doesNotMatch(saved(calls),/当时的感受/);
}));

test('currentFeeling is empty when the mood cannot be read',()=>fixture(e=>{assert.equal(e.currentFeeling(),'');}));
