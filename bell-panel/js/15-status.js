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

/* 顶栏那格读数 */
function linkText(){
  if (S.link==="ok"){ const c = statusCount(); return "终端 "+c.on+"/"+c.total; }
  if (S.link==="busy") return "状态连接中";
  return "终端状态未连";
}
/* 推送本身连没连上。顶栏那一格的提示语让给「点击查看终端列表」了，这句交代跟着
   搬进那张表的副标题 —— 那里地方大，也正是「这些点为什么是灰的」的答案。 */
function linkStateText(){
  return S.link==="ok" ? "已连接" : S.link==="busy" ? "连接中" : "未连接";
}

/* ══ 终端列表（点顶栏那句「终端 xx/xx」）═════════════════════════════
   两个页签：在线 / 离线。名册取 S.data.terminals（GET /terminals 那一份，79 个），
   **不拿 S.termStat 当名册** —— 那张表只有推送报过的终端，推送没连上时它是空的，
   这个框会变成一个空壳。

   **「离线」这一页收的是「不在线」**：状态还没收到的终端也落在这一页（它们只是
   「不知道」，不是「离线」）。所以页签名可以笼统，行里的字不能 —— 每行照实写自己
   的状态字，是「状态未知」就写「状态未知」，顶上也补一句说明。页签上的数字跟着
   这些行走，不跟顶栏那格读数走：那格读的是推送报过的终端数。

   行是**纯读数，点不动**（借 .pick-row 的排版，CSS 里把它的手型和悬停去掉了）。 */
function openTermList(){
  if (!S.data.terminals.length){ toast("终端名册还没拿到，等连上服务器再点这一格", "err"); return; }
  let tab = "online";
  let paint = null;
  openModal({
    title: "终端列表",
    sub: "共 " + S.data.terminals.length + " 个终端 · 终端状态推送" + linkStateText(),
    width: "520px",
    footer: false,
    /* 关掉时把重画回调摘掉：不摘的话，状态每变一次它就往一个已经不在了的框里写一遍。 */
    onClose(){ const i = statusHooks.indexOf(paint); if (i>=0) statusHooks.splice(i,1); },
    mount(b){
      b.classList.add("grow-body");     /* 页签钉住，只让下面这份名册自己滚 */
      paint = ()=>{
        const terms   = S.data.terminals;      /* 每次现取：名册是会整个换掉的一份数据 */
        const online  = terms.filter(t=> statusOf(t.name)==="online");
        const rest    = terms.filter(t=> statusOf(t.name)!=="online");
        const list    = tab==="online" ? online : rest;
        const unknown = rest.filter(t=> statusOf(t.name)==="unknown").length;
        b.innerHTML =
          '<div class="tabs" style="padding:0;margin:0 0 10px">'+
            '<button class="tab'+(tab==="online"?" on":"")+'" data-t="online">在线 '+online.length+'</button>'+
            '<button class="tab'+(tab==="offline"?" on":"")+'" data-t="offline">离线 '+rest.length+'</button>'+
          '</div>'+
          '<div class="term-list">'+
            (tab==="offline" && unknown
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
                    '<span class="ip">'+esc(t.ip_address||"")+'</span></div>';
                }).join("")
              : '<div class="hint" style="padding:12px 11px">'+
                (tab==="online" ? "没有终端在线。" : "没有不在线的终端。")+'</div>')+
          '</div>';
        $$(".tab", b).forEach(x=> x.onclick = ()=>{ tab = x.dataset.t; paint(); });
      };
      paint();
      /* 状态推送一到就重画一遍：点变色那条 refreshStatusDots() 只管点，可页签上的
         数字、行落在哪一页，都得跟着走。 */
      statusHooks.push(paint);
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
