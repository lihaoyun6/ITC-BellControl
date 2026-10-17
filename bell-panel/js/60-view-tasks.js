/* view-tasks — 定时任务
   广播控制台 · 替代厂商后台的打铃配置面板
   //////////////////////////////////////////////////////////////
   定时任务（/api/v2/timing-tasks）不属于任何铃声列表：它自带执行时间、
   区域、音源和周期，常用于早听力、演练、考试通知这类独立播放。
   不属于任何铃声列表的独立播放，接口 /timing-tasks。 */

/* 任务行的键：服务器上的用 id，还没提交上去的用临时 id。勾选集合存的是这个键 ——
   新建的任务此时 id 还是 null，直接用 id 会把所有新任务当成同一行。 */
const taskKey = t => t.id != null ? String(t.id) : String(t.tmpId);
const tkSelected = () => S.tasks.filter(t => S.tsel.has(taskKey(t)));

function renderTasks(){
  const el = $("#main"); if (!el) return;
  /* 「定时任务」原来是个和「铃声计划」平级的顶层视图（顶栏那排页签 + 竖屏底部导航栏
     里各一格，.main-inner.fill 一整套）。现在页签撤了，入口只剩侧栏底部那张常驻卡片
     （见 30-view-list.js 的 openTasks / renderRail），所以这一页改成**长在右栏里**：
     左边那份任务列表照旧站着（卡片就在它底下），右边才是这张表。
     版式因此和铃声计划的详情页一模一样（.wb 两栏 + .wb-main），只是右栏的内容
     换成了定时任务 —— 并且**恒挂 show-main**：窄屏一次只显示一栏时，该让位的是
     左边那份列表，不是这张表。
     `.panel.grow` 吃剩余高度这件事不用改：` .wb-main > .grow{flex:1 1 auto}` 就是它。 */
  el.classList.add("pane");
  LOCK_NOW = false;           /* 定时任务不归考试模式管（这一位是给共享的行点击通路看的） */
  /* 服务器刷新、新建任务拿到 id 之后键会变，勾选里留下的孤儿先清掉 */
  const liveKeys = new Set(S.tasks.map(taskKey));
  S.tsel.forEach(k=>{ if (!liveKeys.has(k)) S.tsel.delete(k); });

  el.innerHTML =
    '<div class="wb show-main">'+
    '<aside class="rail" id="rail"></aside>'+
    '<div class="wb-main">'+
    '<div class="sec-head">'+
      /* 标题底下原来挂着一枚「待提交 N」，连那行 .meta 一起撤了。它只在有活儿
         等着的时候才出现，一出现标题这一块就高一截（.meta 自己还带 5px margin-top），
         有它没它版面不一样；而要数还有几条没发，抽屉里那份队列一条条列着
         （见 50-drawer.js），比一个合计数说得清楚。 */
      '<div style="min-width:0">'+
        '<h2 class="serif">定时任务</h2>'+
      '</div>'+
    '</div>'+

    '<div class="panel grow">'+
      /* 和铃声表的表头一样是「一栏两态」：没勾选是刷新+搜索+添加任务，勾选了原地换成批量动作 */
      '<div class="panel-head"><h3>任务</h3><span class="sub" id="tkFoot">共 '+S.tasks.length+' 条</span>'+
        '<span class="acts" id="tkActs">'+
          /* 表头这三样的次序是用户定的：刷新 → 搜索 → 添加任务。搜索框夹在中间，
             宽度钉在 css 的 `.hd-seg > .sbox` 上（竖屏要收窄，内联的 width 收不动）。 */
          '<span class="hd-seg" id="tkNormal">'+
            '<button class="btn btn-sm btn-quiet" id="tkReload">'+ICON.refresh+'</button>'+
            '<span class="sbox sbox-sm">'+ICON.search+
              '<input class="input" id="tkQ" placeholder="筛选名称 / 时间" value="'+esc(S.dt.tkq||"")+'">'+
            '</span>'+
            '<button class="btn btn-sm" id="tkNew">'+ICON.plus+' <span>添加<span class="wide-only">任务</span></span></button>'+
          '</span>'+
          '<span class="hd-seg" id="tkBulk" hidden></span>'+
        '</span>'+
      '</div>'+
      /* tbl-tasks 这个类只给竖屏用：≤980px 时收掉「音源」「详情」「执行周期」
         三列（见 css/app.css 末尾）。 */
      '<div class="tbl-wrap"><table class="tbl tbl-tasks"><thead><tr>'+
        '<th style="width:34px"><input type="checkbox" id="tkSelAll"></th>'+
        '<th style="width:78px">时间</th><th>名称</th><th>音源</th><th class="c-detail">详情</th>'+
        /* 「详情」和「状态」、行尾那一格的宽度都在 CSS 里，见 .tbl-tasks 的
           .c-detail / .c-sw / .c-act —— 竖屏上要各收一档，写在这儿就盖不动了。 */
        '<th>执行周期</th><th class="c-sw">状态</th><th class="c-act"></th>'+
      '</tr></thead><tbody id="tkRows"></tbody></table></div>'+
    '</div>'+          /* .panel.grow */
    '</div>'+          /* .wb-main */
    '</div>';          /* .wb */

  el.querySelector("#tkNew").onclick = ()=> openTaskEditor(null);
  el.querySelector("#tkReload").onclick = async ()=>{ await loadTasks(); toast("数据已刷新","ok"); };
  /* 搜索框**只画上面那一趟**，打字只重画表身（drawTkRows）。这一格必须钉死：
     把正在输入的控件整个换掉，中文输入法的候选框会当场断掉（铃声表那个 #f-q 是
     同一分工，见 30-view-list.js）。 */
  const tkq = el.querySelector("#tkQ");
  if (tkq) tkq.oninput = ()=>{ S.dt.tkq = tkq.value; drawTkRows(); };
  const tkAll = el.querySelector("#tkSelAll");
  if (tkAll) tkAll.onchange = e => {
    S.tsel.clear();
    /* 「全选」勾的是**当前筛出来的**那些，不是整份名册：滤过之后还去勾看不见的行，
       接着一气儿停用或删除，是这套界面里最不该有的那种意外（铃声表那边同一条口径）。 */
    if (e.target.checked) visibleTasks().forEach(t=> S.tsel.add(taskKey(t)));
    drawTkRows();          /* 重画一趟就把每行的勾选态和表头那格一起跟上了 */
    renderTkSelbar();
  };

  el.querySelector("#tkActs").addEventListener("click", onTkBarClick);

  drawTkRows();
  renderTkSelbar();
  renderRail();      /* #rail 是刚造出来的空壳，得填（它底下那张「定时任务」卡片也靠它画） */
}

