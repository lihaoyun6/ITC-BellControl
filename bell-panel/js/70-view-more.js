/* view-more — 更多功能
   广播控制台 · 替代厂商后台的打铃配置面板
   //////////////////////////////////////////////////////////////
   装那些一年用不上两回、但不该没有的东西。眼下就一样：

     终端任务反查 —— 选一天 + 选一批点位／分组，把「这一天它们会响什么」摊成
     一张按时刻排好的表。口径是**原始数据**：不看面板里正在编辑的工作集，而是把
     每张启用的铃声列表重新拉一遍，再加上全部定时任务。

   这一页**只读**：全是 GET。不改服务器上一个字节。 */

/* ══ 状态 ═══════════════════════════════════════════════════════════
   结果存在 S.dt.more 里，**不存 DOM**。loadTasks() 末尾自己会 renderTopbar() +
   renderMain()，查询途中只要碰到它整页就被重画一次 —— 结果要是塞在页面节点里，
   这一下就冲没了。renderMore() 每次从状态重画。 */
function moreState(){
  if (!S.dt.more) S.dt.more = {
    date: todayISO(),
    area: {t:[], g:[]},          /* 和别处一样是 {点位名[], 分组名[]} */
    busy: false, done: false, full: false,
    hits: []                     /* 会响的：一条铃声的几个时刻各占一行 */
  };
  return S.dt.more;
}
/* 结果摆在哪：**宽屏弹模态，竖屏整页替换**（用户定的）。
   判据只在点「开始查询」那一下看一眼，不挂 resize / matchMedia 监听 ——
   面板里一条尺寸监听都没有，布局全交给 CSS 媒体查询；这里要决定的不是布局，
   而是「结果画在哪个容器里」，所以只在动作发生的那一刻取一次宽度。
   断点写 640px，和 CSS 里竖屏那一档是同一个值（见 app.css 文件末尾）。 */
