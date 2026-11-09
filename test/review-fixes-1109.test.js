import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {memoryDenied} from '../lib/reviewed-write.js';
import {adapters,collectSources} from '../lib/knowledge/sources.js';
import {KnowledgeConsolidator} from '../lib/knowledge/consolidate.js';
import {callHerName,nameParts} from '../lib/work-context.js';
import {ruleSignals,OPERATOR_TEXT} from '../lib/situation.js';
import {LifeEngine} from '../lib/engine.js';
import {MemoryWriteback} from '../lib/memory-writeback.js';
import {isReadOnlyTool} from '../lib/tool-semantics.js';
import {interactiveDesktop} from '../lib/desktop-bindings.js';
// 2026-11-09: fixes from the full review of the plugin.
const tmp=p=>fs.mkdtempSync(path.join(os.tmpdir(),p));
const withEngine=fn=>{const home=tmp('life-review-');try{const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],memoryWritebackEnabled:true});return fn(e,home);}finally{fs.rmSync(home,{recursive:true,force:true});}};
const denied=(name,args={})=>memoryDenied({name,arguments:args,callId:'x'});
test('engram_facts is a write only when it carries facts; examine and assess are open',()=>{
 assert.equal(denied('engram_facts',{facts:[{entity:'x',attribute:'y',value:'z'}]}),true);assert.equal(denied('engram_facts',{entity:'x'}),false);assert.equal(denied('engram_facts',{facts:[]}),false);
 assert.equal(denied('engram_examine',{ids:['a']}),false);assert.equal(denied('engram_assess',{batchId:'b'}),false);assert.equal(denied('engram_save',{content:'x'}),true);assert.equal(denied('engram_update',{id:'a'}),true);
});
const socialRow=(privateFlag=true)=>({sequence:1,id:'life:g:1',kind:'social-interaction',at:Date.now(),data:{eventId:'social:x',stage:0,stageText:JSON.stringify({summary:'网友在私信里说了自己的事',observedAt:Date.now(),privacy:'第三方交流资料，不是青枔来信；私信不可跨对象透露'}),private:privateFlag}});
test('third-party messages stay private in long-term knowledge',async()=>{
 const home=tmp('kn-social-');try{fs.mkdirSync(path.join(home,'cen-shu-life'),{recursive:true});fs.writeFileSync(path.join(home,'cen-shu-life/life-changes.json'),JSON.stringify({version:1,sequence:1,generation:'g',items:[socialRow()]}));
 const rows=await adapters({home,homedir:home,sessionIds:[]}).life();assert.equal(rows[0].visibility,'private');assert.equal(rows[0].rolling,true);}finally{fs.rmSync(home,{recursive:true,force:true});}
});
const src=(key,extra={})=>({key,store:'engram',recordId:key,scope:'user',text:'t'+key,origin:'x',reviewed:true,visibility:'shared',hash:'h'+key,...extra});
const consolidator=()=>new KnowledgeConsolidator({home:path.join(os.tmpdir(),'unused'),generate:async()=>({}),sourceOptions:()=>({}),now:()=>1000});
const index=()=>({sources:{},items:{i1:{id:'i1',status:'active',sources:['engram:old'],history:[]}},ignored:{}});
test('a read that stopped at its limit does not count as deletion',()=>{
 const c=consolidator(),x=index();c.sync(x,{sources:[src('engram:old')],status:{engram:{ok:true}}});c.sync(x,{sources:[src('engram:new')],status:{engram:{ok:true,partial:true}}});
 assert.equal(x.items.i1.status,'active');assert.equal(x.sources['engram:old'].missingAt,null);
});
test('a record that fell out of a rolling log does not count as deletion',()=>{
 const c=consolidator(),x=index();c.sync(x,{sources:[src('engram:old',{rolling:true})],status:{engram:{ok:true}}});c.sync(x,{sources:[],status:{engram:{ok:true}}});assert.equal(x.items.i1.status,'active');
});
test('a really deleted source still marks the item; it comes back with its source',()=>{
 const c=consolidator(),x=index();x.items.i1.status='uncertain';c.sync(x,{sources:[src('engram:old')],status:{engram:{ok:true}}});c.sync(x,{sources:[],status:{engram:{ok:true}}});assert.equal(x.items.i1.status,'unsupported');
 c.sync(x,{sources:[src('engram:old')],status:{engram:{ok:true}}});assert.equal(x.items.i1.status,'uncertain');assert.equal(x.sources['engram:old'].missingAt,null);assert.match(x.items.i1.history.at(-1).reason,/恢复/);
});
test('an item already corrected is not relabelled when its source goes away',()=>{
 const c=consolidator(),x=index();x.items.i1.status='superseded';c.sync(x,{sources:[src('engram:old')],status:{engram:{ok:true}}});c.sync(x,{sources:[],status:{engram:{ok:true}}});assert.equal(x.items.i1.status,'superseded');
});
test('stores report when a read stopped at its limit',async()=>{
 const home=tmp('kn-partial-');try{fs.mkdirSync(path.join(home,'memories'),{recursive:true});fs.writeFileSync(path.join(home,'memories/MEMORY.md'),Array.from({length:310},(_,i)=>'第'+i+'条').join(' § '));
 const {status}=await collectSources({home,homedir:home,sessionIds:[],stores:{engram:false,lingshu:false,mnemon:false,openviking:false,life:false,innerLife:false,agency:false,mood:false}});assert.equal(status.memoryEvolve.partial,true);assert.equal(status.memoryEvolve.count,300);}finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('"用户" becomes 青枔 only when it means the reader',()=>{
 for(const[a,b]of [['不用等用户开口','不用等青枔开口'],['如果用户要求','如果青枔要求'],['用户当下意愿','青枔当下意愿'],['当前用户的说明','当前青枔的说明'],['告诉用户结果。','告诉青枔结果。'],['（用户说的）','（青枔说的）']])assert.equal(callHerName(a),b);
 for(const s of ['评论区用户小林回了我','小红书用户说这本书不错','这个用户名我记得','普通用户看不到按钮','QQ用户','B站用户','用户协议'])assert.equal(callHerName(s),s);
});
test('her private content and life events keep their original wording',()=>{
 const out=nameParts([{key:'inner:thoughts',text:'用户小林'},{key:'x',owner:'inner',text:'用户小林'},{key:'life:event:1',text:'用户小林'},{key:'agency:current',text:'用户小林'},{key:'life:style',text:'用户当下'}]);
 assert.deepEqual(out.map(p=>p.text),['用户小林','用户小林','用户小林','用户小林','青枔当下']);
});
test('only operator text is filtered, not the word for a medical diagnosis',()=>withEngine(e=>{
 const w=new MemoryWriteback(e,{tools:{get:()=>true,execute:async()=>({})},agents:()=>[]});
 w.observe('target','医生诊断我是过敏性鼻炎，以后家里不能养猫');assert.equal(w.record.sources.length,1);
 w.observe('target','【诊断】检查一下这条链路');w.observe('target','模拟测试消息');w.observe('target','这是只读诊断');assert.equal(w.record.sources.length,1);
 assert.equal(OPERATOR_TEXT.test('诊断结果说要多休息'),false);assert.equal(OPERATOR_TEXT.test('运行诊断脚本'),true);
 assert.equal(ruleSignals('今天好累').needsCare,true);assert.deepEqual(ruleSignals('本机操作者：今天好累'),{});
}));
test('reading a page, scrolling and tidying context may repeat; acting may not',()=>{
 for(const name of ['browser_direct_inspect','bsk_inspect'])for(const action of ['observe','snapshot','extract','screenshot'])assert.equal(isReadOnlyTool({name,arguments:{action}}),true,name+action);
 for(const name of ['browser_direct_interact','bsk_interact']){assert.equal(isReadOnlyTool({name,arguments:{action:'scroll'}}),true);assert.equal(isReadOnlyTool({name,arguments:{action:'click'}}),false);assert.equal(isReadOnlyTool({name,arguments:{action:'fill'}}),false);}
 for(const name of ['compress','decompress','browser_interest'])assert.equal(isReadOnlyTool({name,arguments:{}}),true,name);
 assert.equal(isReadOnlyTool({name:'browser_direct_inspect',arguments:{action:'unknown'}}),false);assert.equal(isReadOnlyTool({name:'qq_send_message',arguments:{}}),false);
});
test('browser work sessions are not bound as chats with 青枔',()=>{
 assert.equal(interactiveDesktop({session:{id:'browser-browse-202611090101',header:{}}},new Set(),true),false);assert.equal(interactiveDesktop({session:{id:'session-normal',header:{}}},new Set(),true),true);
});
test('a moved watch row is not a gap; records really dropped are',()=>withEngine(e=>{
 const c=e.changes;c.append('event-start',{eventId:'a',stage:0});c.upsertWatch({eventId:'douyin:1',origin:'douyin',reflection:'one',complete:false});c.append('event-start',{eventId:'b',stage:0});const cursor=c.record.items[0].sequence;c.upsertWatch({eventId:'douyin:1',origin:'douyin',reflection:'two',complete:false});
 assert.equal(c.since(cursor).gap,false);assert.equal(c.since(cursor).items.length,2);
 c.record.items=Array.from({length:5000},(_,i)=>({sequence:i+10,id:'x'+i,kind:'event-stage',at:1,data:{}}));c.record.sequence=5009;c.append('event-start',{eventId:'z',stage:0});
 assert.equal(c.record.trimmedThrough,10);assert.equal(c.since(5).gap,true);assert.equal(c.since(10).gap,false);
}));
