/* Read-only renderer. Receives the same /state response as the settings page;
 * opening or refreshing this panel must never invoke a model. */
(() => {
 const create=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
 const amount=v=>Number.isFinite(v)?Math.round(v).toLocaleString('zh-CN'):'—';
 const time=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'尚无请求';
 const labels={life:'生活',inner:'独处',agency:'主动进行'};
 const pair=(root,label,value)=>{const row=create('div',undefined,'context-stat');row.append(create('small',label,'mini'),create('strong',value));root.append(row);};
 window.renderContextDetails=x=>{
  const root=document.getElementById('contextDetails');if(!root)return;
  // Preserve expansion state during polling without interpolating private text as HTML.
  const opened=new Set([...root.querySelectorAll('details[open]')].map(d=>d.dataset.key));
  root.replaceChildren();
  const health=x.requestContext?.projection;
  root.append(create('p',health?.error?'最终请求投影保留原文、待恢复：'+health.error:health?.ready?'最终请求投影已接入 · 工具权限保持原样':'等待宿主接入最终请求投影','mini'));
  root.append(create('p','Gemini 为普通桌面、QQ、生活及子代理会话按任务选择工具和技能目录；生活资料仍只进入原绑定会话。完整能力可从目录按需载入，原权限与功能不变。失败时保留原文。','mini'));
  const canonical=r=>({...r,sessionId:String(r.sessionId||'').replace(/^session-/, '')});
  const budgets=(x.contextBudgets||[]).map(canonical),requests=(x.requestContext?.sessions||[]).map(canonical);
  const ids=[...new Set([...requests.map(r=>r.sessionId),...budgets.map(r=>r.sessionId)])];
  if(!ids.length){root.append(create('p','等待下一次真实模型请求。这里不会把旧会话累计估算当成本轮实际输入。','empty'));return;}
  for(const id of ids){
   const b=budgets.find(r=>r.sessionId===id),r=requests.find(r=>r.sessionId===id);
   const card=create('details');card.dataset.key=id;card.open=opened.has(id)||ids.length===1;
   const title=create('summary',id+' · '+time(r?.at||b?.at));title.style.cursor='pointer';card.append(title);
   const grid=create('div',undefined,'context-stats');
   pair(grid,'可用模型窗口',amount(b?.window));pair(grid,'回复预留',amount(b?.reserve));
   pair(grid,'发送前请求估算',amount(b?.request?.total));pair(grid,'模型输入回执',amount(r?.reported?.inputTokens??b?.request?.reported?.inputTokens));pair(grid,'缓存读取回执',amount(r?.reported?.cacheReadTokens??b?.request?.reported?.cacheReadTokens));card.append(grid);
   if(b?.request)card.append(create('p','发送前投影（原生格式转换前）：系统 '+amount(b.request.system)+' · 动态状态 '+amount(b.request.runtime)+' · 历史 '+amount(b.request.history)+' · 工具 '+amount(b.request.tools)+' tokens。估算与提供方回执分别显示。','mini'));
   if(b?.byOwner){const table=create('table');const header=create('tr');for(const t of ['资料来源','模型配额','实际采用','判断理由'])header.append(create('th',t));table.append(header);
    for(const [source,v] of Object.entries(b.byOwner)){const row=create('tr');for(const t of [labels[source]||source.replace(/^external:/,''),amount(v.requested),amount(v.used),v.reason||'—'])row.append(create('td',t));table.append(row);}card.append(table);}
   for(const [title,value] of [['本轮资料规划',b?.reason],['工具与结果规划',r?.reason],['请求处理',r?.detail],['运行降级',r?.error]])if(value)card.append(create('p',title+'：'+value,'mini'));
   if(r){
    const metrics=create('div',undefined,'context-stats');
    pair(metrics,'工具定义 · 选择 / 可用',amount(r.toolsSelected)+' / '+amount(r.toolsOffered));
    pair(metrics,'定义字符 · 原始 → 发送',amount(r.toolCharsBefore)+' → '+amount(r.toolCharsAfter));
    pair(metrics,'技能目录 · 选择 / 可用',amount(r.skillsSelected)+' / '+amount(r.skillsOffered));
    pair(metrics,'技能字符 · 原始 → 发送',amount(r.skillCharsBefore)+' → '+amount(r.skillCharsAfter));
    pair(metrics,'技能快照 · 原始 → 当前',amount(r.skillSnapshotsBefore)+' → '+amount(r.skillSnapshotsAfter));
    pair(metrics,'大结果 · 精简 / 候选',amount(r.resultsProjected)+' / '+amount(r.resultsOffered));
    pair(metrics,'原文计划复用',amount(r.resultPlansReused));card.append(metrics);
    if(r.skillsReason)card.append(create('p','技能选择：'+r.skillsReason,'mini'));
    if(r.retryAt)card.append(create('p','规划待恢复：'+time(r.retryAt)+'；此期间保留原始能力。','mini'));
    card.append(create('p','这里是最终请求投影回执；DSH 的 request/header 保存的是筛选前注册快照，不能将其工具数量当作实际发送量。','mini'));
    const detail=create('pre');detail.className='context';detail.textContent=JSON.stringify(r,null,2);const more=create('details');more.dataset.key=id+':request';more.open=opened.has(more.dataset.key);more.append(create('summary','查看真实投影回执（不含原文）'),detail);card.append(more);
   }
   if(b?.runtimeProjection)card.append(create('p','旧状态快照：'+amount(b.runtimeProjection.snapshotsBefore)+' → '+amount(b.runtimeProjection.snapshotsAfter)+' 条；移出本次请求 '+amount(b.runtimeProjection.snapshotsOmitted)+' 条，作为历史保留 '+amount(b.runtimeProjection.snapshotsHistorical)+' 条。会话原始记录保留。','mini'));
   if(b?.detail){const detail=create('pre',b.detail,'context');card.append(detail);}
   root.append(card);
  }
 };
})();
