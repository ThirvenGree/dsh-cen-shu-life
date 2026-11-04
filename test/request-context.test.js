import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequestContext,requestPlanSchema,requestSchemaFor} from '../lib/request-context.js';
import {createRequestOriginals} from '../lib/request-originals.js';

function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const part of Object.values(value))freeze(part);}return value;}
const definition=name=>({name,description:'工具用途 '+name,parameters:{type:'object',properties:{input:{type:'string',description:'完整定义 '.repeat(200)}}}});
const messages=(text='资料'.repeat(4000))=>[
 {role:'user',content:[{type:'text',text:'核对本次数据'}]},
 {role:'assistant',content:[{type:'tool-call',id:'call-a',name:'read_report',arguments:{input:'report'}}]},
 // Installed @deepseek-ai/dsh-llm createToolResultMessage() and agent-loop
 // appendToolResult() publish this tool-role shape, not user tool-result blocks.
 {role:'tool',id:'msg-a',source:{kind:'tool',callId:'call-a'},toolCallId:'call-a',isError:false,content:[{type:'text',text}]}
];
function fixture(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'request-context-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let callCount=0,lastInput;
 const agent={session:{id:'session-fixture'}},project=createRequestContext({storeDirectory:directory,resolveAgent:()=>agent,minToolChars:1000,minResultChars:1000,plan:async input=>{callCount++;lastInput=input;return {keepTools:input.toolsSelectionNeeded?['search_next']:[],results:input.results.map(row=>({id:row.id,mode:'reference',outcome:'data',ranges:[],criticalRanges:[],reason:'按需读原文'})),reason:'模型按任务选择'};},...options});
 t.after(()=>project.dispose());
 const registered=project.tools(),tools=[definition('read_report'),definition('search_next'),definition('unused_one'),definition('unused_two'),...registered.map(({name,description,parameters})=>({name,description,parameters}))];
 const request={sessionId:'session-fixture',provider:'fixture',model:'test-model',messages:messages(),tools};
 return {directory,agent,project,request,tools,registered,calls:()=>callCount,input:()=>lastInput};
}
const pointer=text=>JSON.parse(text.split('【工具结果原文】').at(-1));
const read=(f,args,agent=f.agent)=>JSON.parse(f.registered[1].execute(args,{agent}));
const catalog=(f,args,agent=f.agent)=>JSON.parse(f.registered[0].execute(args,{agent}));

test('tool and skill selection coexist; hidden skills remain discoverable and original loader/permissions remain',async t=>{
 let calls=0;
 const f=fixture(t,{plan:input=>{calls++;return {keepTools:[],keepSkills:input.skillsSelectionNeeded?['poetry']:[],results:[],reason:'按翻译任务选择'};}});
 const entries=[{name:'poetry',description:'翻译诗句'},{name:'audio',description:'制作语音'}];
 const skill={role:'user',source:{kind:'skill-catalog',form:'catalog',entries},content:[{type:'text',text:'<available_skills>\n'+entries.map(e=>'- `'+e.name+'`: '+e.description).join('\n')+'\n</available_skills>\n通过原 skill 工具加载全文。'}]};
 f.request.messages=[{role:'user',content:'翻译这句诗'},skill];f.request.tools.push(definition('skill'));
 freeze(f.request);const original=JSON.stringify(f.request);
 const out=await f.project.transform(f.request);
 assert.equal(calls,2);assert.equal(JSON.stringify(f.request),original);
 assert.deepEqual(out.messages[1].source.entries,[entries[0]]);
 assert.ok(out.tools.some(t=>t.name==='skill'));assert.ok(out.tools.some(t=>t.name==='censhu_tool_catalog'));
 const found=catalog(f,{action:'catalog',target:'skills',query:'语音'});
 assert.equal(found.entries[0].name,'audio');assert.deepEqual(found.entries[0].load,{tool:'skill',arguments:{name:'audio'}});
 assert.equal(catalog(f,{action:'catalog',target:'skills'},{session:{id:'foreign'}}).available,false);
 await f.project.transform(f.request);assert.equal(calls,2,'same-turn decisions reused');
 f.project.recordUsage('session-fixture',{inputTokens:1234,outputTokens:40});assert.equal(f.project.status()[0].reported.inputTokens,1234);
});

