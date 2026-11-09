// 2026-11-07：整体分头判断（Terra）：输出核对、只有一件事不调用模型、给她看的文字（假模型，不发网络请求）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {judgeParallel,normalizeDecision,decisionText,PARALLEL_SCHEMA,MAX_GROUPS} from '../lib/parallel-judge.js';

test('只有一件事时不调用模型', async () => {
  let called=false;
  const d=await judgeParallel({tasks:['回小林的私信'],review:async()=>{called=true;return {};}});
  assert.equal(called,false);assert.equal(d.parallel,false);assert.deepEqual(d.keepSelf,[0]);
});

test('把任务、她的状态交给 Terra，并按结构核对输出', async () => {
  let seen;
  const review=async(system,schema,input,_config,options)=>{seen={system,schema,input,options};return {parallel:true,reason:'三个人互不相关，都在等回复',groups:[{label:'小林',tasks:[0],brief:'她问周末爬山，按你的安排答'},{label:'阿周',tasks:[1,1,9],brief:'约稿的事'}],keepSelf:[2]};};
  const d=await judgeParallel({tasks:['回小林：周末爬山？','回阿周：约稿','回青枔：今晚吃什么'],state:'心情不错',review});
  assert.equal(seen.schema,PARALLEL_SCHEMA);assert.equal(seen.options.feature,'parallel-judge');
  assert.deepEqual(seen.input.tasks.length,3);assert.equal(seen.input.herState,'心情不错');
  assert.equal(d.parallel,true);assert.deepEqual(d.groups.map(g=>g.tasks),[[0],[1]],'越界和重复的编号去掉');
  assert.deepEqual(d.keepSelf,[2]);assert.equal(d.model,'gpt-6.1-terra');
  const text=decisionText(d,['小林','阿周','青枔']);
  assert.match(text,/建议分头处理/);assert.match(text,/子代理 1（小林）：「小林」/);assert.match(text,/你自己：「青枔」/);assert.match(text,/开不开、怎么分由你决定/);
});

test('不建议分头、组数上限、格式无效时报错', () => {
  const no=normalizeDecision({parallel:false,reason:'都是同一个人',groups:[{label:'x',tasks:[0]}],keepSelf:[]},2);
  assert.equal(no.parallel,false);assert.deepEqual(no.groups,[]);assert.deepEqual(no.keepSelf,[0,1]);
  assert.match(decisionText(no),/不建议开子代理/);
  const many=normalizeDecision({parallel:true,reason:'r',groups:Array.from({length:6},(_,i)=>({label:'g'+i,tasks:[i],brief:''})),keepSelf:[]},6);
  assert.equal(many.groups.length,MAX_GROUPS);assert.deepEqual(many.keepSelf,[4,5]);
  const single=normalizeDecision({parallel:true,reason:'r',groups:[{label:'all',tasks:[0,1],brief:''}],keepSelf:[]},2);
  assert.equal(single.parallel,false,'全部放进一组等于没分');
  assert.throws(()=>normalizeDecision({reason:'x'},2));
});

test('tasks 格式不对时拒绝', async () => {
  await assert.rejects(judgeParallel({tasks:['a',''],review:async()=>({})}));
  await assert.rejects(judgeParallel({tasks:'a',review:async()=>({})}));
});
