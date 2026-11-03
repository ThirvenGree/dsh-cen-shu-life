import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedMemories} from '../lib/memory-writeback.js';
test('short authentic reply can ground a named preference, preceding question cannot serve as quote',()=>{
 const fact={text:'青枔希望称呼她为阿青。',quote:'阿青',kind:'preference',importance:92,confidence:98};
 assert.equal(approvedMemories({memories:[fact]},'阿青').length,1);
 assert.equal(approvedMemories({memories:[{...fact,quote:'叫你什么'}]},'阿青').length,0);
});
import {LifeEngine} from '../lib/engine.js';
import {MemoryWriteback} from '../lib/memory-writeback.js';
import {shortReplyContext,readShortReplyContexts} from '../lib/qq-grounding.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('bound QQ reply identity survives duplicate delivery, missing disk row never uses an older identical reply',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-short-pair-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const e=new LifeEngine({home:dir});e.saveConfig({sessionIds:['qq']});
 const calls=[],w=new MemoryWriteback(e,{tools:{execute(){}},agents:()=>[],generate:async(_p,_s,input)=>{calls.push(input);return {decision:'skip',reason:'fixture',memories:[]};}});
 for(const text of ['嗯','好','哈哈','嗯嗯','好的','行']){w.observe('qq',text);await w.tick();}
 assert.equal(w.record.sources.length,0);assert.equal(calls.length,0);
 const self=(id,text)=>({messageId:id,text,isSelf:true}),msg=(id,seq,text)=>({messageId:id,seq,text,isSelf:false});
 const old=msg('1',1,'嗯'),fresh=msg('2',2,'嗯'),rows=[self('a','旧问题'),old,self('b','新问题')];
 fs.mkdirSync(path.join(dir,'state'));
 const write=(name,data)=>fs.writeFileSync(path.join(dir,'state',name+'.json'),JSON.stringify(data));
 write('sessions',{sessions:{'private:123':'qq'}});
 const persist=()=>write('social-v2',{conversations:{'private:123':{recentMessages:rows}}});persist();
 const pair=()=>readShortReplyContexts('qq',[fresh],dir).get('2');
 assert.equal(pair(),undefined);w.observe('qq','嗯',null,pair());await w.tick();assert.equal(calls.length,0);
 rows.push(fresh);persist();assert.equal(pair().id,'b');assert.equal(shortReplyContext(rows,{...fresh,seq:1}),null);
 for(let i=0;i<2;i++)w.observe('qq','嗯',null,pair());
 await w.tick();assert.equal(calls.length,1);assert.equal(calls[0].precedingAssistantMessage,'新问题');assert.equal(calls[0].source,'嗯');
 assert.equal(w.record.sources.length,1);
 fresh.quotedMessageId='a';assert.equal(shortReplyContext(rows,fresh).id,'a');
 fresh.quotedMessageId='missing';assert.equal(shortReplyContext(rows,fresh),null);
 assert.equal(readShortReplyContexts('pet',[fresh],dir).size,0);
});
