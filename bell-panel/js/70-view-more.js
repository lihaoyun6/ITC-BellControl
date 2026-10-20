/* view-more — 更多功能
   广播控制台 · 替代厂商后台的打铃配置面板
   //////////////////////////////////////////////////////////////
   这一页是一个入口页：两张卡片，点进去各是一套完整界面。

     任务反查 —— 选一天 + 选一批点位／分组，把「这一天它们会响什么」摊成
     一张按时刻排好的表。结果就留在本页，不再弹窗。口径是**原始数据**：
     不看面板里正在编辑的工作集，而是把每张启用的铃声列表重新拉一遍，
     再加上全部定时任务。

     终端测试 —— 选一个音源 + 一批点位，按「开始测试」向这些终端真实播放
     一次这段音源。下面按「分组 → 终端」两层显示它们的实时状态。

   任务反查**只读**：全是 GET。不改服务器上一个字节。
   终端测试会往终端推音频——这是能听见的写入，只在用户明确按下按钮时发生。

   ── 媒体管理 ──────────────────────────────────────────────────────
   原来也是这一页的一张卡片，现在提成了顶栏／导航栏上的独立页
   （见下面 renderMedia）。它看服务器上的音频文件和媒体库，上传、删除音频，
   新建、改名、删除媒体库。走的是厂商 v2 的 /medias 与 /medias-groups 接口，
   **都是即时写入**（不进草稿队列 —— 那套是给铃声和任务排程用的）。
   代码还留在这个文件里：它和这里的音源选择器共用同一份媒体缓存。 */

/* ══ 状态 ═══════════════════════════════════════════════════════════
   结果存在 S.dt.more 里，**不存 DOM**。loadTasks() 末尾自己会 renderTopbar() +
   renderMain()，查询途中只要碰到它整页就被重画一次 —— 结果要是塞在页面节点里，
   这一下就冲没了。renderMore() 每次从状态重画。 */
function moreState(){
  if (!S.dt.more) S.dt.more = {
    tab: "home",                 /* home 卡片页 | lookup 任务反查 | test 终端测试 */
    date: todayISO(),
    area: {t:[], g:[]},          /* 和别处一样是 {点位名[], 分组名[]} */
    busy: false, done: false,
    hits: [],                    /* 会响的：一条铃声的几个时刻各占一行 */
    test: moreTestInit()
  };
  const st = S.dt.more;
  if (!st.tab) st.tab = "home";
  if (!st.test) st.test = moreTestInit();
  return st;
}
/* 媒体管理的筛选状态。和别处一样只活在内存里 —— 进进出出还停在刚才那个
   页签、那句搜索词上，刷新页面就从头来。 */
function mediaState(){
  if (!S.dt.media) S.dt.media = {tab:"file", q:"", g:"all"};
  const m = S.dt.media;
  if (!m.tab) m.tab = "file";
  /* 选中的音频 id（一律按字符串存，服务器那两种类型都见过）。
     换库、换页签、删完都清空 —— 选择只对着眼前这一批文件说话。 */
  if (!m.sel) m.sel = new Set();
  return m;
}
/* 服务器自带的两个媒体库：固定排在「全部媒体库」下面，次序就照这个数组；
   它们不给改名、不给删（入口藏起来，见 renderMedia 两套排版）。
   认的是名字 —— 服务器没给这两只库一个稳定的标记，名字是唯一认得出来的东西。 */
const PINNED_MEDIA_LIBS = ["默认媒体库", "终端点播"];
const isPinnedLib = g => PINNED_MEDIA_LIBS.indexOf(String(g && g.name)) >= 0;
function sortedMediaGroups(){
  /* 次序照服务器给的原样 —— 那就是创建顺序（原版面板也这么显示，越晚建的越靠下）。
     这里以前按名字排，把服务器那份次序打乱了。
     「默认媒体库」「终端点播」例外：固定提到最前，按 PINNED_MEDIA_LIBS 的次序。 */
  const pin = g => PINNED_MEDIA_LIBS.indexOf(String(g && g.name));
  const list = S.data.mediaGroups.slice();
  return list.filter(g=> pin(g) >= 0).sort((a,b)=> pin(a)-pin(b))
             .concat(list.filter(g=> pin(g) < 0));
}
function moreTestInit(){
  return {
    media: "",                   /* 音源文件名 */
    area: {t:[], g:[]},          /* 测试点位 */
    phase: "idle",               /* idle | creating | starting | playing */
    err: "",                     /* 上一次没做成的一句话 */
    gen: 0,                      /* 第几趟测试；停掉就翻号，作废在途的 await */
    taskId: null,                /* 临时一键报警任务 id（REST） */
    serverTaskId: null,          /* 服务器上这条试听会话的 TaskID（停止要用） */
    timer: 0,                    /* 试听状态轮询 */
    miss: 0,                     /* starting 阶段连续几拍没查到自己那条 */
    cleanupId: null,             /* 正在停止、等确认后要删的任务 id */
    cleanupQuiet: false,
    cleanupTries: 0,
    cleanupStopSent: false,
    cleanupTimer: 0,
    count: 0                     /* 这一趟推给几台终端 */
  };
}
function moreTestState(){
  const st = moreState();
  if (!st.test) st.test = moreTestInit();
  return st.test;
}
/* 正在测试（建任务、启动试听、播放都算）。对讲和在线播放用它来挡：测试的报警
   会从同一批喇叭里响出来，不能和它们叠在一起。 */
function moreTestRunning(){
  const t = S.dt.more && S.dt.more.test;
  return !!(t && t.phase !== "idle");
}

const moreAreaChosen = a => !!((a && a.t && a.t.length) || (a && a.g && a.g.length));
const moreAreaText = a => moreAreaChosen(a)
  ? (a.t||[]).concat(a.g||[]).join("、")
  : "选择终端...";
const moreMediaText = o => (o.mediaNames||[]).concat(o.mediaGroupNames||[]).join("、") || "—";
/* 周期那一列写**周期属性的名字**，不铺「周一、周二、周三」那串星期。
   和列表页同一个理由（见 30-view-list.js「名称下面写执行周期的名字」那段注释）：
   一串星期每行都不一样、占掉半行，扫一眼看不出差别；名字是给人认的。
   铃声的名字就是它那条策略的 name（timing_bells_strategy_id 指过去的那条）；
   定时任务没有 name 这一项，它那个属性就是 time_type，所以写类型名。
   具体哪几天／哪些日期挪进 title，鼠标停一下就看得到。 */
const TASK_TT_NAME = ["按周重复","按天重复","按日期区间","指定日期"];
/* 周期的**明细**：这条自己哪天响（星期几／哪几个日期）。只做 title，不占列宽。
   只认得出 0 按周重复 / 3 指定日期 —— 别的编号压根进不了这张表（见 runsOn）。 */
function morePeriodText(sched){
  if (!sched) return "—";
  const tt = Number(sched.timeType);
  if (tt === 0){
    const w = (sched.weeks||[]).map(Number).filter(n=>n>=1&&n<=7).sort((a,b)=>a-b);
    if (w.join(",") === "1,2,3,4,5,6,7") return "每天";
    return w.length ? w.map(x=>WEEK[x]).join("、") : "未设置";
  }
  if (tt === 3) return (sched.dates||[]).join("、") || "未设置";
  return "—";
}

/* ══ 周期：这一天它响不响 ═══════════════════════════════════════════
   runsOn() 返回**三态** true / false / "unknown"。

   不照抄 40-view-exam 里那个 bellHitsExamTime —— 它认不出就 return true，
   理由是「漏裁的代价 ≫ 多裁的代价」。**在查询工具里这个不对称是反的**：
   查询回答的是「这天会响什么」，多算一条就是谎报一条，人会照着这张表去关设备。
   所以认出来才给 true/false；认不出的**绝不猜**，不进结果表，只在收尾浮一句 toast。 */
/* 周期在两个地方是**带壳**回来的（[{id:…, repeat_weeks:1}] / [{id:…, dates:"…"}]），
   在定时任务身上又是裸数组。同一个解壳，两种形状都收。 */
function unShell(arr, key){
  return (arr || []).map(x => (x && x[key] != null) ? x[key] : x);
}
/* 铃声：周期不在自己身上，在 timing_bells_strategy_id 指向的那条策略里 */
function bellSchedule(b){
  const s = S.data.strategies.find(x=>Number(x.id)===Number(b.strategyId));
  if (!s) return null;                       /* 策略在服务器上找不到了 → 认不出 */
  return {
    timeType: Number(s.time_type),
    weeks: unShell(s.repeat_weeks, "repeat_weeks").map(Number),
    dates: unShell(s.assign_dates, "dates").map(String)
  };
}
/* 定时任务：周期自带，而且是裸数组（读回来带壳、写回去是裸的 —— 见 taskPayload） */
const taskSchedule = t => ({
  timeType: Number(t.timeType),
  weeks: (t.weeks||[]).map(Number),
  dates: (t.dates||[]).map(String)
});
function runsOn(sched, date){
  const tt = Number(sched && sched.timeType);
  if (tt === 0){
    /* 一周一天都没勾 = 排的时候就没打算让它响，和考试那边一个口径 */
    if (!(sched.weeks||[]).length) return false;
    return sched.weeks.indexOf(weekNumOf(date)) >= 0;
  }
  if (tt === 3) return (sched.dates||[]).indexOf(date) >= 0;
  return "unknown";          /* 1 按天重复 / 2 按日期区间 / 别的编号 */
}
/* 日期窗口：起止都可能是空串（服务器上确实有），空的那一头就不卡 */
function inWindow(date, start, end){
  const s = String(start||"").slice(0,10), e = String(end||"").slice(0,10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && date < s) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(e) && date > e) return false;
  return true;
}

/* ══ 区域命中 ═══════════════════════════════════════════════════════
   两边都可能是分组，所以两侧都展开成**点位名**再求交。分组展开靠 groupMembers
   （00-core）。它找不到那个组名时**静默返回空数组**，所以「原始分组名直接相交」
   那一条不能省 —— 少了它，一个名字对不上的分组会被判成完全不相干。 */
