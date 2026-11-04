import test from 'node:test';
import assert from 'node:assert/strict';
import {isReadOnlyTool} from '../lib/tool-semantics.js';

test('shared classification recognises the supported read-only tools without mutating inputs',()=>{
 const names=['read','read_file','read_image','list_directory','grep','glob','web_search',
  'list_context_sessions','search_context',
  'censhu_agency_context_page','censhu_agency_find_event','censhu_agency_event_history',
  'censhu_context_recall','censhu_question_recall','censhu_life_context','censhu_read_memory'];
 for(const name of names){
  for(const args of [undefined,Object.freeze({query:'原文'}),'{}','{"query":"原文"}']){
   const exec=Object.freeze({name,arguments:args});
   assert.equal(isReadOnlyTool(exec),true,name);
   assert.equal(exec.arguments,args);
  }
 }
});

test('mixed-effect tools classify the actual action for object and JSON arguments',()=>{
 for(const [name,actions] of [
  ['censhu_agency_method',['recall']],
  ['censhu_agency_note',['read']],
  ['censhu_private_archive',['read','list','search','compare']]
 ]){
  for(const action of actions){
   assert.equal(isReadOnlyTool({name,arguments:{action}}),true);
   assert.equal(isReadOnlyTool({name,arguments:JSON.stringify({action})}),true);
  }
  for(const action of [undefined,null,'choose','keep','save','delete','replace','READ']){
   assert.equal(isReadOnlyTool({name,arguments:{action}}),false,name+' '+action);
   assert.equal(isReadOnlyTool({name,arguments:JSON.stringify({action})}),false,name+' JSON '+action);
  }
  assert.equal(isReadOnlyTool({name}),false);
 }
});

test('invalid execution data and malformed arguments never bypass action accounting',()=>{
 for(const exec of [undefined,null,false,1,'read',[],{},{name:null},{name:1}])
  assert.equal(isReadOnlyTool(exec),false);
 for(const name of ['read_file','list_context_sessions','search_context','censhu_agency_method','censhu_private_archive']){
  for(const args of [null,false,0,[],1,'','{invalid','null','false','[]','3','"read"'])
   assert.equal(isReadOnlyTool({name,arguments:args}),false,name+' '+JSON.stringify(args));
 }
});

test('unknown tools and write operations remain subject to durable action handling',()=>{
 for(const name of ['write','write_file','censhu_correct_memory','qq_send_message','image_generate',
  'some_plugin_read','prefix__read_file','censhu_context_recall_fake','READ_FILE','toString','__proto__']){
  assert.equal(isReadOnlyTool({name,arguments:{action:'read'}}),false,name);
  assert.equal(isReadOnlyTool({name,arguments:'{"action":"recall"}'}),false,name);
 }
});
