import test from 'node:test';
import assert from 'node:assert/strict';
import {installContextLifecycle} from '../lib/context-lifecycle.js';

function fixture(initial=[],callbacks={},agents){
 const handlers=new Map(),removed=[],forgotten=[];
 let deprecatedReads=0;
 const ctx={agents,get(name){if(name==='sessionProjections'){deprecatedReads++;throw Error('deprecated API');}return name==='workspaceRegistry'?{archivedSessionIds:initial}:undefined;},
  on(name,fn,options){assert.equal(options.global,true);handlers.set(name,fn);return()=>{removed.push(name);handlers.delete(name);};}};
 const lifecycle=installContextLifecycle(ctx,id=>forgotten.push(id),callbacks);
 const changed=ids=>handlers.get('domain/changed')({domain:'workspace',table:'',operation:'put',value:{archivedSessionIds:ids}});
 return {handlers,removed,forgotten,lifecycle,changed,get deprecatedReads(){return deprecatedReads;}};
}

test('archive singleton changes clear newly archived snapshots and retain a live archival gate',()=>{
 const f=fixture(['older']);
 assert.deepEqual(f.forgotten,['older']);assert.equal(f.lifecycle.isArchived('older'),true);
 f.changed(['older','current']);assert.deepEqual(f.forgotten,['older','current']);
 f.changed(['older','current']);assert.deepEqual(f.forgotten,['older','current']);
 f.changed(['current']);assert.equal(f.lifecycle.isArchived('older'),false);assert.equal(f.lifecycle.isArchived('current'),true);
 // Unarchival only reopens new assembly. No callback recreates previous text.
 assert.deepEqual(f.forgotten,['older','current']);
 f.changed(['older','current']);assert.deepEqual(f.forgotten,['older','current','older']);
 f.lifecycle.dispose();
});

test('unrelated or malformed domain updates cannot clear the archive gate or another snapshot',()=>{
 const f=fixture(['bound']),changed=f.handlers.get('domain/changed');
 for(const payload of [null,{},
  {domain:'other',table:'',operation:'put',value:{archivedSessionIds:[]}},
  {domain:'workspace',table:'workspaces',operation:'deleted',key:'ws'},
  {domain:'workspace',table:'',operation:'deleted'},
  {domain:'workspace',table:'',operation:'put',value:{}},
  {domain:'workspace',table:'',operation:'put',value:{archivedSessionIds:['bound',null]}}
 ])changed(payload);
 assert.equal(f.lifecycle.isArchived('bound'),true);assert.deepEqual(f.forgotten,['bound']);f.lifecycle.dispose();
});

test('initial and updated workspace ids recognize the same session-prefixed aliases',()=>{
 const f=fixture(['session-bound']);
 assert.deepEqual(f.forgotten,['session-bound']);assert.equal(f.lifecycle.isArchived('bound'),true);assert.equal(f.lifecycle.isArchived('session-bound'),true);
 f.changed(['bound']);assert.deepEqual(f.forgotten,['session-bound']);
 assert.equal(f.lifecycle.isArchived('session-bound'),true);assert.equal(f.lifecycle.isArchived(undefined),false);
 f.changed([]);assert.equal(f.lifecycle.isArchived('bound'),false);assert.equal(f.lifecycle.isArchived('session-bound'),false);
 f.changed(['bound']);assert.deepEqual(f.forgotten,['session-bound','bound']);f.lifecycle.dispose();
});

test('actual session disposal clears snapshots and teardown unregisters all observers',()=>{
 const f=fixture(),onDisposed=f.handlers.get('session/disposed'),onChanged=f.handlers.get('domain/changed');
 onDisposed({id:'removed'});onDisposed({});onDisposed(null);
 assert.deepEqual(f.forgotten,['removed']);
 f.lifecycle.dispose();f.lifecycle.dispose();
 assert.deepEqual(new Set(f.removed),new Set(['domain/changed','session/disposed','session/event']));assert.equal(f.removed.length,3);
 onDisposed({id:'late'});onChanged({domain:'workspace',table:'',operation:'put',value:{archivedSessionIds:['late']}});
 assert.deepEqual(f.forgotten,['removed']);assert.equal(f.lifecycle.isArchived('late'),false);
});

test('a missing workspace service is supported and a partial install failure releases observers',()=>{
 const registered=[];const ctx={on(name,fn){registered.push({name,fn,off:false});return()=>{registered.find(x=>x.name===name).off=true;};}};
 const a=installContextLifecycle(ctx,()=>{});assert.equal(a.isArchived('x'),false);a.dispose();assert.ok(registered.every(x=>x.off));
 let released=0;
 assert.throws(()=>installContextLifecycle({on(name){if(name==='session/disposed')throw Error('installation failure');return()=>released++;}},()=>{}),/installation failure/);
 assert.equal(released,1);
});

