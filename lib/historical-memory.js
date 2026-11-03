import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {graphRoot,deletedNode} from './lingshu-deletions.js';

const digest=text=>createHash('sha256').update(text).digest('hex');
const clean=text=>text.replace(/\r\n/g,'\n').trim();
export function fileRecords(home,source,backup=false){
 const base=fs.realpathSync(path.join(home,'memories')),file=fs.realpathSync(path.resolve(base,source));
 const rel=path.relative(base,file);if(rel.startsWith('..')||path.isAbsolute(rel)||!(backup?/\.md\.[^/\\]*bak(?:\.\d+)?$/.test(file):file.endsWith('.md')))throw Error('无效的记忆路径');
 // Memory Evolve separates entire native entries with a standalone section sign.
 return fs.readFileSync(file,'utf8').split(/^\s*§\s*$/m).map(clean).filter(Boolean).map(text=>({backend:'memory',target:'project',file:source,id:digest(source+'\0'+text),text}));
}
export const supportsExcerpt=(row,text)=>row.text===text||row.text.split('\n').some(line=>line.trim()===text);
function graphNodes(home){
 const root=graphRoot({home}),rows=[];
 for(const layer of ['contextual','knowledge','structural','anchor','goals','unresolved','self','trash']){
  const dir=path.join(root,layer);if(!fs.existsSync(dir))continue;
  for(const f of fs.readdirSync(dir,{withFileTypes:true})){
   if(!f.isFile()||!f.name.endsWith('.md'))continue;
   const text=clean(fs.readFileSync(path.join(dir,f.name),'utf8').replace(/\r\n/g,'\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/,''));
   const id=f.name.slice(0,-3);
   if(layer==='trash'&&!deletedNode({home},id,text,0))continue;
   rows.push({backend:'lingshu',id,target:layer,text,...(layer==='trash'?{state:'deleted'}:{})});
  }
 }
 return rows;
}
export function historicalLinks(home,sources){
 const archives=new Map(),files=new Map(),allNames=new Set([...sources,'MEMORY.md','USER.md']);let nodes;
 for(const source of allNames){try{files.set(source,fileRecords(home,source));}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const source of files.keys()){
  const original=path.join(home,'memories',source),versions=[];
  for(const f of fs.readdirSync(path.dirname(original),{withFileTypes:true})){
   if(!f.isFile()||!f.name.startsWith(path.basename(original)+'.')||!/(?:\.bak(?:\.\d+)?$)/.test(f.name))continue;
   const file=path.posix.join(path.posix.dirname(source),f.name);
   for(const r of fileRecords(home,file,true))versions.push({...r,id:digest(source+'\0'+r.text),file:source,archive:file,state:'backup'});
  }
  archives.set(source,versions);
 }
 return ref=>{
  if(typeof ref?.text!=='string')return [];
  const labels=ref.sources||[ref.source],result=[];
  for(const label of labels){
   if(typeof label!=='string')continue;
   const source=label.replace(/^memory:/,''),text=clean(ref.text);
   let matches=[];
   if(files.has(source)){
    matches=files.get(source).filter(row=>supportsExcerpt(row,text));
    if(!matches.length){
     const old=archives.get(source).filter(row=>supportsExcerpt(row,text));
     if(new Set(old.map(row=>row.archive)).size===old.length&&new Set(old.map(row=>row.id)).size===1)matches=old.slice(0,1);
    }
   }
   else if(label==='context:memory:snapshot')matches=[...files.values()].flat().filter(row=>supportsExcerpt(row,text));
   else if(label==='context:lingshu:auto-recall'){
    nodes??=graphNodes(home);
    const excerpt=text.match(/^- \[(\w+)\] (.+?)(…)?$/u);
    matches=nodes.filter(row=>{
     if(row.text===text)return true;
     if(!excerpt||(row.target!=='trash'&&row.target!==excerpt[1]))return false;
     const body=row.text.replace(/\s+/g,' ');
     return excerpt[3]?excerpt[2].length>=64&&body.startsWith(excerpt[2]):body===excerpt[2];
    });
   }
   if(matches.length===1)result.push(matches[0]);
  }
  return result;
 };
}