function termSetOf(area){
  const s = new Set(((area && area.t) || []).slice());
  ((area && area.g) || []).forEach(g => groupMembers(g).forEach(n=> s.add(n)));
  return s;
}
function areaHits(pick, area){
  const pk = {t:(pick&&pick.t)||[], g:(pick&&pick.g)||[]};
  if (!pk.t.length && !pk.g.length) return true;      /* 没选 = 这一项不参与筛选 */
  const pickTerms  = termSetOf(pk);
  const pickGroups = new Set(pk.g);
  const at = (area&&area.termNames)||[], ag = (area&&area.groupNames)||[];
  if (at.some(n=> pickTerms.has(n)))  return true;
  if (ag.some(n=> pickGroups.has(n))) return true;
  return ag.some(n=> groupMembers(n).some(t=> pickTerms.has(t)));
}

/* ══ 反查 ═══════════════════════════════════════════════════════════
   过滤写全两层：列表 isListEnabled **且** 这一条自己的 is_done 是 1。
   列表启用 ≠ 这条会响 —— 列表页把每条的启停渲染成行上的开关。

   **必须选终端才查**：没有「不选 = 查全部点位」这回事了。全点位那趟查询看着像
   全量，其实回答不了任何具体问题，而人很容易把它当成一次真实核对。

   结果区只回答一个问题：「查到了什么」。所以这一页**不留任何常驻交代行**
   （已跳过几张列表、另有几条没有区域、几条被停用……）—— 条数摆在「查询结果」
   那个副标题上，剩下的只有真出毛病时才浮一次 toast。

   S.tasks 切到这个页签时**不预取**：切个页签就发一趟请求不值，真要查了再拉。 */
async function runMoreQuery(){
  const st = moreState();
  if (st.busy) return;
  const pick = {t:(st.area.t||[]).slice(), g:(st.area.g||[]).slice()};
  if (!pick.t.length && !pick.g.length){
    toast("请选择至少一个终端进行查询", "err");
    return;
  }
  st.busy = true; st.done = false;
  st.hits = [];
  /* 点下去就在结果区写「正在查询…」，不等查完 —— 用户要的是「点了就去看结果」，
     让人盯着一个变灰的按钮等一趟请求，正是最没必要的那几秒。 */
  renderMain();

  const date = st.date;
  const noRead = [];                          /* 读不出来的列表 */
  let unknown = 0;                            /* 周期类型认不出的条数 */

  try{
    if (!S.tasks.length) await loadTasks();   /* 这一句末尾会重画整页 —— 状态在 S.dt 里，不怕 */

    /* 扫的是**全部已启用的列表**。考试期间启用着的那几张，正是考试模式当场另外建的一批
       （同一批原件那一刻是停用的），所以「考试时别的铃声」天生就在结果里 —— 只是来源列
       显示成 [全校日常] 这种去掉了后缀的名字（examOpLabel 干的）。**别在这儿加按名字
       跳过的闸**：一跳就只剩考试铃声了。 */
    for (const g of S.data.groups.filter(isListEnabled)){
      let rows;
      /* 一张列表读失败不该让整趟查询作废，记账走人就行 */
      try{ rows = await fetchBells(g.id); }
      catch(e){ noRead.push(examOpLabel(g.name)); continue; }

      /* 这张列表的分组名单也在这一把行里（一条不响的铃铛），名字尾巴上还挂着
         ¤分组名 —— grpAdoptRows 把名单摘掉、把尾巴切掉，和列表页看到的是同一份
         样子。别在这儿自己 map(normBell)：那样名单会当成一条铃铛、名字会带尾巴。 */
      grpAdoptRows(rows).bells.forEach(b=>{
        if (!inWindow(date, g.start_date, g.end_date)) return;
        const sc = bellSchedule(b);
        const hit = sc ? runsOn(sc, date) : "unknown";
        if (hit === "unknown"){ unknown++; return; }   /* 认不出的不猜，也不进表 */
        if (!hit) return;
        /* 没有执行区域的铃声不算命中：面板自己的列表页对它们挂的是红字
           「没有任何执行区域，到时间不会响」，查询要是把它们算进「会响」，
           就和同一页的横幅自相矛盾。 */
        if (isEmptyArea(b)) return;
        /* 这里**不能**写成 bellArea(b)：那个助手返回的是编辑器那一套 {t,g}，而
           areaHits 读的是 {termNames,groupNames}。形状不对，它两个数组都取到空，
           `at.some(...)`/`ag.some(...)` 全落空 —— 于是**只要选了终端/分组，
           铃声会被整批判掉，只剩定时任务**（定时任务那支传的就是下面这个形状，
           所以它一直是对的）。形状对齐是这一页唯一的失分点，别再改回去。 */
        if (!areaHits(pick, {termNames:b.termNames, groupNames:b.groupNames})) return;
        if (Number(b.isDone) !== 1) return;            /* 这一条自己被停用了 */
        b.times.forEach(tm => st.hits.push({
          time: tm, name: b.name, src: examOpLabel(g.name),
          media: moreMediaText(b),
          period: strategyName(b.strategyId), periodTip: morePeriodText(sc)
        }));
      });
    }

    (S.tasks||[]).forEach(t=>{
      if (!inWindow(date, t.startDate, t.endDate)) return;
      const ts = taskSchedule(t);
      const hit = runsOn(ts, date);
      if (hit === "unknown"){ unknown++; return; }
      if (!hit) return;
      if (!t.termNames.length && !t.groupNames.length) return;   /* 同上：没区域 = 不响 */
      if (!areaHits(pick, {termNames:t.termNames, groupNames:t.groupNames})) return;
      if (Number(t.isDone) !== 1) return;
      t.times.forEach(tm => st.hits.push({
        time: tm, name: t.name, src: "定时任务",
        media: moreMediaText(t),
        period: TASK_TT_NAME[ts.timeType] || ("类型 "+ts.timeType),
        periodTip: taskWhen(t)
      }));
    });

    st.hits.sort((a,b)=> hmsToSec(a.time) - hmsToSec(b.time));
    st.done = true;
  }catch(e){
    st.busy = false;
    renderMain();
    toast((e && e.message) || "查询失败", "err");
    return;
  }
  st.busy = false;
  renderMain();
  /* 出了毛病才浮一次，正常一趟一个字都不说 —— 条数在「查询结果」的副标题上。 */
  if (noRead.length) toast("有 "+noRead.length+" 张列表没读出来："+noRead.join("、"), "err");
  else if (unknown)  toast("有 "+unknown+" 条用的周期类型本面板还认不出，没有列进来", "warn");
}

/* ══ 结果 ═══════════════════════════════════════════════════════════
   来源列一律走 examOpLabel()（40-view-exam）—— 它是全项目唯一允许拼列表标签的
   地方，保证不出现服务器上那些内部名。列表名**绝不能直接印**。 */
const nowSec = ()=>{ const d = new Date(); return d.getHours()*3600 + d.getMinutes()*60 + d.getSeconds(); };
function moreResultsHTML(){
  const st = moreState();
  /* 只有查今天才谈得上「过点了」。查别的日期时这一列全是普通行 —— 拿今天
     的钟点去灰别人那天的安排，是纯粹的错。 */
  const today = st.date === todayISO();
  /* 五列**列列都给宽度**（`.tbl-more` 在 CSS 里是 table-layout:fixed）。
     不给宽度的列是 auto，浏览器按内容分 —— 真机上音源名一长（「轻音乐 - 一剪梅.mp3」
     这种），名称和音源两列就把右边几列挤成一条缝。定死不等于丢信息：
     长的那几格省略号截断，全文挂在 title 上，鼠标停一下就看全。
     宽度本身写在 CSS 的 `.tbl-more .c-*` 里，**不写行内** —— 竖屏那一档要单独改
     「来源」「周期」两列（把省下的宽度让给名称），行内样式只输给 !important。
     和 `.tbl-bells .c-act` 一个道理。 */
  return '<div class="tbl-wrap"><table class="tbl tbl-more"><thead><tr>'+
      '<th class="c-time">时刻</th><th class="c-name">名称</th>'+
      '<th class="c-src">来源</th><th class="c-media">音源</th>'+
      '<th class="c-period">周期</th>'+
    '</tr></thead><tbody>'+
    st.hits.map(h=>
      '<tr'+((today && hmsToSec(h.time) < nowSec()) ? ' class="past"' : '')+'>'+
        '<td class="mono">'+esc(hm(h.time))+'</td>'+
        '<td title="'+esc(h.name)+'">'+esc(h.name)+'</td>'+
        '<td title="'+esc(h.src)+'">'+esc(h.src)+'</td>'+
        '<td title="'+esc(h.media)+'">'+esc(h.media)+'</td>'+
        '<td title="'+esc("执行周期："+h.periodTip)+'">'+esc(h.period)+'</td>'+
      '</tr>').join("")+
    '</tbody></table></div>';
}
/* 结果那张表外面套的壳。**必须是 `.panel.grow` 且 `.tbl-wrap` 直接当它的孩子** ——
   `table.tbl th` 在基线里就是 `position:sticky;top:0`，而 sticky 只认**最近的那个
   滚动容器**：`.tbl-wrap` 只有真去滚的时候才是它（`.panel.grow > .tbl-wrap`
   {flex:1;min-height:0;overflow:auto}）。搁在别处，它只是个 overflow-x:auto 的
   裁剪框，题头于是跟着行一起滚走 —— 用户实测报的就是这个。
   中间**不能垫 .panel-body**：多一层它就不是直接孩子，那条选择器当场落空。
   哪一天要给它加内边距，加在 .tbl-wrap 上，别加出一层来。 */
function moreResultsBoxHTML(st){
  return '<div class="panel grow">'+
    '<div class="panel-head"><h3>查询结果</h3>'+
      '<span class="sub">'+esc(moreAskedText(st))+' · '+esc(moreCountText(st))+'</span></div>'+
    moreResultsHTML()+
  '</div>';
}

/* 条数那一行。用户定的位置：就摆在「查询结果」旁边当副标题。
   moreAskedText —— 这一趟问的是什么（哪天、哪些终端）。表本身回答不了这个，
   而这张表是会被截图发出去的，回头得看得出是哪天的哪几个点。 */
const moreCountText = st => "共 "+st.hits.length+" 条，按时刻排序";
const moreAskedText = st => st.date + " · " + moreAreaText(st.area);
/* 一条都没查到时的那句话。**这不是「交代」**（已查几张列表、跳过几张……那些
   全删了），它是这一趟查询的**答案**：这一天不响。 */
const MORE_EMPTY = "这一天没有会执行的铃声或定时任务";

/* 日期或终端一改，上一次那张表就不再对应问题了 —— 直接退回「还没查」，
   不留一张对不上的结果让人照着它去关设备。
   （调用点本来就紧跟一句 renderMore()，这里只管清状态。） */
