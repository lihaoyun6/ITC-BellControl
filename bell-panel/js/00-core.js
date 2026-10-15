/* core — 工具函数、全局状态、API 层、厂商报文格式
   广播控制台 · 替代厂商后台的打铃配置面板
   ////////////////////////////////////////////////////////////// */

/* ══ 面板自己的版本 ═════════════════════════════════════════════════
   就这一个手写的常量，**发版时改它** —— 这项目没有构建步骤，浏览器也读不到 .git，
   没有别的地方能自动拿到版本号。设置页尾部「版本信息」那张表显示的就是它。
   （厂商那套的版本号不在这儿：那是服务器报上来的，见 S.srvVersion。） */
const PANEL_VERSION = "1.0.1";


/* ══ utils ══════════════════════════════════════════════════════════ */
const $  = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.prototype.slice.call((r||document).querySelectorAll(s));
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const uniq = a => Array.from(new Set(a));
const LS = {
  get(k,d){ try{ const v=localStorage.getItem("bc."+k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem("bc."+k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem("bc."+k); }catch(e){} }
};
const secToHMS = s => pad(Math.floor(s/3600))+":"+pad(Math.floor(s%3600/60))+":"+pad(Math.floor(s%60));
const hmsToSec = t => { const p=String(t||"0:0:0").split(":").map(Number); return (p[0]||0)*3600+(p[1]||0)*60+(p[2]||0); };
/* 秒数折回一天之内。JS 的 % 对负数给负余数（-3600 % 86400 === -3600），
   所以「往回调超过一天」时不能只写 +86400 再取模 —— 得先把余数掰回正的。
   时间平移现在能选「时」，一填 -25 时就会走到这条路。 */
const wrapDay = s => ((Math.round(s) % 86400) + 86400) % 86400;
/* 存的和输入框里的一律是 HH:MM:SS（秒可省略，省了就是 :00）。
   hms() 归一化，认得 "7:59" / "07:59" / "07:59:30"；hhmmToHMS 认不出来给 null。
   hm() 只管显示：秒是 00 就省掉，不是 00 就留着 —— 绝不把用户设的秒藏起来。 */
const hms = t => {
  const m = /^(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?$/.exec(String(t==null?"":t).trim());
  return m ? pad(m[1])+":"+m[2]+":"+(m[3]||"00") : String(t==null?"":t);
};
const hhmmToHMS = v => { const r = hms(v); return /^\d{2}:\d{2}:\d{2}$/.test(r) ? r : null; };
/* hm 是「显示」用的：一律给全 HH:MM:SS，秒是 00 也照显示。
   面板上凡是表示某个时刻的地方都长一个样，不用让人猜这里省没省。 */
const hm  = t => {
  const s = hms(t);
  return /^\d{2}:\d{2}:\d{2}$/.test(s) ? s : String(t==null?"":t);   /* 不是时刻就原样吐回去 */
};
const WEEK = ["","周一","周二","周三","周四","周五","周六","周日"];
/* 本地日期，不用 toISOString —— 那是 UTC，东八区早上 8 点前会差一天 */
const isoOf = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayISO = () => isoOf(new Date());

/* ══ 快速时间输入框 ═════════════════════════════════════════════════
   不用 <input type="time">。原生那个打完一位数就自作主张补零、并把焦点跳到
   下一格：想输入 11 点，敲下头一个 1 它就变成 01 且焦点跑到分钟上，接着那个 1
   落在分钟里 —— 成了 01:01。人没法「先打一个 1，再打一个 1」。

   现在是一个文本框 + 右边一枚「▾」下拉：
   - 文本框管**快**：敲多少位都行，**离开焦点（或回车）时才解析**，解析成功就把
     框里改写成标准写法，解析不出来退回进来时那个值，不清空输入。
     点进框里是全选（见 wireQuickTime），所以「改一个整点」就是点一下、敲三个
     数字，不用先去删旧的两位。
   - 下拉管**改一位**和**用鼠标挑**：时 / 分 / 秒三列 00-59，点了就改，一眼看全。

     9 / 09              → 09:00:00      930 / 0930 / 9:30  → 09:30:00
     1130 / 11:30        → 11:30:00      11:30:05 / 113005  → 11:30:05

   wireQuickTime() 之后不用改任何读取处：它规范化完会在框上派发 input + change，
   原来挂在 onchange / oninput 上的读取器照旧跑一遍，读到的是标准写法。
   （浏览器自己的 change 在 blur 之前触发，那一次读到的是生文本，解析不出来，
   读取器会原样保留旧值 —— 所以这里补派一次，把标准值送进去。） */
function parseQuickTime(raw){
  const s = String(raw==null?"":raw).trim().replace(/：/g,":");
  if (!s) return null;
  let h, mi, se;
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m){ h = m[1]; mi = m[2]; se = m[3] || "0"; }
  else {
    /* 没有冒号：按「时 分 秒」从右往左切，剩下的全是时 —— 敲 930 是 9:30 不是 93:0。
       逐档写死长度，别用 slice(-4,-2) 那种负下标：短串上负数会被夹到 0，
       "930".slice(-4,-2) 出来是 "9" 不是 "30"。 */
    const d = s.replace(/\D/g,"");
    if (!d || d.length>6) return null;
    if (d.length<=2)      { h = d;              mi = "0";            se = "0"; }
    else if (d.length===3){ h = d.slice(0,1);   mi = d.slice(1,3);   se = "0"; }
    else if (d.length===4){ h = d.slice(0,2);   mi = d.slice(2,4);   se = "0"; }
    else if (d.length===5){ h = d.slice(0,1);   mi = d.slice(1,3);   se = d.slice(3,5); }
    else                  { h = d.slice(0,2);   mi = d.slice(2,4);   se = d.slice(4,6); }
  }
  const H = Number(h), M = Number(mi), S = Number(se);
  if (!isFinite(H)||!isFinite(M)||!isFinite(S)) return null;
  if (H>23||M>59||S>59) return null;
  return pad(H)+":"+pad(M)+":"+pad(S);
}
/* 框和「▾」包在一个 .tfield 里。按钮是**绝对定位叠在框右边**的，不并排占宽度 ——
   考试模式那两个格只有 108px 宽，并排一个按钮进去，「09:30:00」就放不下了。
   框里相应留出 26px 右边距，字不会跑到按钮底下。 */
/* ph 是占位符，默认 08:00（上课、打铃都从上午开始，是个合理的空值提示）。
   考试那两格要另给：结束时间留空是有含义的（不写结束铃），露出一个 08:00
   会让人以为已经填了早上八点。 */
function quickTimeHTML(attrs, value, ph){
  const v = String(value==null?"":value).trim();
  return '<span class="tfield">'+
    '<input class="input mono t-in" '+attrs+' type="text" inputmode="numeric" autocomplete="off"'+
      ' spellcheck="false" maxlength="8" placeholder="'+esc(ph||"08:00")+'"'+
      ' title="直接敲数字：930 = 09:30，1130 = 11:30；也可以点右边的 ▾ 按时/分/秒选"'+
      ' value="'+esc(hms(v))+'">'+
    '<button type="button" class="t-drop" tabindex="-1" aria-label="按时/分/秒选">'+ICON.chevD+'</button>'+
  '</span>';
}
/* opt.emptyOK：留空是有含义的（考试模式的「结束铃」不填就是不写结束铃），
   这种框敲空了就得留空，不能像别的框那样退回进来时的值。 */
function wireQuickTime(el, opt){
  if (!el || el.dataset.qtWired) return;
  el.dataset.qtWired = "1";
  el.dataset.t0 = el.value;                 /* 解析失败时退回这个，不清空 */
  const emptyOK = !!(opt && opt.emptyOK);
  const fix = ()=>{
    const raw = String(el.value==null?"":el.value).trim();
    el.value = (!raw && emptyOK) ? "" : (parseQuickTime(raw) || el.dataset.t0 || "");
    el.dataset.t0 = el.value;               /* 收下这个值：下一次敲错就退回它，不是退回开机时那个 */
    el.dispatchEvent(new Event("input",  {bubbles:true}));
    el.dispatchEvent(new Event("change", {bubbles:true}));
  };
  el.addEventListener("blur", fix);
  el.addEventListener("keydown", e=>{ if (e.key==="Enter"){ fix(); el.blur(); } });
  /* 点进框里 = 全选。原生 type=time 是「点哪一段就高亮哪一段」，文本框没有段，
     能给的最接近的东西就是整个选中：接着敲数字就是整个换掉，不用先删。
     延到下一个 tick 再选：focus 早于 mouseup，而 mouseup 会把选区重新落成光标。 */
  el.addEventListener("focus", ()=> setTimeout(()=>{ try{ el.select(); }catch(_){} }, 0));

  const wrap = el.parentElement;
  const btn = wrap && wrap.classList && wrap.classList.contains("tfield") ? wrap.querySelector(".t-drop") : null;
  if (btn){
    /* mousedown 上 preventDefault：别让这一下把焦点从框里带走。带走了就会触发
       blur → fix → 派发 change，而考试模式那边 change 会 renderAll —— 按钮连同
       整个页面一起被重画，等 click 事件下来时按下去的那个节点已经不在文档里了，
       下拉永远打不开。 */
    btn.addEventListener("mousedown", e=> e.preventDefault());
    btn.onclick = ()=> openTimePicker(btn, el, fix);
  }
}

/* ══ 时 / 分 / 秒 转轮 ═══════════════════════════════════════════════
   三列数字，每列是一个**观察窗**：六格高，前后各垫 2.5 格，所以任何一格都能停在
   正中间；停在正中的那一格就是当前值，也只有它高亮。
   转轮有两种转法：滚（原生滚动 + scroll-snap 吸附，滚轮和触屏拖动都吃），
   以及点（点哪一格，哪一格转到中间来 —— 点下半区的往上转、点上半区的往下转，
   因为「转到中间」这件事本身就是那个方向）。
   挂 <body> 下的 #layers 里，position:fixed —— 不这样会被 .modal-body 的
   overflow 裁掉，也会被表格的 .tbl-wrap 裁掉。位置按锚点那枚「▾」算，超出视口
   就往回收，实在放不下就翻到上方。
   ≤640px 不再当 popover：css 把它盖成一块带遮罩的居中模态（位置那两下用
   !important 压掉）。三列加起来才 216px 宽，竖屏上贴在输入框边上根本按不准。
   同时只开一个：再点别的「▾」先把前一个收了。 */
let TP = null;
const TP_ROW = 32;      /* 兜底格高，和 css 里 .tp-col 的 --tp-row 对齐；量得到就用量的 */

function tpColumn(u, cur, max){
  /* 前后各垫 2.5 格。用真元素垫而不是 padding —— 滚动容器的 padding-bottom 算不
     算进可滚动区域，各浏览器历史上不一致，垫块没这个问题。 */
  let s = '<div class="tp-col" data-u="'+u+'"><div class="tp-pad"></div>';
  for (let i=0;i<=max;i++){
    const v = pad(i);
    s += '<button type="button" class="tp-cell'+(v===cur?' on':'')+'" data-v="'+v+'">'+v+'</button>';
  }
  return s+'<div class="tp-pad"></div></div>';
}
function closeTimePicker(){
  if (!TP) return;
  const t = TP; TP = null;
  t.host.remove();
  if (t.scrim) t.scrim.remove();
  document.removeEventListener("keydown", t.onKey, true);
  window.removeEventListener("pointerdown", t.onOut, true);
  window.removeEventListener("scroll", t.onScroll, true);
}
function openTimePicker(anchor, el, fix){
  if (TP && TP.anchor===anchor){ closeTimePicker(); return; }   /* 再点一下 = 收起来 */
  closeTimePicker();
  const c = (parseQuickTime(el.value) || "00:00:00").split(":");
  const host = document.createElement("div");
  host.className = "tp";
  host.innerHTML =
    '<div class="tp-head"><span>时</span><span>分</span><span>秒</span></div>'+
    '<div class="tp-cols">'+ tpColumn("h",c[0],23) + tpColumn("m",c[1],59) + tpColumn("s",c[2],59) +'</div>'+
    '<div class="tp-foot"><button type="button" class="btn btn-sm" data-tp-done>完成</button></div>';
  /* 遮罩：宽屏上 display:none，纯粹是给 ≤640px 那份「当作模态」用的 */
  const scrim = document.createElement("div");
  scrim.className = "tp-scrim";
  const layers = $("#layers") || document.body;
  layers.appendChild(scrim);
  layers.appendChild(host);

  /* 摆位置：先量后设，不然它会先在左上角闪一帧 */
  const r = anchor.getBoundingClientRect();
  const w = host.offsetWidth, h = host.offsetHeight;
  let left = Math.min(Math.max(8, r.right - w), Math.max(8, window.innerWidth  - 8 - w));
  let top  = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 6 - h);
  host.style.left = left+"px";
  host.style.top  = top+"px";

  const cols = $$(".tp-col", host);
  const rowH = col => { const b = col.querySelector(".tp-cell"); return (b && b.offsetHeight) || TP_ROW; };
  /* scrollTop = 第几格 × 格高，正好把那一格顶到窗口正中（前后各垫了 2.5 格、窗口
     六格高，两边刚好抵掉）。所以「第几格」= scrollTop ÷ 格高，四舍五入。 */
  const at = col => Math.max(0, Math.min(col.querySelectorAll(".tp-cell").length-1,
                                         Math.round(col.scrollTop / rowH(col))));
  const mark = col => {
    const list = $$(".tp-cell", col), i = at(col);
    const on = col.querySelector(".tp-cell.on");
    if (on && on !== list[i]) on.classList.remove("on");
    list[i].classList.add("on");
  };
  const idxOfOn = col => Math.max(0, $$(".tp-cell", col).indexOf(col.querySelector(".tp-cell.on")));
  const valAt = col => { const b = $$(".tp-cell", col)[at(col)]; return b ? b.dataset.v : "00"; };
  /* last 是**转轮自己**上一次报出去的数，不是 el.value。打开时三列要空降到当前值，
     那一下会派发一次 scroll，拿 el.value 比就成了「07:59 ≠ 07:59:00」地空写一次 ——
     写一次就派发一次 change，考试模式那边 change = 整页重画，光是点开「▾」就把
     整页重画一遍。跟自己的上次值比，那一下就是个空转。
     null = 三列还没空降到位，那时算出来的数不作数。 */
  let last = null, settle = 0;
  const commit = ()=>{
    if (last === null) return;
    const v = cols.map(valAt).join(":");
    if (v === last) return;
    last = v;
    el.value = v;
    /* 走和手打完全一样的那条路：解析 + 补派 input/change，读取器不用知道有转轮这回事 */
    fix();
  };

  cols.forEach(col=>{
    col.addEventListener("scroll", ()=>{
      mark(col);
      /* 滚动中间会路过一堆不该落地的值，等它停下来再往外写 —— 写一次就派发一次
         change，考试模式那边 change = 整页重画。 */
      clearTimeout(settle);
      settle = setTimeout(commit, 140);
    }, {passive:true});
    col.scrollTop = idxOfOn(col) * rowH(col);   /* 打开就空降到当前值，不是停在 00 */
  });
  last = cols.map(valAt).join(":");

  const onKey    = e=>{ if (e.key==="Escape"){ e.stopPropagation(); closeTimePicker(); } };
  const onOut    = e=>{ if (TP && !TP.host.contains(e.target) && !TP.anchor.contains(e.target)) closeTimePicker(); };
  /* 页面一动就跟锚点错位了，直接收掉，不追 */
  const onScroll = e=>{ if (TP && !TP.host.contains(e.target)) closeTimePicker(); };
  TP = { host, scrim, anchor, onKey, onOut, onScroll };
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onOut, true);   /* pointerdown 早于 click：先收起来，那一下照样落到它该落的地方 */
  window.addEventListener("scroll", onScroll, true);

  host.addEventListener("click", e=>{
    if (e.target.closest("[data-tp-done]")){ clearTimeout(settle); commit(); closeTimePicker(); return; }
    const b = e.target.closest(".tp-cell");
    if (!b) return;
    const col = b.closest(".tp-col");
    const list = $$(".tp-cell", col), i = list.indexOf(b);
    const t = i * rowH(col);
    if (col.scrollTo) col.scrollTo({top:t, behavior:"smooth"}); else col.scrollTop = t;
  });
}

