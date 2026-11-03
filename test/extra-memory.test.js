import test from 'node:test';
import assert from 'node:assert/strict';
import {extraMemory,extraReadTool} from '../lib/extra-memory.js';
import {correctionTool} from '../lib/memory-correction.js';
import {petCorrection} from '../lib/pet-correction.js';
import {externalChecker,rememberRecord} from '../lib/memory-source-tracking.js';

test('OpenViking approved create, compare-and-replace and nonrecursive forget on an isolated server',{skip:!process.env.CENSHU_OV_FIXTURE},async()=>{
 const base=process.env.CENSHU_OV_FIXTURE,k=process.env.CENSHU_OV_FIXTURE_KEY;assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);assert.notEqual(new URL(base).port,'1933');
 const fetchJSON=async(p,opt={})=>{const r=await fetch(base+p,{...opt,headers:{'content-type':'application/json','X-API-Key':k}});const v=await r.json();return {ok:r.ok,status:r.status,error:v.error,result:v.result};};
 const store={},engine={config:{enabled:true},now:Date.now,bound:()=>true,read:(k,d)=>k.includes('integration')?{sessionId:'qq',qqPrivateId:'peer'}:structuredClone(store[k]??d),write:(k,v)=>{store[k]=structuredClone(v);}};
 const extra=extraMemory(engine,()=>({client:{fetchJSON}}));
 const f={kind:'preference',sessionId:'qq',id:'fixture-'+Date.now()};
 const uri=await extra.createApproved(f,'test before');assert.equal(await extra.createApproved(f,'test before'),uri);
 const args={backend:'openviking',target:'user',id:uri,action:'replace',original:'test before',replacement:'test after'};
 assert.ok((await extra.read({backend:'openviking'},'qq')).entries.length);
 assert.equal((await extra.read({backend:'openviking',id:uri},'qq')).text,args.original);
 let allowed=false;
 const tool=correctionTool(engine,{}, {extra,review:async()=>({allow:allowed,reason:'test'}),facts:()=>({key:'private:peer',messages:[{id:'one',role:'user',text:'fixture request'}]}),revoke(){}});
 const run=a=>tool.execute(a,{agent:{id:'qq'}});
 assert.equal(JSON.parse(await run(args)).status,'not-approved');allowed=true;
 assert.equal(JSON.parse(await run(args)).status,'verified');
 assert.equal((await extra.inspect(args,'qq','test after')).exact,true);
 await assert.rejects(extra.apply(args,'qq'),/已变化/);
 const del={...args,action:'remove',original:'test after',replacement:undefined};assert.equal(JSON.parse(await run(del)).status,'verified');
 assert.equal((await extra.inspect(del,'qq',del.original)).absent,true);
 await assert.rejects(extra.inspect({...args,id:'viking://user/other/memories/test.md'},'qq','text'));
});
test('external verification only revokes a proven change and keeps independent evidence',async()=>{
 const store={},engine={now:()=>1e6,bound:()=>true,read:(k,d)=>structuredClone(store[k]??d),write:(k,v)=>{store[k]=structuredClone(v)},profile:{evolvingFacts:[]},saveProfile(v){Object.assign(this.profile,v)}};
 const row={backend:'openviking',target:'user',id:'viking://user/fixture/memories/demo.md'};
 rememberRecord(engine,'qq',row,'same text');
 engine.profile.evolvingFacts=['memory:openviking_search','context:engram'].map((source,i)=>({id:'f'+i,evidence:[{id:'e'+i,source,text:'same text'}]}));
 await externalChecker(engine,async()=>{throw Error('offline')})();assert.equal(engine.profile.evolvingFacts.length,2);
 engine.now=()=>2e6;await externalChecker(engine,async()=>({absent:true}))();assert.deepEqual(engine.profile.evolvingFacts.map(x=>x.id),['f1']);
});