/* 搜索：名字、时刻、音源一起比，大小写不论 —— 和铃声表那个 visibleBells() 一条口径。
   它管的是「看得见哪几行」，勾选、全选、底下那个计数都跟着它走。 */
function visibleTasks(){
  const q = (S.dt.tkq||"").trim().toLowerCase();
  if (!q) return S.tasks;
  return S.tasks.filter(t=> (t.name+" "+hm(t.time)+" "+t.mediaNames.join(" ")).toLowerCase().indexOf(q)>=0);
}

/* 表身单独一画：搜索框在 renderTasks 的 innerHTML 里画过就不再动，打字走这里。
   和铃声表的 renderRows 同一条分工 —— 表头（含搜索框）钉住，表身随搜索重画。 */
function drawTkRows(){
  const tb = $("#tkRows"); if (!tb) return;
  const rows = visibleTasks();
  let empty;
  if ((S.dt.tkq||"").trim()){
    empty = '没有匹配的任务。';
  } else if (S.conn === "busy" && !S.tasks.length){
    /* 自动登录那一趟还没回来时（刷新页面停在这一页，boot 先把主界面画出来、
       再去问服务器）手上一条任务都没有，落下来会写着「服务器上还没有定时任务」
       —— 那是句假话，数据还在路上。判据照 30-view-list.js 里那句来。 */
    empty = '正在连接广播服务器…';
  } else {
    empty = '服务器上还没有定时任务。';
  }
  tb.innerHTML = rows.length ? rows.map(taskRowHTML).join("")
    : '<tr><td colspan="8"><div class="hint" style="padding:18px;text-align:center">'+empty+'</div></td></tr>';
  /* 计数跟着筛出来的走：滤着的时候它就是「匹配上几条」，不滤自然退回总数。 */
  const foot = $("#tkFoot");
  if (foot) foot.textContent = "共 " + rows.length + " 条";
  syncTkSelAll();

  $$("[data-tk]", tb).forEach(row => {
    const key = row.dataset.tk;
    const t = S.tasks.find(x=> taskKey(x)===key); if (!t) return;
    const on = row.querySelector("[data-tk-on]");
    if (on) on.onclick = e => { e.stopPropagation(); t.isDone = t.isDone?0:1; queueTaskToggle(t, !!t.isDone); renderMain(); };
    const ed = row.querySelector("[data-tk-edit]");
    if (ed) ed.onclick = e => { e.stopPropagation(); openTaskEditor(t); };
    const info = row.querySelector("[data-tk-area]");
    if (info) info.onclick = e => { e.stopPropagation(); openTaskInfo(t); };
    const cp = row.querySelector("[data-tk-copy]");
    if (cp) cp.onclick = e => { e.stopPropagation(); copyTask(t); };
    const del = row.querySelector("[data-tk-del]");
    if (del) del.onclick = e => { e.stopPropagation(); askTaskDelete(t); };
    /* 竖屏上那三枚图标收成了这一枚（见 css）—— 点开是同一批动作，一行一个、字写全。
       和铃声表一样，取的时候才去 S.tasks 里找：菜单开着的时候表被重画了也不怕。 */
    const more = row.querySelector("[data-tk-more]");
    if (more) more.onclick = e => {
      e.stopPropagation();
      const live = ()=> S.tasks.find(x=> taskKey(x)===key) || t;
      openRowMenu(more, [
        { icon:ICON.edit, label:"编辑",     onPick:()=> openTaskEditor(live()) },
        { icon:ICON.copy, label:"复制一条", onPick:()=> copyTask(live()) },
        { icon:ICON.del,  label:"删除",     onPick:()=> askTaskDelete(live()), danger:true },
      ]);
    };
    const cb = row.querySelector(".rowsel");
    if (cb) cb.onchange = e => setTkSel(key, e.target.checked);
    /* 空白处一点就勾上，和铃声表一样 —— 但别让点和操作有关的控件也触发勾选 */
    row.onclick = e => {
      if (e.target.closest("button,input,select,a")) return;
      setTkSel(key, !S.tsel.has(key));
    };
  });
}

/* 表头那格「全选」的状态：手上这几行**一个不剩全勾上**了它才亮（一行都没有时不算全选）。
   滤着的时候它说的就是「筛出来这些全选了」，和它勾选时那句 onchange 一个口径。
   单勾一行也要走这儿 —— 不然取消一行之后它还亮着，就在替没勾的行点头。 */
