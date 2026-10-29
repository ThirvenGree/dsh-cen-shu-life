import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {DrawingInspiration,validateDrawingChoice,drawingOpportunity} from '../lib/drawing-inspiration.js';
const makeDrawing=(engine,options={})=>new DrawingInspiration(engine,{review:async(_s,_schema,input)=>input.candidate,...options});
const choice={decision:'share',medium:'generated_image',idea:'旧窗上的一片光',prompt:'以插画表现旧木窗和落在窗边的一片暖光，不是实拍',reason:'有值得画下来的画面',validMinutes:90,delayMinutes:30};
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
  await drawing.tick();assert.equal(drawing.view().eligible.length,0);await drawing.tick();assert.equal(calls,1);advance(31*60000);await drawing.tick();assert.equal(drawing.view().eligible[0].medium,'voice');assert.throws(()=>drawing.begin(drawing.view().items[0].eventId));
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
test('Gemini controls whether and when inspiration happens, not a random template draw',()=>fixture(async({engine,advance})=>{
  let calls=0;const drawing=makeDrawing(engine,{generate:async()=>({...choice,decision:++calls===1?'defer':'share',delayMinutes:40})});
  await drawing.tick();assert.equal(engine.state.active.length,0);assert.equal(calls,1);await drawing.tick();assert.equal(calls,1);
  advance(41*60000);await drawing.tick();assert.equal(engine.state.active[0].templateId,'drawing-inspiration');assert.equal(drawing.view().eligible[0].idea,choice.idea);
  const file=path.join(engine.dir,'drawing-inspiration.json'),before=fs.readFileSync(file,'utf8');drawing.view();assert.equal(fs.readFileSync(file,'utf8'),before);
}));