/* ══ 全局时间偏移 ═══════════════════════════════════════════════════
   偏移量是「面板 → 服务器」这个方向上的差值：

     偏移 −60 秒 · 面板上设 06:00:00 → 报文里出去的是 05:59:00
     偏移 +60 秒 · 面板上设 06:00:00 → 报文里出去的是 06:01:00

   反过来读的时候必须减回去：服务器上躺着 05:59:00，面板里就得显示 06:00:00。
   这一步不能省 —— 读回来如果原样显示 05:59:00，用户不动它、直接保存，写出去就
   成了 05:58:00，每存一次再偏一分钟，来回几趟时间就跑没了。所以读写成对：
     offsetHMS   写：面板 → 报文
     unoffsetHMS 读：报文 → 面板
   ══════════════════════════════════════════════════════════════════ */
const wrapHMS = sec => secToHMS(((sec % 86400) + 86400) % 86400);   /* 秒 → HH:MM:SS，跨零点绕回来 */
function offsetHMS(t){                     /* 面板 → 服务器 */
  if (!S.offsetSec) return t;
  return wrapHMS(hmsToSec(t) + Number(S.offsetSec));
}
function unoffsetHMS(t){                   /* 服务器 → 面板 */
  if (!S.offsetSec) return t;
  return wrapHMS(hmsToSec(t) - Number(S.offsetSec));
}
/* 这里原本还有个 offsetLabel()（「不偏移」「−1分」这种给人看的短标签），
   只喂给设置页数字框旁边那行「当前 ⋯」。那行去掉了，函数跟着走 —— 留着没人调。 */

