// 2026-11-07（第二轮完善）：Terra 分头判断的规则预判与资源约束；每天心情事件上限由模型动态决定（临时目录、假模型）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {judgeParallel,prefilter,normalizeTasks,normalizeDecision} from '../lib/parallel-judge.js';
import {MoodBudget,BUDGET_BOUNDS} from '../lib/mood-budget.js';
import {LifeEngine} from '../lib/engine.js';

test('规则能定的不问 Terra：同一个人的事、都要用同一个页面的事', async () => {
  let calls=0;const review=async()=>{calls++;return {parallel:true,reason:'r',groups:[],keepSelf:[]};};
  const same=await judgeParallel({tasks:[{text:'回小林 1',who:'p1',resource:'chat'},{text:'回小林 2',who:'p1',resource:'chat'}],review});
  assert.equal(same.parallel,false);assert.equal(same.rule,true);assert.match(same.reason,/同一个人/);
  const pages=await judgeParallel({tasks:[{text:'回甲的评论',who:'甲',resource:'page'},{text:'回乙的评论',who:'乙',resource:'page'}],review});
  assert.equal(pages.parallel,false);assert.match(pages.reason,/同一个抖音页面/);
  assert.equal(calls,0);
  assert.equal(prefilter(normalizeTasks(['a','b'])),null,'没写是谁、要用什么时交给 Terra');
});

test('Terra 的输出按约束核对：同一个人的事并到一组，用页面的组只留一个', () => {
  const list=normalizeTasks([{text:'甲1',who:'甲',resource:'chat'},{text:'甲2',who:'甲',resource:'chat'},{text:'乙评论',who:'乙',resource:'page'},{text:'丙评论',who:'丙',resource:'page'}]);
  const d=normalizeDecision({parallel:true,reason:'r',groups:[{label:'甲',tasks:[0]},{label:'乙',tasks:[1,2]},{label:'丙',tasks:[3]}],keepSelf:[]},4,list);
  assert.deepEqual(d.groups.map(g=>g.tasks.sort()),[[0,1],[2]],'甲的两件在一起；丙的页面任务留给她');
  assert.deepEqual(d.keepSelf,[3]);
});

test('Terra 拿到 who / resources 和规则说明', async () => {
  let input;await judgeParallel({tasks:[{text:'回甲',who:'甲',resource:'chat'},{text:'回乙',who:'乙',resource:'chat'}],review:async(_s,_sc,i)=>{input=i;return {parallel:true,reason:'两人无关',groups:[{label:'甲',tasks:[0],brief:''},{label:'乙',tasks:[1],brief:''}],keepSelf:[]};}});
  assert.deepEqual(input.who,['甲','乙']);assert.deepEqual(input.resources,['chat','chat']);assert.match(input.rules,/page/);
});

function engineWith(events=[]){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-budget-'));
  const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],enabled:true,lifeMoodEnabled:true,moodLinked:true,semanticEnabled:true,lifeMoodDailyLimit:8});
  const day=e.moodDay();e.moodEvents={events:events.map((x,i)=>({id:'e'+i,eventId:'e'+i,templateId:x,name:x,phase:'start',stage:0,at:e.now(),day,reaction:{label:'x'}}))};
  return {e,home,day};
}

test('心情上限：没有结论用设置里的固定值；模型结论夹在 4～24 且不低于今天已用的；每 3 小时最多问一次，快用满时提前问', async () => {
  const {e,home}=engineWith(['media-douyin','life-a','life-b','social-douyin']);
  try{
    let calls=0,answer=30;const b=new MoodBudget(e,{generate:async(_s,_sc,input)=>{calls++;if(calls===1)assert.equal(input.used,3,'社交经历不算在内');return {limit:answer,reason:'今天事情多'};}});
    e.moodBudget=b;
    assert.equal(b.limit(),8);assert.equal(e.moodDailyLimit(),8);
    await b.maybeTune();assert.equal(calls,1);assert.equal(b.limit(),BUDGET_BOUNDS[1]);assert.equal(e.moodDailyLimit(),24);assert.equal(b.status().source,'model');
    await b.maybeTune();assert.equal(calls,1,'3 小时内不再问');
    answer=1;await b.maybeTune({force:true});assert.equal(b.limit(),4,'不低于下限');
    const now=e.now();e.now=()=>now+31*60000;for(let i=0;i<3;i++)e.moodEvents.events.push({id:'x'+i,eventId:'x'+i,templateId:'life-x',name:'x',phase:'start',stage:0,day:e.moodDay(),at:now,reaction:{label:'x'}});
    await b.maybeTune();assert.equal(calls,3,'快用满（剩 1 个以内）提前问');assert.ok(b.limit()>=b.used(),'不低于已用的');
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('发心情事件时按模型给的上限放行', () => {
  const {e,home}=engineWith(['life-a','life-b','life-c','life-d']);
  try{
    e.moodBudget={limit:()=>4};
    const ev={id:'new-1',templateId:'media-douyin',name:'n',stage:0,stageText:'t',reaction:{id:'pending-model',label:'l',text:'t',moodDelta:0,dims:{happy:0,calm:0,sad:0}}};
    e.publishMoodEvent(ev,'start');assert.equal(ev.moodAdmission,'daily-limit');
    e.moodBudget={limit:()=>6};const ev2={...ev,id:'new-2',moodAdmission:undefined};e.publishMoodEvent(ev2,'start');assert.equal(ev2.moodAdmission,'admitted');
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
