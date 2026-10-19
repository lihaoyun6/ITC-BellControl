/* view — 考试模式
   广播控制台 · 替代厂商后台的打铃配置面板
   ////////////////////////////////////////////////////////////// */

/* ══════════════════════════════════════════════════════════════════
   考试模式
   ──────────────────────────────────────────────────────────────────
   模型：考试分区（二级分组）= 若干点位 + 若干分组的组合，每个分区
   有自己的铃声时间表。

   启用时只做两件事，而且**原件一律不动**：
     1. 清空并重写「¤exam_task」这一个列表 —— 每场考试的开考/结束/听力铃
        全在这里，不做增量，推倒重来，省得上一场的铃残留下来。
     2. 每个「已启用的正常列表」另存一份「原名¤temp」副本，原件停用。
        闪避与裁剪只发生在副本里：与考试区域重合的点位/分组、以及走廊
        和室外，从副本每条铃声的执行区域里减掉；原件保持完好。

   这么分层是为了「关闭考试模式」能一秒收场：删掉全部 ¤temp 副本、把原件打开、
   清空 ¤exam_task。不用赌任何快照能不能正确还原 —— 原件根本没被改过。

   厂商格式只认名字，减法是按名字做的，所以只能整组地减（不能表达
   「某组里除了某几个点位」），宁可少响不可误响，考试场合取这个方向。
   ══════════════════════════════════════════════════════════════════ */
const EXAM_LIST_NAME  = "¤exam_task";      /* 考试铃声写进这个列表 */
const EXAM_OLD_NAME   = "考试模式";        /* 面板早期版本的名字，见到就改名收编 */
const EXAM_LEGACY_NAMES = [EXAM_OLD_NAME, "考试铃声"];  /* 老名字，见到就当考试列表收编 */
const EXAM_SUFFIX     = "¤temp";           /* 正常列表的考试副本后缀 */
/* 铃名里三个字段的分隔符。分区名和科目都是人随便打的自由文本，本身就可能带空格
   （「数学 必修」），按空格数段切不回来 —— 用一个中文名里不会出现、又不是正则
   元字符的字符当分隔符。名字长这样：分区¤角色¤科目，撞名时再挂一段 ¤时刻。 */
const EXAM_SEP        = "¤";
/* 静音区域没有自己的字段，靠考试列表里一条**没有铃声**的计划存着：它的执行区域
   就是静音区域。不挂周期 —— 没周期就没有「哪一天」，从根上不会响。 */
const EXAM_SILENCE_NAME = EXAM_SEP + "silence_zone";
const EXAM_STRAT_NAME = "考试日期（面板）";   /* 老名字：一条通吃的那版，见到就改造成当天那条 */
const EXAM_STRAT_PREFIX = "考试日期 ";        /* 老名字的前缀（一天一条的那版），只剩认旧数据用 */
/* 每个考试日期一条周期。名字里带日期，同一天考的科目共用一条 —— 一场考试
   通常就 1~3 天。厂商那边一条铃声只能靠「周期」绑日期，没有别的口子，
   所以「这个科目考这一天」这件事只能落在周期上。
   名字就长这样：「考2026-10-15」（用户定的格式，不带任何后缀）。 */
const stratNameOf = date => "考" + date;
/* 认「这条周期是面板建的」：按名字。新版是「考+日期」，老数据是上面那两个名字。
   手建的周期不会长成这样，所以认准了才敢删。 */
function isExamStratName(name){
  const n = String(name || "");
  return n === EXAM_STRAT_NAME || n.indexOf(EXAM_STRAT_PREFIX) === 0
      || /^考\d{4}-\d{2}-\d{2}$/.test(n);
}
const isExamList = g => !!g && (g.name===EXAM_LIST_NAME || EXAM_LEGACY_NAMES.indexOf(g.name)>=0);
const isExamCopyName = n => String(n||"").endsWith(EXAM_SUFFIX);
const isExamCopy = g => isExamCopyName(g && g.name);

/* 考试模式自己造出来的东西，在「铃声计划」里一律不露面：
   - ¤exam_task：考试铃声都写在这里，它不是一份「日常计划」
   - xxx¤temp：正常列表的考试副本，是排布的中间产物
   它们还是服务器上真实的列表（考试模式要按名字找它们），只是铃声响不响由
   考试模式说了算，人不用去想它们，摆出来只会让人以为要手动维护。 */
const isExamHiddenList = g => isExamList(g) || isExamCopy(g);

/* ── 抽屉和提示里那行字是**给人看的** ────────────────────────────────
   所以下面这个函数是这一页唯一允许拼「标签」的地方，它保证不出现
   `¤temp` / `¤exam_task` / `副本` / `临时列表` 这些服务器上的说法 —— 用户没理由认识它们，
   认出来也只会在厂商后台里到处找一个他从没建过的列表。

   用户认识的名字只有两个：他自己的那个列表（原名），和「考试铃声」。 */
const examOpLabel = listName => {
  const n = String(listName||"");
  if (n===EXAM_LIST_NAME || EXAM_LEGACY_NAMES.indexOf(n)>=0) return "[考试] 考试铃声";
  if (isExamCopyName(n)) return "["+n.slice(0,-EXAM_SUFFIX.length)+"]";
  return "["+n+"]";
};

/* 服务器上某个列表的 ¤temp 副本（没有就返回 null）。副本名 = 原名 + "¤temp"，
   所以去掉后缀就是原件名。 */
const examCopyOf = g => S.data.groups.find(x=> isExamCopy(x) && x.name.slice(0,-EXAM_SUFFIX.length)===g.name) || null;

/* 只要有 ¤temp 副本在，它的原件就是**锁定的**：考试期间发声的是副本，
   改原件既不会生效（副本已经拍好了），还会破坏「原件完好」这个前提 ——
   关闭考试模式要恢复的是原件的原样。所以锁住的不是副本，是原件。 */
function examLockedOriginals(){
  const ids = new Set();
  /* 已经排队等着删掉的副本不算数 —— 刚按下「关闭考试模式」，锁应当当场松开。
     面板别处也是乐观的（删列表本地就消失了），这里跟着走。 */
  const going = new Set(S.pending.filter(o=>o.status==="pending" && o.kind==="list-delete")
    .map(o=> String(o.bellId||"").replace(/^list:/,"")));
  S.data.groups.forEach(g=>{
    if (!isExamCopy(g) || going.has(String(g.id))) return;
    const orig = S.data.groups.find(x=> x.name===g.name.slice(0,-EXAM_SUFFIX.length));
    if (orig) ids.add(Number(orig.id));
  });
  return ids;
}
const isExamLocked = g => !!g && Number(g.id)>0 && examLockedOriginals().has(Number(g.id));

/* 考试期间那道提醒（用户定的）：开着考试模式的时候，新建一条任务、或者启用一条本来
   停着的任务，都得先问一句 —— 这两种动作都是往**正在发声的那套东西**上加内容，而
   加的这一条会不会撞上考试，只有人知道（考试铃声的时段和区域是这套界面算的，新加的
   任务不在其中）。所以这里只报信、不判断、也不拦：确认了就照做。
   run 是要办的那件事，点「取消」它一次都不跑，弹窗也已经关掉了。
   返回 true = 拦下来问了人，false = 没考试、当场就办了。 */
function examGuard(run){
  if (!(S.exam && S.exam.on)){ run(); return false; }
  openConfirm("考试模式", "当前已启用考试模式，请确认新添加或启用的任务不会干扰考试。", run, "继续");
  return true;
}

/* isoOf / todayISO 搬去了 00-core（月历控件在 20-ui 里也要用它们）。
   星期缩写也归月历控件所有，见 20-ui 的 CAL_DOW。
   （这儿原来还有个 addDays()，只给老存档那条「startDate→endDate 展开成每一天」
   的搬家用；日期改成每个科目自带一格之后那段搬家没了，它也就没人问了。） */

/* 面板上「一份考试安排」长什么样。用户改一下就存进浏览器本地（用户定的），
   下次打开面板先拿这一份；服务器上还有正在进行的考试时，readExamState 会照着
   服务器上的铃声重排一遍，覆盖本地这份。 */
function defaultExam(){
  return {
    on:false, listId:null,
    /* 听力铃排在开考铃之后几分钟 —— 考试安排底下那个数字框，默认 1（见 listenDelay）。
       它只是**手上这一份**的一个字段：不发去服务器，重开面板又回到 1。
       服务器上已经排好的那些听力铃不受影响（它们的时刻是启用那一刻算定的）。 */
    listenDelay: 1,
    /* 进考试模式先看到一张干净的配置表。静音区域留空，哪些区域要静音由人当场选 ——
       以前默认帮人静音一批点位（走廊/室外），人没注意就启用了。
       **考哪几天不在这儿，在每个科目自己身上**（bells[].date，见 blankExamRow）；
       启用时按「日期的并集」在服务器上维护「指定日期」周期，考试铃声各挂各的那条。 */
    mute: [],
    /* **第一次打开就摆着一个空分区**，不是零个。零个分区的页面是一片空白，人不知道
       该从哪儿下手；而下头那枚「添加分区」看着像是在问「要不要开始」，其实它只管补
       第二个。留着这个空壳什么也不影响：启用考试模式那一关要求分区**既有区域又有
       科目**（见 enableExam 的过滤），空分区照样被拦下来。 */
    sections: [blankSection(1)],
    /* checked：点过「启用考试模式」并且被拦下来过。置位之后那一行缺的格才标红，
       改对了随重画消失（见 examSectionHTML / examRowBad）。 */
    checked: false
  };
}
/* 本机留的那一份。改一下存一下（实时），打开面板先拿它；服务器上正在考试时
   由 readExamState 覆盖。存进去的是手上这份的普通对象，没有函数/引用。 */
const EXAM_LS_KEY = "exam";
function saveExamLocal(){
  if (S.exam) LS.set(EXAM_LS_KEY, S.exam);
}
function loadExamLocal(){
  const e = LS.get(EXAM_LS_KEY, null);
  return (e && typeof e==="object" && Array.isArray(e.sections)) ? e : null;
}

/* ══ 从服务器上把考试模式读回来 ═════════════════════════════════════
   打开面板、登录完的那一刻，先看服务器上有没有正在进行的考试：有就照着真实
   摆着的东西反解一遍，**覆盖本地那份**；没有就把本地那份留着（用户定的）。

     · 分区 / 角色 / 科目 —— 考试铃声的名字，用 EXAM_SEP 分段（见 examBellSplit）
     · 考试日期          —— 这条铃声挂的那条「考YYYY-MM-DD」周期（指定日期）
     · 分区的执行区域    —— 那个分区里每条铃声自己的执行区域（都一样）
     · 静音区域          —— ¤silence_zone 那条的执行区域
     · 音量 / 音源       —— 开考铃和听力铃自己的 volume / medias

   「考试模式开着」也是算出来的：服务器上还有 ¤temp 副本、或者 ¤exam_task 里还有
   考试铃声。**存**出来的状态会跟服务器对不上（换台电脑打开就是另一个样，上一版
   就是这么出的岔子），**算**出来的不会。

   反解不出来的只有「人还没启用、正在编的那份」—— 它本来就不在服务器上，
   留在本机（localStorage）的那一份里，见 saveExamLocal / loadExamLocal。 */
async function readExamState(){
  const e = defaultExam();
  const listId = listIdByName(EXAM_LIST_NAME);
  const copies = S.data.groups.filter(g=> isExamCopy(g) && Number(g.id)>0).length;
  e.listId = listId;

  let rows = [];
  if (listId != null){
    try{ rows = (await fetchBells(listId)).map(normBell); }catch(err){}
  }
  e.on = copies > 0 || rows.length > 0;
  /* 服务器上一条考试铃声都没有 —— 本机那份留着：那要么是**人正在编、还没启用**
     的一份，要么是刚「结束考试」收下来的那份。它不在服务器上，服务器没资格把
     它抹掉。
     判「服务器上有没有考试」得看**铃声**，不能看列表在不在：结束考试只把
     ¤exam_task 清空停用，列表本身是一直留在那儿的，照着列表判等于每按一次
     「重新拉取」就把人手上那份抹一遍。 */
  if (!rows.length) return S.exam || loadExamLocal() || e;

  /* 分区\n科目\n日期 → 同一个「科目 + 那一天」的几条铃声（开考 / 结束 / 听力）。
     一个科目一天只写一行，同一个科目考两天就是两条 —— 名字撞了才会挂上那段
     ¤时刻，所以分组得靠日期，不能靠名字。 */
  const buckets = new Map();
  const areaOf  = new Map();                    /* 分区名 → 它的执行区域 */
  rows.forEach(b=>{
    if (b.name === EXAM_SILENCE_NAME){          /* 静音区域借这条存着 */
      const a = bellArea(b);
      e.mute = a.g.concat(a.t);
      return;
    }
    const p = examBellSplit(b.name);
    if (!p) return;                             /* 认不出的（人手工加的）不理 */
    if (!areaOf.has(p.sec)) areaOf.set(p.sec, bellArea(b));
    const date = examBellDate(b);
    const key  = p.sec + "\n" + p.subject + "\n" + date;
    let bk = buckets.get(key);
    if (!bk){ bk = {sec:p.sec, subject:p.subject, date:date, starts:[], ends:[], listens:[]}; buckets.set(key, bk); }
    bk[p.role==="start" ? "starts" : p.role==="end" ? "ends" : "listens"].push(b);
  });

  const bySec = new Map();
  const toSec = t => hmsToSec(hhmmToHMS(t) || "08:00:00");
  buckets.forEach(bk=>{
    /* 同一个科目同一天排了两场的：开考铃按时刻排序，结束铃按同样的顺序贴上去 */
    bk.starts.sort((a,b)=> toSec(a.time) - toSec(b.time));
    bk.ends.sort((a,b)=> toSec(a.time) - toSec(b.time));
    const list = bk.starts.map((s,i)=>{
      const en = bk.ends[i];
      return {
        date: bk.date, subject: bk.subject,
        start: String(s.time||"").slice(0,5),
        end:   en ? String(en.time||"").slice(0,5) : "",
        media: s.mediaNames[0] || "", vol: Number(s.volume) || 70,
        listen: "", listenVol: LISTEN_VOL_DEFAULT
      };
    });
    /* 听力铃认领它那一行：开考后 listenDelay() 分钟那一条（写出去时就是这么算的） */
    bk.listens.forEach(l=>{
      const row = list.find(r=> toSec(r.start) + listenDelay()*60 === toSec(l.time))
               || list.find(r=> !r.listen);
      if (!row) return;
      row.listen = l.mediaNames[0] || "";
      row.listenVol = Number(l.volume) || LISTEN_VOL_DEFAULT;
    });
    if (!list.length) return;                   /* 只有结束铃／听力铃，凑不出一行 */
    bySec.set(bk.sec, (bySec.get(bk.sec)||[]).concat(list));
  });

  const names = Array.from(bySec.keys()).sort((a,b)=> a.localeCompare(b, "zh-CN", {numeric:true}));
  e.sections = names.map((n,i)=>{
    const a = areaOf.get(n) || {t:[], g:[]};
    const list = bySec.get(n).sort((x,y)=> (x.date+x.start).localeCompare(y.date+y.start));
    return { id:"s"+(i+1), name:n, t:a.t.slice(), g:a.g.slice(), bells:list };
  });
  if (!e.sections.length) e.sections = [blankSection(1)];
  /* 服务器上这份是准的 —— 覆盖本机存的那份。 */
  LS.set(EXAM_LS_KEY, e);
  return e;
}

