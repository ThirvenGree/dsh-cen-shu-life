import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
import {clock,LifeEngine,chooseMode} from '../lib/engine.js';
import {SituationClassifier,unknownSituation,createGoogleKeyReader,ruleSignals} from '../lib/situation.js';
import {createRequestGuard} from '../lib/request-guard.js';
import {readLifeSituation,readLifeMoodInputs,mergeLifeContribution,recordLifeMoodReceipts} from '../lib/mood-link.js';
import {createHost} from '../lib/host.js';
const at=Date.parse('2026-10-27T12:00:00Z');
const signal=extra=>({version:1,confidence:95,needsCare:false,careResolved:false,confession:false,offense:false,flirt:false,romance:false,source:'semantic-model',semanticState:'trusted',...extra});
const config={semanticEnabled:true,semanticModel:'gemini-3.8-flash',semanticTimeoutMs:100,semanticCacheMinutes:15};
async function fixture(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-v14-'));try{return await fn(home);}finally{fs.rmSync(home,{recursive:true,force:true});}}
const local=(date,hour)=>Date.parse(date+'T'+hour+':00+08:00');
test('weekend and official holidays have no commuting/work; compensatory weekend works',()=>{
 for(const date of ['2026-10-24','2026-10-25','2026-02-16','2026-02-20','2026-10-01','2026-10-07','2026-05-04','2026-06-19','2026-09-25'])for(const hour of ['07:30','08:59','10:00','16:00','17:30','19:29']){const c=clock(local(date,hour));assert.equal(c.workday,false,date);assert.doesNotMatch(c.activity,/上班|下班|档案馆/);}
 for(const date of ['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10'])assert.equal(clock(local(date,'10:00')).workday,true,date);
 assert.equal(clock(local('2026-10-08','10:00')).workday,true);
 assert.equal(clock(local('2027-10-01','10:00')).holiday,'国庆节');assert.equal(clock(local('2027-10-01','10:00')).calendarCoverage,'statutory-only');
});
test('holiday work templates are ineligible and weekly work text is suppressed',()=>fixture(home=>{const e=new LifeEngine({home,now:()=>local('2026-10-01','10:00')});const c=e.life();assert.equal(e.eligible({id:'work',category:'work',when:{weekday:true}},c,e.now()),false);assert.match(e.render({id:'normal',reason:'test'}),/国庆节休假/);}));
test('annoyed reaction stays fixed across stages, restart and quota exhaustion',()=>fixture(home=>{
 let now=at,draw=0;const e=new LifeEngine({home,now:()=>now,random:()=>draw});e.saveConfig({maxDaily:10,maxActive:10,probability:0,lifeMoodDailyLimit:0});
 const t={id:'annoying',name:'烦心小事',category:'personal',when:{},weight:1,cooldownHours:0,effect:'annoyed',stages:[{minutes:10,text:'开始'},{minutes:10,text:'继续'}]};e.templates.events.push(t);
 draw=.99;const a=e.add(t.id);assert.equal(a.reaction.id,'neutral');assert.equal(e.life().annoyed,false);draw=0;now+=11*60000;e.advance(now);assert.equal(e.life().annoyed,false);assert.equal(a.reaction.id,'neutral');assert.equal(e.moodEvents.events.length,0);
 e.end(a.id,'测试');now+=10*60000;draw=0;const b=e.add(t.id);const reaction=structuredClone(b.reaction);draw=.99;now+=11*60000;e.advance(now);assert.deepEqual(b.reaction,reaction);assert.equal(e.life().annoyed,reaction.id==='annoyed');
 const restarted=new LifeEngine({home,now:()=>now,random:()=>.99});assert.deepEqual(restarted.state.active[0].reaction,reaction);
}));
test('all uncertain semantic states stay unknown; rules do not mislabel reported regressions',async()=>{
 for(const text of ['我已经不难受了','我喜欢你推荐的那本书','我朋友今天好累']){const r=ruleSignals(text);assert.equal(r.needsCare,false);assert.equal(r.confession,false);}
 for(const classify of [async()=>{throw Error('offline');},async()=>signal({confidence:69,confession:true}),async()=>new Promise(()=>{})]){const c=new SituationClassifier({classify});const r=await c.resolve('s','我喜欢你推荐的那本书',{...config,semanticTimeoutMs:5});assert.equal(r.confession,false);assert.ok(r.confidence<70);}
});
test('circuit opens after consecutive failures and recovers after cooldown',async()=>{
 let now=0,calls=0,broken=true;const c=new SituationClassifier({now:()=>now,cooldownMs:100,classify:async()=>{calls++;if(broken)throw Error('offline');return signal();}});
 for(let i=0;i<3;i++)await c.resolve('s','failure'+i,config);assert.equal(calls,3);assert.equal((await c.resolve('s','fourth',config)).source,'circuit-open');assert.equal(calls,3);now=101;broken=false;assert.equal((await c.resolve('s','recover',config)).source,'semantic-model');assert.equal(c.failures,0);
});
test('Google key reader is async, cached and coalesces registry misses; env wins',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r);const reader=createGoogleKeyReader({env:{},platform:'win32',run:async()=>{calls++;await gate;return {stdout:'    GEMINI_API_KEY    REG_SZ    synthetic-test-value'};}});const a=reader(),b=reader();await Promise.resolve();assert.equal(calls,1);release();assert.equal(await a,await b);await reader();assert.equal(calls,1);
 let missed=0;const miss=createGoogleKeyReader({env:{},platform:'win32',run:async()=>{missed++;throw Error('absent');}});await miss();await miss();assert.equal(missed,2);
 const envReader=createGoogleKeyReader({env:{GEMINI_API_KEY:'synthetic'},platform:'win32',run:()=>{throw Error('must not spawn');}});assert.equal(await envReader(),'synthetic');
});
test('unknown results preserve trusted evidence and legacy fallback records are rejected',()=>fixture(home=>{
 const e=new LifeEngine({home,now:()=>at});e.saveConfig({sessionIds:['target']});e.storeSituation('target',signal({confession:true}));assert.equal(readLifeSituation(home,'target','censhu',at).confession,true);
 e.storeSituation('target',{...signal({confession:true}),source:'rules-fallback'});assert.equal(readLifeSituation(home,'target','censhu',at).confession,true);
 e.storeSituation('target',signal({resolvedModes:['panicked']}));assert.equal(readLifeSituation(home,'target','censhu',at).confession,false);
 fs.writeFileSync(path.join(e.dir,'semantic-situations.json'),JSON.stringify({version:1,records:{target:{at,value:signal({confidence:70,confession:true})}}}));assert.deepEqual(readLifeSituation(home,'target','censhu',at),{});
}));
test('semantic corrections immediately release contextual hold and recovery',()=>{
 const mood={ok:true,confidence:95,updatedAt:at,mood:70,baseline:70,dims:{}};
 const previous=chooseMode({mood,now:at,dialogue:signal({confession:true})});assert.equal(previous.id,'panicked');
 for(const dialogue of [signal({resolvedModes:['panicked']})]){const next=chooseMode({mood,now:at+1000,previous,dialogue});assert.equal(next.id,'normal');assert.equal(next.recovering,false);}
 const recovering={...previous,recovering:true,releaseAt:at+1800000};assert.equal(chooseMode({mood,now:at+5000,previous:recovering,dialogue:signal({resolvedModes:['panicked']})}).id,'normal');
});
test('modification guard rejects rebind, CSRF, foreign origins, ports and nonlocal peers',()=>{
 let now=0;const g=createRequestGuard({now:()=>now});const req=(patch={})=>({method:'POST',headers:{host:'127.0.0.1:3100','x-censhu-csrf':g.token,...patch},socket:{localPort:3100,remoteAddress:'127.0.0.1'}});
 for(const headers of [{host:'attacker.example:3100'},{origin:'http://evil.example:3100'},{origin:'null'},{host:'127.0.0.1:1'},{'x-censhu-csrf':''},{'sec-fetch-site':'cross-site'}])assert.throws(()=>g.check(req(headers),'/config'),e=>e.status===403);
 assert.throws(()=>g.check({...req(),socket:{remoteAddress:'192.168.1.1'}},'/config'));
 assert.doesNotThrow(()=>g.check(req({origin:'http://127.0.0.1:3100'}),'/config'));
 g.check(req(),'/content/update');assert.throws(()=>g.check(req(),'/content/update'),e=>e.status===429);now=10001;g.check(req(),'/content/update');
 assert.throws(()=>g.check({method:'GET',headers:{host:'evil.example'}},'/state'));
 assert.doesNotThrow(()=>g.check({method:'GET',headers:{host:'127.0.0.1:3100','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}},'/settings'));
 assert.throws(()=>g.check({method:'GET',headers:{host:'127.0.0.1:3100','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'iframe'}},'/settings'));
});
test('low confidence, rejected or omitted event decisions are consumed once without changing scores',()=>fixture(home=>{
 const e=new LifeEngine({home,now:()=>at,random:()=>0});e.saveConfig({sessionIds:['target']});e.add('reading');const batch=readLifeMoodInputs(home,'target','censhu',{},at);
 for(const life of [undefined,{confidence:10,eventIds:batch.map(x=>x.id),moodDelta:3},{confidence:95,eventIds:[],moodDelta:3}]){const state={};const d=mergeLifeContribution({moodDelta:0,dims:{},confidence:95,life},batch,state);assert.equal(d.moodDelta,0);assert.deepEqual(d.lifeAcceptedIds,[]);recordLifeMoodReceipts(state,d);assert.equal(readLifeMoodInputs(home,'target','censhu',state,at).length,0);}
}));
test('host waits for one classification, renders once without writes, and rejects stale results',()=>fixture(async home=>{
 let release,releaseTwo;const gate=new Promise(r=>release=r),gateTwo=new Promise(r=>releaseTwo=r);let calls=0;const e=new LifeEngine({home,now:()=>at});e.saveConfig({sessionIds:['session-target'],probability:0,contentEvolutionEnabled:false,weatherAutoEnabled:false});const classifier=new SituationClassifier({classify:async()=>{calls++;if(calls===1){await gate;return signal();}await gateTwo;return signal({confession:true});}});
 const listeners=new Map(),contexts=[],routes=new Map(),effects=[];let timer;
 const agent={session:{id:'session-target'},ctx:{systemPrompt:{context(v){contexts.push(v);return()=>{};}},on(k,fn){listeners.set(k,fn);return()=>{};}}};
 const ctx={agents:{roots:()=>[agent]},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.set(r.path,r.handler);return()=>{};}},effect:fn=>{const off=fn();if(typeof off==='function')effects.push(off);},interval:fn=>{timer=fn;return()=>{};},on:()=>()=>{}};
 createHost(ctx,{engine:e,classifier,director:false});assert.equal(listeners.has('system-prompt/assemble'),true);let renders=0;const context=e.context.bind(e);e.context=(...args)=>{renders++;return context(...args);};
 const inbox=listeners.get('agent/inbox/inserted');inbox({message:{content:[{type:'text',text:'我喜欢你推荐的那本书'}]}});
 timer();assert.notEqual(e.state.mode.id,'panicked');const disk=()=>fs.readdirSync(e.dir).filter(f=>fs.statSync(path.join(e.dir,f)).isFile()).map(f=>[f,fs.readFileSync(path.join(e.dir,f),'utf8'),fs.statSync(path.join(e.dir,f)).mtimeMs]);const before=disk();for(let i=0;i<5;i++)assert.doesNotMatch(contexts[0].text(),/当前行为模式：慌/);assert.deepEqual(disk(),before);
 let completed=false;const assembled=listeners.get('system-prompt/assemble')({contexts:[]}).then(x=>{completed=true;return x;});await Promise.resolve();assert.equal(completed,false);assert.equal(renders,0);release();const result=await assembled;assert.equal(calls,1);assert.equal(renders,1);assert.doesNotMatch(result.contexts[0].text,/当前行为模式：慌/);const after=disk();for(let i=0;i<5;i++)e.context('session-target',{dialogue:signal()});assert.deepEqual(disk(),after);inbox({message:{content:[{type:'text',text:'新消息，上一条已经结束'}]}});listeners.get('agent/turn-stopping')();releaseTwo();await new Promise(r=>setTimeout(r,5));assert.notEqual(e.state.mode.id,'panicked');
 let status;await routes.get('/dsh-cen-shu-life/content/update')({method:'POST',headers:{host:'evil.test'},socket:{}},{writeHead(s){status=s;},end(){}});assert.equal(status,403);
 for(const off of effects.reverse())off();
}));
