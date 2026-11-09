// 2026-11-07：她开的子代理挂她此刻全部状态的只读副本；抖音私信 / 评论笔记送去记忆审核（临时目录）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {herSubagent,rootSessionId,isChildAgent,SUBAGENT_HEADER,SUBAGENT_POLICY} from '../lib/subagent-state.js';
import {LifeEngine} from '../lib/engine.js';
import {MemoryWriteback} from '../lib/memory-writeback.js';
import {sharedLifeContext} from '../lib/shared-context.js';

const agent=(id,extra={})=>({session:{id,header:{...(extra.header||{})}},...extra});

test('顺着父代理或会话头找到最上层会话', () => {
  const root=agent('session-root'),child=agent('child-1',{parent:root}),grand=agent('child-2',{parent:child});
  assert.equal(rootSessionId(grand),'session-root');
  const byHeader=agent('child-3',{header:{parentSession:'douyin-dm-202611071200',origin:'subagent'}});
  assert.equal(rootSessionId(byHeader,()=>undefined),'douyin-dm-202611071200');
  assert.equal(isChildAgent(root),false);assert.equal(isChildAgent(byHeader),true);
});

test('只有她的会话（绑定生活的、抖音三个会话）开的子代理才挂状态；测试会话开的不挂；顶层会话不挂', () => {
  const bound=id=>id==='session-root';
  const root=agent('session-root'),other=agent('session-other');
  assert.equal(herSubagent(agent('c1',{parent:root}),{bound,resolve:()=>undefined}),true);
  assert.equal(herSubagent(agent('c2',{parent:other}),{bound,resolve:()=>undefined}),false);
  assert.equal(herSubagent(agent('c3',{header:{parentSession:'douyin-revisit-202611071200'}}),{bound,resolve:()=>undefined}),true);
  const probe=agent('session-probe');
  assert.equal(herSubagent(agent('c4',{parent:probe}),{bound:()=>true,resolve:()=>undefined,isTest:a=>a===probe}),false);
  assert.equal(herSubagent(root,{bound,resolve:()=>undefined}),false);
  assert.match(SUBAGENT_HEADER,/只读副本/);assert.match(SUBAGENT_HEADER,/不直接写入生活、心情或记忆/);
});

test('开不开子代理由她判断：顶层会话的提示说明何时开、何时不用开', () => {
  assert.match(SUBAGENT_POLICY,/由你自己判断/);assert.match(SUBAGENT_POLICY,/subagent/);assert.match(SUBAGENT_POLICY,/不用开/);
});

test('recordDouyinNote：她写的私信 / 评论笔记带 noteId 送去记忆审核；不合格的不送', () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-douyin-note-'));
  try{
    const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],enabled:true,context:true});
    const w=new MemoryWriteback(e,{tools:{get:()=>false},agents:()=>[],generate:async()=>({memories:[]})});
    const shared=sharedLifeContext(e,w);
    assert.deepEqual(shared.recordDouyinNote({noteId:'n-0123456789abcdef0123',kind:'dm',who:'小林',note:'小林下周搬去杭州，之后问问她适应得怎么样',quote:'我下周搬去杭州了',memoryEligible:true}),{recorded:true,noteId:'n-0123456789abcdef0123'});
    assert.equal(w.record.sources.length,1);
    assert.equal(w.record.sources[0].watchId,'douyin-note:n-0123456789abcdef0123');
    assert.match(w.record.sources[0].text,/抖音私信里我想记下的/);
    assert.equal(shared.recordDouyinNote({noteId:'n-x',kind:'dm',note:'太短的编号',memoryEligible:true}),null);
    assert.equal(shared.recordDouyinNote({noteId:'n-0123456789abcdef9999',kind:'dm',note:'没许可',memoryEligible:false}),null);
    assert.equal(w.record.sources.length,1);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
