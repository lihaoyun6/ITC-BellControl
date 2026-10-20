/* status — 终端在线状态
   广播控制台 · 替代厂商后台的打铃配置面板
   //////////////////////////////////////////////////////////////
   厂商的 REST 模型里**没有**在线状态：GET /terminals 只有名字、IP、MAC。
   状态走的是 WebSocket，地址由 GET /api/v2/language 的 webSocketIp 给出 ——
   就是服务器地址 + 一个固定端口（这套后台上是 51330）。
   协议（从厂商前端 app.js 里扒的）：

     发  {company:"BL", actioncode:"c2ls_get_server_terminals_status",
          token:<jwt>, data:{}, result:0, return_message:""}
     收  {actioncode:"ls2c_get_server_terminals_status",
          data:{EndPointsArray:[{EndpointID, EndpointName, Status:1|2|0,
                StatusDsp:"online"|"busy"|"offline", …}]}}
     之后状态变化会以 actioncode:"terminal_status" 主动推过来；厂商客户端那条
     连接上则是裹在 ls2c_push_msg 里（data.EventID:"terminal_status"），两种都认。

   Status: 1 = 在线，2 = 忙碌（仍算在线），0 = 离线。
   忙碌时每台的 TaskID / EndpointID 记在 S.termTask 里，见 applyEndpoints。
   这只是锦上添花：连不上就当「未知」，点灰点，面板照常用。

   ── 当前会话（同一条连接上的第二件事）─────────────────────────────
     发  {actioncode:"c2ls_get_task_status", data:{}}
     收  {actioncode:"ls2c_get_task_status", data:{TaskInfoArray:[{TaskID,
          TaskName, TaskIniator, TaskBeginTime, TaskVolume, TaskType,
          EndpointIpList:[{EndPointID, EndPointPrimaryKey}, …]}]}}
     推送 task_status 同样带 TaskInfoArray；task_stop 带停掉那条的 TaskID。
     列在终端管理的「会话管理」页签里：可看响应方、改任务音量、整条停掉。
     整条任务的声音大小走 c2ls_set_task_volume {TaskID, Volume}；整条停止走
     c2ls_stop_task {TaskID} —— 和上面「只把一台从任务里摘出来」是两件事。
   ══════════════════════════════════════════════════════════════════ */
const STAT_ACT = {
  req : "c2ls_get_server_terminals_status",
  ack : "ls2c_get_server_terminals_status",
  push: "terminal_status",
  /* 会话（任务）状态，和终端状态走同一条 WS */
  sessReq : "c2ls_get_task_status",
  sessAck : "ls2c_get_task_status",
  sessPush: "task_status",
  sessStop: "task_stop"
};

/* 在线 / 忙碌 / 离线 / 未知。忙碌也是在线 —— 只是这一刻正被通话或放音占着。 */
function statusOf(name){
  const v = S.termStat[name];
  return (v==="online" || v==="busy" || v==="offline") ? v : "unknown";
}
const STAT_TEXT = {online:"在线", busy:"忙碌", offline:"离线", unknown:"状态未知"};
function statusTitle(name){
  return esc(name) + " · " + STAT_TEXT[statusOf(name)];
}
/* 一个红绿点。未知时是灰点 —— 不要用红点冒充「离线」。
   带上 data-tdot 是为了状态到了以后只改这一个点，而不用把整页重画一遍。 */
const statusDot = name => '<span class="tdot '+statusOf(name)+'" data-tdot="'+esc(name)+'"></span>';

/* 状态变了就把页面上所有已经画出来的点就地改掉。
   这条很关键：登录后先渲染页面、后收到状态推送，光靠重画会漏掉
   「首屏那些点一直是灰的，切个列表再切回来才对」这个 bug。 */
function refreshStatusDots(){
  $$("[data-tdot]").forEach(el=>{
    const n = el.dataset.tdot, v = statusOf(n);
    if (el.className !== "tdot "+v) el.className = "tdot "+v;
    const t = n+" · "+STAT_TEXT[v];
    if (el.title !== t) el.title = t;
  });
}
function statusCount(){
  const vals = Object.keys(S.termStat).map(k=>S.termStat[k]);
  /* 「忙碌」算在线：顶栏那格读数说的是连没连上，不是此刻闲不闲。 */
  const on = vals.filter(v=>v==="online"||v==="busy").length;
  return {on, total:vals.length};
}

/* 顶栏那格读数。没连上那两种都不写「终端」二字 —— 那时候手上一个真数都没有，
   写「终端」等于宣称「下面这个数说的是终端」，可它压根没数。 */
function linkText(){
  if (S.link==="ok"){ const c = statusCount(); return "终端 "+c.on+"/"+c.total; }
  if (S.link==="busy") return "状态连接中";
  return "状态获取中";
}
/* 推送本身连没连上。顶栏那一格的提示语让给「点击查看终端管理」了，这句交代跟着
   搬进那张表的副标题 —— 那里地方大，也正是「这些点为什么是灰的」的答案。 */
function linkStateText(){
  return S.link==="ok" ? "已连接" : S.link==="busy" ? "连接中" : "未连接";
}

