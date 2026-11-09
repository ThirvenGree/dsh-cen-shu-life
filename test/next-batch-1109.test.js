import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {KnowledgeConsolidator,applyDecision,partitionDecisions,itemTime} from '../lib/knowledge/consolidate.js';
import {adapters} from '../lib/knowledge/sources.js';
import {search,describe,contextBlock} from '../lib/knowledge/salience.js';
import {parseTimeRange} from '../lib/knowledge/time-range.js';
import {replayCase,summarize,diagnose} from '../lib/knowledge/replay.js';
import {buildIndex,runSuite} from '../lib/knowledge/evaluate.js';
import {builtinSuite} from '../lib/knowledge/synthetic.js';
import {MemoryWriteback,approvedMemories,REVIEW_DELAY_MS} from '../lib/memory-writeback.js';
import {windowAround,writebackContext} from '../lib/writeback-context.js';
import {observeGemini,withTrace,recordCall,telemetryFile,addUsage} from '../lib/gemini-telemetry.js';
import {googleStructured} from '../lib/situation.js';
import {modelChoices} from '../lib/model-choices.js';
import {checkGeminiPause,geminiPauseStatus,noteGeminiError,noteGeminiSuccess,resetGeminiPause,resumeGeminiCalls,geminiControlFile} from '../lib/gemini-pause.js';
import {LifeEngine} from '../lib/engine.js';
// 2026-11-09: second batch from the code-and-paper review.
const DAY=86400000,T0=Date.parse('2026-10-01T08:00:00+08:00');
const imp={level:'medium',class:'experience',holdDays:30,reason:'r'},item=(content,stage='n/a')=>({subject:'青枔',kind:'fact',stage,content});
const src=(key,at,extra={})=>({key,store:'life',recordId:key,scope:'t',text:'内容'+key,origin:'her-session',reviewed:false,visibility:'shared',eventAt:at,learnedAt:at,hash:'h'+key,processedHash:null,...extra});
const emptyIndex=sources=>({version:1,revision:0,sources:Object.fromEntries(sources.map(s=>[s.key,s])),items:{},ignored:{},cost:{calls:0,ms:0,sources:0}});
const consolidator=(generate,now=()=>T0+30*DAY)=>new KnowledgeConsolidator({home:path.join(os.tmpdir(),'unused-nb'),generate,now,sourceOptions:()=>({})});
const made=(key,at)=>({sourceKey:key,relation:'new',changeType:'formed',reason:'r',item:item('说法'+key),importance:imp});
const itemOf=(x,key)=>Object.values(x.items).find(i=>i.sources.includes(key));