function syncTkSelAll(){
  const all = $("#tkSelAll"); if (!all) return;
  const rows = visibleTasks();
  all.checked = rows.length > 0 && rows.every(t=> S.tsel.has(taskKey(t)));
}

function setTkSel(key, on){
  if (on) S.tsel.add(key); else S.tsel.delete(key);
  const row = document.querySelector('tr[data-tk="'+key+'"]');
  if (row){
    row.classList.toggle("sel", on);
    const cb = row.querySelector(".rowsel"); if (cb) cb.checked = on;
  }
  syncTkSelAll();
  renderTkSelbar();
}

function renderTkSelbar(){
  const norm = $("#tkNormal"), bulk = $("#tkBulk");
  if (!norm || !bulk) return;
  const n = S.tsel.size;
  norm.hidden = n > 0;
  bulk.hidden = n === 0;
  if (!n){ bulk.innerHTML = ""; return; }
  /* 和铃声表那条一模一样的四枚图标键（见 30-view-list.js 的 renderSelbar） */
  bulk.innerHTML =
    '<span class="bulk-n">'+n+'</span><span class="dimmer">条已选</span>'+
    '<button class="btn btn-icon" data-tkact="edit" title="批量编辑：改区域 / 改音源 / 改时间" aria-label="批量编辑">'+ICON.edit+'</button>'+
    '<button class="btn btn-icon" data-tkact="on" title="启用这些任务" aria-label="启用">'+ICON.check+'</button>'+
    '<button class="btn btn-icon" data-tkact="off" title="停用这些任务" aria-label="停用">'+ICON.x+'</button>'+
    '<button class="btn btn-icon btn-danger" data-tkact="del" title="删除这些任务" aria-label="删除">'+ICON.del+'</button>';
}

function onTkBarClick(e){
  const btn = e.target.closest("[data-tkact]"); if (!btn) return;
  const list = tkSelected(); if (!list.length) return;
  const act = btn.dataset.tkact;
  if (act==="edit") return openBulkMenu("批量编辑 "+list.length+" 个定时任务", "这些改动会一起写进服务器", [
    {icon:ICON.monitor, label:"改区域", sub:"统一改成同一组点位和分组",   onPick:()=>tkBulkArea(list)},
    {icon:ICON.music,   label:"改音源", sub:"换掉这些任务的音源",         onPick:()=>tkBulkMedia(list)},
    {icon:ICON.clock,   label:"改时间", sub:"平移时刻，或整批换成同一个周期", onPick:()=>tkBulkShift(list)}
  ]);
  if (act==="del"){
    return openConfirm("删除 "+list.length+" 个定时任务","这会在服务器上删除这些任务，不可撤销。",
      ()=>{
        const keys = new Set(list.map(taskKey));
        list.forEach(queueTaskDelete);          /* 还没提交上去的会被它自己从 S.tasks 里摘掉 */
        S.tasks = S.tasks.filter(x=> !keys.has(taskKey(x)));
        S.tsel.clear(); renderMain(); toast(wroteWord(),"ok");
      }, "确认删除", true);
  }
  if (act==="on" || act==="off"){
    const on = act==="on";
    list.forEach(t=>{ t.isDone = on?1:0; queueTaskToggle(t, on); });
  }
  S.tsel.clear(); renderMain(); toast(wroteWord(),"ok");
}

/* ── 批量动作。都是「先弹一个小框问参数，确定后逐条走队列」，和铃声那边同一个套路。 */
function tkBulkArea(list){
  S.dt.area = {t:[], g:[]};
  openAreaEditor("pick", null, a => {
    list.forEach(t=>{ t.termNames = a.t.slice(); t.groupNames = a.g.slice(); queueTaskSave(t); });
    S.tsel.clear(); renderMain(); toast(wroteWord(),"ok");
  });
}
/* 批量改音源：和「编辑任务」里那个「选择音源」开的是**同一个多选器**（音源 ·
   媒体库三个页签）。以前这里是 filesOnly，只能挑单个文件 —— 可任务的报文本来就
   两边都收（见 00-core 的 mediaJunc），批量这边却比单条编辑框还窄，说不通。 */
function tkBulkMedia(list){
  openMediaPicker([], [], r => {
    const ms = (r && r.media) || [], gs = (r && r.groups) || [];
    if (!ms.length && !gs.length) return;
    list.forEach(t=>{
      t.mediaNames = ms.slice();
      t.mediaGroupNames = gs.slice();
      /* 时长只有「只挑文件」时算得出来：选了整个分组的话，本地不知道里面有多少、
         多长，那就沿用原来的值 —— 不能顺手把它抹成 00:00:00（编辑框里同一条规矩）。 */
      if (ms.length && !gs.length) t.sound = Object.assign({}, t.sound, {life_time: lifeTimeOf(ms)});
      queueTaskSave(t);
    });
    S.tsel.clear(); renderMain(); toast(wroteWord(),"ok");
  }, {title:"批量修改音源（"+list.length+" 个任务）",
      sub:"选中的任务将统一改用这些音源 —— 挑文件、挑整个媒体库分组，或混着挑"});
}
/* 任务的改时间：现在只有平移这一半。任务的周期是四种 time_type，各自的日期
   编辑器还没做（见 README 文末待办），所以这里暂时不摆「执行周期」那一格 ——
   摆一个改不了周期的「改时间」比叫「改时移」更容易误会。 */
