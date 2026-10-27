import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>x===undefined?undefined:structuredClone(x);
const keyed=x=>Array.isArray(x)&&x.every(v=>object(v)&&typeof v.id==='string');
// Three-way merge: only untouched defaults follow upstream; edits and deletions stay local.
export function mergeDefaults(base,current,next){
  if(equal(base,current))return clone(next);
  if(current===undefined)return undefined;
  if(next===undefined)return clone(current);
  if(keyed(base)&&keyed(current)&&keyed(next)){
    const old=new Map(base.map(x=>[x.id,x])),local=new Map(current.map(x=>[x.id,x])),fresh=new Map(next.map(x=>[x.id,x]));
    return [...new Set([...current.map(x=>x.id),...next.map(x=>x.id)])].flatMap(id=>{
      if(!local.has(id)&&old.has(id))return [];
      const value=old.has(id)?mergeDefaults(old.get(id),local.get(id),fresh.get(id)):local.has(id)?local.get(id):fresh.get(id);
      return value===undefined?[]:[clone(value)];
    });
  }
  if(object(base)&&object(current)&&(object(next)||next===undefined)){
    const out={};for(const key of new Set([...Object.keys(current),...Object.keys(next||{})])){
      const value=Object.hasOwn(base,key)?mergeDefaults(base[key],current[key],next?.[key]):Object.hasOwn(current,key)?clone(current[key]):clone(next[key]);
      if(value!==undefined)out[key]=value;
    }return out;
  }
  return clone(current);
}
const load=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return undefined;}};
function write(file,value){const tmp=file+'.defaults-'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
export function syncDefaults(dir,bundled,legacy){
  const file=path.join(dir,'defaults-baseline.json'),saved=load(file),base=saved?.defaults||legacy;
  const changes=[];
  for(const [key,name]of[['profile','profile.json'],['events','events.json'],['reactions','mood-reactions.json']]){
    const dest=path.join(dir,name),current=load(dest);
    // A malformed existing file belongs to normal corruption recovery, not this migration.
    if(current===undefined&&fs.existsSync(dest))continue;
    const value=current===undefined?clone(bundled[key]):mergeDefaults(base[key],current,bundled[key]);
    if(!equal(current,value)){write(dest,value);changes.push(name);}
  }
  const configFile=path.join(dir,'config.json'),cfg=load(configFile);
  if(cfg&&object(cfg)){
    const old={...(base.config||{}),modeRules:base.modeRules},fresh={...(bundled.config||{}),modeRules:bundled.modeRules};
    const merged=mergeDefaults(old,cfg,fresh);
    if(!equal(cfg,merged)){write(configFile,merged);changes.push('config.json');}
  }
  if(!equal(saved?.defaults,bundled))write(file,{version:1,defaults:bundled});
  return changes;
}
