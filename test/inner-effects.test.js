import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {sharedLifeContext} from '../lib/shared-context.js';
import {deliverInnerEffects} from '../lib/inner-effects.js';
const fixture=fn=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'inner-effects-'));let now=Date.parse('2026-10-30T10:00:00+08:00');try{const e=new LifeEngine({home,now:()=>now});e.saveConfig({sessionIds:['main']});return fn(e,()=>now+=3600000);}finally{fs.rmSync(home,{recursive:true,force:true});}};
const mood={eventId:'book',reflectionEvidence:'想到留下旧物的意义',distinctReason:'原先只有整理的疲倦',moodDelta:1,dims:{happy:1,calm:0,sad:0},confidence:95,reason:'新的感受'};
const memory={text:'岑舒留下了票根',quote:'找到票根',importance:90};
test('independent receipts keep successes across service restart and retry only failed channel',()=>fixture(e=>{
 const request={id:'inner:one',sessionId:'main',expiresAt:e.now()+60000,memory,mood,intentionChanges:[{id:'test'}]};let fail=true;const calls={memory:0,mood:0,intentions:0};
 const deliver=r=>{const key=r.memory?'memory':r.mood?'mood':'intentions';calls[key]++;if(key==='memory'&&fail)throw Error('backend unavailable');return {[key]:key==='intentions'?{accepted:[],rejected:[]}: 'queued'};};
 let result=deliverInnerEffects(e,request,deliver);assert.equal(result.complete,false);assert.equal(result.mood,'queued');assert.equal(calls.intentions,1);
 fail=false;const restarted=new LifeEngine({home:e.home,now:e.now});result=deliverInnerEffects(restarted,request,deliver);assert.equal(result.complete,true);assert.deepEqual(calls,{memory:2,mood:1,intentions:1});
 assert.throws(()=>deliverInnerEffects(e,{...request,memory:{...memory,text:'changed'}},deliver),/不同内容/);
}));
test('expired temporary effects stop retrying while historical memory still delivers',()=>fixture((e,advance)=>{
 const request={id:'inner:expiry',sessionId:'main',expiresAt:e.now()+60000,memory,mood,intentionChanges:[{}]};
 deliverInnerEffects(e,request,()=>{throw Error('offline');});advance();let calls=0;
 const result=deliverInnerEffects(e,request,r=>{calls++;assert.ok(r.memory);return {memory:'queued'};});
 assert.equal(calls,1);assert.equal(result.complete,true);assert.equal(result.mood,'expired');assert.equal(result.channels.intentions.state,'expired');
}));
test('mood reservation recovers queue write failure after restart without double charging',()=>fixture(e=>{
 e.state.active.push({id:'book',moodAdmission:'admitted'});e.write('state.json',e.state);
 const request={sessionId:'main',id:'inner:recovery',mood};let fail=true;const write=e.write.bind(e);
 e.write=(name,value)=>{if(name==='mood-events.json'&&fail){fail=false;throw Error('disk interruption');}return write(name,value);};
 assert.throws(()=>sharedLifeContext(e,{}).submitInnerResult(request),/disk/);
 assert.equal(e.read('inner-mood-receipts.json',{}).daily[e.life().date].mood,1);
 const restarted=new LifeEngine({home:e.home,now:e.now});const service=sharedLifeContext(restarted,{});
 assert.equal(service.submitInnerResult(request).mood,'queued');assert.equal(service.submitInnerResult(request).mood,'duplicate');
 assert.equal(restarted.moodEvents.events.filter(x=>x.id==='book:reflection').length,1);assert.equal(restarted.read('inner-mood-receipts.json',{}).daily[e.life().date].mood,1);
}));
test('mood receipt commit failure recovers existing persisted candidate exactly once',()=>fixture(e=>{
 e.state.active.push({id:'book',moodAdmission:'admitted'});let writes=0;const write=e.write.bind(e);
 e.write=(name,value)=>{if(name==='inner-mood-receipts.json'&&++writes===2)throw Error('receipt interruption');return write(name,value);};
 const request={sessionId:'main',id:'inner:receipt',mood};assert.throws(()=>sharedLifeContext(e,{}).submitInnerResult(request),/interruption/);
 const restarted=new LifeEngine({home:e.home,now:e.now});sharedLifeContext(restarted,{}).submitInnerResult(request);
 assert.equal(restarted.moodEvents.events.filter(x=>x.id==='book:reflection').length,1);
}));
test('real shared service continues mood delivery when memory fails',()=>fixture(e=>{
 e.state.active.push({id:'book',moodAdmission:'admitted'});
 const service=sharedLifeContext(e,{enqueue(){throw Error('memory offline');},save(){}});
 const result=service.submitInnerResult({id:'inner:real',sessionId:'main',effectsProtocol:1,expiresAt:e.now()+60000,memory,mood});
 assert.equal(result.complete,false);assert.equal(result.memory,'retry');assert.equal(result.mood,'queued');assert.equal(e.moodEvents.events.length,1);
}));