/* ══ 终端管理（点顶栏那句「终端 xx/xx」）═════════════════════════════
   四个页签：在线 / 离线 / 全部 / 会话管理。前三个说的是终端名册，取
   S.data.terminals（GET /terminals 那一份，79 个），**不拿 S.termStat 当名册** ——
   那张表只有推送报过的终端，推送没连上时它是空的，这个框会变成一个空壳。
   「会话管理」说的不是终端，是服务器上正跑着的任务（S.sessions，见 applySessions）：
   一行一条，依次是任务名 / 音量（点数字改）/ 会话类型，行尾两枚是查看响应方和
   停掉整条任务。搜索框那一格两页共用：终端页搜名称 / IP，这一页搜任务名 / 响应方；
   右边的下拉也换成任务类型（选项按当下列表里真有的类型现造）。

   **「离线」这一页收的是「不在线」**：状态还没收到的终端也落在这一页（它们只是
   「不知道」，不是「离线」）。所以页签名可以笼统，行里的字不能 —— 每行照实写自己
   的状态字，是「状态未知」就写「状态未知」，顶上也补一句说明。页签上的数字跟着
   这些行走，不跟顶栏那格读数走：那格读的是推送报过的终端数。

   「全部」是**整份名册，不筛状态**，顺序照服务器给的来（「找一台设备」不该先想
   它在哪一档）。它也是搜索摸不到东西时的落点，只是这个「落点」**不用嘴说**：
   搜索词一变，三个页签上的数字一起换成**各档滤完还剩几个**，「在线 0 ｜ 离线 1 ｜
   全部 1」自己就把话讲完了 —— 在「在线」页搜一个离线名字，人会看见数字从离线那格
   跳出来，而不是读一句话再自己切过去。

   「在线」页签的搜索框后面还有一格下拉：全部在线 / 空闲 / 忙碌。「忙碌」照旧算在
   在线里 —— 页签数字和顶栏读数都不变，这一格只决定这份名册里露出哪些行。
   选中「忙碌」时，搜索框和下拉之间还多一枚「全部停止」：停的是**当下列出的**
   这些忙碌终端（搜索词也算数），不是全校所有忙碌终端。

   行是**纯读数，点不动**（借 .pick-row 的排版，CSS 里把它的手型和悬停去掉了），
   只有行尾那几枚按钮管用：忙碌的终端在铅笔前头多一枚停止键（把这**一台**从它
   当前的任务里摘出来）；接着是铅笔（编辑这台设备的名称/IP/呼叫编码/音量）
   和垃圾桶（删除，要确认）。页签下面是**一格搜索**（名字或 IP，大小写不论）：
   名册只滤当前这一页签里那些行，页签上那三个数字**各档各滤** —— 搜着的时候
   它们就是「这一档里匹配上几个」，不搜的时候自然退回各档的总台数。

   表头那两行（页签、搜索框）**只画一次**，重画只走下面那份名册。这是必须的，不是
   图省事：搜索框是个正在输入的控件，把它整个换掉会当场掐断输入法 —— 打拼音时
   候选框一闪就没了。名册里没有输入中的东西，整块换掉无所谓。

   **刷新在右上角，添加设备在底栏最右**（用户定的）：三个页签加两枚按钮挤在
   一行里，窄屏上「添加设备」会被顶出框外。添加设备留在底栏 —— 底栏本来就要一条
   给「显示终端IP」开关（左：开关在左、文字在右）。刷新只留一个图标，搬去右上角，
   和挑音源弹窗里那枚同一尺寸、同一位置（见 20-ui.js 的 addModalRefresh）。
   底栏那一格开关**横竖屏都在**（用户定的）：原先只在竖屏露出来，理由是「宽屏地方
   够，IP 一直摆着，用不着它」—— 可那等于把「想不想看 IP」这件事按屏幕宽度替人
   决定了。现在两档一个样，挡位记在浏览器里，见下面 termShowIp。

   增删改的实现都在 17-device.js。那边写完一轮会回头调 termListPaint（下面那个
   句柄）把这张表重画一遍 —— 名册换了、页签上的数字也就跟着换了。 */
let termListPaint = null;          /* 那张表开着时的重画句柄；框关掉就置回 null */

/* 「显示终端IP」开关的挡位。默认开着；**记在浏览器里**（localStorage 的
   bc.termShowIp），和顶栏「草稿模式」那几个开关一个待遇：关过一次，下次打开这张表
   还是关着的，重开浏览器也还在（要回到默认就把浏览器数据清了）。
   放文件级而不是 paint 的闭包里：这张表状态推送一到就整个重画，挡位搁在闭包里
   会被自己冲掉 —— 而它现在比这个框活得还长，本来也不该住在框里。 */
let termShowIp = LS.get("termShowIp", true) !== false;

