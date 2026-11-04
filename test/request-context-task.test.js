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

test('recall without any task does not fabricate one',async()=>{
 const input=await inspectTask(recalls.map(([kind,form])=>user('Supporting memory only.',{kind,form})));
 assert.equal(input.topic,'');assert.equal(input.taskContext,null);
});
