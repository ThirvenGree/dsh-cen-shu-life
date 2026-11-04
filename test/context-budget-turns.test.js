import test from 'node:test';
import assert from 'node:assert/strict';
import {roleContextBudget} from '../lib/context-budget.js';

function fixture(){
 let topic='今天出门需要带伞吗',model='fixture-model',history='';
 let diary='旧画原始记录：窗框右下角有一小块未擦掉的铅笔痕。'.repeat(70);
 const required='本轮角色身份必须保留。',weather='今日天气：多云，傍晚可能有小雨。'.repeat(15);
 const inputs=[],agent={session:{id:'turn-fixture',
  requestContext:()=>({provider:'fixture',model,contextWindow:32768}),
  requestHeader:()=>({config:{provider:'fixture',model,maxTokens:2048}}),
  deriveMessages:()=>[{role:'user',content:topic},...(history?[{role:'tool',content:history}]:[])]}};
 const budget=roleContextBudget({plan:input=>{
  inputs.push(structuredClone(input));
  return {reason:'先保留天气，必要时再核对旧画',order:[1],recall:[{id:2,when:'需要比较窗框细节时读取原记录'}],
   allocations:{life:{tokens:1200,reason:'当前天气与取回入口'},inner:{tokens:0,reason:'暂不展开旧画'},agency:{tokens:0,reason:'无额外行动'}}};
 }});
 const assemble=()=>budget.add({contexts:[],sections:[],tools:[]},agent,'contexts','cen-shu-life',[
  {required:true,key:'identity',text:required},{key:'weather:today',text:weather},{owner:'inner',key:'diary:window',text:diary}
 ],'可按需回忆');
 const call=args=>JSON.parse(budget.recallTool().execute(args,{agent}));
 const catalog=()=>{const result=call({action:'catalog'});assert.equal(result.status,'ready');return result;};
 const ref=()=>{const result=catalog();const item=result.entries.find(row=>row.key==='diary:window');return {snapshotId:result.snapshotId,version:result.version,itemId:item.itemId,itemVersion:item.version};};
 const read=(entry,offset=0,limit=4000)=>{const {itemVersion,...args}=entry;const result=call({action:'read',...args,offset,limit});assert.equal(result.status,'ready');return result;};
 const chosen=result=>assert.equal(result.contexts.find(row=>row.name==='cen-shu-life').text,required+'\n'+weather,'recall must not remove model-selected data');
 const hint=result=>result.sections.find(row=>row.name==='censhu-context-recall');
 return {budget,agent,inputs,assemble,call,catalog,ref,read,chosen,hint,
  topic(value){topic=value;},model(value){model=value;},history(value){history=value;},diary(value){diary=value;}};
}

test('unchanged sources and topic reuse a turn plan while harmless new history consumes remaining space',async()=>{
 const f=fixture();
 try{
  f.budget.startTurn(f.agent.session.id,'turn-a');
  const first=await f.assemble();f.chosen(first);assert.ok(f.hint(first));assert.equal(f.inputs.length,1);
  assert.equal(f.budget.status()[0].planReused,false);
  const oldAvailable=f.budget.status()[0].available;
  f.history('只读工具返回了一段很短的结果。'.repeat(20));
  const second=await f.assemble();f.chosen(second);assert.ok(f.hint(second));
  assert.equal(f.inputs.length,1);assert.equal(f.budget.status()[0].planReused,true);
  assert.ok(f.budget.status()[0].available<oldAvailable);
  f.model('different-fixture-model');const changed=await f.assemble();f.chosen(changed);
  assert.equal(f.inputs.length,2);assert.equal(f.budget.status()[0].planReused,false);
 }finally{f.budget.dispose();}
});

