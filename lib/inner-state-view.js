import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export function readInnerState(home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),now=Date.now()){
 try{const dir=path.join(home,'censhu-inner-life'),config=fs.existsSync(path.join(dir,'config.json'))?JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8')):{};if(config.enabled===false||config.innerStateEnabled===false)return null;const r=JSON.parse(fs.readFileSync(path.join(dir,'inner-state.json'),'utf8'));return r.version===1&&r.current?.expiresAt>now?r.current:null;}catch{return null;}
}
export function readThoughts(home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),now=Date.now()){try{const dir=path.join(home,'censhu-inner-life');let config={};try{config=JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8'));}catch{}if(config.enabled===false||config.thoughtsEnabled===false)return [];const r=JSON.parse(fs.readFileSync(path.join(dir,'thoughts.json'),'utf8'));return r.version===1?(r.items||[]).filter(x=>x.expiresAt>now).filter(x=>!r.selection||r.selection.expiresAt<=now||r.selection.ids.includes(x.id)).map(item=>({...item,provenance:(item.provenance||[]).map(({snapshot,...ref})=>ref)})):[];}catch{return [];}}
export function innerStateContext(home,now){const x=readInnerState(home,now),thoughts=readThoughts(home,now);return (thoughts.length?'\n【对人事物的主观看法·动态】'+JSON.stringify(thoughts)+'。仅是她的主观看法，供生活、心情、表达与主动行为判断，不是对方事实，不直接加分或强制行动。':'')+(x?'\n【动态内在状态·临时】'+JSON.stringify({id:x.id,summary:x.summary,tendency:x.tendency,states:x.states,conflicts:x.conflicts,effects:x.effects,expiresAt:x.expiresAt})+'。作为生活、心情与表达的临时背景，由模型判断如何采用；不直接重复计分，不是用户来信，不强制发送。':'');}

// 2026-11-06：心情慢层里 Gemini 判断应进入内在状态的累积，被内在状态判断采纳后留下的回执 {累积id: 采纳时间}。
export function readInnerMoodReceipts(home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh')){
 try{const r=JSON.parse(fs.readFileSync(path.join(home,'censhu-inner-life','inner-state.json'),'utf8'));return r&&typeof r.moodIntegrated==='object'&&r.moodIntegrated?r.moodIntegrated:{};}catch{return {};}
}
