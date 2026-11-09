// 2026-11-07: test-workspace sessions get a read-only copy of the role's life view and read
// the role's memory, but nothing is observed, bound or written for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {createHost,setTestSessionCheck} from '../lib/host.js';
import {extraReadTool} from '../lib/extra-memory.js';

const snapshot=dir=>{const out={};const walk=d=>{for(const n of fs.readdirSync(d)){const p=path.join(d,n),s=fs.statSync(p);if(s.isDirectory())walk(p);else out[path.relative(dir,p)]=s.mtimeMs+':'+s.size;}};walk(dir);return out;};

test('test session receives the role life view read-only: no binding, no observation, no writes',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-test-readonly-')),effects=[],events=new Map(),hooks=new Map(),tools=new Map();
 const previous=process.env.DSH_HOME;process.env.DSH_HOME=home;
 try{
  const e=new LifeEngine({home,random:()=>1});
  e.saveConfig({sessionIds:['session-qq'],context:true,semanticEnabled:false,weatherAutoEnabled:false,contentEvolutionEnabled:false,personaEvolutionEnabled:false,memoryWritebackEnabled:true,timedEventsEnabled:false,moodLinked:false});
  fs.mkdirSync(path.join(home,'characters','censhu'),{recursive:true});fs.writeFileSync(path.join(home,'characters','censhu','integration.json'),JSON.stringify({sessionId:'session-qq'}));
  setTestSessionCheck(agent=>agent?.session?.id==='session-probe');
  const probe={session:{id:'session-probe',header:{},snapshotEvents:()=>[]},ctx:{systemPrompt:{context:()=>()=>{}},on:(n,f)=>{hooks.set(n,f);return()=>{};}}};
  const ctx={agents:{roots:()=>[probe],get:id=>id===probe.session.id?probe:null},get:()=>undefined,provide:()=>{},tools:{register:s=>{tools.set(s.name,s);return()=>{};},guard:()=>()=>{}},webServer:{register:()=>()=>{}},effect:f=>{const off=f();if(typeof off==='function')effects.push(off);},on:(n,f)=>{events.set(n,f);return()=>{};},interval:()=>()=>{}};
  createHost(ctx,{engine:e,director:false});
  e.context=(id,opts)=>{assert.equal(opts.manual,true);return 'state:'+id;};
  const msg={id:'u1',source:{kind:'user'},content:[{type:'text',text:'测试会话里说的话'}]};
  events.get('session/event')?.(probe.session,{type:'user/message',data:msg});
  assert.equal(e.bound('session-probe'),false,'a test session is never bound');
  assert.ok(hooks.has('system-prompt/assemble'),'read-only context is mounted');
  assert.ok(!hooks.has('agent/inbox/inserted'),'incoming test messages are not observed');
  const before=snapshot(home);
  const out=await hooks.get('system-prompt/assemble')({},{},async()=>({contexts:[{name:'other',text:'x'}]}));
  const mirror=out.contexts.find(c=>c.name==='cen-shu-life-readonly');
  assert.ok(mirror&&mirror.text.includes('state:session-qq')&&mirror.text.includes('只读测试会话'));
  assert.equal(out.contexts.filter(c=>c.name==='other').length,1);
  assert.match(await tools.get('censhu_life_context').execute({},{agent:probe}),/state:session-qq/);
  assert.deepEqual(snapshot(home),before,'reading the mirror writes nothing');
  setTestSessionCheck(()=>false);
  await assert.rejects(tools.get('censhu_life_context').execute({},{agent:probe}),/未绑定/);
 }finally{setTestSessionCheck(()=>false);effects.reverse().forEach(f=>f());if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;fs.rmSync(home,{recursive:true,force:true});}
});

test('censhu_read_memory in a test session reads the role memory without recording evidence',async()=>{
 const calls=[];
 const engine={config:{enabled:true},bound:id=>id==='session-qq',read:()=>({sessionId:'session-qq'}),readonlyTestSession:agent=>agent?.session?.id==='session-probe',
  write:()=>assert.fail('no evidence writes for test sessions')};
 const tool=extraReadTool(engine,{read:async(a,sid)=>{calls.push(sid);return {text:'原文',truncated:false};}});
 const out=JSON.parse(await tool.execute({backend:'openviking',target:'user',id:'viking://user/a.md'},{agent:{session:{id:'session-probe'}}}));
 assert.equal(out.text,'原文');assert.deepEqual(calls,['session-qq']);
 await assert.rejects(tool.execute({backend:'openviking'},{agent:{session:{id:'session-stranger'}}}),/仅限已绑定会话/);
});
