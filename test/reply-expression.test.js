import test from 'node:test';
import assert from 'node:assert/strict';
import {applyExpressionEdits,reviewReplyStream as rawReviewReplyStream,replySurface,installReplyExpression} from '../lib/reply-expression.js';
const reviewReplyStream=(stream,request,options)=>rawReviewReplyStream(stream,request,{refine:async()=>edit,...options});
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
test('desktop is in scope; Pet, private life and unknown background calls are not',()=>{
 const engine={read:()=>({sessionId:'session-life'})};const agents=[{session:{id:'session-desk'}},{session:{id:'session-life'}},{session:{id:'child',header:{parentSession:'session-desk'}}}];
 const ctx={agents:{list:()=>agents}};
 // 2026-11-07: Pet (text, realtime voice, whispers) is no longer expression-reviewed.
 assert.equal(replySurface({sessionId:'dsh-pet'},ctx,engine),null);assert.equal(replySurface({sessionId:'session-desk'},ctx,engine),'desktop');
 for(const id of ['session-life','child','unknown'])assert.equal(replySurface({sessionId:id},ctx,engine),null);
});
test('shared hook calls next once, fixes Argon independently of semantic model and stops after unload',async()=>{
 let hook,calls=0,judgeCalls=0;const writes=[];const engine={config:{semanticModel:'other'},read:()=>({items:[]}),write:(name,data)=>writes.push({name,data})};
 const off=installReplyExpression({agents:{list:()=>[{session:{id:'session-desk'}}]},llm:{stream:()=>stream([{type:'text-delta',index:0,text:JSON.stringify(edit)},{type:'finish',reason:{kind:'stop'}}])},on(_event,fn){hook=fn;return()=>{};}},engine,{judge:async(_p,_s,input,cfg)=>{judgeCalls++;assert.equal(cfg.semanticModel,'gemini-4-argon');assert.equal(input.surface,'desktop');return edit;}});
 await collect(hook({sessionId:'session-desk',messages:[]},()=>{calls++;return stream();}));assert.equal(calls,1);assert.equal(judgeCalls,1);assert.equal(writes.length,1);
 // Pet output passes straight through: no Gemini call, no review record.
 let petCalls=0;await collect(hook({sessionId:'dsh-pet',messages:[]},()=>{petCalls++;return stream();}));assert.equal(petCalls,1);assert.equal(judgeCalls,1);assert.equal(writes.length,1);
 off();await collect(hook({sessionId:'session-desk'},()=>stream()));assert.equal(judgeCalls,1);assert.equal(writes.length,1);
});

test('role may reject Argon example and preserve original',async()=>{
 const rows=await collect(rawReviewReplyStream(stream(),{}, {record:()=>{},review:async()=>edit,refine:async()=>({reason:'保留',edits:[]})}));assert.equal(rows.find(x=>x.type==='text-delta').text,text);
});
test('missing role refinement never applies Argon example',async()=>{
 const rows=await collect(rawReviewReplyStream(stream(),{}, {record:()=>{},review:async()=>edit}));assert.equal(rows.at(-1).reason.kind,'error');assert.ok(!rows.some(x=>x.type==='text-delta'));
});

test('QQ and desktop/Pet share complete clarity principles exactly once',async()=>{
 const {commonExpressionClarity,groundingPrompt}=await import('../lib/qq-grounding.js');
 const {expressionPrompt}=await import('../lib/reply-expression.js');
 for(const prompt of [groundingPrompt,expressionPrompt]){
  assert.ok(prompt.includes(commonExpressionClarity));
  assert.equal(prompt.split('【通用表达清晰原则】').length-1,1);
  assert.ok(prompt.includes('主语和谓语之间不要插入过多修饰'));
  assert.ok(prompt.includes('完整保留原文的事实、限定条件和不确定性'));
 }
});

test('advice has no rewritten text; role repairs invalid output once and preserves real block index',async()=>{
 const {validateExpressionAdvice}=await import('../lib/reply-expression.js');
 const advice=validateExpressionAdvice([{index:7,text}],edit);
 assert.equal(advice.edits[0].replacement,undefined);
 let calls=0;
 const records=[];
 const rows=await collect(rawReviewReplyStream(stream(chunks.map(c=>c.index===0?{...c,index:7}:c)),{}, {record:r=>records.push(r),review:async()=>edit,refine:async()=>{if(++calls===1)throw Error('invalid JSON');return edit;}}));
 assert.equal(calls,2);assert.equal(rows.at(-1).reason.kind,'stop');
 assert.equal(rows.find(c=>c.type==='text-delta').text,text.replace('急不来','急不得'));
 assert.equal(records[0].stage,'role-refinement');
});

test('title generation is not a conversational reply',()=>{assert.equal(replySurface({purpose:'session-title',sessionId:'dsh-pet'}, {}, {}),null);});

test('provider failure remains a provider failure and cannot leak an unfinished draft',async()=>{
 const finish={type:'finish',reason:{kind:'error',failure:{code:'PROVIDER_FAILED',message:'upstream failed'}}};
 const rows=await collect(rawReviewReplyStream(stream([...chunks.slice(0,-1),finish]),{}, {record:()=>{},review:()=>assert.fail()}));
 assert.deepEqual(rows.at(-1),finish);assert.ok(!rows.some(r=>r.type==='text-delta'));
});

test('Argon alternatives survive as advice, never as applied role wording',async()=>{
 const {validateExpressionAdvice}=await import('../lib/reply-expression.js');
 const advice={...edit,edits:[{...edit.edits[0],alternatives:[{meaning:'不能催快',text:'急不得'}]}]};
 const parsed=validateExpressionAdvice([{index:0,text}],advice);
 assert.equal(parsed.edits[0].alternatives[0].text,'急不得');assert.equal(parsed.edits[0].replacement,undefined);
 const rows=await collect(rawReviewReplyStream(stream(),{}, {record:()=>{},review:async()=>advice,refine:async({advice:a})=>{assert.equal(a.edits[0].alternatives.length,1);return {reason:'自己决定保留',edits:[]};}}));
 assert.equal(rows.find(r=>r.type==='text-delta').text,text);
});
// 2026-11-07: template-pattern checklist (from Humanizer-zh) reaches both QQ and desktop review once, as clues with keep-rules.
test('QQ and desktop review share the template-pattern checklist exactly once',async()=>{
 const {commonExpressionPatterns,groundingPrompt}=await import('../lib/qq-grounding.js');
 const {expressionPrompt}=await import('../lib/reply-expression.js');
 for(const prompt of [groundingPrompt,expressionPrompt]){
  assert.equal(prompt.split('【常见模板化表达检查】').length-1,1);
  assert.ok(prompt.includes(commonExpressionPatterns));
 }
 assert.ok(commonExpressionPatterns.includes('不是禁词表'));
 assert.ok(commonExpressionPatterns.includes('没有问题就保留原文'));
 assert.ok(commonExpressionPatterns.includes('不为显得具体而补造细节'));
 assert.ok(commonExpressionPatterns.length<800);
});
