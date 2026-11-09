import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {sharedLifeContext} from '../lib/shared-context.js';

test('pet snapshots reuse current memory without writing state or mixing other sessions',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-pet-shared-'));
 try{
  const now=Date.parse('2026-10-29T10:00:00+08:00'),engine=new LifeEngine({home,now:()=>now});
  engine.saveConfig({sessionIds:['session-a','session-b'],personaMemoryFiles:['KEY.md']});
  fs.mkdirSync(path.join(home,'memories'),{recursive:true});
  fs.writeFileSync(path.join(home,'memories/KEY.md'),'岑舒和青枔喜欢旧书。');
  engine.runtimeMemoryEvidence=[{id:'other',sessionId:'session-b',text:'岑舒的其他会话资料',source:'context:mnemon',at:now,expiresAt:now+60000}];
  const service=sharedLifeContext(engine,{observe:()=>{throw Error('snapshot must not write memory');}});
  const before=fs.readFileSync(path.join(engine.dir,'state.json'),'utf8');
  const result=service.snapshot({sessionId:'session-a'});
  assert.ok(result.memories.some(x=>x.text.includes('旧书')));
  assert.ok(!result.memories.some(x=>x.text.includes('其他会话')));
  assert.equal(fs.readFileSync(path.join(engine.dir,'state.json'),'utf8'),before);
  assert.throws(()=>service.snapshot({sessionId:'session-foreign'}),/未绑定/);
  engine.saveConfig({context:false});
  assert.throws(()=>service.snapshot({sessionId:'session-a'}),/未启用/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('pet input never changes shared activity or the memory queue, including old clients',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-pet-observe-'));
 try{
  const engine=new LifeEngine({home}),calls=[];
  engine.saveConfig({sessionIds:['session-a']});
  const service=sharedLifeContext(engine,{observe:(...args)=>calls.push(args)});
  const activityBefore=engine.read('recent-activity.json',{});
  assert.deepEqual(service.observe({sessionId:'session-a',text:'青枔喜欢热茶',reply:'助手的猜测'}),{accepted:false,reason:'pet-read-only'});
  assert.deepEqual(calls,[]);
  assert.deepEqual(engine.read('recent-activity.json',{}),activityBefore);
  assert.throws(()=>service.observe({sessionId:'session-foreign',text:'其他来信'}),/未绑定/);
  engine.saveConfig({memoryWritebackEnabled:false});
  assert.deepEqual(service.observe({sessionId:'session-a',text:'不应写回'}),{accepted:false,reason:'pet-read-only'});
  assert.equal(calls.length,0);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('attention context exposes current event lifecycle and original timeline without side effects',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-attention-'));
 try{
  const e=new LifeEngine({home});e.saveConfig({sessionIds:['main']});const service=sharedLifeContext(e,{});
  e.state.active.push({id:'book',name:'整理旧书',stage:1,stageText:'夹回票根',moodAdmission:'admitted'});
  e.changes.append('event-start',{eventId:'book',name:'整理旧书',stage:0,stageText:'发现票根'});
  const before=fs.readFileSync(path.join(e.dir,'state.json'),'utf8');let value=service.attentionContext({sessionId:'main',eventIds:['book','unknown']});
  assert.equal(value.events[0].status,'active');assert.equal(value.events[0].stageText,'夹回票根');assert.equal(value.events[0].timeline[0].text,'发现票根');assert.equal(value.events[1].status,'unknown');
  e.history.events.push({...e.state.active.pop(),endedAt:e.now()});value=service.attentionContext({sessionId:'main',eventIds:['book']});assert.equal(value.events[0].status,'ended');
  assert.equal(fs.readFileSync(path.join(e.dir,'state.json'),'utf8'),before);assert.throws(()=>service.attentionContext({sessionId:'foreign',eventIds:['book']}),/未绑定/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('browser interest reads fresh bound thoughts and excludes other sessions and expired wishes',()=>{
 const now=Date.now();let thought='喜欢线条';const e={now:()=>now,config:{enabled:true,context:true,contentEvolutionEnabled:true,lifePlanningEnabled:true},bound:id=>id==='main',state:{active:[],mode:{id:'pleased'}},history:{events:[],mentions:[]},activeContent:()=>({intentions:[{id:'i',text:'想画门窗',priority:1,templateIds:[],validFrom:now-1,expiresAt:now+60000},{id:'old',text:'已过期',priority:1,templateIds:[],validFrom:now-100,expiresAt:now-1}]}),read:()=>({recent:[{sessionId:'main',at:now,text:'聊过窗花'},{sessionId:'other',at:now,text:'其他会话'}]}),innerLifePlanning:()=>({thoughts:[{subject:'门窗',summary:thought}],records:[{intention:'晚点画一张'}]})};
 const shared=sharedLifeContext(e);assert.equal(shared.browserInterests({sessionId:'other'}),null);const a=shared.browserInterests({sessionId:'main'});assert.deepEqual(a.recent,['聊过窗花']);assert.equal(a.intentions.length,1);assert.deepEqual(a.privatePlans,['晚点画一张']);thought='想研究木纹';assert.equal(shared.browserInterests({sessionId:'main'}).thoughts[0].view,thought);
});

test('current mixed mood reaches Pet snapshots, video choice and browser interest inputs after disk update',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'mood-surfaces-'));try{
 const now=Date.now(),e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['main'],semanticEnabled:false});
 const dir=path.join(home,'feiyu-mood');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({slots:[{id:'censhu',sessions:['main']}]}));
 const save=(label,score)=>fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({version:2,moods:{censhu:{mood:score,dims:{happy:2,calm:1,sweet:0,heartache:0,worry:4,sad:0,jealous:0},lastReason:'旧书受潮',lastConfidence:95,updatedAt:now,mixedMood:{label,components:[],expiresAt:now+60000}}}}));
 save('开心又担心',71);const service=sharedLifeContext(e,{});
 assert.match(service.snapshot({sessionId:'main'}).context,/开心又担心/);
 assert.equal(service.douyinContext().mood.mixedMood.label,'开心又担心');assert.equal(service.browserInterests({sessionId:'main'}).moodState.qualitative,true);assert.equal(service.browserInterests({sessionId:'main'}).moodState.dimensions,undefined);
 save('稍微放下心',72);assert.match(service.snapshot({sessionId:'main'}).context,/稍微放下心/);assert.equal(service.douyinContext().mood.mixedMood.label,'稍微放下心');assert.equal(service.douyinContext().mood.score,undefined);
 const parts=[];e.context('main',{parts});assert.ok(parts.some(p=>p.key==='mood:current'&&p.text.includes('稍微放下心')),'shared budget receives the actual current mood item');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('both mood features explicitly select Gemini 3.8 Flash while unrelated models stay unchanged',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'mood-model-'));try{
 const e=new LifeEngine({home});e.config.semanticModel='other-model';e.config.semanticEnabled=true;
 const shared=sharedLifeContext(e,{}),urls=[];
 for(const feature of ['mood-numeric','mood-blend','other'])await shared.judge('fixture',null,{}, {feature,keyReader:async()=> 'test-only',fetcher:async(url)=>{urls.push(url);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'ok'}]}}]})};}});
 assert.match(urls[0],/gemini-3\.8-flash/);assert.match(urls[1],/gemini-3\.8-flash/);assert.match(urls[2],/other-model/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
