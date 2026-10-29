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
test('real pet input goes through the existing bound memory queue and respects disable',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-pet-observe-'));
 try{
  const engine=new LifeEngine({home}),calls=[];
  engine.saveConfig({sessionIds:['session-a']});
  const service=sharedLifeContext(engine,{observe:(...args)=>calls.push(args)});
  service.observe({sessionId:'session-a',text:'青枔喜欢热茶',reply:'助手的猜测'});
  assert.deepEqual(calls,[['session-a','青枔喜欢热茶']]);
  assert.throws(()=>service.observe({sessionId:'session-foreign',text:'其他来信'}),/未绑定/);
  engine.saveConfig({memoryWritebackEnabled:false});
  assert.deepEqual(service.observe({sessionId:'session-a',text:'不应写回'}),{accepted:false});
  assert.equal(calls.length,1);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
