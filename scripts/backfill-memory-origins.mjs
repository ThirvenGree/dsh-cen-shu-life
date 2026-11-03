import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {historicalLinks} from '../lib/historical-memory.js';
import {rememberRecord} from '../lib/memory-source-tracking.js';
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),apply=process.argv.includes('--apply');
const read=f=>JSON.parse(fs.readFileSync(path.join(home,f),'utf8')),dir='cen-shu-life/',cfg=read(dir+'config.json');
const lookup=historicalLinks(home,cfg.personaMemoryFiles),sid=read('characters/censhu/integration.json').sessionId;
if(!cfg.sessionIds.includes(sid))throw Error('未绑定的主会话');
const store={read:(name,d)=>fs.existsSync(path.join(home,dir,name))?read(dir+name):d,write:(name,data)=>write(dir+name,data)};
function write(name,data){const dest=path.join(home,name),temp=dest+'.backfill-'+process.pid;fs.writeFileSync(temp,JSON.stringify(data,null,2));fs.renameSync(temp,dest);}
const reports={};const verified=new Set();
for(const name of [dir+'profile.json',dir+'memory-evidence.json',dir+'persona-learning.json',dir+'model-content.json','censhu-inner-life/personality.json','censhu-inner-life/thoughts.json','censhu-inner-life/personal-growth.json']){
 if(!fs.existsSync(path.join(home,name)))continue;
 const data=read(name),report={added:0,archived:0,existing:0,unmatched:0};
 function visit(row){
  if(!row||typeof row!=='object')return;
  if(Array.isArray(row)){row.forEach(visit);return;}
  if(row.text&&row.id&&(row.origin==='memory'||/^(?:projects\/|context:|memory:)|\.md$/i.test(row.source||''))){
   if(row.originalRecords?.length||row.archivedOriginalRecords?.length){report.existing++;return;}
   const hits=lookup(row);
   if(!hits.length){report.unmatched++;return;}
   const archived=hits.every(h=>h.state);row[archived?'archivedOriginalRecords':'originalRecords']=hits.map(({text,...ref})=>ref);
   for(const h of hits){verified.add(h.backend+':'+h.id);if(apply&&h.file&&!h.state)rememberRecord(store,sid,h,row.text);if(!h.state&&h.backend==='lingshu'&&row.source==='context:lingshu:auto-recall')row.source+=':lingshu-node:'+h.id;}
   if(archived)report.archived++;else report.added++;return;
  }
  for(const v of Object.values(row))visit(v);
 }
 visit(data);if(apply&&(report.added||report.archived))write(name,data);reports[name]=report;
}
console.log(JSON.stringify({apply,unique:verified.size,reports},null,2));