/* ══ 共享常量 ═══════════════════════════════════════════════════════
   放在 S 前面 —— S 的初始值要用到 PREP_MIN_DEFAULT，而 const 有 TDZ，
   声明在下面的话 S 求值时会直接抛 ReferenceError。 */
const DRAFT_ON = false;                     /* 新建时的默认：草稿模式**关着** */
/* ══ 两个模式的界面入口（草稿模式 / 调试模式）════════════════════════
   **收着**：顶栏那枚「草稿模式」开关、设置页「发送方式」那张面板（里面是两个开关），
   一律不渲染 —— 整块不生成，不是藏起来（`.switch input` 那种藏法还在 DOM 里活着）。
   **要放回来就改这一个值**，别处一行都不用动。

   收着的时候两个模式按「关」处理（见下面 S 里那两行）：界面里已经没有能把它们打开的
   地方了，本机存着的那份旧偏好（bc.draft / bc.debug）要是还算数就是个死结 ——
   改一下先攒着，而「提交」按钮跟着草稿模式一起不显示，改动就永远发不出去。

   随之而来的：草稿模式关着 = 改一下就写一下，走的是面板本来就有的那条即时路径
   （queue 里 settle 掉），不是这次新加的。 */
const SHOW_MODE_SWITCHES = false;
const PREP_MEDIA = "预备铃.mp3";
const PREP_MIN_DEFAULT = 3;                 /* 新建铃声时「预备铃提前量」的默认值 */
const prepMinOf = b => {
  const n = Number(b && b.prepMin);
  /* >=1，不是 >=0：0 会让预备铃和上课铃同一时刻响，那是配置错误不是意图。
     空字符串/null/undefined 都会落到默认值上。 */
  return (isFinite(n) && n >= 1) ? n : PREP_MIN_DEFAULT;
};

/* ══ state ══════════════════════════════════════════════════════════ */
const S = {
  /* 服务器地址**默认留空** —— 这是要公开出去的代码，不该把某一所学校的内网地址
     写死在默认值里。人在登录页填一次就行，填过之后浏览器自己记着（见
     30-view-list 的登录卡片，端口默认 81）。 */
  server : LS.get("server",""),
  token  : null,
  tenant : null,
  user   : null,
  /* 厂商那套的版本号，服务器报上来的（形如 V1.0(内部版本V2.9.10)）——
     所有报文形状都是冲着它写的，出问题时第一眼就该看见它。开局先读本机存的
     那一份：刷新页面不经过 /auth，不读它就只能显示「—」，见 10-data.js。 */
  srvVersion : LS.get("srvVersion",""),
  /* 草稿模式：开着 = 改动先攒着，按「提交」才写服务器；关掉 = 改一下就写一下。
     默认**关着**（用户定的）。入口收着的时候这一项恒为 false，见 SHOW_MODE_SWITCHES。 */
  draft  : SHOW_MODE_SWITCHES ? LS.get("draft", DRAFT_ON) !== false : false,
  /* 调试模式：按「提交」时先摊开提交队列让你看一眼报文，再点「发送」才真发。
     平时不摊，直接二次确认后提交走。入口同样收着。 */
  debug  : SHOW_MODE_SWITCHES ? LS.get("debug", false) === true : false,
  conn   : "idle",
  data   : {groups:[], terminals:[], termGroups:[], medias:[], mediaGroups:[], strategies:[]},
  groupId: null,
  bells  : [],
  /* bells 是**哪张列表**的。selectGroup 是先改 groupId、renderAll 一次、才去拉铃声的，
     中间那一帧里 groupId 已经指向新列表、bells 还是旧列表的 —— 分组要按 bells 清账
     （见 js/35-groups.js 的 grpReconcile），认错了就会把新列表的分组当成死账抹掉。 */
  bellsListId: null,
  listArea: {t:[], g:[]},
  pending: [],
  sel    : new Set(),
  tsel   : new Set(),          // 定时任务表里勾中的行（存 taskKey，不是 id）
  view   : undefined,          // undefined | "app"
  mode   : "list",             // "list" | "tasks" | "exam" | "settings" | "more" —— 主区显示哪个视图
  /* 「铃声计划」页窄到一次只能显示一栏时，现在看的是哪一栏。
     true = 详情（用户点过某条任务），false = 任务列表。桌面/平板并排显示时
     这个值不起作用（CSS 只在 ≤640px 认它），所以不用跟着视口宽度去改它。
     不落 localStorage：这是「这次点开了哪一条」，不是偏好设置。 */
  showDetail: false,
  tasks  : [],                 // 定时任务（不属于任何铃声列表）
  wsIp   : null,               // 状态推送的 WebSocket 地址（/language 返回）
  link   : "off",              // 状态推送连接：off | busy | ok | bad
  termStat: {},                // 点位名 → "online" | "offline"（见 15-status.js）
  offsetSec: Number(LS.get("offsetSec", 0)) || 0,   // 全局时间偏移（秒，可为负）
  settingsOpen: false,
  exam   : null,               // 考试模式（loadExam() 在 loadAll() 之后填充）
  /* dt = 各种「对话框开到一半」的临时状态。medQ/medG/medSel 曾经也在这儿，
     是旧那套批量改铃音选择器的 —— 换成 openMediaPicker 之后它自己管自己的
     st，全局这份没人问了，删掉。 */
  dt: {fq:"", areaTab:"term", areaQ:"", areaGroup:"all", area:{t:[],g:[]}}
};
const DEFAULT_GROUP = LS.get("lastGroup", null);

