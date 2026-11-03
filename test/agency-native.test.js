import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
test('native agency lease expires and overdue ordinary events release their slot',async()=>{
 const prev=process.env.DSH_HOME,home=fs.mkdtempSync(path.join(os.tmpdir(),'life-native-')),dir=path.join(home,'censhu-agency'),now=Date.now();
 try{process.env.DSH_HOME=home;fs.mkdirSync(dir);const write=(file,x)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(x));
 write('control.json',{version:2,sessionId:'role'});write('owner.json',{sessionId:'role',until:now+60000});
 const {owner}=await import('../lib/censhu-control.mjs');assert.equal(owner('role'),true);
 const ended=[];LifeEngine.prototype.advance.call({director:{},config:{sessionIds:['role']},state:{active:[{id:'old',endsAt:now-1800001},{id:'new',endsAt:now}]},end:id=>ended.push(id)},now);
 assert.deepEqual(ended,['old']);write('owner.json',{sessionId:'role',until:now-1});assert.equal(owner('role'),false);
 }finally{if(prev===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prev;fs.rmSync(home,{recursive:true,force:true});}
});

test('agency handoffs and personal turns are never a user message, even if they contain a bridge snapshot',async()=>{
 const {incomingText}=await import('../lib/host.js');
 const msg=(kind,text)=>({role:'user',source:{kind},content:[{type:'text',text}]});
 assert.equal(incomingText(msg('plugin:dsh-censhu-agency','【内部主动联系，非青枔来信】请处理本轮联系。')),'');
 assert.equal(incomingText(msg('plugin:dsh-censhu-agency','【本次消息快照】{"messages":[{"text":"内部资料"}]}')),'');
 assert.equal(incomingText(msg('user','我看到了')),'我看到了');
});
test('reviewed write permits are scoped to the exact operation and disappear after use',async()=>{
 const {auditedWrite,memoryDenied}=await import('../lib/reviewed-write.js');let captured;
 const request={name:'engram_save',agent:{id:'qq'},arguments:{content:'证据'}};
 assert.equal(memoryDenied({...request,callId:'censhu-memory-made-up'}),true);
 await auditedWrite({execute:async exec=>{captured=exec;assert.equal(memoryDenied(exec),false);assert.equal(memoryDenied({...exec,arguments:{content:'另一个内容'}}),true);}},request);
 assert.equal(memoryDenied(captured),true);assert.equal(memoryDenied({name:'memory',arguments:{action:'list'}}),false);
 assert.equal(memoryDenied({name:'memory',arguments:{action:'add'}}),true);
});
test('director-only overdue events free their slot',()=>{const ended=[];LifeEngine.prototype.advance.call({director:{},config:{sessionIds:[]},state:{active:[{id:'done',endsAt:0}]},end:id=>ended.push(id)},2000000);assert.deepEqual(ended,['done']);});