function moreInvalidate(){
  const st = moreState();
  if (st.busy) return;
  st.done = false;
  st.hits = [];
}

/* ══ 页面 ═══════════════════════════════════════════════════════════
   首页是卡片入口；子页都是 `.main-inner.fill`：标题固定、工具条固定，
   下面那份名单吃剩余高度并自己滚。 */
function renderMore(){
  const el = $("#main"); if (!el) return;
  const st = moreState();
  if (st.tab === "lookup") return renderMoreLookup(el, st);
  if (st.tab === "test")   return renderMoreTest(el, moreTestState());
  return renderMoreHome(el);
}

/* 换子页。离开终端测试就当场停止播放（用户定的：不留在后台响）。 */
function moreGo(tab){
  if (tab !== "test") moreTestStop(true);
  moreState().tab = tab;
  renderAll();
}
/* 「‹ 返回」的唯一出口：两个子页顶栏和页内那枚都走这儿。 */
function moreBackHome(){ moreGo("home"); }

/* 子页共用的标题行。返回键只在宽屏出现（窄屏顶栏已经有一枚 #tbBack，
   见 30-view-list.js 的 showBack）。 */
function moreHeadHTML(title){
  return '<div class="sec-head">'+
    '<div class="title-row">'+
      '<button class="btn btn-icon more-back" id="moreBack" type="button" '+
        'title="返回更多功能" aria-label="返回更多功能">'+ICON.chevL+'</button>'+
      '<h2 class="serif">'+esc(title)+'</h2>'+
    '</div>'+
  '</div>';
}
function bindMoreHead(el){
  const b = el.querySelector("#moreBack");
  if (b) b.onclick = moreBackHome;
}

/* ── 首页：卡片 ──────────────────────────────────────────────────── */
function renderMoreHome(el){
  el.classList.add("headfix");
  el.innerHTML =
    '<div class="sec-head">'+
      '<div class="title-row"><h2 class="serif">更多功能</h2></div>'+
    '</div>'+
    '<div class="page-body more-page">'+
      '<div class="mod-grid">'+
        '<button class="mod-card" type="button" data-mod="lookup">'+
          '<span class="mod-ic">'+ICON.search+'</span>'+
          '<span class="mod-tx"><span class="n">任务反查</span>'+
            '<span class="d">查询某一天哪些铃声和定时任务会执行</span></span>'+
          '<span class="mod-go">'+ICON.chevR+'</span>'+
        '</button>'+
        '<button class="mod-card" type="button" data-mod="test">'+
          '<span class="mod-ic">'+ICON.volume+'</span>'+
          '<span class="mod-tx"><span class="n">终端测试</span>'+
            '<span class="d">向选中的终端播放音频并检查实时状态</span></span>'+
          '<span class="mod-go">'+ICON.chevR+'</span>'+
        '</button>'+
      '</div>'+
    '</div>';
  $$("[data-mod]", el).forEach(b => b.onclick = ()=> moreGo(b.dataset.mod));
}

/* ── 媒体管理（独立页，S.mode === "media"）───────────────────────────
   两套排版，按拿法选：

     · 横屏 / 宽屏 —— 左栏是媒体库（含「全部媒体库」），右栏是选中的那个库里的
       音频。骨架和「铃声计划」的 .wb 一模一样（226px + 18px 的缝），只是换了
       一个类名 .mm-wb：.wb 在 ≤980px 会被折成单栏，而这里横屏（连手机横过来
       也算）就要两栏。
     · 竖屏（手机竖着拿）—— 一条页签 + 搜索，单栏，页面高度自己吃满。

   数据就是挑音源弹窗用的那一份缓存（S.data.medias / mediaGroups）—— 这里改完
   以后 refreshMediaLib() 把它换成服务器上的最新一份，挑音源那边跟着就新了。
   所有写操作都**即时落服务器**，不进草稿队列（那套只管铃声和任务排程）。 */
