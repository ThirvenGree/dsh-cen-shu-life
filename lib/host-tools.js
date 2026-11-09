// Run one host tool call on both DSH tool-execution contracts.
// DSH <= 0.2.1: ctx.tools.execute({name, arguments, agent, callId, signal}) resolves to one final result.
// DSH >= 0.2.2: execution is provider-owned and batch-shaped; ctx.tools.execute({calls, agent, signal})
// resolves to {results:[{callId, result}]}. The batch host is recognised by tools.setExecutor.
// Guards, approval policy and final-result observers still run inside the host in both cases.
import {randomUUID} from 'node:crypto';

export function usesToolBatchExecution(tools){return typeof tools?.setExecutor==='function';}

export async function executeHostTool(tools,input){
  if(typeof tools?.execute!=='function')throw new Error('DSH 工具执行接口不可用');
  if(!usesToolBatchExecution(tools))return tools.execute(input);
  const callId=typeof input.callId==='string'&&input.callId?input.callId:'censhu-tool-'+randomUUID();
  const batch=await tools.execute({
    calls:[{type:'tool-call',id:callId,name:input.name,arguments:JSON.stringify(input.arguments??{})}],
    ...(input.agent===undefined?{}:{agent:input.agent}),
    ...(input.toolSet===undefined?{}:{toolSet:input.toolSet}),
    signal:input.signal??new AbortController().signal,
  });
  const results=batch?.results,entry=results?.[0];
  if(!Array.isArray(results)||results.length!==1||entry?.callId!==callId||typeof entry.result?.isError!=='boolean')throw new Error('DSH 工具批次没有返回这次调用的结果');
  return entry.result;
}