/* 铃名 → {分区, 角色, 科目}。名字是「分区¤角色¤科目」，同列表内撞名的那几条
   尾巴上还挂了一段 ¤时刻（见 examBellName），解析时只看前三段。 */
function examBellSplit(name){
  const p = String(name||"").split(EXAM_SEP);
  if (p.length < 3) return null;
  const role = (EXAM_ROLES.find(x=> x.label===p[1]) || {}).role;
  return role ? {sec:p[0], role:role, subject:p[2]} : null;
}
/* 这条考试铃声考的是哪天：它挂的那条「指定日期」周期说了算（写出去时一天一条，
   名字就是 stratNameOf(date)）。认不出来退回今天，和 blankExamRow 的路子一样。 */
function examBellDate(b){
  const s = S.data.strategies.find(x=>Number(x.id)===Number(b.strategyId));
  if (!s || Number(s.time_type)!==3) return todayISO();
  const d = (s.assign_dates||[])[0];
  const t = String(d && d.dates!=null ? d.dates : (d||"")).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayISO();
}
const blankSection = n => ({ id:"s"+Date.now().toString(36)+n, name:"分区"+n, t:[], g:[], bells:[] });
const examSection = id => S.exam.sections.find(s=>s.id===id);

const EXAM_ROLES = [
  {role:"start",  label:"开考"},
  {role:"end",    label:"结束"},
  {role:"listen", label:"听力"}
];
/* 听力音量默认给 85 而不是铃声音量那个 70：听力是整段音频，考场后排要听清，
   校园广播一般也是往大了走才刚好。铃声音量留在 70 —— 铃只响几秒，太响反而
   是惊吓。两条默认值不同是有意的。 */
const LISTEN_VOL_DEFAULT = 85;
/* date 是这个科目考的那一天，默认今天 —— 加一行的当场多半就是在排今天这场。
   一个科目只能有一天：厂商的「指定日期」周期是一条 assign_dates 数组不假，
   但页面上一行只放得下一天，一科考两天（比如上午语文下午数学）分成两行更清楚。
   音源留空（显示「无」）：没人替用户挑，挑错了是考场上放错音；空着就归
   examRowBad 管，启用考试模式那一下会拦。 */
/* 本组（分区）已经排过科目时，新一行的默认开考时间接在**最后一个科目**的
   结束时间之后 10 分钟（用户定的）；还没有科目就还是 08:00。
   时刻在行里可能是 "HH:MM" 也可能是 "HH:MM:SS"，统一按秒算再取回 "HH:MM"；
   真排到午夜之后没有意义，停在 23:59。 */
function examNextStart(sec){
  const last = sec && sec.bells && sec.bells.length ? sec.bells[sec.bells.length-1] : null;
  if (!last || !last.end) return "08:00";
  const t = hmsToSec(last.end) + 10*60;
  return secToHMS(Math.min(t, 23*3600 + 59*60)).slice(0,5);
}
/* n 是这一行在列表里的位次（1 起）：科目默认就叫「科目n」。按位次而不是按
   已有行数取名是有意的 —— 用户把第一行改叫「语文」之后再添加一行，新行仍然
   叫「科目2」而不是「科目1」。start 由调用方按本组上一科算好（见上），
   没给就沿用老默认 08:00。结束时间跟着开考走：默认一小时（用户定的），
   所以没有上一科时还是 08:00–09:00，有上一科时就是「上一科结束+10 分」起、
   再考一小时。 */
const blankExamRow = (n, start)=>{
  const st = start || "08:00";
  const en = secToHMS(Math.min(hmsToSec(st)+3600, 23*3600 + 59*60)).slice(0,5);
  return {
    date: todayISO(),
    start: st, end: en, subject:"科目"+(n||1),
    media:"", vol:70,
    listen:"", listenVol:LISTEN_VOL_DEFAULT
  };
};
/* 一行考试安排缺什么。返回 {media?/subject?/end?}，齐了就是空对象。
   启用考试模式前逐行过一遍（examSectionHTML 按它标红、enableExam 按它拦截）：
   这三格空着写出去的就是一条没音源 / 没科目名 / 没有结束铃的铃声。 */
function examRowBad(r){
  const bad = {};
  if (!r.media) bad.media = true;
  if (!String(r.subject||"").trim()) bad.subject = true;
  /* 开考时间有默认值但可以删空；真删空了就得在启用这一下拦住 —— 没有开考时刻，
     这条安排写出去就只是一组没有起点的铃。 */
  if (!r.start) bad.start = true;
  /* 结束时间必须填，而且不能早于开考时间 —— 反过来写出来的结束铃排在开考铃前面，
     服务器照收，到点先响结束铃。 */
  if (!r.end || hmsToSec(r.end) < hmsToSec(r.start)) bad.end = true;
  return bad;
}
/* 听力排在开考后几分钟，考试安排底下那个数字框说了算（默认 1）。广播系统要先把考试铃
   放完、考场静下来，听力才起 —— 所以最小是 1 分钟：0 就和开考铃挤在同一时刻了。
   框里空着、写了非数、或者被全选删掉的那一刻，一律按 1 走：这个数一路乘进时刻里，
   NaN 写出去就是一条没有时刻的铃声。 */
function listenDelay(){
  const n = Math.round(Number(S.exam && S.exam.listenDelay));
  return n >= 1 ? Math.min(n, 60) : 1;
}
function examRowTime(row, role){
  if (role==="end") return row.end;
  if (role==="listen") return secToHMS(hmsToSec(hhmmToHMS(row.start)||"08:00:00") + listenDelay()*60).slice(0,5);
  return row.start;
}
/* 这条安排要写几条铃声：开考填了才有（默认 08:00，但允许删空），
   结束 / 听力填了才有 */
const examRowRoles = r => (r.start?["start"]:[]).concat(r.end?["end"]:[], r.listen?["listen"]:[]);

/* 名称 ↔ 分组 的成员关系（groupByName / groupsOfTerminal / splitNames /
   groupMembers）和 weekNumOf 已经搬到 00-core.js 去了 —— 它们跟考试无关，
   「更多功能」页的终端反查也要用。这里照旧直接调，全局作用域里找得到。 */

/* 考试模式下「不该响」的点位集合与分组集合 —— 静音区域和考场（分区）合起来的全部。
   两栏填的东西**生效范围一样**：只在考试时段里让路。7:40 开考，6:50 的早自习照响，
   静音区域也一样照响 —— 静音不是「考试那几天全天不打」，是「考试时段里不打」（用户
   定的）。所以这儿只剩一对集合，谁在什么时候被减掉见 examTrimOf。

   两栏的差别只在**盖住哪些考试**：分区挂在某一场考试上（那一场的时段），静音区域
   是「每一场都算」。

   静音项和分区项都可能是分组名或点位名，按名字分流：
   分组 → 记进 g，并把组内点位也记进 t（这样直接列了点位的铃声也能减掉）。 */
function examSets(){
  const t = new Set(), g = new Set();
  const addGroup = (G, T, n) => { if (n && !G.has(n)){ G.add(n); groupMembers(n).forEach(x=>T.add(x)); } };
  const addTerm  = (T, n) => { if (n) T.add(n); };
  (S.exam.mute||[]).forEach(n => groupByName(n) ? addGroup(g, t, n) : addTerm(t, n));
  S.exam.sections.forEach(s=>{ s.t.forEach(n=>addTerm(t, n)); s.g.forEach(n=>addGroup(g, t, n)); });
  return {t, g};
}
/* 把一条铃声的区域按考试模式裁剪 → {t,g,changed,removedT,removedG} */
function trimForExam(area, sets){
  const {t:exT, g:exG} = sets;
  const removedT = area.t.filter(n => exT.has(n) || groupsOfTerminal(n).some(x=>exG.has(x)));
  const removedG = area.g.filter(n => exG.has(n) || groupMembers(n).some(x=>exT.has(x)));
  const t = area.t.filter(n=> removedT.indexOf(n)<0);
  const g = area.g.filter(n=> removedG.indexOf(n)<0);
  return {t, g, changed:(removedT.length+removedG.length)>0, removedT, removedG};
}
/* weekNumOf 也搬去 00-core.js 了（见上面那段） */
/* ── 这条铃声会不会在考试时段里真的响 ──────────────────────────────
   两关都要过：**哪天**（周期里有没有考试那一天）和**哪一刻**（那一刻开考没有）。

   只判日期是不够的：副本是**整段窗口**顶替原件的，只判日期就把考场里一整天的
   日常铃声全抠掉了 —— 7:40 开考，6:50 的早自习也「被禁用」了（用户看出来的
   就是这个）。考试开始之前、结束之后，那些教室还是普通教室，铃照响。

   一天的时段按**每条考试安排自己**的「开考 → 结束」算，不取当天的最早和最晚：
   上午一场、下午一场中间那个空档本来就不在考试里，那声铃该响。
   边界取闭区间 —— 正好压在开考或结束那一刻的日常铃声让路（那一下考场里响的
   该是考试铃）。结束时间没填的按一个点算。

   周期认不出的（id 找不到、time_type 1/2）不猜日期，交给时刻判。老那条兜底
   「认不出就算重合」在这儿同样成立：漏裁是考场里多响一声，比多裁一间教室轻。

   时刻用的是报文 execute_time，和面板上、铃声表里显示的是一回事。 */
function examSpans(){
  const out = [];
  S.exam.sections.forEach(sec=> (sec.bells||[]).forEach(r=>{
    const d = String(r.date||"").slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const a = hmsToSec(hhmmToHMS(r.start) || "08:00:00");
    const e = r.end ? hmsToSec(hhmmToHMS(r.end) || "08:00:00") : a;
    out.push({d, a, b: Math.max(a, e)});
  }));
  return out;
}
function bellHitsExamTime(b){
  const spans = examSpans();
  if (!spans.length) return false;              /* 一天考试都没排，什么都不用改 */
  const s = S.data.strategies.find(x=>Number(x.id)===Number(b.strategyId));
  const tt = s ? Number(s.time_type) : NaN;
  /* 读回来是 [{repeat_weeks:1}] / [{dates:"2026-10-13"}]，本地刚建的是裸值，两种都收 */
  const weeks = tt===0 ? new Set((s.repeat_weeks||[]).map(x=>Number(x && x.repeat_weeks!=null ? x.repeat_weeks : x))) : null;
  const dates = tt===3 ? new Set((s.assign_dates||[]).map(x=>String(x && x.dates!=null ? x.dates : x).slice(0,10))) : null;
  const mins = (b.times||[]).map(t=> hmsToSec(hhmmToHMS(t) || t));
  return spans.some(sp=>{
    /* 这一天对不上它的周期（或者一个星期都没勾 = 本来就不响）→ 裁了只是白裁 */
    if (weeks && !weeks.has(weekNumOf(sp.d))) return false;
    if (dates && !dates.has(sp.d)) return false;
    return mins.some(m=> m>=sp.a && m<=sp.b);
  });
}
/* 一条铃声在副本里该怎么改：**时刻落在考试时段里才让路**，静音区域也不例外
   （那套「不在时段里就只减静音」的两段式已经没有了 —— 用户定的：静音区域同样按
   考试时段判，不是考试那几天全天不打）。不在时段里的原样不动。 */
const noTrim = area => ({t:area.t, g:area.g, changed:false, removedT:[], removedG:[]});
function examTrimOf(b, sets){
  const area = bellArea(b);                     /* 已经是新数组 */
  return bellHitsExamTime(b) ? trimForExam(area, sets) : noTrim(area);
}
const examAreaUnion = ()=>{
  const t=[], g=[];
  S.exam.sections.forEach(s=>{ s.t.forEach(n=>{ if(t.indexOf(n)<0) t.push(n); }); s.g.forEach(n=>{ if(g.indexOf(n)<0) g.push(n); }); });
  return {t,g};
};

/* ── 报文 ─────────────────────────────────────────────────────────── */
/* 一条考试铃声的名字：分区¤角色¤科目（见 EXAM_SEP）。
   角色夹在中间，正好把前后两个自由文本隔开；科目放最后，它里面带空格也不怕。
   同列表内铃名必须唯一，撞了就再挂一段 ¤时刻（第 4 段，解析时取前三段就丢掉）。 */
function examBellName(section, row, role, taken){
  const subject = String(row.subject||"").trim() || "考试";
  const tail = (EXAM_ROLES.find(x=>x.role===role)||{}).label || role;
  const time = examRowTime(row, role);
  let n = section.name + EXAM_SEP + tail + EXAM_SEP + subject;
  if (taken.has(n)) n += EXAM_SEP + hm(time);
  taken.add(n);
  return n;
}
function examBellBody(section, row, role, name, listId, stratId){
  const time  = examRowTime(row, role);
  const media = role==="listen" ? row.listen : row.media;
  const vol   = role==="listen" ? row.listenVol : row.vol;
  return {
    name: name,
    /* 周期 = 这一天那条「指定日期」策略（stratNameOf）；考哪一天由它说了算。
       新建的周期此刻还没 id，是 null —— 提交回来之后由 applyExamStrategies 的
       onOk 按 examDate 回填（报文里那个字段见 enableExam）。 */
    timing_bells_strategy_id: stratId!=null ? Number(stratId) : examStrategyId(row.date),
    timing_bells_groups_id: Number(listId!=null ? listId : S.exam.listId),
    terminals_light_id: 1,
    volume: Number(vol||70),
    type: 1, priority: 50,
    /* life_time 是这条铃声**放多久**，不是「打几秒铃」—— 所以必须跟着 media 走，
       不能写死成考试铃那个文件。听力音频十七八分钟，写死成考试铃的 6 秒就是
       「响一下就停」，人还以为音频传坏了。play_model 保持 0（列表播放）：
       配合全长 life_time，正好是从头放到尾一遍，不是循环。 */
    sound_source: { life_time: lifeTimeOf([media]), play_model: 0 },
    is_done: 1,
    timing_bells_mode: "1",
    execute_time: hhmmToHMS(time) || "08:00:00",
    ...areaJunc(section.t, section.g),                        /* 带 id，见 00-core.js */
    ...mediaJunc([media], []),
    led_text: "", led_display_cfg_id: 1
  };
}
/* ── 考试日期 → 服务器上的「指定日期」周期 ──────────────────────────
   厂商的周期只有四种：按周 / 按天 / 按日期区间 / 指定日期。考试日期是具体的
   几天、可以不连续，只有最后一种能表达，形状是 assign_dates:["2026-10-13", …]。

   **一天一条**，名字里带日期（stratNameOf）。理由：一条铃声只能挂一个周期，
   而「这个科目考这一天」只落在周期上；一天一条正好让同一天考的科目共用一条。
   一场考试通常 1~3 天，就是 1~3 条周期。

   每条都按名字找，找不到就新建；新建时 id 要等提交回来才拿得到，所以挂在
   它下面的考试铃声会在 onOk 里被回填（靠报文身上的 examDate 找）。 */
