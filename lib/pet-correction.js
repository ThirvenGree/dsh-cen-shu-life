import {randomUUID} from 'node:crypto';
import {correctionTool} from './memory-correction.js';
import {unwrapMemoryResult} from './memory-writeback.js';

// Called only from the interactive Pet /chat route. Autonomous Pet output and
// the DSH model's tool registry have no entry point to this confirmation state.
export function petCorrection(engine,tools,resolveAgent,options={}){
 let pending;
 return async (petId,text)=>{
  const sid=engine.read('../characters/censhu/integration.json',{}).sessionId;
  if(petId!=='main'||!sid||!engine.config.enabled||!engine.bound(sid))throw Error('桌宠未绑定岑舒会话');
  const agent=resolveAgent(sid);if(!agent)throw Error('请先载入绑定会话');
  const confirm=/^\/确认灵枢\s+([A-F0-9]{10})$/i.exec(text.trim());
  if(confirm){
   const p=pending;if(!p||p.sid!==sid||p.expires<engine.now()||p.code!==confirm[1].toUpperCase())throw Error('预览已失效，请重新查看原记录');
   if(p.busy)throw Error('本条更正正在审核');
   p.busy=true;
   try{
    const tool=correctionTool(engine,tools,{...options,trustedPetMessages:()=>[{id:p.id,role:'user',text:p.request+'\n看过原文后明确确认执行。'}]});
    const result=JSON.parse(await tool.execute(p.args,{agent}));
    pending=null;return result.status==='verified'?'已核对灵枢原库，'+(p.args.action==='remove'?'这条记忆已删除。':'这条记忆已更正。'):'未执行：'+(result.reason||result.status);
   }finally{p.busy=false;}
  }
  if(pending?.busy)throw Error('上一条更正正在处理');
  const match=/^\/(更正灵枢|忘记灵枢)\s+([\p{L}\p{N}_.-]{1,180})(?:\s+([\s\S]+))?$/u.exec(text.trim());
  if(!match||((match[1]==='更正灵枢')!==!!match[3]?.trim()))throw Error('用法：/更正灵枢 节点编号 新正文，或 /忘记灵枢 节点编号');
  const node=unwrapMemoryResult(await tools.execute({name:'mdcg_get',arguments:{node_id:match[2]},agent,callId:randomUUID(),signal:AbortSignal.timeout(30000)}));
  if(node.id!==match[2]||!node.frontmatter?.layer||node.truncated||typeof node.content!=='string'||node.content.length>4001)throw Error('无法核对完整原记录');
  const code=randomUUID().replaceAll('-','').slice(0,10).toUpperCase(),original=node.content.replace(/\r?\n$/,'');
  pending={sid,id:'pet-human:'+randomUUID(),code,expires:engine.now()+10*60000,request:text,args:{backend:'lingshu',target:node.frontmatter.layer,id:node.id,action:match[3]?'replace':'remove',original,...(match[3]?{replacement:match[3].trim()}:{})}};
  return '待确认（10分钟内输入 /确认灵枢 '+code+'）\n节点 '+node.id+'\n原文：'+original+(match[3]?'\n新正文：'+match[3].trim():'\n操作：遗忘此节点');
 };
}
