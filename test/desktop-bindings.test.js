import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDesktopBindings,desktopReplyPair} from '../lib/desktop-bindings.js';
import {LifeEngine,readMood,dims} from '../lib/engine.js';
import {linkedRoleSlots} from '../lib/mood-link.js';
import {createHost} from '../lib/host.js';

const agent=(id,events=[])=>({session:{id,header:{},snapshotEvents:()=>events},ctx:{systemPrompt:{context:()=>()=>{}},on:()=>()=>{}}});
const msg=(id,text,source='user')=>({id,source:{kind:source},content:[{type:'text',text}]});
test('desktop role bindings share all existing life paths without admitting private, background or child sessions',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-role-'));const e=new LifeEngine({home});
 try{
  e.saveConfig({sessionIds:['session-qq']});let state={enabled:true,activeRole:'censhu',roles:[{id:'censhu',name:e.profile.name}]};
  fs.mkdirSync(path.join(home,'censhu-inner-life'));e.write('../censhu-inner-life/isolation.json',{sessions:['test']});e.write('../censhu-inner-life/display-session.json',{sessionId:'session-life'});
  const desktop=agent('session-desktop',[{type:'user/message',data:msg('u1','你好')}]),other=agent('session-other'),privateTest=agent('session-test',desktop.session.snapshotEvents()),child=agent('session-child',desktop.session.snapshotEvents());child.session.header.parentSession='session-desktop';
  const binding=createDesktopBindings(e,()=>({getState:()=>state}));binding.sync([desktop,other,privateTest,child]);
  assert.deepEqual(e.config.sessionIds,['session-qq','session-desktop']);assert.equal(e.bound('desktop'),true);
  binding.sync([desktop,other],{agent:other,message:msg('internal','wake','plugin:another')});assert.equal(e.bound('other'),false);
  binding.sync([desktop,other],{agent:other,message:msg('u2','你好')});assert.equal(e.bound('other'),true);
  const moodSlots=[{id:'censhu',sessions:['session-qq']},{id:'other',sessions:['session-other']}];
  assert.deepEqual(linkedRoleSlots(moodSlots,home)[0].sessions,['session-qq','session-desktop']);
  state.enabled=false;binding.sync([desktop,other]);assert.deepEqual(e.config.sessionIds,['session-qq']);
  state.enabled=true;binding.sync([desktop]);assert.equal(e.bound('desktop'),true);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('short desktop answer pairs with the current stable id, never an older equal answer or internal notice',()=>{
 const a=agent('desk'),events=[{type:'assistant/message',data:msg('a1','茶还是咖啡？')},{type:'user/message',data:msg('old','好')},{type:'assistant/message',data:msg('a2','要记住这个偏好吗？')},{type:'user/message',data:msg('new','好')}];a.session.snapshotEvents=()=>events;
 assert.deepEqual(desktopReplyPair(a,msg('new','好')),{messageId:'new',id:'a2',text:'要记住这个偏好吗？'});
 assert.equal(desktopReplyPair(a,msg('not-yet-persisted','好')),undefined);
 assert.equal(desktopReplyPair(a,msg('new','好','plugin:notice')),undefined);
 events.splice(2,1);assert.equal(desktopReplyPair(a,msg('new','好')),undefined);
});
test('live host admits a new real desktop message immediately and mounts life, reviewed memory guard and readonly tools',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-host-')),effects=[],events=new Map(),hooks=new Map(),guards=[],tools=new Map();
 const previous=process.env.DSH_HOME;process.env.DSH_HOME=home;
 try{
  const e=new LifeEngine({home,random:()=>1});e.saveConfig({sessionIds:['session-qq'],context:false,semanticEnabled:false,weatherAutoEnabled:false,contentEvolutionEnabled:false,personaEvolutionEnabled:false,memoryWritebackEnabled:true,timedEventsEnabled:false,moodLinked:false});
  const a=agent('session-desk');a.ctx.on=(n,f)=>{hooks.set(n,f);return()=>{};};
  const ctx={agents:{roots:()=>[a],get:id=>id===a.session.id?a:null},get:name=>name==='cosplay'?{getState:()=>({enabled:true,activeRole:'c',roles:[{id:'c',name:e.profile.name}]})}:undefined,provide:()=>{},tools:{register:s=>{tools.set(s.name,s);return()=>{};},guard:f=>{guards.push(f);return()=>{};}},webServer:{register:()=>()=>{}},effect:f=>{const off=f();if(typeof off==='function')effects.push(off);},on:(n,f)=>{events.set(n,f);return()=>{};},interval:()=>()=>{}};
  createHost(ctx,{engine:e,director:false});assert.equal(e.bound('desk'),false);
  const m=msg('real','我喜欢温热的茶');a.session.snapshotEvents=()=>[{type:'user/message',data:m}];events.get('session/event')(a.session,{type:'user/message',data:m});
  assert.equal(e.bound('desk'),true);assert.ok(hooks.has('system-prompt/assemble'));assert.ok(hooks.has('agent/inbox/inserted'));
  assert.ok(guards.some(f=>f({name:'memory',arguments:{action:'add',content:'x'},agent:a})));
  e.context=id=>'state:'+id;assert.equal(await tools.get('censhu_life_context').execute({},{agent:a}),'state:session-desk');
  assert.equal(e.read('memory-writeback.json',{}).sources.filter(s=>s.text==='我喜欢温热的茶').length,1);
  hooks.get('agent/inbox/inserted')({message:m});assert.equal(e.read('memory-writeback.json',{}).sources.length,1);
  const short=msg('short','好');hooks.get('agent/inbox/inserted')({message:short});assert.equal(e.read('memory-writeback.json',{}).sources.length,1);
  a.session.snapshotEvents=()=>[{type:'user/message',data:m},{type:'assistant/message',data:msg('reply','记住这个喜好吗？')},{type:'user/message',data:short}];
  events.get('session/event')(a.session,{type:'user/message',data:short});
  const sources=e.read('memory-writeback.json',{}).sources;assert.equal(sources.length,2);assert.equal(sources[1].replyEvidence.precedingId,'reply');

 }finally{effects.reverse().forEach(f=>f());if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;fs.rmSync(home,{recursive:true,force:true});}
});