function openTermList(){
  if (!S.data.terminals.length){ toast("数据尚未准备好，请稍后再试", "err"); return; }
  let tab = "online";
  let q = "";                        /* 终端搜索词。只活在这个框里，和 tab 一样每次开都从头来 */
  let sq = "";                       /* 会话搜索词（任务名 / 响应方），和终端那格分开记 */
  let onMode = "all";                /* 在线页签里看全部 / 空闲 / 忙碌 */
  let sessType = "all";              /* 会话管理里挑的任务类型；all = 全部 */
  let sessSig = null;                /* 上一次画进类型下拉的那几种类型，变了才重造选项 */
  let visibleStoppable = [];         /* 当下列出的、能停的忙碌终端（「全部停止」用） */
  let paint = null;
  openModal({
    title: "终端管理",
    sub: "共 " + S.data.terminals.length + " 个终端 · 终端状态推送" + linkStateText(),
    width: "560px", tall:true,
    /* 关掉时把重画回调摘掉：不摘的话，状态每变一次它就往一个已经不在了的框里写一遍。 */
    onClose(){
      const i = statusHooks.indexOf(paint); if (i>=0) statusHooks.splice(i,1);
      termListPaint = null;
    },
    mount(b, f, mm){
      b.classList.add("grow-body");     /* 页签钉住，只让下面这份名册自己滚 */
      const subEl = $(".modal-head .sub", mm.host);   /* 副标题里的台数跟着名册走 */
      /* 底栏：左头是「显示IP」开关，右头是添加设备（刷新在右上角，见 addModalRefresh）。
         开关**在左、文字在右** —— .switch 默认排法是文字在前，这里把两段调个个儿。
         竖屏上 IP 和名字挤在一行里，想只看名字的，把这段 IP 收起来；
         默认开着 —— 关掉之后行里连 IP 都不显示，那是反直觉的状态，不该是默认值。 */
      f.classList.add("term-foot");
      f.innerHTML =
        '<label class="switch" title="关掉之后，这份名册里不再显示终端 IP">'+
          '<input type="checkbox" id="termIpTgl"'+(termShowIp?" checked":"")+'>'+
          '<span class="track"></span><span class="dimmer">显示IP</span>'+
        '</label>'+
        '<span class="spacer"></span>'+
        '<button class="btn" data-act="add">'+ICON.plus+' 添加设备</button>'+
        /* 竖屏收掉了右上角的 ×，出口在底栏。宽屏有 ×，不再多摆一枚。 */
        (isNarrow() ? '<button class="btn" data-act="close">关闭</button>' : '');
      const tgl = f.querySelector("#termIpTgl");
      /* 只管重画那张表：挡位不在这份名册里，底栏这一格连状态都不用改。
         拨一下就写进浏览器，下次开这张表照这一份来。 */
      tgl.onchange = ()=>{ termShowIp = tgl.checked; LS.set("termShowIp", termShowIp); paint(); };

      /* 表头那两行（页签、搜索框）**只画这一次**，往后再也不动它 —— 重画只走下面那份
         名册。结构必须是这样：搜索框是个**正在输入**的控件，把它整个换掉会当场掐断
         输入法 —— 打拼音时候选框一闪就没了（用户实测：按一下闪一下）。
         所以页签上那两个数字改成就地在原按钮上写，不在重画里重造。 */
      b.innerHTML =
        '<div class="tabs term-bar">'+
          '<button class="tab" data-t="online" id="termTabOn"></button>'+
          '<button class="tab" data-t="offline" id="termTabOff"></button>'+
          '<button class="tab" data-t="all" id="termTabAll"></button>'+
          /* 最右边这一页不是终端名册，是**正在进行的任务**（见下面 paint 里那一支）。
             term-tab-right 把它推到整条页签栏的右端，前三个照旧靠左。
             竖屏上那两个字太长，CSS 换成「会话」（.sess-short），数字另占一格。 */
          '<button class="tab term-tab-right" data-t="sessions" id="termTabSess">'+
            '<span class="sess-full">会话管理</span><span class="sess-short">会话</span>'+
            '<span id="termSessN"></span></button>'+
        '</div>'+
        /* 搜索框不挤在页签那一行里：那一行在竖屏上本来就刚好占满（两个页签加两枚
           按钮），再塞一格进去会把「添加设备」顶出框外。它自己一行，两边都够用。 */
        '<div class="pick-search">'+
          '<span class="sbox">'+ICON.search+
            '<input class="input" id="termQ" placeholder="搜索名称或 IP">'+
          '</span>'+
          /* 只在「在线 → 忙碌」这一档露出来：停的是当下列出的这些，搜索词也算数。 */
          '<button class="btn btn-danger term-stopall" id="termStopAll" hidden title="停止当前列出的所有忙碌终端">'+
            ICON.stopC+' 全部停止</button>'+
          /* 只在「在线」页签露出来（paint 里切 hidden）：离线页没有闲忙之分。 */
          '<select class="select term-onf" id="termOnF" title="在线设备">'+
            '<option value="all">全部在线</option>'+
            '<option value="online">空闲</option>'+
            '<option value="busy">忙碌</option>'+
          '</select>'+
          /* 会话管理那一页的类型筛选。选项按当下真有的类型现造（见 paint），
             只在会话页露出来。 */
          '<select class="select term-typef" id="termTypeF" title="任务类型" hidden></select>'+
        '</div>'+
        '<div class="term-list" id="termBox"></div>';
      const qEl = $("#termQ", b);
      /* 一格式两用：终端页搜名称 / IP，会话页搜任务名 / 响应方；两个词各记各的。 */
      qEl.oninput = ()=>{ if (tab==="sessions") sq = qEl.value; else q = qEl.value; paint(); };
      const onF = $("#termOnF", b);
      onF.onchange = ()=>{ onMode = onF.value; paint(); };
      const typeF = $("#termTypeF", b);
      typeF.onchange = ()=>{ sessType = typeF.value; paint(); };
      const stopAll = $("#termStopAll", b);
      stopAll.onclick = ()=>{
        const ts = visibleStoppable;
        if (!ts.length) return;
        /* 单台的停止键不确认（就在那一行上，点错了再点一次别的也一样）；
           这一枚一下会停掉当下列出来的这一批，先问一句。 */
        openConfirm("停止播放",
          "确定要停止这 "+ts.length+" 个终端的播放任务吗？",
          ()=> stopTerminalTasks(ts), "停止", true);
      };
      $$(".tab", b).forEach(x=> x.onclick = ()=>{
        tab = x.dataset.t;
        /* 同一个搜索框，两页两种用法：切过去时把那一页自己的词和占位符换回来。 */
        qEl.value = tab==="sessions" ? sq : q;
        qEl.placeholder = tab==="sessions" ? "搜索任务名称/响应方" : "搜索名称或 IP";
        /* 会话这一页用的是服务器手上**这一刻**的清单：切过来先问一趟，
           之后靠 task_status / task_stop 推送自己维持（见 ws.onmessage）。 */
        if (tab==="sessions") statSendSessions();
        paint();
      });
      /* 刷新在右上角，和挑音源弹窗里那枚是同一个控件（addModalRefresh）。 */
      addModalRefresh(mm.host, async (btn)=>{
        if (btn.disabled) return;
        btn.disabled = true;
        await reloadTerminals();
        btn.disabled = false;
      });
      /* 添加设备住在底栏里（f），不在 b 里 —— 它不参与重画，绑一次就够。 */
      f.querySelector('[data-act="add"]').onclick    = ()=> openDeviceAdd();
      const cls = f.querySelector('[data-act="close"]');
      if (cls) cls.onclick = ()=> closeModal(mm.id);

      paint = ()=>{
        const terms   = S.data.terminals;      /* 每次现取：名册是会整个换掉的一份数据 */
        /* 忙碌算在线：在线页签收的是 online + busy，离线页签收的是剩下的
           （offline + unknown，理由见上面那段）。 */
        const isOn    = t => { const s = statusOf(t.name); return s==="online" || s==="busy"; };
        const online  = terms.filter(isOn);
        const rest    = terms.filter(t=> !isOn(t));
        /* 搜索在**当前这一页签里**滤（名字和 IP 一起比，照 20-ui.js 那个点位搜索）。
           句柄 hit 在没词的时候对谁都点头，所以下面三处「滤完还剩几台」不用分情况
           写：没搜索时它们退回各档总数，搜着的时候就是各档里的匹配数。
           下拉那格只筛「在线」页签的行，页签上的数字仍是整档的台数 ——
           「在线 40」说的是有 40 台在线，不管当下挑的是空闲还是忙碌。 */
        const ql      = q.trim().toLowerCase();
        const hit     = t => !ql || (String(t.name)+" "+String(t.ip_address)).toLowerCase().indexOf(ql) >= 0;
        let   shown   = tab==="online" ? online : tab==="offline" ? rest : terms;
        if (tab==="online" && onMode!=="all") shown = shown.filter(t=> statusOf(t.name)===onMode);
        const list    = shown.filter(hit);
        /* 「全部停止」只认当下列出来的行：搜索词、页签、下拉三者筛完还剩谁就是谁。
           没拿到 TaskID 的忙碌终端停不了，也不列进这份名单。 */
        visibleStoppable = (tab==="online" && onMode==="busy")
          ? list.filter(t=> statusOf(t.name)==="busy" && S.termTask[t.name] && S.termTask[t.name].TaskID)
          : [];
        const onHit   = online.filter(hit).length;
        const offHit  = rest.filter(hit).length;
        const allHit  = terms.filter(hit).length;
        const unknown = rest.filter(t=> statusOf(t.name)==="unknown").length;
        /* ── 会话管理：类型下拉的选项 + 搜过之后的行 ─────────────────────
           选项按当下**真有的**类型现造；那几类都没了就把筛选退回「全部类型」。
           sessSig 不变就不重造 innerHTML —— 正开着下拉挑类型时不能让它闪。 */
        const sessTypes = [...new Set(S.sessions.map(s=> Number(s.TaskType)).filter(t=> isFinite(t)))]
          .sort((a,b)=> a-b);
        const sig = sessTypes.join(",");
        if (sig !== sessSig){
          sessSig = sig;
          typeF.innerHTML = '<option value="all">全部类型</option>'+
            sessTypes.map(t=> '<option value="'+t+'">'+esc(SESSION_TYPE[t]||"其他任务")+'</option>').join("");
          if (sessType !== "all" && sessTypes.map(String).indexOf(String(sessType)) < 0) sessType = "all";
          typeF.value = sessType;
        }
        const sql = sq.trim().toLowerCase();
        /* 找响应方：EndPointPrimaryKey 就是终端名（抓包里如此）。 */
        const sessHit = s => {
          if (!sql) return true;
          const names = (Array.isArray(s.EndpointIpList) ? s.EndpointIpList : [])
            .map(e=> e.EndPointPrimaryKey || "").join(" ");
          return ((s.TaskName||"")+" "+(s.TaskShowInfo||"")+" "+names).toLowerCase().indexOf(sql) >= 0;
        };
        const sessRows = S.sessions.filter(s=>
          (sessType==="all" || Number(s.TaskType)===Number(sessType)) && sessHit(s));
        /* 搜不到时空着的那句话。**不用**在这儿报「别的页签里有几个」——那件事归页签
           上的数字说（见上面），一句话里再复述一遍就成了两个地方报同一个数，还容易
           岔。这儿只说这一页签里的事。 */
        const emptyText = tab==="sessions"
          ? (S.sessions.length
              ? "没有匹配的会话。"
              : (S.link==="ok" ? "当前没有正在进行的会话。"
                               : "还没连上状态推送，当前会话暂时读不到。"))
          : ql
            ? "没有匹配的终端。"
            : (tab==="online"
                ? (onMode==="busy" ? "没有忙碌的终端。" : onMode==="online" ? "没有空闲的终端。" : "没有终端在线。")
                : tab==="offline" ? "没有不在线的终端。" : "还没有终端。");
        if (subEl) subEl.textContent =
          "共 " + terms.length + " 个终端 · 终端状态推送" + linkStateText();
        /* 页签上的数字、页签的选中态，全都**原地改**（表头不参与重画，见上面那段）。
           只有下面那份名册是整块重画的 —— 它里面没有输入中的控件，换掉它不会打断谁。 */
        const onTab = $("#termTabOn", b), offTab = $("#termTabOff", b),
              allTab = $("#termTabAll", b), sessTab = $("#termTabSess", b);
        onTab.textContent  = "在线 " + onHit;
        offTab.textContent = "离线 " + offHit;
        allTab.textContent = "全部 " + allHit;
        /* 页签上的字交给 CSS（竖屏换成「会话」），数字另占一格就地改。 */
        $("#termSessN", b).textContent = " " + sessRows.length;
        onTab.classList.toggle("on", tab==="online");
        offTab.classList.toggle("on", tab==="offline");
        allTab.classList.toggle("on", tab==="all");
        sessTab.classList.toggle("on", tab==="sessions");
        onF.hidden = tab!=="online";
        typeF.hidden = tab!=="sessions";
        stopAll.hidden = !(tab==="online" && onMode==="busy");
        stopAll.disabled = !visibleStoppable.length;
        const box = $("#termBox", b);
        if (tab==="sessions"){
          /* sess-list：竖屏那档「按钮收进 ⋯」的规则不许落到这一页上（见 css）。 */
          box.className = "term-list sess-list";
          box.innerHTML = sessRows.length
            ? sessRows.map(s=>{
                const id = esc(String(s.TaskID||""));
                const vol = s.TaskVolume == null ? "—" : s.TaskVolume;
                return '<div class="pick-row">'+
                  '<span class="nm">'+esc(s.TaskName||s.TaskShowInfo||"未命名任务")+'</span>'+
                  /* 会话类型一列，排在任务名后面。 */
                  '<span class="stt">'+esc(sessionTypeText(s))+'</span>'+
                  '<span class="dacts">'+
                    /* 音量排在动作组首位（数字在喇叭前），点它就改；数字位预留三格，"100" 也放得下。 */
                    '<button class="sess-vol" data-vol="'+id+'" title="修改任务音量" aria-label="修改任务音量">'+
                      '<span>'+esc(vol)+'</span>'+ICON.volume+'</button>'+
                    '<button class="cell-btn" data-resp="'+id+'" title="查看响应方" aria-label="查看响应方">'+ICON.search+'</button>'+
                    '<button class="cell-btn danger" data-sstop="'+id+'" title="停止播放" aria-label="停止播放">'+ICON.stopC+'</button>'+
                  '</span></div>';
              }).join("")
            : '<div class="hint" style="padding:12px 11px">'+emptyText+'</div>';
          const byId = id => S.sessions.find(x=> String(x.TaskID)===String(id));
          $$("[data-resp]", b).forEach(x=> x.onclick = ()=>{
            const s = byId(x.dataset.resp); if (s) openSessionResponders(s);
          });
          $$("[data-vol]", b).forEach(x=> x.onclick = ()=>{
            const s = byId(x.dataset.vol); if (s) openSessionVolume(s);
          });
          $$("[data-sstop]", b).forEach(x=> x.onclick = ()=>{
            const s = byId(x.dataset.sstop); if (s) stopSession(s);
          });
          return;
        }
        box.className = "term-list"+(termShowIp?"":" noip");
        box.innerHTML =
            (tab==="offline" && unknown && !ql
              ? '<div class="hint term-note">'+(S.link==="ok"
                  ? unknown+' 个终端还没收到在线状态：它们只是「不知道」，不算离线。'
                  : unknown+' 个终端的在线状态还没收到 —— 状态推送没连上，'
                    +'这些只是「不知道」，不代表它们离线。')+'</div>'
              : "")+
            (list.length
              ? list.map(t=>{
                  const st = statusOf(t.name);
                  const ti = S.termTask[t.name];
                  const canStop = st==="busy" && ti && ti.TaskID;
                  return '<div class="pick-row" title="'+statusTitle(t.name)+'">'+statusDot(t.name)+
                    '<span class="nm">'+esc(t.name)+'</span>'+
                    (st==="unknown" ? '<span class="stt">状态未知</span>' : "")+
                    '<span class="ip">'+esc(t.ip_address||"")+'</span>'+
                    '<span class="dacts">'+
                      /* 忙碌的那一台才多这枚：把它自己从当前任务里摘出来，
                         同一条任务里的别的终端不受影响。 */
                      (canStop ? '<button class="cell-btn" data-stop="'+esc(t.name)+'" title="停止播放" aria-label="停止播放">'+ICON.stopC+'</button>' : "")+
                      '<button class="cell-btn" data-edit="'+esc(t.id)+'" title="编辑这台设备" aria-label="编辑">'+ICON.edit+'</button>'+
                      '<button class="cell-btn danger" data-del="'+esc(t.id)+'" data-name="'+esc(t.name)+'" title="删除这台设备" aria-label="删除">'+ICON.del+'</button>'+
                      /* 竖屏上旁边那两枚收成这一枚（css 换的，宽屏上看不见它、竖屏看不见那两枚） */
                      '<button class="cell-btn r-more" data-more="'+esc(t.id)+'" title="更多操作" aria-label="更多操作">'+ICON.dots+'</button>'+
                    '</span></div>';
                }).join("")
              : '<div class="hint" style="padding:12px 11px">'+emptyText+'</div>');
        $$("[data-stop]", b).forEach(x=> x.onclick = ()=>{
          const t = S.data.terminals.find(y=> String(y.name)===x.dataset.stop);
          if (t) stopTerminalTasks([t]);
        });
        $$("[data-edit]", b).forEach(x=> x.onclick = ()=> openDeviceEditor(x.dataset.edit));
        $$("[data-del]",  b).forEach(x=> x.onclick = ()=> deleteDevice(x.dataset.del, x.dataset.name));
        /* 竖屏上那两枚收成这一枚。设备总是现从名册里取 —— 这个框开着的时候
           名册可能刚被换掉（17-device.js 每次写完都重拉一份），拿闭包里那个旧对象
           去改，改的是一台已经不在了的设备。 */
        $$("[data-more]", b).forEach(x=> x.onclick = ()=>{
          const t = S.data.terminals.find(y=> String(y.id)===String(x.dataset.more));
          if (!t) return;
          const items = [];
          /* 竖屏（且 IP 开着）时行尾只剩这枚 ⋯，忙碌那台的停止键也收进这里，
             和宽屏上「铅笔前头那枚」是同一个动作。 */
          const ti = S.termTask[t.name];
          if (statusOf(t.name)==="busy" && ti && ti.TaskID)
            items.push({ icon:ICON.stopC, label:"停止播放", onPick:()=> stopTerminalTasks([t]) });
          items.push(
            { icon:ICON.edit, label:"编辑", onPick:()=> openDeviceEditor(t.id) },
            { icon:ICON.del,  label:"删除", onPick:()=> deleteDevice(t.id, t.name), danger:true });
          openRowMenu(x, items);
        });
      };
      paint();
      /* 状态推送一到就重画一遍：点变色那条 refreshStatusDots() 只管点，可页签上的
         数字、行落在哪一页，都得跟着走。 */
      statusHooks.push(paint);
      termListPaint = paint;
    }
  });
}