test('invalid result offsets preserve originals without blocking valid tools or the following skill decision',async t=>{
 let calls=0;
 const f=fixture(t,{plan:input=>{
  calls++;
  return {keepTools:input.toolsSelectionNeeded?['search_next']:[],keepSkills:input.skillsSelectionNeeded?['poetry']:[],
   results:input.results.map(row=>({id:row.id,mode:'excerpt',outcome:'data',ranges:[{part:0,start:0,end:999999}],criticalRanges:[],reason:'bad model offset'})),reason:'Capabilities selected for the current task'};
 }});
 const entries=[{name:'poetry',description:'翻译诗句'},{name:'audio',description:'制作语音'}];
 const skill={role:'user',source:{kind:'skill-catalog',form:'catalog',entries},content:[{type:'text',text:'<available_skills>\n'+entries.map(e=>'- `'+e.name+'`: '+e.description).join('\n')+'\n</available_skills>'}]};
 f.request.messages.push(skill);f.request.tools.push(definition('skill'));freeze(f.request);
 const before=JSON.stringify(f.request),out=await f.project.transform(f.request);
 assert.equal(calls,2,'the valid tool decision and following skill job both complete');
 assert.equal(JSON.stringify(f.request),before);assert.strictEqual(out.messages[2],f.request.messages[2],'invalid result presentation retains its entire original');
 assert.ok(out.tools.some(tool=>tool.name==='search_next'));assert.ok(!out.tools.some(tool=>tool.name==='unused_one'));
 assert.deepEqual(out.messages.at(-1).source.entries,[entries[0]],'result validation failure does not prevent skill selection');
 const stats=f.project.status()[0];assert.equal(stats.mode,'partial');assert.equal(stats.resultFailures.length,1);assert.ok(stats.retryAt>stats.at);
 assert.match(stats.reason,/结果保留原文/);
 const retry=await f.project.transform(f.request);assert.equal(calls,2,'bad result planning observes backoff');
 assert.strictEqual(retry.messages[2],f.request.messages[2]);assert.ok(!retry.tools.some(tool=>tool.name==='unused_one'));
 assert.deepEqual(retry.messages.at(-1).source.entries,[entries[0]],'valid capability plans remain usable during result backoff');
});

test('failed skill planning preserves catalog; backoff retains the failure reason; tool choice required stays meaningful',async t=>{
 const f=fixture(t,{plan:()=>{throw Object.assign(Error('Provider temporarily unavailable'),{httpStatus:429});}});
 await f.project.transform(f.request);await f.project.transform(f.request);
 assert.equal(f.project.status()[0].mode,'backoff');assert.match(f.project.status()[0].reason,/temporarily unavailable/);
 const empty=fixture(t,{plan:()=>({keepTools:[],keepSkills:[],results:[],reason:'无需工具'})});
 empty.request.messages=[{role:'user',content:'测试'}];empty.request.toolChoice='required';
 assert.strictEqual((await empty.project.transform(empty.request)).tools,empty.request.tools);
});