function examDates(){
  const s = new Set();
  S.exam.sections.forEach(sec => (sec.bells||[]).forEach(r=>{ if (r.date) s.add(r.date); }));
  return Array.from(s).sort();
}
function examRange(){
  const d = examDates();
  /* 一天都没有就给空 —— 别退回「今天」。这个兜底值会被写进 Exam 列表的起止日期，
     退回今天就是在替人决定考试日期；给空的话写出去的报文一眼能看出不对。
     （日期是行上的默认值，正常走不到这儿。） */
  return d.length ? {start:d[0], end:d[d.length-1]} : {start:"", end:""};
}
/* alsoLegacy：老版本只有一条不分日期的「考试日期（面板）」，全场共用。第一条
   日期就地把它**改名**用掉，不另开一条 —— 否则它会永远杵在厂商后台的周期列表里，
   再没有人引用它。 */
function findDateStrategy(date, alsoLegacy){
  return S.data.strategies.find(s=>s.name===stratNameOf(date))
      || (alsoLegacy ? S.data.strategies.find(s=>s.name===EXAM_STRAT_NAME) : null)
      || null;
}
function examStrategyId(date){
  const s = findDateStrategy(date, false);
  return s ? Number(s.id) : null;
}
/* 给全场每一个日期备好周期。返回 date → id（新建的那几条此刻还没有 id，是 null；
   它们在 onOk 里回填铃声报文，见下面）。 */
function applyExamStrategies(){
  const ids = new Map();
  examDates().forEach((date, i)=>{
    const body = { name:stratNameOf(date), time_type:3,
      repeat_weeks:[], repeat_days:[], between_dates:{}, assign_dates:[date] };
    const s = findDateStrategy(date, i===0);
    if (s){
      s.name = body.name; s.assign_dates = [date]; s.time_type = 3;
      ids.set(date, Number(s.id));
      queueOp({kind:"strategy-update", method:"PUT", url:"/timing-strategy/"+s.id, body:body,
        bellId:"strat:"+s.id, entity:"strategy", label:"[考试] 考试日期",
        sub:"指定日期 "+date});
      return;
    }
    ids.set(date, null);
    queueOp({kind:"strategy-create", method:"POST", url:"/timing-strategy", body:body,
      bellId:"strat:new:"+date, entity:"strategy", label:"[考试] 考试日期",
      sub:"新建 · 指定日期 "+date,
      onOk: r=>{
        const id = r && (r.id || (r.result && r.result.id));
        if (!id) return;
        S.data.strategies.push({id:Number(id), name:body.name, time_type:3,
                                assign_dates:[date], repeat_weeks:[]});
        ids.set(date, Number(id));
        /* 挂在这一天的考试铃声，把周期 id 补进报文里。
           考试铃声自己带 bodyFn（发送时按日期现查），所以**这里不再是必需的** ——
           但草稿模式下它先一步把值写好，即时模式下它一条也改不到（队列早被
           settle() 清过），两条路都不出问题，留着当第二道网。 */
        S.pending.forEach(o=>{
          if (o.body && o.examDate===date && String(o.bellId||"").indexOf("exam:")===0)
            o.body.timing_bells_strategy_id = Number(id);
        });
      }});
  });
  return ids;
}
/* ══ 列表：新建 / 清空 / 删除 ═══════════════════════════════════════
   需要一个列表 id，但它可能还不存在。不存在就排一条「新建列表」，先发一个
   **临时负数 id** 给本地用。

   真 id 怎么补进后面那些报文里，有两套，别搞混：
   - **考试模式那几条带 `bodyFn`**，发送时按名字现查（见 runOp）。这是主线。
   - onOk 里那个遍历 `S.pending` 的回填**只在草稿模式下成立** —— 即时模式下
     settle() 会在建列表这条还没排到时就清队列，它一条也找不着。留着是给
     「手工新建列表 → 立刻往里加铃声」那条没有 bodyFn 的路兜底。

   为什么不用 await 直接 POST：草稿模式的全部意义就是「先不往服务器写」。
   老版本为了拿 id 直接 await 建列表，草稿模式下也照建不误，那就不叫草稿了。
   ══════════════════════════════════════════════════════════════════ */
let tmpListSeq = -1;
function ensureList(name, proto, extra){
  const found = S.data.groups.find(g=>g.name===name);
  if (found) return Number(found.id);
  const tmp = tmpListSeq--;
  const body = Object.assign({ name:name, is_year_repeat:Number(proto.is_year_repeat)||0, is_done:1,
                 start_date:proto.start_date, end_date:proto.end_date }, extra||{});
  S.data.groups.push({ id:tmp, name:name, start_date:body.start_date, end_date:body.end_date,
                       is_done:1, is_year_repeat:body.is_year_repeat, is_tmp:true });
  queueOp({
    kind:"list-create", method:"POST", url:"/timing-bells-groups", body:body,
    bellId:"list:"+tmp, entity:"list", label:examOpLabel(name), sub:"服务器上还没有这个列表，先建",
    onOk: r=>{
      const id = r && (r.id || (r.result && r.result.id));
      if (!id) return;
      const real = Number(id);
      /* 把队列里还挂着临时 id 的报文改成真 id。
         考试模式那几条**不靠这里**了（它们自带 bodyFn，发送时按名字现查）——
         这套遍历只在草稿模式下成立，即时模式下 settle() 早把它们从队列里清走了。
         留着是因为还有一条只有它兜得住的路：草稿模式下用「新建任务」对话框建一个
         列表（那一刻 id 还是负的），接着就在里面手工加铃声 —— 那条报文没有 bodyFn。 */
      S.pending.forEach(o=>{
        if (o.body && Number(o.body.timing_bells_groups_id)===tmp) o.body.timing_bells_groups_id = real;
      });
      const g = S.data.groups.find(x=>x.id===tmp);   /* 就地改 id：别人的引用不会断 */
      if (g){ g.id = real; delete g.is_tmp; }
      if (Number(S.groupId)===tmp){ S.groupId = real; LS.set("lastGroup", real); }
      if (Number(S.exam && S.exam.listId)===tmp) S.exam.listId = real;
    }
  });
  return tmp;
}

/* 按名字找一个**服务器上真实存在**的列表 id。
   负数 id 是还没建出来的临时列表，不算 —— 拿它拼报文服务端必拒。
   （0 是「全部」那个假列表，也不能算。） */
function listIdByName(name){
  const g = S.data.groups.find(x=>x.name===name);
  const id = g ? Number(g.id) : NaN;
  return id > 0 ? id : null;
}

/* 清空一个列表里的全部铃声（服务器上一次性批量删） */
async function queueClearList(gid, listName){
  if (!(Number(gid)>0)) return 0;                 /* 临时 id：列表还没建，本来就是空的 */
  let rows = [];
  try{ rows = await fetchBells(gid); }catch(e){ return 0; }
  if (!rows.length) return 0;
  const ids = rows.map(r=>Number(r.id));
  queueOp({
    kind:"bell-wipe", method:"DELETE", url:"/timing-bells",
    body:{ ids:ids, timing_bells_groups_id:Number(gid) },
    bellId:"wipe:"+gid, entity:"bell",
    label:examOpLabel(listName)+" 清空", sub:"批量删除 "+ids.length+" 条铃声"
  });
  return ids.length;
}

/* 整个删掉一个临时列表：先删里面剩下的铃声，再删列表本身 */
async function queueDropList(gid, listName){
  if (!(Number(gid)>0)) return;
  /* 先从本地名单里摘掉，再去拉里面的铃声（下面那句是 await，中间会让人看见）。
     不摘的话：调用方紧接着调 ensureList("全校周六¤temp") 找同名列表，
     会命中这个**正在被删的**旧 id 并直接返回它 —— 于是不再建新列表，
     铃声全塞进一个几秒后就没了的列表里。 */
  S.data.groups = S.data.groups.filter(x=>Number(x.id)!==Number(gid));
  const n = await queueClearList(gid, listName);
  queueOp({
    kind:"list-delete", method:"DELETE", url:"/timing-bells-groups/"+Number(gid),
    bellId:"list:"+gid, entity:"list", label:examOpLabel(listName),
    sub:"删除"+(n?("（含 "+n+" 条铃声）"):""),
    onOk: ()=>{ S.data.groups = S.data.groups.filter(x=>Number(x.id)!==Number(gid)); }
  });
}

/* 面板自己建的那些考试周期（「考2026-10-15」），一场一场地删干净。
   考试铃声一清空，它们就没人引用了；留在厂商后台的周期列表里只会越堆越多
   （每考一场多几条，名字里带日期，谁也认不出哪条还有用）。老版那两个名字
   （不分日期的那条、带「考试日期 」前缀的那批）同样收走。

   只有**面板建的**才删（isExamStratName），手建的周期不会长成那样。 */
function isPanelExamStrat(s){
  return isExamStratName(s && s.name);
}
function queueDropExamStrategies(){
  const victims = S.data.strategies.filter(s=> Number(s.id)>0 && isPanelExamStrat(s));
  if (!victims.length) return 0;
  /* 批量删，借用厂商自己那一版：DELETE /timing-strategy 身上带 ids
     （和铃声明细的批量删同一个形状，见 vendor 前端的周期页）。 */
  queueOp({
    kind:"strategy-wipe", method:"DELETE", url:"/timing-strategy",
    body:{ ids: victims.map(s=>Number(s.id)) },
    bellId:"strat-wipe", entity:"strategy",
    label:"[考试] 考试日期", sub:"删除 "+victims.length+" 条周期"
  });
  /* 本机名单里当场摘掉：紧接着再启用考试模式时，findDateStrategy 找不到就得**新建**
     一条，不能命中一条正等着被删的。 */
  S.data.strategies = S.data.strategies.filter(s=> victims.indexOf(s)<0);
  return victims.length;
}

/* ── 扫描所有正常列表，算出启用后 ¤temp 副本里会被去掉什么（只读预览）── */
async function scanNormalLists(){
  const sets = examSets();
  const lists = S.data.groups.filter(g=>
    !isExamList(g) && !isExamCopy(g) && Number(g.id)>0);
  const out = [];
  /* 停用的列表本来就不打铃，不复制也不裁剪 */
  out.skipped = lists.filter(g=>!isListEnabled(g)).map(g=>g.name);
  /* 区域和考场重合、可时刻不在考试时段里的那些 —— 不算改动，单独报个数。
     和上面 skipped 一样挂在数组上，不占列表本身。 */
  out.timeSkipped = 0;
  for (const g of lists){
    if (!isListEnabled(g)) continue;
    let rows = [];
    try{ rows = await fetchBells(g.id); }catch(e){ continue; }
    /* 预览表里印的是铃声名字，所以走 grpAdoptRows 把分组名单摘掉、把 ¤分组名
       尾巴切掉（见 35-groups.js）—— 不然表里会多出一条「¤grp¤…」的「铃声」，
       别的名字后面也拖着「¤早间」。 */
    grpAdoptRows(rows).bells.forEach(b=>{
      /* 先不看时刻：这条跟考场或静音区域沾不沾边 */
      if (!trimForExam(bellArea(b), sets).changed) return;
      const tr = examTrimOf(b, sets);
      /* 沾的是考场，可它那几刻不在考试时段里（7:40 开考 vs 6:50 的早自习）——
         裁了不解决任何问题，它在考场里照常该响 */
      if (!tr.changed){ out.timeSkipped++; return; }
      out.push({listId:g.id, listName:g.name, bell:b, trim:tr});
    });
  }
  return out;
}

/* 面板早期版本把考试列表叫「考试模式」、后来叫「考试铃声」。见到就改名收编 ——
   不然它会一直挂在考试日期上按老配置打铃，跟新写的 Exam 打架。 */
function adoptOldExamList(){
  const old = S.data.groups.find(g=> g.name!==EXAM_LIST_NAME && EXAM_LEGACY_NAMES.indexOf(g.name)>=0);
  const now = S.data.groups.find(g=>g.name===EXAM_LIST_NAME);
  if (!old || now) return;
  const wasName = old.name;
  old.name = EXAM_LIST_NAME;
  queueOp({
    kind:"list-update", method:"PUT", url:"/timing-bells-groups/"+old.id,
    body:{ is_done:1, name:EXAM_LIST_NAME, start_date:old.start_date, end_date:old.end_date,
           is_year_repeat:Number(old.is_year_repeat)||0 },
    bellId:"list:"+old.id, entity:"list", label:examOpLabel(EXAM_LIST_NAME),
    sub:"考试铃声列表改名收编"
  });
}

/* 确保存在 Exam 列表，返回 id（可能是本批新建的临时负 id） */
function ensureExamList(){
  adoptOldExamList();
  const found = S.data.groups.find(g=>g.name===EXAM_LIST_NAME);
  if (found){ S.exam.listId = Number(found.id); return Number(found.id); }
  const r = examRange();
  S.exam.listId = ensureList(EXAM_LIST_NAME,
    { start_date:r.start, end_date:r.end, is_year_repeat:0 });
  return S.exam.listId;
}
const examListId = ()=>{
  const g = S.data.groups.find(x=>x.name===EXAM_LIST_NAME);
  return g ? Number(g.id) : (S.exam.listId ? Number(S.exam.listId) : 0);
};

/* 考试窗口 = Exam 列表的起止日期，取所选日期的**最外边界**（只是兜底，
   真正卡住哪几天的是那条指定日期策略）。注意 is_done 必须给 1，否则整张
   列表不打铃，考试铃声写了也白写。 */
function queueExamWindow(gid){
  const id = Number(gid);
  if (!id) return;
  const r = examRange();
  const g = S.data.groups.find(x=>Number(x.id)===id);
  if (g){ g.start_date = r.start; g.end_date = r.end; g.is_done = 1; }
  if (id < 0) return;          /* 列表是本批新建的，日期已经写进「建列表」那条报文了 */
  queueOp({
    kind:"list-update", method:"PUT", url:"/timing-bells-groups/"+id,
    body:{ is_done:1, name:EXAM_LIST_NAME, start_date:r.start, end_date:r.end, is_year_repeat:0 },
    bellId:"list:"+id, entity:"list", label:examOpLabel(EXAM_LIST_NAME),
    sub:"考试窗口 "+r.start+" → "+r.end
  });
}

/* ── 正常列表 → 「¤temp」副本 ──────────────────────────────────────
   每个已启用的正常列表复制一份，闪避与裁剪只发生在副本里；原件只是停用。
   原件保持完好，是「关闭考试模式」能干脆收场的前提。 */
