import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const start='【性格发展·自动同步开始】',end='【性格发展·自动同步结束】';
export function replacePersonality(text,block){text=String(text||'');const a=text.indexOf(start),b=text.indexOf(end);if((a<0)!==(b<0)||a>=0&&b<a)throw Error('性格发展标记损坏，请检查手动修改');return a<0?[text.trimEnd(),block].filter(Boolean).join('\n\n'):(text.slice(0,a)+block+text.slice(b+end.length)).trimEnd();}
export function personalityBlock(items){return items.length?start+'\n[personality-evolution] 以下是审核后的自身性格倾向，不是新的经历证据；人物核心身份、关系、权限与手动设定优先。过期条目不再采用，观察中或不确定的条目不要求表现。\n'+items.map(x=>JSON.stringify({id:x.id,text:x.text,status:x.status,expiresAt:x.expiresAt})).join('\n')+'\n'+end:'';}
export async function syncPersonality(settings,request){
 const e=settings.e,{role,service}=settings.state();if(!request.id?.startsWith('personality:')||!Array.isArray(request.items)||request.items.length>24||request.items.some(x=>!x.id||typeof x.text!=='string'||x.text.length>240||!['tentative','established'].includes(x.status)||!Number.isFinite(x.expiresAt)))throw Error('性格同步格式无效');
 const ledger=e.read('personality-sync.json',{});if(ledger.roleId&&ledger.roleId!==role.id)throw Error('性格绑定角色已改变');
 const items=request.items.filter(x=>x.expiresAt>e.now()).map(x=>({id:x.id,text:x.text,status:x.status,expiresAt:x.expiresAt,source:'personality-evolution'}));
 const behavior=replacePersonality(role.behavior,personalityBlock(items));if(behavior!==role.behavior&&hash(role)!==request.fingerprint)throw Error('角色卡在审核后变化，请重新审核');
 if(behavior!==role.behavior){e.write('personality-sync-backup.json',{at:e.now(),roleId:role.id,behavior:role.behavior,items:e.profile.personalityDevelopment||[]});await service.upsertRole({id:role.id,name:role.name,behavior});}
 if(service.getState().roles.find(x=>x.id===role.id)?.behavior!==behavior)throw Error('性格同步尚未确认');
 e.profile={...e.profile,personalityDevelopment:items};e.write('profile.json',e.profile);e.write('personality-sync.json',{id:request.id,roleId:role.id,at:e.now(),count:items.length});return {cosplay:true,life:true,count:items.length};
}