/* 打开中的区域选择器需要跟着刷新（它渲染在模态框里，不在 #main 内） */
let statusHooks = [];

function applyEndpoints(arr){
  if (!Array.isArray(arr) || !arr.length) return false;
  let changed = false;
  arr.forEach(e=>{
    const n = e && (e.EndpointName || e.EndpointID);
    if (!n) return;
    const v = (Number(e.Status)===2 || e.StatusDsp==="busy") ? "busy"
            : (Number(e.Status)===1 || e.StatusDsp==="online") ? "online" : "offline";
    if (S.termStat[n] !== v){ S.termStat[n] = v; changed = true; }
    /* 忙的时候顺手记下它正在跑哪条任务：停止键要拿 TaskID 和这台终端自己的
       EndpointID，才能只把它从任务里摘出来。不忙了就把旧账清掉 —— 不然那条
       TaskID 会留到下一次忙碌，停止键就会对着一条早就没了的任务发报文。 */
    const old = S.termTask[n];
    if (v==="busy" && e.TaskID){
      if (!old || String(old.TaskID)!==String(e.TaskID) ||
                  String(old.EndpointID)!==String(e.EndpointID)){
        S.termTask[n] = {TaskID:e.TaskID, EndpointID:e.EndpointID};
        changed = true;
      }
    } else if (old){
      delete S.termTask[n]; changed = true;
    }
  });
  return changed;
}

