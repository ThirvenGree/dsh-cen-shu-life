import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const begin='【独处生活积累·自动同步开始】',end='【独处生活积累·自动同步结束】';
export function growthBlock(items){return items.length?begin+'\n以下是角色自身逐渐形成的偏好、习惯、项目与私人物件想法，源自主档“独处生活”。不是青枔现实事实，不覆盖核心身份、边界或明确任务；计划和想象不等于已完成。\n'+items.map(x=>'['+x.kind+'] '+x.text).join('\n')+'\n'+end:'';}
export function replaceGrowthBlock(text,block){const source=String(text||''),a=source.indexOf(begin),b=source.indexOf(end);if((a<0)!==(b<0)||a>=0&&b<a)throw Error('独处积累标记不完整，请检查手动修改');return a<0?[source.trimEnd(),block].filter(Boolean).join('\n\n'):(source.slice(0,a)+block+source.slice(b+end.length)).trimEnd();}
export class PersonalSettings{
 constructor(engine,getCosplay){this.e=engine;this.getCosplay=getCosplay;}
 state(){const service=this.getCosplay();if(!service?.getState||!service?.upsertRole)throw Error('dsh-cosplay角色接口未就绪');const state=service.getState(),role=state.roles?.find(x=>x.id===state.activeRole);if(!state.enabled||!role)throw Error('dsh-cosplay未开启或未选择角色');const binding=this.e.read('self-growth-sync.json',{}).roleId;if(binding&&role.id!==binding)throw Error('当前Cosplay角色已变化，暂停向其他角色同步');if(!binding&&!role.name.includes(this.e.profile.name))throw Error('当前Cosplay角色与生活角色名称不一致');return {service,role};}
 health(){try{const {role}=this.state();return {ready:true,roleId:role.id,name:role.name,sync:this.e.read('self-growth-sync.json',{})};}catch(error){return {ready:false,error:error.message};}}
 snapshot(){const {role}=this.state();return {role:structuredClone(role),fingerprint:hash(role),profile:{name:this.e.profile.name,background:this.e.profile.background,boundaries:this.e.profile.boundaries},mirror:this.e.profile.selfDevelopment||[]};}
 async sync(request){
 const e=this.e,{role,service}=this.state();if(typeof request.id!=='string'||!request.id.startsWith('growth:')||!Array.isArray(request.items)||request.items.length>64||request.items.some(x=>!x||typeof x.id!=='string'||!['preference','habit','project','keepsake'].includes(x.kind)||typeof x.text!=='string'||x.text.length>240))throw Error('生活积累同步格式无效');
 const items=request.items.map(x=>({id:x.id,kind:x.kind,text:x.text,source:'character-life',reviewedAt:x.reviewedAt})),block=growthBlock(items),behavior=replaceGrowthBlock(role.behavior,block),ledger=e.read('self-growth-sync.json',{});
 if(behavior!==role.behavior&&hash(role)!==request.fingerprint)throw Error('角色卡在审核后变化，请重新审核');
 if(behavior!==role.behavior){e.write('self-growth-sync-backup.json',{at:e.now(),requestId:request.id,roleId:role.id,behavior:role.behavior||'',selfDevelopment:e.profile.selfDevelopment||[]});await service.upsertRole({id:role.id,name:role.name,behavior});}
 const current=service.getState().roles.find(x=>x.id===role.id);if(current?.behavior!==behavior)throw Error('Cosplay同步尚未确认，稍后重试');
 // The inner-life archive is authoritative; this is a projection, never a new evidence source.
 if(hash(e.profile.selfDevelopment||[])!==hash(items)){e.profile={...e.profile,selfDevelopment:items};e.write('profile.json',e.profile);}
 e.write('self-growth-sync.json',{...ledger,roleId:role.id,lastId:request.id,at:e.now(),count:items.length,hash:hash(items)});return {cosplay:true,life:true,roleId:role.id,count:items.length};
 }
}
