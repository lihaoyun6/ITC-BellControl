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
          data:{EndPointsArray:[{EndpointID, EndpointName, Status:1|0,
                StatusDsp:"online"|"offline", …}]}}
     之后状态变化会以 actioncode:"terminal_status" 主动推过来。

   Status: 1 = 在线，0 = 离线。
   这只是锦上添花：连不上就当「未知」，点灰点，面板照常用。
   ══════════════════════════════════════════════════════════════════ */
const STAT_ACT = {
  req : "c2ls_get_server_terminals_status",
  ack : "ls2c_get_server_terminals_status",
  push: "terminal_status"
};

/* 在线 / 离线 / 未知 */
function statusOf(name){
  const v = S.termStat[name];
  return v==="online" ? "online" : v==="offline" ? "offline" : "unknown";
}
const STAT_TEXT = {online:"在线", offline:"离线", unknown:"状态未知"};
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
  const on = vals.filter(v=>v==="online").length;
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
   三个页签：在线 / 离线 / 全部。名册取 S.data.terminals（GET /terminals 那一份，
   79 个），**不拿 S.termStat 当名册** —— 那张表只有推送报过的终端，推送没连上时
   它是空的，这个框会变成一个空壳。

   **「离线」这一页收的是「不在线」**：状态还没收到的终端也落在这一页（它们只是
   「不知道」，不是「离线」）。所以页签名可以笼统，行里的字不能 —— 每行照实写自己
   的状态字，是「状态未知」就写「状态未知」，顶上也补一句说明。页签上的数字跟着
   这些行走，不跟顶栏那格读数走：那格读的是推送报过的终端数。

   「全部」是**整份名册，不筛状态**，顺序照服务器给的来（「找一台设备」不该先想
   它在哪一档）。它也是搜索摸不到东西时的落点，只是这个「落点」**不用嘴说**：
   搜索词一变，三个页签上的数字一起换成**各档滤完还剩几个**，「在线 0 ｜ 离线 1 ｜
   全部 1」自己就把话讲完了 —— 在「在线」页搜一个离线名字，人会看见数字从离线那格
   跳出来，而不是读一句话再自己切过去。

   行是**纯读数，点不动**（借 .pick-row 的排版，CSS 里把它的手型和悬停去掉了），
   只有行尾那两枚按钮管用：IP 右边依次是铅笔（编辑这台设备的名称/IP/呼叫编码/音量）
   和垃圾桶（删除，要确认）。页签下面是**一格搜索**（名字或 IP，大小写不论）：
   名册只滤当前这一页签里那些行，页签上那三个数字**各档各滤** —— 搜着的时候
   它们就是「这一档里匹配上几个」，不搜的时候自然退回各档的总台数。

   表头那两行（页签、搜索框）**只画一次**，重画只走下面那份名册。这是必须的，不是
   图省事：搜索框是个正在输入的控件，把它整个换掉会当场掐断输入法 —— 打拼音时
   候选框一闪就没了。名册里没有输入中的东西，整块换掉无所谓。

   **刷新 / 添加设备在底栏最右，不在表头**（用户定的）：三个页签加两枚按钮挤在
   一行里，窄屏上「添加设备」会被顶出框外。底栏本来就要一条给「显示终端IP」开关
   （左：开关在左、文字在右），两枚按钮正好搬到它右边，各占一头 —— 刷新只留一个
   图标（它不常按，字留给「添加设备」）。
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
  if (!S.data.terminals.length){ toast("终端名册还没拿到，等连上服务器再点这一格", "err"); return; }
  let tab = "online";
  let q = "";                        /* 搜索词。只活在这个框里，和 tab 一样每次开都从头来 */
  let paint = null;
  openModal({
    title: "终端管理",
    sub: "共 " + S.data.terminals.length + " 个终端 · 终端状态推送" + linkStateText(),
    width: "560px",
    /* 关掉时把重画回调摘掉：不摘的话，状态每变一次它就往一个已经不在了的框里写一遍。 */
    onClose(){
      const i = statusHooks.indexOf(paint); if (i>=0) statusHooks.splice(i,1);
      termListPaint = null;
    },
    mount(b, f, mm){
      b.classList.add("grow-body");     /* 页签钉住，只让下面这份名册自己滚 */
      const subEl = $(".modal-head .sub", mm.host);   /* 副标题里的台数跟着名册走 */
      /* 底栏：左头是「显示终端IP」开关，右头是刷新 / 添加设备（表头腾出来的地方）。
         开关**在左、文字在右** —— .switch 默认排法是文字在前，这里把两段调个个儿。
         竖屏上 IP 和名字挤在一行里，想只看名字的，把这段 IP 收起来；
         默认开着 —— 关掉之后行里连 IP 都不显示，那是反直觉的状态，不该是默认值。 */
      f.classList.add("term-foot");
      f.innerHTML =
        '<label class="switch" title="关掉之后，这份名册里不再显示终端 IP">'+
          '<input type="checkbox" id="termIpTgl"'+(termShowIp?" checked":"")+'>'+
          '<span class="track"></span><span class="dimmer">显示终端IP</span>'+
        '</label>'+
        '<span class="spacer"></span>'+
        /* 刷新只留图标（用户定的）：底栏左边那格开关占着字，右边再摆一枚带字的按钮，
           窄屏上「添加设备」就没地方了。它和「新建任务」那一栏底下那颗是同一种键 ——
           单独一个图标、说法写在 title/aria-label 里。 */
        '<button class="btn btn-sm btn-quiet btn-icon" data-act="reload" title="刷新" aria-label="刷新">'+ICON.refresh+'</button>'+
        '<button class="btn btn-sm" data-act="add">'+ICON.plus+' 添加设备</button>';
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
        '</div>'+
        /* 搜索框不挤在页签那一行里：那一行在竖屏上本来就刚好占满（两个页签加两枚
           按钮），再塞一格进去会把「添加设备」顶出框外。它自己一行，两边都够用。 */
        '<div class="pick-search">'+
          '<span class="sbox">'+ICON.search+
            '<input class="input" id="termQ" placeholder="搜索名称或 IP">'+
          '</span>'+
        '</div>'+
        '<div class="term-list" id="termBox"></div>';
      const qEl = $("#termQ", b);
      qEl.oninput = ()=>{ q = qEl.value; paint(); };
      $$(".tab", b).forEach(x=> x.onclick = ()=>{ tab = x.dataset.t; paint(); });
      /* 那两枚住在底栏里（f），不在 b 里 —— 它们不参与重画，绑一次就够。 */
      f.querySelector('[data-act="reload"]').onclick = ()=> reloadTerminals();
      f.querySelector('[data-act="add"]').onclick    = ()=> openDeviceAdd();

      paint = ()=>{
        const terms   = S.data.terminals;      /* 每次现取：名册是会整个换掉的一份数据 */
        const online  = terms.filter(t=> statusOf(t.name)==="online");
        const rest    = terms.filter(t=> statusOf(t.name)!=="online");
        /* 搜索在**当前这一页签里**滤（名字和 IP 一起比，照 20-ui.js 那个点位搜索）。
           句柄 hit 在没词的时候对谁都点头，所以下面三处「滤完还剩几台」不用分情况
           写：没搜索时它们退回各档总数，搜着的时候就是各档里的匹配数。 */
        const ql      = q.trim().toLowerCase();
        const hit     = t => !ql || (String(t.name)+" "+String(t.ip_address)).toLowerCase().indexOf(ql) >= 0;
        const list    = (tab==="online" ? online : tab==="offline" ? rest : terms).filter(hit);
        const onHit   = online.filter(hit).length;
        const offHit  = rest.filter(hit).length;
        const allHit  = terms.filter(hit).length;
        const unknown = rest.filter(t=> statusOf(t.name)==="unknown").length;
        /* 搜不到时空着的那句话。**不用**在这儿报「别的页签里有几个」——那件事归页签
           上的数字说（见上面），一句话里再复述一遍就成了两个地方报同一个数，还容易
           岔。这儿只说这一页签里的事。 */
        const emptyText = ql
          ? "没有匹配的终端。"
          : (tab==="online" ? "没有终端在线。" : tab==="offline" ? "没有不在线的终端。" : "还没有终端。");
        if (subEl) subEl.textContent =
          "共 " + terms.length + " 个终端 · 终端状态推送" + linkStateText();
        /* 页签上的数字、页签的选中态，全都**原地改**（表头不参与重画，见上面那段）。
           只有下面那份名册是整块重画的 —— 它里面没有输入中的控件，换掉它不会打断谁。 */
        const onTab = $("#termTabOn", b), offTab = $("#termTabOff", b), allTab = $("#termTabAll", b);
        onTab.textContent  = "在线 " + onHit;
        offTab.textContent = "离线 " + offHit;
        allTab.textContent = "全部 " + allHit;
        onTab.classList.toggle("on", tab==="online");
        offTab.classList.toggle("on", tab==="offline");
        allTab.classList.toggle("on", tab==="all");
        const box = $("#termBox", b);
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
                  return '<div class="pick-row" title="'+statusTitle(t.name)+'">'+statusDot(t.name)+
                    '<span class="nm">'+esc(t.name)+'</span>'+
                    (st==="unknown" ? '<span class="stt">状态未知</span>' : "")+
                    '<span class="ip">'+esc(t.ip_address||"")+'</span>'+
                    '<span class="dacts">'+
                      '<button class="cell-btn" data-edit="'+esc(t.id)+'" title="编辑这台设备" aria-label="编辑">'+ICON.edit+'</button>'+
                      '<button class="cell-btn danger" data-del="'+esc(t.id)+'" data-name="'+esc(t.name)+'" title="删除这台设备" aria-label="删除">'+ICON.del+'</button>'+
                      /* 竖屏上旁边那两枚收成这一枚（css 换的，宽屏上看不见它、竖屏看不见那两枚） */
                      '<button class="cell-btn r-more" data-more="'+esc(t.id)+'" title="更多操作" aria-label="更多操作">'+ICON.dots+'</button>'+
                    '</span></div>';
                }).join("")
              : '<div class="hint" style="padding:12px 11px">'+emptyText+'</div>');
        $$("[data-edit]", b).forEach(x=> x.onclick = ()=> openDeviceEditor(x.dataset.edit));
        $$("[data-del]",  b).forEach(x=> x.onclick = ()=> deleteDevice(x.dataset.del, x.dataset.name));
        /* 竖屏上那两枚收成这一枚。设备总是现从名册里取 —— 这个框开着的时候
           名册可能刚被换掉（17-device.js 每次写完都重拉一份），拿闭包里那个旧对象
           去改，改的是一台已经不在了的设备。 */
        $$("[data-more]", b).forEach(x=> x.onclick = ()=>{
          const t = S.data.terminals.find(y=> String(y.id)===String(x.dataset.more));
          if (!t) return;
          openRowMenu(x, [
            { icon:ICON.edit, label:"编辑", onPick:()=> openDeviceEditor(t.id) },
            { icon:ICON.del,  label:"删除", onPick:()=> deleteDevice(t.id, t.name), danger:true },
          ]);
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
    const v = (Number(e.Status)===1 || e.StatusDsp==="online") ? "online" : "offline";
    if (S.termStat[n] !== v){ S.termStat[n] = v; changed = true; }
  });
  return changed;
}

/* ── WebSocket ─────────────────────────────────────────────────────── */
let statWS = null, statRetry = 0, statTimer = null;

function statSend(ws){
  try{
    ws.send(JSON.stringify({
      company:"BL", actioncode:STAT_ACT.req, token:S.token||"",
      data:{}, result:0, return_message:""
    }));
  }catch(e){}
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

  ws.onopen = ()=>{ statRetry = 0; S.link = "ok"; statSend(ws); renderTopbar(); };
  ws.onmessage = e=>{
    let m = null;
    try{ m = JSON.parse(e.data); }catch(err){ return; }
    if (!m || (m.actioncode!==STAT_ACT.ack && m.actioncode!==STAT_ACT.push)) return;
    const d = m.data || m;
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
