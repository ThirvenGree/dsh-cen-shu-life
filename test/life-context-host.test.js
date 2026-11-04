import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('life context reads only the verified display worker role and preserves chat and write permissions',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-context-role-host-'));
 const previous={home:process.env.DSH_HOME,bridge:process.env.QQ_BRIDGE_ROOT};
 process.env.DSH_HOME=home;process.env.QQ_BRIDGE_ROOT=path.join(home,'empty-bridge');
 const effects=[],tools=new Map(),guards=[];
 try{
  const [{LifeEngine},{createHost}]=await Promise.all([import('../lib/engine.js'),import('../lib/host.js')]);
  const engine=new LifeEngine({home,now:()=>1000,random:()=>1});
  // A different first binding must never become the private life session's role.
  engine.saveConfig({enabled:true,context:false,sessionIds:['session-other-role','session-qq-role'],semanticEnabled:false,
   probability:0,moodLinked:false,contentEvolutionEnabled:false,weatherAutoEnabled:false,
   personaEvolutionEnabled:false,memoryWritebackEnabled:false,timedEventsEnabled:false});
  const write=(relative,value)=>{const file=path.join(home,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
  const bind=()=>{
   write('characters/censhu/integration.json',{sessionId:'session-qq-role',characterId:'role-fixture'});
   write('censhu-inner-life/display-session.json',{sessionId:'session-private-life'});
   write('censhu-agency/state.json',{worker:{id:'session-private-life',role:'session-qq-role',phase:'ready'}});
  };bind();
  const agent=id=>({session:{id},ctx:{systemPrompt:{context:()=>()=>{}},on:()=>()=>{}}});
  const qq=agent('session-qq-role'),life=agent('session-private-life');
  createHost({agents:{roots:()=>[qq,life]},tools:{register(spec){tools.set(spec.name,spec);return()=>tools.delete(spec.name);},guard(fn){guards.push(fn);return()=>guards.splice(guards.indexOf(fn),1);}},
   get:()=>undefined,provide:()=>{},webServer:{register:()=>()=>{}},interval:()=>()=>{},on:()=>()=>{},
   effect(fn){const off=fn();if(typeof off==='function')effects.push(off);}
  },{engine,director:false});
  const prepared=[],reads=[];
  engine.innerLifePrepare=async request=>prepared.push(request.sessionId);
  engine.context=(sid,options)=>{reads.push({sid,options});return 'context:'+sid;};
  const call=callingAgent=>tools.get('censhu_life_context').execute({},{agent:callingAgent});
  assert.equal(await call(life),'context:session-qq-role');
  assert.equal(await call(qq),'context:session-qq-role');
  assert.deepEqual(prepared,['session-qq-role','session-qq-role']);
  assert.ok(reads.every(row=>row.sid==='session-qq-role'&&row.options.manual===true));
  for(const id of ['session-desktop-unbound','session-test-worker','session-child']){
   const unrelated=agent(id);unrelated.session.header={parentSession:life.session.id};
   await assert.rejects(()=>call(unrelated),/未绑定/);
  }
  assert.equal(reads.length,2,'unrelated sessions never read another role');
  for(const caller of [qq,life])assert.ok(guards.some(guard=>guard({name:'memory',arguments:{action:'write'},agent:caller})),
   'read mapping cannot authorize direct memory writes');
  write('censhu-agency/state.json',{worker:{id:'session-private-life',role:'session-stale-role',phase:'ready'}});
  await assert.rejects(()=>call(life),/绑定已失效/);
  assert.equal(await call(qq),'context:session-qq-role','QQ does not depend on the life worker mapping');
  bind();write('censhu-agency/state.json',{worker:{id:'session-old-life',role:'session-qq-role',phase:'ready'}});
  await assert.rejects(()=>call(life),/绑定已失效/);
  bind();write('censhu-agency/state.json',{worker:{id:'session-private-life',role:'session-qq-role',phase:'pending'}});
  await assert.rejects(()=>call(life),/绑定已失效/);
  bind();engine.config.sessionIds=['session-other-role'];
  await assert.rejects(()=>call(life),/绑定已失效/);
  engine.config.sessionIds=['session-other-role','session-qq-role'];bind();
  engine.innerLifePrepare=async()=>write('characters/censhu/integration.json',{sessionId:'session-other-role'});
  const count=reads.length;
  await assert.rejects(()=>call(life),/绑定已失效/);
  assert.equal(reads.length,count,'a binding changed during async preparation must not expose the old role context');
 }finally{
  effects.reverse().forEach(off=>off());
  if(previous.home===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous.home;
  if(previous.bridge===undefined)delete process.env.QQ_BRIDGE_ROOT;else process.env.QQ_BRIDGE_ROOT=previous.bridge;
  fs.rmSync(home,{recursive:true,force:true});
 }
});