test('turn/start precedes assembly and repeated model steps retain one turn identity',()=>{
 const calls=[],session={id:'session-chat'},f=fixture([],{startTurn:(id,turn)=>calls.push(['start',id,turn]),endTurn:(id,turn)=>calls.push(['end',id,turn])});
 const event=(type,turn,step)=>f.handlers.get('session/event')(session,{type,data:{turn,step}});
 assert.equal(f.lifecycle.currentTurn(session),undefined);
 event('turn/start',7);assert.equal(f.lifecycle.currentTurn(session),7);
 for(const step of [1,2,3]){
  // DSH assembles before step/start, and the next step must reuse this turn.
  assert.equal(f.lifecycle.currentTurn(session),7);event('step/start',7,step);event('tool/result',7,step);event('step/end',7,step);
 }
 event('turn/start',7);event('turn/start',6);assert.equal(f.lifecycle.currentTurn(session),7);assert.deepEqual(calls,[['start',session.id,7]]);
 event('turn/end',7);assert.equal(f.lifecycle.currentTurn(session),undefined);
 event('turn/start',8);event('turn/end',7);assert.equal(f.lifecycle.currentTurn(session),8);
 event('turn/end',8);assert.deepEqual(calls,[['start',session.id,7],['end',session.id,7],['start',session.id,8],['end',session.id,8]]);
 f.lifecycle.dispose();
});

test('hot reload uses agents.turnBoundaryOf and never reads deprecated projections or history',()=>{
 let projection={lastTurn:4,openTurnStartSeq:22},reads=0;
 const session={id:'chat',snapshotEvents(){assert.fail('deprecated full event reads are prohibited');}};
 const agents={turnBoundaryOf(actual){assert.equal(this,agents);assert.equal(actual,session);reads++;return projection;}};
 const f=fixture([],{},agents);
 assert.equal(f.lifecycle.currentTurn(session),4);assert.equal(f.lifecycle.currentTurn(session),4);assert.equal(reads,1);
 projection={lastTurn:4,openTurnStartSeq:null};f.handlers.get('session/event')(session,{type:'turn/end',data:{turn:4}});
 assert.equal(f.lifecycle.currentTurn(session),undefined);assert.equal(reads,2);
 for(const bad of [undefined,{}, {lastTurn:0,openTurnStartSeq:0},{lastTurn:4,openTurnStartSeq:null},{lastTurn:4,openTurnStartSeq:-1}]){projection=bad;assert.equal(f.lifecycle.currentTurn(session),undefined);}
 projection={lastTurn:5,openTurnStartSeq:30};assert.equal(f.lifecycle.currentTurn(session),5);
 f.lifecycle.dispose();assert.equal(f.lifecycle.currentTurn(session),undefined);
 assert.equal(f.deprecatedReads,0);
});

test('missing or failing agents API preserves event-driven tracking without deprecated fallback',()=>{
 for(const agents of [undefined,{}, {turnBoundaryOf(){throw Error('host unavailable');}}]){
  const f=fixture([],{},agents),session={id:'chat'};
  assert.equal(f.lifecycle.currentTurn(session),undefined);
  f.handlers.get('session/event')(session,{type:'turn/start',data:{turn:2}});
  assert.equal(f.lifecycle.currentTurn(session),2);
  f.handlers.get('session/event')(session,{type:'turn/end',data:{turn:2}});
  assert.equal(f.lifecycle.currentTurn(session),undefined);
  assert.equal(f.deprecatedReads,0);f.lifecycle.dispose();
 }
});

test('archive, disposal and teardown clear active turns without accepting late turn events',()=>{
 const session={id:'session-chat'},calls=[],f=fixture([],{startTurn:(...a)=>calls.push(a)}),event=f.handlers.get('session/event');
 event(session,{type:'turn/start',data:{turn:1}});assert.equal(f.lifecycle.currentTurn({id:'chat'}),1);
 f.changed(['chat']);assert.equal(f.lifecycle.currentTurn(session),undefined);
 event(session,{type:'turn/start',data:{turn:2}});assert.equal(f.lifecycle.currentTurn(session),undefined);assert.equal(calls.length,1);
 f.changed([]);assert.equal(f.lifecycle.currentTurn(session),undefined);event(session,{type:'turn/start',data:{turn:3}});assert.equal(f.lifecycle.currentTurn(session),3);
 f.handlers.get('session/disposed')(session);assert.equal(f.lifecycle.currentTurn(session),undefined);
 f.lifecycle.dispose();event(session,{type:'turn/start',data:{turn:4}});assert.equal(f.lifecycle.currentTurn(session),undefined);assert.equal(calls.length,2);
});

test('a disposed session instance cannot resurrect a cached open projection but a resumed instance can',()=>{
 const old={id:'session-chat'},fresh={id:'session-chat'},f=fixture([],{}, {turnBoundaryOf:()=>({lastTurn:7,openTurnStartSeq:50})});
 assert.equal(f.lifecycle.currentTurn(old),7);
 f.handlers.get('session/disposed')(old);
 assert.equal(f.lifecycle.currentTurn(old),undefined);
 f.handlers.get('session/event')(old,{type:'turn/start',data:{turn:8}});assert.equal(f.lifecycle.currentTurn(old),undefined);
 assert.equal(f.lifecycle.currentTurn(fresh),7);f.lifecycle.dispose();
});
