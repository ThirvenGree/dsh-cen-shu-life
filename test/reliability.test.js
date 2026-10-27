import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {LifeEngine} from '../lib/engine.js';
import {mergeDefaults} from '../lib/defaults-store.js';
import {adapterHealth,sourceHash,verifyAdapterSource} from '../lib/adapter-health.js';
import {SituationClassifier,ruleSignals,validateSituation,googleSituation} from '../lib/situation.js';
import {ContentEvolution,validateContent} from '../lib/content-evolution.js';
async function fixture(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-reliability-'));try{return await fn(home);}finally{fs.rmSync(home,{recursive:true,force:true});}}
const files=dir=>Object.fromEntries(fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()).map(f=>[f,{hash:createHash('sha256').update(fs.readFileSync(path.join(dir,f))).digest('hex'),mtime:fs.statSync(path.join(dir,f)).mtimeMs}]));
const signals=extra=>({version:1,confidence:95,needsCare:false,careResolved:false,confession:false,offense:false,flirt:false,romance:false,...extra});
test('default merge upgrades untouched fields, preserves edits and intentional deletions',()=>{
 const base={a:'old',b:'old',nested:{one:1,two:2},list:[{id:'x',text:'old'},{id:'gone',text:'old'}]};
 const current={a:'old',b:'user edit',nested:{one:9},list:[{id:'x',text:'custom'}]};
 const next={a:'new',b:'new',nested:{one:2,two:3,new:4},list:[{id:'x',text:'new'},{id:'gone',text:'new'},{id:'added',text:'new'}]};
 assert.deepEqual(mergeDefaults(base,current,next),{a:'new',b:'user edit',nested:{one:9,new:4},list:[{id:'x',text:'custom'},{id:'added',text:'new'}]});
});
test('a subsequent startup receives new bundled profile, templates and rules without overwriting user data',()=>fixture(home=>{
 const e=new LifeEngine({home});const old=structuredClone(e.bundled);e.saveProfile({name:'用户名字'});e.saveConfig({modeRules:{...e.config.modeRules,low:'用户自己的低落规则'}});
 const next=structuredClone(old);next.profile.name='上游新名字';next.profile.background='新默认背景';next.modeRules.normal='新的常态规则';next.modeRules.low='新的低落规则';next.events.events.push({...structuredClone(next.events.events[0]),id:'new-default',name:'新增默认事件'});
 const upgraded=new LifeEngine({home,bundledDefaults:next});assert.equal(upgraded.profile.name,'用户名字');assert.equal(upgraded.profile.background,'新默认背景');assert.equal(upgraded.config.modeRules.low,'用户自己的低落规则');assert.equal(upgraded.config.modeRules.normal,'新的常态规则');assert.ok(upgraded.templates.events.some(t=>t.id==='new-default'));
 assert.equal(new LifeEngine({home,bundledDefaults:next}).defaultUpdates.length,0);
}));
test('state reads never roll events, advance stages, change modes, write files or call a model',()=>fixture(home=>{
 let now=Date.parse('2026-10-27T12:00:00Z'),rolls=0;const e=new LifeEngine({home,now:()=>now,random:()=>{rolls++;return 0;}});e.saveConfig({sessionIds:['target'],probability:1,moodLinked:false});e.add('reading');e.state.mode={id:'low',since:now,updatedAt:now,reason:'fixture',priority:40};e.persist();now+=5*86400000;const disk=files(e.dir),state=structuredClone(e.state),history=structuredClone(e.history),count=rolls;
 for(let i=0;i<10;i++)e.snapshot();assert.equal(rolls,count);assert.deepEqual(e.state,state);assert.deepEqual(e.history,history);assert.deepEqual(files(e.dir),disk);
}));
test('adapter health reports overwrite and hash drift without modifying anything',()=>fixture(home=>{
 const dir=path.join(home,'cen-shu-life'),root=path.join(home,'mood/lib');fs.mkdirSync(dir);fs.mkdirSync(root,{recursive:true});const file=path.join(root,'index.js');
 const source='// cen-shu-life adapter-protocol:3\nreadLifeMoodInputs(CFG_DIR\nreadLifeSituation(CFG_DIR\nmergeLifeContribution(delta\nrecordLifeMoodReceipts(s, delta)\nd.lifeEventReceipts =\nd.behaviorContext =\ns.behaviorContext =\nlife: obj.life\nexport const cenShuLifeAdapterProtocol = 3';assert.equal(verifyAdapterSource(source),true);fs.writeFileSync(file,source);fs.writeFileSync(path.join(dir,'mood-link-install.json'),JSON.stringify({protocol:3,moduleUrl:pathToFileURL(file).href,sourceSha256:sourceHash(source),installedAt:10}));
 assert.equal(adapterHealth(home,{startedAt:5}).code,'restart_required');assert.equal(adapterHealth(home,{startedAt:20}).ready,true);fs.appendFileSync(file,'\n// upgrade');assert.equal(adapterHealth(home).code,'source_changed');fs.writeFileSync(file,'export const upgraded = true');const before=files(dir);assert.equal(adapterHealth(home).code,'adapter_missing');assert.deepEqual(files(dir),before);
}));
test('semantic classification deduplicates in-flight work and caches per session and text',async()=>{
 let calls=0;const classifier=new SituationClassifier({classify:async()=>{calls++;return signals({confession:true});}}),cfg={semanticEnabled:true,semanticModel:'gemini-3.8-flash',semanticProxyUrl:'',semanticCacheMinutes:15,semanticTimeoutMs:500};
 const [a,b]=await Promise.all([classifier.resolve('one','我很喜欢你',cfg),classifier.resolve('one','我很喜欢你',cfg)]);assert.equal(a.confession,true);assert.deepEqual(a,b);await classifier.resolve('one','我很喜欢你',cfg);assert.equal(calls,1);await classifier.resolve('two','我很喜欢你',cfg);assert.equal(calls,2);
});
test('semantic errors, malformed results and timeout use visible conservative fallback',async()=>{
 for(const classify of [async()=>{throw Error('HTTP 404 model missing');},async()=>({reason:'invalid free text'}),async()=>new Promise(()=>{})]){const c=new SituationClassifier({classify});const x=await c.resolve('one','我好喜欢你',{semanticEnabled:true,semanticModel:'gemini-3.8-flash',semanticCacheMinutes:15,semanticTimeoutMs:15});assert.equal(x.confession,false);assert.equal(x.confidence,0);assert.equal(x.source,'unavailable');assert.equal(c.status.state,'degraded');}
 assert.throws(()=>validateSituation({version:1,confidence:90,reason:'太累'}));
});
test('Google client uses exact selected model, strict schema and existing environment key without exposing it',async()=>{
 let request;const value=await googleSituation('我好喜欢你',{semanticModel:'gemini-3.8-flash',semanticProxyUrl:''},{keyReader:()=> 'synthetic-credential',fetcher:async(url,init)=>{request={url,init};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(signals({confession:true}))}]}}]})};}});assert.equal(value.confession,true);assert.match(request.url,/gemini-3\.8-flash:generateContent$/);assert.equal(request.init.headers['x-goog-api-key'],'synthetic-credential');assert.ok(JSON.parse(request.init.body).generationConfig.responseJsonSchema.required.includes('confession'));
});
const goodContent={version:1,templates:[{name:'整理一小叠便签',category:'personal',startHour:18,endHour:22,cooldownHours:168,stages:[{minutes:30,text:'抽空整理桌上的几张便签'}]}],scheduleNotes:[{startHour:19,endHour:22,text:'有空时可以放慢节奏'}],behaviorNotes:[{mode:'normal',text:'自然接话，不硬开新话题'}]};
test('generated content is bounded data and cannot become plugin code or overwrite base identity',()=>{
 assert.equal(validateContent(goodContent).templates[0].origin,'model-content');assert.throws(()=>validateContent({...goodContent,templates:[{...goodContent.templates[0],name:'执行命令'}]}));assert.throws(()=>validateContent({...goodContent,behaviorNotes:[{mode:'unknown',text:'改身份'}]}));
});
test('content updates coalesce, preserve manual settings, and keep last good data on failure',()=>fixture(async home=>{
 let now=100000,calls=0;const e=new LifeEngine({home,now:()=>now});e.saveProfile({name:'用户保留名字'});const before=fs.readFileSync(path.join(e.dir,'profile.json'),'utf8');const manager=new ContentEvolution(e,{generate:async()=>{calls++;return goodContent;}});await Promise.all([manager.refresh(true),manager.refresh(true)]);assert.equal(calls,1);assert.equal(e.allTemplates().length,e.templates.events.length+1);assert.equal(fs.readFileSync(path.join(e.dir,'profile.json'),'utf8'),before);const saved=structuredClone(e.content);manager.generate=async()=>{throw Error('network unavailable');};await manager.refresh(true);assert.deepEqual(e.content,saved);assert.equal(manager.view().status,'degraded');await manager.refresh();assert.equal(calls,1);assert.deepEqual(e.content,saved);
}));

 test('fallback distinguishes liking handwriting from confession and recognizes bare fatigue',()=>{
 assert.equal(ruleSignals('我很喜欢你写的字').confession,false);assert.equal(ruleSignals('太累').needsCare,true);
 });
 test('edited upstream-removed items remain complete',()=>{assert.deepEqual(mergeDefaults([{id:'old',text:'base'}],[{id:'old',text:'custom'}],[]),[{id:'old',text:'custom'}]);});
