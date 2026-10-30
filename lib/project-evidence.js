// Evidence comes only from host-observed successful tool results or persisted life receipts.
const clean=value=>String(value).replace(/(?:AIza[\w-]+|sk-[\w-]+|gh[pous]_[\w]+|Bearer\s+\S+)/gi,'[redacted]').slice(0,500);
export function captureProjectEvidence(engine,{id,name,sessionId,message}){
 if(!id||message?.isError||!engine.bound(sessionId))return;
 let result;try{result=JSON.parse((message.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n'));}catch{return;}
 if(!result||result.ok===false||result.success===false||result.error||result.isError)return;
 const artifacts=[];
 const walk=(v,depth=0)=>{if(!v||typeof v!=='object'||depth>4)return;if(v.ok===false||v.success===false||v.error||v.isError)return;for(const [key,value]of Object.entries(v)){if(['filePath','file_path','outputPath','output_path','imagePath','path','captureId'].includes(key)&&typeof value==='string'&&value.trim())artifacts.push({kind:key,value:clean(value)});else if(typeof value==='object')walk(value,depth+1);}};
 walk(result);if(!artifacts.length)return;
 const store=engine.read('project-evidence.json',{items:[]}),key='tool:'+String(id);if(store.items.some(x=>x.id===key))return;
 store.items.push({id:key,source:'tool-result',tool:clean(name),sessionId,at:engine.now(),artifacts:artifacts.slice(0,8),completed:true});store.items=store.items.slice(-200);engine.write('project-evidence.json',store);
}
export function projectEvidence(engine,sessionId){
 const sid=x=>String(x||'').replace(/^session-/,'');
 const tools=engine.read('project-evidence.json',{items:[]}).items.filter(x=>sid(x.sessionId)===sid(sessionId));
 const drawings=(engine.drawingInspiration?.record.items||[]).filter(x=>x.captureId&&['prepared','sent'].includes(x.status)).map(x=>({id:'drawing:'+x.eventId,eventId:x.eventId,source:'drawing-receipt',at:x.sentAt||x.at,idea:x.idea,captureId:x.captureId,completed:true,sent:x.status==='sent'}));
 const events=[...engine.history.events.slice(-40),...engine.state.active].map(x=>({id:'life:'+x.id,eventId:x.id,source:'simulated-life',name:x.name,stage:x.stageText,status:x.status,completed:false}));
 return [...tools,...drawings,...events].slice(-260);
}
