import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {DrawingInspiration,validateDrawingChoice,drawingOpportunity} from '../lib/drawing-inspiration.js';
const makeDrawing=(engine,options={})=>{const d=new DrawingInspiration(engine,{activity:()=>[],review:async(_s,_schema,input)=>input.candidate,...options});if(!d.day()){const date=engine.life().date;d.record.days||={};d.record.days[date]={date,firstMessageAt:engine.now()-60000,status:'scheduled',nextAt:engine.now()};d.save();}return d;};
const choice={inspiration:'present',decision:'share',medium:'generated_image',idea:'旧窗上的一片光',prompt:'以插画表现旧木窗和落在窗边的一片暖光，不是实拍',reason:'有值得画下来的画面',validMinutes:90,delayMinutes:30};
async function fixture(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-drawing-'));let now=new Date('2026-10-29T12:00:00+08:00').getTime();const engine=new LifeEngine({home,now:()=>now,random:()=>.5});engine.saveConfig({sessionIds:['target'],probability:0});try{await fn({home,engine,now:()=>now,advance:ms=>now+=ms});}finally{fs.rmSync(home,{recursive:true,force:true});}}
test('drawing is a real bounded event; Gemini determines idea and medium once per event',()=>fixture(async({engine})=>{
  assert.ok(engine.allTemplates().some(t=>t.id==='drawing-inspiration'&&t.name==='画画灵感'));
  const event=engine.add('drawing-inspiration',{manual:true});let calls=0;
  const drawing=makeDrawing(engine,{generate:async(_s,_schema,input)=>{calls++;assert.equal(input.event.id,event.id);return choice;}});
  await drawing.tick();assert.equal(calls,1);assert.equal(drawing.view().eligible[0].idea,choice.idea);assert.equal(event.stageText,choice.idea);assert.match(engine.context('target'),/Gemini 判断的画画灵感/);
  event.stage++;await drawing.tick();assert.equal(calls,1);
  assert.throws(()=>engine.add('drawing-inspiration',{manual:true}));
}));
test('initiative and generation claim once, verified send persists across restart',()=>fixture(async({engine,home,now})=>{
  const event=engine.add('drawing-inspiration',{manual:true});const drawing=makeDrawing(engine,{generate:async()=>choice});await drawing.tick();
  assert.ok(drawingOpportunity(home,'target',now()));assert.equal(drawingOpportunity(home,'other',now()),null);
  assert.equal(drawing.claimInitiative(event.id).claimed,true);assert.equal(drawing.claimInitiative(event.id).claimed,false);assert.equal(drawingOpportunity(home,'target',now()),null);
  assert.equal(drawing.begin(event.id).prompt,choice.prompt);assert.throws(()=>drawing.begin(event.id));
  drawing.result({eventId:event.id,status:'prepared',captureId:'capture'});assert.throws(()=>drawing.result({eventId:event.id,status:'sent',captureId:'wrong',messageId:'1'}));
  drawing.result({eventId:event.id,status:'sent',captureId:'capture',messageId:'1'});assert.equal(drawing.view().eligible.length,0);assert.equal(makeDrawing(engine).view().items[0].status,'sent');assert.throws(()=>drawing.begin(event.id));
}));
test('Gemini may choose voice, uncertainty, postponement or no sharing; never forced to draw',()=>fixture(async({engine,advance})=>{
  engine.add('drawing-inspiration',{manual:true});let calls=0;const drawing=makeDrawing(engine,{generate:async()=>{calls++;return {...choice,decision:calls===1?'uncertain':'share',medium:'voice',prompt:''};}});
  await drawing.tick();assert.equal(drawing.view().eligible.length,0);await drawing.tick();assert.equal(calls,1);advance(91*60000);await drawing.tick();assert.equal(drawing.view().eligible[0].medium,'voice');assert.throws(()=>drawing.begin(drawing.view().items[0].eventId));
  const id=drawing.view().items[0].eventId;drawing.result({eventId:id,status:'shared',messageId:'sent-voice'});assert.equal(drawing.view().items[0].status,'sent');
}));
test('configuration errors pause; transient errors back off and reads do not write',()=>fixture(async({engine,advance})=>{
  engine.add('drawing-inspiration',{manual:true});let calls=0;const drawing=makeDrawing(engine,{generate:async()=>{calls++;throw Object.assign(Error('HTTP 403'),{httpStatus:403});}});await drawing.tick();advance(3600000);await drawing.tick();assert.equal(calls,1);assert.equal(drawing.view().items[0].status,'failed');
  const file=path.join(engine.dir,'drawing-inspiration.json'),before=fs.readFileSync(file,'utf8');drawing.view();drawing.context();assert.equal(fs.readFileSync(file,'utf8'),before);
}));
test('disable, expiry, malformed output and quiet time do not produce an opportunity',()=>fixture(async({engine,advance})=>{
  assert.throws(()=>validateDrawingChoice({...choice,medium:'terminal'}));assert.throws(()=>validateDrawingChoice({...choice,prompt:'API key secret'}));assert.throws(()=>validateDrawingChoice({...choice,validMinutes:0}));
  engine.add('drawing-inspiration',{manual:true});const drawing=makeDrawing(engine,{generate:async()=>choice});await drawing.tick();advance(91*60000);assert.equal(drawing.view().eligible.length,0);
  engine.saveConfig({semanticEnabled:false});assert.equal(drawing.context(),'');assert.throws(()=>drawing.begin(drawing.view().items[0].eventId));
}));
test('Gemini controls spontaneous occurrence independently of ordinary draws',()=>fixture(async({engine,advance})=>{
  let calls=0;const drawing=makeDrawing(engine,{generate:async()=>({...choice,inspiration:++calls===1?'absent':'present',decision:calls===1?'defer':'share',delayMinutes:40})});
  await drawing.tick();assert.equal(engine.state.active.length,0);assert.equal(calls,1);await drawing.tick();assert.equal(calls,1);
  advance(91*60000);await drawing.tick();assert.equal(engine.state.active[0].templateId,'drawing-inspiration');assert.equal(drawing.view().eligible[0].idea,choice.idea);
  const file=path.join(engine.dir,'drawing-inspiration.json'),before=fs.readFileSync(file,'utf8');drawing.view();assert.equal(fs.readFileSync(file,'utf8'),before);
}));

test('private inspiration is a persisted life event without a proactive opportunity',()=>fixture(async({engine})=>{
  const drawing=makeDrawing(engine,{generate:async()=>({...choice,decision:'skip'})});
  await drawing.tick();assert.equal(engine.state.active.length,1);assert.equal(engine.state.active[0].stageText,choice.idea);
  assert.equal(drawing.view().eligible.length,0);assert.equal(makeDrawing(engine).view().items[0].status,'skip');
}));
test('deferred spontaneous inspiration can later share the same event',()=>fixture(async({engine,advance})=>{
  let calls=0;const drawing=makeDrawing(engine,{generate:async()=>({...choice,decision:++calls===1?'defer':'share'})});
  await drawing.tick();const id=engine.state.active[0].id;assert.equal(drawing.view().eligible.length,0);
  advance(91*60000);await drawing.tick();assert.equal(drawing.view().eligible[0].eventId,id);assert.equal(engine.state.active.length,1);
}));
test('ordinary random pool includes drawing and models its private sharing choice',()=>fixture(async({engine})=>{
  const template=engine.allTemplates().find(x=>x.id==='drawing-inspiration');engine.allTemplates=()=>[template];
  engine.saveConfig({probability:1});engine.tick();assert.equal(engine.state.active[0]?.templateId,'drawing-inspiration');
  const drawing=makeDrawing(engine,{generate:async()=>({...choice,decision:'skip'})});await drawing.tick();
  assert.equal(drawing.view().eligible.length,0);assert.equal(engine.state.active[0].stageText,choice.idea);
}));
test('concurrent ordinary occurrence reuses the event and consumes the daily quota once',()=>fixture(async({engine})=>{
  let resolve;const pending=new Promise(r=>resolve=r);const drawing=makeDrawing(engine,{generate:()=>pending});
  const run=drawing.tick();const event=engine.add('drawing-inspiration');resolve(choice);await run;
  assert.equal(engine.state.active.length,1);assert.equal(drawing.view().items[0].eventId,event.id);
  assert.equal(Object.values(engine.state.daily).reduce((a,b)=>a+b,0),1);
  assert.equal(drawing.record.occasionFailures,0);
}));

test('drawing ordinary eligibility and model planning only run during waking hours',()=>fixture(async({engine,advance})=>{
  const template=engine.allTemplates().find(x=>x.id==='drawing-inspiration');assert.deepEqual(template.when.hours,[6,23]);
  let calls=0;const drawing=makeDrawing(engine,{generate:async()=>{calls++;return {...choice,inspiration:'absent',decision:'skip'};}});
  advance(11*3600000);assert.equal(engine.eligible(template,engine.life(),engine.now()),false);await drawing.tick();assert.equal(calls,0);
  advance(7*3600000);drawing.record.days[engine.life().date]={status:'scheduled',nextAt:engine.now(),firstMessageAt:engine.now()};assert.equal(engine.eligible(template,engine.life(),engine.now()),true);await drawing.tick();assert.equal(calls,1);
}));
test('one minute model delays clamp to an hour and survive restart',()=>fixture(async({engine,advance,now})=>{
  let calls=0;const generate=async()=>{calls++;return {...choice,inspiration:'absent',decision:'defer',delayMinutes:1};};
  const drawing=makeDrawing(engine,{generate});await drawing.tick();assert.equal(drawing.view().nextJudgmentAt,now()+3600000);
  advance(59*60000);await makeDrawing(engine,{generate}).tick();assert.equal(calls,1);
  advance(31*60000);await makeDrawing(engine,{generate}).tick();assert.equal(calls,2);
}));
test('failed calls and ordinary event planning cannot bypass the shared model interval',()=>fixture(async({engine,advance})=>{
  let calls=0;const drawing=makeDrawing(engine,{generate:async()=>{calls++;throw Error('network');}});
  await drawing.tick();const event=engine.add('drawing-inspiration');advance(16*60000);await drawing.tick();assert.equal(calls,1);
  await drawing.plan(event);assert.equal(calls,1);advance(45*60000);await drawing.tick();assert.equal(calls,2);
}));

test('three effective rejudgments close a deferred idea permanently across restart',()=>fixture(async({engine,advance})=>{
  let calls=0;const generate=async()=>{calls++;return {...choice,decision:calls%2?'defer':'uncertain'};};
  let drawing=makeDrawing(engine,{generate});await drawing.tick();const id=drawing.view().items[0].eventId;
  for(let i=1;i<=3;i++){advance(91*60000);drawing=makeDrawing(engine,{generate});await drawing.tick();assert.equal(drawing.row(id).rejudgments,i);}
  assert.equal(calls,4);assert.equal(drawing.row(id).status,'skip');assert.match(drawing.row(id).closureReason,/3次/);
  advance(91*60000);drawing=makeDrawing(engine,{generate});await drawing.tick();await drawing.plan(engine.state.active[0]);assert.equal(calls,4);assert.equal(drawing.row(id).idea,choice.idea);
}));
test('the last allowed rejudgment can share, while network errors do not consume effective attempts',()=>fixture(async({engine,advance})=>{
  let calls=0;const drawing=makeDrawing(engine,{generate:async()=>{calls++;if(calls===2)throw Error('network');return {...choice,decision:calls===5?'share':'defer'};}});
  await drawing.tick();const id=drawing.view().items[0].eventId;
  for(let i=0;i<4;i++){advance(91*60000);await drawing.tick();}
  assert.equal(drawing.row(id).rejudgments,3);assert.equal(drawing.row(id).status,'ready');assert.equal(drawing.view().eligible.length,1);
}));
test('weight and seventy-two hour cooldown apply to both entries and upgrade existing deadlines',()=>fixture(async({engine})=>{
  const template=engine.allTemplates().find(x=>x.id==='drawing-inspiration');assert.equal(template.weight,1);assert.equal(template.cooldownHours,72);
  const event=engine.add(template.id);engine.state.cooldowns[template.id]=event.endsAt+24*3600000;
  makeDrawing(engine);assert.equal(engine.state.cooldowns[template.id],event.endsAt+72*3600000);
}));