test('one bad decision no longer rejects the batch; a source that keeps failing waits instead of blocking',async()=>{
 const a=src('a',T0),b=src('b',T0+DAY),x=emptyIndex([a,b]);
 const c=consolidator(async()=>({decisions:[made('a'),{sourceKey:'b',relation:'duplicate',itemId:'nope',changeType:'coexisting',reason:'r'}]}));
 const applied=await c.processBatch(x,[a,b]);
 assert.equal(applied.length,1);assert.ok(itemOf(x,'a'));assert.equal(a.processedHash,a.hash);assert.equal(b.processedHash,null);assert.equal(b.attempts,1);
 await c.processBatch(x,[b]);await c.processBatch(x,[b]);assert.equal(b.quarantinedAt,c.now());
 assert.deepEqual(c.sync(x,{sources:[],status:{}}).map(s=>s.key),[]);
 const later=consolidator(async()=>({decisions:[]}),()=>T0+40*DAY);assert.deepEqual(later.sync(x,{sources:[],status:{}}).map(s=>s.key),['b'],'it comes back after a week');
});
test('a changed text clears the wait; malformed replies count, a network failure does not',async()=>{
 const s=src('a',T0),x=emptyIndex([s]);Object.assign(s,{attempts:3,quarantinedAt:T0});
 const c=consolidator(async()=>({}));
 assert.deepEqual(c.sync(x,{sources:[{...src('a',T0),hash:'changed'}],status:{}}).map(p=>p.key),['a']);assert.equal(x.sources.a.attempts,0);
 await assert.rejects(c.processBatch(x,[x.sources.a]),/格式/);assert.equal(x.sources.a.attempts,1);
 const down=consolidator(async()=>{throw Object.assign(Error('HTTP 402'),{httpStatus:402});});await assert.rejects(down.processBatch(x,[x.sources.a]));assert.equal(x.sources.a.attempts,1);
});
test('partitionDecisions keeps valid decisions and reports the rejected ones',()=>{
 const batch=[src('a',T0),src('b',T0)],ids=new Map([['a',new Set()],['b',new Set()]]);
 const {valid,rejected}=partitionDecisions({decisions:[made('a'),{sourceKey:'b',relation:'progress',changeType:'changed',reason:'r'}]},batch,ids);
 assert.deepEqual([...valid.keys()],['a']);assert.match(rejected.get('b'),/候选/);
});
test('sources in one batch can point at each other; identical statements cost one judgment',async()=>{
 const a=src('a',T0),b=src('b',T0+DAY),copy={...src('c',T0),store:'engram',text:'内容a [来源：青枔明确原话「x」；Gemini审核；2026-10-01T00:00:00.000Z]'};a.text='内容a';
 const x=emptyIndex([a,b,copy]);let seen;
 const c=consolidator(async(_p,_s,input)=>{seen=input;return {decisions:[made('a'),{sourceKey:'b',relation:'duplicate',peerSourceKey:'a',changeType:'coexisting',reason:'同一件事'}]};});
 const applied=await c.processBatch(x,[a,copy,b]);
 assert.deepEqual(seen.sources.map(s=>s.sourceKey),['a','b'],'the copy is not sent');assert.equal(applied.length,3);
 const it=itemOf(x,'a');assert.deepEqual(it.sources.sort(),['a','b','c']);assert.equal(Object.keys(x.items).length,1);assert.equal(copy.relation,'duplicate');
});
test('a peer must be earlier in the batch, and a shared source cannot attach to a private item',async()=>{
 const a=src('a',T0),b=src('b',T0+DAY),x=emptyIndex([a,b]);
 const c=consolidator(async()=>({decisions:[{sourceKey:'a',relation:'duplicate',peerSourceKey:'b',changeType:'coexisting',reason:'r'},made('b')]}));await c.processBatch(x,[a,b]);assert.equal(a.processedHash,null);assert.equal(a.attempts,1);
 const p=src('p',T0,{visibility:'private'}),s=src('s',T0+DAY),y=emptyIndex([p,s]);
 const d=consolidator(async()=>({decisions:[made('p'),{sourceKey:'s',relation:'duplicate',peerSourceKey:'p',changeType:'coexisting',reason:'r'}]}));await d.processBatch(y,[p,s]);assert.equal(s.processedHash,null);
});
test('an older source cannot overturn a newer fact, whatever order they are processed in',()=>{
 const later=src('new',T0+5*DAY),older=src('old',T0),x=emptyIndex([later,older]),now=T0+30*DAY;
 applyDecision(x,later,made('new'),now);const current=itemOf(x,'new');
 applyDecision(x,older,{sourceKey:'old',relation:'contradiction',itemId:current.id,changeType:'changed',reason:'不一样',item:item('旧说法'),importance:imp},now);
 assert.equal(current.status,'active');const old=itemOf(x,'old');assert.equal(old.status,'superseded');assert.equal(old.supersededBy,current.id);assert.equal(old.validTo,T0+5*DAY);assert.equal(old.validFrom,T0);
 assert.deepEqual(current.priorValues.map(p=>p.content),['旧说法']);assert.equal(current.history.at(-1).timeBasis,'event');
});
test('a newer correction still closes the old fact, at the time it happened',()=>{
 const older=src('old',T0),later=src('new',T0+5*DAY),x=emptyIndex([later,older]),now=T0+30*DAY;
 applyDecision(x,older,made('old'),now);const prev=itemOf(x,'old');
 applyDecision(x,later,{sourceKey:'new',relation:'contradiction',itemId:prev.id,changeType:'changed',reason:'更正',item:item('新说法'),importance:imp},now);
 assert.equal(prev.status,'superseded');assert.equal(prev.validTo,T0+5*DAY);const fresh=itemOf(x,'new');assert.equal(fresh.status,'active');assert.deepEqual(fresh.priorValues.map(p=>p.content),['说法old']);
});
test('with no time on one side the decision stands and says so',()=>{
 const a=src('a',T0),b=src('b',0,{eventAt:null,learnedAt:null}),x=emptyIndex([a,b]),now=T0+30*DAY;
 applyDecision(x,a,made('a'),now);const prev=itemOf(x,'a');applyDecision(x,b,{sourceKey:'b',relation:'contradiction',itemId:prev.id,changeType:'changed',reason:'更正',item:item('新'),importance:imp},now);
 assert.equal(prev.status,'superseded');assert.equal(prev.history.at(-1).timeBasis,'unknown');
});
test('older progress is kept as an earlier stage; newer progress moves the event time',()=>{
 const later=src('new',T0+5*DAY),older=src('old',T0),next=src('next',T0+9*DAY),x=emptyIndex([later,older,next]),now=T0+30*DAY;
 applyDecision(x,later,made('new'),now);const it=itemOf(x,'new'),before=it.content;
 applyDecision(x,older,{sourceKey:'old',relation:'progress',itemId:it.id,changeType:'changed',reason:'阶段',item:item('早阶段','intended'),importance:imp},now);
 assert.equal(it.content,before);assert.ok(it.sources.includes('old'));
 applyDecision(x,next,{sourceKey:'next',relation:'progress',itemId:it.id,changeType:'changed',reason:'后续',item:item('现在的阶段','done'),importance:imp},now);
 assert.equal(it.content,'现在的阶段');assert.equal(it.eventAt,T0+9*DAY);assert.equal(it.priorValues.at(-1).content,before);
});
test('the oldest sources of a trust tier are handled first',()=>{
 const c=consolidator(async()=>({})),x=emptyIndex([]);
 const order=c.sync(x,{sources:[src('late',T0+DAY),src('early',T0),src('none',0,{eventAt:null,learnedAt:null}),src('sure',T0+9*DAY,{reviewed:true})],status:{}}).map(s=>s.key);
 assert.deepEqual(order,['sure','early','late','none']);
});
test('candidates carry their time and the prompt input marks which are later',async()=>{
 const later=src('new',T0+5*DAY,{eventAt:null,learnedAt:T0+5*DAY}),older=src('old',T0,{text:'说法new的旧记录'}),x=emptyIndex([later,older]),now=T0+30*DAY;applyDecision(x,later,made('new'),now);let input;
 await consolidator(async(_p,_s,i)=>{input=i;return {decisions:[{sourceKey:'old',relation:'irrelevant',changeType:'uncertain',reason:'r'}]};}).processBatch(x,[older]);
 assert.deepEqual(input.sources[0].laterCandidateIds,[itemOf(x,'new').id]);assert.match(input.candidates[0].eventText,/2026-10-06/);
});
test('a superseded item is not offered for later progress and cannot come back',()=>{
 const a=src('a',T0),b=src('b',T0+DAY),x=emptyIndex([a,b]),c=consolidator(async()=>({})),now=T0+30*DAY;applyDecision(x,a,made('a'),now);const it=itemOf(x,'a');it.status='superseded';
 assert.equal(c.candidatesFor(x,b).length,0);assert.equal(c.candidatesFor(x,a).length,1);
 applyDecision(x,b,{sourceKey:'b',relation:'progress',itemId:it.id,changeType:'changed',reason:'r',item:item('后续'),importance:imp},now);
 assert.equal(it.status,'superseded');assert.equal(itemOf(x,'b').status,'active');assert.equal(itemOf(x,'b').links[0].to,it.id);
});
test('itemTime ignores the source being judged',()=>{const a=src('a',T0),b=src('b',T0+DAY),x=emptyIndex([a,b]);assert.equal(itemTime(x,{eventAt:null,sources:['a','b']},'b'),T0);});
test('every store reports a time when it has one, and the review tag prefers the arrival time',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'kn-time-'));
 try{const life=path.join(home,'cen-shu-life'),mem=path.join(home,'memories'),agency=path.join(home,'censhu-agency');for(const d of [life,mem,agency])fs.mkdirSync(d,{recursive:true});
 fs.writeFileSync(path.join(life,'memory-writeback.json'),JSON.stringify({facts:[{id:'f1',sessionId:'s',text:'事实',at:T0+DAY,messageAt:T0},{id:'f2',sessionId:'s',text:'事实二',at:T0+DAY}]}));
 fs.writeFileSync(path.join(life,'rhythm.json'),JSON.stringify({plan:{at:T0,lifeIntentions:[{id:'i',text:'打算',at:T0+2*DAY}]}}));
 fs.writeFileSync(path.join(mem,'MEMORY.md'),'[2026-10-02 09:30] 一条记忆\n[2026-10-03] 打了标记 [来源：青枔明确原话「x」；来信于2026-10-05T01:00:00.000Z；Gemini审核；2026-10-06T01:00:00.000Z]');
 fs.writeFileSync(path.join(agency,'state.json'),JSON.stringify({history:[],notes:[{id:'n',text:'挂念',at:T0+3*DAY}]}));
 const a=adapters({home,homedir:home,sessionIds:[]}),rows=await a.life();
 assert.equal(rows.find(r=>r.recordId==='fact:f1').eventAt,T0);assert.equal(rows.find(r=>r.recordId==='fact:f2').eventAt,T0+DAY);assert.equal(rows.find(r=>r.scope==='intention').eventAt,T0+2*DAY);
 const mems=await a.memoryEvolve();assert.equal(mems[0].eventAt,Date.parse('2026-10-02T09:30:00+08:00'));assert.equal(mems[1].eventAt,Date.parse('2026-10-05T01:00:00.000Z'));
 assert.equal((await a.agency())[0].eventAt,T0+3*DAY);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
const NOW=Date.parse('2026-11-09T15:00:00+08:00'),bj=s=>Date.parse(s+'+08:00'),range=t=>parseTimeRange(t,NOW);
test('Chinese time phrases become Beijing-time ranges',()=>{
 assert.deepEqual([range('今天').from,range('昨天').from,range('大前天').from],[bj('2026-11-09T00:00:00'),bj('2026-11-08T00:00:00'),bj('2026-11-06T00:00:00')]);
 assert.equal(range('昨天').to,bj('2026-11-09T00:00:00')-1);
 assert.equal(range('上个月青枔说过什么').from,bj('2026-10-01T00:00:00'));assert.equal(range('上月').to,bj('2026-11-01T00:00:00')-1);
 assert.equal(range('上周').from,bj('2026-11-02T00:00:00'));assert.equal(range('上周三').from,bj('2026-11-04T00:00:00'));assert.equal(range('这周日').from,bj('2026-11-15T00:00:00'));
 assert.equal(range('去年').from,bj('2025-01-01T00:00:00'));assert.equal(range('最近三天').to,NOW);assert.equal(range('最近十二天').from,NOW-12*DAY);
 assert.equal(range('10月3日').from,bj('2026-10-03T00:00:00'));assert.equal(range('12月25号').from,bj('2025-12-25T00:00:00'),'a future date means last year');assert.equal(range('2025年3月').to,bj('2025-04-01T00:00:00')-1);
 assert.equal(range('三天前').from,bj('2026-11-06T00:00:00'));assert.ok(range('两个月前').from<bj('2026-09-09T00:00:00'));assert.equal(range('上上周').from,bj('2026-10-26T00:00:00'));
 assert.equal(range('１０月３日').from,bj('2026-10-03T00:00:00'),'full-width digits');
 for(const none of ['她喜欢什么','','13月40日','最近零天'])assert.equal(range(none),null,none);
 const jan=parseTimeRange('上个月',bj('2026-01-15T12:00:00'));assert.equal(jan.from,bj('2025-12-01T00:00:00'));assert.equal(jan.to,bj('2026-01-01T00:00:00')-1);
});
test('search can be limited to a time and shows earlier values',()=>{
 const idx={sources:{},items:{a:{id:'a',subject:'青枔',content:'考试安排',status:'active',visibility:'shared',eventAt:T0,sources:[],links:[],history:[]},b:{id:'b',subject:'青枔',content:'考试成绩',status:'active',visibility:'shared',eventAt:T0+20*DAY,sources:[],links:[],history:[{at:T0,changeType:'changed',reason:'r',before:{content:'旧阶段'}}],priorValues:[{content:'旧值',eventText:'十月',at:T0}]}}};
 assert.deepEqual(search(idx,{rows:[]},'考试',{from:T0-DAY,to:T0+DAY}).map(i=>i.id),['a']);assert.equal(search(idx,{rows:[]},'考试').length,2);
 const d=describe(idx,idx.items.b,{withHistory:true});assert.deepEqual(d.earlier,[{content:'旧值',when:'十月'}]);assert.equal(d.history[0].before,'旧阶段');
 assert.match(contextBlock(idx,{rows:[{id:'b',score:1}]}).text,/之前的说法：旧值/);
});
const rec=(id,text,status='active')=>({id,subject:'青枔',content:text,kind:'fact',stage:'n/a',status,visibility:'shared',sources:['s'+id],links:[],history:[]});
test('the online lane gets only what chat would show and never decides the diagnosis',async()=>{
 const index={sources:{sa:{key:'sa',store:'life',text:'考试在周五',visibility:'shared'}},items:{a:rec('a','考试在周五')}},seen={};
 const answer=async(_s,input)=>{seen[input.records.map(r=>r.id).join()]=true;return {action:'answer',answer:'资料里没有',abstained:true,citations:[]};};
 const out=await replayCase({kase:{id:'c',kind:'control',question:'考试哪天',expected:'资料里没有',abstain:true,required:[]},index,ranking:{rows:[]},answer});
 assert.equal(out.grades.online.status,'correct');assert.ok(seen['']!==undefined,'with no ranking the online lane has nothing');assert.equal(out.diagnosis,'all-ok');
 assert.equal(summarize([out]).onlineAccuracy,1);
 assert.equal(diagnose({raw:{status:'correct'},consolidated:{status:'correct'},recall:{status:'correct'},online:{status:'error'}}),'all-ok');
});
const scripted=()=>async(_p,_s,input)=>({decisions:input.sources.map(s=>({sourceKey:s.sourceKey,relation:'new',changeType:'formed',reason:'r',item:item(s.text.slice(0,60)),importance:imp}))});
test('a suite can also be consolidated newest-first, reported apart from the gate',async()=>{
 const suite=builtinSuite(),answer=async()=>({action:'answer',answer:'资料里没有',abstained:true,citations:[]});let calls=0,gen=scripted();const counted=(...a)=>{calls++;return gen(...a);};
 const plain=await runSuite({generate:counted,answer,suite});const once=calls;assert.equal(plain.checksReversed,undefined);
 calls=0;const both=await runSuite({generate:counted,answer,suite,reversed:true});assert.ok(calls>once);assert.deepEqual(Object.keys(both.checksReversed),Object.keys(both.checks));
});
test('replay indexes use the vectors they are given and do not need them',async()=>{
 let local=0;const vectors={localVectors:async texts=>{local++;return new Map(texts.map(t=>[t,new Float32Array([1,0])]));},geminiVectors:async()=>null,save(){},geminiError:''};
 await buildIndex({waves:[[src('a',T0)]],generate:scripted(),vectorStore:vectors});assert.ok(local>0);await buildIndex({waves:[[src('a',T0)]],generate:scripted()});
});
const withEngine=async fn=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'wb-next-'));try{const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],memoryWritebackEnabled:true});await fn(e,home);}finally{fs.rmSync(home,{recursive:true,force:true});}};
const memoryOk={decision:'proceed',reason:'r',nextMinutes:30,memories:[{text:'青枔觉得那家店难吃',quote:'那家店太难吃了',kind:'preference',stance:'opinion',importance:80,confidence:95,keep:true}]};
const tools=()=>({get:()=>true,execute:async({name})=>({value:name==='engram_save'?{id:'e',disposition:'saved'}:{ok:true,committed:true}})});
test('with context on, a message waits so a correction can be read with it',()=>withEngine(async e=>{
 const inputs=[];let now=T0;e.now=()=>now;
 const w=new MemoryWriteback(e,{tools:tools(),agents:()=>[],generate:async(_p,_s,input)=>{inputs.push(input);return memoryOk;},contextWindow:s=>[{position:'after',speaker:'青枔',text:'刚才说错了，是另一家'}]});
 w.observe('target','那家店太难吃了',null,null,'m1');assert.equal(w.record.sources[0].messageId,'m1');assert.equal(w.record.sources[0].notBefore,T0+REVIEW_DELAY_MS);
 await w.tick();assert.equal(inputs.length,0,'too early');
 now=T0+REVIEW_DELAY_MS;await w.tick();assert.equal(inputs.length,1);assert.equal(inputs[0].contextWindow[0].position,'after');
 const fact=w.record.facts[0];assert.equal(fact.stance,'opinion');assert.equal(fact.messageAt,T0);
}));
test('own watching notes and hosts without context are reviewed at once',()=>withEngine(async e=>{
 let calls=0;const w=new MemoryWriteback(e,{tools:tools(),agents:()=>[],generate:async()=>{calls++;return {...memoryOk,memories:[]};},contextWindow:()=>[]});
 w.observe('target','她自己的观看感受很长一段',"douyin-note:1");assert.equal(w.record.sources[0].notBefore,undefined);await w.tick();assert.equal(calls,1);
 const plain=new MemoryWriteback(e,{tools:tools(),agents:()=>[],generate:async()=>{calls++;return {...memoryOk,memories:[]};}});plain.observe('target','另一条比较长的来信');assert.equal(plain.record.sources.at(-1).notBefore,undefined);
}));
test('a failing context reader only loses the context',()=>withEngine(async e=>{
 const inputs=[];const w=new MemoryWriteback(e,{tools:tools(),agents:()=>[],generate:async(_p,_s,i)=>{inputs.push(i);return {...memoryOk,memories:[]};},contextWindow:()=>{throw Error('no');}});
 assert.deepEqual(w.readWindow({sessionId:'target',text:'x'}),[]);
}));
test('the written record carries the arrival time and marks an opinion',()=>withEngine(async e=>{
 const saved=[];let now=T0;e.now=()=>now;const agent={session:{id:'target'}};
 const t={get:()=>true,execute:async({name,arguments:a})=>{if(name==='engram_save')saved.push(a.content);return {value:name==='engram_save'?{id:'e',disposition:'saved'}:{ok:true,committed:true}};}};
 const w=new MemoryWriteback(e,{tools:t,agents:()=>[agent],generate:async()=>memoryOk});w.record.mnemonSince=T0+DAY;w.observe('target','那家店太难吃了');now=T0+60000;await w.tick();
 if(saved.length){assert.match(saved[0],/来信于2026-/);assert.match(saved[0],/主观判断/);}
 assert.equal(w.record.facts[0].messageAt,T0);
}));
test('a memory without a valid stance is refused; an old one without any still passes',()=>{
 const m={text:'青枔喜欢猫',quote:'我喜欢猫',kind:'preference',importance:80,confidence:95,keep:true};
 assert.equal(approvedMemories({memories:[m]},'我喜欢猫',75).length,1);assert.equal(approvedMemories({memories:[{...m,stance:'guess'}]},'我喜欢猫',75).length,0);
});
test('the window is the few messages around the one reviewed',()=>{
 const rows=Array.from({length:12},(_,i)=>({id:'m'+i,role:i%2?'self':'user',text:'第'+i+'条'}));
 const out=windowAround(rows,5);assert.deepEqual(out.map(r=>r.text),['第2条','第3条','第4条','第6条','第7条','第8条','第9条','第10条','第11条']);assert.deepEqual([out[0].position,out[0].speaker,out[3].position],['before','青枔','after']);assert.deepEqual(windowAround(rows,-1),[]);
});
test('context is found by message id on QQ and on the desktop',()=>{
 const qq=writebackContext({qqFacts:()=>({messages:[{id:'1',role:'self',text:'在吗'},{id:'2',role:'user',text:'我在'},{id:'3',role:'user',text:'刚说错了'}]})});
 assert.deepEqual(qq({sessionId:'s',messageId:'2',text:'我在'}).map(r=>r.position+r.speaker),['before岑舒','after青枔']);
 const user=(id,text)=>({type:'user/message',data:{id,role:'user',source:{kind:'user'},content:[{type:'text',text}]}}),say=(id,text)=>({type:'assistant/message',data:{message:{id,content:[{type:'text',text}]}}});
 const agent={session:{id:'s',snapshotEvents:()=>[say('a','早'),user('u','今天累'),{type:'user/message',data:{id:'x',source:{kind:'runtime-context'},content:[]}},say('b','辛苦了')]}};
 const desk=writebackContext({agents:()=>[agent],qqFacts:()=>null});assert.deepEqual(desk({sessionId:'session-s',messageId:'u',text:'今天累'}).map(r=>r.text),['早','辛苦了']);
});
const homeFor=async fn=>{const old=process.env.DSH_HOME,dir=fs.mkdtempSync(path.join(os.tmpdir(),'tel-'));process.env.DSH_HOME=dir;resetGeminiPause();try{await fn(dir);}finally{resetGeminiPause();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;fs.rmSync(dir,{recursive:true,force:true});}};
const rows=()=>JSON.parse(fs.readFileSync(telemetryFile(),'utf8')).rows;
test('usage, the prompt fingerprint and the trace are recorded with the call',()=>homeFor(async()=>{
 await withTrace('run-1',()=>observeGemini('x','m',async meta=>{addUsage(meta,{promptTokenCount:10,note:'skip'});addUsage(meta,{promptTokenCount:5,candidatesTokenCount:2});meta.promptHash='abc';meta.finishReason='STOP';return {};}));
 const row=rows()[0];assert.deepEqual(row.usage,{promptTokenCount:15,candidatesTokenCount:2});assert.equal(row.trace,'run-1');assert.equal(row.promptHash,'abc');assert.equal(row.finishReason,'STOP');
 await assert.rejects(observeGemini('y','m',async meta=>{meta.promptHash='z';throw Object.assign(Error('no'),{httpStatus:500});}));assert.equal(rows()[1].promptHash,'z');assert.equal(rows()[1].trace,undefined);
}));
test('a paused call is written down and sends nothing',()=>homeFor(async()=>{
 noteGeminiError(Object.assign(Error('x'),{httpStatus:402}));
 await assert.rejects(googleStructured('s',null,{},{semanticModel:'m'},{feature:'memory-writeback'}),e=>e.paused===true);
 await recordCall({at:1,feature:'flush',status:'success'});assert.equal(rows().find(r=>r.feature==='memory-writeback').status,'paused');
}));
test('an explicit yes or no to contact is recorded as a choice',()=>{
 assert.deepEqual(modelChoices({wake:false,judgment:'晚点再说'},'agency-contact-review').map(c=>[c.field,c.state,c.reason]),[['wake','skip','晚点再说']]);assert.deepEqual(modelChoices({wake:true,judgment:'好'},'x')[0].state,'proceed');
});
test('a billing refusal pauses other processes too, and a success lifts it for all',()=>homeFor(async()=>{
 const now=Date.now();noteGeminiError(Object.assign(Error('x'),{httpStatus:402}),now);assert.equal(JSON.parse(fs.readFileSync(geminiControlFile(),'utf8')).auto.status,402);
 resetGeminiPause();assert.equal(geminiPauseStatus(now+1000).auto.httpStatus,402,'a new process reads the shared pause');assert.throws(()=>checkGeminiPause(now+1000),e=>e.paused===true);
 noteGeminiSuccess();assert.equal(JSON.parse(fs.readFileSync(geminiControlFile(),'utf8')).auto,undefined);resetGeminiPause();assert.equal(geminiPauseStatus(now+2000).paused,false);
}));
test('resuming by hand clears a shared pause; an expired one is ignored',()=>homeFor(async()=>{
 const now=Date.now();noteGeminiError(Object.assign(Error('x'),{httpStatus:402}),now);resumeGeminiCalls({now:now+1});resetGeminiPause();assert.equal(geminiPauseStatus(now+2).paused,false);
 noteGeminiError(Object.assign(Error('x'),{httpStatus:403}),now+10);resetGeminiPause();assert.equal(geminiPauseStatus(now+16*60000+10).auto,null);
}));