function tkBulkShift(list){
  openModal({ title:"改时间（"+list.length+" 个任务）", width:"520px",
    mount(b,f,mm){
      b.innerHTML = '<div class="stack">'+shiftFieldHTML("tsh")+'</div>';
      f.innerHTML = '<span class="spacer"></span><button class="btn" id="tshC">取消</button>'+
        '<button class="btn btn-primary" id="tshOk">应用</button>';
      $("#tshC").onclick = ()=> closeModal(mm.id);
      $("#tshOk").onclick = ()=>{
        const d = readShiftSec("tsh");
        if (!d){ toast("平移量不能为 0","err"); return; }
        closeModal(mm.id);
        list.forEach(t=>{
          t.time = secToHMS(wrapDay(hmsToSec(t.time) + d));
          t.times = [t.time];
          queueTaskSave(t);
        });
        S.tasks.sort((a,b2)=> hmsToSec(a.time)-hmsToSec(b2.time));
        S.tsel.clear(); renderMain(); toast(wroteWord(),"ok");
      };
    }});
}

function taskRowHTML(t){
  const on = Number(t.isDone)===1;
  const key = taskKey(t);
  const sel = S.tsel.has(key);
  const hasArea = !!(t.termNames.length + t.groupNames.length);
  return '<tr data-tk="'+esc(key)+'" class="task-row'+(on?"":" off")+(sel?" sel":"")+'">'+
    '<td class="selcell"><input type="checkbox" class="rowsel" '+(sel?"checked":"")+'></td>'+
    /* 时间不进按钮了：以前点它展开一行详情，跟「详情」那一栏的圈 i 是同一件事的
       两个入口。入口留一个就够，时间回归成一格普通文本。 */
    '<td class="t">'+esc(hm(t.time))+'</td>'+
    /* 名字下面以前还挂一行「优先级 X · 音量 Y」。横竖屏都去掉了：这两个数
       建好任务之后就几乎不再动，不值得每行都占一行高度；要看就点「详情」
       那个圈 i（openTaskInfo 里两个都在）。 */
    '<td><div class="nm">'+esc(t.name||"(未命名)")+'</div></td>'+
    /* 「音源」这一格从前是一串胶囊。改成和铃声表那一格一样的素文字 —— 一列胶囊在
       表里既占宽又要换行，扫一眼还不如一行字快；要看完整清单点「详情」那个圈 i，
       那儿仍旧是胶囊（taskMediaChips 现在只剩那一个调用点）。
       文件和文件夹混着选的时候两样都写出来，用「、」连。
       顺带修好一处：条件从前只看 mediaNames，于是**只挑了文件夹**的任务在这一格
       显示「未选」，明明它有东西可放。 */
    '<td class="med">'+ ((t.mediaNames.length + t.mediaGroupNames.length)
      ? esc(t.mediaNames.concat(t.mediaGroupNames).join("、"))
      : '<span class="hint">未选</span>') +'</td>'+
    /* 区域明细搬进了圈 i 后面的弹框：一列 chip 挤在表里既占宽又要换行，
       而且列表要的是「扫一眼有哪几条任务」，不是逐条读区域。
       没设区域的任务不会响，所以那个圈 i 变琥珀色，别让它悄悄混在里面。 */
    '<td><button class="cell-btn'+(hasArea?"":" warn")+'" data-tk-area title="'+
      esc(hasArea?"查看任务信息与执行区域":"未设置执行区域 —— 这个任务不会响，点开看看")+'">'+ICON.info+'</button></td>'+
    /* 「执行周期」和上面那格「音源」一样是次级文字（不加粗、压一档灰）——
       css 里它们和铃声表那三列共用一条规则，两页的观感才是一套。 */
    '<td class="when">'+esc(taskWhen(t))+'</td>'+
    /* 和铃声表一样：启停是开关，行尾是编辑 / 复制 / 删除三枚图标，
       竖屏上这三枚收成第四枚「⋯」（css 换的，两套零件都在 DOM 里）。 */
    '<td class="swcell"><button class="sw-mini'+(on?" on":"")+'" data-tk-on role="switch" aria-checked="'+on+'" '+
      'title="'+esc(on?"停用这个任务":"启用这个任务")+'"></button></td>'+
    '<td><div class="rowacts">'+
      '<button class="ric" data-tk-edit title="编辑">'+ICON.edit+'</button>'+
      '<button class="ric" data-tk-copy title="复制一条">'+ICON.copy+'</button>'+
      '<button class="ric danger" data-tk-del title="删除">'+ICON.del+'</button>'+
      '<button class="ric r-more" data-tk-more title="更多操作">'+ICON.dots+'</button>'+
    '</div></td>'+
  '</tr>';
  /* 这里原来还有一行 tr.task-detail（点时间展开的日期范围 / 执行时刻 / 周期原文）。
     整行删掉了 —— 那三样在圈 i 那个弹框（openTaskInfo）里一个不少，而且那里还多
     了优先级、音量、音源和区域，展开那一行纯属另一条更窄的路。 */
}
function taskMediaChips(t){
  return t.mediaNames.map(n=>'<span class="chip chip-media"><span class="dot"></span>'+esc(n)+'</span>').join("")+
         t.mediaGroupNames.map(n=>'<span class="chip chip-group"><span class="dot"></span>'+esc(n)+'（文件夹）</span>').join("");
}
function taskAreaChips(t){
  return t.groupNames.map(n=>'<span class="chip chip-group"><span class="dot"></span>'+esc(n)+'</span>').join("")+
         t.termNames.map(n=>'<span class="chip chip-term" title="'+statusTitle(n)+'">'+statusDot(n)+esc(n)+'</span>').join("");
}

