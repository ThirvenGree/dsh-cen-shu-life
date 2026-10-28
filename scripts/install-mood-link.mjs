import {patchMoodFeedback,installFeedbackViews} from './mood-feedback-patch.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceHash,verifyAdapterSource} from '../lib/adapter-health.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(process.argv[2]||path.join(root,'../dsh-feiyu-mood'));
const file=path.join(target,'lib/index.js');
let source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
function replaceOnce(from,to){if(!source.includes(from))throw Error('当前心情插件源码不兼容，未写入任何修改：'+from.slice(0,65));source=source.replace(from,to);}
if(!source.includes('// cen-shu-life mood-link v1')){
replaceOnce("export const name = 'feiyu-mood'", "// cen-shu-life mood-link v1\nimport { readLifeMoodInputs, lifeMoodJudgeContext, mergeLifeContribution, recordLifeMoodReceipts } from 'dsh-cen-shu-life/mood-link'\n\nexport const name = 'feiyu-mood'");
replaceOnce("    d.kind = String(raw.kind || '')", "    d.kind = String(raw.kind || '')\n    d.lifeEventReceipts = Array.isArray(raw.lifeEventReceipts) ? raw.lifeEventReceipts.filter(x => typeof x === 'string').slice(-300) : []\n    d.lastLifeInfluence = raw.lastLifeInfluence && typeof raw.lastLifeInfluence === 'object' ? raw.lastLifeInfluence : null");
replaceOnce('    behavior: obj.behavior,','    behavior: obj.behavior,\n    life: obj.life,');
replaceOnce('  let sys = o.censhu ? censhuJudge(o.self, o.owner) : 判断系统(o)', '  let sys = o.censhu ? censhuJudge(o.self, o.owner) : 判断系统(o)\n  if (o.lifeInputs?.length) sys += lifeMoodJudgeContext(o.lifeInputs)');
replaceOnce('          const delta = await judge(ctx, agent, info.text, reply, mode, 称呼)', '          const lifeInputs = 称呼.censhu ? readLifeMoodInputs(CFG_DIR, sid, key, loadState(key)) : []\n          let delta = await judge(ctx, agent, info.text, reply, mode, { ...称呼, lifeInputs })');
replaceOnce('          const s = getState(key, cfg.moodBase, { persist: false, halfHours: cfg.decayHalfHours })', '          const s = getState(key, cfg.moodBase, { persist: false, halfHours: cfg.decayHalfHours })\n          const sentLifeIds = new Set(lifeInputs.map(e => e.id))\n          const stillPending = lifeInputs.length ? readLifeMoodInputs(CFG_DIR, sid, key, s).filter(e => sentLifeIds.has(e.id)) : []\n          delta = mergeLifeContribution(delta, stillPending, s)');
replaceOnce('          if (step === 0 && !anyDim) {','          if (step === 0 && !anyDim) {\n            if (delta.lifeAcceptedIds?.length) { recordLifeMoodReceipts(s, delta); saveState(key, s); diag("生活事件已考虑，无需改变心情：" + delta.lifeAcceptedIds.length + " 项") }');
replaceOnce('          applyDelta(s, delta, cfg.moodFloor, !显著)', '          applyDelta(s, delta, cfg.moodFloor, !显著)\n          recordLifeMoodReceipts(s, delta)\n          if (delta.lifeAcceptedIds?.length) diag("生活事件参与本轮心情：" + delta.lifeAcceptedIds.length + " 项；与对话一次判断，不额外调用模型")');
}
if(source.includes('  if (o.lifeInputs?.length) sys += lifeMoodJudgeContext(o.lifeInputs)'))replaceOnce('  if (o.lifeInputs?.length) sys += lifeMoodJudgeContext(o.lifeInputs)','  if (o.censhu) sys += lifeMoodJudgeContext(o.lifeInputs || [])');
if(source.includes('      maxTokens: 1000,'))replaceOnce('      maxTokens: 1000,','      maxTokens: o.lifeInputs?.length ? 2400 : 1000,');
if(!source.includes('d.lifeEventsResetAt =')){
  replaceOnce("    d.kind = String(raw.kind || '')", "    d.kind = String(raw.kind || '')\n    d.lifeEventsResetAt = Number(raw.lifeEventsResetAt) || 0");
  replaceOnce('          const s = blankState()\n          s.mood = cfg.moodBase','          const s = blankState()\n          s.lifeEventReceipts = loadState(键).lifeEventReceipts || []\n          s.lifeEventsResetAt = Date.now()\n          s.mood = cfg.moodBase');
}
if(!source.includes('// cen-shu-life isolated simulation v1'))source+=`
// cen-shu-life isolated simulation v1
export async function simulateLifeJudgment(ctx, agent, input = {}) {
  const before = normState(input.initialState || {})
  const batch = Array.isArray(input.lifeInputs) ? input.lifeInputs.slice(0, 2) : []
  const judged = await judge(ctx, agent, String(input.userText || '今天怎么样'), String(input.reply || '普通地接了一句'), '', { self: '岑舒', owner: '青枔', censhu: true, lifeInputs: batch })
  if (!judged) throw new Error('心情判断未返回有效结果')
  const after = normState(before)
  const delta = mergeLifeContribution(judged, batch, after)
  applyDelta(after, delta, 0, false)
  recordLifeMoodReceipts(after, delta)
  return { simulation: true, before, after, delta }
}
`;
if(!source.includes('d.behaviorContext =')){
  replaceOnce('recordLifeMoodReceipts } from', 'recordLifeMoodReceipts, readLifeSituation, normalizeMoodContext } from');
  replaceOnce("    d.kind = String(raw.kind || '')", "    d.kind = String(raw.kind || '')\n    d.behaviorContext = normalizeMoodContext(raw.behaviorContext)");
  replaceOnce('          delta = mergeLifeContribution(delta, stillPending, s)', '          delta = mergeLifeContribution(delta, stillPending, s)\n          const semanticContext = readLifeSituation(CFG_DIR, sid, key)\n          const contextChanged = Object.keys(semanticContext).length && JSON.stringify(s.behaviorContext) !== JSON.stringify(semanticContext)\n          if (Object.keys(semanticContext).length) s.behaviorContext = semanticContext');
  replaceOnce('            if (delta.lifeAcceptedIds?.length) { recordLifeMoodReceipts(s, delta); saveState(key, s);', '            if (delta.lifeAcceptedIds?.length || contextChanged) { recordLifeMoodReceipts(s, delta); saveState(key, s);');
  source+='\n// cen-shu-life adapter-protocol:2\nexport const cenShuLifeAdapterProtocol = 2\n';
}
if(!source.includes('cen-shu-life adapter-protocol:3')){
  replaceOnce('const contextChanged = Object.keys(semanticContext).length && JSON.stringify(s.behaviorContext) !== JSON.stringify(semanticContext)', 'const contextChanged = JSON.stringify(s.behaviorContext || {}) !== JSON.stringify(semanticContext)');
  replaceOnce('if (Object.keys(semanticContext).length) s.behaviorContext = semanticContext', 's.behaviorContext = semanticContext');
  replaceOnce('if (delta.lifeAcceptedIds?.length || contextChanged)', 'if (delta.lifeProcessedIds?.length || contextChanged)');
  source=source.replaceAll('cen-shu-life adapter-protocol:2','cen-shu-life adapter-protocol:3').replace('cenShuLifeAdapterProtocol = 2','cenShuLifeAdapterProtocol = 3');
}
source=patchMoodFeedback(source);
if(!verifyAdapterSource(source))throw Error('适配源码校验失败，未写入；请检查心情插件版本');
if(!fs.existsSync(file+'.before-life-link.bak'))fs.copyFileSync(file,file+'.before-life-link.bak');
const link=path.join(target,'node_modules/dsh-cen-shu-life');fs.mkdirSync(path.dirname(link),{recursive:true});
if(!fs.existsSync(link))fs.symlinkSync(root,link,process.platform==='win32'?'junction':'dir');
else if(fs.realpathSync(link)!==fs.realpathSync(root))throw Error('已有联动依赖指向其他位置，请先核对');
const manifest=path.join(target,'package.json'),pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));pkg.dependencies||={};pkg.dependencies['dsh-cen-shu-life']='file:'+path.relative(target,root).replaceAll('\\','/');
installFeedbackViews(target);
fs.writeFileSync(manifest,JSON.stringify(pkg,null,2));fs.writeFileSync(file,source);
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');fs.mkdirSync(path.join(home,'cen-shu-life'),{recursive:true});fs.writeFileSync(path.join(home,'cen-shu-life/mood-link-install.json'),JSON.stringify({version:3,installed:true,moduleUrl:pathToFileURL(file).href,protocol:3,sourceSha256:sourceHash(source),pluginVersion:pkg.version,installedAt:Date.now()},null,2));
console.log('已安装生活事件 → 原心情判断适配。重启 DSH 生效；原角色卡与原心情记录未改写。');
