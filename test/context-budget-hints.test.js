import test from 'node:test';
import assert from 'node:assert/strict';
import {roleContextBudget,estimateText} from '../lib/context-budget.js';

const required='必须保留当前角色身份。';
const weather='今日大理天气资料：'+ '下午多云，出门带伞。'.repeat(50);
const diary='昨天看旧画的私人记录：'+ '窗框右下角的铅笔线尚未核实。'.repeat(100);
const when='需要比较旧画的窗框细节时再读原记录';
const offered=[{required:true,text:required},{key:'weather:today',text:weather},{owner:'inner',key:'diary:window',text:diary}];
const selectedCost=estimateText(required)+estimateText(weather)+2;
const agent={session:{id:'hint-selection-test',requestContext:()=>({model:'fixture',contextWindow:32768}),requestHeader:()=>({config:{model:'fixture',maxTokens:2048}}),deriveMessages:()=>[{role:'user',content:'下午出门要带伞吗？'}]}};
const base=()=>({contexts:[],sections:[],tools:[]});
function plan(input,extra,recall){
 return {reason:'本轮先回答天气，旧画是否需要回看另行决定。',order:[1],recall,
  allocations:{life:{tokens:selectedCost+extra,reason:'保留完整天气资料'},inner:{tokens:0,reason:'本轮不展开旧画'},agency:{tokens:0,reason:'没有主动任务'}}};
}
const hint=result=>result.sections.find(row=>row.name==='censhu-context-recall');
function assertWeather(budget,result){
 const text=result.contexts.find(row=>row.name==='cen-shu-life').text;
 assert.equal(text,required+'\n'+weather,'a recall pointer must not evict model-selected weather');
 assert.equal(budget.status()[0].byOwner.life.kept,2);
 const catalog=JSON.parse(budget.recallTool().execute({action:'catalog'},{agent}));
 assert.equal(catalog.entries.find(row=>row.key==='weather:today').selected,true);
 assert.equal(catalog.entries.find(row=>row.key==='diary:window').selected,false);
}

test('an explicit empty recall selection preserves chosen weather without injecting a generic catalog',async()=>{
 const budget=roleContextBudget({plan:input=>plan(input,10,[])});
 try{
  const result=await budget.add(base(),agent,'contexts','cen-shu-life',offered,'可按需回忆');
  assertWeather(budget,result);
  const status=budget.status()[0];
  assert.equal(hint(result),undefined);assert.equal(status.recall.pointerIncluded,false);
  assert.equal(status.recall.cues,0);assert.equal(status.hintTokens,0);assert.equal(status.used,selectedCost);
 }finally{budget.dispose();}
});

test('when only a bare catalog fits, keep selected weather and omit the entire pointer-plus-cue package',async()=>{
 const budget=roleContextBudget({plan:input=>plan(input,input.retrieval.minimumHintTokens+5,[{id:2,when}])});
 try{
  const result=await budget.add(base(),agent,'contexts','cen-shu-life',offered,'可按需回忆');
  assertWeather(budget,result);
  const status=budget.status()[0];
  assert.equal(hint(result),undefined,'do not leave a generic pointer when its chosen cue cannot fit');
  assert.equal(status.recall.pointerIncluded,false);assert.equal(status.recall.cues,0);
  assert.equal(status.hintTokens,0);assert.equal(status.used,selectedCost);
  assert.ok(status.used<=status.limit);
 }finally{budget.dispose();}
});

test('a compact pointer is admitted only together with a funded omitted-item cue, and all overhead is counted',async()=>{
 const budget=roleContextBudget({plan:input=>plan(input,input.retrieval.minimumHintTokens+90,[{id:2,when}])});
 try{
  const result=await budget.add(base(),agent,'contexts','cen-shu-life',offered,'可按需回忆');
  assertWeather(budget,result);
  const section=hint(result),status=budget.status()[0];assert.ok(section);
  assert.match(section.text,/^【按需原文】/,'use the complete model-selected recall package without generic instructions');
  assert.equal(section.text.split('\n').length,1);
  const packet=JSON.parse(section.text.slice('【按需原文】'.length));
  assert.equal(packet.tool,'censhu_context_recall');assert.equal(packet.snapshotId,status.recall.snapshotId);assert.equal(packet.version,status.recall.version);
  assert.equal(packet.recall.length,1);const cue=packet.recall[0];assert.equal(cue.when,when);assert.ok(cue.itemId);assert.equal(cue.source,undefined);
  assert.equal(status.recall.pointerIncluded,true);assert.equal(status.recall.cues,1);
  assert.equal(status.hintTokens,estimateText(section.text)+1);
  assert.equal(status.used,selectedCost+status.hintTokens);assert.ok(status.used<=status.limit&&status.used<=status.available);
  const catalog=JSON.parse(budget.recallTool().execute({action:'catalog'},{agent}));
  assert.equal(cue.itemId,catalog.entries.find(row=>row.key==='diary:window').itemId);
 }finally{budget.dispose();}
});

test('a cue for already selected weather does not leave an unrelated generic reminder for an omitted diary',async()=>{
 const budget=roleContextBudget({plan:input=>plan(input,1000,[{id:1,when:'需要天气原文时再读'}])});
 try{
  const result=await budget.add(base(),agent,'contexts','cen-shu-life',offered,'可按需回忆');
  assertWeather(budget,result);
  const status=budget.status()[0];assert.equal(hint(result),undefined);
  assert.equal(status.recall.cues,0);assert.equal(status.recall.pointerIncluded,false);
  assert.equal(status.used,selectedCost);assert.equal(status.hintTokens,0);
 }finally{budget.dispose();}
});
