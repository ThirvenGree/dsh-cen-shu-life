import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import {LifeEngine,readMood} from '../lib/engine.js';
import {readLifeMoodInputs} from '../lib/mood-link.js';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'censhu-native-mood-'));process.env.DSH_HOME=home;
const source=path.resolve(process.argv[2]||'../dsh-feiyu-mood');
const {apply,__测试:helpers}=await import(pathToFileURL(path.join(source,'lib/index.js')));
const sid='session-target';fs.mkdirSync(path.join(home,'characters/censhu'),{recursive:true});fs.writeFileSync(path.join(home,'characters/censhu/integration.json'),JSON.stringify({sessionId:sid}));
fs.mkdirSync(path.join(home,'feiyu-mood'),{recursive:true});fs.writeFileSync(path.join(home,'feiyu-mood/config.json'),JSON.stringify({slots:[{id:'censhu',selfName:'岑舒',ownerName:'青枔',sessions:[sid]}],模式:'session',moodBase:70,autoJudge:true}));
const engine=new LifeEngine({home,random:()=>0});engine.saveConfig({sessionIds:[sid],probability:0});engine.templates.events.find(e=>e.id==='reading').when={};const event=engine.add('reading');
const listeners=new Map(),effects=[],routes=new Map(),calls=[];
const agent={session:{id:sid,snapshotEvents:()=>[{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'今天过得怎么样'}]}},{type:'assistant/message',data:{message:{content:[{type:'text',text:'翻了几页旧书，还蛮有兴致'}]}}}]},options:{provider:'fake',model:'native-mood-test'},ctx:{on:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);},systemPrompt:{context:()=>()=>{}}}};
const ctx={agents:{roots:()=>[agent],list:()=>[agent]},effect:fn=>{const off=fn();if(typeof off==='function')effects.push(off);},interval:()=>()=>{},on:()=>()=>{},webServer:{register:r=>{routes.set(r.path,r.handler);return()=>{};}},llm:{async *stream(input){calls.push(input);const batch=readLifeMoodInputs(home,sid,'censhu',helpers.读一份('censhu'));yield {type:'text-delta',text:JSON.stringify({moodDelta:0,dims:{},reason:'真实对话平常',confidence:95,...(batch.length?{life:{eventIds:batch.map(e=>e.id),moodDelta:3,dims:{happy:6,calm:2},reason:'翻旧书这件记录中的小事让我有点兴致',confidence:calls.length===3?10:95}}:{})})};}}};
const flush=async()=>{for(let i=0;i<25;i++)await new Promise(r=>setImmediate(r));};
try{
 apply(ctx);listeners.get('agent/turn-stopping')();await flush();let mood=readMood(home,engine.config,sid);
 assert.equal(calls.length,1);assert.match(calls[0].system,/岑舒生活事件输入/);assert.equal(mood.mood,71);assert.equal(mood.dims.happy,6);assert.equal(mood.lifeEventReceipts.length,1);assert.match(engine.context(sid),/当前行为模式：有点高兴/);
 engine.storeSituation(sid,{source:'semantic-model',version:1,confidence:95,needsCare:true,careResolved:false,confession:false,offense:false,flirt:false,romance:false});
 const once={mood:mood.mood,happy:mood.dims.happy};listeners.get('agent/turn-stopping')();await flush();mood=readMood(home,engine.config,sid);assert.equal(calls.length,2);assert.doesNotMatch(calls[1].system,/岑舒生活事件输入/);assert.equal(mood.mood,once.mood);assert.equal(mood.dims.happy,once.happy);assert.equal(mood.situation.needsCare,true);
 const req=Readable.from(['{}']);req.url='/dsh-feiyu-mood/reset?key=censhu';req.method='POST';await routes.get('/dsh-feiyu-mood/reset')(req,{writeHead(){},end(){}});const reset=helpers.读一份('censhu');assert.ok(reset.lifeEventReceipts.includes(engine.moodEvents.events[0].id));assert.equal(readLifeMoodInputs(home,sid,'censhu',reset).length,0);
 engine.storeSituation(sid,{source:'unavailable'});engine.templates.events.find(e=>e.id==='tidy').when={};engine.add('tidy');
 listeners.get('agent/turn-stopping')();await flush();const rejected=helpers.读一份('censhu');assert.deepEqual(rejected.behaviorContext,{});assert.equal(readLifeMoodInputs(home,sid,'censhu',rejected).length,0);assert.equal(rejected.mood,70);
 listeners.get('agent/turn-stopping')();await flush();assert.doesNotMatch(calls[3].system,/岑舒生活事件输入/);
 console.log(JSON.stringify({nativeMoodWriter:true,firstJudgmentCalls:1,totalNormalTurns:4,totalCalls:calls.length,onceOnly:true,realMood:once.mood,realHappy:once.happy,behavior:'pleased',resetPreventsReplay:true,structuredContextPersistsOnZeroDelta:true,unknownClearsNativeContext:true,rejectedEventsConsumed:true}));
}finally{for(const off of effects.reverse())off();fs.rmSync(home,{recursive:true,force:true});}