function renderMedia(){
  const el = $("#main"); if (!el) return;
  const m = mediaState();
  const groups = sortedMediaGroups();
  /* 音频照服务器给的次序 —— 就是上传顺序，后传的在最下面（原版面板也这样）。
     这里以前按名字排，翻出来的次序和「什么时候传的」对不上。 */
  const files = S.data.medias.slice();
  /* 筛着的那个库被删掉了（或者第一次进来），退回「全部」。 */
  if (m.g !== "all" && !groups.some(g=> String(g.id)===String(m.g))) m.g = "all";
  const gName = id => {
    const g = groups.find(x=> String(x.id)===String(id));
    return g ? g.name : "未分组";
  };
  const gCount = id => files.filter(x=> String(x.medias_groups_id)===String(id)).length;
  const dur = x => secToHMS(Number(x.length)||0).slice(3);
  /* 刷新媒体信息：重拉音频和媒体库两份缓存（见 refreshMediaLib），回来重画这一页。
     两套版式各有一枚刷新键 —— 宽屏在侧栏底部「新建媒体库」右边，竖屏在标题栏
     那排按钮的最右边 —— 走的是同一条路。拉到一半人已经切走的话就不再重画
     （renderMain 会去画当前那一页）。 */
  const reloadMedia = async (btn)=>{
    if (btn.disabled) return;
    btn.disabled = true;
    const ok = await refreshMediaLib();
    btn.disabled = false;
    if (!ok){ toast("刷新失败，请检查网络后重试", "err"); return; }
    if (S.mode === "media") renderMain();
    toast("媒体信息已刷新", "ok");
  };

  /* ── 横屏 / 宽屏：左边侧栏 + 右边音频 ──────────────────────────── */
  if (!isPortraitNarrow()){
    el.classList.add("pane");
    const selGroup = groups.find(g=> String(g.id)===String(m.g)) || null;
    const railRow = (id, name, n, on) =>
      '<button type="button" class="rail-item'+(on?" on":"")+'" data-g="'+esc(id)+'">'+
        '<span class="rail-pick">'+
          '<span class="r1"><span class="nm" title="'+esc(name)+'">'+esc(name)+'</span></span>'+
          '<span class="r2">'+n+' 个音源</span>'+
        '</span>'+
      '</button>';
    const visibleFiles = ()=>{
      let list = files;
      if (m.g !== "all") list = list.filter(x=> String(x.medias_groups_id)===String(m.g));
      const q = m.q.trim().toLowerCase();
      if (q) list = list.filter(x=> String(x.name).toLowerCase().indexOf(q)>=0);
      return list;
    };
    /* 一行音频：左边一格勾选框（整行点哪儿都能勾，和铃声表一个手势），
       右边「下载 + 垃圾桶」。竖屏上这两枚收进「⋯」（css 换的，DOM 里一直都有）。 */
    const fileRow = x => {
      const id = String(x.id), on = m.sel.has(id);
      return '<div class="pick-row mm-file'+(on?" sel":"")+'" data-mid="'+esc(id)+'">'+
        '<input type="checkbox" class="mm-selbox"'+(on?" checked":"")+' aria-label="选择「'+esc(x.name)+'」">'+
        '<span class="nm" title="'+esc(x.name)+'">'+esc(x.name)+'</span>'+
        '<span class="ip">'+esc(gName(x.medias_groups_id))+' · '+dur(x)+'</span>'+
        '<span class="rowacts">'+
          '<button type="button" class="ric mm-dl" data-dl="'+esc(x.id)+'" title="下载音频" aria-label="下载">'+ICON.download+'</button>'+
          '<button type="button" class="ric danger mm-del" data-del="'+esc(x.id)+'" title="删除音频" aria-label="删除">'+ICON.del+'</button>'+
          '<button type="button" class="ric mm-more" data-more="'+esc(x.id)+'" title="更多操作" aria-label="更多操作">'+ICON.dots+'</button>'+
        '</span>'+
      '</div>';
    };
    const listHTML = ()=>{
      const rows = visibleFiles().map(fileRow).join("");
      return rows || '<div class="hint mm-empty">'+
        (files.length ? "没有匹配的音频文件" : "服务器上还没有音频文件")+'</div>';
    };

    el.innerHTML =
      '<div class="mm-wb">'+
        '<aside class="rail">'+
          '<div class="rail-head">媒体库 · '+groups.length+'</div>'+
          '<div class="rail-list" id="mmRail">'+
            railRow("all", "全部媒体库", files.length, m.g === "all")+
            groups.map(g=> railRow(String(g.id), g.name, gCount(g.id), String(m.g)===String(g.id))).join("")+
          '</div>'+
          '<div class="rail-foot">'+
            /* 和铃声计划那一排同一个摆法：「新建媒体库」占着 flex:1，刷新只剩
               一个图标、被顶到最右端（用户定的）。 */
            '<button class="btn" id="mmNewGrp" style="flex:1;justify-content:center">'+ICON.plus+' 新建媒体库</button>'+
            '<button class="btn btn-quiet btn-icon" id="mmReload" title="刷新媒体信息" aria-label="刷新媒体信息">'+ICON.refresh+'</button>'+
          '</div>'+
        '</aside>'+
        '<div class="wb-main">'+
          '<div class="sec-head">'+
            '<div class="sec-title">'+
              '<div class="title-row">'+
                '<h2 class="serif">'+esc(selGroup ? selGroup.name : "全部媒体库")+'</h2>'+
                (selGroup && !isPinnedLib(selGroup)
                  ? '<span class="acts">'+
                      '<button class="btn btn-icon" id="mmRenGroup" title="重命名媒体库" aria-label="重命名媒体库">'+ICON.edit+'</button>'+
                      '<button class="btn btn-icon btn-danger" id="mmDelGroup" title="删除媒体库" aria-label="删除媒体库">'+ICON.del+'</button>'+
                    '</span>'
                  : "")+
              '</div>'+
            '</div>'+
          '</div>'+
          '<div class="page-body">'+
            '<div class="panel grow">'+
              '<div class="panel-head">'+
                '<h3>音频文件</h3><span class="sub" id="mmCount"></span>'+
                /* 一栏两态（照铃声计划那一套）：没勾选时是筛选 + 上传音频，
                   勾选之后原地换成「N 条已选 + 垃圾桶」，这一行高度不变。 */
                '<span class="acts mm-acts">'+
                  '<span class="hd-seg" id="mmNormal">'+
                    /* 左栏已经替掉了「按库筛选」那个下拉，这里只留搜索。
                       上传键挪到搜索框后面（用户定的）：它往的就是「这个库」，
                       挨着筛选那一片比挂在高处更顺手。两样都是 28px 高，
                       这一行（表头）才不会被撑高；上传键用重点色。 */
                    '<span class="pick-search mm-find">'+
                      '<span class="sbox sbox-sm">'+ICON.search+
                        '<input class="input" id="mmQ" placeholder="搜索音频文件" value="'+esc(m.q)+'" spellcheck="false" autocomplete="off">'+
                      '</span>'+
                    '</span>'+
                    '<button class="btn btn-sm mm-up" id="mmUpload">'+ICON.plus+' 上传音频</button>'+
                  '</span>'+
                  '<span class="hd-seg" id="mmBulk" hidden></span>'+
                '</span>'+
              '</div>'+
              /* 列表自己的题头：全选那一格。挂在滚动区外面，列表怎么滚它都不动。 */
              '<div class="mm-selhead" id="mmSelHead">'+
                '<label class="chk"><input type="checkbox" id="mmAll"><span>全选</span></label>'+
                '<span class="mm-seln" id="mmSelN"></span>'+
              '</div>'+
              '<div class="mm-list" id="mmList">'+listHTML()+'</div>'+
            '</div>'+
          '</div>'+
        '</div>'+
      '</div>';

    const paintWide = ()=>{
      const inList = visibleFiles();
      if ($("#mmCount")) $("#mmCount").textContent = inList.length+" 条";
      if ($("#mmList")) $("#mmList").innerHTML = listHTML();
      const n = m.sel.size;
      const norm = $("#mmNormal"), bulk = $("#mmBulk");
      if (norm) norm.hidden = n > 0;
      if (bulk){
        bulk.hidden = n === 0;
        bulk.innerHTML = n
          ? '<span class="bulk-n">'+n+'</span><span class="dimmer">条已选</span>'+
            '<button type="button" class="btn btn-icon btn-danger" data-bulkdel title="删除这些音频" aria-label="删除">'+ICON.del+'</button>'
          : "";
      }
      const all = $("#mmAll");
      if (all){
        /* 全选勾的是**当前列出来的这一批**（搜索筛过也算），和铃声表同一个口径。 */
        const k = inList.filter(x=> m.sel.has(String(x.id))).length;
        all.checked = inList.length > 0 && k === inList.length;
        all.indeterminate = k > 0 && k < inList.length;
      }
      const sn = $("#mmSelN");
      if (sn) sn.textContent = n ? "已选 "+n+" 条" : "";
    };
    paintWide();

    $("#mmRail").onclick = e=>{
      const b = e.target.closest("[data-g]"); if (!b) return;
      if (String(m.g) === String(b.dataset.g)) return;
      m.g = b.dataset.g;
      m.sel.clear();
      renderMain();
    };
    $("#mmQ").oninput = e=>{ m.q = e.target.value; paintWide(); };
    $("#mmAll").onchange = e=>{
      if (e.target.checked) visibleFiles().forEach(x=> m.sel.add(String(x.id)));
      else m.sel.clear();
      paintWide();
    };
    el.querySelector(".mm-acts").onclick = e=>{
      if (e.target.closest("[data-bulkdel]")) mediaBulkDelete(Array.from(m.sel));
    };
    $("#mmNewGrp").onclick = ()=> openMediaGroupEdit(null);
    $("#mmReload").onclick = ()=> reloadMedia($("#mmReload"));
    $("#mmUpload").onclick = ()=> openMediaUpload(m.g);
    if (selGroup && !isPinnedLib(selGroup)){
      $("#mmRenGroup").onclick = ()=> openMediaGroupEdit(selGroup);
      $("#mmDelGroup").onclick = ()=> deleteMediaGroup(selGroup.id);
    }
    $("#mmList").onclick = e=>{
      const dl = e.target.closest("[data-dl]");
      if (dl){
        const x = files.find(v=> String(v.id)===String(dl.dataset.dl));
        if (x) downloadMediaFile(x);
        return;
      }
      const mo = e.target.closest("[data-more]");
      if (mo){
        const x = files.find(v=> String(v.id)===String(mo.dataset.more)); if (!x) return;
        openRowMenu(mo, [
          { icon:ICON.download, label:"下载", onPick:()=> downloadMediaFile(x) },
          { icon:ICON.del, label:"删除", danger:true, onPick:()=> deleteMediaFile(x.id) },
        ]);
        return;
      }
      const d = e.target.closest("[data-del]");
      if (d){ deleteMediaFile(d.dataset.del); return; }
      const row = e.target.closest(".mm-file"); if (!row) return;
      const id = String(row.dataset.mid);
      const on = e.target.classList.contains("mm-selbox") ? e.target.checked : !m.sel.has(id);
      if (on) m.sel.add(id); else m.sel.delete(id);
      paintWide();
    };
    return;
  }

  /* ── 竖屏：页签 + 搜索，单栏 ─────────────────────────────────────── */
  el.classList.add("fill");
  el.innerHTML =
    '<div class="sec-head">'+
      '<div class="title-row"><h2 class="serif">媒体管理</h2></div>'+
      /* 刷新站在**页面标题栏**的最右边（用户定的），是枚无边框图标键：
         控件组标题栏那边留给「新建媒体库 / 上传音频」这两个跟着页签走的动作，
         刷新跟页签无关、两页都该有，就提到页标题这一行来。
         .sec-head > .acts 自带 margin-left:auto，这一格自然贴右。 */
      '<span class="acts">'+
        '<button class="btn btn-sm btn-quiet btn-icon" id="mmReload" title="刷新媒体信息" aria-label="刷新媒体信息">'+ICON.refresh+'</button>'+
      '</span>'+
    '</div>'+
    '<div class="panel grow">'+
      '<div class="panel-head">'+
        '<h3>服务器媒体</h3><span class="sub" id="mmSub"></span>'+
        '<span class="acts">'+
          /* 两枚按钮跟着页签露：音频页只能上传，媒体库页只能新建 —— 同时摆着
             既挤，也容易对着「媒体库」页点「上传音频」却不知道传进哪个库。 */
          '<button class="btn btn-sm" id="mmNewGrp" hidden>'+ICON.plus+' 新建媒体库</button>'+
          '<button class="btn btn-sm" id="mmUpload" hidden>'+ICON.plus+' 上传音频</button>'+
        '</span>'+
      '</div>'+
      '<div class="mm-bar">'+
        '<div class="tabbar" id="mmTabs">'+
          '<button type="button" data-t="file">媒体 · 0</button>'+
          '<button type="button" data-t="dir">媒体库 · 0</button>'+
        '</div>'+
        '<div class="pick-search" id="mmSearch">'+
          '<span class="sbox">'+ICON.search+
            '<input class="input" id="mmQ" placeholder="搜索音频文件" value="'+esc(m.q)+'" spellcheck="false" autocomplete="off">'+
          '</span>'+
          '<select class="select" id="mmG">'+
            '<option value="all">全部媒体库</option>'+
            groups.map(g=>'<option value="'+esc(g.id)+'"'+(String(m.g)===String(g.id)?" selected":"")+'>'+esc(g.name)+'</option>').join("")+
          '</select>'+
        '</div>'+
      '</div>'+
      /* 列表题头：全选那一格。在滚动区外面，列表怎么滚它都钉着。 */
      '<div class="mm-selhead" id="mmSelHead">'+
        '<label class="chk"><input type="checkbox" id="mmAll"><span>全选</span></label>'+
        '<span class="mm-seln" id="mmSelN"></span>'+
      '</div>'+
      '<div class="mm-list" id="mmList"></div>'+
    '</div>';

  const fileRow = x => {
    const id = String(x.id), on = m.sel.has(id);
    return '<div class="pick-row mm-file'+(on?" sel":"")+'" data-mid="'+esc(id)+'">'+
      '<input type="checkbox" class="mm-selbox"'+(on?" checked":"")+' aria-label="选择「'+esc(x.name)+'」">'+
      '<span class="nm" title="'+esc(x.name)+'">'+esc(x.name)+'</span>'+
      '<span class="ip">'+esc(gName(x.medias_groups_id))+' · '+dur(x)+'</span>'+
      '<span class="rowacts">'+
        '<button type="button" class="ric mm-dl" data-dl="'+esc(x.id)+'" title="下载音频" aria-label="下载">'+ICON.download+'</button>'+
        '<button type="button" class="ric danger mm-del" data-del="'+esc(x.id)+'" title="删除音频" aria-label="删除">'+ICON.del+'</button>'+
        '<button type="button" class="ric mm-more" data-more="'+esc(x.id)+'" title="更多操作" aria-label="更多操作">'+ICON.dots+'</button>'+
      '</span>'+
    '</div>';
  };

  const paint = ()=>{
    if (!$("#mmTabs")) return;
    const tb = id => $("#mmTabs button[data-t='"+id+"']");
    tb("file").textContent = "媒体 · "+files.length;
    tb("dir").textContent  = "媒体库 · "+groups.length;
    $$("#mmTabs button").forEach(b=> b.classList.toggle("on", b.dataset.t===m.tab));
    const n = m.sel.size;
    const up = $("#mmUpload");
    up.hidden = m.tab !== "file";
    $("#mmNewGrp").hidden = m.tab !== "dir";
    /* 竖屏选中音频之后：搜索框和库下拉锁住，顶栏那枚上传键原地变成「删除已选」。 */
    if (m.tab === "file"){
      up.innerHTML = n ? ICON.del+" 删除已选" : ICON.plus+" 上传音频";
      /* 上传是普通色按钮（用户定的）：这一页的主色留给真正「主操作」的地方，
         上传只是媒体页里的一个日常动作。选中音频时那枚仍旧变红（删除）。 */
      up.classList.toggle("btn-danger", n > 0);
    }
    $("#mmQ").disabled = n > 0;
    $("#mmG").disabled = n > 0;
    $("#mmSearch").style.display = m.tab === "file" ? "" : "none";
    $("#mmSelHead").hidden = m.tab !== "file";
    $("#mmSub").textContent = files.length+" 个音频 · "+groups.length+" 个媒体库";

    let rows;
    if (m.tab === "file"){
      let list = files;
      if (m.g !== "all") list = list.filter(x=> String(x.medias_groups_id)===String(m.g));
      const q = m.q.trim().toLowerCase();
      if (q) list = list.filter(x=> String(x.name).toLowerCase().indexOf(q)>=0);
      rows = list.map(fileRow).join("");
      if (!rows) rows = '<div class="hint mm-empty">'+
        (files.length ? "没有匹配的音频文件" : "服务器上还没有音频文件")+'</div>';
      const k = list.filter(x=> m.sel.has(String(x.id))).length;
      const all = $("#mmAll");
      all.checked = list.length > 0 && k === list.length;
      all.indeterminate = k > 0 && k < list.length;
    } else {
      rows = groups.map(g=>
        '<div class="pick-row">'+
          '<span class="nm" title="'+esc(g.name)+'">'+esc(g.name)+'</span>'+
          '<span class="ip">'+gCount(g.id)+' 个音源</span>'+
          /* 服务器自带的两个库没有改名 / 删除这两枚。 */
          '<span class="rowacts">'+
            (isPinnedLib(g) ? "" :
              '<button type="button" class="ric" data-ren="'+esc(g.id)+'" title="重命名" aria-label="重命名">'+ICON.edit+'</button>'+
              '<button type="button" class="ric danger" data-delg="'+esc(g.id)+'" title="删除媒体库" aria-label="删除">'+ICON.del+'</button>')+
          '</span>'+
        '</div>').join("");
      if (!rows) rows = '<div class="hint mm-empty">服务器上还没有媒体库，点右上角「新建媒体库」建一个。</div>';
      $("#mmAll").checked = false;
      $("#mmAll").indeterminate = false;
    }
    $("#mmSelN").textContent = n ? "已选 "+n+" 条" : "";
    $("#mmList").innerHTML = rows;
  };

  $("#mmTabs").onclick = e=>{
    const b = e.target.closest("[data-t]"); if (!b) return;
    if (m.tab !== b.dataset.t) m.sel.clear();
    m.tab = b.dataset.t; paint();
  };
  $("#mmQ").oninput = e=>{ m.q = e.target.value; paint(); };
  $("#mmG").onchange = e=>{ m.g = e.target.value; m.sel.clear(); paint(); };
  $("#mmAll").onchange = e=>{
    let list = files;
    if (m.g !== "all") list = list.filter(x=> String(x.medias_groups_id)===String(m.g));
    const q = m.q.trim().toLowerCase();
    if (q) list = list.filter(x=> String(x.name).toLowerCase().indexOf(q)>=0);
    if (e.target.checked) list.forEach(x=> m.sel.add(String(x.id)));
    else m.sel.clear();
    paint();
  };
  $("#mmNewGrp").onclick = ()=> openMediaGroupEdit(null);
  $("#mmReload").onclick = ()=> reloadMedia($("#mmReload"));
  $("#mmUpload").onclick = ()=> m.sel.size
    ? mediaBulkDelete(Array.from(m.sel))
    : openMediaUpload(m.g);
  $("#mmList").onclick = e=>{
    const dl = e.target.closest("[data-dl]");
    if (dl){
      const x = files.find(v=> String(v.id)===String(dl.dataset.dl));
      if (x) downloadMediaFile(x);
      return;
    }
    const mo = e.target.closest("[data-more]");
    if (mo){
      const x = files.find(v=> String(v.id)===String(mo.dataset.more)); if (!x) return;
      openRowMenu(mo, [
        { icon:ICON.download, label:"下载", onPick:()=> downloadMediaFile(x) },
        { icon:ICON.del, label:"删除", danger:true, onPick:()=> deleteMediaFile(x.id) },
      ]);
      return;
    }
    const d = e.target.closest("[data-del]"),
          r = e.target.closest("[data-ren]"),
          g = e.target.closest("[data-delg]");
    if (d) return deleteMediaFile(d.dataset.del);
    if (r) { const it = groups.find(x=> String(x.id)===String(r.dataset.ren)); if (it) openMediaGroupEdit(it); return; }
    if (g) return deleteMediaGroup(g.dataset.delg);
    const row = e.target.closest(".mm-file"); if (!row) return;
    const id = String(row.dataset.mid);
    const on = e.target.classList.contains("mm-selbox") ? e.target.checked : !m.sel.has(id);
    if (on) m.sel.add(id); else m.sel.delete(id);
    paint();
  };
  paint();
}

