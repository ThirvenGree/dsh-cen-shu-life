import test from 'node:test';
import assert from 'node:assert/strict';
import {roleContextBudget} from '../lib/context-budget.js';
const agent=window=>({session:{id:'fixture',requestContext:()=>({contextWindow:window,model:'model'}),requestHeader:()=>({config:{model:'model',maxTokens:2048}}),deriveMessages:()=>[{role:'user',content:[{type:'text',text:'current request'}]}]}});
const start={sections:[{name:'cosplay',text:'canonical identity'}],contexts:[{name:'other',text:'foreign section'}],tools:[{name:'read',parameters:{type:'object'}}]};
test('shared cap keeps protected identity/handoff, deduplicates by source and leaves recoverable references',()=>{
 const budget=roleContextBudget(),a=agent(8192),life=[{key:'life:event:aa:step',priority:83,text:'event aa phase step'},{text:'private diary'.repeat(2000)}],agency=[{key:'life:event:aa:step',priority:46,text:'duplicate event'},{required:true,text:'reviewed action'}];
 const apply=(v,k)=>k==='life'?budget.add(v,a,'contexts','cen-shu-life',life,'use life tool'):budget.add(v,a,'sections','censhu-agency-current',agency,'use agency tool');
 for(const order of [['life','agency'],['agency','life']]){
  const v=order.reduce(apply,start);
  assert.equal(v.sections.find(c=>c.name==='cosplay').text,'canonical identity');assert.deepEqual(v.tools,start.tools);
  const result=JSON.stringify(v);assert.match(result,/event aa phase step/);assert.match(result,/reviewed action/);assert.match(result,/use life tool/);
  assert.doesNotMatch(result,/duplicate event|private diary/);
 }
 assert.equal(start.contexts.length,1);assert.equal(budget.status()[0].window,8192);assert.ok(budget.status()[0].used<=budget.status()[0].limit);
});
test('tool or history pressure shrinks optional budget; mandatory requirements survive, accounting never exposes content',()=>{
 const budget=roleContextBudget(),a=agent(8192);
 const v=budget.add({...start,tools:[{description:'参数'.repeat(6200)}]},a,'sections','agency-contact-once',[{required:true,text:'approved private message'},{text:'optional'}]);
 assert.match(v.sections.at(-1).text,/approved private message/);assert.doesNotMatch(v.sections.at(-1).text,/optional/);
 budget.observe({sessionId:'foreign',messages:[]});
 budget.observe({sessionId:'fixture',model:'model',messages:[{role:'system',content:'identity'},{role:'user',source:{kind:'runtime-context',sections:[{name:'memory:snapshot',text:'private data'}]},content:[{type:'text',text:'private data'}]}],tools:start.tools});
 const row=budget.status()[0];assert.equal(row.limit,0);assert.ok(row.overBudget>0);assert.ok(row.request.runtime>0);assert.ok(row.request.sections['memory:snapshot']>0);assert.doesNotMatch(JSON.stringify(row),/private data|approved private/);
});