async function queueExamCopies(examId){
  const sets = examSets();
  const lists = S.data.groups.filter(g=>
    Number(g.id)!==Number(examId) && !isExamList(g) && !isExamCopy(g) &&
    Number(g.id)>0 && isListEnabled(g));
  const out = [];
  for (const g of lists){
    let rows = [];
    try{ rows = await fetchBells(g.id); }catch(e){ continue; }

    const copyName = g.name + EXAM_SUFFIX;
    const old = S.data.groups.find(x=>x.name===copyName);   /* 上一场留下的同名副本 */
    if (old) await queueDropList(old.id, copyName);

    const cid = ensureList(copyName, {
      start_date:g.start_date, end_date:g.end_date, is_year_repeat:g.is_year_repeat });

    let trimmed = 0;
    /* 这儿**故意**用原始的 map(normBell)，不走 grpAdoptRows（对比上面预览那一处）：
       副本要的是原件的原样 —— 铃名尾巴上的 ¤分组名 和那条「分组名单」铃铛都跟着
       一起复制过去，副本里那几条铃声的分组才认得出人。副本列表平时藏起来不给人看
       （readExamState / railGroups），要显示它的地方（终端任务反查）自己会切尾巴。 */
    rows.map(normBell).forEach(b=>{
      /* 和预览（scanNormalLists）用同一条判据：只有考试那天真会响的铃声才裁 */
      const tr = examTrimOf(b, sets);
      if (tr.changed) trimmed++;
      /* 名字换成了裁剪后的，id 表作废 —— 让 buildPayload 按名字重新查 */
      const nb = Object.assign({}, b, { id:null, tmpId:null,
        termNames:tr.t, groupNames:tr.g, termIds:{}, groupIds:{} });
      /* cid 可能是个负数的临时 id（列表刚排上队、还没建出来）。
         报文照常先按它拼一份，但真正发出去的时候再按名字查一遍真 id ——
         建列表那条就在这些铃声前面，轮到铃声时它早就回来了（见 runOp 的 o.bodyFn）。 */
      const body = bellBodyIn(nb, cid);
      queueOp({
        kind:"create", method:"POST", url:"/timing-bells",
        body: body, entity:"bell",
        bodyFn: ()=>{
          const id = listIdByName(copyName);
          return id==null ? body : Object.assign({}, body, { timing_bells_groups_id:id });
        },
        bellId:"copy:"+cid+":"+b.id,
        label:examOpLabel(copyName)+" "+b.name,
        sub: tr.changed
          ? "考试闪避 · 去掉 "+(tr.removedT.concat(tr.removedG).join("、")||"—")
          : "考试闪避 · 区域不变"
      });
    });

    queueListToggle(g, false);          /* 原件停用 —— 考试期间由副本发声 */
    out.push({listId:Number(g.id), copyId:cid, name:g.name, n:rows.length, trimmed:trimmed});
  }
  return out;
}

/* ── 启用：清空重写 ¤exam_task + 建 ¤temp 副本 ───────────────────── */
async function enableExam(){
  const secs = S.exam.sections.filter(s=>(s.t.length||s.g.length) && s.bells.length);
  if (!secs.length){ toast("请先为至少一个分区设置执行区域和考试安排","err"); return; }
  /* 启用中这个按钮是 disabled 的（见 renderExam）—— 走到这儿就说明考试模式没开，
     是从「启用考试模式」进来的。下面那些按 pending 报文做的守卫仍然要留着：
     清空 / 建列表 / 删列表那几条可能是别的操作留下的，两批混在一起会互相拆台。 */
  const stale = S.pending.filter(o=> o.status==="pending" &&
    (o.kind==="bell-wipe" || o.kind==="list-create" || o.kind==="list-delete" ||
     /^(exam|copy|wipe):/.test(String(o.bellId||""))));
  if (stale.length){
    toast("上一次排布还有 "+stale.length+" 条报文待提交，请先提交或清空队列，避免两批混淆。","err");
    return;
  }

  /* 听力铃声的 life_time = 那条音频的时长，而时长是**从服务器的媒体库里查出来的**
     （lifeTimeOf / mediaSeconds）。查不到就会算成 0，写出一条不发声的听力铃 ——
     报文合法、提交成功、后台看着一切正常，只有考场上才发现没声音。所以在这儿拦住。
     铃声音源不拦：它本来就只有几秒，缺了顶多不响，不值得把人堵在门口。 */
  const noLen = uniq(secs.reduce((a,sec)=>
    a.concat(sec.bells.filter(r=> r.listen && mediaSeconds(r.listen)==null).map(r=>r.listen)), []));
  if (noLen.length){
    toast("这些听力音频在服务器媒体库里找不到、量不出时长：" + noLen.join("、") +
          "。请先在原后台上传好，再清空考试重排。","err");
    return;
  }
  /* 每一行的四格：考试铃声 / 科目 / 开考 / 结束时间（且不能早于开考）。缺一格就把那一格
     标红并拦下来 —— 写出去的是没音源、没名字或者没有结束铃的铃声，等考完才发现。
     标红是「点过这一次」才挂的（e.checked），改对了随重画自己消失。 */
  const short = secs.reduce((n,sec)=> n + sec.bells.filter(r=> Object.keys(examRowBad(r)).length).length, 0);
  S.exam.checked = short > 0;
  saveExamLocal();
  if (short){
    renderAll();
    toast(short+" 个科目设置有误，请检查标红参数","err");
    return;
  }

  const btn = $("#exOn"); if (btn){ btn.disabled=true; btn.textContent="准备中…"; }
  try{
    const gid = ensureExamList();     /* 没有就这一批新建；拿到的是可能为负的临时 id */
    queueExamWindow(gid);             /* 列表起止日期 = 考试窗口，并启用该列表 */
    /* 一天一条「指定日期」周期，必须排在考试铃声前面 —— 铃声要带它们的 id。
       新建的那几条此刻 id 还是 null，onOk 里按报文身上的 examDate 回填。 */
    const stratIds = applyExamStrategies();

    /* 1) 清空 Exam：推倒重来，不跟上一场做增量 */
    const wiped = await queueClearList(gid, EXAM_LIST_NAME);

    /* 2) 重新写入本场考试的全部铃声 */
    const taken = new Set();          /* 同列表内铃名唯一 */
    let nExam = 0;
    secs.forEach(sec=>{
      sec.bells.forEach(row=>{
        EXAM_ROLES.forEach(({role})=>{
          const time = examRowTime(row, role);
          if (!time) return;          /* 结束时间留空 = 不写这条结束铃 */
          if (role==="listen" && !row.listen) return;
          const name = examBellName(sec, row, role, taken);
          const body = examBellBody(sec, row, role, name, gid, stratIds.get(row.date));
          queueOp({
            kind:"create", method:"POST", url:"/timing-bells",
            body: body, entity:"bell",
            /* gid 和 stratIds 都可能是「这一批刚建、id 还没回来」的值（列表 -1、
               周期 null）。发之前按名字/日期再查一遍真 id —— 建列表、改周期那几条
               都排在这些铃声前面，轮到它们时早回来了（见 runOp 的 o.bodyFn）。 */
            bodyFn: ()=>{
              const lid = listIdByName(EXAM_LIST_NAME);
              const sid = examStrategyId(row.date);
              const fix = {};
              if (lid!=null) fix.timing_bells_groups_id = lid;
              if (sid!=null) fix.timing_bells_strategy_id = Number(sid);
              return Object.assign({}, body, fix);
            },
            /* examDate 不发给服务器（queueOp 只取 body），是给上面 onOk 认领用的 */
            examDate: row.date,
            bellId:"exam:"+sec.id+":"+role+":"+name,
            label:"[考试] "+name, sub:"写入 · "+sec.name+" "+hm(time)
          });
          nExam++;
        });
      });
    });

    /* 2.5) 静音区域。它没有自己的字段，就借一条**不发声的计划**存着：
       执行区域 = 静音区域，名字固定一个，上面那次清空会把上一场那条一起带走。

       「没有铃声的计划」在厂商那儿存不下来 —— 那边两道硬要求（vendor 前端
       「新建打铃任务」的 save 里写着）：type=1 的音乐播放**必须**挂至少一个音源
       （「请把音源当前选中项填完」），而且每一条都**必须**挂一个时间属性。
       所以这条得装成一条**正常的铃声**才存得住：音源借本场考试铃那个文件
       （一定取得到，上面 examRowBad 已经把「哪一行没选铃声」拦下来了），
       时间属性借本场第一条考试日期那条（关闭考试模式时它跟着一起收走）。

       让它永远不响的是**另外两样**，不是「没周期」：is_done=0（停用，
       也就是面板列表里那个开关的关），加上音量 0。就算哪天有人在厂商后台
       把它打开，它也只是在考试第一天 00:00:00 静悄悄地跑一趟，什么都不放。 */
    const muteArea = splitNames(S.exam.mute||[]);
    if (muteArea.t.length || muteArea.g.length){
      const muteMedia = secs[0].bells[0].media;
      const muteDate  = examDates()[0];
      const silenceBody = {
        name: EXAM_SILENCE_NAME,
        timing_bells_groups_id: gid,
        timing_bells_strategy_id: examStrategyId(muteDate),
        terminals_light_id: 1,
        volume: 0, type: 1, priority: 50,
        sound_source: { life_time: lifeTimeOf([muteMedia]), play_model: 0 },
        is_done: 0,
        timing_bells_mode: "1",
        execute_time: "00:00:00",
        ...areaJunc(muteArea.t, muteArea.g),
        ...mediaJunc([muteMedia], []),
        led_text: "", led_display_cfg_id: 1
      };
      queueOp({
        kind:"create", method:"POST", url:"/timing-bells",
        body: silenceBody, entity:"bell",
        bodyFn: ()=>{
          const lid = listIdByName(EXAM_LIST_NAME);
          const sid = examStrategyId(muteDate);
          const fix = {};
          if (lid!=null) fix.timing_bells_groups_id = lid;
          if (sid!=null) fix.timing_bells_strategy_id = Number(sid);
          return Object.assign({}, silenceBody, fix);
        },
        bellId:"exam:silence",
        label:"[考试] "+EXAM_SILENCE_NAME, sub:"静音区域"
      });
    }

    /* 3) 正常列表：原件停用，另存 ¤temp 副本，在副本里做闪避与裁剪 */
    const copies = await queueExamCopies(gid);

    S.exam.on = true;
    saveExamLocal();
    renderAll();
    /* toast 是**通知**，只讲用户在自己的面板上看得见的事：几天、几个分区、几条
       铃声、哪几个列表被暂停了。服务器上新建/改写的那几个列表叫什么名字、
       考试模式在服务器上动了什么，一律不进来。 */
    toast("考试模式已排布完成：" + examDates().length + " 天、" + secs.length + " 个分区、共 " + nExam + " 条考试铃声"+
      (wiped ? "，已清除旧铃声 " + wiped + " 条" : "") +
      (copies.length ? "；" + copies.length + " 个铃声列表已暂停，考试期间由考试铃声接管" : "") +
      tailFor() + "。","ok");
  }catch(e){
    toast(e.message,"err");
  }finally{
    const b2 = $("#exOn");
    /* b2 是**现在**查的，renderAll() 已经把按钮换成新造的那个了。这里只把忙碌态
       收回来 —— 按成功之后 renderExam 会把它重新画成「关闭考试模式」那一支，
       按失败就还是「提交并启用考试」（下面那枚按钮的字，两处要一起改）。 */
    if (b2){ b2.disabled = false; b2.textContent = "提交并启用考试"; }
  }
}

/* ── 清空考试：只清面板上这一份设置，一个报文都不发 ──────────────────
   和「关闭考试模式」（clearExam）是两件事，别混：
   - 这里动的是 S.exam，也就是手上这一份安排（分区 / 科目 / 日期 / 静音区域），
     连着本机存的那份一起清掉（LS.del），回到刚打开面板的样子。
   - 服务器上的东西（¤exam_task 列表、考试铃声、¤temp 临时列表、常规列表的启用状态）
     **一律不碰** —— 那些归「启用 / 关闭考试模式」。 */
function clearExamConfig(){
  S.exam = defaultExam();
  LS.del(EXAM_LS_KEY);
  renderAll();
  toast("已清空这份考试安排。服务器没有任何改动 —— 考试模式的开关走「启用 / 关闭考试模式」。","ok");
}

/* ── 关闭考试模式：删副本、开原件、清空考试铃声 ──────────────────── */
async function clearExam(){
  const copies = S.data.groups.filter(g=> isExamCopy(g) && Number(g.id)>0);
  const restore = new Set();               /* 该恢复启用的原件 */
  for (const g of copies){
    await queueDropList(g.id, g.name);
    /* 副本名去掉后缀就是原件名 */
    const orig = S.data.groups.find(x=> x.name===g.name.slice(0, -EXAM_SUFFIX.length) && Number(x.id)>0);
    if (orig) restore.add(orig);
  }
  let nRestore = 0;
  restore.forEach(orig=>{ if (!isListEnabled(orig)){ queueListToggle(orig, true); nRestore++; } });

  const id = examListId();
  const wiped = id ? await queueClearList(id, EXAM_LIST_NAME) : 0;
  const eg = S.data.groups.find(x=>Number(x.id)===Number(id));
  /* 列表也关掉，侧栏别一直挂着「已启用」。抽屉里那行字得是「[考试] 考试铃声」——
     这个列表的名字是服务器上的事，用户在侧栏里从没见过它。 */
  if (eg && isListEnabled(eg)) queueListToggle(eg, false, examOpLabel(EXAM_LIST_NAME));

  /* 考试铃声清完，那些「考试日期」周期就没人引用了 —— 顺手删掉。不清的话它们
     会在厂商后台的周期列表里一场一场地堆下去（用户点出来的）。 */
  const nStrat = queueDropExamStrategies();

  /* 结束考试只关服务器上的那一套 —— 面板上这份配置**留着**（用户定的），
     本机那份也原样留着，下次打开还能接着用。 */
  S.exam.on = false;
  saveExamLocal();
  renderAll();
  /* 同样只讲面板上看得见的结果。原来这句把「删了 3 个「_E」临时列表」「清空
     「Exam」里 9 条」都念出来了 —— 用户既没见过那两个名字，也做不了什么。 */
  toast("已关闭考试模式：" + (nRestore ? nRestore + " 个铃声列表已恢复启用，" : "") +
    (wiped ? "清掉 " + wiped + " 条考试铃声" : "没有残留的考试铃声") +
    (nStrat ? "，并清走了 " + nStrat + " 条考试日期周期" : "") +
    tailFor() + "。","ok");
}

/* ══ 考试日期：每个科目一格，点开一个日历浮层 ═══════════════════════
   日历本体是 20-ui 的 calMount（定时任务的「指定日期」用同一个）。这一格
   「长得像输入框但打不了字」—— 日期是点出来的，让人手敲一个 2026-10-14
   只会敲错。一个科目只选一天，所以点一天就等于选完，随即收掉。

   浮层学时分秒转轮那一套：挂在 #layers 下、position:fixed（不然会被
   .tbl-wrap 的 overflow 裁掉），按那一格定位，点外面 / Esc / 滚页面就收；
   ≤980px 由 css 盖成一块居中模态。同时只开一个。 */
