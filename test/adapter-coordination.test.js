import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {synchronizeMoodAdapters,verifyMoodIsolation} from '../lib/adapter-coordination.js';import {adapterHealth,sourceHash} from '../lib/adapter-health.js';
const life='// cen-shu-life adapter-protocol:3\nreadLifeMoodInputs(CFG_DIR\nreadLifeSituation(CFG_DIR\nmergeLifeContribution(delta\nrecordLifeMoodReceipts(s, delta)\nd.lifeEventReceipts =\nd.behaviorContext =\ns.behaviorContext =\nlife: obj.life\nexport const cenShuLifeAdapterProtocol = 3';
const isolation=`// censhu-private-session-v1
import {isPrivateSession,isInternalMessage} from 'isolation';
function mountFor(agent, sid, slot) {
    if (isPrivateSession(agent)) return () => {};
}
if (isInternalMessage(p)) return null
if (isInternalMessage(msg)) { lastText = ''; lastSrc = msg.source.kind; return }
if (!stillBound() || isInternalMessage({source:{kind:lastSrc}})) return`;
const hash=x=>createHash('sha256').update(x).digest('hex');
for(const order of [['life','isolation'],['isolation','life']])test('both whole-file attestations survive install order '+order.join(' -> '),()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'adapter-order-'));try{
 const file=path.join(home,'index.js'),lp=path.join(home,'cen-shu-life/mood-link-install.json'),ip=path.join(home,'censhu-inner-life/isolation-adapters.json');fs.mkdirSync(path.dirname(lp));fs.mkdirSync(path.dirname(ip));let source='';
 for(const kind of order){source+='\n'+(kind==='life'?life:isolation);fs.writeFileSync(file,source);if(kind==='life')fs.writeFileSync(lp,JSON.stringify({protocol:3,moduleUrl:pathToFileURL(file).href,sourceSha256:sourceHash(source),installedAt:1}));else fs.writeFileSync(ip,JSON.stringify({version:1,protocol:'censhu-private-session-v1',files:[{file,hash:hash(source)}]}));synchronizeMoodAdapters(home,file,source);}
 assert.equal(adapterHealth(home).ready,true);assert.equal(verifyMoodIsolation(source),true);assert.equal(JSON.parse(fs.readFileSync(ip)).files[0].hash,hash(source));
 for(let i=0;i<2;i++)synchronizeMoodAdapters(home,file,source);assert.equal(adapterHealth(home).ready,true);
 const prior=fs.readFileSync(ip,'utf8');assert.throws(()=>synchronizeMoodAdapters(home,file,source.replace('mergeLifeContribution(delta','removed')),/生活心情适配已缺失/);assert.equal(fs.readFileSync(ip,'utf8'),prior);
 fs.appendFileSync(file,'\n// unexpected change');assert.equal(adapterHealth(home).ready,false);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