/* ══ 复制一条任务 ════════════════════════════════════════════════════
   和铃声那边的 copyBell（js/30-view-list.js）一个做法：深拷一份、清掉 id 换一个
   临时 id、名字后面缀两个字，当场排进队列 —— 不弹编辑框，人要改再点编辑。

   **`_base` 必须删掉**：那是「这条在服务器上现在长什么样」的快照，队列拿它判
   「改了又改回去 = 白改」。这份拷贝在服务器上还**没有**这一条，带着别人的快照
   进去，万一报文正好撞上就会被当成白改、这一条新建就悄悄丢了（见 00-core 的
   queueOp 第 710 行那条判据）。 */
function copyTask(t){
  if (!t) return;
  const c = JSON.parse(JSON.stringify(t));
  c.id = null; c.tmpId = "t"+Math.random().toString(36).slice(2,8); c.isNew = true;
  delete c._base;
  c.name = (t.name||"") + " 副本";
  S.tasks.push(c);
  S.tasks.sort((a,b)=> hmsToSec(a.time)-hmsToSec(b.time));
  queueTaskSave(c);
  renderMain();
  toast("已复制「"+t.name+"」", "ok");
}

/* 删除一条任务：先问一句。行尾那枚垃圾桶和竖屏 ⋯ 单子里的「删除」走的都是这一条。
   从 S.tasks 里摘的时候按**对象**摘（不是按 id）：还没提交上去的新任务根本没有 id，
   按 id 比会把它们一起放过，那一行删了还留在表上。 */
function askTaskDelete(t){
  if (!t) return;
  const key = taskKey(t);
  openConfirm("删除定时任务「"+(t.name||"未命名")+"」","这会在服务器上删除该任务，不可撤销。",
    ()=>{
      queueTaskDelete(t);           /* 没上过服务器的那条，它自己会把「新建」从队列里撤掉 */
      S.tasks = S.tasks.filter(x=> x!==t);
      S.tsel.delete(key);
      renderMain(); toast(wroteWord(),"ok");
    }, "确认删除", true);
}
/* 「详情」那栏圈 i 后面那个弹框：任务信息 + 执行区域。
   表里放不下（也不想放）的东西都在这里 —— 区域是主角，其余是随行信息。 */
function openTaskInfo(t){
  const on = Number(t.isDone)===1;
  const hasArea = !!(t.termNames.length + t.groupNames.length);
  const hasMedia = !!(t.mediaNames.length + t.mediaGroupNames.length);
  openModal({ title: t.name||"(未命名)", sub:"定时任务 · 任务信息与执行区域", width:"560px",
    mount(b,f,mm){
      b.innerHTML =
        '<div class="stack">'+
          /* 第一行四格：执行时间 / 状态 / 音量 / 优先级 —— 都是短字段，挤一行看得完
             （连竖屏也是这样一行四格，.grid4.tk-info 里有话要说）；
             第二行两格：日期范围和执行周期是长文本，一行两格才排得下
             （竖屏上 .grid2 本来就收成单列，这儿不用额外做事）。 */
          '<div class="grid4 tk-info">'+
            '<div><span class="dimmer">执行时间</span><div class="mono">'+esc(hm(t.time))+'</div></div>'+
            '<div><span class="dimmer">状态</span><div>'+
              (on?'启用':'<span style="color:var(--fg-3)">停用</span>')+'</div></div>'+
            '<div><span class="dimmer">音量</span><div class="mono">'+esc(t.volume)+'</div></div>'+
            '<div><span class="dimmer">优先级</span><div class="mono">'+esc(t.priority)+'</div></div>'+
          '</div>'+
          '<div class="grid2">'+
            '<div><span class="dimmer">日期范围</span><div class="mono">'+esc(t.startDate)+' → '+esc(t.endDate)+'</div></div>'+
            '<div><span class="dimmer">执行周期</span><div>'+esc(taskWhen(t))+'</div></div>'+
          '</div>'+
          '<div class="sect"><div class="sect-h">音源</div>'+
            /* 说明句装在 .area-chips **里面**（和铃声编辑面板、任务编辑面板一个写法）：
               那一格自带「一行胶囊高」的下限，句子搁在外头当兄弟，这一块就还是
               18px ↔ 24.6px 地跳。 */
            '<div class="sect-b"><div class="area-chips">'+
              (hasMedia ? taskMediaChips(t)
                        : '<span class="hint">未选音源 —— 这个任务到时间没有东西可放。</span>')+
            '</div></div></div>'+
          '<div class="sect"><div class="sect-h">执行区域</div>'+
            '<div class="sect-b"><div class="area-chips">'+
              (hasArea ? taskAreaChips(t)
                       : '<span class="hint">没有设置执行区域 —— 这个任务到时间不会响。</span>')+
            '</div></div></div>'+
          /* 周期原文 + 全部时刻：一句给「这行字对不上」时查账用的话。竖屏上地方紧，
             这一行收起来（.tk-raw，见 css），宽屏照旧。 */
          '<div class="dimmer tk-raw">周期原文：'+esc(taskWhenRaw(t))+' · 执行时间：'+
            esc(t.times.map(hm).join("  "))+'</div>'+
        '</div>';
      f.innerHTML = '<span class="spacer"></span>'+
        '<button class="btn" id="tiEdit">编辑</button>'+
        '<button class="btn btn-primary" id="tiOk">关闭</button>';
      f.querySelector("#tiOk").onclick = ()=> closeModal(mm.id);
      f.querySelector("#tiEdit").onclick = ()=>{ closeModal(mm.id); openTaskEditor(t); };
    }});
}

