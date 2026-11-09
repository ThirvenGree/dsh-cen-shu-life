// 2026-11-07：岑舒需要并行处理任务时开的子代理，挂一份她此刻全部状态的只读副本
// （心情、内在状态、生活、私人想法、最近的活动）。子代理不写生活、心情或记忆：
// 子代理不在绑定列表里，engine.bound(子代理) 为假，所以观察来信、记忆写回、心情事件都不会从子代理发生。
import {sessionKey} from './desktop-bindings.js';
import {lowMemorySession} from './memory-writeback.js';

export const SUBAGENT_HEADER='【子代理】你是岑舒为并行处理任务开的子代理。下面是她此刻的全部状态（只读副本：心情、内在状态、生活、私人想法与最近的活动），按她的身份和状态完成分给你的那部分，结果交回她。本会话不直接写入生活、心情或记忆；想记的内容交给她自己决定。';

// 给她自己的会话：什么时候开子代理由她判断。子代理只在顶层会话里提示（子代理自己不再收到这段）。
export const SUBAGENT_POLICY='【分头处理】同时有几件互不依赖的事要处理时（比如好几个人在等你回私信、几条评论要回、一边要看的东西又多），开不开子代理由你自己判断：可以用 subagent 工具把其中几件分出去，每个子代理会带上你此刻的全部状态（只读），按你的身份去做，结果交回你，最后由你决定怎么用。一件事、或者几件事前后相关时，自己按顺序做就好，不用开。拿不准时可以先用 censhu_parallel_decide（Terra 帮你判断怎么分）。子代理不写你的记忆和心情，想记的你自己写。';

export const isChildAgent=agent=>Boolean(agent?.parent||agent?.session?.header?.parentSession||agent?.session?.header?.origin==='subagent');

const idOf=agent=>agent?.session?.id||agent?.id;
const headerParent=agent=>{const p=agent?.session?.header?.parentSession;return typeof p==='string'?p:p?.sessionId||p?.id||null;};

/** 顺着父代理（或会话头里的父会话）找到最上层的会话 id。 */
export function rootSessionId(agent,resolve=()=>undefined){
  let current=agent,root=null;
  for(let i=0;i<8&&current;i++){
    if(current.parent){current=current.parent;root=idOf(current);continue;}
    const parentId=headerParent(current);
    if(!parentId)break;
    root=parentId;const next=resolve(parentId);
    if(!next||next===current)break;current=next;
  }
  return root;
}

/** 是她开的子代理：最上层会话绑定在她的生活上，或是抖音插件的刷视频 / 社交 / 重看会话；测试会话开的不算。 */
export function herSubagent(agent,{bound,resolve,isTest=()=>false}){
  try{
    if(!isChildAgent(agent)||isTest(agent))return false;
    for(let p=agent.parent,i=0;p&&i<8;p=p.parent,i++)if(isTest(p))return false;
    const root=rootSessionId(agent,resolve);
    if(!root||sessionKey(root)===sessionKey(idOf(agent)))return false;
    const parent=resolve(root);
    if(parent&&isTest(parent))return false;
    return bound(root)||lowMemorySession(root);
  }catch{return false;}
}
