import test from 'node:test';
import assert from 'node:assert/strict';
import {roleContextBudget,estimateText} from '../lib/context-budget.js';
const agent=(window=32768,topic='翻看之前的日记',id='fixture',maxTokens=2048)=>({session:{id,requestContext:()=>({contextWindow:window,model:'model'}),requestHeader:()=>({config:{model:'model',maxTokens}}),deriveMessages:()=>[{role:'user',content:topic}]}});
const base={sections:[{name:'cosplay',text:'身份'}],contexts:[{name:'unrelated',text:'其他插件'}],tools:[{name:'read'}]};
const parts=[{text:'本轮必须保留',required:true},{text:'天气',priority:95},{text:'独处日记',priority:10,owner:'inner',key:'diary:1'}];
function decision(input,ids,allocations=[500,500,500]){
 return {reason:'按当前问题选择',order:ids,allocations:Object.fromEntries(['life','inner','agency'].map((k,i)=>[k,{tokens:allocations[i],reason:'本轮需要 '+k}]))};
}
function chain(b,a,reverse=false,life=parts){
 const g1=next=>b.assemble(a,next,assembled=>b.add(assembled,a,'contexts','cen-shu-life',life,'可回忆'));
 const g2=next=>b.assemble(a,next,assembled=>b.add(assembled,a,'sections','censhu-agency-current',[{text:'活动',owner:'agency'},{text:'重复日记',owner:'inner',key:'diary:1'}],'可展开'));
 return reverse?g2(()=>g1(()=>base)):g1(()=>g2(()=>base));
}
test('one plan jointly ranks all three sources, independent of listener order, and includes a per-source explanation',async()=>{
 for(const reverse of [false,true]){
  let calls=0;
  const b=roleContextBudget({plan:input=>{calls++;assert.deepEqual(new Set(input.candidates.map(r=>r.source)),new Set(['life','inner','agency']));assert.equal(input.topic,'翻看之前的日记');return decision(input,['独处日记','重复日记','活动'].map(s=>input.candidates.find(r=>r.excerpt===s).id),[12,100,100]);}});
  const result=await chain(b,agent(),reverse);assert.equal(calls,1);assert.match(JSON.stringify(result),/独处日记/);assert.doesNotMatch(JSON.stringify(result),/重复日记|天气/);assert.deepEqual(result.tools,base.tools);assert.equal(result.sections[0].text,'身份');
  const row=b.status()[0];assert.equal(row.mode,'model');assert.equal(row.byOwner.inner.kept,1);assert.equal(row.byOwner.agency.kept,1);assert.match(row.detail,/本轮需要 inner/);assert.doesNotMatch(JSON.stringify(row),/独处日记|翻看之前/);
 }
});
test('a change of topic changes allocation; valid plan can exceed the former 8000 token cap',async()=>{
 const b=roleContextBudget({plan:input=>input.topic==='细读'?decision(input,[1],[50,18000,0]):decision(input,[],[50,0,0])});
 const data=[parts[0],{owner:'inner',text:'原文'.repeat(6500)}];
 for(const topic of ['细读','闲聊']){
  const result=await b.add(base,agent(180000,topic),'contexts','cen-shu-life',data);
  assert.equal(result.contexts.at(-1).text.includes('原文'),topic==='细读');assert.equal(b.status()[0].byOwner.inner.requested,topic==='细读'?18000:0);
 }
});
test('honours full reply reservation, limits optional output, reports an impossible required context without submitting it',async()=>{
 const b=roleContextBudget({plan:input=>decision(input,input.candidates.filter(r=>!r.required).map(r=>r.id),[999999,999999,10])});
 await b.add(base,agent(10000,'事项','a',7500),'contexts','cen-shu-life',[parts[0],{text:'案'.repeat(3000)}]);
 const row=b.status()[0];assert.equal(row.reserve,7500);assert.ok(row.used<=row.available&&row.limit<=row.available);assert.equal(row.byOwner.life.kept,1);
 await assert.rejects(()=>b.add({...base,tools:[{description:'文'.repeat(10000)}]},agent(8192),'contexts','cen-shu-life',parts),/回复预留/);assert.equal(b.status()[0].blocked,true);
});
test('outage backs off and retains representatives, then recovers; wrong route never authorizes optional context',async()=>{
 let calls=0,t=10000;
 const b=roleContextBudget({now:()=>t,plan:input=>{calls++;if(calls===1)throw Object.assign(Error('HTTP 402'),{httpStatus:402});return decision(input,[]);}});
 await b.add(base,agent(),'contexts','cen-shu-life',parts);await b.add(base,agent(),'contexts','cen-shu-life',parts);assert.equal(calls,1);assert.equal(b.status()[0].byOwner.inner.kept,1);assert.match(b.status()[0].reason,/402/);
 t+=300001;await b.add(base,agent(),'contexts','cen-shu-life',parts);assert.equal(b.status()[0].mode,'model');
 await b.add(base,agent(),'contexts','cen-shu-life',parts,null,null,{route:{model:'different'}});assert.equal(b.status()[0].windowSource,'unknown');assert.equal(b.status()[0].byOwner.inner.kept,0);
});
test('invalid planning ids fall back; public telemetry never includes source texts',async()=>{
 const b=roleContextBudget({plan:input=>decision(input,[9001])});
 await chain(b,agent());assert.match(b.status()[0].reason,/无效/);
 b.observe({sessionId:'fixture',model:'model',messages:[{role:'user',source:{kind:'runtime-context',sections:[{name:'memory',text:'private text'}]},content:'private text'}]});b.recordUsage('fixture',{inputTokens:77});
 assert.equal(b.status()[0].request.reported.inputTokens,77);assert.doesNotMatch(JSON.stringify(b.status()),/private text/);assert.ok(estimateText('预算')>0);
});
test('a history append while planning consumes the available space before admission',async()=>{
 let chat='原问题';
 const a=agent(10000);a.session.deriveMessages=()=>[{role:'user',content:chat}];
 const budget=roleContextBudget({plan:input=>{chat+='字'.repeat(7600);return decision(input,[1],[10000,0,0]);}});
 await budget.add(base,a,'contexts','cen-shu-life',[parts[0],{text:'事'.repeat(800)}]);
 const row=budget.status()[0];assert.equal(row.byOwner.life.kept,1);assert.ok(row.available<800&&row.used<=row.available);assert.match(row.detail,/按窗口裁剪/);
});