test('life internal task is visible as context, and loaded skill instructions are never result-pruned',async t=>{
 const f=fixture(t);
 f.request.tools.push(definition('skill'));
 const content='<skill_content>'+ '技能完整操作要求。'.repeat(1500)+'</skill_content>';
 f.request.messages=[{role:'system',content:'当前生活任务：检索窗框资料。'},{role:'user',source:{kind:'user'},content:'很早以前的聊天'},
 {role:'user',source:{kind:'plugin:dsh-censhu-agency'},content:'现在继续自己的绘画项目'},
 {role:'assistant',content:[{type:'tool-call',id:'skill1',name:'skill',arguments:{name:'art'}}]},
 {role:'tool',toolCallId:'skill1',content}];
 const out=await f.project.transform(f.request);
 assert.equal(f.input().topic,'现在继续自己的绘画项目');assert.match(f.input().taskContext.currentInstructions,/窗框/);
 assert.match(f.input().taskContext.authorization,/not a new user permission/);
 assert.equal(f.input().results.length,0);assert.equal(out.messages.at(-1).content,content);
});

test('obsolete catalogs do not return when Gemini fails; provider schema only admits names in the current batch',async t=>{
 const f=fixture(t,{plan:()=>{throw Error('unavailable');}});
 const entries=[{name:'skill-a',description:'目录说明'.repeat(300)}];
 const skill={role:'user',source:{kind:'skill-catalog',form:'catalog',entries},content:[{type:'text',text:'<available_skills>\n- `skill-a`: '+entries[0].description+'\n</available_skills>'}]};
 f.request.messages=[...Array.from({length:216},(_,i)=>({...skill,id:'skill-'+i})),{role:'user',content:'翻译诗句'}];
 f.request.tools.push(definition('skill'));freeze(f.request);
 const out=await f.project.transform(f.request);assert.equal(f.request.messages.length,217);assert.equal(out.messages.length,2);
 assert.equal(out.messages[0].id,'skill-215');assert.equal(f.project.status()[0].skillSnapshotsBefore,216);assert.equal(f.project.status()[0].skillSnapshotsAfter,1);
 assert.strictEqual(out.tools,f.request.tools);assert.equal(out.messages[0].source.entries.length,1);
 const schema=requestSchemaFor({toolsSelectionNeeded:true,tools:[{name:'read'}],skillsSelectionNeeded:false,skills:[]});
 assert.deepEqual(schema.properties.keepTools.items.enum,['read']);assert.equal(schema.properties.keepTools.maxItems,undefined);assert.equal(schema.properties.keepSkills.maxItems,0);
 const large=requestSchemaFor({toolsSelectionNeeded:true,tools:Array.from({length:460},(_,i)=>({name:'tool_'+i}))});
 assert.equal(large.properties.keepTools.items.enum.length,460);assert.equal(large.properties.keepTools.maxItems,undefined);
});

test('frozen request becomes a clone; exact original, metadata, media, tool pairs and required definitions survive',async t=>{
 const f=fixture(t),image={type:'image',mimeType:'image/png',data:'image-bytes'},audio={type:'audio',data:'audio-bytes'};
 f.request.messages[2].content.push(image,audio);f.request.messages[2].meta={outcome:'success'};
 freeze(f.request);const before=JSON.stringify(f.request),out=await f.project.transform(f.request);
 assert.notStrictEqual(out,f.request);assert.equal(JSON.stringify(f.request),before);
 assert.deepEqual(out.tools.map(tool=>tool.name),['read_report','search_next','censhu_tool_catalog','censhu_tool_result_read']);
 assert.strictEqual(out.messages[1],f.request.messages[1]);assert.equal(out.messages[2].toolCallId,'call-a');
 assert.strictEqual(out.messages[2].source,f.request.messages[2].source);assert.equal(out.messages[2].isError,false);
 assert.strictEqual(out.messages[2].content[1],image);assert.strictEqual(out.messages[2].content[2],audio);assert.deepEqual(out.messages[2].meta,{outcome:'success'});
 const p=pointer(out.messages[2].content[0].text),page=read(f,{...p,limit:8000});
 assert.equal(page.text,f.request.messages[2].content[0].text);assert.equal(page.complete,true);assert.equal(f.calls(),1);
 assert.ok(f.project.status()[0].resultCharsAfter<f.project.status()[0].resultCharsBefore);
});

