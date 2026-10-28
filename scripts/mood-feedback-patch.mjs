import fs from 'node:fs';import path from 'node:path';
export function patchMoodFeedback(source){
 if(source.includes('// cen-shu-life feedback-ui v1'))return source;
 const importLine="normalizeMoodContext } from 'dsh-cen-shu-life/mood-link'";
 const anchor="            characterBehavior: 这份 === 'censhu' ? censhuBehavior() : undefined,";
 if(!source.includes(importLine)||!source.includes(anchor))throw Error('心情反馈接口不兼容，未写入');
 return source.replace(importLine,"normalizeMoodContext, readLifeFeedback } from 'dsh-cen-shu-life/mood-link'").replace(anchor,anchor+"\n            lifeLink: readLifeFeedback(CFG_DIR, 这份, s),")+'\n// cen-shu-life feedback-ui v1\n';
}
export function installFeedbackViews(target){
 const widget=path.join(target,'assets/widget.js');if(fs.existsSync(widget)){let text=fs.readFileSync(widget,'utf8');text=text.replace("(d.mood || '--') + '  ' + f.label","(d.mood == null ? '--' : Math.round(d.mood)) + '  ' + (d.moodLabel || f.label)");if(!text.includes("if(d.moodLabel==='烦')"))text=text.replace('var f = face(d.mood)',"var f = face(d.mood);if(d.moodLabel==='烦'){f.img=B+'/face-worry.png';f.label=d.moodLabel}");fs.writeFileSync(widget,text);}

 const patches=[['client.js',"        项.push(h('div', { key: 'preview', 'data-fm-sec': '' },",`        // cen-shu-life feedback-panel v2
        if(st && st.lifeLink) 项.push(h('div', { key: 'life-link', 'data-fm-sec': '' },
          h('div', { 'data-fm-h': '' }, '生活 ↔ 心情'),
          h('div', { 'data-fm-note': '' }, (st.lifeLink.enabled ? '联动开启' : '联动关闭') + ' · 待判断 ' + st.lifeLink.pending + ' 项 · 当前行为：' + (st.moodLabel || '平常')),
          ...st.lifeLink.active.map(e=>h('div', { key: e.name, 'data-fm-note': '' }, e.name + ' · ' + e.stage + ' · ' + e.reaction)),
          h('div', {style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}},h('div',{},h('strong',{},'受到的影响'),h('div',{'data-fm-note':''},st.lifeLink.receivedText)),h('div',{},h('strong',{},'产生的影响'),h('div',{'data-fm-note':''},st.lifeLink.emittedText))),
          st.lifeLink.last ? h('div', { 'data-fm-note': '' }, '最近生活判断：' + st.lifeLink.last.reason + '；生活判定量 ' + Math.round(st.lifeLink.last.moodDelta || 0) + (st.lifeLink.last.appliedTotal ? '；本轮实际总心情变化（含对话） ' + Math.round(st.lifeLink.last.appliedTotal.mood || 0) : '')) : null))
`],['assets/widget.js',"    ;(d.dims || []).forEach(function (x) {",`    // cen-shu-life feedback-panel v2
    if(d.lifeLink){
      var life = d.lifeLink
      panel.appendChild(el('div', 'fm-h', '生活 ↔ 心情'))
      panel.appendChild(el('div', 'fm-reason', (life.enabled ? '联动开启' : '联动关闭') + ' · 待判断 ' + life.pending + ' 项 · 当前行为：' + (d.moodLabel || '平常')))
      life.active.forEach(function(e){panel.appendChild(el('div', 'fm-reason', e.name + ' · ' + e.stage + ' · ' + e.reaction))})
      var columns=el('div');columns.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:12px';[['受到的影响',life.receivedText],['产生的影响',life.emittedText]].forEach(function(pair){var column=el('div');column.appendChild(el('div','fm-h',pair[0]));column.appendChild(el('div','fm-reason',pair[1]));columns.appendChild(column)});panel.appendChild(columns)
      if(life.last)panel.appendChild(el('div', 'fm-reason', '最近生活判断：' + life.last.reason + '；生活判定量 ' + Math.round(life.last.moodDelta || 0) + (life.last.appliedTotal ? '；本轮实际总心情变化（含对话） ' + Math.round(life.last.appliedTotal.mood || 0) : '')))
    }
`]];
 const pending=[];for(const [name,anchor,addition]of patches){const file=path.join(target,name);if(!fs.existsSync(file))continue;let text=fs.readFileSync(file,'utf8');if(text.includes('cen-shu-life feedback-panel v2'))continue;if(text.includes('cen-shu-life feedback-panel v1')){const start=text.lastIndexOf('\n',text.indexOf('// cen-shu-life feedback-panel v1'));const end=text.indexOf(anchor,start);if(end<0)throw Error('旧反馈显示无法升级：'+name);text=text.slice(0,start+1)+text.slice(end);}
if(!text.includes(anchor))throw Error('心情显示源码不兼容：'+name);pending.push({file,text:text.replace(anchor,addition+anchor)});}
 for(const {file,text}of pending){if(!fs.existsSync(file+'.before-life-feedback.bak'))fs.copyFileSync(file,file+'.before-life-feedback.bak');fs.writeFileSync(file,text);}
}
