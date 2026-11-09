// 2026-11-07：只看没写感受的抖音视频汇总成一次心情事件：只影响心情，不写生活印象、不进记忆（临时目录）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {MemoryWriteback} from '../lib/memory-writeback.js';
import {sharedLifeContext} from '../lib/shared-context.js';

test('recordDouyinGlance：发一次心情事件，同一轮不重复，不送记忆审核', () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-douyin-glance-'));
  try{
    const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],enabled:true,context:true,lifeMoodEnabled:true,moodLinked:true});
    const w=new MemoryWriteback(e,{tools:{get:()=>false},agents:()=>[],generate:async()=>({memories:[]})});
    const shared=sharedLifeContext(e,w);
    const videos=[{videoId:'7300000000000000002',title:'猫',excerpt:'猫打翻了水杯'},{videoId:'7300000000000000003',title:'夜景',excerpt:''}];
    const first=shared.recordDouyinGlance({roundId:'her:0123456789',videos,summary:'挺放松',memoryEligible:true});
    assert.equal(first.recorded,true);
    const events=JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life','mood-events.json'),'utf8')).events;
    const ev=events.find(x=>x.eventId==='douyin-glance:her:0123456789');
    assert.ok(ev,'写进了心情事件');assert.equal(ev.templateId,'media-douyin');assert.match(ev.stageText,/2 条没写感受的视频/);assert.match(ev.stageText,/猫打翻了水杯/);assert.equal(ev.reaction.id,'pending-model');
    assert.deepEqual(shared.recordDouyinGlance({roundId:'her:0123456789',videos,memoryEligible:true}),{recorded:false,duplicate:true});
    assert.equal(w.record.sources.length,0,'不送记忆审核');
    assert.equal(shared.recordDouyinGlance({roundId:'her:0123456789x',videos,memoryEligible:false}),null);
    assert.equal(shared.recordDouyinGlance({roundId:'her:abcdefgh',videos:[],memoryEligible:true}),null);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

// 2026-11-08：B 站同样的入口（recordBiliGlance），规则一样。
test('recordBiliGlance：B 站一轮只看没写的视频发一次心情事件，同一轮不重复，不送记忆审核', () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-bili-glance-'));
  try{
    const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],enabled:true,context:true,lifeMoodEnabled:true,moodLinked:true});
    const w=new MemoryWriteback(e,{tools:{get:()=>false},agents:()=>[],generate:async()=>({memories:[]})});
    const shared=sharedLifeContext(e,w);
    const videos=[{title:'打哈欠的猫',excerpt:'【画面】一只猫在打哈欠'}];
    assert.equal(shared.recordBiliGlance({roundId:'bili:bili-whale-1794',videos,memoryEligible:true}).recorded,true);
    const events=JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life','mood-events.json'),'utf8')).events;
    const ev=events.find(x=>x.eventId==='bili-glance:bili:bili-whale-1794');
    assert.ok(ev);assert.equal(ev.templateId,'media-bili');assert.match(ev.stageText,/刷B站时看了 1 条没写感受的视频/);
    assert.deepEqual(shared.recordBiliGlance({roundId:'bili:bili-whale-1794',videos,memoryEligible:true}),{recorded:false,duplicate:true});
    assert.equal(w.record.sources.length,0,'不送记忆审核');
    assert.equal(shared.recordBiliGlance({roundId:'bili:bili-whale-1795',videos,memoryEligible:false}),null);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
