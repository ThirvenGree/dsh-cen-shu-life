import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedMemories} from '../lib/memory-writeback.js';
test('short authentic reply can ground a named preference, preceding question cannot serve as quote',()=>{
 const fact={text:'青枔希望称呼她为阿青。',quote:'阿青',kind:'preference',importance:92,confidence:98};
 assert.equal(approvedMemories({memories:[fact]},'阿青').length,1);
 assert.equal(approvedMemories({memories:[{...fact,quote:'叫你什么'}]},'阿青').length,0);
});
