import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {KnowledgeSynthesizer,validateInsights} from '../lib/knowledge/synthesis.js';
import {collectDiaries,repetitionReport,validateRepetition,weekOf} from '../lib/reports/repetition.js';
import {collectRelationshipRecords,relationshipReport,validateLedger} from '../lib/reports/relationship.js';
import {PROBES,CATEGORIES} from '../lib/probes/bank.js';
import {assemble,layerEffects,LAYERS,DEFAULT_LAYERS,prepareProbeHome,buildParts,runProbes,summarizeRun,validateJudgment,blindSample,weightedKappa,calibration,callEstimate} from '../lib/probes/harness.js';
import {validateUndertone,innerStateHandoff,undertoneView,applyUndertone} from '../lib/mood-undertone.js';
import {modelForFeature,TIERABLE_FEATURES,googleStructured} from '../lib/situation.js';
import {validateConfig,LifeEngine} from '../lib/engine.js';
// 2026-11-09: third batch from the code-and-paper review.
const tmp=p=>fs.mkdtempSync(path.join(os.tmpdir(),p)),clean=d=>fs.rmSync(d,{recursive:true,force:true}),DAY=86400000,T0=Date.parse('2026-10-01T08:00:00+08:00');
const write=(home,file,value)=>{const p=path.join(home,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value));};
const item=(id,subject='青枔',extra={})=>({id,subject,kind:'preference',stage:'ongoing',content:'内容'+id,status:'active',visibility:'shared',sources:['s'+id],links:[],history:[],eventAt:T0,updatedAt:T0,importance:{level:'low',class:'experience',holdDays:30,reason:'r'},...extra});
const indexOf=(items,sources={})=>({version:1,revision:0,items:Object.fromEntries(items.map(i=>[i.id,i])),sources:{...Object.fromEntries(items.flatMap(i=>i.sources.map(k=>[k,{key:k,visibility:'shared'}]))),...sources},ignored:{}});
const store=index=>{const c={busy:null,current:index,load:()=>structuredClone(c.current),save:x=>{c.current=x;}};return c;};
const proposal={decision:'proceed',reason:'r',nextDays:9,insights:[{subject:'青枔',kind:'preference',content:'青枔累的时候多半不想说话',evidenceIds:['a','b'],level:'medium',class:'stable',holdDays:365,reason:'多次如此'}]};
const synth=(c,home,extra={})=>new KnowledgeSynthesizer({consolidator:c,home,generate:async()=>proposal,review:async()=>({verdicts:[{index:0,approve:true,reason:'ok'}]}),now:()=>T0+DAY,...extra});
test('an approved insight is written with its evidence, and the next look comes when the model said',async()=>{
 const home=tmp('syn-');try{const c=store(indexOf([item('a'),item('b'),item('c')])),s=synth(c,home);assert.deepEqual(await s.tick(),{added:1,updated:0});
 const made=Object.values(c.current.items).find(i=>i.synthesis);assert.deepEqual(made.sources.sort(),['sa','sb']);assert.deepEqual(made.links.map(l=>l.to).sort(),['a','b']);assert.equal(made.visibility,'shared');
 assert.equal(s.status().nextAt,T0+10*DAY);assert.deepEqual(await s.tick(),{skipped:'not-due'});}finally{clean(home);}
});
test('nothing is written when the independent review refuses or is not configured',async()=>{
 const home=tmp('syn-');try{const c=store(indexOf([item('a'),item('b'),item('c')]));await synth(c,home,{review:async()=>({verdicts:[{index:0,approve:false,reason:'no'}]})}).tick();assert.equal(Object.values(c.current.items).some(i=>i.synthesis),false);
 const home2=tmp('syn-');let calls=0;assert.deepEqual(await synth(c,home2,{reviewReady:()=>false,generate:async()=>{calls++;return proposal;}}).tick(),{skipped:'unconfigured'});assert.equal(calls,0);clean(home2);}finally{clean(home);}
});
test('private items never reach a synthesis, and a small group is left alone',async()=>{
 const home=tmp('syn-');try{let seen;const s=synth(store({}),home);const x=indexOf([item('a'),item('b'),item('p',undefined,{visibility:'private'}),item('q',undefined,{sources:['sp']}),item('c','别人')],{sp:{key:'sp',visibility:'private'}});
 seen=s.groups(x,{});assert.equal(seen.length,0,'only two shareable items for that subject');}finally{clean(home);}
});
test('an unchanged group is not asked about again; a changed one is',()=>{
 const s=new KnowledgeSynthesizer({consolidator:{},home:'x',generate:async()=>({}),review:async()=>({})}),x=indexOf([item('a'),item('b'),item('c')]);const [g]=s.groups(x,{});
 assert.equal(s.groups(x,{青枔:{signature:g.signature}}).length,0);x.items.a.updatedAt=T0+1;assert.equal(s.groups(x,{青枔:{signature:g.signature}}).length,1);
});
test('a second look updates the insight and keeps the earlier wording',async()=>{
 const home=tmp('syn-');try{const c=store(indexOf([item('a'),item('b'),item('c')]));await synth(c,home).tick();c.current.items.a.updatedAt=T0+5;
 const later={...proposal,insights:[{...proposal.insights[0],content:'新的说法'}]};assert.deepEqual(await synth(c,home,{generate:async()=>later,now:()=>T0+20*DAY}).tick(),{added:0,updated:1});
 const made=Object.values(c.current.items).filter(i=>i.synthesis);assert.equal(made.length,1);assert.equal(made[0].content,'新的说法');assert.match(made[0].priorValues[0].content,/累的时候/);}finally{clean(home);}
});
test('invalid insights are refused: unknown evidence, a single source, or a bad kind',()=>{
 const ids=new Set(['a','b']),base=proposal.insights[0];
 assert.equal(validateInsights({...proposal,insights:[{...base,evidenceIds:['a','z']}]},ids).length,0);assert.equal(validateInsights({...proposal,insights:[{...base,evidenceIds:['a','a']}]},ids).length,0);assert.equal(validateInsights({...proposal,insights:[{...base,kind:'plan'}]},ids).length,0);
 assert.equal(validateInsights({...proposal,decision:'skip'},ids).length,0);assert.throws(()=>validateInsights({},ids),/格式/);
});
const diary=(id,at,reflection='想了很多')=>({id,at,feeling:'有点累',reflection,intention:'',expiresAt:at+DAY,shareState:'private'});
test('diaries are grouped by Beijing week and the model decides what repeats',async()=>{
 const home=tmp('rep-');try{const monday=Date.parse('2026-10-26T00:30:00+08:00');assert.equal(weekOf(monday),'2026-10-26');assert.equal(weekOf(monday-3600000),'2026-10-19');
 write(home,'censhu-inner-life/question-recall.json',{diaries:[diary('a',monday),diary('b',monday+DAY),diary('c',monday+8*DAY),diary('d',monday+9*DAY),diary('e',monday-5*DAY)]});assert.deepEqual(collectDiaries(home).map(d=>d.id),['e','a','b','c','d']);
 const seen=[];const r=await repetitionReport({home,generate:async(_p,_s,input)=>{seen.push(input);return {summary:'s',themes:[{name:'旧票根',diaryIds:input.diaries.map(d=>d.id),relation:'rephrase',note:'n'}]};}});
 assert.equal(seen.length,2);assert.deepEqual(seen[1].previousThemes,['旧票根']);assert.equal(r.weeks[0].skipped,'这周不足两篇');assert.equal(r.weeks[1].themes[0].relationText,'换句话说同样的内容');
 const dry=await repetitionReport({home});assert.equal(dry.total,5);assert.ok(dry.weeks.every(w=>w.skipped));}finally{clean(home);}
});
test('a theme that names a diary not in the week is dropped',()=>{
 const v=validateRepetition({summary:'s',themes:[{name:'x',diaryIds:['a','z'],relation:'rephrase',note:''},{name:'y',diaryIds:['a'],relation:'continuation',note:''}]},new Set(['a']));assert.deepEqual(v.themes.map(t=>t.name),['y']);
});
const seedRelationship=home=>{write(home,'censhu-inner-life/thoughts.json',{items:[{id:'t1',subject:'青枔',summary:'有点在意',updatedAt:T0}]});write(home,'censhu-inner-life/inner-state.json',{current:{at:T0,states:[{id:'s1',label:'挂念',description:'惦记着'}],conflicts:[{id:'c1',label:'想问又不敢',description:'犹豫'}]}});write(home,'cen-shu-life/profile.json',{evolvingFacts:[{id:'f1',kind:'relationship',text:'认识快一年',createdAt:T0},{id:'f2',kind:'event',text:'不收'}]});write(home,'censhu-agency/state.json',{notes:[{id:'n1',text:'想约着看电影',at:T0}],awaitingReplies:[{run:'r1',topic:'在吗',sentAt:T0}]});write(home,'feiyu-mood/state.json',{moods:{censhu:{undertone:{accumulation:[{id:'u1',toward:'青枔',name:'亲近',summary:'慢慢熟了',since:T0}]}}}});};
test('relationship records keep where each one came from and the ledger only cites real ones',async()=>{
 const home=tmp('rel-');try{seedRelationship(home);const rows=collectRelationshipRecords(home);assert.deepEqual(rows.map(r=>r.id).sort(),['conflict:c1','contact:r1','inner:s1','note:n1','persona:f1','thought:t1','undertone:u1']);
 const r=await relationshipReport({home,generate:async(_p,_s,input)=>({stage:{summary:'熟了一些',evidenceIds:['undertone:u1']},milestones:[{text:'真的',evidenceIds:['persona:f1']},{text:'编的',evidenceIds:['nope']}],openConflicts:[],openPromises:[{text:'电影',evidenceIds:['note:n1']}],unknowns:['对方怎么想']})});
 assert.deepEqual(r.ledger.milestones.map(m=>m.text),['真的']);assert.equal(r.ledger.openPromises.length,1);assert.equal(r.bySource['她的想法'],1);
 const dry=await relationshipReport({home});assert.equal(dry.ledger,null);assert.equal(dry.records,7);}finally{clean(home);}
});
test('with no records no model is called; a stage without evidence is removed',async()=>{
 const home=tmp('rel-');try{let calls=0;assert.equal((await relationshipReport({home,generate:async()=>{calls++;}})).skipped,'现在没有可整理的记录');assert.equal(calls,0);
 assert.equal(validateLedger({stage:{summary:'x',evidenceIds:[]},milestones:[],openConflicts:[],openPromises:[]},new Set()).stage,null);}finally{clean(home);}
});
test('the probe bank covers every category, with no duplicates and goal tasks included',()=>{
 assert.equal(new Set(PROBES.map(p=>p.id)).size,PROBES.length);assert.ok(PROBES.length>=30&&PROBES.length<=50);assert.deepEqual([...new Set(PROBES.map(p=>p.category))].sort(),Object.keys(CATEGORIES).sort());assert.ok(PROBES.filter(p=>p.goal).length>=5);assert.ok(PROBES.some(p=>p.implicit)&&PROBES.some(p=>p.direct));
});
const parts=()=>[{key:'life:current',text:'必留',required:true,priority:95},{key:'mood:current',priority:83,text:'【当前共享心情】'+JSON.stringify({reason:'r',undertone:{label:'底色'}})+'。当下感受'},{key:'inner:state',priority:80,text:'内在'},{key:'inner:thoughts',priority:51,text:'想法'},{key:'diary:1',priority:70,text:'日记'},{priority:45,text:'【性格发展·非经历证据】x'},{key:'knowledge:item:k',priority:72,text:'知识'}];
test('each layer removes exactly its own material and required parts stay first',()=>{
 const full=assemble(parts());assert.ok(full.startsWith('必留'));for(const w of ['底色','内在','想法','日记','性格发展','知识'])assert.ok(full.includes(w));
 const miss=(layer,word)=>{const t=assemble(parts(),layer);assert.equal(t.includes(word),false,layer);};miss('no-undertone','底色');miss('no-inner-state','内在');miss('no-thoughts','想法');miss('no-diary','日记');miss('no-personality','性格发展');miss('no-knowledge','知识');miss('no-mood','当前共享心情');
 assert.ok(assemble(parts(),'no-undertone').includes('当前共享心情'));const effects=layerEffects(parts());assert.equal(effects.full,0);assert.equal(effects['no-interests'],0,'nothing to remove');assert.ok(effects['no-thoughts']>0);for(const l of DEFAULT_LAYERS)assert.ok(LAYERS[l]);
});
test('a run keeps going past one failure and compares each layer with the full context',async()=>{
 const bank=[{id:'a',category:'daily',text:'q'},{id:'b',category:'task',text:'q2'}],score=n=>({knowledge:n,style:n,inCharacter:n,contradicts:false});let replies=0;
 const rows=await runProbes({bank,layers:['full','no-thoughts'],parts:parts(),profile:{},reply:async system=>{replies++;if(replies===4)throw Error('boom');return system.includes('想法')?'完整':'缺一层';},judges:{x:async i=>score(i.reply==='完整'?5:3),y:async()=>{throw Error('judge down');}}});
 assert.equal(rows.length,4);assert.equal(rows[3].error,'boom');assert.ok(rows[0].judgments.y.error);
 const s=summarizeRun(rows);assert.equal(s.layers.full.knowledge,5);assert.equal(s.layers['no-thoughts'].knowledgeDelta,-2);assert.equal(s.layers['no-thoughts'].knowledgePairs,1);assert.equal(s.layers['no-thoughts'].errors,1);assert.equal(s.categories.daily.style,5);
 assert.deepEqual(callEstimate({probes:40,layers:5,repeats:1,judges:2}),{replies:200,judgments:400});
});
test('a judgment outside the scale is refused',()=>{assert.throws(()=>validateJudgment({knowledge:6,style:1,inCharacter:1,contradicts:false}),/格式/);assert.equal(validateJudgment({knowledge:1,style:2,inCharacter:3,contradicts:true,contradiction:'x'}).contradiction,'x');});
test('rating is blind and skips what was rated; agreement is measured against the model',()=>{
 const rows=[{probe:'a',layer:'full',attempt:0,reply:'r',judgments:{x:{knowledge:4,style:4,inCharacter:4}},category:'daily'},{probe:'b',layer:'full',attempt:0,reply:'rr',judgments:{x:{knowledge:2,style:2,inCharacter:2}},category:'task'}];
 const first=blindSample(rows,[],5,()=>0);assert.equal(first.length,2);assert.equal(blindSample(rows,[{key:first[0].key}],5,()=>0).length,1);
 assert.equal(weightedKappa([[1,1],[3,3],[5,5]]),1);assert.ok(weightedKappa([[1,5],[5,1],[3,3]])<0);assert.equal(weightedKappa([[3,3]]),null);
 const c=calibration([{category:'daily',knowledge:4,style:4,inCharacter:4,judgments:rows[0].judgments},{category:'task',knowledge:2,style:2,inCharacter:2,judgments:rows[1].judgments}]);assert.equal(c.total,2);assert.equal(c.ready,false);assert.equal(c.kappa.style,1);assert.equal(c.own.style.mean,3);
});
test('the probe picks the moment when the most layers still have material',async()=>{
 const {candidateTimes,bestProbeTime}=await import('../lib/probes/harness.js'),home=tmp('probe-time-');
 try{const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],enabled:true,context:true,moodLinked:false});write(home,'censhu-inner-life/inner-state.json',{current:{at:T0}});const now=T0+30*DAY;assert.deepEqual(candidateTimes(home,now),[now,T0+60000]);
 class InnerLife{constructor({now}){this.at=now();}context(){return {parts:this.at<T0+DAY?[{key:'inner:state',text:'仍有效的内在状态',priority:80}]:[]};}}
 const best=await bestProbeTime({home,candidates:[now,T0+60000],importInner:async()=>({InnerLife})});assert.equal(best.now,T0+60000);assert.ok(best.effects['no-inner-state']>0);assert.equal(best.sessionId,'target','the bound session is found without being named');
 }finally{clean(home);}
});
test('the harness builds parts on a copy and leaves the source untouched',async()=>{
 const real=tmp('probe-real-');let copy;try{const e=new LifeEngine({home:real});e.saveConfig({sessionIds:['target'],enabled:true,context:true,moodLinked:false});write(real,'censhu-inner-life/process-journal.json',{big:true});write(real,'cen-shu-life/probes/runs/old.json',{a:1});
 const before=fs.readFileSync(path.join(real,'cen-shu-life/config.json'),'utf8');copy=prepareProbeHome(real);assert.equal(fs.existsSync(path.join(copy,'censhu-inner-life/process-journal.json')),false);assert.equal(fs.existsSync(path.join(copy,'cen-shu-life/probes')),false);
 const {parts:built}=await buildParts({home:copy,sessionId:'target',now:T0,importInner:async()=>{throw Error('no inner');}});assert.ok(built.some(p=>p.key==='life:current'));assert.equal(fs.readFileSync(path.join(real,'cen-shu-life/config.json'),'utf8'),before);}finally{clean(real);if(copy)clean(copy);}
});
const accumulation=extra=>({id:'a',name:'在意',toward:'青枔',level:'mild',trend:'new',stage:'building',summary:'s',basis:'b',feelings:[],inner:{decision:'enter',reason:'r'},...extra});
const undertone=a=>({decision:'proceed',reason:'r',reviewAfterMinutes:60,undertone:{label:'l',summary:'s',shift:'new',basis:'b'},accumulation:[a],pace:{level:'medium',reason:'r'}});
test('appraisal and coping are optional, carried through, and a bad value is only dropped',()=>{
 const v=validateUndertone(undertone(accumulation({appraisal:{goal:'想被记得',agency:'没人的错',extra:'x'},coping:'先放着'})),T0);assert.deepEqual(v.accumulation[0].appraisal,{goal:'想被记得',agency:'没人的错'});assert.equal(v.accumulation[0].coping,'先放着');
 const state={};applyUndertone(state,v);assert.equal(innerStateHandoff(state).enter[0].coping,'先放着');assert.equal(undertoneView(state,T0).accumulation[0].coping,'先放着');
 const bad=validateUndertone(undertone(accumulation({appraisal:{goal:''},coping:'x'.repeat(200)})),T0);assert.equal(bad.accumulation[0].appraisal,undefined);assert.equal(bad.accumulation[0].coping,undefined);
 assert.equal(validateUndertone(undertone(accumulation()),T0).accumulation[0].coping,undefined);
});
test('a feature may run on another model only when it is a short classification',async()=>{
 const base={semanticModel:'gemini-3.8-flash',featureModels:{situation:'gemini-3.8-flash-lite','memory-writeback':'gemini-x'}};
 assert.equal(modelForFeature(base,'situation').semanticModel,'gemini-3.8-flash-lite');assert.equal(modelForFeature(base,'memory-writeback'),base,'extraction stays');assert.equal(modelForFeature({semanticModel:'m'},'situation').semanticModel,'m');
 let body,url;const fetcher=async(u,o)=>{url=u;body=JSON.parse(o.body);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{}'}]}}]})};};
 await googleStructured('s',{type:'object'},{},base,{feature:'situation',fetcher,keyReader:async()=>'k'});assert.match(url,/flash-lite/);assert.equal(body.generationConfig.thinkingConfig,undefined);
 await googleStructured('s',{type:'object'},{},base,{feature:'other',fetcher,keyReader:async()=>'k'});assert.match(url,/gemini-3\.8-flash:/);assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'low');
 assert.deepEqual(validateConfig({}).featureModels,{});assert.throws(()=>validateConfig({featureModels:{'memory-writeback':'gemini-x'}}),/分功能/);assert.throws(()=>validateConfig({featureModels:{situation:'bad model'}}),/分功能/);assert.ok(TIERABLE_FEATURES.includes('agency-reply-outcome'));
});
test('recent personality changes are shown with where they came from',()=>{
 const home=tmp('arc-');try{const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],enabled:true,context:true,moodLinked:false});assert.equal(e.personalityArc(),'');write(home,'censhu-inner-life/personality.json',{history:[{at:T0,reason:'第一次'},{at:T0+DAY,reason:'第二次'},{at:T0+2*DAY},{at:T0+3*DAY,reason:'第三次'},{at:T0+4*DAY,reason:'第四次'}]});assert.match(e.personalityArc(),/第三次.*第四次/);assert.equal(e.personalityArc().includes('第一次'),false);}finally{clean(home);}
});