let DP = null;
function closeDatePicker(){
  if (!DP) return;
  const d = DP; DP = null;
  d.host.remove();
  if (d.scrim) d.scrim.remove();
  document.removeEventListener("keydown", d.onKey, true);
  window.removeEventListener("pointerdown", d.onOut, true);
  window.removeEventListener("scroll", d.onScroll, true);
}
function openDatePicker(anchor, cur, onPick){
  if (DP && DP.anchor===anchor){ closeDatePicker(); return; }   /* 再点一下 = 收起 */
  closeDatePicker();
  const host = document.createElement("div");
  host.className = "dp";
  host.innerHTML = '<div class="dp-cal"></div>';
  const scrim = document.createElement("div");
  scrim.className = "dp-scrim";
  const layers = $("#layers") || document.body;
  layers.appendChild(scrim);
  layers.appendChild(host);

  const r = anchor.getBoundingClientRect();
  const w = host.offsetWidth, h = host.offsetHeight;
  const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - 8 - w));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 6 - h);
  host.style.left = left+"px";
  host.style.top  = top+"px";

  const st = { month: String(cur||todayISO()).slice(0,7), dates: cur ? [cur] : [] };
  const pick = day => { onPick(day); closeDatePicker(); };

  const onKey    = e=>{ if (e.key==="Escape"){ e.stopPropagation(); closeDatePicker(); } };
  const onOut    = e=>{ if (DP && !DP.host.contains(e.target) && !DP.anchor.contains(e.target)) closeDatePicker(); };
  const onScroll = e=>{ if (DP && !DP.host.contains(e.target)) closeDatePicker(); };
  DP = { host, scrim, anchor, onKey, onOut, onScroll };
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onOut, true);
  window.addEventListener("scroll", onScroll, true);

  /* 点一天 = 选完就收，所以 toggle 就是 pick；「今日」也走同一条（控件的
     on.today 只管把 month 挪到本月，接着调这里）。pick 里把浮层拆了，控件
     那边 `box.isConnected` 为假，不会再白画一遍。 */
  calMount($(".dp-cal", host), st, { toggle: pick, today: ()=> pick(todayISO()) });
}

/* 分区改名。名字以前是个常驻输入框摆在标题旁边（打着字就往本地存），
   现在标题就是名字，要改点铅笔 —— 和铃声计划标题旁那两个按钮一个路子。 */
function openSecName(sec){
  openModal({ title:"编辑分区名称", width:"440px",
    mount(b,f,mm){
      b.innerHTML = '<div class="field"><label>分区名称</label>'+
        '<input class="input" id="secNm" maxlength="40" value="'+esc(sec.name)+'"></div>';
      const inp = $("#secNm");
      setTimeout(()=>{ inp.focus(); inp.select(); }, 0);
      const ok = ()=>{
        const v = inp.value.trim();
        if (!v){ toast("分区名称不能为空","err"); return; }
        sec.name = v; saveExamLocal(); closeModal(mm.id); renderAll();
      };
      inp.onkeydown = e => { if (e.key==="Enter") ok(); };
      f.innerHTML = '<span class="spacer"></span><button class="btn" id="secNmC">取消</button>'+
        '<button class="btn btn-primary" id="secNmOk">确定</button>';
      $("#secNmC").onclick = ()=> closeModal(mm.id);
      $("#secNmOk").onclick = ok;
    }});
}

/* ══ 考试模式视图 ═══════════════════════════════════════════════════ */
/* 「考试模式已经启用了」= 这份配置已经变成服务器上真实的铃声在响了。这时候
   再改本地这份，页面显示的就和正在响的那份对不上 —— 和「原件被考试模式锁住」
   是同一条道理，只是方向相反（那边锁原件，这边锁考试配置本身）。

   范围圈在 .page-body 里，正好放过两类东西：
   - 那一排按钮（「清空考试」和「启用 / 关闭考试模式」）在 .sec-head 里，
     压根不在这段选择器范围内。
     锁了它们这一页就再也出不去了 —— 和 lockDetail 只圈 .wb-main、专门把顶栏
     那个返回键留在射程外，是同一课。
   - 日历的翻月 / 本月 / 今日（[data-cal]）是**走路**不是改东西，只是换个
     看的角度。选中的日期本身（日格和下面的日期胶囊）照样锁。

   `disabled` 只管「点不动」，看着和能填的没两样（尤其是白底的输入框和下拉，
   禁用的样式在 Chromium 上只有光标变一下）。所以再给 .page-body 挂一个
   `.is-locked`，由 css 整块压暗 —— 那一整页的观感必须是「这是死的」。

   注意 `.is-locked` 的压暗是 opacity + grayscale，会乘到整个子树上：**里面的
   任何东西都救不回来**，子节点写 opacity:1 也只是在父节点那层之上再乘 1。
   所以上面那条锁定的横幅是挂在 .page-body 外面的。 */
function lockExam(el){
  el.querySelectorAll(".page-body button, .page-body input, .page-body select").forEach(x=>{
    if (x.dataset && x.dataset.cal) return;
    x.disabled = true;
  });
  const pb = el.querySelector(".page-body");
  if (pb) pb.classList.add("is-locked");
}

/* ══ 「所有科目都已结束」═════════════════════════════════════════════
   考试模式开着的时候，页首那条「已锁定」说的是「现在改不了」。最后一场考试连结束铃
   都响过之后，它其实在说一件**该收摊了**的事 —— 于是上面再压一条「已结束」，
   告诉人现在可以关掉考试模式了（关掉 = 常规列表解锁、考试铃声和那些临时列表收走，
   见 clearExam）。横幅不是警告，是「可以动手了」，所以走绿色，别照着 .pill-lock 抄颜色。

   比的是「服务器现在几点」对「最后一场考试的结束时间」：
     · 前者是 srvStamp()（登录时跟服务器对的那口钟，见 00-core.js）—— 本机钟可能
       差着一两分钟（这台打铃服务器实测就慢着约一分钟），所以不能读 Date.now()；
     · 后者就是人在这页上填的那个结束时间，直接比，不做任何加减 —— 报告得比
       实际晚一点没关系，早一步就是把最后那记结束铃一起收走了。
   两边都拼成定宽的 "YYYY-MM-DD HH:MM:SS" 再比，字典序就是时间序。 */
function examLatestEnd(){
  const e = S.exam;
  if (!e || !Array.isArray(e.sections)) return "";
  let last = "";
  e.sections.forEach(s=> (s.bells||[]).forEach(r=>{
    const end = hhmmToHMS(r.end);              /* 没填 / 认不出的那行跳过，不给它编一个时刻 */
    if (!end) return;
    const at = String(r.date||"").slice(0,10) + " " + end;
    if (at > last) last = at;
  }));
  return last;
}
function examAllDone(){
  const e = S.exam;
  if (!e || !e.on) return false;               /* 考试模式没开着，就没有「收摊」这回事 */
  const last = examLatestEnd();
  if (!last) return false;                     /* 一条完整的考试安排都没有 —— 不猜 */
  return srvStamp() >= last;
}
/* 和「已锁定」同一个壳（.panel.banner），只是边框和胶囊走绿色。
   **自己不带上边距**：它和「已锁定」是一件事的两句（能关了 / 为什么之前改不了），
   两条之间的距离由外面那个 .banner-group 的 gap 管（7px）—— 早先试过在这一条身上
   写下边距，怎么写都没用：缝是 `.panel + .panel{margin-top:14px}` 加在**下面**那条
   「已锁定」的上边距上的，跟这条的下边距是两回事（用户实测看出来的）。
   带 id 是为了让下面 syncExamDone 能就地找到它 —— 这条横幅会**在不重画整页的
   情况下**自己冒出来或者自己撤掉。 */
function examDoneHTML(){
  return '<div class="panel banner" id="exDone" style="border-color:var(--good)"><div class="panel-body" style="display:flex;gap:10px;align-items:center">'+
    '<span class="pill-done">已结束</span>'+
    '<span style="font-size:13px"><b>所有科目都已结束</b>，可以结束考试了</span>'+
  '</div></div>';
}
/* 人可能就是停在这一页上等的：上一分钟还没结束，下一分钟结束了，横幅得自己出来。
   **只动这一个节点，绝不整页重画** —— 这一页上全是输入框和日期选择器，重画一次
   正在敲的那一格就换了人（光标和输入法都飞）。
   锚点是「已锁定」那条横幅：它在就说明这一页正开着考试模式，横幅就贴在它上面
   （它的父节点是那个 .banner-group，所以插进去就在组内、贴在同一条缝上）。 */
function syncExamDone(){
  const el = $("#main"); if (!el) return;
  const host = el.querySelector(".lock-banner");
  const node = el.querySelector("#exDone");
  if (host && examAllDone()){
    if (node) return;
    const box = document.createElement("div");
    box.innerHTML = examDoneHTML();
    host.parentNode.insertBefore(box.firstChild, host);
  } else if (node) node.remove();
}
/* 十秒看一眼。这一页上一次状态变化隔着一整天，问勤了没意义；问稀了，
   横幅出来得比那一刻晚太多。两道闸：**登录过**、**页面在前台**
   （挂在后台的标签页不跟着转）。 */
const EXAM_DONE_POLL = 10000;
setInterval(()=>{
  if (S.view !== "app" || S.mode !== "exam") return;
  if (document.visibilityState !== "visible") return;
  syncExamDone();
}, EXAM_DONE_POLL);

/* 考试安排摆成哪一份：**横屏且够宽**用九列表格直接编辑，其余用「一场一行」
   概览 + 编辑弹窗（用户定的）。
   - 竖屏不管多宽都用概览 —— 一排输入框在竖着拿的屏上摆不开；
   - 横屏的表格最窄压到 980px 那一档为止，再窄就回到概览。
   宽度判据跟 css 同一个门槛（isNarrow 是 ≤980px）；方向是另一件事，
   两者都要满足才画表。 */
const examDirect = ()=> !isNarrow() && window.matchMedia("(orientation:landscape)").matches;

/* 转屏 / 窗口跨过 980px 时当场换排版，不等下一次重画（用户要的动态切换）。
   两个判据都听着；只在**真的换了档**时重画。手上正敲着的格子先 blur，
   让它照 change 那条路把值落下来，别被这一趟重画吞掉。 */
let examDirectLast = examDirect();
function syncExamLayout(){
  const now = examDirect();
  const changed = now !== examDirectLast;
  examDirectLast = now;
  if (!changed) return;
  if (S.view !== "app" || S.mode !== "exam") return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)){ try{ ae.blur(); }catch(e){} }
  renderAll();
}
["(orientation:landscape)","(max-width:980px)"].forEach(q=>{
  const mq = window.matchMedia(q);
  if (mq.addEventListener) mq.addEventListener("change", syncExamLayout);
  else if (mq.addListener) mq.addListener(syncExamLayout);   /* 老 WKWebView */
});