/* 媒体管理有两套 DOM（横屏两栏 / 竖屏页签），用哪套是 JS 在画的时候定的 ——
   转屏后 css 换得过来，DOM 换不过来，得重画一次。只在跨过那条判据时响。 */
(function(){
  const mq = window.matchMedia("(max-width:980px) and (orientation:portrait)");
  const onMQ = ()=>{
    if (S.mode === "media") renderMain();
  };
  if (mq.addEventListener) mq.addEventListener("change", onMQ);
  else if (mq.addListener) mq.addListener(onMQ);   /* 老 WebKit */
})();

/* 写媒体库/音频的公共壳：挂上「正在写入服务器」的挡板，失败把服务器那句话说出来。
   成功与否交回布尔值 —— 调用方要接着做刷新和收尾。上传走自己的进度状态，不套这个。 */
async function mediaWrite(fn){
  const token = busyOn();
  try{ await fn(); return true; }
  catch(e){ toast(e && e.message ? e.message : "操作失败", "err"); return false; }
  finally{ busyOff(token); }
}

function deleteMediaFile(id){
  const x = S.data.medias.find(v=> String(v.id)===String(id));
  if (!x) return;
  openConfirm("删除音频「"+x.name+"」",
    "删除后引用这个文件的铃声将无法播放，且无法撤销。",
    async ()=>{
      const ok = await mediaWrite(()=> api("DELETE","/medias/"+x.id,{body:{ids:[x.id]}}));
      if (!ok) return;
      if (S.dt.media && S.dt.media.sel) S.dt.media.sel.delete(String(x.id));
      await refreshMediaLib();
      renderMain();
      toast("已删除「"+x.name+"」", "ok");
    }, "删除", true);
}

/* 下载地址：和「终端测试」取音源同一个接口，token 只在运行时拼进 URL。 */
function mediaDownloadURL(x){
  return BASE() + "/medias/download/" + encodeURIComponent(x.id) +
         "?authorization=" + encodeURIComponent(S.token || "");
}
/* 落盘用的文件名：服务器上那份没带扩展名的，补一个 .mp3。 */
function mediaFileName(x){
  const n = String(x.name || ("media-" + x.id));
  return /\.mp3$/i.test(n) ? n : n + ".mp3";
}
/* 下载到本地。两条路，分岔的原因在 WKWebView：

   · App 里 —— 直接跳那个服务器地址。宿主装了 WKDownload，带 download 的跳转
     会被它接住，存进「文件」App 里本应用的目录；而 blob: 在 WKWebView 里一直
     不可靠（有时干脆被当成导航，把面板顶掉），不能走那条。
   · 浏览器里 —— 跨域链接上的 download 属性会被忽略，Chrome 会当场导航过去放歌，
     面板就没了。所以先 fetch 回来，再从同源的 blob: 地址下载，文件名才留得住。 */
function downloadMediaFile(x){
  const fire = u=>{
    const a = document.createElement("a");
    a.href = u;
    a.download = mediaFileName(x);
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return a;
  };
  if (IS_APP){ fire(mediaDownloadURL(x)); return; }
  fetch(mediaDownloadURL(x))
    .then(r=>{ if (!r.ok) throw new Error("HTTP "+r.status); return r.blob(); })
    .then(b=>{
      const u = URL.createObjectURL(b);
      fire(u);
      setTimeout(()=> URL.revokeObjectURL(u), 10000);   /* 立刻撤销会抢在保存前面 */
    })
    .catch(e=> toast("下载失败："+((e && e.message) || "请重试"), "err"));
}
/* 批量删除：一次一次发（接口是单条的），全部成功才报喜。
   失败时前面删掉的可能已经落地了，照旧刷一遍列表，别让界面跟服务器对不上。 */
function mediaBulkDelete(ids){
  const list = S.data.medias.filter(v=> ids.some(id=> String(id)===String(v.id)));
  if (!list.length) return;
  openConfirm("删除 "+list.length+" 个音频",
    "删除后引用这些文件的铃声将无法播放，且无法撤销。",
    async ()=>{
      mSelClear();
      const ok = await mediaWrite(async ()=>{
        for (const x of list) await api("DELETE","/medias/"+x.id,{body:{ids:[x.id]}});
      });
      await refreshMediaLib();
      renderMain();
      if (ok) toast("已删除 "+list.length+" 个音频", "ok");
    }, "删除", true);
}
function mSelClear(){
  if (S.dt.media && S.dt.media.sel) S.dt.media.sel.clear();
}

function deleteMediaGroup(id){
  const g = S.data.mediaGroups.find(v=> String(v.id)===String(id));
  if (!g) return;
  openConfirm("删除媒体库「"+g.name+"」",
    "删除媒体库也将删除其中所有音频，且无法撤销。",
    async ()=>{
      const ok = await mediaWrite(()=> api("DELETE","/medias-groups/"+g.id,{body:{ids:[g.id]}}));
      if (!ok) return;
      await refreshMediaLib();
      renderMain();
      toast("已删除媒体库「"+g.name+"」", "ok");
    }, "删除", true);
}

/* 新建 / 重命名媒体库。PUT 要把 name 之外的两格原样带回去（服务器要整份），
   旧那份里没有就给默认值：type 0、公开。 */
function openMediaGroupEdit(g){
  const isNew = !g;
  openModal({
    title: isNew ? "新建媒体库" : "重命名媒体库",
    sub: isNew ? "媒体库就是一组音频文件，挑音源时按它筛选" : g.name,
    width:"420px",
    mount(b, f, mm){
      b.innerHTML =
        '<div class="field"><label for="mgName">名称</label>'+
          '<input class="input" id="mgName" maxlength="20" autocomplete="off" '+
            'value="'+esc(isNew ? "" : g.name)+'"></div>';
      f.innerHTML = '<span class="spacer"></span><button class="btn" data-cancel>取消</button>'+
        '<button class="btn btn-primary" data-ok>'+(isNew ? "新建" : "保存")+'</button>';
      f.querySelector("[data-cancel]").onclick = ()=> closeModal(mm.id);
      const inp = b.querySelector("#mgName");
      inp.focus(); inp.select();
      const go = async ()=>{
        const name = inp.value.trim();
        if (!name){ inp.focus(); toast("请填写媒体库名称", "err"); return; }
        const ok = await mediaWrite(()=> isNew
          ? api("POST","/medias-groups",{body:{name:name, type:0, is_public:1}})
          : api("PUT","/medias-groups/"+g.id,{body:{
              name:name,
              type: g.type == null ? 0 : g.type,
              is_public: g.is_public == null ? 1 : g.is_public
            }}));
        if (!ok) return;
        closeModal(mm.id);
        await refreshMediaLib();
        renderMain();
        toast(isNew ? "已新建媒体库「"+name+"」" : "媒体库已改名为「"+name+"」", "ok");
      };
      f.querySelector("[data-ok]").onclick = go;
      inp.onkeydown = e=>{ if (e.key === "Enter") go(); };
    }
  });
}

