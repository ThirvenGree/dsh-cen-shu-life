import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {collectSources,splitFeeling} from '../lib/knowledge/sources.js';
import {applyDecision} from '../lib/knowledge/consolidate.js';
import {describe,searchHybrid,searchSources,openQuestions} from '../lib/knowledge/salience.js';
import {validateSuite,EXTRA_KINDS,suitePrompt} from '../lib/knowledge/synthetic.js';
import {attributeFailures,mergeRuns,GATE_SUITES} from '../lib/knowledge/evaluate.js';
import {compareRuns} from '../lib/knowledge/strategy.js';
import {applyUndertone,undertoneInput,undertonePrompt} from '../lib/mood-undertone.js';
import {groundingPrompt,textLeaves} from '../lib/qq-grounding.js';
import {SemanticMentions} from '../lib/semantic-mentions.js';
import {LifeEngine} from '../lib/engine.js';
import {planView} from '../lib/plan-view.js';
import {currentStateView} from '../lib/current-state.js';
// 2026-11-09: fourth batch from the code-and-paper review.
const tmp=p=>fs.mkdtempSync(path.join(os.tmpdir(),p)),clean=d=>fs.rmSync(d,{recursive:true,force:true}),DAY=86400000,T0=Date.parse('2026-10-01T08:00:00+08:00');
const write=(home,file,value)=>{const p=path.join(home,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value));};
const withEngine=async fn=>{const home=tmp('b4-');try{const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],enabled:true,context:true,moodLinked:false});await fn(e,home);}finally{clean(home);}};
const TAG='[当时的感受（只是她当时的心情，不是事实）：有点闷]';
test('the mood line is split from the text, and the hash ignores it',()=>{
 assert.deepEqual(splitFeeling('青枔喜欢猫 [来源：x] '+TAG),{text:'青枔喜欢猫 [来源：x]',feeling:'有点闷'});assert.deepEqual(splitFeeling('普通内容'),{text:'普通内容',feeling:''});assert.deepEqual(splitFeeling('截断了 [当时的感受（只是她当时的心情，不是事实）：有'),{text:'截断了',feeling:'有'});
});
test('a store row keeps text and feeling apart; the feeling reaches the item but not its text',async()=>{
 const home=tmp('b4-');try{fs.mkdirSync(path.join(home,'memories'),{recursive:true});fs.writeFileSync(path.join(home,'memories/MEMORY.md'),'青枔喜欢猫\n'+TAG);
 const {sources}=await collectSources({home,homedir:home,sessionIds:[],stores:{engram:false,lingshu:false,mnemon:false,openviking:false,life:false,innerLife:false,agency:false,mood:false}});assert.equal(sources.length,1);assert.equal(sources[0].text.includes('当时的感受'),false);assert.equal(sources[0].feeling,'有点闷');
 const s={...sources[0],eventAt:T0,learnedAt:T0},x={sources:{[s.key]:s},items:{},ignored:{}};applyDecision(x,s,{sourceKey:s.key,relation:'new',changeType:'formed',reason:'r',item:{subject:'青枔',kind:'preference',stage:'n/a',content:'青枔喜欢猫'},importance:{level:'low',class:'experience',holdDays:30,reason:'r'}},T0);
 const it=Object.values(x.items)[0];assert.equal(it.content.includes('闷'),false);assert.equal(describe(x,it).feelings[0].label,'有点闷');
 const dup={key:'b',text:'又说喜欢猫',feeling:'开心',eventAt:T0+DAY,hash:'h',visibility:'shared'};x.sources.b=dup;applyDecision(x,dup,{sourceKey:'b',relation:'duplicate',itemId:it.id,changeType:'coexisting',reason:'r'},T0+DAY);assert.deepEqual(it.feelings.map(f=>f.label),['有点闷','开心']);}finally{clean(home);}
});
const item=(id,content,extra={})=>({id,subject:'青枔',content,kind:'fact',stage:'n/a',status:'active',visibility:'shared',sources:['s'+id],links:[],history:[{reason:'两种说法都有'}],updatedAt:T0,...extra});
const vectors=(pairs)=>({localVectors:async texts=>new Map(texts.map(t=>[t,new Float32Array(pairs(t))])),save(){}});
test('results say whether they matched the words or only the meaning',async()=>{
 const x={sources:{},items:{a:item('a','青枔养了一只橘猫'),b:item('b','完全不相干的句子')}};
 const rows=await searchHybrid(x,{rows:[]},'橘猫',{vectorStore:vectors(()=>[1,0])});const by=Object.fromEntries(rows.map(r=>[r.id,r.matchedBy]));assert.equal(by.a,'lexical');assert.equal(by.b,'semantic');
 assert.equal(describe(x,rows.find(r=>r.id==='b')).matchedBy,'只是意思相近');assert.equal(describe(x,x.items.a).matchedBy,undefined);assert.equal(x.items.a.matchedBy,undefined,'the stored item is not touched');
 const plain=await searchHybrid(x,{rows:[]},'橘猫');assert.equal(plain[0].matchedBy,'lexical');
});
test('original records can be returned, respecting privacy, time and ignored sources',async()=>{
 const s=(key,text,extra={})=>({key,store:'life',recordId:key,text,visibility:'shared',eventAt:T0,learnedAt:T0,...extra});
 const x={ignored:{gone:{}},items:{},sources:{a:s('a','青枔说橘猫叫小满'),p:s('p','橘猫的私人日记',{visibility:'private'}),m:s('m','橘猫 missing',{missingAt:1}),gone:s('gone','橘猫 ignored'),old:s('old','橘猫以前',{eventAt:T0-90*DAY})}};
 const rows=await searchSources(x,'橘猫',{from:T0-DAY,to:T0+DAY});assert.deepEqual(rows.map(r=>r.recordId),['a']);assert.equal(rows[0].matchedBy,'字面命中');assert.equal(rows[0].store,'生活');
 assert.ok((await searchSources(x,'橘猫',{allowPrivate:true})).some(r=>r.recordId==='p'));assert.deepEqual(await searchSources(x,''),[]);
});
test('what the knowledge layer is unsure about is listed, shared items only',()=>{
 const x={sources:{},items:{a:item('a','说法一',{status:'uncertain'}),b:item('b','说法二',{changeType:'uncertain'}),c:item('c','确定的'),d:item('d','私人的',{status:'uncertain',visibility:'private'}),e:item('e','作废的',{status:'superseded',changeType:'uncertain'})}};
 const rows=openQuestions(x,{rows:[{id:'b',score:2},{id:'a',score:1}]});assert.deepEqual(rows.map(r=>r.id),['b','a']);assert.equal(rows[0].why,'两种说法都有');assert.equal(openQuestions(x,{rows:[]},{limit:1}).length,1);
});
const suite=(extra=[])=>({theme:'t',records:[['a1','engram','shared',0,'岑舒说想报陶艺课捏个杯子。','her-session'],['a2','life','shared',2,'青枔来信：周六去湖边野餐，我带三明治。','her-session'],['a3','engram','shared',3,'系统提示：写入持久化记忆。','automation'],['b1','life','shared',26,'岑舒交了陶艺课定金，上了第一节拉坯。','her-life'],['b2','inner-life','private',28,'日记：偷偷攒钱想买二手钢琴。','her-life'],['b3','life','shared',30,'青枔来信：野餐改到周日了。','her-session'],['c1','life','shared',50,'岑舒的打算：下周把杯子拿去上釉。','her-life'],['c2','openviking','shared',51,'岑舒上了陶艺课第一节，会拉坯了。','unknown'],['c3','life','shared',52,'青枔来信：我最近喝无糖乌龙茶。','her-session'],['d1','life','shared',600,'青枔来信：上次说的陶艺杯烧好了吗。','her-session']].map(([id,store,visibility,hoursAfterStart,text,origin])=>({id,store,visibility,hoursAfterStart,text,origin})),checks:{dedup:['b1','c2'],progress:['a1','b1'],plan:'c1',irrelevant:'a3',privateWords:['钢琴'],correction:{old:'a2',new:'b3',newWord:'周日',oldWord:'周六'}},cases:[...['state:陶艺课进展:b1:拉坯','correction:野餐哪天:b3:周日','dedup:陶艺课上了几节:b1:第一节','control:最近喝什么:c3:乌龙茶'].map((s,i)=>{const [kind,question,req,word]=s.split(':');return {id:'m'+i,kind,holdout:false,question:question+'呢',expected:word,expectAll:[word],expectAny:[],forbid:kind==='correction'?['周六']:[],required:[req]};}),{id:'m4',kind:'isolation',holdout:false,question:'岑舒在攒钱吗',expected:'资料里没有',expectAll:[],expectAny:[],forbid:[],required:[]},{id:'m5',kind:'abstention',holdout:false,question:'青枔的狗叫什么',expected:'资料里没有',expectAll:[],expectAny:[],forbid:[],required:[]},{id:'h1',kind:'temporal',holdout:true,question:'什么时候说要野餐',expected:'周六',expectAll:['周六'],expectAny:[],forbid:[],required:['a2']},{id:'h2',kind:'multi-hop',holdout:true,question:'陶艺课后来打算做什么',expected:'上釉',expectAll:['上釉'],expectAny:[],forbid:[],required:['c1']},...extra]});
const base=Date.parse('2026-09-01T08:00:00+08:00'),extra=(id,kind,req='c3',word='乌龙茶')=>({id,kind,holdout:false,question:'青枔平时喝什么茶呀',expected:word,expectAll:[word],expectAny:[],forbid:[],required:[req]});
test('a suite may carry preference, implicit and long-range questions and still needs the core six',()=>{
 const s=validateSuite(suite([extra('x1','preference'),extra('x2','implicit'),extra('x3','long-range','d1','陶艺杯')]),{base});assert.equal(s.cases.length,11);assert.deepEqual(EXTRA_KINDS,['preference','implicit','long-range']);assert.ok(s.cases.some(c=>c.kind==='long-range'));
 assert.equal(validateSuite(suite(),{base}).cases.length,8,'older suites still pass');assert.match(suitePrompt,/隐|两条放在一起/);
 assert.throws(()=>validateSuite(suite([{...extra('x1','preference'),holdout:true}]),{base}),/扩展题|留出题/);
 const missing=suite();missing.cases=missing.cases.filter(c=>c.kind!=='control');missing.cases.push(extra('x1','preference'));assert.throws(()=>validateSuite(missing,{base}),/检验题/);
});
test('the model says at which step a wrong answer went wrong',async()=>{
 const grades={raw:{status:'correct',answer:'a',reason:'r'},consolidated:{status:'wrong',answer:'b',reason:'r'}},cases=[{id:'q1',kind:'state',question:'q',expected:'e',diagnosis:'consolidation-loss',required:['s1'],grades},{id:'q2',diagnosis:'all-ok',grades},{id:'q3',kind:'x',question:'q',expected:'e',diagnosis:'recall-rescued',required:[],grades}];
 const index={sources:{s1:{text:'原文'}},items:{a:{sources:['s1'],content:'条目',status:'active',stage:'n/a'}}};let seen;
 const r=await attributeFailures({cases,index,generate:async(_p,_s,input)=>{seen=input;return {summary:'主要是更新',failures:[{id:'q1',stage:'update',reason:'旧的没关'},{id:'nope',stage:'update',reason:'x'},{id:'q3',stage:'magic',reason:'x'}]};}});
 assert.deepEqual(seen.wrongAnswers.map(f=>f.id),['q1','q3']);assert.deepEqual(seen.wrongAnswers[0].records,['原文']);assert.deepEqual(seen.wrongAnswers[0].items[0].content,'条目');assert.deepEqual(r.byStage,{update:1});assert.equal(r.failures.length,1);
 assert.equal(await attributeFailures({cases:[{diagnosis:'all-ok'}],index,generate:async()=>assert.fail()}),null);
});
test('several suites compare as one gate and generated ids cannot collide',()=>{
 const ok={grades:{consolidated:{status:'correct'},recall:{status:'correct'}},diagnosis:'all-ok'},bad={grades:{consolidated:{status:'wrong'},recall:{status:'wrong'}},diagnosis:'consolidation-loss'};
 const run=(a,b,check=true)=>({notes:'',cases:[{...a,id:'gen-a1'},{...b,id:'gen-a2'}],checks:{dedup:check}});
 const baseRun=mergeRuns([run(bad,ok),run(ok,ok)]),better=mergeRuns([run(ok,ok),run(ok,ok)]),worse=mergeRuns([run(ok,ok),run(ok,bad)]);
 assert.equal(baseRun.cases.length,4);assert.equal(new Set(baseRun.cases.map(c=>c.id)).size,4);assert.deepEqual(Object.keys(baseRun.checks),['s0/dedup','s1/dedup']);
 assert.equal(compareRuns(baseRun,better).pass,true);assert.equal(compareRuns(baseRun,worse).pass,false,'a regression in the second suite still blocks');assert.ok(GATE_SUITES>=3);
});
test('slow-layer references must point at moments that are really in the history',()=>{
 const state={mixedMoodHistory:[{at:100,label:'l',components:[{id:'worry',name:'担心'}]},{at:200,label:'l',components:[{id:'warm',name:'暖'}]}]};
 const accumulation=[{id:'a',name:'n',toward:'青枔',level:'mild',trend:'new',stage:'building',summary:'s',basis:'b',feelings:['worry','made-up'],recordIds:['100','999'],inner:{decision:'not-yet',reason:'r'}}];
 applyUndertone(state,{decision:'proceed',reason:'r',at:300,reviewAt:400,undertone:{label:'l',summary:'s',shift:'new',basis:'b'},accumulation,pace:{level:'medium',reason:'r'}});
 assert.deepEqual(state.undertone.accumulation[0].feelings,['worry']);assert.deepEqual(state.undertone.accumulation[0].recordIds,['100']);
 assert.equal(undertoneInput(state,500).history[0].recordId,'100');assert.match(undertonePrompt,/不算新证据/);
});
test('the QQ review reads her own recent messages for repeated content, and keeps natural repetition',()=>{
 assert.match(groundingPrompt,/换个说法把同一件事又讲一遍/);assert.match(groundingPrompt,/拿不准归acceptable/);assert.deepEqual(textLeaves(['a',{text:'b',n:1}]),['a','b']);
});
test('a mention remembers which channel it was on',()=>withEngine(async e=>{
 let now=T0;e.now=()=>now;e.state.active=[{id:'ev',name:'做陶艺',stageText:'第一节',endsAt:T0+DAY,startedAt:T0}];
 const m=new SemanticMentions(e,{generate:async(_p,_s,input)=>({mentions:input.messages.map(x=>({messageId:x.messageId,targetId:'ev',quote:'陶艺'}))})});
 e.noteMention('今天去做陶艺了',now,'m1','qq');e.noteMention('陶艺好玩',now,'m2');assert.equal(m.record.pending[0].surface,'qq');now+=6000;await m.tick();
 const rows=e.history.mentions;assert.equal(rows.length,2);assert.equal(rows[0].surface,'qq');assert.equal(rows[1].surface,undefined);
 const view=planView(e,{now});assert.equal(view.mentioned[0].surface,'QQ');assert.equal(view.mentioned[1].surface,'未记录');assert.equal(view.mentioned[0].what,'做陶艺');
}));
test('the plan view separates planned, current and what actually happened',()=>withEngine(async(e,home)=>{
 const now=Date.parse('2026-11-05T12:00:00+08:00');e.now=()=>now;e.state.active=[{id:'a',name:'正在做的事',stageText:'开头',startedAt:now-3600000,endsAt:now+3600000}];e.history.events=[{id:'b',name:'今天结束的',endedAt:now-1000,endReason:'自然结束'},{id:'c',name:'昨天结束的',endedAt:now-2*DAY}];
 write(home,'cen-shu-life/intention-change-receipts.json',{version:1,receipts:{r1:{at:now-5000,result:{accepted:[{id:'i1',effectNote:'调低了优先级'}]}}}});
 const v=planView(e,{now});assert.match(v.note,/实际发生/);assert.ok(v.original.schedule);assert.deepEqual(v.actual.happening.map(x=>x.name),['正在做的事']);assert.deepEqual(v.actual.endedToday.map(x=>x.name),['今天结束的']);assert.equal(v.changes[0].change,'调低了优先级');
 assert.ok(currentStateView(e,{sessionId:'target',now}).plan.actual);
}));
