import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const adapterProtocol=3;
export const sourceHash=source=>createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
export function verifyAdapterSource(source){
  return ['cen-shu-life adapter-protocol:3','readLifeMoodInputs(CFG_DIR','readLifeSituation(CFG_DIR','mergeLifeContribution(delta','recordLifeMoodReceipts(s, delta)','d.lifeEventReceipts =','d.behaviorContext =','s.behaviorContext =','life: obj.life','export const cenShuLifeAdapterProtocol = 3'].every(x=>source.includes(x));
}
export function adapterHealth(home,{startedAt=Infinity}={}){
  try{
    const meta=JSON.parse(fs.readFileSync(path.join(home,'cen-shu-life/mood-link-install.json'),'utf8'));
    if(!meta.moduleUrl)return {ready:false,code:'not_installed',message:'尚未安装心情联动适配，请安装或修复适配'};
    const file=fileURLToPath(meta.moduleUrl),source=fs.readFileSync(file,'utf8');
    if(!verifyAdapterSource(source))return {ready:false,code:'adapter_missing',message:'检测到心情插件升级或适配丢失，生活→心情联动已暂停；请修复适配'};
    if(meta.protocol!==adapterProtocol||meta.sourceSha256!==sourceHash(source))return {ready:false,code:'source_changed',message:'心情插件源码或适配协议已变化，请重新检查并修复适配'};
    if(Number(meta.installedAt)>startedAt)return {ready:false,code:'restart_required',message:'适配已安装，请重启 DSH 以载入新代码'};
    return {ready:true,code:'ready',message:'心情联动适配正常',protocol:adapterProtocol,pluginVersion:meta.pluginVersion};
  }catch(e){return {ready:false,code:e.code==='ENOENT'?'not_installed':'invalid_adapter',message:'心情联动不可用：'+(e.code==='ENOENT'?'适配或插件文件不存在':e.message)};}
}