/* 上传音频：先选媒体库，再选本机文件。正在浏览某个具体媒体库时，弹窗里就默认
   选中它（少按一下）；停在「全部媒体库」上时**默认什么都不选**（用户定的）——
   那是「还没决定往哪个库传」，替人挑第一个库只会传错地方。 */
function openMediaUpload(preferGid){
  if (!S.data.mediaGroups.length){ toast("还没有媒体库，先新建一个", "err"); return; }
  const groups = sortedMediaGroups();
  /* 只有确实指着某一个库时才预选；"all"（和任何对不上的值）一律留空。 */
  const prefer = groups.some(g=> String(g.id)===String(preferGid)) ? String(preferGid) : "";

  openModal({
    title:"上传音频", sub:"仅允许上传MP3音频, 支持多选", width:"460px",
    mount(b, f, mm){
      b.innerHTML =
        '<div class="stack">'+
          '<div class="field"><label for="muGrp">媒体库</label>'+
            '<select class="select" id="muGrp">'+
              /* 空值那一项是「还没选」，选过之后不能再选回来 —— 上传总得有个库。 */
              '<option value=""'+(prefer ? "" : " selected")+' disabled>选择媒体库…</option>'+
              groups.map(g=>'<option value="'+esc(g.id)+'"'+(String(prefer)===String(g.id)?" selected":"")+'>'+esc(g.name)+'</option>').join("")+
            '</select></div>'+
          '<div class="field"><label for="muFile">音频文件</label>'+
            '<input class="input" id="muFile" type="file" accept="audio/mpeg,.mp3" multiple>'+
            /* 选完文件先摊成一张清单（用户定的）：一次能挑好几个，得让人看清
               到底挑中了哪几个；上传时每一行自己走一条进度条。 */
            '<div class="mu-list" id="muList" hidden></div></div>'+
        '</div>';
      f.innerHTML = '<span class="spacer"></span><button class="btn" data-cancel>取消</button>'+
        '<button class="btn btn-primary" data-ok>上传</button>';
      const cancel = f.querySelector("[data-cancel]"), ok = f.querySelector("[data-ok]");
      const inp = b.querySelector("#muFile"), listEl = b.querySelector("#muList");
      const fmtSize = n => n >= 1048576
        ? (n/1048576).toFixed(1)+" MB"
        : Math.max(1, Math.round(n/1024))+" KB";
      inp.onchange = ()=>{
        const files = Array.from(inp.files || []);
        if (!files.length){ listEl.hidden = true; listEl.innerHTML = ""; return; }
        listEl.hidden = false;
        listEl.innerHTML = files.map(x=>
          '<div class="mu-item">'+
            '<span class="nm" title="'+esc(x.name)+'">'+esc(x.name)+'</span>'+
            '<span class="mu-bar"><i></i></span>'+
            '<span class="sz">'+fmtSize(x.size)+'</span>'+
          '</div>').join("");
      };
      cancel.onclick = ()=> closeModal(mm.id);
      ok.onclick = async ()=>{
        const files = Array.from(inp.files || []);
        if (!files.length){ toast("请先选择要上传的音频文件", "err"); return; }
        /* accept 只是选择器那边的过滤，有些平台还能切去「所有文件」，
           所以这里再按扩展名把非 MP3 的挑出来，一个都不传。 */
        const bad = files.filter(x=> !/\.mp3$/i.test(x.name));
        if (bad.length){ toast("只支持 MP3 文件："+bad.map(x=>x.name).join("、"), "err"); return; }
        const gid = b.querySelector("#muGrp").value;
        if (!gid){ toast("请先选择媒体库", "err"); return; }
        cancel.disabled = ok.disabled = true;
        inp.disabled = true;
        /* 上传这段把弹窗锁上：遮罩、Esc、× 都不放行（20-ui 的 cfg.locked），
           传完或失败再解锁。取消键也在禁用之列。 */
        mm.cfg.locked = true;
        const rows = Array.from(listEl.querySelectorAll(".mu-item"));
        let done = 0;
        try{
          for (const file of files){
            const row = rows[done];
            const bar = row && row.querySelector(".mu-bar > i");
            const sz  = row && row.querySelector(".sz");
            ok.innerHTML = '<span class="spin"></span>上传中…'+
              (files.length > 1 ? " "+(done+1)+"/"+files.length : "");
            /* 上传进度走 XHR 的 upload 事件；进度条和服务器的响应能不能到齐另说，
               算不出百分比时那格留着原来的文件大小。 */
            await uploadMediaFile(gid, file, p=>{
              if (bar) bar.style.width = Math.round(p*100)+"%";
              if (sz)  sz.textContent = Math.round(p*100)+"%";
            });
            if (bar) bar.style.width = "100%";
            if (sz)  sz.textContent = "完成";
            done++;
          }
          mm.cfg.locked = false;
          closeModal(mm.id);
          await refreshMediaLib();
          renderMain();
          toast(files.length > 1 ? "已上传 "+done+" 个文件" : "已上传「"+files[0].name+"」", "ok");
        }catch(e){
          toast("上传失败：" + ((e && e.message) || "请检查文件和网络后重试"), "err");
          mm.cfg.locked = false;
          cancel.disabled = ok.disabled = false;
          inp.disabled = false;
          ok.textContent = "上传";
          /* 前面几个已经传上去了：刷新一下，别让列表和服务器对不上。 */
          if (done){ await refreshMediaLib(); renderMain(); }
        }
      };
    }
  });
}

/* multipart 上传。api() 只会发 JSON，FormData 得自己走一趟 —— 认证头一样，
   401 也照 api() 的做法静默换一次令牌再重发。 */
function uploadMediaFile(gid, file, onProgress, retried){
  /* 用 XHR 而不是 fetch，只为了 upload.onprogress —— fetch 在请求体发出阶段
     拿不到字节进度。算不出总长度时（服务器不分块或浏览器不给 lengthComputable）
     就不报进度，调用方那边留着文件大小。 */
  const fd = new FormData();
  fd.append("file", file, file.name);
  return new Promise((resolve, reject)=>{
    const xhr = new XMLHttpRequest();
    xhr.open("POST", BASE()+"/medias/upload/"+encodeURIComponent(gid));
    if (S.token) xhr.setRequestHeader("authorization", S.token);
    if (typeof onProgress === "function"){
      xhr.upload.onprogress = e=>{
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
      };
    }
    xhr.onerror = ()=> reject(new Error("连接服务器失败，请重新尝试"));
    xhr.onabort = ()=> reject(new Error("上传已取消"));
    xhr.onload = async ()=>{
      if (xhr.status === 401 && !retried && S.view === "app"){
        const how = await reLogin();
        if (how === "ok") return resolve(uploadMediaFile(gid, file, onProgress, true));
        if (how === "failed") kickToLogin();
      }
      let json = null;
      try{ json = JSON.parse(xhr.responseText); }catch(e){}
      if (!(xhr.status >= 200 && xhr.status < 300)){
        const r = json && json.result;
        const msg = (r && (r.message || (Array.isArray(r) ? r[0] : null))) ||
                    (json && json.message) || ("HTTP " + xhr.status);
        reject(new Error(typeof msg === "string" ? msg : JSON.stringify(msg)));
        return;
      }
      resolve(json ? json.result : null);
    };
    xhr.send(fd);
  });
}

/* ── 任务反查 ────────────────────────────────────────────────────── */
function renderMoreLookup(el, st){
  el.classList.add("fill");
  const chosen = moreAreaChosen(st.area);

  el.innerHTML =
    moreHeadHTML("任务反查")+
    '<div class="panel">'+
      '<div class="panel-head"><h3>查询条件</h3>'+
        '<span class="sub">选一天和一批点位，看它们那天会执行什么</span></div>'+
      '<div class="panel-body">'+
        '<div class="grid2">'+
          /* 日期这一格是**按钮**不是输入框：日期是点出来的，让人手敲一个
             2026-10-14 只会敲错。浮层日历是 openDatePicker（40-view-exam）——
             全项目唯一的单日期浮层，考试页每个科目那一格用的也是它，
             定位、Esc、点外面、竖屏居中那一套都在里面了，不必再写一份。 */
          '<div class="field"><label>查询日期</label>'+
            '<button type="button" class="select-btn" id="moreDate" title="点开日历，选一天">'+
              '<span class="v mono">'+esc(st.date)+'</span>'+
              '<span class="chev">'+ICON.cal+'</span></button></div>'+
          '<div class="field"><label>终端 / 分组</label>'+
            '<button type="button" class="select-btn" id="moreArea" title="选点位或分组，可多选">'+
              '<span class="v'+(chosen?"":" ph")+'">'+esc(moreAreaText(st.area))+'</span>'+
              '<span class="chev">'+ICON.chevD+'</span></button></div>'+
        '</div>'+
        /* 两个按钮都常驻、都靠右：重置在左、查询在右。**不做「有条件才出现」** ——
           按钮忽然长出来一个，右边那个查询键就横移一下，正要点的人会点空。 */
        '<div class="more-btns">'+
          /* 裸 .btn = 白底 + 实边框，和全项目那些「取消」按钮一个样。
             **别写成 btn-quiet** —— 那个是隐形款（透明底、透明边框），
             搁在「开始查询」左边看着像一行注释，不像能点的东西。 */
          '<button class="btn" id="moreClear">重置查询</button>'+
          '<button class="btn btn-primary" id="moreRun"'+(st.busy?' disabled':'')+'>'+
            (st.busy?'查询中…':'开始查询')+'</button>'+
        '</div>'+
      '</div>'+
    '</div>'+
    moreLookupResultHTML(st);

  bindMoreHead(el);
  const q = s => el.querySelector(s);
  q("#moreDate").onclick = ev => openDatePicker(ev.currentTarget, st.date, day=>{
    st.date = day; moreInvalidate(); renderMain();
  });
  q("#moreArea").onclick = ()=>{
    /* 先把当前的选择拷进 S.dt.area 当种子（选择器是从那儿读的），回调里再拷回来。
       **必须立刻拷回来** —— 那个全局的 S.dt.area 是别处「编辑区域」共用的草稿区，
       留着不收拾会被下一个开选择器的人当成初值。 */
    S.dt.area = {t:(st.area.t||[]).slice(), g:(st.area.g||[]).slice()};
    openAreaEditor("pick", null, a=>{
      st.area = {t:(a.t||[]).slice(), g:(a.g||[]).slice()};
      moreInvalidate(); renderMain();
    });
  };
  q("#moreRun").onclick = ()=> runMoreQuery();
  /* 重置 = 回到刚进这一页的样子：日期回今天、终端清空、结果收掉。
     S.dt.area 也顺手清掉 —— 它是选择器的共用草稿区，上面 #moreArea 往里写过种子。 */
  q("#moreClear").onclick = ()=>{
    st.date = todayISO();
    st.area = {t:[], g:[]};
    S.dt.area = {t:[], g:[]};
    moreInvalidate(); renderMain();
  };
}
function moreLookupResultHTML(st){
  if (st.busy)
    return '<div class="panel grow"><div class="hint more-empty">正在查询…</div></div>';
  if (!st.done)
    return '<div class="panel grow"><div class="hint more-empty">选好日期和点位，点「开始查询」</div></div>';
  if (!st.hits.length)
    return '<div class="panel grow"><div class="hint more-empty">'+esc(MORE_EMPTY)+'</div></div>';
  return moreResultsBoxHTML(st);
}

