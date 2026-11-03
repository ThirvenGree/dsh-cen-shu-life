import {randomUUID} from 'node:crypto';
// Only the host can allocate a live permit. Naming a call or passing a model argument is insufficient.
const permits=new Map();
export async function auditedWrite(tools,request){
 const callId='censhu-reviewed-'+randomUUID();
 permits.set(callId,{name:request.name,agent:request.agent,args:JSON.stringify(request.arguments)});
 try{return await tools.execute({...request,callId});}finally{permits.delete(callId);}
}
const reads=new Set('document_search memory_bodies related status view_route review_status list read get expand recall search query stats health profile facts neighbors timeline tour context identity recent route report review_list review_records service_info whoami'.split(' '));
export function isAuditedWrite(exec){const p=permits.get(exec.callId);return Boolean(p&&p.agent===exec.agent&&p.name===exec.name&&p.args===JSON.stringify(exec.arguments||{}));}
export function memoryDenied(exec){
 const qualified=String(exec.name||''),name=qualified.split('__').at(-1).toLowerCase(),args=exec.arguments||{};
 if(isAuditedWrite(exec))return false;
 if(name==='censhu_question_recall'||name==='censhu_memory_review')return false;
 if(['cg','lingshu_cg','stg','lingshu_stg'].includes(name))return !reads.has(args.op)||Boolean(args.action&&!reads.has(args.action));
 if(/^openviking_(?:find|ls|stat|abstract|overview)$/.test(name)||/^mcp__openviking__(?:find|ls|stat|abstract|overview)$/i.test(qualified))return false;
 if(['memory','de_memory','openviking','mnemon'].includes(name))return !reads.has(args.action)||Boolean(args.op&&!reads.has(args.op));
 const match=/^(?:(?:lingshu_)?mdcg|engram|mnemon|openviking|memory|qq_memory|de_memory|hippocampus)_(.+)$/.exec(name);
 if(match)return !reads.has(match[1]);
 if(/^mcp__[^_]*(?:memory|engram|viking|mnemon)[^_]*__/i.test(qualified))return !reads.has(name);
 return false;
}
