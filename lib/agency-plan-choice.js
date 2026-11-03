import {createHash} from 'node:crypto';

// A generated suggestion has no effect until adopted. Stale revisions are not interchangeable.
export function planCandidates(engine,now){
 if(!engine.config.lifePlanningEnabled)return [];
 return (engine.activeContent()?.intentions||[]).filter(x=>x.expiresAt>now&&!x.adjustedAt&&!x.agencyDecision)
   .map(({id,text,generatedAt,expiresAt,revision=0})=>({id,text,generatedAt,expiresAt,revision}));
}
export function choosePlan(engine,request){
 if(!engine.config.lifePlanningEnabled)throw Error('生活意向已关闭');
 const item=engine.activeContent()?.intentions?.find(x=>x.id===request.id);
 if(!item||item.generatedAt!==request.generatedAt||engine.now()>=item.expiresAt)throw Error('候选意向已失效');
 if(!['adopt','dismiss'].includes(request.decision))throw Error('意向选择无效');
 const key=createHash('sha256').update(JSON.stringify([request.run,request.id,request.generatedAt,request.revision,request.decision])).digest('hex');
 if(item.agencyReceipt===key)return {id:item.id,decision:item.agencyDecision,replayed:true};
 if(item.agencyDecision||item.adjustedAt||(item.revision||0)!==request.revision)throw Error('意向已有新选择，请重读');
 const previous=engine.content,updated=structuredClone(previous),changed=updated.intentions.find(x=>x.id===item.id);
 Object.assign(changed,{agencyDecision:request.decision,agencyReceipt:key,adjustedAt:engine.now(),revision:(item.revision||0)+1});
 engine.content=updated;
 try{engine.persistContent();}catch(e){engine.content=previous;throw e;}
 return {id:item.id,decision:request.decision,revision:changed.revision};
}