test('directory exposes all original tools and load adds the exact definition on the next request without executing it',async t=>{
 const f=fixture(t);await f.project.transform(f.request);
 const all=catalog(f,{action:'catalog'});assert.equal(all.total,6);assert.ok(all.entries.some(row=>row.name==='unused_two'));
 assert.equal(catalog(f,{action:'load',names:['unused_two']}).available,true);
 const out=await f.project.transform(f.request);assert.strictEqual(out.tools.find(tool=>tool.name==='unused_two'),f.tools.find(tool=>tool.name==='unused_two'));
 assert.equal(f.calls(),1);assert.equal(catalog(f,{action:'load',names:['nonexistent']}).available,false);
 assert.equal(catalog(f,{action:'catalog'},{session:{id:'other'}}).available,false);
 assert.equal(catalog(f,{action:'catalog',query:'unused',limit:1}).nextOffset,1);
});

test('history tool definitions and explicit toolChoice are retained even when the planner omits them',async t=>{
 const f=fixture(t);f.request.toolChoice={type:'function',function:{name:'unused_two'}};
 const out=await f.project.transform(f.request);
 assert.ok(out.tools.some(tool=>tool.name==='read_report'));assert.ok(out.tools.some(tool=>tool.name==='unused_two'));
 f.request.messages[1].content.push({type:'tool-call',name:'unknown-historical',id:'old'});
 const missing=await f.project.transform(f.request);assert.strictEqual(missing.tools,f.request.tools);
});

test('same-turn retries use one planner call; a new result gets one decision while schemas reuse the turn plan',async t=>{
 const f=fixture(t);f.project.startTurn('fixture',1);
 await f.project.transform(f.request);await f.project.transform(f.request);assert.equal(f.calls(),1);
 f.request.messages.push({role:'assistant',content:[{type:'tool-call',id:'call-b',name:'search_next',arguments:{}}]},{role:'tool',toolCallId:'call-b',content:'第二份数据'.repeat(1800)});
 await f.project.transform(f.request);assert.equal(f.calls(),2);assert.equal(f.input().toolsSelectionNeeded,false);assert.equal(f.input().results.length,1);
 f.project.startTurn('session-fixture',2);await f.project.transform(f.request);assert.equal(f.calls(),3);assert.equal(f.input().results.length,0);
});

test('in-flight identical requests share one planner and invalidation does not republish stale state',async t=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,{plan:async input=>{calls++;await gate;return {keepTools:[],results:input.results.map(row=>({id:row.id,mode:'keep',outcome:'data',ranges:[],criticalRanges:[],reason:'保留'})),reason:'无关工具延后'};}});
 const first=f.project.transform(f.request),second=f.project.transform(f.request);await Promise.resolve();assert.equal(calls,1);
 f.project.forget('fixture');release();assert.strictEqual(await first,f.request);assert.strictEqual(await second,f.request);assert.equal(f.project.status().length,0);
});

test('cancelling one waiter returns promptly while an identical live request still uses the shared planner',async t=>{
 let release,started;const began=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});let calls=0;
 const f=fixture(t,{plan:async input=>{calls++;started();await gate;return {keepTools:input.toolsSelectionNeeded?['search_next']:[],results:input.results.map(row=>({id:row.id,mode:'keep',outcome:'data',ranges:[],criticalRanges:[],reason:'保留'})),reason:'共享规划'};}});
 const controller=new AbortController(),cancelled={...f.request,signal:controller.signal};
 const first=f.project.transform(cancelled),second=f.project.transform(f.request);await began;controller.abort();
 let completed=false;first.then(()=>{completed=true;});
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,true,'abort must not wait for the provider');assert.equal(await first,cancelled);assert.equal(calls,1);}
 finally{release();}
 const projected=await second;assert.ok(projected.tools.some(tool=>tool.name==='search_next'));assert.ok(!projected.tools.some(tool=>tool.name==='unused_two'));assert.equal(calls,1);
});

