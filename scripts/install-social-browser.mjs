import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const profile=process.argv[2]||path.join(os.homedir(),'.dsh/profiles/desktop');
const file=path.join(profile,'node_modules/dsh-browser-router/router.mjs');
let s=fs.readFileSync(file,'utf8');
const marker='// censhu-social-browser-v1';
const anchor="      task.calls.delete(message.toolCallId);";
if(!s.includes(marker)){
 if(!s.includes(anchor))throw Error('浏览器路由结构不兼容：找不到工具回执位置，未改写');
 fs.copyFileSync(file,file+'.before-social-experience.bak',fs.constants.COPYFILE_EXCL);
 s=s.replace(anchor,anchor+`
      ${marker}
      try { if(boundParent(task.parentId)) (lifeService||ctx.get?.('cenShuLifeShared',false))?.observeSocialTool?.({sessionId:task.parentId,sourceId:session.id+':'+message.toolCallId,tool:toolName,origin:'browser',text:(message.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\\n'),isError:!!message.isError}); } catch(error) { ctx.logger.warn('浏览交流经历接收失败：%s',error.message); }`);
 fs.writeFileSync(file,s);
}
console.log('Browser social receipt adapter installed');
