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
test('honours full reply reservation, limits optional output and defers capacity pressure to existing compaction',async()=>{
 const b=roleContextBudget({plan:input=>decision(input,input.candidates.filter(r=>!r.required).map(r=>r.id),[999999,999999,10])});
 await b.add(base,agent(10000,'事项','a',7500),'contexts','cen-shu-life',[parts[0],{text:'案'.repeat(3000)}]);
 const row=b.status()[0];assert.equal(row.reserve,7500);assert.ok(row.used<=row.available&&row.limit<=row.available);assert.equal(row.byOwner.life.kept,1);
 const pressured=await b.add({...base,tools:[{description:'文'.repeat(10000)}]},agent(8192),'contexts','cen-shu-life',parts);
 assert.match(pressured.contexts.at(-1).text,/本轮必须保留/);assert.doesNotMatch(pressured.contexts.at(-1).text,/天气|独处日记/);
 assert.equal(b.status()[0].blocked,false);assert.equal(b.status()[0].pressure.state,'awaiting-compaction');assert.equal(b.status()[0].pressure.cause,'non-compressible');
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

test('omitted temporary observations have exact paginated receipts and model-selected recall cues',async()=>{
 const a=agent(32768,'画上的窗扣');
 const observation='【临时观察】旧窗扣右侧缺一颗螺钉。'+'原文细节'.repeat(500);
 const budget=roleContextBudget({plan:input=>({...decision(input,[],[800,0,0]),recall:[{id:1,when:'比较窗扣时核对原文，不凭简短摘要补全'}]})});
 const output=await budget.add(base,a,'contexts','cen-shu-life',[parts[0],{owner:'inner',key:'observation:window',text:observation}]);
 const state=budget.status()[0],manifest=output.sections.find(s=>s.name==='censhu-context-recall');
 assert.equal(state.recall.available,true);assert.equal(state.recall.cues,1);assert.match(manifest.text,/比较窗扣时核对原文/);
 assert.doesNotMatch(JSON.stringify(output),/右侧缺一颗螺钉/);
 const tool=budget.recallTool(),run=args=>JSON.parse(tool.execute(args,{agent:a}));
 const catalog=run({action:'catalog',snapshotId:state.recall.snapshotId,version:state.recall.version});
 const item=catalog.entries.find(e=>e.key==='observation:window');assert(item);assert.equal(item.selected,false);
 let offset=0,joined='';
 do {const page=run({action:'read',snapshotId:state.recall.snapshotId,version:state.recall.version,itemId:item.itemId,offset,limit:400});assert.equal(page.status,'ready');joined+=page.text;offset=page.nextOffset;}while(offset!==null);
 assert.equal(joined,observation);assert.equal(run({action:'catalog',snapshotId:'missing',version:state.recall.version}).available,false);
 assert.doesNotMatch(JSON.stringify(budget.status()),/右侧缺一颗螺钉/);
 budget.dispose();assert.equal(run({action:'catalog'}).available,false);
});

test('pressure still records an exact snapshot without injecting an unfunded pointer',async()=>{
 const a=agent(8192);a.session.deriveMessages=()=>[{role:'tool',content:'超长工具结果'.repeat(2000)}];
 let plans=0;const budget=roleContextBudget({plan:()=>{plans++;throw Error('not needed');}});
 const result=await budget.add(base,a,'contexts','cen-shu-life',parts);
 assert.equal(plans,0);assert.equal(budget.status()[0].pressure.state,'awaiting-compaction');
 assert.equal(result.sections.some(s=>s.name==='censhu-context-recall'),false);
 const catalog=JSON.parse(budget.recallTool().execute({action:'catalog'},{agent:a}));
 assert.equal(catalog.status,'ready');assert.equal(catalog.entries.length,parts.length);
 budget.observe({sessionId:a.session.id,model:'model',messages:[{role:'user',content:'压缩后的历史'}],tools:[]});
 assert.equal(budget.status()[0].pressure.state,'request-observed');
});

test('retrieval hints obey the model total and duplicate mandatory keys do not cause false pressure',async()=>{
 for(const quota of [10,100,500]){
  const budget=roleContextBudget({plan:input=>decision(input,[],[quota,0,0])});
  await budget.add(base,agent(),'contexts','cen-shu-life',parts);
  const status=budget.status()[0];assert.ok(status.used<=status.limit);assert.ok(status.used<=status.available);
 }
 let calls=0;const budget=roleContextBudget({plan:input=>{calls++;assert.equal(input.requiredBy.life,4001);return decision(input,[],[6000,0,0]);}});
 await budget.add(base,agent(8192),'contexts','cen-shu-life',[{key:'same-event',required:true,text:'必'.repeat(4000)},{key:'same-event',required:true,text:'必'.repeat(4000)},{text:'其他观察'}]);
 assert.equal(calls,1);assert.equal(budget.status()[0].pressure,null);assert.equal(budget.status()[0].byOwner.life.kept,1);
});
