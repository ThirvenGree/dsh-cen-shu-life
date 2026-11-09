// 2026-11-09：一周看视频的回顾写进生活：和单条观看感受走同一条路，同一周不重复（临时目录）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {MemoryWriteback} from '../lib/memory-writeback.js';
import {sharedLifeContext} from '../lib/shared-context.js';

test('recordWatchRecap：写进观看印象和心情事件，同一周不重复，没授权或格式不对不写', () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-watch-recap-'));
  try{
    const e=new LifeEngine({home});e.saveConfig({sessionIds:['target'],enabled:true,context:true,lifeMoodEnabled:true,moodLinked:true});
    const w=new MemoryWriteback(e,{tools:{get:()=>false},agents:()=>[],generate:async()=>({memories:[]})});
    const shared=sharedLifeContext(e,w);
    assert.equal(shared.recordWatchRecap({weekId:'2026-11-02',text:'这周迷上了做饭视频。'}),null,'没有授权不写');
    assert.equal(shared.recordWatchRecap({weekId:'不是日期',text:'x',memoryEligible:true}),null);
    assert.equal(shared.recordWatchRecap({weekId:'2026-11-02',text:'  ',memoryEligible:true}),null);
    assert.ok(shared.recordWatchRecap({weekId:'2026-11-02',text:'这周迷上了做饭视频。',memoryEligible:true}));
    const events=JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life','mood-events.json'),'utf8')).events.filter(x=>x.eventId==='watch-week:2026-11-02');
    assert.equal(events.length,1);assert.match(events[0].stageText,/做饭视频/);
    shared.recordWatchRecap({weekId:'2026-11-02',text:'这周迷上了做饭视频。',memoryEligible:true});
    assert.equal(JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life','mood-events.json'),'utf8')).events.filter(x=>x.eventId==='watch-week:2026-11-02').length,1,'同一周不重复');
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
