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
   终端测试会往终端推音频——这是能听见的写入，只在用户明确按下按钮时发生。 */

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
function moreTestInit(){
  return {
    media: "",                   /* 音源文件名 */
    area: {t:[], g:[]},          /* 测试点位 */
    phase: "idle",               /* idle | loading | connecting | playing */
    err: "",                     /* 上一次没做成的一句话 */
    gen: 0,                      /* 第几趟测试；停掉就翻号，作废在途的 await */
    buf: null, bufMedia: "",     /* 解好的 AudioBuffer 和它对应的音源名 */
    count: 0                     /* 这一趟推给几台终端 */
  };
}
function moreTestState(){
  const st = moreState();
  if (!st.test) st.test = moreTestInit();
  return st.test;
}
/* 正在测试（准备音源、连接、播放都算）。对讲和在线播放用它来挡「代理同一时刻
   只有一条会话」那件事。 */
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
   首页是卡片入口；两个子页都是 `.main-inner.fill`：标题固定、条件固定，
   下面结果／状态面板吃剩余高度并自己滚。 */
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
            '<span class="d">查某一天哪些铃声和定时任务会执行</span></span>'+
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
      if (n !== st.media){
        st.media = n; st.buf = null; st.bufMedia = ""; st.err = "";
      }
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
  if (st.phase === "loading")    return "正在准备音源…";
  if (st.phase === "connecting") return "正在连接…";
  if (st.phase === "playing")    return "正在播放 · " + st.count + " 台终端";
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
   走的是和对讲／在线播放同一条代理通道：网页这边把音频解成 16k 单声道 PCM，
   一帧帧丢给代理，代理套 20 字节头用 UDP 发给终端。本机静音。 */
let mtCtx = null, mtNode = null, mtSrc = null, mtSink = null;

async function moreTestStart(){
  const st = moreTestState();
  if (st.phase !== "idle") return;

  /* 代理同一时刻只有一条会话。两条路都被占着的时候，先说清楚让谁让位。 */
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

  const gen = ++st.gen;
  st.err = ""; st.phase = "loading"; st.count = ids.length;

  /* **音频上下文就在点击这一下建**，不等下载和解码。后面那两段 await 回来时
     Safari 已经不认这次点击是「手势」了，那时再 new 出来的上下文会一直 suspended，
     按了开始却没有声音。先建好、当场 resume，后面只往里接节点。 */
  let actx;
  try{
    actx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:16000});
    if (actx.state === "suspended"){ try{ actx.resume().catch(()=>{}); }catch(e){} }
  }catch(e){
    st.phase = "idle"; st.err = "本机音频起不来"; renderMain(); return;
  }
  const closeActx = ()=>{
    try{ const p = actx.close(); if (p && p.catch) p.catch(()=>{}); }catch(e){}
  };

  renderMain();

  let buf;
  try{ buf = await moreTestBuffer(m); }
  catch(e){
    closeActx();
    if (gen === st.gen){
      st.phase = "idle"; st.err = (e && e.message) || "音源读取失败"; renderMain();
    }
    return;
  }
  if (gen !== st.gen){ closeActx(); return; }

  const noAddr = await liveEnsureAddr();
  if (gen !== st.gen){ closeActx(); return; }
  if (noAddr){ closeActx(); st.phase = "idle"; st.err = noAddr; renderMain(); return; }

  st.phase = "connecting"; renderMain();

  let g;
  try{ g = await moreTestCtxMake(actx); }
  catch(e){
    closeActx();
    if (gen === st.gen){ st.phase = "idle"; st.err = "本机音频起不来"; renderMain(); }
    return;
  }
  if (gen !== st.gen){ moreTestCtxDrop(g); return; }

  mtCtx = g.ctx; mtNode = g.node; mtSink = g.sink;
  if (mtNode.port) mtNode.port.onmessage = moreTestFeed;
  if (mtCtx.state === "suspended"){ try{ await mtCtx.resume(); }catch(e){} }
  if (gen !== st.gen) return;

  try{
    await liveRequest("call", {
      ws: S.wsIp, udp: liveAudioTarget(), token: S.token,
      /* endpoints 必须是**字符串**数组（代理那边是 []string），见 liveCall 里那段。 */
      endpoints: ids.map(String),
      names: (st.area.t||[]).concat(st.area.g||[])
    });
  }catch(e){
    if (gen === st.gen){
      moreTestCtxDrop();
      st.phase = "idle"; st.err = "连接播放代理失败!"; renderMain();
    }
    return;
  }
  /* 连接途中被人按了停止：代理那一路刚开起来，得撤掉。 */
  if (gen !== st.gen){ liveRequest("hangup", {}).catch(()=>{}); return; }

  st.phase = "playing";
  const src = mtCtx.createBufferSource();
  src.buffer = buf;
  src.connect(mtNode);
  src.onended = ()=>{ if (gen === st.gen) moreTestStop(); };
  src.start();
  mtSrc = src;
  renderMain();
}

