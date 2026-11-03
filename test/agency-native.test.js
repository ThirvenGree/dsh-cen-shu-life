import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
test('native agency lease expires and overdue ordinary events release their slot',async()=>{
 const prev=process.env.DSH_HOME,home=fs.mkdtempSync(path.join(os.tmpdir(),'life-native-')),dir=path.join(home,'censhu-agency'),now=Date.now();
 try{process.env.DSH_HOME=home;fs.mkdirSync(dir);const write=(file,x)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(x));
 write('control.json',{version:2,sessionId:'role'});write('owner.json',{sessionId:'role',until:now+60000});
 const {owner}=await import('../lib/censhu-control.mjs');assert.equal(owner('role'),true);
 const ended=[];LifeEngine.prototype.advance.call({director:{},config:{sessionIds:['role']},state:{active:[{id:'old',endsAt:now-1800001},{id:'new',endsAt:now}]},end:id=>ended.push(id)},now);
 assert.deepEqual(ended,['old']);write('owner.json',{sessionId:'role',until:now-1});assert.equal(owner('role'),false);
 }finally{if(prev===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prev;fs.rmSync(home,{recursive:true,force:true});}
});
