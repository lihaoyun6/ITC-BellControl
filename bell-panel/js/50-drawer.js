/* drawer — 待提交队列与下发
   广播控制台 · 替代厂商后台的打铃配置面板
   ////////////////////////////////////////////////////////////// */

/* ══ drawer (pending) ═══════════════════════════════════════════════ */
let drawerOpen=false, drawerTab="list";
function openDrawer(){ drawerOpen=true; drawerTab="list"; renderDrawer(); }
function closeDrawer(){ drawerOpen=false; renderDrawer(true); }
/* 抽屉占着右边一整条，右下角的提示会正好坐在「写入服务器」按钮上。
   开抽屉时把提示挪到抽屉左边（窄屏挪到抽屉页脚上方）。 */
function syncToastSide(on){ document.body.classList.toggle("drawer-open", !!on); }

function renderDrawer(close){
  const host = $("#layers");
  if (!drawerOpen){ if ($("#dscrim")){ $("#dscrim").remove(); $("#drawer").remove(); } syncToastSide(false); return; }
  syncToastSide(true);
  const ops = S.pending;
  const np = ops.filter(o=>o.status==="pending");
  const running = ops.some(o=>o.status==="running");

  let inner;
  if (drawerTab==="json"){
    inner = '<pre class="code">'+esc(JSON.stringify(ops.map(o=>({method:o.method, url:"/api/v2"+o.url, body:o.body})),null,2))+'</pre>';
  } else {
    inner = ops.length ? ops.map(o=>{
      const cls = o.status==="ok"?"ok":o.status==="err"?"err":"";
      return '<div class="op '+cls+'">'+
        '<div class="l1"><span class="k '+o.method+'">'+o.method+'</span>'+
          '<span class="t">'+esc(o.label)+'</span>'+
          '<span class="badge '+(o.status==="ok"?"badge-on":o.status==="err"?"badge-override":"badge-inherit")+'">'+
            (o.status==="ok"?"已写入":o.status==="err"?"失败":o.status==="running"?"发送中":"待提交")+'</span>'+
        '</div>'+
        '<div class="l2">'+esc(o.sub)+' · '+o.method+' /api/v2'+esc(o.url)+'</div>'+
        (o.msg?'<div class="l2" style="color:var(--crit)">'+esc(o.msg)+'</div>':"")+
      '</div>';
    }).join("") : '<div class="empty" style="padding:50px 10px"><h3>'+
        (S.draft?"列队是空的":"即时模式，列队只当记录")+'</h3></div>';
  }

  if (close || !$("#drawer")){
    if ($("#dscrim")) $("#dscrim").remove();
    if ($("#drawer")) $("#drawer").remove();
    if (close) return;
    const scrim = document.createElement("div");
    scrim.className = "scrim"; scrim.id="dscrim"; scrim.onclick = closeDrawer;
    host.appendChild(scrim);
    const d = document.createElement("div");
    d.className="drawer"; d.id="drawer";
    host.appendChild(d);
  }
  const d = $("#drawer");
  d.innerHTML =
    '<div class="drawer-head"><h3>提交队列</h3>'+
      '<span class="sub" style="font-size:12px;color:var(--fg-3)">'+(S.draft?np.length+" 项待写入":"只当记录")+'</span>'+
      '<span style="flex:1"></span>'+
      /* 危险操作的样子：这一下把攒着的改动全扔了，面板回到服务器的样子 */
      (ops.length?'<button class="btn btn-danger" id="dClear">清空</button>':"")+
      (S.draft?'<button class="btn btn-crit" id="dSend"'+(np.length&&!running?"":" disabled")+'>发送</button>':"")+
      '<button class="btn btn-sm btn-quiet btn-icon" id="dClose" aria-label="关闭">'+ICON.x+'</button>'+
    '</div>'+
    '<div class="tabs"><button class="tab '+(drawerTab==="list"?"on":"")+'" data-tab="list">改动清单</button>'+
      '<button class="tab '+(drawerTab==="json"?"on":"")+'" data-tab="json">将发送的报文</button></div>'+
    '<div class="drawer-body">'+inner+'</div>'+
    '<div class="drawer-foot">'+
      '<span class="dimmer" style="font-size:12.5px">'+
        (S.draft ? '草稿模式已开：改完一起提交（顶栏可关，关掉就立刻发出去）'
                 : '即时模式：改动已经直接写进服务器了')+'</span>'+
    '</div>';

  $("#dClose").onclick = closeDrawer;
  $("#dClear").onclick = clearPending;
  $$(".tab",d).forEach(t=> t.onclick = ()=>{ drawerTab=t.dataset.tab; renderDrawer(); });
  const send = $("#dSend");
  if (send) send.onclick = pushAll;
}