test('catalog is not a read; partial and complete reads update cues without another unchanged-step planning call',async()=>{
 const f=fixture();
 try{
  f.budget.startTurn(f.agent.session.id,'turn-read');
  f.chosen(await f.assemble());assert.deepEqual(f.inputs[0].retrieval.readThisTurn,[]);
  const entry=f.ref();f.topic('再看一下天气中的降雨时段');
  const afterCatalog=await f.assemble();f.chosen(afterCatalog);assert.ok(f.hint(afterCatalog));
  assert.equal(f.inputs.length,2);assert.deepEqual(f.inputs.at(-1).retrieval.readThisTurn,[]);
  assert.equal(f.budget.status()[0].recall.read,0);
  const partial=f.read(entry,0,25);assert.equal(partial.truncated,true);assert.equal(partial.nextOffset,25);
  f.topic('窗框的线条和之前一样吗');const afterPartial=await f.assemble();f.chosen(afterPartial);assert.ok(f.hint(afterPartial));
  assert.equal(f.inputs.length,3);
  const evidence=f.inputs.at(-1).retrieval.readThisTurn;
  assert.equal(evidence.length,1);assert.equal(evidence[0].id,2);assert.equal(evidence[0].complete,false);
  assert.equal(evidence[0].readChars,25);assert.deepEqual(evidence[0].ranges,[[0,25]]);
  assert.equal(f.budget.status()[0].recall.read,1);assert.equal(f.budget.status()[0].recall.completed,0);
  const remaining=f.read(entry,25);assert.equal(remaining.truncated,false);
  const afterComplete=await f.assemble();f.chosen(afterComplete);
  assert.equal(f.inputs.length,3,'a successful read should update admission without asking the planner again');
  assert.equal(f.budget.status()[0].planReused,true);assert.equal(f.hint(afterComplete),undefined);
  assert.equal(f.budget.status()[0].recall.cues,0);assert.equal(f.budget.status()[0].recall.completed,1);
 }finally{f.budget.dispose();}
});

test('a source revision and a new turn make the source readable again without inheriting old complete receipts',async()=>{
 const f=fixture();
 try{
  f.budget.startTurn(f.agent.session.id,'turn-before');await f.assemble();
  const old=f.ref();assert.equal(f.read(old).truncated,false);
  assert.equal(f.hint(await f.assemble()),undefined);assert.equal(f.inputs.length,1);
  f.diary('修改后的原始记录：右下角其实是补画的窗扣，旧判断尚需复核。'.repeat(65));
  const revised=await f.assemble();f.chosen(revised);assert.ok(f.hint(revised));assert.equal(f.inputs.length,2);
  assert.deepEqual(f.inputs.at(-1).retrieval.readThisTurn,[]);
  const current=f.ref();assert.notEqual(current.itemVersion,old.itemVersion);assert.notEqual(current.version,old.version);
  f.read(current);assert.equal(f.hint(await f.assemble()),undefined);assert.equal(f.inputs.length,2);
  f.budget.endTurn(f.agent.session.id,'turn-before');f.budget.startTurn(f.agent.session.id,'turn-after');
  const nextTurn=await f.assemble();f.chosen(nextTurn);assert.ok(f.hint(nextTurn));
  assert.equal(f.inputs.length,3);assert.deepEqual(f.inputs.at(-1).retrieval.readThisTurn,[]);
  assert.equal(f.budget.status()[0].planReused,false);assert.equal(f.budget.status()[0].recall.completed,0);
 }finally{f.budget.dispose();}
});

test('implicit unit-test turns also reuse unchanged plans',async()=>{
 const f=fixture();
 try{f.chosen(await f.assemble());f.chosen(await f.assemble());assert.equal(f.inputs.length,1);assert.equal(f.budget.status()[0].planReused,true);}
 finally{f.budget.dispose();}
});

test('planner configuration changes cannot reuse a plan from an enabled or different model',async()=>{
 let enabled=true,model='planner-a',calls=0;
 const agent={session:{id:'planner-scope',requestContext:()=>({model:'role',contextWindow:12000})}};
 const budget=roleContextBudget({planScope:()=>[enabled,model],plan:input=>{
  calls++;if(!enabled)throw Error('disabled');return {reason:model,order:[],recall:[],allocations:Object.fromEntries(['life','inner','agency'].map(k=>[k,{tokens:100,reason:'no optional context'}]))};
 }});
 const assemble=()=>budget.add({contexts:[],sections:[]},agent,'contexts','cen-shu-life',[{text:'optional'}]);
 try{
  await assemble();await assemble();assert.equal(calls,1);
  model='planner-b';await assemble();assert.equal(calls,2);assert.equal(budget.status()[0].planReused,false);
  enabled=false;await assemble();assert.equal(calls,3);assert.equal(budget.status()[0].mode,'local');
 }finally{budget.dispose();}
});
