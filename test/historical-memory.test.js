import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {historicalLinks} from '../lib/historical-memory.js';
test('historical citations use an unambiguous whole line or record, distinguish archive copies',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'censhu-link-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const dir=path.join(home,'memories');fs.mkdirSync(dir);const file=path.join(dir,'MEMORY.md');
 fs.writeFileSync(file,'one\nline\n§\ntwo\nshared\n§\nthree\nshared');
 fs.writeFileSync(file+'.old.bak','old only');fs.writeFileSync(file+'.bak.2','old only');
 const match=text=>historicalLinks(home,['MEMORY.md'])({source:'MEMORY.md',text});
 assert.equal(match('shared').length,0);assert.equal(match('lin').length,0);
 assert.equal(match('line')[0].text,'one\nline');assert.equal(match('old only')[0].state,'backup');
});