function taskWhenRaw(t){
  if (t.timeType===3) return "指定 "+t.dates.length+" 天："+t.dates.slice(0,5).join(" ")+(t.dates.length>5?" …":"");
  if (t.timeType===0) return t.weeks.slice().sort((a,b)=>a-b).map(w=>WEEK[w]).join(" ") || "未选星期";
  return ["按周重复","按天重复","按日期区间","指定日期"][t.timeType] || ("time_type="+t.timeType);
}

/* ══ 编辑 / 新建 ═════════════════════════════════════════════════════ */
function blankTask(){
  const today = new Date().toISOString().slice(0,10);
  return {
    id:null, name:"", time:"08:00:00", times:["08:00:00"], volume:70, priority:50,
    lightId:1, ledCfgId:1, ledText:"", type:1,
    timeType:3, startDate:today, endDate:today, isDone:1,
    sound:{life_time:"00:00:10", play_model:0}, mode:0,
    mediaNames:[], mediaGroupNames:[], termNames:[], groupNames:[],
    weeks:[], dates:[today]
  };
}

/* 版式照着「添加铃声」那一张走：820px 宽、定宽 grid3 行、一块块 .sect 卡片分别装
   音源 / 执行区域 / 执行周期，连 footer 都是同一套（新建两个键、编辑三个键）。
   任务独有的配置项一个没少 —— 周期类型（含「服务器原样保留」那一档）、重复星期、
   指定日期、有效期、启用开关，全在，只是换了摆法。 */