for(const change of ['next-turn','end-turn','forget','dispose'])test('pending projection wakes immediately on '+change+' without publishing an old decision',async t=>{
 let started,release;const began=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,{plan:async input=>{started();await gate;return {keepTools:[],results:input.results.map(row=>({id:row.id,mode:'keep',outcome:'data',ranges:[],criticalRanges:[],reason:'保留'})),reason:'旧决定'};}});
 f.project.startTurn('fixture',1);const pending=f.project.transform(f.request);await began;
 if(change==='next-turn')f.project.startTurn('fixture',2);else if(change==='end-turn')f.project.endTurn('fixture',1);else if(change==='forget')f.project.forget('fixture');else f.project.dispose();
 let completed=false;pending.then(()=>{completed=true;});
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,true,'lifecycle invalidation must release the old waiter');assert.equal(await pending,f.request);assert.equal(f.project.status().length,0);}
 finally{release();}
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.project.status().length,0);
});

test('a planner response cannot adopt an updated semantic configuration as its original scope',async t=>{
 let scope='enabled',release,started;const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 const f=fixture(t,{planScope:()=>scope,plan:async input=>{started();await gate;return {keepTools:[],results:input.results.map(row=>({id:row.id,mode:'keep',outcome:'data',ranges:[],criticalRanges:[],reason:'保留'})),reason:'过期范围'};}});
 const pending=f.project.transform(f.request);await began;scope='disabled';release();
 assert.equal(await pending,f.request);assert.equal(f.project.status().length,0);
});

test('planner failures preserve requests, while invalid result ranges do not revoke valid capability choices',async t=>{
 let now=100,calls=0;
 const f=fixture(t,{now:()=>now,plan:()=>{calls++;throw Error('model down');}});
 assert.strictEqual(await f.project.transform(f.request),f.request);assert.strictEqual(await f.project.transform(f.request),f.request);assert.equal(calls,1);
 now+=30001;await f.project.transform(f.request);assert.equal(calls,2);
 const badNames=fixture(t,{plan:()=>({keepTools:['not-real'],results:[],reason:'bad'})});assert.strictEqual(await badNames.project.transform(badNames.request),badNames.request);
 const badRange=fixture(t,{plan:input=>({keepTools:[],results:input.results.map(row=>({id:row.id,mode:'excerpt',outcome:'data',ranges:[{part:0,start:0,end:999999}],criticalRanges:[],reason:'bad'})),reason:'bad'})});
 const partial=await badRange.project.transform(badRange.request);assert.strictEqual(partial.messages,badRange.request.messages);assert.ok(partial.tools.length<badRange.request.tools.length);assert.equal(badRange.project.status()[0].mode,'partial');
});

test('model chooses interior excerpts and essential receipts; code copies only exact offsets and retains errors whole',async t=>{
 const body='A'.repeat(3500)+'PARTIAL: only row 9 applied; row 10 failed.'+'B'.repeat(3500);
 const f=fixture(t,{plan:input=>({keepTools:[],results:input.results.map(row=>({id:row.id,mode:'reference',outcome:'mixed',ranges:[],criticalRanges:[{part:0,start:3500,end:3541}],reason:'保留完整关键回执'})),reason:'选择回执'})});
 f.request.messages=messages(body);
 const out=await f.project.transform(f.request);assert.ok(out.messages[2].content[0].text.includes(body.slice(3500,3541)));
 assert.equal(read(f,{...pointer(out.messages[2].content[0].text),limit:8000}).text,body);
 f.request.messages[2].isError=true;const error=await f.project.transform(f.request);assert.strictEqual(error.messages[2],f.request.messages[2]);
 const invalid=fixture(t,{plan:input=>({keepTools:[],results:input.results.map(row=>({id:row.id,mode:'reference',outcome:'receipt',ranges:[],criticalRanges:[],reason:'错误遗漏回执'})),reason:'bad'})});
 assert.strictEqual((await invalid.project.transform(invalid.request)).messages,invalid.request.messages);
});

