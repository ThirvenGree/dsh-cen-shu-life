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
 const prior=fs.readFileSync(lp,'utf8'),partial=source.replace('mergeLifeContribution(delta','removed');fs.writeFileSync(file,partial);const report=synchronizeMoodAdapters(home,file,partial);assert.ok(report.skipped.some(x=>x.kind==='life'));assert.equal(fs.readFileSync(lp,'utf8'),prior);assert.equal(adapterHealth(home).ready,false);
 fs.appendFileSync(file,'\n// unexpected change');assert.equal(adapterHealth(home).ready,false);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

for(const order of [['life','isolation'],['isolation','life']])test('upgrade removes both patches; recovery works without deleting registries: '+order.join(' -> '),()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'adapter-upgrade-'));try{
 const file=path.join(home,'index.js'),lp=path.join(home,'cen-shu-life/mood-link-install.json'),ip=path.join(home,'censhu-inner-life/isolation-adapters.json');fs.mkdirSync(path.dirname(lp));fs.mkdirSync(path.dirname(ip));const old=life+'\n'+isolation;
 fs.writeFileSync(lp,JSON.stringify({protocol:3,moduleUrl:pathToFileURL(file).href,sourceSha256:sourceHash(old),installedAt:1}));fs.writeFileSync(ip,JSON.stringify({version:1,protocol:'censhu-private-session-v1',files:[{file,hash:hash(old)}]}));
 let source='// upstream upgraded; both patches are gone';fs.writeFileSync(file,source);assert.equal(adapterHealth(home).ready,false);
 const peer=order[0]==='life'?ip:lp,before=fs.readFileSync(peer,'utf8');source+='\n'+(order[0]==='life'?life:isolation);fs.writeFileSync(file,source);
 const report=synchronizeMoodAdapters(home,file,source);assert.ok(report.skipped.some(x=>x.kind===order[1]));assert.equal(fs.readFileSync(peer,'utf8'),before);
 source+='\n'+(order[1]==='life'?life:isolation);fs.writeFileSync(file,source);const complete=synchronizeMoodAdapters(home,file,source);assert.equal(complete.skipped.length,0);assert.equal(adapterHealth(home).ready,true);assert.equal(JSON.parse(fs.readFileSync(ip)).files[0].hash,hash(source));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