/* ══ 图标 ════════════════════════════════════════════════════════════
   全部来自 https://lucide.dev/icons ，原样抄的 24×24 描边图标 ——
   不自己画。stroke 用 currentColor，所以跟着按钮文字的颜色走。
   用法：'<button class="btn">'+ICON.plus+' 添加</button>'
   ══════════════════════════════════════════════════════════════════ */
const svgIcon = d => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '+
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+d+'</svg>';
const ICON = {
  /* pencil */
  edit: svgIcon('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  /* copy */
  copy: svgIcon('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  /* trash-2 */
  del : svgIcon('<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  /* ellipsis —— 竖屏上铃声表行尾那枚「⋯」：三个图标（编辑/复制/删除）收进它
     点开的小单子里，见 30-view-list.js 的 openRowMenu。 */
  dots: svgIcon('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
  /* settings */
  gear: svgIcon('<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>'),
  /* x —— 两处在用：日期胶囊上「点一下取消这一天」，以及考试分区只剩一个时
     替掉垃圾桶的那枚「清空配置」（语义差别在 40-view-exam.js 的 examSectionHTML 里）*/
  x   : svgIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  /* plus */
  plus: svgIcon('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  /* zap */
  zap : svgIcon('<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'),
  /* refresh-cw */
  refresh: svgIcon('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  /* chevron-left / chevron-right / chevron-down */
  chevL: svgIcon('<path d="m15 18-6-6 6-6"/>'),
  chevR: svgIcon('<path d="m9 18 6-6-6-6"/>'),
  chevD: svgIcon('<path d="m6 9 6 6 6-6"/>'),
  /* clock —— 时间列下面那行「服务器上真正存着的时刻」用它当标记 */
  clock: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  /* monitor —— 顶栏「终端 xx/xx」前面那个标记（原来是个绿点，换成显示器） */
  monitor: svgIcon('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>'),
  /* info —— 定时任务表「详情」那一栏的圈 i：点开看任务信息与执行区域。
     原来是放大镜，可这儿的语义不是「搜索」而是「关于这一条」，圈 i 才对得上。 */
  info: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  /* check —— 批量条上的「启用」。和 x（停用）成对，两个都是只做一件事的图标键，
     文字写在 title/aria-label 里。 */
  check: svgIcon('<path d="M20 6 9 17l-5-5"/>'),
  /* music —— 批量编辑菜单里「改铃音」那一行。系统里没有第二个地方需要乐器记号，
     但那一列四个动作总得各自有个记号，光靠文字排一行分不出层次。 */
  music: svgIcon('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  /* user —— 顶栏那个头像圈里的人头。**这是个图标，不是谁的照片**：面板拿不到
     头像图片（服务器 user.avatar 从没见过真值），所以它只在说「这是登录用户那一格」，
     谁登着看右边那行字和 title。 */
  user: svgIcon('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  /* 下面三个只给竖屏那条底部导航栏用（见 30-view-list.js 的 renderNavbar）——
     那一排是「图标在上、文字在下」，图标是主、字是辅，所以四个页签得各有一个
     一眼能认出来的记号；顶栏那排页签是纯文字，用不上它们。 */
  /* bell —— 铃声计划 */
  bell : svgIcon('<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>'),
  /* clipboard-check —— 考试模式（一张打了勾的考卷）。和定时任务的 clock 摆在一起
     分得开：一个是「到点做事」，一个是「这一场考试」。 */
  exam : svgIcon('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>'),
  /* layout-grid —— 更多功能（四方格）。「还有别的」这件事，四方格是最短的说法。 */
  grid : svgIcon('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>')
};

/* ══ api ════════════════════════════════════════════════════════════ */
const BASE = () => S.server.replace(/\/+$/,"") + "/api/v2";

async function api(method, path, opts){
  opts = opts || {};
  let url = BASE() + path;
  if (opts.params){
    const q = new URLSearchParams();
    Object.keys(opts.params).forEach(k=>{ if(opts.params[k]!=null && opts.params[k]!=="") q.append(k, opts.params[k]); });
    const qs = q.toString();
    if (qs) url += (url.indexOf("?")>=0?"&":"?") + qs;
  }
  const headers = {"Accept":"application/json"};
  if (S.token) headers["authorization"] = S.token;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try{
    res = await fetch(url, {method, headers, body: opts.body!==undefined ? JSON.stringify(opts.body) : undefined});
  }catch(e){
    const err = new Error("无法连接服务器（浏览器可能拦截了跨域请求，见右下角说明）");
    err.network = true; throw err;
  }
  let json = null;
  try{ json = await res.json(); }catch(e){}
  if (!res.ok){
    /* 401 = 令牌到点了（服务器原话「登录过期,请重新登录!」）。页面开着的这段时间里
       没人看这个钟，所以在这儿补一次：拿本机记住的用户名密码静默换一张令牌，再把
       这一趟**原样重发一次**。全部交代在 10-data.js 的 reLogin()。
       三道闸：noRetry（reLogin 自己那趟 /auth 不能再进来）、retried（重发只做一次，
       不循环）、S.view（退出登录之后不再自动连回去）。 */
    if (res.status === 401 && !opts.noRetry && !opts.retried && S.view === "app"){
      const how = await reLogin();
      if (how === "ok") return api(method, path, Object.assign({}, opts, {retried:true}));
      if (how === "failed") kickToLogin();
    }
    const r = json && json.result;
    const msg = (r && (r.message || (Array.isArray(r) ? r[0] : null))) || (json && json.message) || ("HTTP " + res.status);
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status; err.body = json; throw err;
  }
  return json ? json.result : null;
}

/* ══ toasts ═════════════════════════════════════════════════════════ */
/* 只弹**没做成**的那两种：错误（err）、警告（warn），以及没写 kind 的那些
   「这一步没做成」（比如「请先选择执行区域」）。
   **成功（ok）的一律不弹** —— 「已写入服务器」「已复制」这类报喜通知攒起来最吵，
   而且它们报的那件事，屏幕上本来就看得见（那一行变了、那一格数字动了）。
   闸就在这一行：调用点照旧把 kind 写全，哪天要放回来改这儿一处。

   同屏最多六条。第七条进来时**最老的那条当场撤掉**，不等它自己淡出 ——
   通知一条压一条往上摞，攒到七八条就顶出屏幕，而这一堆本来也没人一条条读完。
   最老的在最上面：新的都 append 在末尾，摞子是往上长的（CSS 里钉在右下角）。 */
const TOAST_MAX = 6;
function toast(msg, kind){
  if (kind === "ok") return;
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast " + (kind||"");
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > TOAST_MAX) box.removeChild(box.firstElementChild);
  setTimeout(()=>{ el.style.transition="opacity .25s"; el.style.opacity="0"; setTimeout(()=>el.remove(),260); }, kind==="err"?6200:3200);
}
/* 把一段文字塞进剪贴板。
   两条路，好的那条先试 —— 因为面板既可能跑在 http 上，也可能被部署到 https 上，
   同一条路没法两头都通：

     1. navigator.clipboard.writeText：https / localhost / file:// 这些**安全上下文**
        里才有，那儿它能用且不挑浏览器。
     2. 「选中 + execCommand」：早被打上废弃标记，可它在 http 下是唯一能用的那条。

   两条路各自的坑写在下面各自那一段里。 */
function copyText(text, okMsg){
  const str = String(text==null?"":text);
  const done = ok => toast(ok ? (okMsg||"已复制") : "复制失败 —— 请手动选中文字再复制", ok?"ok":"err");

  /* 老办法：选中 + execCommand。用一个飘在屏幕外的 textarea 装文字，它可选中、
     又不会被看见，也没有 contenteditable 那套「复制时把格式也带走」的毛病。 */
  const legacy = ()=>{
    const ta = document.createElement("textarea");
    ta.value = str;
    ta.setAttribute("readonly","");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch(e){ ok = false; }
    ta.remove();
    done(ok);
  };

  /* 有 navigator.clipboard 就用它 —— 判断存在是必须的，不是保险：厂商后台不带
     https，这个面板平时就是 http 打开的，那不是安全上下文，这个属性在那儿是
     undefined，直接 .writeText() 会当场抛异常。
     writeText 返回 Promise，它可能**异步**失败（用户拒了权限、浏览器不认），
     所以拒绝回调里要再走一遍老路，而不是直接把失败报给用户。 */
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(str).then(()=> done(true), legacy);
    return;
  }
  legacy();
}

/* ══ 厂商的联结数组 ─────────────────────────────────────────────────
   大坑：这四个数组服务器是**按 id 认人**的，只给 name 等于没给 —— 报文
   200 通过，可原版面板里打开「执行区域」是空的，我们拉回来也是空的。
   厂商选择器组件里的默认配置（app.js）写得很明白：
     terminalsColumnName:"id"        → terminalsRequestColumnName:"terminals_id"
     terminalsGroupsColumnName:"id"  → ...RequestColumnName:"terminals_groups_id"
     mediasColumnName:"id"           → mediasRequestColumnName:"medias_id"
     mediasGroupsColumnName:"id"     → ...RequestColumnName:"medias_groups_id"
   所以每一项都要 [{name, <id 键>}]。id 优先用「拉回来时记住的」（保证
   原样往返、名字改了也不丢），其次按名字去主数据里查。 */
function idMapOf(arr, key){
  const m = {};
  (arr||[]).forEach(x=>{
    if (!x || x.name==null) return;
    const v = x[key]!=null ? x[key] : x.id;
    if (v!=null) m[x.name] = Number(v);
  });
  return m;
}
function masterId(list, name){
  const x = (list||[]).find(y=>y.name===name);
  return x && x.id!=null ? Number(x.id) : null;
}
function junction(map, name, key, list){
  const id = (map && map[name]!=null) ? Number(map[name]) : masterId(list, name);
  const o = {name: name};
  if (id!=null && !isNaN(id)) o[key] = id;
  return o;
}
/* 一组区域名 → 厂商报文的两个联结数组（考试、还原等处共用） */
const areaJunc = (t, g) => ({
  terminals:        (t||[]).map(n=>junction(null, n, "terminals_id",        S.data.terminals)),
  terminals_groups: (g||[]).map(n=>junction(null, n, "terminals_groups_id", S.data.termGroups))
});
/* 一组音源名 → 两个音源联结数组 */
const mediaJunc = (m, mg) => ({
  medias:        (m ||[]).map(n=>junction(null, n, "medias_id",        S.data.medias)),
  medias_groups: (mg||[]).map(n=>junction(null, n, "medias_groups_id", S.data.mediaGroups))
});

/* ══ normalize a server bell → panel bell ═══════════════════════════ */
function normBell(b){
  /* 报文的时刻先减掉全局偏移，还原成用户当初设的那一刻（见上面的 offsetHMS/unoffsetHMS） */
  const raw = String(b.execute_time||"").split(",").filter(Boolean);
  const times = raw.map(unoffsetHMS);
  return {
    id: b.id,
    name: b.name,
    times: times.length ? times : ["08:00:00"],
    time: times[0] || "08:00:00",
    _rawTimes: raw,          /* 服务器上原样躺着的时刻，改偏移量时靠它重算显示 */
    strategyId: b.timing_bells_strategy_id,
    isDone: Number(b.is_done)||0,
    type: b.type==null?1:b.type,
    priority: b.priority==null?50:b.priority,
    volume: b.volume==null?70:b.volume,
    mode: b.timing_bells_mode==null?1:b.timing_bells_mode,
    lightId: b.terminals_light_id==null?1:b.terminals_light_id,
    ledText: b.led_text||"",
    ledCfgId: b.led_display_cfg_id||1,
    sound: b.sound_source ? {life_time:b.sound_source.life_time, play_model:b.sound_source.play_model,
                             ...(b.sound_source.play_number!=null?{play_number:b.sound_source.play_number}:{})} : {life_time:"00:00:00",play_model:0},
    mediaNames: (b.medias||[]).map(m=>m.name),
    mediaGroupNames: (b.medias_groups||[]).map(m=>m.name),
    termNames: (b.terminals||[]).map(t=>t.name),
    groupNames: (b.terminals_groups||[]).map(g=>g.name),
    /* 名字 → id，写回去时要带上（见上面 junction 的说明） */
    termIds: idMapOf(b.terminals, "terminals_id"),
    groupIds: idMapOf(b.terminals_groups, "terminals_groups_id"),
    mediaIds: idMapOf(b.medias, "medias_id"),
    mediaGroupIds: idMapOf(b.medias_groups, "medias_groups_id"),
    isNew: false
  };
}
const areaKey = b => JSON.stringify([b.termNames.slice().sort(), b.groupNames.slice().sort()]);
const sameArea = (a,b) => JSON.stringify([a.termNames.slice().sort(),a.groupNames.slice().sort()]) === JSON.stringify([b.termNames.slice().sort(),b.groupNames.slice().sort()]);

/* area fingerprint of a bell */
function bellArea(b){ return {t:b.termNames.slice(), g:b.groupNames.slice()}; }

/* recompute the list-level default area = most common non-empty area among bells */
function recomputeListArea(){
  const tally = new Map();
  S.bells.forEach(b=>{
    if (!b.termNames.length && !b.groupNames.length) return;
    const k = areaKey(b);
    if (!tally.has(k)) tally.set(k, {n:0, t:b.termNames.slice(), g:b.groupNames.slice()});
    tally.get(k).n++;
  });
  let best = null;
  tally.forEach(v=>{ if(!best || v.n > best.n) best = v; });
  S.listArea = best ? {t:best.t, g:best.g} : {t:[], g:[]};
}
const isOverride = b => {
  const k = areaKey(b), lk = JSON.stringify([S.listArea.t.slice().sort(), S.listArea.g.slice().sort()]);
  return k !== lk;
};
const isEmptyArea = b => !b.termNames.length && !b.groupNames.length;

/* ── 名称 ↔ 分组 的成员关系（服务器只回了点位，分组归属在点位里）──
   这五个原来住在 40-view-exam.js 里。它们**跟考试没有任何关系**，只是当初第一
   个用得上的是考试模式，就顺手写在那儿了；「更多功能」页的终端反查也要用，
   从一个叫 exam 的文件里 import 通用的区域助手说不过去，所以搬到这儿 ——
   纯粹是 S.data 上的查询，谁都能用。 */
function groupByName(n){ return S.data.termGroups.find(g=>g.name===n); }
function groupsOfTerminal(n){
  const t = S.data.terminals.find(x=>x.name===n);
  if (!t) return [];
  return uniq((t.with_groups||[]).map(w=>{
    const g = S.data.termGroups.find(x=>Number(x.id)===Number(w.terminals_groups_id));
    return g?g.name:null;
  }).filter(Boolean));
}
/* 一个混着分组名和点位名的列表 → {t,g}，用于画区域标签和喂给选择器 */
function splitNames(names){
  const t=[], g=[];
  (names||[]).forEach(n=> (groupByName(n)?g:t).push(n));
  return {t,g};
}
function groupMembers(n){
  const g = groupByName(n); if (!g) return [];
  return S.data.terminals.filter(t=>(t.with_groups||[]).some(w=>Number(w.terminals_groups_id)===Number(g.id))).map(t=>t.name);
}
/* "2026-10-14" → 1..7（周一=1 … 周日=7），和厂商 repeat_weeks 的编号一致。
   JS 的 getDay() 是 0=周日，只有这一个地方要换算。 */
function weekNumOf(dstr){
  const g = new Date(String(dstr).slice(0,10)+"T00:00:00").getDay();
  return g===0 ? 7 : g;
}

/* ══ payload builder — the "format to vendor" layer ═════════════════ */
function buildPayload(b){
  return {
    name: b.name,
    timing_bells_strategy_id: Number(b.strategyId),
    timing_bells_groups_id: Number(S.groupId),
    terminals_light_id: Number(b.lightId),
    volume: Number(b.volume),
    type: Number(b.type),
    priority: Number(b.priority),
    sound_source: b.sound,
    is_done: Number(b.isDone),
    timing_bells_mode: String(b.mode),
    execute_time: b.times.map(offsetHMS).join(","),   /* ← 全局时间偏移在这里生效 */
    terminals:        b.termNames.map(n=>junction(b.termIds, n, "terminals_id", S.data.terminals)),
    terminals_groups: b.groupNames.map(n=>junction(b.groupIds, n, "terminals_groups_id", S.data.termGroups)),
    medias:           b.mediaNames.map(n=>junction(b.mediaIds, n, "medias_id", S.data.medias)),
    medias_groups:    b.mediaGroupNames.map(n=>junction(b.mediaGroupIds, n, "medias_groups_id", S.data.mediaGroups)),
    led_text: b.ledText || "",
    led_display_cfg_id: Number(b.ledCfgId)
  };
}
const createPayload = b => buildPayload(b);
/* 同一条铃声换个列表发送（考试模式要跨列表裁剪正常计划） */
const bellBodyIn = (b, listId) => Object.assign(buildPayload(b), {timing_bells_groups_id: Number(listId)});

/* ══ pending operations ═════════════════════════════════════════════
   草稿模式：改动进队列等着提交。即时模式：进队列的同时立刻发出去，
   队列只当日志用（见 50-drawer.js 的 sendNow / runOp）。

   抵消：一条报文如果正好把这个实体改回服务器上现在的样子，那就是「净变化
   为零」—— 连同它之前压着的那条一起撤掉。草稿模式下开了又关，不该真发两条。
   判据是整份报文文本相等，所以每条 op 都带着 base =「这个实体第一次进队列
   之前」的那份报文；第二次进来时从队列里继承，不是重新拍。 */
let opSeq = 0;
function queueOp(op){
  const key = String(op.bellId);
  /* 同一个实体、同一条 url、同一种方法才算「同一条的后来者」。只按实体认的话，
     一个列表的「先删掉」会被它的「改属性」顶掉，那是两件事。 */
  const same = o => o.status==="pending" && String(o.bellId)===key && o.method===op.method && o.url===op.url;
  const prev = S.pending.filter(same);

  if (!S.draft){
    op.seq = ++opSeq; op.status = "pending";
    S.pending.push(op);
    renderTopbar(); renderMain(); renderDrawer();
    sendNow(op);
    return;
  }

  /* filter(same) 是留下匹配的那些 —— 要撤掉的是匹配的那条，得取反 */
  if (prev.length){ op.base = prev[0].base; S.pending = S.pending.filter(o=> !same(o)); }
  op.seq = ++opSeq; op.status = "pending";
  if (op.base != null && op.body && JSON.stringify(op.body) === op.base){
    toast("「"+op.label+"」已恢复为服务器当前配置，无需提交","ok");
  } else {
    S.pending.push(op);
  }
  renderTopbar(); renderMain(); renderDrawer();
}
function queueUpdate(b, why){
  queueOp({
    kind:"update", method:"PUT",
    url:"/timing-bells/" + b.id,
    body: buildPayload(b),
    base: b._base,
    bellId: b.id, label: b.name || "(未命名)",
    sub: "更新 · " + (why||"改区域")
  });
}
function queueCreate(b){
  queueOp({
    kind:"create", method:"POST",
    url:"/timing-bells",
    body: createPayload(b),
    bellId: b.tmpId, label: b.name,
    sub: "新建 · " + hm(b.time)
  });
}
/* 有 id 才是更新，没有就是新建 —— 复制 / 快速创建出来的铃声在提交上去之前没有 id，
   对它发 PUT /timing-bells/null 只会 404。 */
const queueSave = (b, why) => b.id ? queueUpdate(b, why) : queueCreate(b);
function queueDelete(b){
  if (!b.id || b.isNew){                       /* 还没上过服务器：撤掉那条「新建」就行 */
    S.pending = S.pending.filter(o=> String(o.bellId)!==String(b.tmpId!=null?b.tmpId:b.id));
    S.bells = S.bells.filter(x=>x!==b);
    renderTopbar(); renderMain(); renderDrawer();
    return;
  }
  queueOp({
    kind:"delete", method:"DELETE",
    url:"/timing-bells/" + b.id,
    body: {timing_bells_groups_id: Number(S.groupId)},
    bellId: b.id, label: b.name,
    sub: "删除 · " + hm(b.time)
  });
}
/* 启停也发**整条**报文。厂商自己的快捷开关只发 {type, is_done}，但我们不赌
   服务器是合并还是整体替换 —— 整体替换的话那一下就顺手把执行区域清空了。 */
function queueToggle(b, on){
  queueOp({
    kind:"update", method:"PUT",
    url:"/timing-bells/" + b.id,
    body: Object.assign(buildPayload(b), {timing_bells_groups_id: Number(S.groupId), is_done: on?1:0}),
    base: b._base,
    bellId: b.id, label: b.name,
    sub: on ? "启用" : "停用"
  });
}
const pendingFor = id => S.pending.filter(o=>o.bellId===id && o.status==="pending");

/* 偏移量一改，所有时刻的显示都得重算 —— 面板上的时刻是「服务器上那一刻」减掉偏移
   得来的，光重画没用，b.times 里躺的还是老偏移算出来的值（服务器上 6:49、偏移改成
   −60 之后，面板该显示 6:50，不是 6:49）。 */
function reapplyOffset(){
  const fix = (o, payload) => {
    if (!o._rawTimes) return;                    /* 本地新建的，时刻本来就是面板里的 */
    if (pendingFor(o.id).length){                /* 用户手改过的，面板上的时刻说了算 */
      o._rawTimes = o.times.map(offsetHMS);
      return;
    }
    const t = o._rawTimes.map(unoffsetHMS);
    if (!t.length) return;
    o.times = t;
    o.time = t[0];
    if (o.id) o._base = JSON.stringify(payload(o));
  };
  S.bells.forEach(b=> fix(b, buildPayload));
  S.tasks.forEach(t=> fix(t, taskPayload));
  S.bells.sort((a,b)=> hmsToSec(a.time)-hmsToSec(b.time));
}
/* 提示语得跟着模式走：草稿模式下是「攒着」，即时模式下是「已经写进去了」 */
const wroteWord = () => S.draft ? "已加入待提交" : "已写入服务器";
const tailFor   = () => S.draft ? "，改动待提交" : "，已写入服务器";

/* 关草稿 = 把攒着的这些一次性发出去。开着的时候是攒着不动。
   请求顺序不能乱：新建列表拿回来的 id 要给后面的铃声用，所以串行（见 sendChain）。 */
function setDraft(on){
  S.draft = !!on;
  LS.set("draft", S.draft);
  renderTopbar(); renderMain(); renderDrawer();
  if (!S.draft){
    const n = S.pending.filter(o=>o.status==="pending").length;
    if (n) pushAll(); else toast("草稿模式已关闭，所有修改将即时生效","ok");
  } else {
    toast("已启用草稿模式，修改将被缓存并等待提交","ok");
  }
}

/* ══ 定时任务 ════════════════════════════════════════════════════════
   不属于任何铃声列表的独立定时播放，接口 /timing-tasks。
   time_type: 0=按周重复(repeat_weeks) 1=按天重复(repeat_days)
              2=按日期区间(between_dates) 3=指定日期(assign_dates)
   ══════════════════════════════════════════════════════════════════ */
function normTask(t){
  const medias = (t.medias||[]).map(m=>m.name);
  const groups = (t.terminals_groups||[]).map(g=>g.name);
  /* 同样要把全局偏移减回去，不然编辑框里显示的是服务器上的那一刻 */
  const raw = String(t.execute_time||"00:00:00").split(",").filter(Boolean);
  const tms = raw.map(unoffsetHMS);
  const times = tms.length ? tms : ["00:00:00"];
  return {
    id: Number(t.id), isNew:false,
    name: t.name || "",
    time: times[0],
    times: times,
    _rawTimes: raw,
    volume: Number(t.volume)||70,
    priority: Number(t.priority)||50,
    lightId: Number(t.terminals_light_id)||1,
    ledCfgId: Number(t.led_display_cfg_id)||1,
    ledText: t.led_text||"",
    type: Number(t.type)||1,
    timeType: Number(t.time_type)||0,
    startDate: (t.start_date||"").slice(0,10),
    endDate: (t.end_date||"").slice(0,10),
    isDone: Number(t.is_done)||0,
    sound: t.sound_source || {life_time:"00:00:10", play_model:0},
    mode: (t.sound_source && Number(t.sound_source.play_model))||0,
    mediaNames: medias,
    mediaGroupNames: (t.medias_groups||[]).map(m=>m.name),
    termNames: (t.terminals||[]).map(x=>x.name),
    groupNames: groups,
    weeks: (t.repeat_weeks||[]).map(w=>Number(w.repeat_weeks)),
    dates: (t.assign_dates||[]).map(d=>d.dates)
  };
}
function taskPayload(t){
  return {
    name: t.name,
    start_date: t.startDate,
    end_date: t.endDate,
    volume: Number(t.volume),
    priority: Number(t.priority),
    time_type: Number(t.timeType),
    terminals_light_id: Number(t.lightId),
    execute_time: offsetHMS(t.time),                  /* ← 全局时间偏移 */
    type: Number(t.type),
    sound_source: t.sound,
    /* 写进去的是裸数组，读回来是带 id 的对象（厂商自己的前端也这么不对称：
       GET 给 [{repeat_weeks:1}] / [{dates:"2026-10-13"}]，POST 收 [1] / ["2026-10-13"]） */
    repeat_weeks:   t.timeType===0 ? t.weeks.map(Number) : [],
    assign_dates:   t.timeType===3 ? t.dates.slice() : [],
    ...areaJunc(t.termNames, t.groupNames),
    ...mediaJunc(t.mediaNames, t.mediaGroupNames),
    led_text: t.ledText||"",
    led_display_cfg_id: Number(t.ledCfgId)
  };
}
function queueTaskSave(t){
  const isNew = !t.id;
  queueOp({
    kind: isNew?"task-create":"task-update",
    method: isNew?"POST":"PUT",
    url: isNew ? "/timing-tasks" : "/timing-tasks/"+t.id,
    body: taskPayload(t),
    base: t._base,
    bellId: "task:"+(t.id||t.tmpId), entity:"task",
    label: t.name,
    sub: (isNew?"新建":"更新") + " · " + hm(t.time) + " · " + taskWhen(t),
    onOk: r=>{ const id = r && (r.id || (r.result && r.result.id)); if (isNew && id){ t.id=Number(id); t.isNew=false; } }
  });
}
function queueTaskToggle(t, on){
  queueOp({
    kind:"task-update", method:"PUT", url:"/timing-tasks/"+t.id,
    body: Object.assign(taskPayload(t), {is_done: on?1:0}),
    base: t._base,
    bellId:"task:"+t.id, entity:"task", label:t.name,
    sub: on?"启用":"停用"
  });
}
function queueTaskDelete(t){
  if (!t.id || t.isNew){                       /* 还没上过服务器：撤掉那条「新建」就行 */
    S.pending = S.pending.filter(o=> String(o.bellId)!==String("task:"+(t.tmpId!=null?t.tmpId:t.id)));
    S.tasks = S.tasks.filter(x=>x!==t);
    renderTopbar(); renderMain(); renderDrawer();
    return;
  }
  queueOp({
    kind:"task-delete", method:"DELETE", url:"/timing-tasks",
    body:{ids:[Number(t.id)]},
    bellId:"task:"+t.id, entity:"task", label:t.name, sub:"删除"
  });
}
/* 定时任务的周期描述 */
function taskWhen(t){
  if (Number(t.timeType)===0){
    const w = (t.weeks||[]).slice().sort((a,b)=>a-b);
    return w.length===7?"每天":(w.length?w.map(x=>WEEK[x]).join(""):"未设置星期");
  }
  if (Number(t.timeType)===3){
    const d = t.dates||[];
    return d.length? (d.length>3? d.slice(0,3).join(" ")+" 等 "+d.length+" 天" : d.join(" ")) : "未选日期";
  }
  return ["按周重复","按天重复","按日期区间","指定日期"][Number(t.timeType)] || ("类型 "+t.timeType);
}

/* ══ 上课铃 → 预备铃（只在**新建**那一下发生）═════════════════════════
   厂商那边没有「附带」这个概念：预备铃就是同一张列表里的另一条铃声，
   时间早几分钟、音源是 预备铃.mp3。面板在新建上课铃时顺手把这条也建出来，
   省得手配两遍 —— 建完就撒手。

   为什么不做「联动」：一条上课铃和它带出来的那条预备铃，在服务器眼里本来就是
   两条互不相干的铃声。以前编辑上课铃会跟着挪搭档（还顺带改名、改音量），
   删上课铃还会把搭档一起删掉 —— 用户单独调过搭档之后，再动一下上课铃，
   那些调整就被悄悄抹了。现在两条各管各的：搭档改名、挪时间、单独删，
   都由用户在铃音列表里自己决定，面板不再认领它。

   「提前几分钟」是**每条铃声自己的**属性（b.prepMin），不是全局设置 ——
   同一天里第一节和第五节想要的提前量可能不一样。3 分钟只是新建时的默认值。
   因为不再往回读，这个值也就没必要从服务器反推了（见下面的说明）。
   ══════════════════════════════════════════════════════════════════ */
const isClassBell = b => (b.mediaNames||[]).length===1 && b.mediaNames[0]==="上课铃.mp3";

/* 上课铃时刻 − 提前分钟 */
function prepTimeOf(time, min){
  const s = (hmsToSec(time) - (Number(min)||0)*60 + 86400) % 86400;
  return secToHMS(s);
}
function prepNameFor(b, taken){
  let n = String(b.name||"").replace(/上课$/,"") + "预备铃";
  if (n === "预备铃") n = "预备";
  const used = new Set((taken||[]).map(x=>x.name));
  if (!used.has(n)) return n;
  for (let i=2;i<20;i++) if (!used.has(n+i)) return n+i;
  return n + Date.now()%1000;
}
/* 新建上课铃时顺手建出来的那条预备铃。**只有这一个动作** ——
   建出来之后它就是一条普通铃声，面板不再认领它，所以这里没有「更新」「删除」。
   （服务器上也不存「提前几分钟」，只存两条独立铃声，没什么可往回读的：
   以前 inferPrepMinutes 会按时间差反推这个值好让编辑框显示当初设的数，
   现在编辑框根本不显示它，那段反推也就一起删了。） */
function createPrepFor(bell){
  const min = prepMinOf(bell);
  const time = prepTimeOf(bell.time, min);
  const nb = {
    id:null, tmpId:"t"+Math.random().toString(36).slice(2,8), isNew:true,
    name: prepNameFor(bell, S.bells),
    strategyId: bell.strategyId, isDone: bell.isDone, type: bell.type, priority: bell.priority,
    volume: bell.volume, mode: bell.mode, lightId: bell.lightId, ledText:"", ledCfgId: bell.ledCfgId,
    sound: {life_time: lifeTimeOf([PREP_MEDIA]), play_model: Number(bell.mode)||0},
    mediaNames:[PREP_MEDIA], mediaGroupNames:[],
    termNames: bell.termNames.slice(), groupNames: bell.groupNames.slice(),
    time, times:[time], inheritArea: bell.inheritArea
  };
  S.bells.push(nb);
  S.bells.sort((x,y)=> hmsToSec(x.time)-hmsToSec(y.time));
  queueCreate(nb);
}

/* ══ 列表启用/停用 ═══════════════════════════════════════════════════
   is_done: 1=启用, 0=停用（厂商前端 rail 用 t.is_done?"Enabled":"Disabled"）。
   服务器上确实有若干列表是 0 —— 它们不会打铃，面板必须标出来。
   ══════════════════════════════════════════════════════════════════ */
const isListEnabled = g => Number(g && g.is_done) === 1;
/* 执行年份过了：end_date 早于今天。服务器不管这个，它照样按点打铃，
   所以面板得自己把它标出来。 */
function isListExpired(g){
  const end = String((g && g.end_date) || "").slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  const d = new Date(), p = n => String(n).padStart(2,"0");
  return end < d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
}
function currentGroup(){ return S.data.groups.find(x=>Number(x.id)===Number(S.groupId)) || null; }
/* 列表本体改动（is_done / 名称 / 日期），和列表里的铃声无关 */
function queueListPatch(g, patch, sub){
  queueOp({
    kind:"list-update", method:"PUT", url:"/timing-bells-groups/"+g.id,
    body: patch,
    bellId:"list:"+g.id, entity:"list",
    label:"[任务] "+(g.name||""), sub: sub || "更新任务属性"
  });
}
/* label 可以传第三个参数覆盖。谁需要呢：考试模式那个列表在侧栏里从来不露面，
   用户没机会认识它服务器上的名字，抽屉里只能是「[考试] 考试铃声」——
   那是 40-view-exam 的规矩（见那边的 examOpLabel），由**调用方**传进来，
   这里不主动去猜哪个列表是考试的。 */
function queueListToggle(g, on, label){
  const was = Number(g.is_done)===1 ? 1 : 0;
  const patchFor = v => ({is_done:v, name:g.name, start_date:g.start_date, end_date:g.end_date,
                          is_year_repeat:Number(g.is_year_repeat)||0});
  const op = {
    kind:"list-update", method:"PUT", url:"/timing-bells-groups/"+g.id,
    body: patchFor(on?1:0),
    /* 服务器上原本是什么样 —— 开关点了两下回到原点，这两条就一起撤掉 */
    base: JSON.stringify(patchFor(was)),
    bellId:"list:"+g.id, entity:"list",
    label: label || ("[任务] "+(g.name||"")), sub: on?"启用该任务":"停用该任务",
    /* 本地先改，rail / 表头立刻反映；失败时由重拉回滚显示 */
    onOk: ()=>{ g.is_done = on?1:0; }
  };
  g.is_done = on?1:0;
  queueOp(op);
  renderMain(); renderRail();
}

/* ══ media helpers ══════════════════════════════════════════════════ */
function mediaByName(n){ return S.data.medias.find(m=>m.name===n); }
/* 这个文件在服务器上登记了多长（秒）。**认不出来返回 null，不是 0** —— 0 秒是
   一个合法的时长，两者混在一起的话，「这个文件不在媒体库里」会被悄悄当成
   「这是个空文件」，写出去的是一条不发声的铃声。见 lifeTimeOf 和考试模式的拦截。 */
function mediaSeconds(n){ const m = mediaByName(n); return m ? (Number(m.length)||0) : null; }
function lifeTimeOf(names){
  let s = 0;
  names.forEach(n=>{ const sec = mediaSeconds(n); if (sec!=null) s += sec + 2; });
  return secToHMS(s);
}
/* 铃音预设：一个名字 + 一个服务器上的文件名，全部由用户自己在全局设置里加。
   这里**没有内置项** —— 一条都没有的时候，「选择铃音」的预设页签和
   考试铃声那一格各自有一套空态（见 drawPresets、examSectionHTML 里的「无」）。
   注意上课铃那条「要不要一起建预备铃」认的是文件名（isClassBell），和预设无关。

   存在**面板配置**里（S.cfg.presets，见 js/05-config.js）—— 和分组同一份、同一条路：
   在一台电脑上建的预设，换一台电脑打开面板也在。 */
/* 设置面板要能看见填了一半的新预设，所以原始列表和参与选择的列表分开：
   没填全的（缺名字或缺文件）先不进 PRESETS。 */
const rawPresets = ()=>{ const r = S.cfg && S.cfg.presets; return Array.isArray(r) ? r : []; };
const filledPreset = p => !!(p && p.label && p.media);
let PRESETS = [];
/* 配置一换就重算 —— 开机对账拿回服务器那份、自己改完、以及下面 setUserPresets
   都要走这儿。PRESETS 是选择器直接拿来画的那一份。 */
function loadPresets(){ PRESETS = rawPresets().filter(filledPreset); }
function setUserPresets(list){
  S.cfg.presets = list;
  cfgSave("presets");              /* 本机当场写，静默一会儿再推给服务器 */
  loadPresets();
}
/* 这儿原来有个 presetFor(文件名) → 预设。它只伺候定时任务那个「音源」下拉
   （要把当前值反查成哪一条预设好选中）。那个下拉换成和铃声一样的音源控件之后，
   没人再问了 —— 预设现在是选择器里的一个页签，勾的是文件名本身，不用反查。 */
/* 一次播放可能选了多个文件、或者几个整个文件夹，显示时拼成一行 */
const mediaLabel = s => [].concat((s.media||[]), (s.groups||[]).map(x=>x+"（文件夹）")).join("、");

