import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSkillCatalog,applySkillCatalog,querySkillCatalog} from '../lib/request-skills.js';

const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const entries=[{name:'poetry',description:'诗句翻译与 <意象> & 节奏'},{name:'browser',description:'操作本机浏览器'}, {name:'audio',description:'语音生成'}];
const suffix='\n</available_skills>\n\nIf the user names a skill, call the `skill` tool before acting.\nDo not reload explicit <skill_content>.\n</system-reminder>';
function catalog(items=entries){return {id:'catalog',role:'user',source:{kind:'skill-catalog',form:'catalog',entries:items},content:[{type:'text',text:'<system-reminder>\nSkills:\n<available_skills>\n'+items.map(e=>'- `'+escape(e.name)+'`: '+escape(e.description)).join('\n')+suffix}]};}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}

test('only model-selected catalog summaries are projected; immutable original and loading instructions survive',()=>{
 const messages=freeze([{role:'user',content:'翻译这句诗'},catalog(),{role:'tool',content:'<skill_content>loaded instructions</skill_content>'}]);
 const snapshot=inspectSkillCatalog(messages),before=JSON.stringify(messages);
 assert.equal(snapshot.entries.length,3);
 const out=applySkillCatalog(messages,snapshot,['poetry']);
 assert.equal(JSON.stringify(messages),before);assert.notStrictEqual(out.messages,messages);
 assert.strictEqual(out.messages[0],messages[0]);assert.strictEqual(out.messages[2],messages[2]);
 assert.deepEqual(out.messages[1].source.entries,[entries[0]]);assert.equal(out.selected,1);
 assert.match(out.messages[1].content[0].text,/诗句翻译与 &lt;意象&gt; &amp; 节奏/);
 assert.ok(out.messages[1].content[0].text.endsWith(suffix.slice(suffix.indexOf('\n\n'))));
 assert.match(out.messages[1].content[0].text,/"target":"skills"/);
});

test('an empty choice retains discovery and every skill remains loadable through original tool',()=>{
 const messages=[catalog()],snapshot=inspectSkillCatalog(messages),out=applySkillCatalog(messages,snapshot,[]);
 assert.equal(out.selected,0);assert.match(out.messages[0].content[0].text,/<available_skills>\n\n<\/available_skills>/);
 const first=querySkillCatalog(snapshot,{limit:1}),next=querySkillCatalog(snapshot,{offset:first.nextOffset,limit:2});
 assert.equal(first.total,3);assert.equal(next.nextOffset,null);
 assert.deepEqual(next.entries[1].load,{tool:'skill',arguments:{name:'audio'}});
 assert.equal(querySkillCatalog(snapshot,{query:'浏览器'}).entries[0].name,'browser');
});

test('all selected is identity, and stale snapshots cannot project changed catalogs',()=>{
 const messages=[catalog()],snapshot=inspectSkillCatalog(messages);
 assert.strictEqual(applySkillCatalog(messages,snapshot,entries.map(e=>e.name)).messages,messages);
 const changed=[catalog([...entries,{name:'new',description:'new skill'}])];
 assert.strictEqual(applySkillCatalog(changed,snapshot,[]).messages,changed);
 assert.equal(applySkillCatalog(changed,snapshot,[]).reason,'stale_catalog');
 assert.equal(applySkillCatalog([],snapshot,[]).reason,'stale_catalog');
});

test('untrusted lookalikes, mismatched metadata, and unknown formats stay intact',()=>{
 const quote={...catalog(),source:{kind:'user'}},different=catalog();different.source.entries=entries.slice(1);
 const extra=catalog();extra.content.push({type:'text',text:'extra instructions'});
 const newFormat=catalog();newFormat.source.form='new-format';
 const messages=[quote,different,extra,newFormat];
 const snapshot=inspectSkillCatalog(messages);assert.equal(snapshot.entries.length,0);
 assert.strictEqual(applySkillCatalog(messages,snapshot,[]).messages,messages);
 assert.equal(querySkillCatalog(snapshot,{}).available,false);
});

test('invalid selections cannot hide skills; malformed paging has explicit failure',()=>{
 const snapshot=inspectSkillCatalog([catalog()]);
 for(const selected of [['invented'],['poetry','poetry'],null,[1]])assert.throws(()=>applySkillCatalog([catalog()],snapshot,selected),/无效名称/);
 for(const args of [{limit:41},{limit:0},{offset:-1},{offset:100},{query:2}])assert.equal(querySkillCatalog(snapshot,args).available,false);
});

test('newest catalog replaces older names, including read-only discovery',()=>{
 const first=catalog(entries.slice(0,2)),second=catalog(entries.slice(1));second.id='next';
 const messages=[first,second],snapshot=inspectSkillCatalog(messages);
 assert.equal(snapshot.entries.length,2);assert.equal(querySkillCatalog(snapshot,{query:'poetry'}).entries.length,0);
 const out=applySkillCatalog(messages,snapshot,['audio']);
 assert.equal(out.messages[0].source.entries.length,0);assert.deepEqual(out.messages[1].source.entries,[entries[2]]);
 assert.match(out.messages[0].content[0].text,/earlier skill catalog is superseded/);
 const revised=catalog(entries.map(e=>({...e,description:e.description+' revised'})));
 assert.notEqual(inspectSkillCatalog([revised]).signature,inspectSkillCatalog([catalog()]).signature);
});

test('unrecognized latest replacement does not use older catalog to prune capabilities',()=>{
 const latest=catalog(entries.slice(1));latest.source.update=true;latest.source.form='future-format';
 const messages=[catalog(),latest],snapshot=inspectSkillCatalog(messages);
 assert.equal(snapshot.reason,'unsupported_current_catalog');assert.equal(snapshot.entries.length,0);
 assert.strictEqual(applySkillCatalog(messages,snapshot,[]).messages,messages);
 assert.equal(querySkillCatalog(snapshot,{}).available,false);
});

test('empty native replacement revokes old directory entries without claiming they can be loaded',()=>{
 const empty=catalog([]);empty.source.update=true;empty.content[0].text=empty.content[0].text.replace('<available_skills>\n\n</available_skills>','<available_skills>\n</available_skills>');
 const messages=[catalog(),empty],snapshot=inspectSkillCatalog(messages);
 assert.equal(snapshot.catalogs.length,2);assert.equal(snapshot.entries.length,0);
 assert.equal(querySkillCatalog(snapshot,{}).total,0);
 const out=applySkillCatalog(messages,snapshot,[]);assert.equal(out.messages[0].source.entries.length,0);
 assert.strictEqual(out.messages[1],empty);
});

test('replacement framing permits discovered current skills while keeping native loading rules',()=>{
 const current=catalog();current.source.update=true;
 current.content[0].text=current.content[0].text.replace('Skills:','The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:').replace('If the user names a skill, call the `skill` tool before acting.','Use only names in this replacement catalog. If the user names a listed skill, call the `skill` tool before acting.');
 const out=applySkillCatalog([current],inspectSkillCatalog([current]),['poetry']);
 assert.match(out.messages[0].content[0].text,/including names returned by censhu_tool_catalog/);
 assert.match(out.messages[0].content[0].text,/call the `skill` tool before acting/);
 assert.doesNotMatch(out.messages[0].content[0].text,/Use only names in this replacement catalog/);
});