/* ── 终端测试 ────────────────────────────────────────────────────── */
function renderMoreTest(el, st){
  el.classList.add("fill");
  const chosen = moreAreaChosen(st.area);
  const idle = st.phase === "idle";

  el.innerHTML =
    moreHeadHTML("终端测试")+
    '<div class="panel">'+
      '<div class="panel-head"><h3>测试条件</h3>'+
        '<span class="sub">选一个音源和一批分组，播放一次</span></div>'+
      '<div class="panel-body">'+
        '<div class="more-test-fields">'+
          '<div class="field"><label>音源</label>'+
            '<button type="button" class="select-btn" id="mtMedia" title="从媒体库里选一个音频文件">'+
              '<span class="v'+(st.media?"":" ph")+'">'+esc(st.media || "选择音源...")+'</span>'+
              '<span class="chev">'+ICON.music+'</span></button></div>'+
          '<div class="field"><label>分组</label>'+
            '<button type="button" class="select-btn" id="mtArea" title="选分组，可多选">'+
              '<span class="v'+(chosen?"":" ph")+'">'+esc(moreAreaText(st.area))+'</span>'+
              '<span class="chev">'+ICON.chevD+'</span></button></div>'+
        '</div>'+
        '<div class="more-btns">'+
          '<span class="hint" id="mtMsg">'+esc(moreTestMsg(st))+'</span>'+
          '<button class="btn" id="mtReset"'+(idle?' disabled':'')+'>重置测试</button>'+
          (idle
            ? '<button class="btn btn-primary" id="mtRun"'+
                (st.media && chosen ? '' : ' disabled')+'>开始测试</button>'
            : '<button class="btn btn-danger" id="mtRun">停止测试</button>')+
        '</div>'+
      '</div>'+
    '</div>'+
    moreTestStatBoxHTML(st);

  bindMoreHead(el);
  const q = s => el.querySelector(s);
  q("#mtMedia").onclick = ()=>{
    /* 换音源就是换条件：正在响的先停掉。停了要当场重画 —— 选择器取消时
       回调不会来，不重画的话页面上还挂着「停止测试」。 */
    if (!idle){ moreTestStop(true); renderMain(); }
    openMediaPicker(st.media ? [st.media] : [], [], r=>{
      const n = (r && r.media && r.media[0]) || "";
      if (n !== st.media){ st.media = n; st.err = ""; }
      renderMain();
    }, {filesOnly:true, title:"选择音源", sub:"一个音频文件"});
  };
  q("#mtArea").onclick = ()=>{
    if (!idle){ moreTestStop(true); renderMain(); }
    S.dt.area = {t:(st.area.t||[]).slice(), g:(st.area.g||[]).slice()};
    openAreaEditor("pick", null, a=>{
      st.area = {t:(a.t||[]).slice(), g:(a.g||[]).slice()};
      st.err = ""; renderMain();
    });
  };
  q("#mtRun").onclick = ()=>{
    if (moreTestState().phase === "idle") moreTestStart();
    else moreTestStop();
  };
  q("#mtReset").onclick = ()=> moreTestStop();
}

function moreTestMsg(st){
  if (st.err) return st.err;
  if (st.phase === "creating") return "正在创建测试任务…";
  if (st.phase === "starting") return "正在启动试听…";
  if (st.phase === "playing")  return "正在播放 · " + st.count + " 台终端";
  return "";
}

/* 选中的东西 → 状态列表的块。先按分组展开，再补上「直接选的终端」里
   没有被任何已选分组盖住的那几台。分组找不到人也要留一个空块，
   这样「我选了它，它却不在这儿」一眼看得出来。 */
function moreTestBlocks(){
  const st = moreTestState();
  const a = st.area || {t:[],g:[]};
  const byName = n => S.data.terminals.find(t=>t.name===n);
  const seen = new Set();
  const blocks = [];
  (a.g||[]).forEach(g=>{
    const terms = groupMembers(g).map(byName).filter(Boolean);
    terms.forEach(t=> seen.add(t.name));
    blocks.push({name:g, terms:terms, group:true});
  });
  const rest = (a.t||[]).filter(n=> !seen.has(n)).map(byName).filter(Boolean);
  if (rest.length) blocks.push({name: blocks.length ? "单独选择" : "已选终端", terms:rest, group:false});
  return blocks;
}
function moreTestAllTerms(){
  const seen = new Set();
  const out = [];
  moreTestBlocks().forEach(b => b.terms.forEach(t=>{
    if (seen.has(t.id)) return;
    seen.add(t.id); out.push(t);
  }));
  return out;
}
const moreTestOn = t => { const s = statusOf(t.name); return s==="online" || s==="busy"; };
/* 一行右边那句话：状态字，忙的时候再接上任务类型。 */
function moreTestTermState(name){
  const s = statusOf(name);
  const ti = S.termTask[name];
  let extra = "";
  if (ti && ti.TaskID){
    const sess = (S.sessions||[]).find(x=> String(x.TaskID) === String(ti.TaskID));
    if (sess) extra = " · " + sessionTypeText(sess);
  }
  return STAT_TEXT[s] + extra;
}
function moreTestStatRowsHTML(blocks){
  if (!blocks.length)
    return '<div class="hint more-empty">尚未选择任何终端/分组</div>';
  return blocks.map(b=>{
    const on = b.terms.filter(moreTestOn).length;
    return '<div class="tstat-grp">'+
      '<div class="tstat-head">'+
        '<span class="n" title="'+esc(b.name)+'">'+esc(b.name)+'</span>'+
        '<span class="c">'+b.terms.length+' 台 · 在线 '+on+'</span>'+
      '</div>'+
      (b.terms.length
        ? b.terms.map(t=>
            '<div class="pick-row" title="'+statusTitle(t.name)+'">'+
              statusDot(t.name)+
              '<span class="nm">'+esc(t.name)+'</span>'+
              '<span class="stt">'+esc(moreTestTermState(t.name))+'</span>'+
              '<span class="ip">'+esc(t.ip_address||"")+'</span>'+
            '</div>').join("")
        : '<div class="hint" style="padding:10px 12px">组内没有终端</div>')+
    '</div>';
  }).join("");
}
function moreTestStatBoxHTML(st){
  const blocks = moreTestBlocks();
  const terms  = moreTestAllTerms();
  const on = terms.filter(moreTestOn).length;
  return '<div class="panel grow">'+
    '<div class="panel-head"><h3>实时状态</h3>'+
      '<span class="sub" id="mtSum">'+esc(moreTestSumText(blocks, terms, on))+'</span></div>'+
    '<div class="more-tstat" id="mtStat">'+moreTestStatRowsHTML(blocks)+'</div>'+
  '</div>';
}
function moreTestSumText(blocks, terms, on){
  return (moreTestState().area.g||[]).length+" 个分组 · "+terms.length+" 台终端 · 在线 "+on;
}
/* 状态推送一到就重画这块。只换状态区，不动上面的表单和按钮 ——
   重画整页会把正要看的状态列表滚动位置弹回顶上。 */
function moreTestPaintStat(){
  const box = $("#mtStat"); if (!box) return;
  const top = box.scrollTop;
  const blocks = moreTestBlocks();
  const terms  = moreTestAllTerms();
  const on = terms.filter(moreTestOn).length;
  box.innerHTML = moreTestStatRowsHTML(blocks);
  box.scrollTop = top;
  const sum = $("#mtSum");
  if (sum) sum.textContent = moreTestSumText(blocks, terms, on);
}
/* 常驻一条，不在页面上的时候一句话都不做。 */
statusHooks.push(function(){
  if (S.mode !== "more" || !S.dt.more || S.dt.more.tab !== "test") return;
  moreTestPaintStat();
});

/* ══ 测试播放 ═══════════════════════════════════════════════════════
   不自己推音频，而是借用服务器上的「一键报警任务」：这种任务没有执行时间、
   也没有执行周期（原版面板 /task/oneKeyAlarm 里那种），建好之后可以手工试听。
   网页这边只做四件事：建任务 → 发试听指令 → 停 → 删任务。声音由服务器经它
   自己的广播链路送到终端 —— 和真正打铃走同一条路，所以测的是喇叭，不是
   「网页 → 播放代理 → UDP」这一段。

   协议从厂商前端核实（列表页 chunk 122、新建页 chunk 32、app.js 的
   webSocketIdMap），不需要代理也不新增服务：
     POST   /api/v2/one-button-alarm   {name, priority, volume, play_model,
                                        terminals, terminals_groups,
                                        medias, medias_groups} → result.id
     DELETE /api/v2/one-button-alarm/{id}
     WS c2ls_try_listen_task          {RemoteID:<任务id>, RemoteType:"remote_soft_alarm_play"}
     WS c2ls_get_listen_task_status   {} → data.ListenTaskInfo:[{RemoteID, RemoteType, TaskID}]
     WS c2ls_stop_task                {TaskID:<会话号>}
   试听和停止都走终端状态那条 WebSocket（statWS，见 15-status.js），
   和会话管理里「结束任务」用的是同一条连接。 */