test('explicit model error classification cannot replace the error with a reference',async t=>{
 const f=fixture(t,{plan:input=>({keepTools:[],results:input.results.map(row=>({id:row.id,mode:'reference',outcome:'error',ranges:[],criticalRanges:[],reason:'bad'})),reason:'bad'})});
 assert.strictEqual((await f.project.transform(f.request)).messages,f.request.messages);
});

test('originals remain readable after reload, are session isolated, and versions cannot drift',async t=>{
 const f=fixture(t),out=await f.project.transform(f.request),p=pointer(out.messages[2].content[0].text);
 f.project.dispose();const reopened=createRequestContext({storeDirectory:f.directory});t.after(()=>reopened.dispose());
 const tool=reopened.tools()[1],parse=(args,session='fixture')=>JSON.parse(tool.execute(args,{agent:{session:{id:session}}}));
 assert.equal(parse({...p,limit:8000}).text,f.request.messages[2].content[0].text);
 assert.equal(parse(p,'another').available,false);assert.equal(parse({...p,version:'0'.repeat(64)}).available,false);
 const target=path.join(f.directory,fs.readdirSync(f.directory)[0],p.version+'.json');fs.writeFileSync(target,'{}');
 const cold=createRequestContext({storeDirectory:f.directory});t.after(()=>cold.dispose());
 assert.equal(JSON.parse(cold.tools()[1].execute(p,{agent:f.agent})).available,false);
});

test('failed original storage retains full source even when the model selects reference',async t=>{
 const f=fixture(t,{storeDirectory:undefined}),out=await f.project.transform(f.request);
 assert.strictEqual(out.messages,f.request.messages);
 const full=fixture(t,{originals:createRequestOriginals({directory:f.directory,maxEntryBytes:10})}),out2=await full.project.transform(full.request);
 assert.strictEqual(out2.messages,full.request.messages);
});

test('bounded oversized planner input skips semantic changes; small requests do not call a planner',async t=>{
 const f=fixture(t,{maxPlannerChars:100});assert.strictEqual(await f.project.transform(f.request),f.request);assert.equal(f.calls(),0);
 const small=fixture(t,{minToolChars:100000,minResultChars:100000});assert.strictEqual(await small.project.transform(small.request),small.request);assert.equal(small.calls(),0);
});

test('read receipts merge only actually returned intervals and read results bypass projection',async t=>{
 const f=fixture(t);f.project.startTurn('fixture',1);const out=await f.project.transform(f.request),p=pointer(out.messages[2].content[0].text);
 const first=read(f,{...p,offset:0,limit:2000});assert.equal(first.nextOffset,2000);
 read(f,{...p,offset:6000,limit:2000});read(f,{...p,offset:1000,limit:2000});
 const rawRead=JSON.stringify(read(f,{...p,limit:8000}));
 f.request.messages.push({role:'assistant',content:[{type:'tool-call',id:'read-source',name:'censhu_tool_result_read',arguments:p}]},{role:'tool',toolCallId:'read-source',content:rawRead});
 const next=await f.project.transform(f.request);assert.equal(next.messages.at(-1).content,rawRead);assert.equal(f.calls(),1);
 assert.deepEqual(f.project.status()[0].readsThisTurn[0].ranges,[[0,8000]]);assert.equal(f.project.status()[0].readsThisTurn[0].complete,true);
 f.project.endTurn('fixture',1);await f.project.transform(f.request);assert.equal(f.project.status()[0].readsThisTurn.length,0);
});

