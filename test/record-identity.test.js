import test from 'node:test';import assert from 'node:assert/strict';
import {evidenceRows} from '../lib/personality-sources.js';
test('same words retain separate scope, URI and version before merging',()=>{
 const rows=evidenceRows({rendered:'summary',items:['A','B'].map(id=>({uri:'viking://user/fixture/memories/'+id,scope:'user',revision:'r'+id,text:'same words'}))},'memory:openviking');
 assert.equal(rows.length,1);assert.deepEqual(rows[0].records.map(r=>[r.scope,r.id.split('/').pop(),r.version]),[['user','A','rA'],['user','B','rB']]);
});