/* ── WebSocket ─────────────────────────────────────────────────────── */
let statWS = null, statRetry = 0, statTimer = null;

/* 让终端退出它当前所在的任务。厂商前端用的就是这条：
   c2ls_remove_terminals_from_task，data 里带 TaskID 和这台终端自己的
   EndpointID —— **只摘这一台**，同一条任务里的别的终端照常播。
   （c2ls_stop_task 是整条任务一起停，不能拿来干这件事。）
   不等应答：和厂商前端一样发出去就回，状态推送随后会把黄点改掉。
   一批终端就一台一条报文 —— 厂商前端也是这么发的。 */
function stopTerminalTasks(terms){
  const ws = statWS;
  if (!ws || ws.readyState !== 1){ toast("终端状态连接还没连上，稍后再试", "err"); return; }
  let n = 0;
  terms.forEach(t=>{
    const ti = S.termTask[t.name];
    if (!ti || !ti.TaskID) return;
    try{
      ws.send(JSON.stringify({
        company:"BL", actioncode:"c2ls_remove_terminals_from_task",
        token:S.token||"",
        data:{ TaskID: ti.TaskID, EndPointsList: String(ti.EndpointID || t.id) },
        result:0, return_message:""
      }));
      n++;
    }catch(e){}
  });
  if (n) toast(n===1 ? "已发送停止请求" : "已向 "+n+" 台终端发送停止请求", "ok");
  else   toast("这些终端当前没有可停止的任务", "err");
}