test('Unicode read paging never splits a surrogate pair, and UTF-16 planner boundaries are validated',async t=>{
 const f=fixture(t),body='😀'.repeat(3500);f.request.messages=messages(body);
 const out=await f.project.transform(f.request),p=pointer(out.messages[2].content[0].text);
 assert.equal(read(f,{...p,limit:1}).text,'😀');assert.equal(read(f,{...p,offset:1,limit:10}).available,false);
 const invalid=fixture(t,{plan:input=>({keepTools:[],results:input.results.map(row=>({id:row.id,mode:'excerpt',outcome:'data',ranges:[{part:0,start:1,end:3}],criticalRanges:[],reason:'bad'})),reason:'bad'})});invalid.request.messages=messages(body);
 assert.strictEqual((await invalid.project.transform(invalid.request)).messages,invalid.request.messages);
});

test('archived, retired, aborted, disposed, or sessionless requests retain original identity',async t=>{
 for(const option of [{isSessionArchived:()=>true},{isSessionRetired:()=>true}]){const f=fixture(t,option);assert.strictEqual(await f.project.transform(f.request),f.request);assert.equal(f.calls(),0);}
 const f=fixture(t);f.request.signal=AbortSignal.abort();assert.strictEqual(await f.project.transform(f.request),f.request);
 f.project.dispose();assert.strictEqual(await f.project.transform(f.request),f.request);
});

test('the model protocol uses structured choices and exposes no original tool execution bridge',()=>{
 assert.deepEqual(requestPlanSchema.required,['keepTools','keepSkills','results','reason']);
 const p=createRequestContext();assert.deepEqual(p.tools().map(tool=>tool.name),['censhu_tool_catalog','censhu_tool_result_read']);
 assert.equal(p.tools()[0].parameters.properties.action.enum.includes('execute'),false);p.dispose();
});

test('unknown nested user tool-result shape is left intact instead of guessing a provider-specific rewrite',async t=>{
 const f=fixture(t);f.request.messages=[{role:'user',source:{kind:'tool'},content:[{type:'tool-result',toolCallId:'old-call',content:'raw'.repeat(4000)}]}];
 const out=await f.project.transform(f.request);assert.strictEqual(out.messages,f.request.messages);assert.equal(f.input().results.length,0);
});

test('expired result plans are not silently used when replanning fails',async t=>{
 let now=1,failPlan=false;
 const f=fixture(t,{now:()=>now,cacheTtlMs:10,plan:input=>{if(failPlan)throw Error('down');return {keepTools:input.toolsSelectionNeeded?['search_next']:[],results:input.results.map(row=>({id:row.id,mode:'reference',outcome:'data',ranges:[],criticalRanges:[],reason:'按需取回'})),reason:'选择'};}});
 const first=await f.project.transform(f.request);assert.notStrictEqual(first.messages,f.request.messages);
 now=12;failPlan=true;const second=await f.project.transform(f.request);assert.strictEqual(second.messages,f.request.messages);
});

test('one oversized historical result cannot block tool planning or a smaller result batch',async t=>{
 const f=fixture(t,{maxPlannerChars:7000});f.request.messages=messages('huge'.repeat(40000));
 f.request.messages.push({role:'assistant',content:[{type:'tool-call',id:'small-call',name:'search_next',arguments:{}}]},{role:'tool',toolCallId:'small-call',content:'data'.repeat(900)});
 const out=await f.project.transform(f.request);
 assert.ok(out.tools.length<f.request.tools.length);assert.strictEqual(out.messages[2],f.request.messages[2]);assert.notStrictEqual(out.messages.at(-1),f.request.messages.at(-1));
 assert.equal(f.project.status()[0].oversizedResults,1);assert.equal(f.calls(),2);
 await f.project.transform(f.request);assert.equal(f.calls(),2,'oversized content does not cause useless model retries');
});