/* 清空 = 把攒着的改动全扔了，面板回到服务器的样子。
   只清队列不够 —— 本地那些乐观改动还挂在列表上，看着像已经生效了。 */
async function clearPending(){
  S.pending = [];
  S.sel.clear();
  renderDrawer();                       /* 先让抽屉有反应，别等重拉完 */
  toast("已清空待提交队列，正在按服务器当前配置重新加载…","ok");
  try{ await reloadBells(); }catch(e){}
  try{ await loadTasks();  }catch(e){}
  try{ await reloadGroups(); }catch(e){}
  renderAll(); renderDrawer();
}

/* ══ 下发 ════════════════════════════════════════════════════════════
   逐条发送，串行 —— 后面那条的报文常常要用前面那条拿回来的 id
   （新建列表 → 往里写铃声；新建策略 → 回填 timing_bells_strategy_id）。
   并发发出去的话，那些 id 还是 null。
   ══════════════════════════════════════════════════════════════════ */
let sendChain = Promise.resolve();      /* 即时模式下一条接一条，不抢跑 */

/* ══ 发送期间的整页挡板 ══════════════════════════════════════════════
   草稿模式关着的时候，改一下就立刻发一条报文。可用户一次批量操作可能一口气排
   十几条进来 —— 这中间不该再让他改：后点的那笔会跟前面那些挤同一根串行链条，
   顺序和那些「发送时才现算的 id」就没法推理了。

   挡板是**全透明**的，只挡点击（外加把光标变成忙）。点一下开关那种一两百毫秒的，
   用户一个像素都看不到，不会「啪地闪一下」。只有真排上队、过了 BUSY_SLOW 还没
   排空，才浮出一行字交代一声 —— 不然十几条的批量会被当成页面卡死。

   草稿模式**一律不锁**：那个「提交」按钮一口气推九十多条要几十秒，锁住的话整段
   时间连抽屉都点不开，看不出每条是成了还是折了。所以挡板只由 sendNow（即时模式
   那条路）和它跟的那趟 settle 挂上，pushAll 那条路一概不碰。

   计数式：一次用户操作可能排进十几条，全排空了才松。busyOn() 交回一个凭据，
   busyOff() 认凭据 —— 免得中途哪条路走岔了把账算错，挡板就永远摘不下来。 */
const BUSY_SLOW = 400;                  /* 排队超过这么久才值得吱一声 */
let busyN = 0, busySlowT = null;

function busyOn(){
  if (++busyN === 1){
    document.body.classList.add("busy");
    busySlowT = setTimeout(()=>{
      busySlowT = null;
      if (busyN) document.body.classList.add("busy-slow");
    }, BUSY_SLOW);
  }
  return true;
}
function busyOff(t){
  if (!t || busyN <= 0) return;
  if (--busyN) return;
  clearTimeout(busySlowT); busySlowT = null;
  document.body.classList.remove("busy","busy-slow");
}

function applyLocally(o, r){
  const ent = o.entity || "bell";           /* "bell" | "list" | "task" */
  if (ent==="bell" && o.kind==="delete") S.bells = S.bells.filter(b=>b.id!==o.bellId);
  if (ent==="bell" && o.kind==="create" && r && r.id){
    const nb = S.bells.find(b=>String(b.tmpId)===String(o.bellId));
    if (nb){ nb.id = r.id; nb.isNew=false; delete nb.tmpId; }
  }
  if (ent==="task" && o.kind==="task-delete"){
    const tid = Number(o.body && o.body.ids && o.body.ids[0]);
    S.tasks = S.tasks.filter(t=>Number(t.id)!==tid);
  }
}

/* 报文里的 id 是在**发送这一刻**才定下来的，不是排进队列那一刻。
   有些东西（临时列表的负数 id、还没建出来的周期 id）入队时根本还不存在，
   只能等前面那条建好了、拿到真 id 才知道该填什么。

   本来这件事是靠 onOk 回头去 S.pending 里找「还带着负数 id 的报文」改一改的，
   但那套办法只在一个地方成立：草稿模式下 pushAll 一口气发完，中途没人动队列。
   即时模式下 settle() 会在每条发完后 1.2 秒动一次 S.pending，
   把**还没轮到的**报文一起剔出去（当时那行 filter 只留 status==="ok"），
   于是 onOk 回头一条也找不着 —— 副本铃声就带着 -1 这样的临时 id 发出去了，
   服务端全拒，那张副本列表看着是空的。

   所以改成 o.bodyFn：发的时候现算一遍，不依赖队列里还剩谁。 */