/* ══ 当前会话（任务）════════════════════════════════════════════════
   S.sessions 是服务器手上这一刻的任务清单。应答（ls2c_get_task_status）是**整份**
   替换 —— 那一刻没在跑的任务不该留着；推送 task_status 是逐条 upsert（开始 /
   更新的那几条）；task_stop 按 TaskID 摘掉一条。和厂商前端同一套口径。

   会话类型 TaskType 的号码 → 字，逐条照厂商前端会话页那张表（taskTypeTransform）
   抄的。号码在抓包里是数字；没收录的写「其他任务」，不拿英文内部名吓人。 */
const SESSION_TYPE = {
  1:"任务监听", 2:"环境监听", 3:"新终端上线", 4:"终端点播", 5:"客户端音乐播放",
  6:"终端采集", 7:"声卡采集", 8:"防拆报警", 9:"短路输入", 10:"远程播放",
  11:"文本播放", 12:"遥控任务", 13:"定时打铃", 14:"定时任务", 15:"一键报警",
  16:"广播", 17:"提示音", 18:"电话广播", 19:"对讲", 20:"紧急对讲",
  21:"火警", 22:"定时巡更", 23:"试听任务", 25:"应急广播"
};
const sessionTypeText = s => SESSION_TYPE[Number(s && s.TaskType)] || "其他任务";
function applySessions(arr, replace){
  if (!Array.isArray(arr)) return false;
  const rows = arr.filter(x=> x && x.TaskID);
  if (replace){
    if (JSON.stringify(rows) === JSON.stringify(S.sessions)) return false;
    S.sessions = rows;
    return true;
  }
  let changed = false;
  rows.forEach(s=>{
    const i = S.sessions.findIndex(x=> String(x.TaskID)===String(s.TaskID));
    if (i < 0){ S.sessions.push(s); changed = true; }
    else if (JSON.stringify(S.sessions[i]) !== JSON.stringify(s)){
      S.sessions[i] = s; changed = true;
    }
  });
  return changed;
}
function removeSession(id){
  if (id == null) return false;
  const i = S.sessions.findIndex(x=> String(x.TaskID)===String(id));
  if (i < 0) return false;
  S.sessions.splice(i, 1);
  return true;
}
function statSendSessions(){
  const ws = statWS;
  if (!ws || ws.readyState !== 1) return;
  try{
    ws.send(JSON.stringify({
      company:"BL", actioncode:STAT_ACT.sessReq, token:S.token||"",
      data:{}, result:0, return_message:""
    }));
  }catch(e){}
}

