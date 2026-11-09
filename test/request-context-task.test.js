import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestContext} from '../lib/request-context.js';

const user=(text,source={kind:'user'})=>({role:'user',source,content:[{type:'text',text}]});
const recalls=[
 ['dsh-mnemon','recall'],['dsh-mnemon','instructions'],
 ['plugin:dsh-engram','snapshot'],['plugin:openviking-memory','recall']
];
async function inspectTask(messages){
 const inputs=[];
 const project=createRequestContext({minToolChars:1,plan:async input=>{
  inputs.push(input);return {keepTools:[],keepSkills:[],results:[],reason:'fixture task selection'};
 }});
 try{
  const request={sessionId:'session-task-fixture',provider:'fixture',model:'fixture',messages,tools:[{name:'read_report',description:'Read a report',parameters:{type:'object',properties:{}}}]};
  const original=JSON.stringify(request);
  const output=await project.transform(request);
  assert.equal(JSON.stringify(request),original,'selection must not alter real task or recalled memory');
  assert.equal(inputs.length,1);
  assert.strictEqual(output.messages,messages,'source filtering applies only to planner focus, not evidence delivery');
  return inputs[0];
 }finally{project.dispose();}
}

for(const [kind,form] of recalls)test('trailing '+kind+'/'+form+' does not replace a real user task',async()=>{
 const input=await inspectTask([user('Translate this poem.'),user('Old memory: organize a database.',{kind,form})]);
 assert.equal(input.topic,'Translate this poem.');
 assert.equal(input.taskContext,null,'memory recall must not reclassify a real user request as internal work');
});

test('agency opportunity stays the current task after several memory producers append context',async()=>{
 const input=await inspectTask([
  {role:'system',content:'Current agency instructions.'},
  user('Earlier human question.'),
  user('Consider continuing the unfinished drawing.',{kind:'plugin:dsh-censhu-agency'}),
  ...recalls.map(([kind,form])=>user('Supporting remembered context only.',{kind,form}))
 ]);
 assert.equal(input.topic,'Consider continuing the unfinished drawing.');
 assert.equal(input.taskContext.source,'plugin:dsh-censhu-agency');
 assert.match(input.taskContext.authorization,/not a new user permission/);
 assert.match(input.taskContext.currentInstructions,/Current agency instructions/);
});

test('a user quoting memory markup is a real task; unknown plugin forms are not guessed away',async()=>{
 const quoted='<runtime-memory-snapshot target="memory">Please explain this markup.</runtime-memory-snapshot>';
 assert.equal((await inspectTask([user(quoted)])).topic,quoted);
 const latest=user('An explicit new plugin task.',{kind:'dsh-mnemon',form:'future-task'});
 assert.equal((await inspectTask([user('Earlier user task.'),latest])).topic,'An explicit new plugin task.');
});

const browserTools=['bsk_session','bsk_page','bsk_inspect'].map(name=>({name,description:'Browser action '+name,parameters:{type:'object',properties:{}}}));
async function projectFor(agent,tools){
 let calls=0;
 const project=createRequestContext({minToolChars:1,resolveAgent:()=>agent,plan:async()=>{
  calls++;return {keepTools:[],keepSkills:[],results:[],reason:'fixture scope selection'};
 }});
 try{
  const request={sessionId:'session-scope-fixture',provider:'fixture',model:'fixture',messages:[user('Open the article.')],tools};
  const output=await project.transform(request);
  return {request,output,calls};
 }finally{project.dispose();}
}

for(const [label,agent] of [
 ['agent.parent',{id:'session-scope-fixture',parent:{id:'session-parent'}}],
 ['header.parentSession',{session:{id:'session-scope-fixture',header:{parentSession:'session-parent'}}}],
 ['header.origin=subagent',{session:{id:'session-scope-fixture',header:{origin:'subagent'}}}]
])test('fixed-scope child ('+label+') keeps its request untouched and is not planned',async()=>{
 const {request,output,calls}=await projectFor(agent,browserTools);
 assert.strictEqual(output,request,'tools, messages and helper injection must stay exactly as the host built them');
 assert.equal(calls,0);
 assert.ok(!output.tools.some(tool=>tool.name==='censhu_tool_catalog'));
});

test('a child that was granted the catalog tool is still projected',async()=>{
 const catalog={name:'censhu_tool_catalog',description:'catalog',parameters:{type:'object',properties:{}}};
 const {calls}=await projectFor({id:'session-scope-fixture',parent:{id:'session-parent'}},[...browserTools,catalog]);
 assert.equal(calls,1);
});