const moreNarrow = ()=> window.matchMedia("(max-width:640px)").matches;
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
  /* 竖屏：**点下去就换地方**，不等查完。整页结果视图当场顶掉浏览区，
     里面先写着「正在查询…」—— 用户要的是「点了就去看结果」，让人盯着
     一个变灰的按钮等一趟请求，正是最没必要的那几秒。
     走 renderAll() 不走 renderMore()：那个「‹ 返回」住在顶栏里，
     不重画顶栏它不会长出来。 */
  st.full = moreNarrow();
  if (st.full) renderAll(); else renderMore();

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

      rows.map(normBell).forEach(b=>{
        if (!inWindow(date, g.start_date, g.end_date)) return;
        const sc = bellSchedule(b);
        const hit = sc ? runsOn(sc, date) : "unknown";
        if (hit === "unknown"){ unknown++; return; }   /* 认不出的不猜，也不进表 */
        if (!hit) return;
        /* 没有执行区域的铃声不算命中：面板自己的列表页对它们挂的是红字
           「没有任何执行区域，到点不会响」，查询要是把它们算进「会响」，
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
    if (st.full) renderAll(); else renderMore();
    toast((e && e.message) || "查询失败", "err");
    return;
  }
  st.busy = false;
  /* 结果落到**当下待的那块地方**：st.full 可能已经被「‹ 返回」改掉了
     （查询中途退出去是允许的），那就画回表单页，再弹模态给宽屏。 */
  if (st.full) renderAll(); else renderMore();
  /* 宽屏这一支才弹模态。`!moreNarrow()` 这一层是给「竖屏查到一半按了返回」兜底的 ——
     竖屏本来就放不下这个模态，那时候宁可不弹，结果留在 st.hits 里，
     再点一次「开始查询」就回来了。

     宽屏上一条都没查到就**不弹**：一个空壳模态比浮一句话更像「坏了」。
     竖屏那边不用管 —— 结果视图已经顶在那儿了，它自己也写着同一句话。 */
  if (st.done && !st.full && !moreNarrow()){
    if (st.hits.length) openMoreResultModal();
    else toast(MORE_EMPTY);
  }
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
     宽度本身写在 CSS 的 `.tbl-more .c-*` 里，**不写行内** —— 竖屏那档要单独改
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
function moreResultsBoxHTML(st, caption){
  return '<div class="panel grow">'+
    /* 题注（哪天、哪些终端）：整页那份要，模态那份不要 —— 模态头里已经写着同一句了 */
    (caption && st.hits.length
      ? '<div class="panel-head"><h3>'+esc(st.date)+'</h3>'+
          '<span class="sub">'+esc(moreAreaText(st.area))+'</span></div>'
      : "")+
    moreResultsHTML()+
  '</div>';
}

/* 结果摆给谁看：**宽屏弹模态，竖屏整页替换**（用户定的）。
   两处呈现共用下面这几句，改一处两处都跟着变：
     · moreCountText —— 条数那一行。用户定的位置：就摆在「查询结果」旁边当副标题。
     · moreAskedText —— 这一趟问的是什么（哪天、哪些终端）。表本身回答不了这个，
       而这张表是会被截图发出去的，回头得看得出是哪天的哪几个点。 */
const moreCountText = st => "共 "+st.hits.length+" 条，按时刻排序";
const moreAskedText = st => st.date + " · " + moreAreaText(st.area);
/* 一条都没查到时的那句话。**这不是「交代」**（已查几张列表、跳过几张……那些
   全删了），它是这一趟查询的**答案**：这一天不响。 */
const MORE_EMPTY = "这一天没有会执行的铃声或定时任务";

/* ══ 宽屏：模态 ═════════════════════════════════════════════════════
   宽度给到 1040px：那五列在 .tbl-more 里都是定死的百分比／像素（见 moreResultsHTML），
   窄了会让「时刻」那两列挤在一起。模态本身封顶 88vh，行数再多也是**表自己滚** ——
   滚的既然是表，题头就钉在顶上不动（见 moreResultsBoxHTML 那段）。 */
function openMoreResultModal(){
  const st = moreState();
  if (!st.hits.length) return;
  openModal({
    title:"查询结果", sub: moreCountText(st)+" · "+moreAskedText(st), width:"1040px",
    mount(body, foot, mm){
      /* 正文交出剩余高度（.modal-body.grow-body 那两条 CSS），让表自己去滚：
         题头才钉得住，而且滚到底也一直看得见「查询结果 / 共 N 条」这一行。 */
      body.classList.add("grow-body");
      body.innerHTML = moreResultsBoxHTML(st, false);
      /* 这一格子只读，footer 里就一个出口。× / Esc / 点边上那层黑也都是关 ——
         三种都通，但按钮是最不打哑谜的那一种。 */
      foot.innerHTML = '<span class="spacer"></span><button class="btn" data-ok>关闭</button>';
      foot.querySelector("[data-ok]").onclick = ()=> closeModal(mm.id);
    }
  });
}
/* ══ 竖屏：整页 ═════════════════════════════════════════════════════
   骨架照抄「定时任务」页（`#main.fill` + `.sec-head` + `.panel.grow`）：
   整页不滚，**只有那张表滚** —— 题头才钉得住（见 moreResultsBoxHTML 那段）。
   出口是顶栏第二行最左那个「‹ 返回」（见 30-view-list 的 #tbBack）。 */
function renderMoreFull(el, st){
  el.classList.add("fill");
  const n = st.hits.length;
  /* 查完之前不报数：这一刻写「共 0 条」是句假话，人只会在那一瞬间看见它。 */
  const sub = st.busy ? "" : (n ? moreCountText(st) : MORE_EMPTY);
  el.innerHTML =
    '<div class="sec-head">'+
      '<div style="min-width:0">'+
        /* 条数那一行摆在标题**同一行**、紧跟在后（用户定的）—— 原来挂在下面当
           .meta 副标题，竖屏上标题底下就白多占一行。.title-row 自己会 align-items
           居中，窄了它自己掉到标题下面，不用另外管。
           flex-wrap 必须在这儿写回去：≤640 那条 `.sec-head .title-row{flex-wrap:nowrap}`
           是给「标题 + 右边按钮」那类行准备的，套到这儿会让「这一天没有会执行的铃声
           或定时任务」这 17 个字在 360px 的屏上顶出屏幕去。行内样式压得过媒体查询。 */
        '<div class="title-row" style="flex-wrap:wrap">'+
          '<h2 class="serif">查询结果</h2>'+
          (sub ? '<span class="hint">'+esc(sub)+'</span>' : "")+
        '</div>'+
      '</div>'+
    '</div>'+
    (st.busy
      ? '<div class="hint" style="padding:28px 4px">正在查询…</div>'
      : (n ? moreResultsBoxHTML(st, true) : ""));
}

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
   用和「全局设置」同一套骨架（.headfix + .sec-head + .page-body）：标题那行钉住，
   下面那张面板自己滚。面板就是现成的 .panel，不用新写 CSS。 */
function renderMore(){
  const el = $("#main"); if (!el) return;
  const st = moreState();
  /* 整页结果视图只在竖屏存在（宽屏那一支走模态）。窗口要是停在结果页上被拉宽了 ——
     没有 resize 监听，所以只能等下一次重画 —— 这里当场退回表单页，
     免得留下一个只靠顶栏才退得出来的页面。 */
  if (st.full && !moreNarrow()) st.full = false;
  if (st.full) return renderMoreFull(el, st);
  el.classList.add("headfix");
  const chosen = moreAreaChosen(st.area);

  el.innerHTML =
    '<div class="sec-head">'+
      '<div class="title-row">'+
        '<h2 class="serif">更多功能</h2>'+
      '</div>'+
    '</div>'+

    '<div class="page-body">'+

    '<div class="panel">'+
      '<div class="panel-head"><h3>终端任务反查</h3>'+
        '<span class="sub">选一天和一批终端，看它们那天会执行什么</span></div>'+
      '<div class="panel-body">'+
        '<div class="grid2">'+
          /* 日期这一格是**按钮**不是输入框：日期是点出来的，让人手敲一个
             2026-10-14 只会敲错。浮层日历是 openDatePicker（40-view-exam）——
             全项目唯一的单日期浮层，考试页每个科目那一格用的也是它，
             定位、Esc、点外面、竖屏居中那一套都在里面了，不必再写一份。 */
          '<div class="field"><label>查询日期</label>'+
            '<button type="button" class="select-btn" id="moreDate" title="点开日历，选一天">'+
              '<span class="v mono">'+esc(st.date)+'</span>'+
              '<span class="chev">'+ICON.chevD+'</span></button></div>'+
          '<div class="field"><label>终端 / 分组</label>'+
            '<button type="button" class="select-btn" id="moreArea" title="选点位或分组，可多选">'+
              '<span class="v'+(chosen?"":" ph")+'">'+esc(moreAreaText(st.area))+'</span>'+
              '<span class="chev">'+ICON.chevD+'</span></button></div>'+
        '</div>'+
        /* 两个按钮都常驻、都靠右：重置在左、查询在右。**不做「有条件才出现」** ——
           按钮忽然长出来一个，右边那个查询键就横移一下，正要点的人会点空。 */
        '<div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:14px;flex-wrap:wrap">'+
          /* 裸 .btn = 白底 + 实边框，和全项目那些「取消」按钮一个样。
             **别写成 btn-quiet** —— 那个是隐形款（透明底、透明边框），
             搁在「开始查询」左边看着像一行注释，不像能点的东西。 */
          '<button class="btn" id="moreClear">重置查询</button>'+
          '<button class="btn btn-primary" id="moreRun"'+(st.busy?' disabled':'')+'>'+
            (st.busy?'查询中…':'开始查询')+'</button>'+
        '</div>'+
      '</div>'+
    '</div>'+

    /* 这一页**不长出结果** —— 结果有它自己的两个去处（宽屏那个模态／竖屏那个
       整页视图，见上）。表单页永远只是表单页：查完弹一层窗户上来，关上就还是
       刚才那两个格子、那个日期，接着改下一个问题。 */
    '</div>';

  const q = s => el.querySelector(s);
  q("#moreDate").onclick = ev => openDatePicker(ev.currentTarget, st.date, day=>{
    st.date = day; moreInvalidate(); renderMore();
  });
  q("#moreArea").onclick = ()=>{
    /* 先把当前的选择拷进 S.dt.area 当种子（选择器是从那儿读的），回调里再拷回来。
       **必须立刻拷回来** —— 那个全局的 S.dt.area 是别处「编辑区域」共用的草稿区，
       留着不收拾会被下一个开选择器的人当成初值。 */
    S.dt.area = {t:(st.area.t||[]).slice(), g:(st.area.g||[]).slice()};
    openAreaEditor("pick", null, a=>{
      st.area = {t:(a.t||[]).slice(), g:(a.g||[]).slice()};
      moreInvalidate(); renderMore();
    });
  };
  q("#moreRun").onclick = ()=> runMoreQuery();
  /* 重置 = 回到刚进这一页的样子：日期回今天、终端清空、结果收掉。
     S.dt.area 也顺手清掉 —— 它是选择器的共用草稿区，上面 #moreArea 往里写过种子。 */
  q("#moreClear").onclick = ()=>{
    st.date = todayISO();
    st.area = {t:[], g:[]};
    S.dt.area = {t:[], g:[]};
    moreInvalidate(); renderMore();
  };
}