/* 停掉整条任务（不是把一台终端摘出来）：厂商前端会话页那枚「结束任务」用的就是
   c2ls_stop_task，data 只有 TaskID。停完服务器会推 task_stop，那一行自己消失。 */
function stopSession(s){
  const ws = statWS;
  if (!ws || ws.readyState !== 1){ toast("终端状态连接还没连上，稍后再试", "err"); return; }
  try{
    ws.send(JSON.stringify({
      company:"BL", actioncode:"c2ls_stop_task", token:S.token||"",
      data:{ TaskID: s.TaskID }, result:0, return_message:""
    }));
    toast("已发送停止请求", "ok");
  }catch(e){ toast("发送失败：" + e.message, "err"); }
}

/* 整条任务的音量：c2ls_set_task_volume {TaskID, Volume}（0–100）。厂商前端在输入框
   change / 回车时发，200ms 防抖；这儿是一枚弹出的确定键，发一次就够。 */
function setTaskVolume(s, vol){
  const ws = statWS;
  if (!ws || ws.readyState !== 1){ toast("终端状态连接还没连上，稍后再试", "err"); return false; }
  try{
    ws.send(JSON.stringify({
      company:"BL", actioncode:"c2ls_set_task_volume", token:S.token||"",
      data:{ TaskID: s.TaskID, Volume: vol }, result:0, return_message:""
    }));
    s.TaskVolume = vol;          /* 让下一次打开这格时看到的是刚发出去的值 */
    return true;
  }catch(e){ toast("发送失败：" + e.message, "err"); return false; }
}

/* 这条任务都有谁在响应。名字用 EndPointPrimaryKey（抓包里就是终端名），旁边那颗
   状态点照 S.termStat 走；不认识的画灰点，不冒充离线。 */
function openSessionResponders(s){
  const list = Array.isArray(s.EndpointIpList) ? s.EndpointIpList
             : Array.isArray(s.EndpointIpListArray) ? s.EndpointIpListArray : [];
  openModal({
    title: "响应方",
    sub: (s.TaskName || s.TaskShowInfo || "未命名任务") + " · " + list.length + " 个终端",
    width: "440px",
    mount(b, f, mm){
      f.innerHTML = '<span class="spacer"></span><button class="btn" data-close>关闭</button>';
      f.querySelector("[data-close]").onclick = ()=> closeModal(mm.id);
      b.innerHTML = list.length
        ? '<div class="term-list" style="max-height:320px">'+list.map(e=>{
            const n = e.EndPointPrimaryKey || ("终端 " + e.EndPointID);
            return '<div class="pick-row" title="'+statusTitle(n)+'">'+statusDot(n)+
              '<span class="nm">'+esc(n)+'</span></div>';
          }).join("")+'</div>'
        : '<div class="hint" style="padding:12px 11px">这条任务当前没有响应终端。</div>';
    }
  });
}

function openSessionVolume(s){
  openModal({
    title: "任务音量",
    sub: s.TaskName || s.TaskShowInfo || "未命名任务",
    width: "360px",
    mount(b, f, mm){
      b.innerHTML = '<div class="field"><label>音量（0–100）</label>'+
        '<input class="input mono" id="sessVol" type="number" inputmode="numeric" min="0" max="100" '+
        'value="'+esc(s.TaskVolume==null?"":s.TaskVolume)+'"></div>';
      f.innerHTML = '<span class="spacer"></span><button class="btn" data-cancel>取消</button>'+
        '<button class="btn btn-primary" data-ok>确定</button>';
      f.querySelector("[data-cancel]").onclick = ()=> closeModal(mm.id);
      const inp = $("#sessVol", b);
      const ok = ()=>{
        let n = Math.round(Number(inp.value));
        if (!isFinite(n)) n = 0;
        n = Math.max(0, Math.min(100, n));
        if (setTaskVolume(s, n)){
          closeModal(mm.id);
          if (termListPaint) termListPaint();   /* 行里那格音量数字当场换掉 */
          toast("已设置任务音量为 " + n, "ok");
        }
      };
      f.querySelector("[data-ok]").onclick = ok;
      inp.onkeydown = e=>{ if (e.key === "Enter") ok(); };
      setTimeout(()=>{ try{ inp.select(); }catch(e){} }, 30);
    }
  });
}