function renderExam(){
  const el = $("#main"); if (!el) return;
  /* 概览那一档点开的那份「改动预览」是**整页顶掉这一页**的（见 openExamPreview）。
     转到直接编辑那一档（横屏且够宽）时，那一页已经没有存在的理由，当场退回
     考试模式这一页，和「终端任务反查」同一个处理（见 70-view-more）。 */
  if (S.dt.exPreview && examDirect()) S.dt.exPreview = false;
  if (S.dt.exPreview) return renderExamPreviewFull(el);
  el.classList.add("headfix");   /* 「考试模式」那一行钉住，下面整块（面板 + 分区）自己滚 */
  /* S.exam 是**开工前就得有**的东西：刷新页面停在考试模式这一页时，第一帧会赶在
     loadAll()（那儿才 S.exam = readExamState()）之前画，那一刻它可能是 null
     （本机没存过），下面读
     e.sections 当场抛错 —— 那一下抛在 boot 里，整条启动链子都断了（探针不发、
     数据不拉、推送不开，页面就卡在考试模式上）。所以在这儿补一手：先摆一张空表，
     loadAll() 回来再换成照服务器读回来的那份。 */
  const e = S.exam || (S.exam = defaultExam());
  /* e.on = 已经排布下去了（服务器上真的有考试铃声在响），整页只读（见上面 lockExam）。
     注意别在这儿起个叫 on 的局部量 —— 函数末尾那个 "#exOn" 的引用已经叫 on 了。 */
  const union = examAreaUnion();
  const hasArea = e.sections.some(s=> s.t.length || s.g.length);
  /* 日期不用再拦：它现在是每个科目自带的，加一行就有一天（见 blankExamRow），
     唯一的空档是「有分区有科目但一个区域都没设」 */
  const why = hasArea ? "" : "请先给至少一个分区设置执行区域";

  el.innerHTML =
    '<div class="sec-head">'+
      /* 标题旁边原来还有一枚「已启用」胶囊。删了：考试模式开着的时候，标题下面
         那条黄色横幅第一句就是「考试配置已锁定」，说的是同一件事，
         而横幅还多交代了「怎么办」。一个状态在一屏里说两遍，就把标题那一行白占了。 */
      '<div style="min-width:0"><div class="title-row"><h2 class="serif">考试模式</h2></div></div>'+
      /* 这两个按钮管的是**两件完全不同的事**，名字上就把它分开：
         - 「清空考试」只清手上这一份安排（S.exam：分区、科目、日期、静音区域），
           一个报文都不发。**它没存在任何地方**，清掉只是「回到刚打开面板的样子」。
         - 「提交并启用考试 / 关闭考试模式」才是对服务器动手的那一对——
           左边那枚的字面上就写着**这一下会提交**（它干的事是把手上这份配置排下去，
           不是先存起来再另点一下「启用」）；启用 = 把考试铃声和
           ¤temp 副本排下去、把常规列表停用；关闭 = 删掉考试铃声和 ¤temp 临时列表、
           把常规列表解锁。删列表这件事**只归它**，别塞给「清空考试」。
         所以考试模式开着时「清空考试」是灰的：那一刻页面上这份就是服务器上正在响的
         那份，清掉只会让两边对不上。

         **只有两个按钮**。以前这里是三个：`e.on` 是从本机那份配置里读的，配置和
         服务器对不上（换台电脑打开读到的是另一个文件）就会出现「考试模式没开、
         服务器上却还摆着那一场」——于是「启用」和「关闭」并排摆着，点哪个都是猜。
         现在 e.on 是照服务器上有没考试铃声算出来的（readExamState），那种局面
         不可能出现，那个兜底按钮也就跟着没了。

         「改动预览」那枚眼镜也归这一组了（用户要的：挪到「清空考试」左边）。它原来
         挨着标题站，混在「这一页自己的动作」里 —— 可它说的是**整份配置**排下去会
         带来什么改动，是页面级的一件事，跟「清空考试」同一档。
         **考试模式开着的时候它照样点得动**（用户要的）：lockExam 冻的是 `.page-body`
         里的控件，这一组在 .sec-head 里，本来就不挨冻；何况「会闪避哪些铃声」正是
         排布下去之后最该看一眼的那件事。
         它是**隐形键**（btn-quiet，用户要的）：旁边那两枚是这一页的正事，这枚眼镜
         是「看一眼」的旁支，不该跟它们长得一样重（`--fg-2` 的图标、悬停才浮出一层
         底）。悬停那层底是 --surface-2，而这一组踩在页面的 --bg 上，看得见。 */
      '<div class="acts">'+
        '<button class="btn btn-icon btn-quiet" id="exPreview" title="改动预览：看看哪些铃声会在考试期间自动闪避" aria-label="改动预览">'+ICON.eye+'</button>'+
        '<button class="btn btn-danger" id="exClear"'+
          (e.on?' disabled title="考试模式已启用 —— 要先「结束考试」，这一份设置才轮得到清"':"")+
          '>清空</button>'+
        (e.on
          ? '<button class="btn btn-danger" id="exOff">结束考试</button>'
          : '<button class="btn btn-primary" id="exOn"'+(why?' disabled title="'+esc(why)+'"':"")+'>开始考试</button>')+
      '</div>'+
    '</div>'+

    /* 这条横幅必须待在 .page-body **外面**。它在里面的时候是灰的，不是没配对规则，
       是配了也没用：父节点的 opacity / filter 会乘到整个子树上，子节点写
       opacity:1;filter:none 只能盖住它自己那一层，盖不住父节点压下来的。
       拎出来既是唯一能让它「不灰」的办法，也顺带把它的地位摆正了 ——
       它是这一页的告示，不是页面里的一块内容。 */
    /* 「已结束」压在「已锁定」**上面**：两条一起说的是「考试模式还开着（所以改不了），
       可最后一场也考完了（所以可以关了）」—— 先听见「能关了」，再读「为什么之前改不了」。
       上面那条只在考场全考完时才有，见 examAllDone。
       两条包在 .banner-group 里当一条页首元素（缝 7px、上下各 14px，见 css）——
       不包的话两条之间那道 14px 压不掉，因为它是 `.panel + .panel` 给的。 */
    (e.on? '<div class="banner-group">'+
      (examAllDone()? examDoneHTML() : "")+
      '<div class="panel banner lock-banner" style="border-color:var(--warn)"><div class="panel-body" style="display:flex;gap:10px;align-items:center">'+
      '<span class="pill-lock">已锁定</span>'+
      '<span style="font-size:13px"><b>考试配置已锁定</b>，结束考试后可修改</span>'+
    '</div></div></div>':"")+

    '<div class="page-body">'+

    '<div class="panel">'+
      '<div class="panel-head"><h3>考试区域</h3>'+
        /* 「全部分区的并集：N 点位 / M 分组」改成现在这句（用户定的）：说的还是
           同一件事（下面那排胶囊里到底有多少个名字），只是不再用「点位」这个词 ——
           面板上别处一律叫「终端」。 */
        '<span class="sub">'+union.t.length+' 个终端, '+union.g.length+' 个分组</span>'+
      '</div>'+
      '<div class="panel-body"><div class="area-chips">'+
        (union.t.length+union.g.length? areaChips(union) : '<span class="hint">暂无任何考试区域, 请在考试分区中设置</span>')+
      '</div></div>'+
    '</div>'+

    '<div class="panel">'+
      '<div class="panel-head"><h3>静音区域</h3>'+
        '<span class="sub">在考试过程中始终保持静音的区域</span>'+
        '<span class="acts"><button class="btn btn-sm" id="exMute">编辑区域</button></span>'+
      '</div>'+
      '<div class="panel-body"><div class="area-chips">'+
        /* 胶囊自带 ×，点整颗就摘掉那个名字（用户定的）—— 要拿掉一个点位，不该
           为了它把「编辑区域」整个再点开翻一遍。锁定时**不给 ×**：`e.on` 那一档
           整页只读，lockExam 只冻得住 `.page-body button`，而胶囊本身不是按钮，
           点得动；所以连 × 都不画，只读就是只读。 */
        ((e.mute||[]).length? areaChips(splitNames(e.mute), !e.on)
          : '<span class="hint">暂未选择任何静音区域</span>')+
      '</div></div>'+
    '</div>'+

    '<div class="sec-head" style="margin-top:20px">'+
      '<h2 class="serif" style="font-size:16px">考试分区</h2>'+
      '<div class="acts"><button class="btn" id="exAddSec">'+ICON.plus+' 添加分区</button></div>'+
    '</div>'+

    e.sections.map(s=> examSectionHTML(s)).join("")+

    '</div>';   /* /.page-body */

  /* 点左上角「考试模式」回到顶部：标题这一行钉着，正文在它下面自己滚。 */
  const exTitle = el.querySelector(".sec-head h2.serif");
  if (exTitle){
    exTitle.classList.add("back-top");
    exTitle.onclick = ()=> scrollPageTop(el);
  }

  el.querySelector("#exAddSec").onclick = ()=>{
    S.exam.sections.push(blankSection(S.exam.sections.length+1));
    saveExamLocal();
    renderAll();
  };
  const on = el.querySelector("#exOn");   if (on)  on.onclick = enableExam;
  /* 「结束考试」只关服务器上的那一套（副本、考试铃声、周期、原件的启用状态），
     面板上这份考试配置不再跟着清掉（用户定的）。确认键照旧是红的 ——
     它删服务器上的副本。 */
  const off= el.querySelector("#exOff");  if (off) off.onclick = ()=> openConfirm("结束考试",
    "确认要结束考试模式吗？",
    clearExam, "结束考试", true);
  /* 「清空」不写服务器，只清手上这一份 —— 可面板不存配置，这一份就是唯一
     一份，清掉就真没了，所以照样要问一句。确认键用危险色（用户定的）：
     动作不可撤销。
     正文只问一句「是否清空当前考试配置？」（用户定的）：原来那两句话想解释
     「这个不碰服务器、要撤销请用另一个按钮」，可它俩旁边就摆着「关闭考试模式」，
     用户真要撤销那一场，那个按钮自己会解释自己。标题已经写着「清空考试」，
     正文再念一遍「只清空面板上这一份考试设置」就是把标题又说了一次。 */
  const clr= el.querySelector("#exClear"); if (clr) clr.onclick = ()=> openConfirm("清空考试",
    "是否清空当前考试配置？",
    clearExamConfig, "清空", true);
  el.querySelector("#exMute").onclick = ()=>{
    S.dt.area = splitNames(S.exam.mute||[]);
    openAreaEditor("pick", null, area=>{ S.exam.mute = area.g.concat(area.t); saveExamLocal(); renderAll(); });
  };
  /* 静音区域那几颗胶囊上的一下：摘掉点中的那个名字。
     `mute` 是一串**平的名字**（点位和分组混在一起，见 splitNames），所以按名字直接
     过滤就够，不用管它是哪一路 —— 回复里那个 k 这儿用不上。
     挂在**面板**上而不是那个 .area-chips 上：mountAreaChips 只在盒子里找
     [data-rm]，多包一层无妨，面板这一块里也只有这一处有胶囊。 */
  const mutePanel = el.querySelector("#exMute").closest(".panel");
  if (mutePanel) mountAreaChips(mutePanel, (k, n)=>{
    S.exam.mute = (S.exam.mute||[]).filter(x=> x!==n);
    saveExamLocal();
    renderAll();
  });
  /* 听力延迟那个数字框：改了**不重画** —— 重画会把焦点从这个框上打掉，人正往里
     敲数字呢（和上面科目那一格同一个道理）。它不影响页面上任何显示，存下值就够了，
     真正读它的是「启用考试模式」那一刻的 examRowTime。
     锁定期间这个框是 disabled 的 —— 那会儿铃声已经按老数字排好了，改它也不会
     回头去动服务器上的东西，不如不给改（要改就关掉考试模式重来）。 */
  const ld = el.querySelector("#exListenDelay");
  if (ld){
    ld.oninput  = ()=> { S.exam.listenDelay = ld.value; saveExamLocal(); };
    /* 松手（离开这个框）才重画：分区不止一个的时候底下这句是**每个分区各一份**，
       它们共用同一个数 —— 敲的时候不重画，是怕把焦点打掉；松开之后重画一次，
       另外那几个框就跟上了。顺带把越界的值收回来（写了 90，框里自己变回 60）。 */
    ld.onchange = ()=> renderAll();
  }
  el.querySelector("#exPreview").onclick = openExamPreview;

  // 分区卡片的事件
  $$("[data-sec]", el).forEach(card=>{
    const sec = examSection(card.dataset.sec); if (!sec) return;
    const q = s => card.querySelector(s);
    q("[data-act=secName]").onclick = ()=> openSecName(sec);
    q("[data-act=area]").onclick = ()=>{
      S.dt.area = {t:sec.t.slice(), g:sec.g.slice()};
      openAreaEditor("pick", null, area=>{ sec.t = area.t; sec.g = area.g; saveExamLocal(); renderAll(); });
    };
    /* 最后一枚按钮是「重置」不是「删除」—— 面板得留着至少一个分区当容器。
       重置**保留这个分区的 id**：id 是 DOM 上 data-sec 的锚，换掉它以后下面几处
       examSection(card.dataset.sec) 会取不到这一块，整页就废了。
       还原的内容直接照抄 blankSection —— 分区就那么四个字段，与其在这儿把名字、
       区域、科目各写一遍（将来加了第五个字段就会漏），不如跟「新开一个分区」走
       同一个出处。 */
    const clearBtn = q("[data-act=clearsec]");
    if (clearBtn){
      clearBtn.onclick = ()=> openConfirm("重置分区「"+sec.name+"」",
        "默认分区无法删除，是否重置此分区？",
        ()=>{ const d = blankSection(1);
              sec.name = d.name; sec.t = d.t; sec.g = d.g; sec.bells = d.bells;
              saveExamLocal(); renderAll(); }, "重置", true);
    }
    const delBtn = q("[data-act=delsec]");
    /* 正文只问一句（用户定的）。原来那句是「只从面板里删掉这个分区的设置；已经提交到
       服务器的考试铃声要等停用时才会停」—— 标题里已经写着删的是哪个分区，
       「面板上删 ≠ 服务器上停」这层意思，页首的横幅和「启用 / 关闭考试模式」
       那一对按钮各自都在说，不必挤进这一问里。 */
    if (delBtn) delBtn.onclick = ()=> openConfirm("删除分区「"+sec.name+"」",
      "确认要删除此分区吗？",
      ()=>{ S.exam.sections = S.exam.sections.filter(x=>x.id!==sec.id); saveExamLocal(); renderAll(); }, "删除", true);
    /* 横屏直接加一行（用户定的）：默认值和竖屏那份完全一样（blankExamRow），
       加完就在表里改，省掉一层弹窗。竖屏仍然弹「添加考试」，一屏一个科目慢慢填。 */
    q("[data-act=addbell]").onclick = ()=>{
      if (!isPortraitNarrow()){
        sec.bells.push(blankExamRow(sec.bells.length+1, examNextStart(sec)));
        saveExamLocal();
        renderAll();
        return;
      }
      openExamEdit(sec, blankExamRow(sec.bells.length+1, examNextStart(sec)), true);
    };
    /* 区域胶囊上的一下：把点中的那个名字从**这一块**的区域里摘掉。
       点位和分组分在两个数组里（sec.t / sec.g），所以这儿得看 k。 */
    mountAreaChips(card, (k, n)=>{
      if (k==="g") sec.g = sec.g.filter(x=> x!==n);
      else         sec.t = sec.t.filter(x=> x!==n);
      saveExamLocal();
      renderAll();
    });
  });
  $$("[data-sec] [data-row]", el).forEach(tr=>{
    const sec = examSection(tr.closest("[data-sec]").dataset.sec);
    const row = sec.bells[Number(tr.dataset.row)];
    /* 概览行上没有输入框，只有末尾那两枚按钮；别的都不用接。
       （同一份 [data-row] 选择器两边共用，所以在这儿按门槛分岔。） */
    if (!examDirect()){
      tr.querySelector("[data-f=edit]").onclick = ()=> openExamEdit(sec, row);
      tr.querySelector("[data-f=del]").onclick = ()=>{ sec.bells.splice(sec.bells.indexOf(row),1); saveExamLocal(); renderAll(); };
      return;
    }
    const q = s => tr.querySelector(s);
    /* 这两个框读完就 renderAll()，而浏览器自己的 change 早于 blur —— 那一趟拿到
       的是还没归整的生文本（敲「11」） 。所以这里先自己解析一遍：解析得出来就当场
       收下，解析不出来就**不动它**（不 renderAll，框还留在页面上），让下面
       wireQuickTime 的 blur 归整完再补派一次 change，那一次才是标准写法。
       反过来的写法——照收生文本——会把「11」存进配置，还顺手把框重画掉，
       于是 blur 落在已经摘下来的节点上，再也修不回来。 */
    /* 开考时间也有默认值，但**默认值可以删**（用户定的）：清空就真的空着，
       不写开考铃 —— 所以和结束时间同一个写法。 */
    q("[data-f=start]").onchange  = ev=>{
      const raw = String(ev.target.value==null?"":ev.target.value).trim();
      const v = raw ? parseQuickTime(raw) : "";
      if (v===null) return;
      row.start = v; saveExamLocal(); renderAll();
    };
    /* 结束铃同样允许留空：清空 = 不写结束铃 */
    q("[data-f=end]").onchange    = ev=>{
      const raw = String(ev.target.value==null?"":ev.target.value).trim();
      const v = raw ? parseQuickTime(raw) : "";
      if (v===null) return;
      row.end = v; saveExamLocal(); renderAll();
    };
    wireQuickTime(q("[data-f=start]"), {emptyOK:true});
    wireQuickTime(q("[data-f=end]"), {emptyOK:true});
    /* 日期那一格：点开浮层日历，选一天就完事（一个科目只有一天）。
       选完再点一次那个框 = 收起（openDatePicker 自己判）。 */
    q("[data-f=date]").onclick = ev=>{
      openDatePicker(ev.currentTarget, row.date, day=>{
        row.date = day;
        /* 已经在考了的话，这一天的周期和列表窗口得跟着挪。正常走不到 —— 排布下去
           之后整页只读（lockExam 把 .page-body 里的 button 全 disable 了，这一格
           点不开），这是给「改了锁定范围」留的保险。 */
        if (S.exam.on){ applyExamStrategies(); queueExamWindow(examListId()); }
        saveExamLocal();
        renderAll();
      });
    };
    q("[data-f=subject]").oninput = ev=>{
      row.subject = ev.target.value;
      saveExamLocal();
      /* 红是照着缺格挂的，重画才会消失 —— 可这个框不能边打边重画（焦点会掉到地上）。
         所以填够字了就地把它摘掉，人打着字就看着红圈没了。 */
      const cell = ev.target.closest("td");
      if (cell && !examRowBad(row).subject) cell.classList.remove("is-err");
    };
    /* 考试铃声：点开音源选择器（只列音频文件，没有「媒体库」——
       这一格只装得下一个文件名）。 */
    q("[data-f=mediaPick]").onclick = ()=>
      pickOneMedia("选择考试铃声", m=>{ row.media = m; saveExamLocal(); renderAll(); }, row.media,
        {sub:"从媒体库的音频文件里挑一个铃声"});
    q("[data-f=vol]").onchange    = ev=>{ row.vol = Number(ev.target.value)||70; saveExamLocal(); };
    q("[data-f=listenPick]").onclick = ()=>{ pickOneMedia("选择听力音频", m=>{ row.listen = m; saveExamLocal(); renderAll(); }, row.listen); };
    q("[data-f=listenVol]").onchange = ev=>{ row.listenVol = Number(ev.target.value)||LISTEN_VOL_DEFAULT; saveExamLocal(); };
    q("[data-f=del]").onclick     = ()=>{ sec.bells.splice(sec.bells.indexOf(row),1); saveExamLocal(); renderAll(); };
  });

  /* 事件都接完了再冻 —— 顺序上反过来也一样（disabled 的控件不派发 click），
     但这么写读起来是「先接好，再锁上」。 */
  if (e.on) lockExam(el);
}

