import test from 'node:test';import assert from 'node:assert/strict';import {installQqGrounding,reviewPayload,validateIssueQuotes} from '../lib/qq-grounding.js';
test('QQ send and memory writes are reviewed but reads and unrelated tools are not',()=>{assert.equal(reviewPayload({name:'memory',arguments:{action:'read',target:'daily'}}),null);assert.equal(reviewPayload({name:'mcp__snowluma__qq_send_message',arguments:{messages:['hello'],token:'secret'}}).kind,'outgoing');assert.equal(reviewPayload({name:'memory',arguments:{action:'add',entries:[{content:'fact'}]}}).kind,'memory');});
test('unfounded or uncertain replies and fake evidence cannot execute; reviewed proactive messages can',async()=>{let hook,next=0;const ctx={on(_,fn){hook=fn;return()=>{};}};const engine={bound:id=>id==='qq',now:()=>1000,context:()=>'',config:{}};let result={decision:'block',reason:'没有此来信',evidenceIds:[]};installQqGrounding(ctx,engine,{read:()=>({messages:[{id:'1',role:'user',text:'昨天的来信'}]}),judge:async()=>result});const exec={name:'qq_send_message',arguments:{messages:['晚安']},agent:{id:'qq'}};assert.equal((await hook(exec,()=>{next++;})).kind,'deny');assert.equal(next,0);result={decision:'allow',reason:'自主分享',evidenceIds:[]};exec.arguments={messages:['窗边阳光不错']};await hook(exec,()=>{next++;return{kind:'allow'};});assert.equal(next,1);result={decision:'allow',reason:'伪造依据',evidenceIds:['missing']};exec.arguments={messages:['另一个']};assert.equal((await hook(exec,()=>next++)).kind,'deny');assert.equal(next,1);await hook({...exec,agent:{id:'ordinary'}},()=>next++);assert.equal(next,2);});

test('expression repair returns targeted feedback while acceptable colloquial text passes unchanged',async()=>{
 let hook;const ctx={on(_,fn){hook=fn;return()=>{};}};
 const engine={bound:()=>true,now:()=>1000,context:()=>'',config:{}};
 let verdict={decision:'block',reason:'对象不清',evidenceIds:[],expression:'repair',issues:[{messageIndex:0,quote:'慢慢翻',problem:'补清翻看的对象'}]};
 installQqGrounding(ctx,engine,{read:()=>({messages:[]}),judge:async()=>verdict});
 const call={name:'qq_send_message',arguments:{messages:['倒了杯水慢慢翻']},agent:{id:'qq'}};
 const denied=await hook(call,()=>assert.fail('repair must not send'));assert.equal(denied.kind,'deny');assert.match(denied.reason,/补清翻看的对象/);assert.match(denied.reason,/只修改指出的问题/);
 verdict={decision:'allow',reason:'可理解的口语',evidenceIds:[],expression:'acceptable',issues:[]};call.arguments.messages=['累瘫了'];let sent;
 await hook(call,()=>{sent=call.arguments.messages;});assert.deepEqual(sent,['累瘫了']);
 verdict={decision:'allow',reason:'矛盾结果',evidenceIds:[],expression:'repair',issues:[]};call.arguments.messages=['另一句'];assert.equal((await hook(call,()=>assert.fail('inconsistent result'))).kind,'deny');
});

test('per-message results must cover all messages and agree; fabricated issue quotes cannot block as valid reviews',async()=>{
 let hook;const engine={bound:()=>true,now:()=>1000,context:()=>'',config:{}};
 let result={decision:'allow',reason:'ok',evidenceIds:[],expression:'natural',issues:[],messageChecks:[{index:0,expression:'natural'}]};
 installQqGrounding({on(_,fn){hook=fn;}},engine,{read:()=>({messages:[]}),judge:async()=>result});
 const call={name:'qq_send_message',agent:{id:'qq'},arguments:{messages:['第一条','第二条']}};
 assert.match((await hook(call,()=>assert.fail())).reason,/未逐条覆盖/);
 result.messageChecks.push({index:1,expression:'repair'});
 assert.match((await hook(call,()=>assert.fail())).reason,/总判断不一致/);
 result={...result,decision:'block',expression:'repair',issues:[{messageIndex:0,quote:'不存在',problem:'修改'}]};
 assert.match((await hook(call,()=>assert.fail())).reason,/不存在的片段/);
});

test('issue quotes belong to exactly the indexed message, including literal slash and newline',()=>{
 const candidate={kind:'outgoing',text:['第一条','第二条','原文有/斜杠\n和换行']};
 assert.throws(()=>validateIssueQuotes(candidate,[{messageIndex:0,quote:'第一条/第二条'}]),/不存在/);
 assert.throws(()=>validateIssueQuotes(candidate,[{messageIndex:1,quote:'第一条'}]),/不存在/);
 assert.throws(()=>validateIssueQuotes(candidate,[{messageIndex:9,quote:'第一条'}]),/编号/);
 assert.throws(()=>validateIssueQuotes(candidate,[{quote:'第一条'}]),/编号/);
 assert.doesNotThrow(()=>validateIssueQuotes(candidate,[{messageIndex:0,quote:'第一条'},{messageIndex:1,quote:'第二条'},{messageIndex:2,quote:'有/斜杠\n和'}]));
});
test('review model is independent of the shared semantic model and appears in receipts',async()=>{
 let hook;const engine={bound:()=>true,now:()=>1000,context:()=>'',config:{semanticModel:'gemini-3.8-flash',qqReviewModel:'gemini-4-argon'}};
 installQqGrounding({on(_,fn){hook=fn;}},engine,{read:()=>({messages:[]}),judge:async(_p,_s,_i,config)=>{assert.equal(config.semanticModel,'gemini-4-argon');return{decision:'allow',reason:'自然',evidenceIds:[],expression:'natural',issues:[],messageChecks:[{index:0,expression:'natural',reason:'自然'}]};}});
 let sent=false;await hook({name:'qq_send_message',agent:{id:'qq'},arguments:{messages:['刚到']}},()=>{sent=true;});assert.ok(sent);assert.equal(engine.config.semanticModel,'gemini-3.8-flash');assert.equal(engine.qqGrounding.model,'gemini-4-argon');
});