function statSend(ws){
  try{
    ws.send(JSON.stringify({
      company:"BL", actioncode:STAT_ACT.req, token:S.token||"",
      data:{}, result:0, return_message:""
    }));
  }catch(e){}
}
/* 往这条状态连接上发一条命令（会话停止、试听、试听清单都走它）。
   没连上就返回 false —— 调用方自己决定是报错还是再等一会儿。 */
function statSendCmd(actioncode, data){
  const ws = statWS;
  if (!ws || ws.readyState !== 1) return false;
  try{
    ws.send(JSON.stringify({
      company:"BL", actioncode:actioncode, token:S.token||"",
      data:data||{}, result:0, return_message:""
    }));
    return true;
  }catch(e){ return false; }
}
/* 等状态连接变成 OPEN，最多等 ms 毫秒。页面刚起来、连接还在握手时点「开始测试」
   会用到 —— 那一下发不出去，不是「服务器不肯」，不能直接判失败。 */
async function statWaitOpen(ms){
  if (statWS && statWS.readyState === 1) return true;
  if (!statWS) openStatusFeed();
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 2500)){
    if (statWS && statWS.readyState === 1) return true;
    await new Promise(r=> setTimeout(r, 100));
  }
  return !!(statWS && statWS.readyState === 1);
}
function statScheduleRetry(){
  if (statTimer) return;
  const wait = Math.min(30000, 2000 * Math.pow(2, Math.min(statRetry, 4)));
  statRetry++;
  statTimer = setTimeout(()=>{ statTimer=null; openStatusFeed(); }, wait);
}
function closeStatusFeed(){
  if (statTimer){ clearTimeout(statTimer); statTimer=null; }
  if (statWS){ try{ statWS.onclose=null; statWS.close(); }catch(e){} statWS=null; }
  S.link = "off";
}
async function openStatusFeed(){
  if (typeof WebSocket === "undefined") return;
  if (statWS && statWS.readyState<=1) return;
  if (!S.wsIp){
    try{
      const l = await api("GET","/language");
      S.wsIp = l && l.webSocketIp;
      /* 同一个响应里还带着厂商版本号，顺手牵回来（见 10-data.js 的 setSrvVersion）。 */
      setSrvVersion(l);
    }catch(e){ return; }
  }
  if (!S.wsIp) return;
  let ws;
  try{ ws = new WebSocket(S.wsIp); }catch(e){ S.link="bad"; return; }
  statWS = ws;
  S.link = "busy"; renderTopbar();

  ws.onopen = ()=>{ statRetry = 0; S.link = "ok"; statSend(ws); statSendSessions(); renderTopbar(); };
  ws.onmessage = e=>{
    let m = null;
    try{ m = JSON.parse(e.data); }catch(err){ return; }
    if (!m) return;
    /* 状态变化厂商那边是从 ls2c_push_msg 里裹着 EventID 推的（抓包实证），
       不是每条都直接拿 terminal_status 当 actioncode —— 两种都得认。 */
    const ev = m.data && m.data.EventID;
    const dd = m.data || m;
    /* 会话（任务）状态也走这条连接：应答整份换、推送逐条并、task_stop 摘一条。
       「会话管理」页开着的话，改完就地重画那一页。 */
    let sessChanged = false;
    if (m.actioncode===STAT_ACT.sessAck && Array.isArray(dd.TaskInfoArray)){
      sessChanged = applySessions(dd.TaskInfoArray, true);
    } else if ((m.actioncode===STAT_ACT.sessPush ||
                (m.actioncode==="ls2c_push_msg" && ev===STAT_ACT.sessPush)) &&
               Array.isArray(dd.TaskInfoArray)){
      sessChanged = applySessions(dd.TaskInfoArray, false);
    } else if (m.actioncode===STAT_ACT.sessStop || m.actioncode==="ls2c_stop_task" ||
               (m.actioncode==="ls2c_push_msg" && ev===STAT_ACT.sessStop)){
      sessChanged = removeSession(dd.TaskID);
      /* 终端测试在等这一声：会话真停了才去删那条临时报警任务（见 70-view-more）。 */
      if (typeof moreTestStopped === "function") moreTestStopped(dd.TaskID);
    }
    if (sessChanged && termListPaint){ try{ termListPaint(); }catch(err){} }
    /* 终端测试的两条应答：试听命令的结果、当前试听会话清单。它们不带终端状态，
       处理完就到此为止，别掉进下面那条「不是状态推送就 return」的闸。 */
    if (m.actioncode === "ls2c_try_listen_task"){
      if (typeof moreTestTryResult === "function") moreTestTryResult(m.result);
      return;
    }
    if (m.actioncode === "ls2c_get_listen_task_status"){
      if (typeof moreTestListenInfo === "function") moreTestListenInfo(dd.ListenTaskInfo || []);
      return;
    }
    if (m.actioncode!==STAT_ACT.ack && m.actioncode!==STAT_ACT.push &&
        !(m.actioncode==="ls2c_push_msg" && ev===STAT_ACT.push)) return;
    const d = dd;
    if (!applyEndpoints(d.EndPointsArray)) return;
    refreshStatusDots();
    renderTopbar();
    statusHooks.forEach(fn=>{ try{ fn(); }catch(err){} });
  };
  ws.onerror = ()=>{};
  ws.onclose = ()=>{
    statWS = null;
    if (S.link !== "bad") S.link = "off";
    renderTopbar();
    statScheduleRetry();
  };
}