/* 二级：从媒体库里挑一个音源文件。考试铃声、听力音频都走这里。 */
function pickOneMedia(title, cb, cur, opts){
  /* cur 是这一行当前选的那个文件：不带上它，再点一次伪下拉就会看到
     「一个都没选」，明明刚选过。带上之后选择器里就是当前这一项。 */
  openMediaPicker(cur?[cur]:[], [], r => cb((r && r.media[0]) || ""),
    Object.assign({filesOnly:true, title:title, sub:"从服务器的媒体库里挑一个音源文件"}, opts));
}

/* 竖屏概览行上那枚铅笔：把这一场的全部字段摆进一张弹窗。
   弹窗改的是一份**草稿**（draft）：只有点「完成」并且 examRowBad 验过没问题，
   才写回 row / 加进列表；「取消」、×、Esc、点遮罩都只是关掉，一个字都不写。
   弹窗里沿用宽屏那几套控件：openDatePicker、openTimePicker、pickOneMedia，
   连缺格标红的时机都一样（S.exam.checked 之后）。 */
function openExamEdit(sec, row, isNew){
  const draft = Object.assign({}, row);
  const checked = S.exam.checked && (sec.t.length||sec.g.length);
  /* 新加的那一行进来时不该是红的 —— 红只在「点过完成 / 启用考试被拦过」之后挂。 */
  const bad = (!isNew && checked) ? examRowBad(draft) : {};
  const fld = k => '<div class="field'+(bad[k]?' is-err':'')+'">';
  /* 选完一样东西就把它那一格的红摘掉（前提是这一格已经不缺了）；不用重画，
     红是挂在 .field 上的。 */
  const unbad = (el, k)=>{
    const f = el && el.closest(".field");
    if (f && !examRowBad(draft)[k]) f.classList.remove("is-err");
  };
  const setV = (el, txt)=>{
    const v = el && el.querySelector(".v");
    if (!v) return;
    v.textContent = txt;
    v.classList.toggle("ph", txt==="无");
  };
  openModal({
    title: isNew ? "添加考试" : "编辑考试", width:"560px",
    onClose: ()=> renderAll(),
    mount(body, foot, mm){
      /* ex-edit：这张弹窗在手机上也要保持「一行两格」的四行布局，
         不跟着 ≤980px 那条把 .grid2 收成一列（见 css）。 */
      body.innerHTML =
        '<div class="grid2 ex-edit">'+
          fld("subject")+'<label>考试科目</label>'+
            '<input class="input" id="eeSubject" value="'+esc(draft.subject||"")+'" placeholder="如 语文"></div>'+
          '<div class="field"><label>考试日期</label>'+
            '<button type="button" class="select-btn" id="eeDate" title="点开日历，选这一天考">'+
              '<span class="v mono">'+esc(draft.date||todayISO())+'</span>'+
              '<span class="chev">'+ICON.cal+'</span></button></div>'+
          /* 开考 / 结束不是输入框：点一下直接开时/分/秒转轮（宽屏是浮层，
             手机上是一块模态）。值只从转轮里来，所以没有占位符。 */
          fld("start")+'<label>开考时间</label>'+
            '<button type="button" class="select-btn" id="eeStart" title="点开按时/分/秒选">'+
              '<span class="v mono">'+esc(hms(draft.start))+'</span>'+
              '<span class="chev">'+ICON.clock+'</span></button></div>'+
          fld("end")+'<label>结束时间</label>'+
            '<button type="button" class="select-btn" id="eeEnd" title="点开按时/分/秒选">'+
              '<span class="v mono">'+esc(hms(draft.end))+'</span>'+
              '<span class="chev">'+ICON.clock+'</span></button></div>'+
          fld("media")+'<label>考试铃声</label>'+
            '<button type="button" class="select-btn" id="eeMedia" title="'+esc(draft.media||"这场考试还没有选铃声")+'">'+
              '<span class="v'+(draft.media?"":" ph")+'">'+esc(draft.media||"无")+'</span>'+
              '<span class="chev">'+ICON.chevD+'</span></button></div>'+
          '<div class="field"><label>铃声音量</label>'+
            '<input class="input mono" id="eeVol" type="number" min="0" max="100" value="'+Number(draft.vol||70)+'"></div>'+
          '<div class="field"><label>听力音频</label>'+
            '<button type="button" class="select-btn" id="eeListen" title="'+esc(draft.listen||"这场考试不放听力音频")+'">'+
              '<span class="v'+(draft.listen?"":" ph")+'">'+esc(draft.listen||"无")+'</span>'+
              '<span class="chev">'+ICON.chevD+'</span></button></div>'+
          '<div class="field"><label>听力音量</label>'+
            '<input class="input mono" id="eeListenVol" type="number" min="0" max="100" value="'+Number(draft.listenVol||LISTEN_VOL_DEFAULT)+'"></div>'+
        '</div>';

      /* 下面所有的改动都只落在 draft 上 —— 不 saveExamLocal()，也不碰 row。 */
      const subj = body.querySelector("#eeSubject");
      subj.oninput = ev=>{ draft.subject = ev.target.value; unbad(subj, "subject"); };

      const dateBtn = body.querySelector("#eeDate");
      dateBtn.onclick = ()=>{
        openDatePicker(dateBtn, draft.date, day=>{ draft.date = day; setV(dateBtn, day); });
      };

      const st = body.querySelector("#eeStart"), en = body.querySelector("#eeEnd");
      /* 两格都是「点开转轮」而不是输入框：openTimePicker 往传进去那个对象的
         .value 里写，这里给它一个只有 value 的小壳；转轮 commit 回来再把值落到
         draft 上并刷新按钮上的数字。转轮没有清空那一步，所以这两项总有值。 */
      const wirePick = (btn, key)=>{
        const box = { value: hms(draft[key]) || "00:00:00" };
        btn.onclick = ()=> openTimePicker(btn, box, ()=>{
          const v = parseQuickTime(box.value);
          if (v===null) return;
          draft[key] = v;
          const val = btn.querySelector(".v");
          if (val) val.textContent = v;
          unbad(btn, key);
          unbad(en, "end");
        });
      };
      wirePick(st, "start");
      wirePick(en, "end");

      const mediaBtn = body.querySelector("#eeMedia");
      mediaBtn.onclick = ()=>
        pickOneMedia("选择考试铃声", m=>{ draft.media = m; setV(mediaBtn, m||"无"); unbad(mediaBtn, "media"); },
          draft.media, {sub:"从媒体库的音频文件里挑一个铃声"});

      const listenBtn = body.querySelector("#eeListen");
      listenBtn.onclick = ()=>
        pickOneMedia("选择听力音频", m=>{ draft.listen = m; setV(listenBtn, m||"无"); }, draft.listen);

      body.querySelector("#eeVol").onchange = ev=>{ draft.vol = Number(ev.target.value)||70; };
      body.querySelector("#eeListenVol").onchange = ev=>{ draft.listenVol = Number(ev.target.value)||LISTEN_VOL_DEFAULT; };

      /* 竖屏没有右上角的 ×：「取消」摆在主按钮左边，取消就是关掉、不写。 */
      foot.innerHTML = '<span class="spacer"></span>'+
        (isNarrow()?'<button class="btn" data-cancel>取消</button>':"")+
        '<button class="btn btn-primary" data-done>'+(isNew?"添加":"确定")+'</button>';
      const cancel = foot.querySelector("[data-cancel]");
      if (cancel) cancel.onclick = ()=> closeModal(mm.id);
      /* 只有主按钮写：先验必填项（科目 / 开考 / 结束 / 考试铃声）缺一个或写错
         就标红拦下、不关弹窗；全对了才把草稿写回 row（编辑）或加进列表（新建）。 */
      foot.querySelector("[data-done]").onclick = ()=>{
        const errs = examRowBad(draft);
        const mark = (k, sel)=>{
          const el = body.querySelector(sel);
          const f = el && el.closest(".field");
          if (f) f.classList.toggle("is-err", !!errs[k]);
        };
        mark("subject", "#eeSubject");
        mark("start",   "#eeStart");
        mark("end",     "#eeEnd");
        mark("media",   "#eeMedia");
        if (Object.keys(errs).length){
          toast("请检查并正确填写标红项目","err");
          return;
        }
        if (isNew) sec.bells.push(draft);
        else Object.assign(row, draft);
        saveExamLocal();
        closeModal(mm.id);
      };
    }
  });
}