function openTaskEditor(t){
  const isNew = !t;
  const d = isNew ? blankTask() : JSON.parse(JSON.stringify(t));
  const m = openModal({
    title: isNew ? "新建任务" : "编辑任务",
    sub: isNew ? "" : esc(t.name),
    width: "820px",
    mount(body, foot, mm){
      const q  = s => body.querySelector(s);
      const fq = s => foot.querySelector(s);

      /* ── 执行区域 ──────────────────────────────────────────────── */
      /* 每颗胶囊自带一枚 ×（areaChips 的第二参数）：删一个点位／分组不必再开一遍
         选择器 —— 那得先点「编辑区域」、再在几十行里找到它、再把勾取消掉。 */
      const drawArea = ()=>{
        const box = q("#tkArea"); if (!box) return;
        const a = {t:d.termNames||[], g:d.groupNames||[]};
        if (!a.g.length && !a.t.length){
          box.innerHTML = '<span class="hint">尚未选择 —— 没设区域的任务到时间不会响</span>';
          return;
        }
        box.innerHTML = areaChips(a, true);
        mountAreaChips(box, (k,n)=>{
          if (k==="t") d.termNames  = (d.termNames||[]).filter(x=>x!==n);
          else         d.groupNames = (d.groupNames||[]).filter(x=>x!==n);
          drawArea();
        });
      };

      /* ── 音源 ────────────────────────────────────────────────────
         渲染和绑定都用 20-ui.js 那对共用函数（soundChipsHTML / mountSoundChips），
         和「添加铃声」那张是同一份代码 —— 两个编辑框的音源从此长得一模一样。
         任务的报文两边都收（见 00-core 的 mediaJunc），所以文件夹也放得下。 */
      const drawSound = ()=>{
        const box = q("#tkSoundChips"); if (!box) return;
        box.innerHTML = soundChipsHTML(d.mediaNames, d.mediaGroupNames);
        mountSoundChips(box, (kind, n)=>{
          if (kind==="m") d.mediaNames = (d.mediaNames||[]).filter(x=>x!==n);
          else            d.mediaGroupNames = (d.mediaGroupNames||[]).filter(x=>x!==n);
          drawSound(); drawLen(); syncLife(true);
        });
      };
      const openSoundPicker = ()=>{
        openMediaPicker(d.mediaNames||[], d.mediaGroupNames||[], r=>{
          d.mediaNames = r.media.slice(); d.mediaGroupNames = r.groups.slice();
          drawSound(); drawLen(); syncLife(true);
        });
      };
      const drawLen = ()=>{
        const el = q("#tkLen"); if (!el) return;
        const mn = d.mediaNames||[], gs = d.mediaGroupNames||[];
        el.textContent = (mn.length || gs.length) ? ("合计 "+lifeTimeOf(mn)) : "未选择音源";
      };
      /* 播放时长跟着选的音源自动算；人手动改过（dataset.touched）就不再覆盖它。
         整个文件夹里有多少、放多久本地算不出来，那种情况下也不动；一个音源都没
         选时同样不动 —— 不然新建时的默认 00:00:10 一进界面就被抹成 0。 */
      const syncLife = force =>{
        const inp = q("#tkLife"); if (!inp) return;
        if ((d.mediaGroupNames||[]).length) return;
        if (!(d.mediaNames||[]).length) return;
        if (force || !inp.dataset.touched) inp.value = lifeTimeOf(d.mediaNames);
      };

      /* 「指定日期」那个日历的状态：month 交给控件自己填（null = 跟着第一个已选日期
         或今天走），dates 用 getter 现取 d.dates —— 周期类型切来切去会整个换掉
         这个数组，写死引用会指丢。 */
      const calSt = { month:null, get dates(){ return d.dates || []; } };
      let calDraw = null;          /* calMount 返回的重画函数，删 chip 时要叫一次 */

      /* ── 周期那半格：按周重复 / 指定日期 / 本面板不编辑的类型 ───── */
      const drawWhen = ()=>{
        const box = q("#tkWhenBox"); if (!box) return;
        const typed = Number(q("#tkTT").value);
        if (typed===0){
          box.innerHTML = '<label>重复星期</label><div class="quickrow">'+
            [1,2,3,4,5,6,7].map(w=>'<button class="btn btn-sm'+
              ((d.weeks||[]).indexOf(w)>=0?" btn-primary":" btn-quiet")+
              '" data-wk="'+w+'">'+WEEK[w]+'</button>').join("")+
            '</div>';
          box.querySelectorAll("[data-wk]").forEach(x => x.onclick = ()=>{
            const w = Number(x.dataset.wk); d.weeks = d.weeks||[];
            const i = d.weeks.indexOf(w);
            if (i>=0) d.weeks.splice(i,1); else d.weeks.push(w);
            drawWhen();
          });
        } else if (typed===3){
          /* 完全换成考试模式那个日历（20-ui 的 calMount）。
             从前是「日期框 + 加入 + 清空 + 一串 chip」——那个「清空」没了：日历上
             再点一下选中的那天就是取消，一天天点回去比一键抹掉更不容易手滑。
             右边那列 chip 留着，它比在日历里数格子快，点 chip 也能取消一天。 */
          box.innerHTML = '<label>指定日期 · <span class="mono" id="tkDateN"></span></label>'+
            '<div class="cal-wrap">'+
              '<div class="cal" id="tkCal"></div>'+
              '<div class="cal-side"><div class="field"><label>已选日期</label>'+
                '<div class="cal-chips" id="tkDateChips"></div></div></div>'+
            '</div>';
          const drawChips = ()=>{
            const cbox = q("#tkDateChips"); if (!cbox) return;
            const list = (d.dates||[]).slice().sort();
            cbox.innerHTML = list.length
              ? list.map(x=>'<button class="cal-chip" data-deldate="'+esc(x)+'" title="点一下取消这一天">'+
                  esc(x.slice(5))+' 周'+CAL_DOW[new Date(x+"T00:00:00").getDay()]+' '+ICON.x+'</button>').join("")
              : '<span class="hint">还没有选日期</span>';
            const n = q("#tkDateN"); if (n) n.textContent = list.length + " 天";
            $$("[data-deldate]", cbox).forEach(x => x.onclick = ()=>{
              d.dates = (d.dates||[]).filter(y=> y!==x.dataset.deldate);
              drawChips(); if (calDraw) calDraw();
            });
          };
          calDraw = calMount(q("#tkCal"), calSt, {
            toggle(iso){
              d.dates = d.dates || [];
              const i = d.dates.indexOf(iso);
              if (i>=0) d.dates.splice(i,1); else d.dates.push(iso);
              d.dates.sort();
              drawChips();
            }
          });
          drawChips();
        } else {
          box.innerHTML = '<div class="hint">该周期类型本面板不编辑，保存时原样回传。</div>';
        }
      };

      body.innerHTML =
        '<div class="stack">'+
          /* 这四格是建任务时一次要连着填完的四样。宽屏上并成一行；竖屏上按
             [data-tkf] 重排成「名称 / 时间 + 音量 + 优先级」两行（见 css/app.css
             的 ≤980 那段）。属性只是给 CSS 认人用的，DOM 顺序一个字没动。
             这儿不再有「启用」开关 —— 启停是列表里那个行尾开关的事，编辑一个任务
             的时间／音源／区域不该顺手改它的启停。 */
          '<div class="grid4 tk-top">'+
            '<div class="field" data-tkf="time"><label>执行时间</label>'+quickTimeHTML('id="tkTime"', d.time)+'</div>'+
            '<div class="field" data-tkf="name"><label>名称</label>'+
              '<input class="input" id="tkName" value="'+esc(d.name)+'" placeholder="任务1"></div>'+
            '<div class="field" data-tkf="vol"><label>音量</label>'+
              '<input class="input mono" id="tkVol" type="number" min="0" max="100" value="'+esc(d.volume)+'"></div>'+
            '<div class="field" data-tkf="pri"><label>优先级</label>'+
              '<input class="input mono" id="tkPri" type="number" value="'+esc(d.priority)+'"></div>'+
          '</div>'+

          /* 音源和「添加铃声」那边是**同一个控件**：一行已选清单 + 右上「选择音源」。
             以前这里是个下拉（常用 / 媒体文件夹 / 自定义…），和铃声那边一个下拉
             一个 chips 框，同一件事两套说法。现在两边共用 soundChipsHTML /
             mountSoundChips（20-ui.js）。 */
          '<div class="sect"><div class="sect-h">音源 <span class="sub" id="tkLen"></span>'+
            '<span class="acts"><button class="btn btn-sm" id="tkSoundPick">选择音源</button></span></div>'+
            '<div class="sect-b"><div class="stack">'+
              /* 同上：一个不带外框的排布层，胶囊直接排在里面，没有虚线箱子。 */
              '<div class="area-chips" id="tkSoundChips"></div>'+
              /* 分隔线：上面是「放什么」，下面是「怎么放」（见 css 的 .divider）。 */
              '<div class="divider"></div>'+
              '<div class="bell-play">'+
                '<div class="field"><label>播放模式</label><select class="select" id="tkMode">'+
                  '<option value="0"'+(Number(d.sound.play_model)===0?" selected":"")+'>列表播放</option>'+
                  '<option value="1"'+(Number(d.sound.play_model)===1?" selected":"")+'>循环播放</option>'+
                '</select></div>'+
                '<div class="field"><label>播放时长</label>'+
                  '<input class="input mono" id="tkLife" value="'+esc(d.sound.life_time||"00:00:10")+'"></div>'+
              '</div>'+
            '</div></div></div>'+

          /* 一级模态里只有「编辑区域」一个键 —— 「清空」挪进它弹出的那个
             二级模态里了（那里本来就有），摆在这儿等于同一件事两个入口，
             还紧挨着「编辑区域」，手一滑就把区域清空了。 */
          '<div class="sect"><div class="sect-h">执行区域<span class="acts">'+
              '<button class="btn btn-sm" id="tkPickArea">编辑区域</button>'+
            '</span></div>'+
            '<div class="sect-b"><div class="area-chips" id="tkArea"></div></div></div>'+

          '<div class="sect"><div class="sect-h">执行周期</div><div class="sect-b">'+
            '<div class="grid3">'+
              '<div class="field"><label>周期类型</label><select class="select" id="tkTT">'+
                '<option value="3"'+(d.timeType===3?" selected":"")+'>指定日期</option>'+
                '<option value="0"'+(d.timeType===0?" selected":"")+'>按周重复</option>'+
                (d.timeType!==0&&d.timeType!==3?'<option value="'+d.timeType+'" selected>'+esc(taskWhenRaw(d))+'（服务器原样保留）</option>':"")+
              '</select></div>'+
              '<div class="field"><label>开始日期</label>'+
                '<input class="input mono" id="tkStart" type="date" value="'+esc(d.startDate)+'"></div>'+
              '<div class="field"><label>结束日期</label>'+
                '<input class="input mono" id="tkEnd" type="date" value="'+esc(d.endDate)+'"></div>'+
            '</div>'+
            '<div class="field" id="tkWhenBox" style="margin-top:14px"></div>'+
          '</div></div>'+
        '</div>';

      drawSound(); drawArea(); drawWhen(); drawLen(); syncLife(true);

      q("#tkSoundPick").onclick = openSoundPicker;
      q("#tkLife").oninput = e=>{ e.target.dataset.touched = "1"; };
      q("#tkLife").onblur  = e=>{ if (!e.target.value){ delete e.target.dataset.touched; syncLife(true); } };
      q("#tkPickArea").onclick = ()=>{
        S.dt.area = {t:(d.termNames||[]).slice(), g:(d.groupNames||[]).slice()};
        openAreaEditor("pick", null, a=>{ d.termNames = a.t.slice(); d.groupNames = a.g.slice(); drawArea(); });
      };
      q("#tkTT").onchange = e => {
        const v = Number(e.target.value);
        if (v===0 && !(d.weeks||[]).length) d.weeks = [1,2,3,4,5];
        if (v===3 && !(d.dates||[]).length) d.dates = [d.startDate];
        d.timeType = v; drawWhen();
      };
      q("#tkTime").onchange = e => { d.time = (hhmmToHMS(e.target.value) || d.time); };
      /* 同样支持敲 930 —— 这个框没有实时读取器，纯靠离开焦点时改写成 09:30:00 */
      wireQuickTime(q("#tkTime"));
      q("#tkStart").onchange = e => {
        d.startDate = e.target.value;
        if (d.timeType===3 && !(d.dates||[]).length){ d.dates = [d.startDate]; drawWhen(); }
      };

      /* 编辑框里**没有删除键**：删除是列表那一行的事（宽屏行尾那枚垃圾桶、
         竖屏 ⋯ 单子里的「删除」）。摆在编辑框里等于同一件事两个入口，而且
         「保存」和「删除」并排，手一滑删掉的是一条已经配好的任务。 */
      foot.innerHTML = '<span class="spacer"></span><button class="btn" id="tkC">取消</button>'+
        (isNew ? '<button class="btn btn-primary" id="tkOk">确认创建</button>'
               : '<button class="btn btn-primary" id="tkOk">保存</button>');
      fq("#tkC").onclick = ()=> closeModal(mm.id);
      fq("#tkOk").onclick = ()=>{
        d.name = q("#tkName").value.trim();
        d.volume = Number(q("#tkVol").value)||0;
        d.priority = Number(q("#tkPri").value)||50;
        d.startDate = q("#tkStart").value || d.startDate;
        d.endDate = q("#tkEnd").value || d.endDate;
        /* d.isDone 原样带着走（新建时 blankTask 给的是 1）—— 编辑界面里没有这个
           开关了，不能在这儿把它抹成 0。 */
        d.time = (hhmmToHMS(q("#tkTime").value) || d.time);
        d.times = [d.time];
        if (!d.name){ markErr(body, q("#tkName").closest(".field")); toast("请填写名称","err"); return; }
        if (!d.termNames.length && !d.groupNames.length){ markErr(body,"#tkArea"); toast("请选择执行区域；未设置执行区域的任务不会播放","err"); return; }
        if (d.timeType===0 && !d.weeks.length){ toast("按周重复至少要选择一个星期","err"); return; }
        if (d.timeType===3 && !d.dates.length){ toast("指定日期至少要选择一天","err"); return; }
        /* 播放时长以框里那个值为准（syncLife 已经按音源补过），和铃声那边同一条规矩 */
        d.sound = {life_time: q("#tkLife").value || "00:00:10", play_model: Number(q("#tkMode").value)||0};
        d.mode = d.sound.play_model;
        if (isNew){
          d.tmpId = "t"+Math.random().toString(36).slice(2,7);
          S.tasks.push(d);
        } else {
          const i = S.tasks.findIndex(x=>Number(x.id)===Number(d.id));
          if (i>=0) S.tasks[i] = d;
        }
        queueTaskSave(d);
        closeModal(mm.id);
        S.tasks.sort((a,b2)=> hmsToSec(a.time)-hmsToSec(b2.time));
        renderMain(); toast(wroteWord(),"ok");
      };
    }});
  return m;
}