async function runOp(o){
  o.status="running"; o.msg=""; renderDrawer();
  try{
    const body = o.bodyFn ? o.bodyFn() : o.body;
    const r = await api(o.method, o.url, {body:body});
    o.status="ok";
    if (o.onOk) { try{ o.onOk(r); }catch(e){} }
    applyLocally(o, r);
    renderDrawer();
    return true;
  }catch(e){
    o.status="err"; o.msg = e.message;
    renderDrawer();
    return false;
  }
}

/* 一批改动做完：重拉受影响的数据，再把这批记录里报过错的清掉。
   一次批量改区域可能落几十条报文，不能每条都重拉一遍 —— 攒在一个 tick 里做一次。 */
let settleTimer = null;
/* sendNow 的挡板凭据先寄存在这儿，交给紧随其后的那趟 settle 一起交还。
   报文落定到 settle 真正开跑之间隔着这 260ms 的合并窗口；在这里就先 busyOff
   的话，计数会归零、挡板摘掉，下一秒 settle 又 busyOn 挂回去 —— 服务器稍慢
   一点，那句「正在写入服务器…」就会闪两回（发报文一回、重拉一回）。 */
let settleTickets = [];
function scheduleSettle(ticket){
  if (ticket) settleTickets.push(ticket);
  if (settleTimer) return;
  settleTimer = setTimeout(()=>{ settleTimer = null; settle(true); }, 260);
}
function releaseSettleTickets(){
  if (!settleTickets.length) return;
  const ts = settleTickets; settleTickets = [];
  ts.forEach(busyOff);
}
/* veil=true：这一趟是即时模式那条路跟过来的，重拉加重画的这一小段也把挡板算上
   （那几百毫秒里点东西会被紧接着的重画直接吃掉）。pushAll 传 false —— 草稿模式
   不动挡板，理由见上面那段。 */
async function settle(veil){
  const done = S.pending.filter(o=>o.status==="ok" || o.status==="err");
  if (!done.length){ if (veil) releaseSettleTickets(); return; }
  const busy = veil ? busyOn() : false;
  try{
    const ok  = done.filter(o=>o.status==="ok").length;
    const bad = done.filter(o=>o.status==="err").length;
    try{ await reloadBells(); }catch(e){}
    if (done.some(o=>(o.entity||"bell")==="task")) { try{ await loadTasks(); }catch(e){} }
    /* 列表本体（is_done / 新建 / 删除）提交后要重拉侧栏 —— 建出来的临时列表得
       在本地换成真 id；失败时也要把乐观改过的值拉回来 */
    if (done.some(o=>o.entity==="list")) { try{ await reloadGroups(); }catch(e){} }
    S.sel.clear();
    renderAll(); renderDrawer();
    if (bad) toast("提交结束："+ok+" 项成功，"+bad+" 项失败", "err");
    /* 清掉已经报过错的，撤掉跑完的旧记录 —— 但**不碰还没轮到的那些**。
       这里原来写的是 filter(o=>o.status==="ok")，只留发完的，于是把「刚排进来、
       还在 sendChain 后面排队」的报文一起删了：一次推送 93 条要 30 秒，这半分钟里
       用户再改一笔，那一笔就会在推送结束时被无声无息地吃掉。 */
    setTimeout(()=>{
      S.pending = S.pending.filter(o=> o.status!=="err");
      renderAll(); renderDrawer();
    }, bad?4000:1200);
  } finally {
    busyOff(busy);
    if (veil) releaseSettleTickets();
  }
}

/* 即时模式下的一条：进队列 → 立刻排队发出去（和前后那些严格串行）。 */
function sendNow(op){
  const busy = busyOn();
  sendChain = sendChain
    .then(()=> runOp(op))
    .catch(()=>{})
    /* 报文落定（成也好败也好）后把凭据交给 settle，而不是就地交还：
       重拉数据也是这一趟操作的一部分，两段要算在同一个挡板里（见 settleTickets）。
       上一批排了十几条的话，计数要等最后一条走完、settle 也落定才归零 ——
       也就是「队列排空」那一下才松。 */
    .then(()=>{ scheduleSettle(busy); });
}

/* 草稿模式下的「提交到服务器」：把攒着的按顺序一次发完。 */
function pushAll(){
  const ops = S.pending.filter(o=>o.status==="pending");
  if (!ops.length) return;
  sendChain = sendChain.then(async ()=>{
    for (const o of ops) await runOp(o);
    await settle(false);
    const ok = ops.filter(o=>o.status==="ok").length;
    const bad = ops.filter(o=>o.status==="err").length;
    if (ok && !bad) toast("已写入 "+ok+" 项改动","ok");
  }).catch(()=>{});
  return sendChain;
}