/* 停止 = 本地收干净 + 让代理撤任务。quiet 为真时只收声音不重画（切页／返回用，
   那一趟本来就会重画整页）。noHangup 给「连接已经断了」那条路用 —— 那时候再发
   hangup 会触发一次重连。已选的音源和点位一个字不动 ——「重置测试」就是这一句
   （用户定的：只停止播放）。 */
function moreTestStop(quiet, noHangup){
  const st = moreTestState();
  if (st.phase === "idle") return;
  st.gen++;
  st.phase = "idle";
  moreTestCtxDrop();
  if (!noHangup) liveRequest("hangup", {}).catch(()=>{});
  if (!quiet) renderMain();
}

/* 本机这条链路：source → worklet/ScriptProcessor → gain(0) → destination。
   gain(0) 是**本机静音** —— 测试的声音只该从终端出来。
   ctx 是点击那一刻就建好的（见 moreTestStart），这里只往里接节点。 */
async function moreTestCtxMake(ctx){
  let node;
  if (playWorkletOK()){
    await ctx.audioWorklet.addModule(liveWorkletURL());
    node = new AudioWorkletNode(ctx, "pcm16");
  } else {
    /* 明文 http 下没有 AudioWorklet，退到 ScriptProcessorNode（和 playCtxMake 同路）。 */
    node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = e => moreTestTap(e.inputBuffer.getChannelData(0));
  }
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink); sink.connect(ctx.destination);
  return {ctx, node, sink};
}
/* 传进来的是「还没挂到全局变量上」的那一套，或者当前正在用的那一套。 */
function moreTestCtxDrop(g){
  if (g){
    try{ if (g.node.port) g.node.port.onmessage = null; }catch(e){}
    try{ g.node.onaudioprocess = null; }catch(e){}
    try{ g.node.disconnect(); }catch(e){}
    try{ g.sink.disconnect(); }catch(e){}
    try{ const p = g.ctx.close(); if (p && p.catch) p.catch(()=>{}); }catch(e){}
    return;
  }
  if (mtSrc){
    try{ mtSrc.onended = null; mtSrc.stop(); }catch(e){}
    try{ mtSrc.disconnect(); }catch(e){}
  }
  if (mtNode){
    try{ if (mtNode.port) mtNode.port.onmessage = null; }catch(e){}
    try{ mtNode.onaudioprocess = null; }catch(e){}
    try{ mtNode.disconnect(); }catch(e){}
  }
  if (mtSink){ try{ mtSink.disconnect(); }catch(e){} }
  const ctx = mtCtx;
  mtSrc = mtCtx = mtNode = mtSink = null;
  if (ctx){ try{ const p = ctx.close(); if (p && p.catch) p.catch(()=>{}); }catch(e){} }
}
function moreTestFeed(e){
  if (moreTestState().phase !== "playing") return;
  liveSendPcm(e.data);
}
/* ScriptProcessor 那条路：裁到 [-1,1] 再转 16 位，和 LIVE_WORKLET_SRC 逐行对应。 */
function moreTestTap(ch){
  if (!ch || !ch.length) return;
  if (moreTestState().phase !== "playing") return;
  const out = new Int16Array(ch.length);
  for (let i = 0; i < ch.length; i++){
    let v = ch[i];
    v = v < -1 ? -1 : v > 1 ? 1 : v;
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  liveSendPcm(out);
}

/* 从服务器取音源并解码。同一首缓存一份；token 只在运行时拼进 URL，
   绝不写进日志或报错文案。 */
async function moreTestBuffer(m){
  const st = moreTestState();
  if (st.buf && st.bufMedia === m.name) return st.buf;
  const url = BASE() + "/medias/download/" + encodeURIComponent(m.id) +
              "?authorization=" + encodeURIComponent(S.token || "");
  let res;
  try{ res = await fetch(url); }
  catch(e){ throw new Error("连不上服务器，音源下载失败"); }
  if (!res.ok) throw new Error("音源下载失败（HTTP " + res.status + "）");
  const ab = await res.arrayBuffer();
  const f  = new File([ab], m.name, {type: res.headers.get("content-type") || "audio/mpeg"});
  const it = await playLoadOne(f);
  if (!it) throw new Error("这个音源解不出声音");
  st.buf = it.buf; st.bufMedia = m.name;
  return it.buf;
}