const MT_REMOTE_TYPE = "remote_soft_alarm_play";
const MT_VOLUME   = 70;     /* 临时任务音量（和铃声编辑器的默认值一致）；轻重就改这一行 */
const MT_PRIORITY = 50;     /* 一键报警的默认优先级 */
const MT_POLL_MS  = 1500;   /* 试听状态轮询间隔 */

/* 临时任务名：原版面板里一眼认得出，正常情况下几秒内就会被删掉。 */
function moreTestTaskName(){
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return "终端测试 " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

async function moreTestStart(){
  const st = moreTestState();
  if (st.phase !== "idle") return;

  /* 报警会真的从同一批喇叭里响出来，别和在跑的会话抢。 */
  const lv = liveState();
  if (lv.phase === "calling" || lv.phase === "talking"){
    st.err = "正在通话中，先挂断再测试"; renderMain(); return;
  }
  const pl = playState();
  if (pl.phase === "connecting" || pl.phase === "playing" || pl.phase === "paused"){
    st.err = "在线播放中，先停止再测试"; renderMain(); return;
  }
  const m = mediaByName(st.media);
  if (!m){ st.err = "先选择音源"; renderMain(); return; }
  const ids = liveAreaIds(st.area);
  if (!ids.length){
    st.err = liveChosen(st.area) ? "选中的分组里没有终端" : "先选择分组";
    renderMain(); return;
  }
  /* 上一次停止的收尾还没走完（在等会话停止确认）：把它当场结掉，别让它的
     状态应答挡住这一趟。 */
  if (st.cleanupId) moreTestFlushCleanup();

  const gen = ++st.gen;
  st.err = ""; st.phase = "creating"; st.count = ids.length;
  st.miss = 0; st.serverTaskId = null;
  renderMain();

  let r;
  try{
    r = await api("POST", "/one-button-alarm", {body: Object.assign({
      name: moreTestTaskName(),
      priority: MT_PRIORITY,
      volume: MT_VOLUME,
      /* 0 = 顺序播放一次（1 是循环、2 是随机）。测试不该自己一直响下去。 */
      play_model: 0
    }, areaJunc(st.area.t, st.area.g), mediaJunc([st.media], []))});
  }catch(e){
    if (gen === st.gen){
      st.phase = "idle";
      st.err = (e && e.message) || "创建测试任务失败";
      renderMain();
    }
    return;
  }
  const raw = (r && typeof r === "object") ? r.id : r;
  const id  = Number(raw);
  if (!raw || !isFinite(id)){
    if (gen === st.gen){
      st.phase = "idle"; st.err = "创建测试任务失败"; renderMain();
    }
    return;
  }
  /* 建任务途中被人按了停止：任务已经上了服务器，删掉再走。 */
  if (gen !== st.gen){ moreTestDeleteTask(id, true); return; }

  st.taskId = id; st.phase = "starting"; renderMain();

  if (!await statWaitOpen(2500)){
    if (gen !== st.gen) return;
    st.phase = "idle"; st.err = "终端状态连接还没连上，稍后再试";
    moreTestDeleteTask(st.taskId, true); st.taskId = null;
    renderMain();
    return;
  }
  /* 等待途中被停掉的话，任务已经被停止流程接手（cleanupId === id），别再删一遍。 */
  if (gen !== st.gen){ if (st.cleanupId !== id) moreTestDeleteTask(id, true); return; }

  if (!statSendCmd("c2ls_try_listen_task", {RemoteID: id, RemoteType: MT_REMOTE_TYPE})){
    st.phase = "idle"; st.err = "终端状态连接还没连上，稍后再试";
    moreTestDeleteTask(id, true); st.taskId = null;
    renderMain();
    return;
  }
  st.timer = setInterval(moreTestPoll, MT_POLL_MS);
  moreTestPoll();
  renderMain();
}

/* 每一拍问一次服务器「现在在试听哪些任务」。starting 阶段连续几拍都没见到
   自己那条，就按「已经播完」收尾 —— 短音频可能在第一次应答前就结束了。
   连接断着也照常数拍：不能把页面永远晾在「正在启动试听…」。 */
function moreTestPoll(){
  const st = S.dt.more && S.dt.more.test;
  if (!st || st.phase === "idle") return;
  statSendCmd("c2ls_get_listen_task_status", {});
  if (st.phase === "starting" && ++st.miss >= 4) moreTestFinish();
}

/* 试听会话清单回来了（15-status.js 收到 ls2c_get_listen_task_status 转进来）。
   - 停止流程在等这份：查到就补发 stop，查不到就直接删任务（见 moreTestStop）；
   - 正常流程：找到自己那条 → 记下会话号、进入 playing；
   - 之前见过、这次没了 → 播完了，删任务、回 idle。 */
function moreTestListenInfo(list){
  const st = S.dt.more && S.dt.more.test;
  if (!st) return;

  if (st.cleanupId){
    const e = (list || []).find(x=> String(x.RemoteID) === String(st.cleanupId) &&
                                    String(x.RemoteType) === MT_REMOTE_TYPE);
    /* 还没拿到会话号、或者会话号是对的：补发一次停止（只发一次，之后等确认）。 */
    if (e && e.TaskID != null && !st.cleanupStopSent){
      st.serverTaskId = e.TaskID;
      st.cleanupStopSent = true;
      statSendCmd("c2ls_stop_task", {TaskID: e.TaskID});
    }
    return;
  }
  if (st.phase === "idle" || st.taskId == null) return;

  const e = (list || []).find(x=> String(x.RemoteID) === String(st.taskId) &&
                                  String(x.RemoteType) === MT_REMOTE_TYPE);
  if (e){
    st.miss = 0;
    if (e.TaskID != null) st.serverTaskId = e.TaskID;
    if (st.phase === "starting"){ st.phase = "playing"; renderMain(); }
    return;
  }
  if (st.phase === "playing") moreTestFinish();
}

/* 试听命令的应答（ls2c_try_listen_task）。200 就是收了；其余都是没起来。 */
function moreTestTryResult(res){
  const st = S.dt.more && S.dt.more.test;
  if (!st || st.phase === "idle") return;
  if (Number(res) === 200) return;
  st.err = "服务器没能启动试听";
  moreTestStop(true);
  renderMain();
}

/* 会话停止确认（ls2c_stop_task）。确认了才删临时任务 —— 任务还在试听时
   服务器可能不接受删除。 */
function moreTestStopped(taskId){
  const st = S.dt.more && S.dt.more.test;
  if (!st || !st.cleanupId) return;
  if (st.serverTaskId == null || String(st.serverTaskId) !== String(taskId)) return;
  moreTestFlushCleanup();
}

/* 播完 / 等不到状态时收尾：不发送停止指令（会话已经没了），只删临时任务。 */
function moreTestFinish(){
  const st = moreTestState();
  if (st.phase === "idle" || st.cleanupId) return;
  st.gen++;
  st.phase = "idle";
  moreTestClearTimers(st);
  const id = st.taskId;
  st.taskId = null; st.serverTaskId = null; st.miss = 0;
  if (id != null) moreTestDeleteTask(id, false);
  renderMain();
}

/* 停止 = 让服务器停掉试听会话，确认停了（或等几秒）再删临时任务。
   quiet 为真时只收状态不重画（切页／返回本来就会重画整页）。
   已选的音源和点位一个字不动 ——「重置测试」就是这一句（用户定的：只停止播放）。 */
function moreTestStop(quiet){
  const st = moreTestState();
  if (st.phase === "idle" && st.taskId == null){ if (!quiet) renderMain(); return; }
  st.gen++;
  st.phase = "idle";
  moreTestClearTimers(st);
  st.miss = 0;
  const id = st.taskId;
  st.taskId = null;
  if (id == null){ if (!quiet) renderMain(); return; }

  st.cleanupId = id;
  st.cleanupQuiet = !!quiet;
  st.cleanupTries = 0;
  st.cleanupStopSent = false;
  if (st.serverTaskId != null){
    statSendCmd("c2ls_stop_task", {TaskID: st.serverTaskId});
    st.cleanupStopSent = true;
  }
  /* 停止按得比会话登记还早时，会话号还没有：隔 700ms 查一次试听清单，
     查到就补发 stop（见 moreTestListenInfo）；查不到也最多等五拍就删任务。
     发过 stop 之后这几拍主要是等 ls2c_stop_task 的确认。 */
  st.cleanupTimer = setInterval(moreTestCleanupTick, 700);
  moreTestCleanupTick();
  if (!quiet) renderMain();
}

function moreTestCleanupTick(){
  const st = S.dt.more && S.dt.more.test;
  if (!st || !st.cleanupId){
    if (st && st.cleanupTimer){ clearInterval(st.cleanupTimer); st.cleanupTimer = 0; }
    return;
  }
  if (++st.cleanupTries > 4){ moreTestFlushCleanup(); return; }
  statSendCmd("c2ls_get_listen_task_status", {});
}

/* 收尾：删掉临时任务。清理期间新开一趟测试会先把它结掉（见 moreTestStart）。 */
function moreTestFlushCleanup(){
  const st = S.dt.more && S.dt.more.test;
  if (!st || !st.cleanupId) return;
  const id = st.cleanupId, quiet = st.cleanupQuiet;
  st.cleanupId = null; st.cleanupQuiet = false;
  st.cleanupTries = 0; st.cleanupStopSent = false;
  st.serverTaskId = null;
  if (st.cleanupTimer){ clearInterval(st.cleanupTimer); st.cleanupTimer = 0; }
  moreTestDeleteTask(id, quiet);
}
function moreTestClearTimers(st){
  if (st.timer){ clearInterval(st.timer); st.timer = 0; }
  if (st.cleanupTimer){ clearInterval(st.cleanupTimer); st.cleanupTimer = 0; }
}
/* 删临时任务。失败重试一次（刚停完的那一下服务器可能还没腾出手），
   再不行就留一句话 —— 这条任务已经没有时间/周期，不会自己响。 */
function moreTestDeleteTask(id, quiet, retried){
  if (id == null) return;
  api("DELETE", "/one-button-alarm/" + encodeURIComponent(id)).catch(e=>{
    if (!retried){ setTimeout(()=> moreTestDeleteTask(id, quiet, true), 1200); return; }
    if (!quiet) toast("临时测试任务没删掉，请到原版面板里删除", "err");
  });
}