function examSectionHTML(s){
  /* 直接编辑（横屏且够宽）之外的档都不摆那排输入框，改成「一场一行」的
     概览，编辑走弹窗 —— 理由见下面 sumRows 那段。 */
  const narrow = !examDirect();
  const onlyOne = S.exam.sections.length === 1;
  /* 上一次点「启用考试模式」被拦下来过（e.checked），这一行的缺格才标红；改对了
     就随重画自己消失。没被拦过的时候一格红都不挂 —— 新加的一行本来就是空的。 */
  const checked = S.exam.checked && (s.t.length||s.g.length);
  const rows = s.bells.map((r,ri)=>{
    const bad = checked ? examRowBad(r) : {};
    /* 红挂在 <td> 上、由 css 去点里面的控件：时刻框是 quickTimeHTML 画的，class
       写死在那个公共函数里，从外面加不上去。 */
    const td = k => '<td'+(bad[k]?' class="is-err"':'')+' ';
    return '<tr data-row="'+ri+'">'+
      /* 考试科目打头（用户定的：横屏第一列、竖屏第一行）。这一行是「哪个科目」，
         比「哪天考」「几点考」都粗一层，读的时候该先落到眼睛上。
         这一格 225px（原来是 150px，用户要的 1.5 倍）——科目名是这一行里
         唯一**手打**的东西，其它格都是点出来的。「道德与法治」六个字在 13px 下
         约 78px，原来那个框刨掉内边距只剩 124px，打个长科目名一眼看不全。
         这一格和右边两格（考试铃声 / 听力音频）是整张表**仅有的三格可以让位**的：
         它们的落脚点是「窄了有省略号」，别人不是。窗口不够宽时先缩它们，
         缩到各自的底线（见 css 里 min-width 那段）才轮到 .tbl-wrap 横向滚。 */
      td("subject")+'style="width:225px" data-lab="考试科目"><input class="input" style="padding:4px 8px" data-f="subject" value="'+esc(r.subject||"")+'" placeholder="如 语文"></td>'+
      /* 考试日期第二格。它是个**按钮**不是输入框：日期是点出来的，让人手敲
         2026-10-14 只会敲错。.select-btn 就是「长得像框、但只能点」的那套
         （听力音频也用同一套）。
         格宽 148px 比旁边两个时刻格（132px）多 16px：旁边那两格是把「▾」**绝对定位
         压在框里**（.t-in 自己留 26px 右内边距），这一格是 flex，「▾」和日期各占一份
         真宽度 —— 132px 刨下来只够 70px，而「2026-10-14」十个等宽字符在 13px 下约
         78px，会变成「2026-10-…」。多出来的 16px 直接算进整表宽度（那格吃宽度的
         空列已经删了，见下面 thead 那段）。 */
      '<td style="width:148px" data-lab="考试日期"><button type="button" class="select-btn" data-f="date" title="点开日历，选这一天考">'+
        '<span class="v mono">'+esc(r.date || todayISO())+'</span>'+
        '<span class="chev">'+ICON.cal+'</span></button></td>'+
      /* 右边留 26px 给叠在框里的那枚「▾」：行内样式盖掉了 .t-in 那条 padding-right，
         不写在这儿字会跑到按钮底下。
         格宽 132px 是算出来的，不是随手定的：表格是 border-collapse:separate，
         `width` 量的是**连内边距一起**的边框盒，`table.tbl td` 左右各 12px，所以
         框本身只有 132-24=108px；再刨掉 1px 边框和左右 8+26 的内边距，留给「09:30:00」
         的可见宽度是 132-24-2-8-26 = 72px。八个等宽字符在 13px 等宽字体下约 62px ——
         刚好放得下，还剩一点余量。原来写的是 108px，算下来只剩 48px，秒那两位就被
         那枚「▾」压住看不见了。 */
      /* data-lab 是**竖屏那一格的表头**：≤980px 时整张表的 <thead> 被收掉、这场考试
         改成两块 flex 行（见 css/app.css 末尾），表格列头跟着没了，一屏下拉框和
         输入框就没了名字。标签由 CSS 用 ::before 画在控件上方，宽屏上这条规则不生效，
         真正管事的还是 <thead>。宽屏那份列头和这里一一对应，改一个记得改另一个。 */
      td("start")+'style="width:132px" data-lab="开考时间">'+quickTimeHTML('data-f="start" style="padding:4px 26px 4px 8px"', r.start, "00:00:00")+'</td>'+
      /* 结束时间这格的占位符是 00:00:00 而不是别处的 08:00 —— 空着的时候得让人
         一眼看出「这儿是空的」，不是一个已经填好的上午八点。启用考试模式前这一格
         必须填上，而且不能早于开考时间（见 examRowBad）。 */
      td("end")+'style="width:132px" data-lab="结束时间">'+quickTimeHTML('data-f="end" style="padding:4px 26px 4px 8px" title="这场考试的结束时间，不能早于开考时间"', r.end, "00:00:00")+'</td>'+
      /* 考试铃声和右边那格听力音频一个样子：长得像下拉，点下去开选择器。以前它是
         个真的 <select>，只列预设 + 「自定义…」；预设有过一版是面板自带的，后来
         改成全是用户自己加的，一条都没有时那个下拉里就只剩个空壳。现在直接开
         音频文件列表。 */
      td("media")+'style="width:150px" data-lab="考试铃声"><button class="select-btn" type="button" data-f="mediaPick" title="'+esc(r.media||"这场考试还没有选铃声")+'">'+
        '<span class="v'+(r.media?"":" ph")+'">'+esc(r.media||"无")+'</span>'+
        '<span class="chev">'+ICON.chevD+'</span></button></td>'+
      '<td style="width:80px" data-lab="铃声音量"><input class="input mono" type="number" min="0" max="100" style="padding:4px 8px" data-f="vol" value="'+Number(r.vol||70)+'"></td>'+
      /* 听力音频：长得像下拉，点下去直接开选择器。它没有「先挑一首再展开」那一步 ——
         只有「放哪一首」和「不放」。空 = 不放听力。 */
      '<td style="width:150px" data-lab="听力音频"><button class="select-btn" type="button" data-f="listenPick" title="'+esc(r.listen||"这场考试不放听力音频")+'">'+
        '<span class="v'+(r.listen?"":" ph")+'">'+esc(r.listen||"无")+'</span>'+
        '<span class="chev">'+ICON.chevD+'</span></button></td>'+
      '<td style="width:80px" data-lab="听力音量"><input class="input mono" type="number" min="0" max="100" style="padding:4px 8px" data-f="listenVol" value="'+Number(r.listenVol||LISTEN_VOL_DEFAULT)+'"></td>'+
      /* 删除这格不挂 data-lab：垃圾桶图标本来就是它自己的说明，
         上面再压一行「删除」是废话，还会把这一格撑得比桶高。 */
      '<td style="width:36px"><div class="rowacts"><button class="ric danger" data-f="del" title="删除这场考试">'+ICON.del+'</button></div></td>'+
    '</tr>';
  }).join("");

  /* 竖屏那一份：一场考试只占一行，别的一概不展开（用户定的）。
     九格控件在手机宽度上摆不成一张表 —— 原来那套是把一行折成三行、每格
     上方用 css 画个小标签，看着还是一堆输入框。概览的好处是每一行都能
     一眼读完「哪科 / 哪天 / 几点到几点 / 有没有听力」，要动才点铅笔。
     列宽写在 css 的 .ex-sum-row 上，表头和数据行共用同一份网格，所以
     场次再多也是对齐的；末尾两格是编辑和删除，表头留空。
     「听力」只用一枚状态点表示有没有（绿圈勾 / 灰圈横线）—— 文件名和音量
     不在这一行露脸（那两样在弹窗里）。
     缺格沿用宽屏那套标红口径：被「开始考试」拦过（checked）之后，科目 / 结束
     这两格直接红字，另外给铅笔点一颗红点（铃声缺了也有自己那一枚灰点）。 */
  const sumRows = s.bells.map((r,ri)=>{
    const bad = checked ? examRowBad(r) : {};
    const hasBad = !!(bad.subject || bad.start || bad.end || bad.media);
    const t5 = v => String(v||"").slice(0,5);
    /* 科目 / 日期 / 开考 / 结束 / 铃声都是必填，空着就留白（点过完成或启用被拦时
       由红字提示），不再摆灰圈横线。只剩听力还用它 —— 那一项本来就可以没有。 */
    const subj = String(r.subject||"").trim();
    return '<div class="ex-sum-row" data-row="'+ri+'">'+
      '<span class="c-subject'+(bad.subject?' is-bad':'')+'">'+esc(subj)+'</span>'+
      '<span class="c-date mono">'+esc(r.date||"")+'</span>'+
      '<span class="c-time mono'+(bad.start?' is-bad':'')+'">'+esc(t5(r.start))+'</span>'+
      '<span class="c-time mono'+(bad.end?' is-bad':'')+'">'+esc(t5(r.end))+'</span>'+
      '<span class="c-listen">'+
        (r.listen ? '<span class="ex-dot yes" title="有听力音频">'+ICON.check+'</span>'
                  : '<span class="ex-dot no" title="无听力音频">'+ICON.minus+'</span>')+
      '</span>'+
      '<button type="button" class="ex-ic'+(hasBad?' warn':'')+'" data-f="edit" title="编辑这场考试">'+ICON.edit+'</button>'+
      '<button type="button" class="ex-ic danger" data-f="del" title="删除这场考试">'+ICON.del+'</button>'+
    '</div>';
  }).join("");

  return '<div class="panel" data-sec="'+s.id+'">'+
    '<div class="panel-head">'+
      /* 分区名直接当标题，改名走旁边的铅笔 —— 和铃声计划标题旁那一对一个样子。
         以前名字是个常驻输入框、删除是个带字的红按钮：输入框看着像表单没填完，
         删除又占掉半行，两样都比不上「标题 + 两个小图标」。 */
      '<span class="title-row">'+
        '<h3>'+esc(s.name)+'</h3>'+
        '<span class="acts">'+
          '<button class="btn btn-icon" data-act="secName" title="编辑分区名称">'+ICON.edit+'</button>'+
          /* 只剩一个分区时这枚按钮换工作：**重置这个分区**而不是删掉它。
             面板不能一个分区都不剩（没有分区就没地方放考试），所以最后一枚
             按钮干的是把分区还回刚建出来的样子 —— 名字、区域、科目全都归位。
             图标也换：桶 = 删掉这个分区，✕ = 抹掉里面的东西。 */
          (onlyOne ?
            '<button class="btn btn-icon btn-danger" data-act="clearsec" title="重置这个分区（分区只剩一个，不能再删）">'+ICON.x+'</button>'
           :
            '<button class="btn btn-icon btn-danger" data-act="delsec" title="删除这个分区">'+ICON.del+'</button>')+
        '</span>'+
      '</span>'+
      /* 这一行后面原来还挂着一句「N 个区域 · M 个科目」（用户要的：直接去掉）——
         两个数一个都不缺地方看：区域就是紧底下那排胶囊，几条一眼数得出来；
         科目的条数在同一张卡片的「考试安排」那一行上（那儿写「N 科」）。
         去掉之后「编辑区域」照样靠右 —— 它是自己那条 .panel-head .acts 的
         margin-left:auto 顶过去的，不是那句 .sub 撑的。 */
      '<span class="acts">'+
        '<button class="btn btn-sm" data-act="area">编辑区域</button>'+
      '</span>'+
    '</div>'+
    '<div class="panel-body"><div class="area-chips">'+
      /* 和「静音区域」那一条同一个道理（见那一段的注释）：胶囊自带 ×、点整颗就摘掉。
         锁定时不给 —— 这里只认 `S.exam.on`，和 lockExam 同一个口径。 */
      ((s.t.length+s.g.length)? areaChips({t:s.t,g:s.g}, !S.exam.on) : '<span class="hint">暂未选择任何区域</span>')+
    '</div></div>'+
    '<div class="panel-head" style="border-top:1px solid var(--border)">'+
      '<h3>考试安排</h3>'+
      '<span class="sub">'+s.bells.length+' 科</span>'+
      '<span class="acts"><button class="btn btn-sm" data-act="addbell">'+ICON.plus+' 添加考试</button></span>'+
    '</div>'+
    (s.bells.length?
      (narrow ?
        /* 概览那一档（竖屏，或横屏 ≤980px）：一场一行，末尾两枚按钮
           （编辑 / 删除）。表头和行共用 css 里那一份列宽，所以各场之间自然对齐。 */
        '<div class="ex-sum">'+
          '<div class="ex-sum-row ex-sum-head">'+
            '<span>科目</span><span>日期</span><span>开考</span><span>结束</span>'+
            '<span class="c-listen">听力</span>'+
            '<span></span><span></span>'+
          '</div>'+ sumRows +
        '</div>'
       :
        /* 直接编辑那一档（横屏且 >980px）：还是那张表。tbl-exam 这个类留着 ——
           css 里 ≤980px 那一档还挂着它那套 flex 排法（现在轮不到它：≤980px
           早已画成 .ex-sum），但宽屏这档那几格的最小宽度也挂在类上，删掉就得
           把那些尺寸另找地方放。 */
        '<div class="tbl-wrap"><table class="tbl tbl-exam"><thead><tr>'+
          '<th style="width:225px">考试科目</th>'+
          /* 这张 <thead> 和上面每一行 <td> 的 data-lab 一一对应，改一个记得改另一个。
             **顺序也是**：科目前在头一格（横屏第一列）。 */
          '<th style="width:148px">考试日期</th>'+
          '<th style="width:132px">开考时间</th><th style="width:132px">结束时间</th>'+
          '<th style="width:150px">考试铃声</th><th style="width:80px">铃声音量</th>'+
          '<th style="width:150px">听力音频</th><th style="width:80px">听力音量</th>'+
          '<th style="width:36px"></th>'+
        '</tr></thead><tbody>'+rows+'</tbody></table></div>'
      )+
      /* 底下这一行是听力的播放延迟（用户定的）：整句靠右，数字框嵌在句子里。
         那个数说的是「开始考试」那一刻给听力铃算时刻时加几分钟（见 examRowTime）。 */
      '<div class="panel-body hint ex-listen" style="border-top:1px solid var(--border)">'+
        '<span>听力音频延迟 '+
        '<input class="input mono ex-listen-num" id="exListenDelay" type="number" min="1" max="60" step="1" '+
          'title="听力铃声排在开考铃之后几分钟" value="'+listenDelay()+'">'+
        ' 分钟播放</span>'+
      '</div>'
     : '<div class="panel-body hint ex-empty">暂无考试安排, 点击右上角「添加考试」添加</div>')+
  '</div>';
}

/* 「改动预览」：这一场排下去之后，常规列表里哪些铃声会在考试时段自动闪避。
   它从页面最底下那块常驻的 .panel 搬进了「考试模式」标题旁那枚眼镜后面
   （用户要的）：点开就当场算，不用先点一枚「计算改动」。
   摆法**照「终端任务反查」那一套**（用户定的）：宽屏弹一张居中卡片，
   竖屏整页顶掉考试模式这一页 —— 顶栏不动，内容在下面，出口是顶栏第二行
   最左那枚「‹ 返回」。一张四列的表塞进手机上的居中卡片里看不成的道理，
   那边已经付过一次学费了，不再另发明一种。
   宽度写死 760px 是给宽屏那一档的（就是 --mw 那个上限）。 */
function openExamPreview(){
  if (!examDirect()){
    if (S.dt.exPreview) return;
    /* 走 renderAll() 不走 renderMain()：那枚「‹ 返回」住在顶栏里，
       不重画顶栏它不会长出来。 */
    S.dt.exPreview = true;
    renderAll();
    return;
  }
  openModal({
    title:"改动预览", sub:"哪些铃声会在考试期间自动闪避",
    width:"760px", footer:false,
    mount(body){ runExamPreview(body); }
  });
}
/* ══ 竖屏：整页 ═════════════════════════════════════════════════════
   骨架和「终端任务反查」的结果页一模一样（#main.fill + .sec-head + .panel.grow）：
   整页不滚，**只有那张表滚**，题头才钉得住（道理写在 70-view-more 的
   moreResultsBoxHTML 那段：sticky 只认最近的那个滚动容器，所以 .tbl-wrap
   必须是 .panel.grow 的直接孩子，中间不能垫一层）。
   出口是顶栏那枚 #tbBack（见 30-view-list 的 showBack / tbBack.onclick）。 */
function renderExamPreviewFull(el){
  el.classList.add("fill");
  el.innerHTML =
    '<div class="sec-head">'+
      '<div style="min-width:0">'+
        /* 「几条」抬到标题右边（和「查询结果」那一页同一个排法）：条数一进正文，
           表就被挤下去一行，钉住的题头也跟着低一行。flex-wrap 必须写回来 ——
           ≤980 那条 `.sec-head .title-row{flex-wrap:nowrap}` 是给「标题 + 右边按钮」
           那类行准备的，套到这儿会让这一行在 360px 的屏上顶出屏幕去（行内样式
           压得过媒体查询）。 */
        '<div class="title-row" style="flex-wrap:wrap">'+
          '<h2 class="serif">改动预览</h2>'+
          '<span class="hint" id="exPvSub"></span>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="panel grow" id="exPvBox">'+
      '<div class="hint" style="padding:16px 14px">正在扫描全部正常列表…</div>'+
    '</div>';
  runExamPreview(el.querySelector("#exPvBox"), el.querySelector("#exPvSub"));
}
/* 抢在扫描回来之前把弹窗关掉（人看一眼就走了）时，这个盒子已经从文档里摘下来，
   往它身上写没意义 —— 项目里凡是异步回来再写 DOM 的地方都留着这道闸
   （见 js/20-ui.js 里那句注释）。 */
async function runExamPreview(box, sub){
  if (!box) return;
  /* 两个容器共用这一段，差别只有两处：
       · 竖屏整页那一份（有 sub，就是标题行右边那一格）把「几条」抬到标题旁边，
         正文里只剩那张表 —— 表头才钉得住；弹窗那一份标题在弹窗头上，
         这句话只能留在正文里。
       · 整页那一份的盒子是 .panel.grow，本身没有内边距（表要贴着边、题头才钉得
         住），所以纯文字那几句得自己带上内边距；弹窗正文自己有 18px/20px。 */
  const full = !!sub;
  const pad  = full ? ' style="padding:16px 14px"' : "";
  const say  = t => { if (sub && sub.isConnected) sub.textContent = t; };
  const crit = t => '<div class="hint" style="color:var(--crit)'+(full?";padding:16px 14px":"")+'">'+esc(t)+'</div>';
  box.innerHTML = '<div class="hint"'+pad+'>正在扫描全部正常列表…</div>';
  try{
    const scanned = await scanNormalLists();
    if (!box.isConnected) return;
    /* 这里原来还挂着两句交代：「已跳过 N 个停用列表」和「另有 N 条铃声的区域虽然
       和考场或静音区域重合、但时刻不在考试时段里」。用户看过之后决定不要 —— 这一页
       只摊开「哪些铃声会闪避」，旁枝末节的话压过了那张表本身。扫描那两份计数照旧
       算着（scanNormalLists 里），要交代随时能拿回来。 */
    const EMPTY = "没有需要闪避的铃声，都会原样保留。";
    if (!scanned.length){
      if (full){ say(EMPTY); box.innerHTML = ""; }
      else box.innerHTML = '<div class="hint">'+EMPTY+'</div>';
      return;
    }
    if (full) say("下列 "+scanned.length+" 条铃声会在考试期间自动闪避");
    box.innerHTML =
      (full ? "" : '<div class="hint" style="margin-bottom:8px">下列 '+scanned.length+' 条铃声会在考试期间自动闪避：</div>')+
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>列表</th><th style="width:70px">时间</th><th>铃声</th><th>闪避区域</th></tr></thead><tbody>'+
      scanned.map(x=>'<tr><td>'+esc(x.listName)+'</td><td class="mono">'+esc(hm(x.bell.time))+'</td><td>'+esc(x.bell.name)+'</td>'+
        '<td>'+esc(x.trim.removedT.concat(x.trim.removedG).join("、"))+'</td></tr>').join("")+
      '</tbody></table></div>';
  }catch(e){ box.innerHTML = crit(e.message); }
}

