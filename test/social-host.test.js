import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';import {createHost} from '../lib/host.js';
test('actual session event observer covers chat and registered life, excludes unbound tests, forwards browser child evidence',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'social-host-')),prior=process.env.DSH_HOME;process.env.DSH_HOME=home;const effects=[],listeners=new Map(),services=new Map();
 try{
 const engine=new LifeEngine({home,now:()=>1000,random:()=>1});engine.saveConfig({enabled:true,context:false,sessionIds:['qq'],semanticEnabled:false,probability:0,moodLinked:false,contentEvolutionEnabled:false,weatherAutoEnabled:false,personaEvolutionEnabled:false,memoryWritebackEnabled:false,timedEventsEnabled:false});
 fs.mkdirSync(path.join(home,'censhu-inner-life'));engine.write('../censhu-inner-life/display-session.json',{sessionId:'life'});
 const agent=id=>({session:{id},ctx:{systemPrompt:{context:()=>()=>{}},on:()=>()=>{}}}),agents=['qq','life','test'].map(agent);
 createHost({agents:{roots:()=>agents},tools:{register:()=>()=>{},guard:()=>()=>{}},get:()=>undefined,provide:(name,s)=>services.set(name,s),webServer:{register:()=>()=>{}},interval:()=>()=>{},on:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);},effect:fn=>{const off=fn();if(typeof off==='function')effects.push(off);}},{engine,director:false});
 const emit=listeners.get('session/event');
 for(const sid of ['qq','life','test']){
  emit({id:sid},{type:'tool/call',data:{callId:'same-call',name:'bsk_inspect',arguments:{}}});
  emit({id:sid},{type:'tool/result',data:{message:{toolCallId:'same-call',content:[{type:'text',text:'普通网友的评论原文'}]}}});
 }
 const service=services.get('cenShuLifeShared');assert.equal(service.socialExperienceStatus().pending,2);
 assert.equal(service.observeSocialTool({sessionId:'test',sourceId:'child:1',tool:'bsk_inspect',text:'test'}),false);
 assert.equal(service.observeSocialTool({sessionId:'life',sourceId:'child:1',tool:'bsk_inspect',text:'已发表，replyId=42'}),true);
 const r=engine.read('social-experiences.json',{});assert.deepEqual(new Set(r.pending.map(x=>x.sessionId)),new Set(['qq','life']));assert.equal(r.pending.length,3);
 assert.equal(engine.changes.record.items.length,0,'raw third-party text is queued for understanding, never a user message');
 assert.equal(engine.read('recent-activity.json',{}).recent,undefined);
 const entry={id:'receipt1',platform:'bili',channel:'dm',scope:'peer:other',recordId:'1',text:'谢谢',status:'read',at:1000};assert.equal(service.observePlatformInteraction(entry),true);assert.equal(service.observePlatformInteraction(entry),true);assert.equal(service.socialExperienceStatus().pending,4);
 fs.mkdirSync(path.join(home,'characters/censhu'),{recursive:true});engine.write('../characters/censhu/integration.json',{sessionId:'qq'});
 const intention={timelineId:'plan1',at:1000,type:'选择稍后',detail:'等画完再看窗框的资料'};
 assert.equal(service.observeAgencyExperience(intention),true,'intentions without a running turn are retained');
 assert.equal(service.observeAgencyExperience(intention),false,'same timeline never enqueues twice');
 assert.equal(service.observeAgencyExperience({...intention,timelineId:'poll',type:'机会等待'}),false);
 assert.equal(service.observeAgencyExperience({...intention,timelineId:'native',type:'工具返回',tool:'douyin_chat_read'}),false,'native platform result has its own outbox');
 assert.equal(service.observeAgencyExperience({...intention,timelineId:'archive',type:'工具返回',tool:'censhu_private_archive',detail:'打开自己的旧画，看到当时留下的笔记'}),true,'private reading can be an experience');
 assert.equal(service.observeAgencyExperience({...intention,timelineId:'render',type:'工具返回',tool:'image_generate',detail:'生成结束，本地文件已保存'}),true);
 assert.equal(engine.read('recent-activity.json',{}).recent,undefined,'own actions are never Qingqin messages');

 }finally{effects.reverse().forEach(off=>off());if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;fs.rmSync(home,{recursive:true,force:true});}
});
