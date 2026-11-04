import test from 'node:test';
import assert from 'node:assert/strict';
import {applyExpressionEdits,reviewReplyStream,replySurface,installReplyExpression} from '../lib/reply-expression.js';
const text='这件事急不来，明天再看。';
const chunks=[{type:'block-start',index:0,blockType:'text'},{type:'text-delta',index:0,text},{type:'block-end',index:0,block:{type:'text',text}},{type:'usage',usage:{inputTokens:20,outputTokens:10}},{type:'finish',reason:{kind:'stop'},replayState:{private:'provider'}}];
const stream=async function*(rows=chunks){yield* rows;};
const edit={reason:'使用常见搭配',edits:[{index:0,quote:'急不来',replacement:'急不得'}]};
const collect=async s=>{const rows=[];for await(const c of s)rows.push(c);return rows;};
test('no text escapes before review; deltas, final history and voice see identical text',async()=>{
 let release,reviewed=false;const waiting=new Promise(r=>release=r),records=[];
 const iterator=reviewReplyStream(stream(),{}, {surface:'pet',record:r=>records.push(r),review:async()=>{await waiting;reviewed=true;return edit;}});
 let yielded=false;const first=iterator.next().then(r=>{yielded=true;return r;});await new Promise(setImmediate);assert.equal(yielded,false);
 release();const rows=[(await first).value,...await collect(iterator)];assert.equal(reviewed,true);
 assert.equal(rows.find(c=>c.type==='text-delta').text,text.replace('急不来','急不得'));
 assert.equal(rows.find(c=>c.type==='block-end').block.text,rows.find(c=>c.type==='text-delta').text);
 assert.equal(rows.at(-1).replayState,undefined);assert.equal(records[0].changed,true);
});
test('tool arguments and media are never edited; no-text tool call does not request review',async()=>{
 const tool={type:'block-end',index:1,block:{type:'tool-call',name:'file',arguments:{text:'急不来'}}};
 const source=[tool,{type:'usage',usage:{}},{type:'finish',reason:{kind:'tool-calls'}}];
 const rows=await collect(reviewReplyStream(stream(source),{}, {record:()=>{},review:()=>assert.fail()}));assert.deepEqual(rows,source);
 const mixed=await collect(reviewReplyStream(stream([tool,...chunks]),{}, {record:()=>{},review:async()=>edit}));assert.deepEqual(mixed[0],tool);
});
test('invalid edit, failure, cancellation and incomplete generation never leak draft or actions',async()=>{
 for(const review of [async()=>{throw Error('unavailable');},async()=>({reason:'bad',edits:[{index:0,quote:'不存在',replacement:'x'}]})]){
  const rows=await collect(reviewReplyStream(stream(),{}, {record:()=>{},review}));assert.deepEqual(rows.map(r=>r.type),['usage','finish']);assert.equal(rows.at(-1).reason.kind,'error');
 }
 const controller=new AbortController();const rows=await collect(reviewReplyStream(stream(),{}, {signal:controller.signal,record:()=>{},review:async()=>{controller.abort();return edit;}}));assert.equal(rows.at(-1).reason.kind,'aborted');assert.ok(!rows.some(r=>r.type==='text-delta'));
 const failed=await collect(reviewReplyStream(stream(chunks.slice(0,-1)),{}, {record:()=>{},review:()=>assert.fail()}));assert.equal(failed.at(-1).reason.kind,'error');
});
test('protocol tags, numbers and code are protected; overlapping and ambiguous edits rejected',()=>{
 for(const original of ['12:30','https://example.com','[图:猫]','<pet-task>{"seconds":60}</pet-task>','`code`'])assert.throws(()=>applyExpressionEdits([{index:0,text:original}],{reason:'bad',edits:[{index:0,quote:original,replacement:'other'}]}));
 assert.throws(()=>applyExpressionEdits([{index:0,text:'哈哈哈哈'}],{reason:'bad',edits:[{index:0,quote:'哈哈',replacement:'好'}]}));
 assert.deepEqual([...applyExpressionEdits([{index:0,text}],{reason:'自然',edits:[]})],[[0,text]]);
});
test('Pet and desktop are in scope, private life and unknown background calls are not',()=>{
 const engine={read:()=>({sessionId:'session-life'})};const agents=[{session:{id:'session-desk'}},{session:{id:'session-life'}},{session:{id:'child',header:{parentSession:'session-desk'}}}];
 const ctx={agents:{list:()=>agents}};
 assert.equal(replySurface({sessionId:'dsh-pet'},ctx,engine),'pet');assert.equal(replySurface({sessionId:'session-desk'},ctx,engine),'desktop');
 for(const id of ['session-life','child','unknown'])assert.equal(replySurface({sessionId:id},ctx,engine),null);
});
test('shared hook calls next once, fixes Argon independently of semantic model and stops after unload',async()=>{
 let hook,calls=0,judgeCalls=0;const writes=[];const engine={config:{semanticModel:'other'},read:()=>({items:[]}),write:(name,data)=>writes.push({name,data})};
 const off=installReplyExpression({on(_event,fn){hook=fn;return()=>{};}},engine,{judge:async(_p,_s,input,cfg)=>{judgeCalls++;assert.equal(cfg.semanticModel,'gemini-4-argon');assert.equal(input.surface,'pet');return edit;}});
 await collect(hook({sessionId:'dsh-pet',messages:[]},()=>{calls++;return stream();}));assert.equal(calls,1);assert.equal(judgeCalls,1);assert.equal(writes.length,1);
 off();await collect(hook({sessionId:'dsh-pet'},()=>stream()));assert.equal(judgeCalls,1);assert.equal(writes.length,1);
});
