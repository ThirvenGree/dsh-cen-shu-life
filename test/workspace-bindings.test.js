import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {matchesRoleWorkspace,installWorkspaceBindings} from '../lib/workspace-bindings.js';import {createDesktopBindings} from '../lib/desktop-bindings.js';import {LifeEngine} from '../lib/engine.js';
test('workspace roots bind before a human message, including private life, but not archived, test or children',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-bindings-'));try{
 const engine=new LifeEngine({home});engine.saveConfig({sessionIds:['session-qq']});const cwd=path.join(home,'chat'),life=path.join(home,'life');fs.mkdirSync(cwd);fs.mkdirSync(life);
 engine.write('workspace-bindings.json',{enabled:true,workspaces:[{id:'chat',path:cwd},{id:'life',path:life}]});fs.mkdirSync(path.join(home,'censhu-inner-life'));engine.write('../censhu-inner-life/isolation.json',{sessions:['life']});
 const a=(id,dir,extra={})=>({session:{id:'session-'+id,header:{cwd:dir,...extra},snapshotEvents:()=>[]}});
 const agents=[a('blank',cwd),a('life',life),a('test',path.join(home,'test')),a('child',cwd,{origin:'subagent'}),a('archived',cwd)];
 const registry={list:()=>[],archivedSessionIds:['session-archived']};const binding=createDesktopBindings(engine,()=>({getState:()=>({enabled:true,activeRole:'c',roles:[{id:'c',name:engine.profile.name}]})}),()=>registry);
 binding.sync(agents);assert.deepEqual(engine.config.sessionIds,['session-qq','session-blank','session-life']);
 registry.archivedSessionIds.push('session-blank');binding.sync(agents);assert.deepEqual(engine.config.sessionIds,['session-qq','session-life']);
 assert.equal(matchesRoleWorkspace(a('nested',path.join(cwd,'unrelated')),engine.read('workspace-bindings.json'),registry),false);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('persisted and newly created agents receive full permission without a model turn',async()=>{
 const policy={enabled:true,workspaces:[{id:'chat',path:os.tmpdir()}]},hooks={},disposers=[],agents=[],calls=[];
 const a=id=>({session:{id,header:{id,cwd:os.tmpdir()},append:(type,data)=>calls.push([id,type,data])}});const saved=a('saved');
 const engine={home:os.tmpdir(),read:(_name,f)=>_name==='workspace-bindings.json'?policy:f,write:()=>{}};
 const child={workspaceRegistry:{list:()=>[],archivedSessionIds:[]},sandboxPolicy:{overrideOf:()=>null},agents:{roots:()=>agents},sessionQuery:{listSessions:async()=>[{header:saved.session.header}]},sessionController:{resolveAgent:async()=>{agents.push(saved);return {agent:saved};}},on:(n,f)=>hooks[n]=f,effect:f=>disposers.push(f())};
 installWorkspaceBindings({inject:(_deps,f)=>f(child)},engine,()=>{});await new Promise(r=>setTimeout(r,20));hooks['agent/created']({agent:a('new')});disposers.forEach(f=>f());assert.ok(calls.some(x=>x[0]==='saved'&&x[2].mode==='danger-full-access'));assert.ok(calls.some(x=>x[0]==='new'));
});
