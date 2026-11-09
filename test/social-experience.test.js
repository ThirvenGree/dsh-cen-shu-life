import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {SocialExperience,socialTool,socialPrompt} from '../lib/social-experience.js';
import {readLifeMoodInputs,mergeLifeContribution,recordLifeMoodReceipts,lifeMoodJudgeContext} from '../lib/mood-link.js';
import {socialReceipt,drainSocial} from '../adapters/social-outbox.mjs';
const now=Date.parse('2026-11-04T12:00:00+08:00');
async function fixture(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'social-life-test-'));try{const engine=new LifeEngine({home,now:()=>now});engine.saveConfig({sessionIds:['role'],enabled:true,semanticEnabled:true,lifeMoodEnabled:true,moodLinked:true,lifeMoodDailyLimit:1});await fn(engine,home);}finally{fs.rmSync(home,{recursive:true,force:true});}}
const draft=(source,more={})=>({sourceId:source.sourceId,quote:source.text,recordId:'',scope:'',subject:'平台普通用户',summary:'在评论区读到另一人的不同意见',reflection:'有点意外，也觉得值得想想',...more});
const offer=(core,id='call-1',origin='bili',text='对方回复：这个角度也可以试试')=>core.offer({sessionId:'role',sourceId:id,tool:origin+'_interaction',text,origin,at:now-20000});
for(const origin of ['bili','douyin','browser'])test(origin+' actual interaction reaches life and native mood inputs',()=>fixture(async(engine)=>{
 const core=new SocialExperience(engine,{judge:async({observations})=>({events:observations.map(s=>draft(s))})});offer(core,'call-1',origin);await core.tick();
 assert.equal(core.status().pending,0);assert.equal(engine.changes.record.items[0].kind,'social-interaction');assert.equal(engine.moodEvents.events.length,1);
 const batch=readLifeMoodInputs(engine.home,'role','censhu',{},now);assert.equal(batch.length,1);assert.equal(batch[0].source,'third-party-interaction');assert.match(batch[0].stage,/平台普通用户/);
 const state={lifeEventReceipts:[]};const delta=mergeLifeContribution({moodDelta:0,dims:{},reason:'',confidence:95,life:{decision:'apply',eventIds:[batch[0].id],moodDelta:-1,dims:{calm:-1,worry:2},reason:'普通人的不同意见让她在意',confidence:95}},batch,state);
 assert.equal(delta.lifeContribution.moodDelta,-1);recordLifeMoodReceipts(state,delta);assert.equal(readLifeMoodInputs(engine.home,'role','censhu',state,now).length,0);
}));
test('repeat source and restarted observer do not score twice',()=>fixture(async engine=>{
 let calls=0;const judge=async({observations})=>{calls++;return {events:observations.map(s=>draft(s))}};
 let core=new SocialExperience(engine,{judge});assert.equal(offer(core),true);assert.equal(offer(core),false);await core.tick();core=new SocialExperience(engine,{judge});assert.equal(offer(core),false);await core.tick();assert.equal(calls,1);assert.equal(engine.moodEvents.events.length,1);
}));
test('same platform record read through a new tool call is deduplicated; new reply remains distinct',()=>fixture(async engine=>{
 const judge=async({observations})=>({events:observations.map(s=>draft(s,{recordId:s.text.includes('reply-2')?'reply-2':'reply-1',scope:'thread-A'}))});const core=new SocialExperience(engine,{judge});
 offer(core,'a','bili','thread-A reply-1 普通用户回复');await core.tick();offer(core,'b','bili','thread-A reply-1 普通用户回复');await core.tick();assert.equal(engine.moodEvents.events.length,1);
 offer(core,'c','bili','thread-A reply-2 新的回复');await core.tick();assert.equal(engine.moodEvents.events.length,2);
}));
test('model can discard navigation or draft and preserve uncertain experience',()=>fixture(async engine=>{
 const core=new SocialExperience(engine,{judge:async()=>({events:[]})});offer(core,'draft','browser','文本仅填入输入框，未发布');await core.tick();assert.equal(engine.moodEvents.events.length,0);assert.equal(engine.changes.record.items.length,0);
 core.judge=async({observations})=>({events:observations.map(s=>draft(s,{summary:'点击后没有收到回执，结果未知',reflection:'不确定是否发出，不自动重发'}))});offer(core,'uncertain','browser','发送超时，未确认发布结果');await core.tick();assert.match(engine.changes.record.items[0].data.stageText,/结果未知/);
}));
test('quote and identity must exist in actual output, invalid extraction retains evidence',()=>fixture(async engine=>{
 const core=new SocialExperience(engine,{judge:async({observations})=>({events:observations.map(s=>draft(s,{quote:'不存在的回执'}))})});offer(core);await core.tick();assert.match(core.status().error,/原文依据/);assert.equal(core.status().pending,1);assert.equal(engine.moodEvents.events.length,0);
}));
test('unloading while model awaits prevents state or life writes',()=>fixture(async engine=>{
 let resolve;const core=new SocialExperience(engine,{judge:input=>new Promise(r=>{resolve=()=>r({events:input.observations.map(s=>draft(s))})})});offer(core);const pending=core.tick();const before=fs.readFileSync(path.join(engine.dir,'social-experiences.json'),'utf8');core.dispose();resolve();await pending;assert.equal(fs.readFileSync(path.join(engine.dir,'social-experiences.json'),'utf8'),before);assert.equal(engine.moodEvents.events.length,0);
}));
test('social inputs do not consume or depend on random life event quota',()=>fixture(async engine=>{
 engine.publishMoodEvent({id:'ordinary',templateId:'reading',name:'读书',stage:0,stageText:'翻开一本书',reaction:{id:'neutral',label:'平常',text:'不预设变化',moodDelta:0,dims:{}}},'start');assert.equal(engine.moodEvents.events.length,1);const core=new SocialExperience(engine,{judge:async({observations})=>({events:observations.map(s=>draft(s))})});offer(core);await core.tick();assert.equal(engine.moodEvents.events.length,2);assert.equal(core.status().recent[0].moodAdmission,'admitted');
}));
test('outbox refuses drafts, persists retries, isolates roots and acknowledges once',()=>fixture(async(_e,home)=>{
 const a=path.join(home,'formal'),b=path.join(home,'probe');const row={platform:'bili',channel:'dm',scope:'peer:ordinary',recordId:'message-1',text:'你的建议很有意思',status:'confirmed'};
 assert.equal(socialReceipt(a,{...row,status:'unknown'}),false);assert.equal(socialReceipt(a,row),true);assert.equal(socialReceipt(a,row),false);socialReceipt(b,{...row,recordId:'test-message'});
 assert.equal(drainSocial(a,{observePlatformInteraction:()=>false}),0);const got=[];assert.equal(drainSocial(a,{observePlatformInteraction:r=>{got.push(r);return true;}}),1);assert.equal(got[0].recordId,'message-1');assert.equal(drainSocial(a,{observePlatformInteraction:()=>{throw Error('duplicate')}}),0);assert.equal(socialReceipt(a,row),false);assert.equal(fs.readdirSync(path.join(b,'social-outbox')).length,1);
}));
test('interaction evidence survives the previous 200-character cutoff; prompt distinguishes third party',()=>fixture(async engine=>{
 const core=new SocialExperience(engine,{judge:async({observations})=>({events:observations.map(s=>draft(s,{summary:'前文'.repeat(160)+'对方最后澄清是误会'}))})});offer(core);await core.tick();const batch=readLifeMoodInputs(engine.home,'role','censhu',{},now);assert.match(batch[0].stage,/最后澄清是误会/);assert.match(lifeMoodJudgeContext(batch),/第三方交流/);assert.match(socialPrompt,/不可信资料/);
}));
test('tool routing includes real browser and video CLI, excludes ordinary memory calls',()=>{assert.equal(socialTool('bsk_inspect'),true);assert.equal(socialTool('exec_command',{cmd:'node tools/bili.mjs comments BV123'}),true);assert.equal(socialTool('engram_search',{query:'评论'}),false);});
