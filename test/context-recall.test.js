import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextRecall} from '../lib/context-recall.js';

const rows=(text='实际阶段原文')=>[{id:0,owner:'life',g:{name:'cen-shu-life'},key:'event:1',text,required:false},
 {id:1,owner:'inner',source:'censhu-inner-life-observations',text:'私人观察：窗边的光变了。',required:true}];
const readArgs=(s,item=0)=>({action:'read',snapshotId:s.snapshotId,version:s.version,itemId:s.entries[item].itemId});

test('published references identify exact immutable rows and refuse cross-session access',()=>{
 const service=createContextRecall({now:()=>1234}),input=rows();
 const snapshot=service.publish('life-session',input,{selectedIds:[1],topic:'本轮主题'});
 assert.equal(snapshot.available,true);assert.equal(snapshot.count,2);assert.equal(snapshot.omitted,1);
 assert.equal(snapshot.entries[0].source,'cen-shu-life');assert.equal(snapshot.entries[0].rowId,0);
 assert.equal(snapshot.entries[1].selected,true);assert.match(snapshot.version,/^[a-f0-9]{64}$/);
 input[0].text='之后修改';input.push({id:2,text:'新增'});
 const found=service.read('life-session',readArgs(snapshot));
 assert.equal(found.text,'实际阶段原文');assert.equal(found.createdAt,1234);assert.equal(found.current,true);
 assert.equal(service.read('qq-session',readArgs(snapshot)).status,'forbidden');
 assert.doesNotMatch(JSON.stringify(service.read('qq-session',readArgs(snapshot))),/实际阶段原文|私人观察/);
 assert.equal(service.read('qq-session',{action:'catalog'}).available,false);
});

test('new snapshots do not silently replace old versions; unchanged content reuses a snapshot',()=>{
 const service=createContextRecall();
 const old=service.publish('one',rows('旧的活动阶段'),{selectedIds:[0]});
 assert.equal(service.publish('one',rows('旧的活动阶段'),{selectedIds:[0]}).snapshotId,old.snapshotId);
 const next=service.publish('one',rows('新的活动阶段'),{selectedIds:[0]});
 assert.notEqual(old.version,next.version);
 const result=service.read('one',readArgs(old));
 assert.equal(result.text,'旧的活动阶段');assert.equal(result.current,false);assert.equal(result.currentSnapshot.snapshotId,next.snapshotId);
 const mismatch=service.read('one',{...readArgs(old),version:next.version});
 assert.equal(mismatch.status,'version_mismatch');assert.equal(mismatch.text,undefined);
 assert.equal(service.read('one',{...readArgs(next),itemId:old.entries[0].itemId}).status,'missing');
});

test('final injection selection updates metadata only and keeps stable exact body references',()=>{
 const service=createContextRecall(),snapshot=service.publish('one',rows(),{selectedIds:[0,1]});
 const updated=service.finalizeSelection('one',snapshot.snapshotId,[1]);
 assert.equal(updated.omitted,1);assert.equal(updated.snapshotId,snapshot.snapshotId);assert.equal(updated.version,snapshot.version);
 assert.equal(updated.entries[0].selected,false);
 const original=service.read('one',readArgs(snapshot));
 assert.equal(original.text,'实际阶段原文');assert.equal(original.item.selected,false);
 const published=service.publish('one',rows(),{selectedIds:[]});
 assert.equal(published.snapshotId,snapshot.snapshotId);assert.equal(published.omitted,2);
 assert.equal(service.finalizeSelection('other',snapshot.snapshotId,[]).status,'forbidden');
 assert.equal(service.finalizeSelection('one',snapshot.snapshotId,[99]).status,'invalid_request');
 const next=service.publish('one',rows('新原文'));
 assert.equal(service.finalizeSelection('one',snapshot.snapshotId,[]).available,false);
 assert.notEqual(next.version,snapshot.version);
});

test('catalog pages enumerate every omitted item and body pages preserve the exact complete text',()=>{
 const service=createContextRecall();
 const original='青枔🪟\n'+ '正文、参数=8192。'.repeat(650);
 const all=Array.from({length:19},(_,id)=>({id,owner:id%2?'inner':'agency',source:'本轮观察',text:id===3?original:'资料'+id}));
 const snapshot=service.publish('one',all,{selectedIds:[0,2]});
 let offset=0,ids=[];
 do{const page=service.read('one',{action:'catalog',snapshotId:snapshot.snapshotId,version:snapshot.version,offset,limit:4});
  assert.equal(page.status,'ready');ids.push(...page.entries.map(r=>r.rowId));offset=page.nextOffset;
 }while(offset!==null);
 assert.deepEqual(ids,all.map(r=>r.id));
 let restored='';offset=0;
 do{const page=service.read('one',{...readArgs(snapshot,3),offset,limit:79});
  assert.equal(page.status,'ready');restored+=page.text;assert.equal(page.totalChars,original.length);offset=page.nextOffset;
 }while(offset!==null);
 assert.equal(restored,original);
 const query=service.read('one',{action:'catalog',query:'青枔 8192'});
 assert.deepEqual(query.entries.map(r=>r.rowId),[3]);
});

