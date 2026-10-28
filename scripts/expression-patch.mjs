import {expressionCatalog} from '../lib/mood-expression.js';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export function patchExpressions(source){
 if(source.includes('// cen-shu-life expressions v2'))return source;
 const anchor="            characterBehavior: 这份 === 'censhu' ? censhuBehavior() : undefined,";
 if(!source.includes(anchor))throw Error('表情接口不兼容');
 source="import {selectMoodExpression} from 'dsh-cen-shu-life/mood-expression';\n"+source;
 source=source.replace(anchor,anchor+"\n            expression: selectMoodExpression(s,这份 === 'censhu' ? censhuBehavior() : {}),");
 source=source.replace("const IMAGE_FILES = ['feiyu.png',", "const IMAGE_FILES = [...['great','good','ok','worry','sad','annoyed','sleepy','shy','affectionate','caring','flustered','jealous'].map(id=>'face-v2-'+id+'.png'),'feiyu.png',");
 return source+'\n// cen-shu-life expressions v2\n';
}
export function installExpressions(target){
 const dir=fileURLToPath(new URL('../data/expressions/',import.meta.url));for(const name of fs.readdirSync(dir))if(/^face-v2-.*\.png$/.test(name))fs.copyFileSync(path.join(dir,name),path.join(target,'assets',name));
 const catalog=expressionCatalog.map(e=>[e.id,e.label]);
 const clientFile=path.join(target,'client.js');let client=fs.readFileSync(clientFile,'utf8');client=client.replace("src: faceImg(st && st.mood)","src: st?.expression?.image || faceImg(st && st.mood)");client=client.replace("'五档表情'","'十二种细致表情 · 跟随心情与行为'");client=client.replace("[['great', '≥ 80 欢喜'], ['good', '62–79 开心'], ['ok', '42–61 一般'], ['worry', '25–41 心疼'], ['sad', '< 25 难过']]",JSON.stringify(catalog));client=client.replace("src: API + '/face-' + f + '.png'","src: API + '/face-v2-' + f + '.png'");fs.writeFileSync(clientFile,client);
 const widgetFile=path.join(target,'assets/widget.js');let widget=fs.readFileSync(widgetFile,'utf8');if(!widget.includes('d.expression.image'))widget=widget.replace("if(d.moodLabel==='烦'){f.img=B+'/face-worry.png';f.label=d.moodLabel}","if(d.expression){f.img=d.expression.image;f.label=d.expression.label}");if(!widget.includes('bodyImg.src=d.expression.image'))widget=widget.replace('function renderAll(d) {',"function renderAll(d) {\n    if(d.expression){bodyImg.src=d.expression.image;bodyImg.alt=d.expression.label}");fs.writeFileSync(widgetFile,widget);
}