test('backlog result batches respect per-request work limit and retain unreviewed originals until later',async t=>{
 const f=fixture(t,{maxPlannerChars:7000,maxPlannerCalls:2});f.request.messages=messages('small');
 for(let index=0;index<5;index++)f.request.messages.push({role:'assistant',content:[{type:'tool-call',id:'batch-'+index,name:'search_next',arguments:{}}]},{role:'tool',toolCallId:'batch-'+index,content:('data-'+index).repeat(700)});
 let out=await f.project.transform(f.request);assert.equal(f.calls(),2);assert.equal(f.project.status()[0].resultsProjected,1);assert.ok(f.project.status()[0].deferredBatches>0);
 for(let index=0;index<3;index++){const before=f.calls();out=await f.project.transform(f.request);assert.ok(f.calls()-before<=2);}
 assert.equal(f.project.status()[0].resultsProjected,5);assert.equal(f.calls(),6);
 const before=f.calls();await f.project.transform(f.request);assert.equal(f.calls(),before);
});

test('large tool directories are reviewed in cached batches; no full-definition reduction occurs before all batches succeed',async t=>{
 let calls=0;
 const f=fixture(t,{maxPlannerChars:3500,maxPlannerCalls:1,minResultChars:100000,plan:input=>{calls++;assert.ok(JSON.stringify(input).length<=3500);return {keepTools:input.tools.length?[input.tools[0].name]:[],results:[],reason:'选择本批所需工具'};}});
 f.request.tools=[...f.tools,...Array.from({length:10},(_,index)=>({...definition('extra_'+index),description:'长用途'.repeat(1500)}))];
 let out=await f.project.transform(f.request);assert.strictEqual(out.tools,f.request.tools);
 for(let index=0;index<10&&out.tools===f.request.tools;index++)out=await f.project.transform(f.request);
 assert.notStrictEqual(out.tools,f.request.tools);assert.ok(calls>1&&calls<10);
 const before=calls;await f.project.transform(f.request);assert.equal(calls,before);
 const all=catalog(f,{action:'catalog',limit:40});assert.equal(all.total,16);
});

test('native in-history and addition-only declaration reconstruction cannot restore omitted tools or hide newly loaded ones',async t=>{
 const f=fixture(t);f.request.tools[3]={...f.request.tools[3],deferLoading:true};
 const oldTool=definition('old_called_tool');
 f.request.messages.push({role:'assistant',content:[{type:'tool-call',id:'historic-call',name:'old_called_tool',arguments:{}}]},
  {role:'tool',toolCallId:'historic-call',content:'old result'},
  {role:'developer',id:'removal',content:[{type:'tool-removal',toolName:'unused_two'}]});
 f.request.toolHistory={tools:[...f.request.tools,oldTool],updates:[{messageId:'removal',additions:[]}]};
 freeze(f.request);const before=JSON.stringify(f.request),out=await f.project.transform(f.request);
 assert.notStrictEqual(out.toolHistory,f.request.toolHistory);assert.deepEqual(out.toolHistory.updates,[]);assert.strictEqual(out.toolHistory.tools,out.tools);
 assert.ok(out.tools.some(tool=>tool.name==='old_called_tool'));assert.equal(JSON.stringify(f.request),before);
 catalog(f,{action:'load',names:['unused_two']});const loaded=await f.project.transform(f.request);
 assert.equal(loaded.tools.find(tool=>tool.name==='unused_two').deferLoading,false);
 // The actual installed function constructs this map in both supported modes;
 // in-history returns it, addition-only additionally intersects active names.
 for(const mode of ['in-history','addition-only']){
  const declarations=new Map(loaded.toolHistory.tools.map(tool=>[tool.name,tool]));
  for(const update of loaded.toolHistory.updates)for(const tool of update.additions)if(!declarations.has(tool.name))declarations.set(tool.name,{...tool,deferLoading:true});
  if(mode==='addition-only')for(const name of declarations.keys())if(!loaded.tools.some(tool=>tool.name===name))declarations.delete(name);
  assert.deepEqual([...declarations.keys()],loaded.tools.map(tool=>tool.name));assert.equal(declarations.get('unused_two').deferLoading,false);assert.equal(declarations.has('unused_one'),false);
 }
});