test('catalog and full text output are bounded without discarding the rest of a source',()=>{
 const service=createContextRecall();
 const control='\u0001'.repeat(12000)+'结尾';
 const snapshot=service.publish('one',Array.from({length:12},(_,id)=>({id,owner:'\u0001'.repeat(80),source:'\u0001'.repeat(160),key:'\u0001'.repeat(512),text:control})));
 const catalog=service.read('one',{action:'catalog',limit:12});
 assert(JSON.stringify(catalog).length<=16000);assert(catalog.truncated);assert(catalog.entries.length<12);
 const first=service.read('one',{...readArgs(snapshot),limit:4000});
 assert(JSON.stringify(first).length<=16000);assert(first.truncated);assert(first.nextOffset>0);
 let out=first.text,next=first.nextOffset;
 while(next!==null){const page=service.read('one',{...readArgs(snapshot),offset:next,limit:4000});assert(JSON.stringify(page).length<=16000);out+=page.text;next=page.nextOffset;}
 assert.equal(out,control);
});

test('eviction, oversize and disposal are explicit and never substitute a previous current snapshot',()=>{
 const service=createContextRecall({maxSnapshots:2,maxBytes:5000});
 const first=service.publish('one',rows('first'));
 const other=service.publish('two',rows('second'));
 service.read('one',{action:'catalog'}); // one is recently used
 service.publish('three',rows('third'));
 assert.equal(service.read('two',{action:'catalog',snapshotId:other.snapshotId}).available,false);
 assert.equal(service.read('one',readArgs(first)).text,'first');
 const large=service.publish('one',rows('大'.repeat(10000)));
 assert.equal(large.available,false);assert.equal(large.reason,'snapshot_too_large');assert.deepEqual(large.entries,[]);
 assert.equal(service.read('one',{action:'catalog'}).available,false,'latest failure must not silently expose previous snapshot');
 assert.equal(service.read('one',readArgs(first)).text,'first','explicit older references can still be checked');
 service.forget('one');assert.equal(service.read('one',readArgs(first)).available,false);
 service.dispose();assert.equal(service.read('three',{action:'catalog'}).reason,'disposed');assert.equal(service.publish('x',rows()).available,false);
 assert.equal(createContextRecall({maxBytes:1}).publish('empty',[]).available,false);
});

test('invalid page coordinates and unknown references fail explicitly',()=>{
 const service=createContextRecall(),snapshot=service.publish('one',rows('a🪟b'));
 for(const offset of [-1,0.5,Infinity,99])assert.equal(service.read('one',{...readArgs(snapshot),offset}).status,'invalid_request');
 assert.equal(service.read('one',{...readArgs(snapshot),offset:2}).status,'invalid_request','do not start in middle of surrogate pair');
 for(const limit of [0,0.5,4001])assert.equal(service.read('one',{...readArgs(snapshot),limit}).status,'invalid_request');
 assert.equal(service.read('one',{action:'catalog',offset:90}).status,'invalid_request');
 assert.equal(service.read('one',{action:'catalog',limit:13}).status,'invalid_request');
 assert.equal(service.read('one',{...readArgs(snapshot),itemId:'does-not-exist'}).status,'missing');
 assert.equal(service.read('one',{...readArgs(snapshot),snapshotId:'gone'}).reason,'snapshot_expired');
 assert.equal(service.read('one',{...readArgs(snapshot),version:'bad'}).status,'invalid_request');
 const short=service.read('one',{...readArgs(snapshot),offset:1,limit:1});assert.equal(short.text,'🪟');assert.equal(short.nextOffset,3);
});

test('registered tool binds only to the invoking agent and remains a read-only text interface',()=>{
 const service=createContextRecall(),snapshot=service.publish('private',rows()),tool=service.tool();
 assert.equal(tool.name,'censhu_context_recall');assert.equal(tool.parameters.additionalProperties,false);
 assert.equal(tool.parameters.properties.sessionId,undefined);
 const args=readArgs(snapshot),exec={agent:{session:{id:'private'}}};
 const first=tool.execute(args,exec),again=tool.execute(args,exec);
 assert.deepEqual(JSON.parse(first),JSON.parse(again));assert.equal(JSON.parse(first).text,'实际阶段原文');
 assert.equal(JSON.parse(tool.execute({...args,sessionId:'private'},{agent:{session:{id:'other'}}})).status,'forbidden');
 assert.equal(JSON.parse(tool.execute(args,{})).status,'forbidden');
 assert.match(JSON.parse(first).media,/not proof/);
 assert.deepEqual(tool.output.render({},first),[{type:'text',text:first}]);
});