test('a top-level session without the catalog tool is still projected',async()=>{
 const {output,calls}=await projectFor({id:'session-scope-fixture'},browserTools);
 assert.equal(calls,1);
 assert.ok(output.tools.some(tool=>tool.name==='censhu_tool_catalog'),'top-level sessions keep the recovery helper');
});

const plainTool=name=>({name,description:'Fixture tool '+name,parameters:{type:'object',properties:{}}});
async function recordFor({agent,tools,keepTools=[],onRecord}){
 const rows=[];
 const project=createRequestContext({minToolChars:1,resolveAgent:()=>agent,onRecord:onRecord||(row=>rows.push(row)),plan:async()=>({keepTools,keepSkills:[],results:[],reason:'fixture record selection'})});
 try{
  const request={sessionId:'session-record-fixture',provider:'fixture',model:'fixture',messages:[user('Secret task text: open the article.')],tools};
  const output=await project.transform(request);
  return {rows,request,output};
 }finally{project.dispose();}
}

test('record lists the declared tools, what was dropped and what was injected, without task text',async()=>{
 const {rows,output}=await recordFor({agent:{id:'session-record-fixture'},tools:['read_report','write_report','send_mail'].map(plainTool),keepTools:['read_report']});
 assert.equal(rows.length,1);
 const row=rows[0];
 assert.equal(row.sessionId,'record-fixture');
 assert.deepEqual(row.selectedTools,output.tools.map(tool=>tool.name));
 assert.ok(row.selectedTools.includes('read_report')&&!row.selectedTools.includes('send_mail'));
 assert.equal(row.toolsOffered,3);
 assert.equal(row.removedTools,2);
 assert.deepEqual([...row.addedTools].sort(),['censhu_tool_catalog','censhu_tool_result_read']);
 assert.equal(row.reason,'fixture record selection');
 assert.ok(!JSON.stringify(row).includes('Secret task text'),'no task text in the record');
});

test('fixed-scope child is recorded as skipped',async()=>{
 const {rows,output,request}=await recordFor({agent:{id:'session-record-fixture',parent:{id:'session-parent'}},tools:browserTools});
 assert.strictEqual(output,request);
 assert.equal(rows.length,1);
 assert.equal(rows[0].mode,'skipped');assert.equal(rows[0].reason,'fixed-scope-child');
 assert.equal(rows[0].selectedTools,null);assert.equal(rows[0].toolsOffered,browserTools.length);
});

test('a failing record sink never breaks the request',async()=>{
 const {output}=await recordFor({agent:{id:'session-record-fixture'},tools:['read_report','send_mail'].map(plainTool),keepTools:['read_report'],onRecord:()=>{throw Error('disk full');}});
 assert.ok(output.tools.some(tool=>tool.name==='read_report'));
});

test('a tool the host removed is not declared again and does not disable selection',async()=>{
 const rows=[];let calls=0;
 const project=createRequestContext({minToolChars:1,resolveAgent:()=>({id:'session-removed-fixture'}),onRecord:row=>rows.push(row),plan:async()=>{calls++;return {keepTools:['read_report'],keepSkills:[],results:[],reason:'fixture removal'};}});
 try{
  const messages=[user('Read the report.'),
   {role:'developer',content:[{type:'tool-addition',toolName:'browser_direct_session'}]},
   {role:'assistant',content:[{type:'tool-call',id:'old-call',name:'browser_direct_session',arguments:{}}]},
   {role:'tool',toolCallId:'old-call',content:'stopped'},
   {role:'developer',content:[{type:'tool-removal',toolName:'browser_direct_session'}]}];
  const request={sessionId:'session-removed-fixture',provider:'fixture',model:'fixture',messages,tools:['read_report','send_mail'].map(plainTool),
   toolHistory:{tools:[plainTool('browser_direct_session')],updates:[]}};
  const output=await project.transform(request);
  assert.equal(calls,1,'selection still runs');
  assert.ok(!output.tools.some(tool=>tool.name==='browser_direct_session'),'removed tool is not re-declared');
  assert.ok(output.tools.some(tool=>tool.name==='read_report'));
  assert.equal(rows.at(-1).mode,'model');
  // Added back later: offered again, so it is a normal candidate.
  const again={...request,messages:[...messages,{role:'developer',content:[{type:'tool-addition',toolName:'browser_direct_session'}]}],tools:[...request.tools,plainTool('browser_direct_session')]};
  const second=await project.transform(again);
  assert.ok(second.tools.some(tool=>tool.name==='browser_direct_session'),'a historical call to an offered tool keeps its definition');
 }finally{project.dispose();}
});

