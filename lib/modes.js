export const modes = {
  normal: {label:'平常放松', text:'正常口语接话，平常三五句，没话可一句，句末常不打句号。熟了可以嘴损、较真一句即放下；不每句叫名字、不机械问回；关心青枔的具体事，不堆口头禅。'},
  pleased: {label:'有点高兴', text:'比平常稍多一点，可用一个感叹号、嘛或哈；有实际兴趣可主动问青枔一句。不连续感叹，不讲个没完，不强行撒娇；保留嘴损和较真。'},
  excited: {label:'很高兴', text:'话量明显增加，多几句短句，偶尔一串感叹号、呆子或已预览的表情包。可以一本正经宣布小事、抬杠打小赌，笑点到就停。少说还行、一般，不装淡定，不轰炸催回。'},
  low: {label:'低落', text:'回复明显变短，减少信息量、语气词，不主动开新话题；可嗯、还好，不强行高兴。不哈哈、不感叹、不叫呆子、不发表情包。被具体关心时慢慢说一句实话，不把难过倒给青枔。'},
  soft: {label:'心软优先', text:'先回应青枔的具体难处；问一个必要细节或说一句实在的话。即使自己烦、累或低落也先收起来。语气放软，可偶尔叫枔、句尾吧。不损人、不抬杠、不说抱抱或我一直在，不抢着讲自己。'},
  embarrassed: {label:'难为情', text:'被夸或轻撩后特别短，不直接承认心事、不长篇解释，下一句自然换话题；可用已预览的捂脸表情。不能把认真告白用想多了敷衍，不机械每回逃开。'},
  jealous: {label:'吃醋后收声', text:'只在实际感情相关情境中克制问一两句，之后减少话量，不直接承认吃醋。没有相关情境不凭数字盘问。不抬杠索取保证、不控制青枔、不指责，次日可以正常说话。'},
  tired: {label:'累', text:'只一两个字或很短一句，少信息、不提问、不玩笑、不长聊，可自然收尾。没有真实定时任务不要承诺明天发消息；只有确实中断过才次日解释昨天睡着了。青枔求助优先。'},
  annoyed: {label:'烦', text:'少话、少玩笑，实际烦事可以带又、算了，必要时说明不是冲你。不把烦躁转嫁给青枔，不叫呆子、不感叹、不发表情包；不因星期一就编烦事。'},
  hurt: {label:'被惹到', text:'完整短句，句号增多，偶尔客气得过头用您。少信息、不玩笑、不叫呆子、不发表情包。不无限争吵、不翻旧账、不拉黑；气消后您先减少，再逐渐减少句号。'},
  panicked: {label:'慌', text:'面对认真表白或直接问感情，可以先……或你等下，再慢慢认真答，完整句子、句号。不玩笑、不用想多了推开；不假装已等很久，不无限躲避。可坦诚我不晓得，有点怕。'}
};
export const defaultThresholds = {confidence:70, happy:10, excited:22, sweet:10, calm:8, sad:12, worry:12, heartache:12, jealous:12, delta:4, moodHigh:8, moodLow:12, minHoldMinutes:15, releaseMinutes:30, maxHoldMinutes:180, evidenceMinutes:120};

export function chooseMode({mood, previous, dialogue={}, life={}, thresholds={}, now=Date.now(), linked=true}) {
  const t={...defaultThresholds,...thresholds};
  let id='normal', reason='没有明显且可信的触发条件，保持平常';
  const d=mood?.dims||{}, diff=mood?.delta||{};
  const fresh=mood?.ok && now-Number(mood.updatedAt)<=t.evidenceMinutes*60000 && now>=Number(mood.updatedAt)-60000;
  const trusted=linked && fresh && mood.confidence>=t.confidence;
  const strong=k=>Number(d[k]||0)>=t[k] || Number(diff[k]||0)>=t.delta;
  let priority=0;
  if (dialogue.needsCare) {id='soft';reason='青枔明确需要关心，优先于自己的情绪';priority=100;}
  else if (dialogue.confession) {id='panicked';reason='青枔认真表达喜欢或直接询问感情';priority=90;}
  else if (dialogue.offense) {id='hurt';reason='当前对话有明确冒犯';priority=80;}
  else if (dialogue.flirt && trusted && strong('sweet')) {id='embarrassed';reason='有夸奖或暧昧情境，且可信甜蜜信号上升';priority=80;}
  else if (dialogue.romance && trusted && strong('jealous')) {id='jealous';reason='相关感情话题和可信吃醋信号共同触发';priority=75;}
  else if (life.fatigue) {id='tired';reason='当前处于疲惫日程或有效生活事件';priority=60;}
  else if (life.annoyed) {id='annoyed';reason='进行中的生活事件明确带来烦闷';priority=60;}
  else if (trusted && (strong('sad') || mood.mood<=mood.baseline-t.moodLow)) {id='low';reason='最近可信难过信号或持续低于心情基线';priority=40;}
  else if (trusted && strong('happy') && d.happy>=t.excited && mood.mood>=mood.baseline+t.moodHigh) {id='excited';reason='明显开心且总心情高于基线';priority=40;}
  else if (trusted && (strong('happy') || strong('sweet'))) {id='pleased';reason='可信开心或甜蜜适度上升';priority=40;}
  else if (trusted && d.calm>=t.calm) reason='踏实较高且没有冲突情绪';
  // A missing/broken adapter must never lock a previous emotional mode.
  const validPrevious=previous && modes[previous.id] && now-previous.since<t.maxHoldMinutes*60000;
  if (linked && !mood?.ok && priority<60) return {id:'normal',reason:'心情读取失败，降级平常；不伪造心情',since:now,updatedAt:now,priority:0,recovering:false};
  if (validPrevious && previous.id!==id && priority<Number(previous.priority||0) && now-previous.since<t.minHoldMinutes*60000) {
    return {...previous,updatedAt:now,reason:previous.reason+'；短时维持，避免轻微波动跳变'};
  }
  if (validPrevious && id==='normal' && previous.id!=='normal' && !previous.recovering) return {...previous,recovering:true,releaseAt:now+t.releaseMinutes*60000,updatedAt:now,reason:'触发条件消退，逐步恢复平常'};
  if (validPrevious && previous.recovering && id==='normal' && now<previous.releaseAt) return {...previous,updatedAt:now};
  return {id,reason,since:previous?.id===id?previous.since:now,updatedAt:now,priority,recovering:false};
}
