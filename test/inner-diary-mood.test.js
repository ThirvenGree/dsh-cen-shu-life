import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {sharedLifeContext} from '../lib/shared-context.js';
import {readLifeMoodInputs} from '../lib/mood-link.js';
// 2026-11-08: a reviewed solitude diary reaches the mood as one event, without needing an original life event.
const fixture=fn=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'inner-diary-'));try{const e=new LifeEngine({home});e.saveConfig({sessionIds:['main'],moodLinked:true,lifeMoodEnabled:true,moodSlot:'censhu'});return fn(e,sharedLifeContext(e,{}));}finally{fs.rmSync(home,{recursive:true,force:true});}};
const diary=(id='inner:one')=>({sessionId:'main',id,mood:{qualitative:true,diary:true,feeling:'汤在锅里咕嘟着，守着反倒定下来。'}});
const queued=e=>e.moodEvents.events.filter(x=>x.templateId==='inner-diary');
test('a reviewed diary queues one mood event that the mood plugin can read',()=>fixture((e,shared)=>{
 assert.equal(shared.submitInnerResult(diary()).mood,'queued');
 assert.equal(queued(e).length,1);assert.equal(queued(e)[0].id,'inner:one:diary');
 const [input]=readLifeMoodInputs(e.home,'main','censhu',{},e.now());
 assert.equal(input.id,'inner:one:diary');assert.match(input.event,/不要把旧事当成新事件/);assert.match(input.reaction.text,/汤在锅里/);
}));
test('the same diary is only counted once, including after a restart',()=>fixture((e,shared)=>{
 shared.submitInnerResult(diary());assert.equal(shared.submitInnerResult(diary()).mood,'duplicate');
 const restarted=new LifeEngine({home:e.home,now:e.now});assert.equal(sharedLifeContext(restarted,{}).submitInnerResult(diary()).mood,'duplicate');
 assert.equal(queued(restarted).length,1);
 assert.equal(shared.submitInnerResult(diary('inner:two')).mood,'queued');assert.equal(queued(e).length,2);
}));
test('a write interrupted before the queue is saved recovers without a second event',()=>fixture((e,shared)=>{
 let fail=true;const write=e.write.bind(e);e.write=(name,value)=>{if(name==='mood-events.json'&&fail){fail=false;throw Error('disk interruption');}return write(name,value);};
 assert.throws(()=>shared.submitInnerResult(diary()),/disk/);
 assert.equal(shared.submitInnerResult(diary()).mood,'queued');assert.equal(queued(e).length,1);
}));
test('an empty diary is refused and the mood link switch is respected',()=>fixture((e,shared)=>{
 assert.throws(()=>shared.submitInnerResult({...diary(),mood:{qualitative:true,diary:true,feeling:'  '}}),/日记感受无效/);
 e.saveConfig({...e.config,moodLinked:false});assert.equal(shared.submitInnerResult(diary()).mood,'none');assert.equal(queued(e).length,0);
}));