test('QQ correction uses the real scoped bridge routes and checks the persisted result',{skip:!process.env.CENSHU_QQ_HARNESS},async()=>{
 const {pathToFileURL}=await import('node:url'),{join}=await import('node:path'),fs=await import('node:fs/promises');
 const {bridgeHarness}=await import(pathToFileURL(process.env.CENSHU_QQ_HARNESS));
 const key='private:123',sid='fixture-sid';
 const h=await bridgeHarness({config:{socialV2:{tools:{memory:true}}},savedState:{sessions:{[key]:sid}}});
 let server;
 try{
  h.setMode('reserved2');server=h.startConsoleServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const st=h.getSocialV2State(key),headers={'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-token':st.agentToken};
  const path=join(h.temp,'config.json'),cfg=JSON.parse(await fs.readFile(path));cfg.consolePort=server.address().port;await fs.writeFile(path,JSON.stringify(cfg));
  const url='http://127.0.0.1:'+cfg.consolePort+'/api/socialV2/memory-';
  const call=async(route,body)=>fetch(url+route,{method:'POST',headers,body:JSON.stringify({key,category:'activeTopic',...body})});
  assert.equal((await call('append',{content:'old fixture'})).status,200);
  const store={},engine={config:{enabled:true},bound:id=>id===sid,now:Date.now,read:(k,d)=>k.includes('integration')?{sessionId:sid,qqPrivateId:'123'}:structuredClone(store[k]??d),write:(k,v)=>{store[k]=structuredClone(v)}};
  const extra=extraMemory(engine,()=>null,{root:h.temp}),s={backend:'qq',target:'activeTopic'};
  const read=extraReadTool(engine,extra);
  await assert.rejects(read.execute(s,{agent:{id:'foreign'}}),/绑定/);
  assert.ok(JSON.parse(await read.execute(s,{agent:{id:sid}})).entries.includes('old fixture'));
  const tool=correctionTool(engine,{}, {extra,facts:()=>({key,messages:[{id:'source',role:'user',text:'fixture authorization'}]}),review:async()=>({allow:true,reason:'fixture'}),revoke(){}});
  const run=(action,original,replacement)=>tool.execute({...s,action,original,replacement},{agent:{id:sid}}).then(JSON.parse);
  assert.equal((await run('replace','old fixture','new fixture')).status,'verified');
  assert.equal((await call('remove',{content:'new fixture',expectedOriginal:'old fixture'})).status,409);
  st.activeTopics.push({text:'new fixture'});assert.equal((await call('remove',{content:'new fixture',expectedOriginal:'new fixture'})).status,409);st.activeTopics.pop();
  assert.equal((await run('remove','new fixture')).status,'verified');
  assert.equal(h.calls.sent.length,0);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await h.close();}
});

test('Pet generic correction leaves the source intact until preview, user confirmation and approval',async()=>{
 let text='original',count=0,allow=false;
 const store={},engine={config:{enabled:true},now:Date.now,bound:id=>id==='main-session',read:(k,d)=>k.includes('integration')?{sessionId:'main-session'}:structuredClone(store[k]??d),write:(k,v)=>{store[k]=structuredClone(v)}};
 const extra={inspect:async(_a,_sid,expected)=>({exact:text===expected,absent:text!==expected}),apply:async(a)=>{count++;text=a.replacement;return {ok:true}}};
 const pet=petCorrection(engine,{},()=>({id:'main-session'}),{extra,revoke(){},review:async()=>({allow,reason:'fixture'})});
 const request='/更正记忆 '+JSON.stringify({backend:'openviking',target:'user',id:'viking://user/test/memories/events/one.md',original:text,replacement:'changed'});
 const confirm=async()=>{const msg=await pet('main',request);assert.match(msg,/原文：original/);assert.equal(count,0);return '/确认记忆 '+msg.match(/确认记忆 ([A-F0-9]{10})/)[1];};
 const first=await confirm();await assert.rejects(pet('main','/确认记忆 FFFFFFFFFX'));assert.match(await pet('main',first),/未执行/);assert.equal(text,'original');
 allow=true;const second=await confirm();assert.match(await pet('main',second),/已更正/);assert.equal(text,'changed');assert.equal(count,1);await assert.rejects(pet('main',second),/失效/);
});