test('locally replayed display turns are not planned',async()=>{
 const rows=[];let calls=0;
 const project=createRequestContext({minToolChars:1,resolveAgent:()=>({id:'session-display-fixture'}),onRecord:row=>rows.push(row),plan:async()=>{calls++;return {keepTools:[],keepSkills:[],results:[],reason:'x'};}});
 try{
  for(const source of [{kind:'censhu-inner-life',displayEntryId:'process:1:abc'},{kind:'censhu-inner-life',executionRequestId:'r1',feature:'inner-core'}]){
   const request={sessionId:'session-display-fixture',provider:'fixture',model:'fixture',tools:['read_report','send_mail'].map(plainTool),
    messages:[user('Earlier life task.'),user('实际运行进程 · 插件运行记录同步',source),user('snapshot',{kind:'runtime-context'})]};
   const output=await project.transform(request);
   assert.strictEqual(output,request);
   assert.equal(rows.at(-1).reason,'local-replay');
  }
  assert.equal(calls,0);
  const live={sessionId:'session-display-fixture',provider:'fixture',model:'fixture',tools:['read_report','send_mail'].map(plainTool),messages:[user('Consider the drawing.',{kind:'plugin:dsh-censhu-agency'})]};
  await project.transform(live);assert.equal(calls,1,'real life turns in the same session are still planned');
 }finally{project.dispose();}
});

test('browser_interest is kept whenever a browser control tool is selected',async()=>{
 const offered=['browser_task','browser_handoff','browser_interest','browser_progress','read_report','send_mail'].map(plainTool);
 const withBrowser=await recordFor({agent:{id:'session-record-fixture'},tools:offered,keepTools:['browser_task']});
 assert.ok(withBrowser.output.tools.some(tool=>tool.name==='browser_task'));
 assert.ok(withBrowser.output.tools.some(tool=>tool.name==='browser_interest'),'interest bound to browser tools');
 const without=await recordFor({agent:{id:'session-record-fixture'},tools:offered,keepTools:['read_report']});
 assert.ok(!without.output.tools.some(tool=>tool.name==='browser_interest'),'not added when no browser tool is selected');
});

test('a shortened browser sync result keeps its context and observation IDs verbatim',async()=>{
 const {default:fs}=await import('node:fs'),{default:os}=await import('node:os'),{default:path}=await import('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'req-originals-'));
 const project=createRequestContext({storeDirectory:directory,minToolChars:1,minResultChars:1000,resolveAgent:()=>({id:'session-sync-fixture'}),
  plan:async input=>({keepTools:[],keepSkills:[],results:input.results.map(row=>({id:row.id,mode:'reference',outcome:'data',ranges:[],criticalRanges:[],reason:'按需读原文'})),reason:'fixture'})});
 try{
  const sync=JSON.stringify({activity:[],context_id:'ctx-5625e74c',control_policy:'target',observation_id:'obs-4ea6b6a3',page:'页面文字'.repeat(400)});
  const plain='普通工具输出'.repeat(300);
  const messages=[user('看看 APOD'),
   {role:'assistant',content:[{type:'tool-call',id:'c1',name:'browser_direct_session',arguments:{action:'sync'}},{type:'tool-call',id:'c2',name:'read_report',arguments:{}}]},
   {role:'tool',toolCallId:'c1',content:[{type:'text',text:sync}]},
   {role:'tool',toolCallId:'c2',content:[{type:'text',text:plain}]}];
  const output=await project.transform({sessionId:'session-sync-fixture',provider:'fixture',model:'fixture',messages,tools:['browser_direct_session','read_report'].map(plainTool)});
  const syncText=output.messages[2].content[0].text,plainText=output.messages[3].content[0].text;
  assert.ok(syncText.length<sync.length,'sync result was shortened');
  assert.match(syncText,/【同步授权（原样保留）】context_id=ctx-5625e74c observation_id=obs-4ea6b6a3/);
  assert.doesNotMatch(plainText,/同步授权/,'other results get no authorization line');
 }finally{project.dispose();}
});

test('recall without any task does not fabricate one',async()=>{
 const input=await inspectTask(recalls.map(([kind,form])=>user('Supporting memory only.',{kind,form})));
 assert.equal(input.topic,'');assert.equal(input.taskContext,null);
});
