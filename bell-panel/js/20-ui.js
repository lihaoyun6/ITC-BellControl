/* ui — 模态框、区域选择器、音源选择器
   广播控制台 · 替代厂商后台的打铃配置面板
   ////////////////////////////////////////////////////////////// */

/* ══ modal shell ════════════════════════════════════════════════════ */
let modalStack = [];
const modalOnClose = {};      /* id → 关掉时要跑的清理（比如摘掉状态刷新回调） */
function openModal(cfg){
  const id = "m"+Math.random().toString(36).slice(2,8);
  const scrim = document.createElement("div");
  scrim.className="scrim"; scrim.dataset.for=id;
  if (!modalStack.length) scrim.onclick = ()=> closeModal(id);
  const host = document.createElement("div");
  host.className="modal-host"; host.id=id; host.dataset.scrim=scrim.dataset.for;
  host.style.setProperty("--mw", cfg.width || "560px");
  host.innerHTML = '<div class="modal" role="dialog" aria-modal="true">'+
    '<div class="modal-head"><div style="min-width:0"><h3>'+esc(cfg.title)+'</h3>'+(cfg.sub?'<div class="sub">'+esc(cfg.sub)+'</div>':"")+'</div>'+
      '<span style="flex:1"></span><button class="btn btn-sm btn-quiet btn-icon" data-close aria-label="关闭">'+ICON.x+'</button></div>'+
    '<div class="modal-body"></div>'+
    (cfg.footer===false?"":'<div class="modal-foot"></div>')+
  '</div>';
  document.body.appendChild(scrim);
  $("#layers").appendChild(host);
  modalStack.push(id);
  if (cfg.onClose) modalOnClose[id] = cfg.onClose;
  const m = {id, host, scrim, cfg};
  host.querySelector("[data-close]").onclick = ()=> closeModal(id);
  document.addEventListener("keydown", escHandler);
  cfg.mount && cfg.mount(host.querySelector(".modal-body"), host.querySelector(".modal-foot"), m);
  return m;
}
function escHandler(e){ if(e.key==="Escape" && modalStack.length) closeModal(modalStack[modalStack.length-1]); }
function closeModal(id){
  const i = modalStack.indexOf(id); if (i<0) return;
  modalStack.splice(i,1);
  const h = document.getElementById(id); const s = document.querySelector('.scrim[data-for="'+id+'"]');
  if (h) h.remove(); if (s) s.remove();
  if (!modalStack.length) document.removeEventListener("keydown", escHandler);
  const fn = modalOnClose[id]; delete modalOnClose[id];
  if (fn){ try{ fn(); }catch(e){} }
}
function closeTopModal(){ if (modalStack.length) closeModal(modalStack[modalStack.length-1]); }

/* ══ 没填对的必填格：套一圈红 ════════════════════════════════════════
   考试模式那张表就是这么标缺格的（`.is-err`，见 css）——「启用」被拦下来时，
   缺的那一格红一圈。它比一句 toast 强的地方：toast 三秒就没了，人得自己回去
   找是哪一格；红圈留在原地，缺哪儿一眼看见。

   标的东西两种都收：`.field`（里面装着 input/select，css 点的是里面那个控件），
   和**没有控件的盒子** —— 执行区域那种 `.area-chips`，css 另有一条给它套边。

   标的同时挂一次性监听，人一动手就把红摘掉（打着字看着红没了，比等下一次
   保存才知道强）。每回保存前先 clearErr 清上一轮 —— 不然改好的那格还红着，
   看着像没改对。root 一律传模态正文：`.is-err` 考试页也在用，别清到那边去。 */
function clearErr(root){
  if (!root) return;
  $$(".is-err", root).forEach(x=> x.classList.remove("is-err"));
}
function markErr(root, sel){
  if (!root) return;
  const el = typeof sel === "string" ? $(sel, root) : sel;
  if (!el) return;
  clearErr(root);
  el.classList.add("is-err");
  const off = ()=> el.classList.remove("is-err");
  el.addEventListener("input", off, {once:true});
  el.addEventListener("change", off, {once:true});
}

function openConfirm(title, body, onYes, yesLabel, danger){
  const m = openModal({title, width:"440px", mount(b, f, mm){
    b.innerHTML = '<p style="margin:0;font-size:13.5px;line-height:1.7">'+esc(body)+'</p>';
    f.innerHTML = '<span class="spacer"></span><button class="btn" data-cancel>取消</button>'+
      '<button class="btn '+(danger?"btn-danger":"btn-primary")+'" data-yes>'+esc(yesLabel||"确定")+'</button>';
    f.querySelector("[data-cancel]").onclick = ()=> closeModal(mm.id);
    f.querySelector("[data-yes]").onclick = ()=>{ closeModal(mm.id); onYes(); };
  }});
  return m;
}

/* 点位选择器顶上那行红绿点说明。状态推送没连上时别装作知道 —— 直说未知。 */
function statLegend(){
  if (S.link==="ok")
    return '<div class="pick-legend"><span class="tdot online"></span>在线'+
      '<span class="tdot offline"></span>离线<span class="tdot unknown"></span>状态未知</div>';
  const why = S.link==="busy" ? "正在连接" : "未连接";
  return '<div class="pick-legend"><span class="tdot unknown"></span>'+
    why+'终端状态推送，点位在线情况未知</div>';
}

/* ══ 批量编辑菜单 ════════════════════════════════════════════════════
   批量条上原来摊着「改区域 / 改铃音 / 改时间 / 恢复默认」四个文字按钮，连同
   启用 / 停用 / 删除一共七个 —— 窄屏上换行换得看不出是一组，而且前四个各自
   还要再弹一个框，等于按两下。现在那四个收进一枚铅笔：点开是这张小单子，
   一目了然，也只剩一层。启用 / 停用 / 删除留在栏上 —— 它们各自只要一下，
   而且是高频动作，藏进去反而多点一步。

   items: [{icon, label, sub, onPick}]。onPick 在**模态关掉之后**才跑，
   否则两层模态会叠在一起（改区域那三个自己也都是弹框）。 */
function openBulkMenu(title, sub, items){
  openModal({
    title, sub, width:"420px",
    mount(body, foot, mm){
      body.innerHTML = '<div class="act-list">'+
        items.map((it,i)=>'<button class="act-row" data-i="'+i+'">'+
          '<span class="ai">'+(it.icon||"")+'</span>'+
          '<span class="at"><b>'+esc(it.label)+'</b>'+(it.sub?'<span class="as">'+esc(it.sub)+'</span>':"")+'</span>'+
        '</button>').join("")+
      '</div>';
      foot.innerHTML = '<span class="spacer"></span><button class="btn" id="bmCancel">取消</button>';
      foot.querySelector("#bmCancel").onclick = ()=> closeModal(mm.id);
      $$("[data-i]", body).forEach(b => b.onclick = ()=>{
        const it = items[Number(b.dataset.i)];
        closeModal(mm.id);
        it.onPick();
      });
    }
  });
}

/* ══ area editor ════════════════════════════════════════════════════
   mode: "list"  编辑列表级默认区域
         "bulk"  批量改选中铃声的区域
         "pick"  只挑选一个区域，通过 onDone(area) 回传
   ═════════════════════════════════════════════════════════════════ */
function openAreaEditor(mode, bulkList, onDone){
  const isList = mode==="list", isPick = mode==="pick";
  const seed = isList ? S.listArea : S.dt.area;
  S.dt.area = {t:(seed.t||[]).slice(), g:(seed.g||[]).slice()};
  S.dt.areaTab="term"; S.dt.areaQ=""; S.dt.areaGroup="all";
  let applyAll = false;

  let statHook = null;      /* 在线状态变化时重画选择器；关了模态框要摘掉 */

  const m = openModal({
    title: isPick ? "选择执行区域" : isList ? "编辑列表打铃区域" : "批量修改区域（"+bulkList.length+" 条）",
    sub: isPick ? "选好点位与分组，确定后应用"   /* 单条和批量都走 pick，别写死「这条铃声」 */
       : isList ? "改完点确定，列表内「默认」的铃声会一起更新"
       : "选中的铃声将统一改为下面的区域",
    width:"760px",
    onClose: ()=>{ if (statHook){ const i=statusHooks.indexOf(statHook); if (i>=0) statusHooks.splice(i,1); statHook=null; } },
    mount(body, foot, mm){
      body.innerHTML =
        '<div class="stack">'+
          '<div class="sect"><div class="sect-h">已选区域 <span class="mono" id="aCount"></span>'+
            /* 「清空」一律是危险操作的样子（白底红框红字）—— 它一键就把已选的
               点位和分组全扔了，长得跟旁边的普通按钮一样容易被误点。 */
            '<span class="acts"><button class="btn btn-sm btn-danger" id="aClear">清空</button></span></div>'+
            '<div class="sect-b"><div class="sel-chips" id="aChips"></div></div></div>'+
          '<div class="tabbar" id="aTabs">'+
            '<button data-t="term" class="on">终端点位 · '+S.data.terminals.length+'</button>'+
            '<button data-t="group">分组 · '+S.data.termGroups.length+'</button>'+
          '</div>'+
          '<div id="aPane"></div>'+
          (isList?'<label class="chk"><input type="checkbox" id="aAll"> 同时覆盖已设为「特例」的铃声</label>':"")+
        '</div>';
      foot.innerHTML = '<span class="spacer"></span><button class="btn" id="aCancel">取消</button>'+
        '<button class="btn btn-primary" id="aOk">确定</button>';

      const chips = ()=> $("#aChips");
      const drawChips = ()=>{
        const a = S.dt.area;
        chips().innerHTML = (a.t.length+a.g.length)
          ? a.t.map(n=>'<span class="chip chip-term" title="'+statusTitle(n)+'">'+statusDot(n)+esc(n)+'<button class="x" data-rm="t" data-n="'+esc(n)+'" aria-label="移除">×</button></span>').join("")+
            a.g.map(n=>'<span class="chip chip-group"><span class="dot"></span>'+esc(n)+'<button class="x" data-rm="g" data-n="'+esc(n)+'" aria-label="移除">×</button></span>').join("")
          /* chip-ph 也是 .chip，为的是把一颗胶囊的高度先占住 —— 见 css 里那段注释 */
          : '<span class="chip chip-ph">还没有选任何点位或分组</span>';
        $("#aCount").textContent = a.t.length+" 点位 / "+a.g.length+" 分组";
      };
      const drawPane = ()=>{
        const tab = S.dt.areaTab;
        const pane = $("#aPane");
        if (tab==="term"){
          const groups = S.data.termGroups;
          pane.innerHTML =
            '<div style="display:flex;gap:8px;margin-bottom:8px">'+
              '<input class="input" id="aq" placeholder="搜索点位名称或 IP" value="'+esc(S.dt.areaQ)+'">'+
              '<select class="select" id="ag" style="width:150px"><option value="all">全部分组</option>'+
                groups.map(g=>'<option value="'+g.id+'"'+(String(S.dt.areaGroup)===String(g.id)?" selected":"")+'>'+esc(g.name)+'</option>').join("")+
              '</select>'+
            '</div>'+
            /* 红绿点那份说明原来自成一行杵在这儿（搜索框下面），占掉一行高度，
               说的却是下面那些行头上的点是什么颜色 —— 现在挂到「全选」那一行的
               最右边去（见 drawAllRow），贴着想说明的东西。 */
            '<div class="pick-head" id="aHead"></div>'+
            '<div class="pick" id="apick"></div>';
          $("#aq").oninput = e => { S.dt.areaQ = e.target.value; drawPick(); };
          $("#ag").onchange = e => { S.dt.areaGroup = e.target.value; drawPick(); };
          drawPick();
        } else {
          pane.innerHTML = '<div class="pick-head" id="aHead"></div>'+
            '<div class="grp-grid" id="agrid"></div>';
          drawGroups();
        }
      };
      /* 列表头上那格「全选」。勾的是**当前列出来的这一批**，不是整个媒体库 ——
         搜索或分组筛过之后，「全选搜索结果」比「全选两千个点位」有用得多，
         而后者的入口就是清掉搜索框再点它。
         三种状态照抄「按节次生成」预览表头上那一格：全勾 / 全不勾 / 半勾。
         key 是往哪个数组里写：点位页签是 "t"，分组页签是 "g" —— 两页共用这一格，
         写错就变成「在分组页上全选了所有点位」。 */
      const drawAllRow = (names, label, key)=>{
        const head = $("#aHead"); if (!head) return;
        const nOn = names.filter(n=> S.dt.area[key].indexOf(n)>=0).length;
        /* 红绿点那份说明挂在**这一行的最右边**（CSS 里 margin-left:auto 顶过去）。
           它说的是下面每一行头上那个点的颜色，贴在这行正好。
           列表空了（搜索没搜着）也照样留着它 —— 状态推送连没连上，跟搜没搜到无关；
           原来那版空列表把整行清成空的，底下 .pick 里那句「没有匹配的点位」
           本来就说得够清楚了，不用这一行再补一句。 */
        head.innerHTML = (names.length ?
            '<label class="chk"><input type="checkbox" id="aAllPick">'+
              '<span>全选</span></label>'+
            '<span class="hint">'+label+' '+names.length+' 个'+(nOn?' · 已选 '+nOn:'')+'</span>'
          : "") + statLegend();
        const cb = $("#aAllPick");
        if (!cb) return;
        cb.checked = nOn>0 && nOn===names.length;
        cb.indeterminate = nOn>0 && nOn<names.length;
        cb.onchange = ()=>{
          const sel = S.dt.area[key];
          if (cb.checked){
            names.forEach(n=>{ if (sel.indexOf(n)<0) sel.push(n); });
          } else {
            const drop = new Set(names);
            S.dt.area[key] = sel.filter(n=> !drop.has(n));
          }
          drawChips(); drawPane();
        };
      };
      const drawPick = ()=>{
        const q = (S.dt.areaQ||"").trim().toLowerCase();
        const gid = S.dt.areaGroup;
        let list = S.data.terminals;
        if (gid!=="all") list = list.filter(t=> (t.with_groups||[]).some(w=>String(w.terminals_groups_id)===String(gid)));
        if (q) list = list.filter(t=> (String(t.name)+" "+String(t.ip_address)).toLowerCase().indexOf(q)>=0);
        const box = $("#apick"); if (!box) return;
        drawAllRow(list.map(t=>t.name), "当前列出", "t");
        box.innerHTML = list.length ? list.map(t=>{
          const on = S.dt.area.t.indexOf(t.name)>=0;
          return '<label class="pick-row" title="'+statusTitle(t.name)+'">'+
            '<input type="checkbox" data-term="'+esc(t.name)+'"'+(on?" checked":"")+'>'+
            statusDot(t.name)+
            '<span class="nm">'+esc(t.name)+'</span><span class="ip">'+esc(t.ip_address||"")+'</span></label>';
        }).join("") : '<div class="hint" style="padding:14px">没有匹配的点位</div>';
      };
      const drawGroups = ()=>{
        const grid = $("#agrid"); if (!grid) return;
        /* 分组这边也来一格全选：场子大的时候分组能有十几个，一个个点卡片
           比勾一格费事得多。它没有搜索，所以「当前列出的」就是全部。 */
        drawAllRow(S.data.termGroups.map(g=>g.name), "共", "g");
        const counts = {}, ons = {};
        S.data.terminals.forEach(t=>{
          const hot = statusOf(t.name)==="online";
          (t.with_groups||[]).forEach(w=>{
            counts[w.terminals_groups_id] = (counts[w.terminals_groups_id]||0)+1;
            if (hot) ons[w.terminals_groups_id] = (ons[w.terminals_groups_id]||0)+1;
          });
        });
        grid.innerHTML = S.data.termGroups.map(g=>{
          const on = S.dt.area.g.indexOf(g.name)>=0;
          const total = counts[g.id]||0, hot = ons[g.id]||0;
          /* 分组是聚合，给不了单一红绿点，就摊开说几个在线 */
          const tail = S.link==="ok" ? ' · <span class="on">'+hot+'</span> 在线' : '';
          return '<button class="grp-card'+(on?" on":"")+'" data-grp="'+esc(g.name)+'">'+
            '<span class="n">'+esc(g.name)+'</span><span class="c">'+total+' 个点位'+tail+'</span></button>';
        }).join("");
      };
      /* 状态推送一连上 / 状态一变，就把打开着的选择器重画一遍 */
      statHook = ()=>{ drawChips(); if (S.dt.areaTab==="term") drawPick(); else drawGroups(); };
      statusHooks.push(statHook);

      body.addEventListener("click", e=>{
        const rm = e.target.closest("[data-rm]");
        if (rm){ const k=rm.dataset.rm, n=rm.dataset.n;
          S.dt.area[k] = S.dt.area[k].filter(x=>x!==n); drawChips(); drawPane(); return; }
        const gc = e.target.closest("[data-grp]");
        if (gc){ const n=gc.dataset.grp; const i=S.dt.area.g.indexOf(n);
          if(i>=0) S.dt.area.g.splice(i,1); else S.dt.area.g.push(n); drawChips(); drawGroups(); return; }
        const tb = e.target.closest("[data-t]");
        if (tb && tb.parentElement.id==="aTabs"){ S.dt.areaTab = tb.dataset.t;
          $$("#aTabs button").forEach(x=>x.classList.toggle("on", x===tb)); drawPane(); return; }
      });
      body.addEventListener("change", e=>{
        const cb = e.target.closest("[data-term]");
        if (cb){ const n=cb.dataset.term; const i=S.dt.area.t.indexOf(n);
          if (cb.checked && i<0) S.dt.area.t.push(n);
          if (!cb.checked && i>=0) S.dt.area.t.splice(i,1);
          drawChips(); }
      });
      $("#aClear").onclick = ()=>{ S.dt.area={t:[],g:[]}; drawChips(); drawPane(); };
      $("#aCancel").onclick = ()=> closeModal(mm.id);
      if (isList) $("#aAll").onchange = e => applyAll = e.target.checked;
      $("#aOk").onclick = ()=>{
        const area = {t:S.dt.area.t.slice(), g:S.dt.area.g.slice()};
        closeModal(mm.id);
        if (isPick){ onDone && onDone(area); return; }
        if (isList){
          const targets = applyAll ? S.bells : S.bells.filter(b=>!isOverride(b));
          const skipped = applyAll ? 0 : S.bells.filter(isOverride).length;
          S.listArea = {t:area.t.slice(), g:area.g.slice()};
          applyAreaToBells(targets, area, "列表区域");
          if (skipped) toast(skipped+" 条特例铃声未改动", "ok");
        } else {
          applyAreaToBells(bulkList, area, "批量改区域");
          S.sel.clear();
        }
      };
      drawChips(); drawPane();
    }
  });
}

/* 这儿原来还有一套「media picker (shared)」——mediaPickerHTML / drawMediaPick /
   wireMediaPicker 三件套，状态挂在全局的 S.dt.medSel|medQ|medG 上。它只有
   批量改铃音一个调用点，顶上一排预设按钮，正是这一轮从别处删掉的那种「常用行」。
   批量改铃音改开下面那个正经的多选器之后，三件套和那三个全局字段一起下掉了。 */

/* ══ 音源清单（铃声编辑框和定时任务编辑框共用）═══════════════════════
   同一个控件两处用，所以样子必须一模一样：铃音文件是素的，文件夹加一枚蓝点 +
   「（文件夹）」后缀 —— 和上面选择器那个「已选」区是同一套标记，三处长得一样，
   用户在哪儿看到的都是同一件事。
   ══════════════════════════════════════════════════════════════════ */
function soundChipsHTML(mn, gs){
  mn = mn||[]; gs = gs||[];
  if (!mn.length && !gs.length)
    return '<span class="chip chip-ph">未选择音源，点击「选择铃音」来添加</span>';
  const chip = (name, kind)=> '<span class="chip'+(kind==="g"?" chip-group":"")+'">'+
    (kind==="g"?'<span class="dot"></span>':"")+esc(name)+(kind==="g"?"（文件夹）":"")+
    '<button class="x" data-rm="'+kind+'" data-n="'+esc(name)+'" title="从这条里移除">'+ICON.x+'</button></span>';
  return mn.map(n=>chip(n,"m")).join("") + gs.map(g=>chip(g,"g")).join("");
}
/* 绑上「点 × 移除」：onRemove(kind, name)，kind 是 "m"（文件）或 "g"（文件夹）。
   调用方改完自己的状态后重画整块（时长合计、时长框都要跟着变）。 */
function mountSoundChips(box, onRemove){
  $$("[data-rm]", box).forEach(btn => btn.onclick = ()=> onRemove(btn.dataset.rm, btn.dataset.n));
}

/* ══ 二级模态：挑铃音 ════════════════════════════════════════════════
   这个系统既能放单个 mp3，也能整包放一个媒体文件夹 —— 所以两类一起选，
   一起回传。onDone({media:[名字], groups:[文件夹名]})。
   状态是本模态自己的，不碰全局 S.dt（那个是批量改铃音在用的）。
   ══════════════════════════════════════════════════════════════════ */
function openMediaPicker(media, groups, onDone, opts){
  opts = opts || {};
  /* filesOnly：只挑单个文件的地方（铃声预设、考试铃声、听力音频）用。
     它们只能存一个文件名，给个文件夹也放不进去，所以干脆不显示那个页签。 */
  const filesOnly = !!opts.filesOnly;
  /* noDir：要「预设」页签、但不要「媒体库」（考试铃声那条）。它同样是只挑一个文件
     的场合，文件夹页签给了也用不上；可预设是要给的 —— 一天里挑来挑去就那几首。 */
  const noDir = !!opts.noDir;
  /* 三个页签里「预设」排在最前，而且默认就停在它上面 —— 校广播翻来覆去就那几首，
     多数时候要挑的就是一条预设。预设名和文件名在这儿是**同一件事的两种写法**：
     勾一条预设，落进 st.media 的就是它绑的那个文件名，和「音频文件」页签里勾同一个
     文件完全等价（切过去能看到它已经勾上了）。 */
  const st = {tab:(filesOnly&&!noDir)?"file":"pre", media:(media||[]).slice(), groups:filesOnly?[]:(groups||[]).slice(), q:"", g:"all"};
  /* extra：调用方想在这个框底下再挂自己的一两格（批量改铃音要一格「播放模式」）。
     挂在页签内容区**下面**，不挤那三个恒高的列表。 */
  const extra = opts.extra;
  openModal({
    title: opts.title || "选择铃音", sub: opts.sub || "一个或多个铃音文件，或整个媒体文件夹", width:"760px",
    mount(body, foot, mm){
      /* 音频文件是在**厂商原后台**上传的，手里这份 S.data.medias 是开面板时拉的快照 ——
         不重拉，刚传上去的文件在这个框里根本不存在，人会以为是面板没同步。
         所以先把框开出来、报一句「读着呢」，拉完再画内容（见 refreshMediaLib）。
         拉失败也照画：用的是手里那份旧的，总比框打不开强。 */
      body.innerHTML = '<div class="stack">'+
        '<div class="hint" style="padding:28px 4px">正在读取服务器上的铃音列表…</div></div>';
      foot.innerHTML = '<span class="spacer"></span><button class="btn" id="mCancel">取消</button>';
      foot.querySelector("#mCancel").onclick = ()=> closeModal(mm.id);
      refreshMediaLib().then(draw);

      /* 画完的内容区、页签计数、三个 draw* 都在这一个作用域里 ——
         也正因为整块重画，页签上「音频文件 · N」那个数才是刚拉回来的那个。 */
      function draw(){
        body.innerHTML =
          '<div class="stack">'+
            '<div class="sect"><div class="sect-h">已选 <span class="mono" id="mCount"></span>'+
              '<span class="acts"><button class="btn btn-sm btn-danger" id="mClear">清空</button></span></div>'+
              '<div class="sect-b"><div class="sel-chips" id="mChips"></div></div></div>'+
            ((filesOnly&&!noDir) ? "" :
            '<div class="tabbar" id="mTabs">'+
              '<button data-t="pre"'+(st.tab==="pre"?' class="on"':"")+'>预设 · '+PRESETS.length+'</button>'+
              '<button data-t="file"'+(st.tab==="file"?' class="on"':"")+'>音频文件 · '+S.data.medias.length+'</button>'+
              (noDir ? "" : '<button data-t="dir">媒体库 · '+S.data.mediaGroups.length+'</button>')+
            '</div>')+
            '<div id="mPane"'+((filesOnly&&!noDir)?'':' class="pick-stage"')+'></div>'+
            (extra && extra.html ? extra.html : "")+
          '</div>';
        foot.innerHTML = '<span class="spacer"></span><button class="btn" id="mCancel">取消</button>'+
          '<button class="btn btn-primary" id="mOk">确定</button>';

        const drawChips = ()=>{
          const all = st.media.map(n=>'<span class="chip">'+esc(n)+'<button class="x" data-rm="m" data-n="'+esc(n)+'" aria-label="移除">×</button></span>')
            .concat(st.groups.map(n=>'<span class="chip chip-group"><span class="dot"></span>'+esc(n)+'（文件夹）<button class="x" data-rm="g" data-n="'+esc(n)+'" aria-label="移除">×</button></span>'));
          $("#mChips").innerHTML = all.length ? all.join("")
            : '<span class="chip chip-ph">还没有选任何铃音</span>';
          $("#mCount").textContent = filesOnly
            ? (st.media.length ? st.media[0] : "未选")
            : st.media.length+" 个文件 / "+st.groups.length+" 个文件夹";
        };
        /* 三个页签的内容区恒高（`.pick-stage`，见 css），切页签时框子不动。
           行数账：预设 / 媒体库 各 8 行；「音频文件」顶上多一行搜索框，所以它的
           列表只排 7 行 —— **搜索行 + 列表 = 8 行**，正好和另外两页一样高，切过去
           也不会跳。filesOnly 那条路没有页签栏，也就没有「切页签跳动」可谈，
           保持原样（考试铃声、听力音频、铃声预设编辑走这条）。 */
        const drawPane = ()=>{
          const pane = $("#mPane");
          if (st.tab==="pre"){
            pane.innerHTML = '<div class="pick" id="mpre"></div>';
            drawPresets();
          } else if (st.tab==="file"){
            pane.innerHTML =
              '<div class="pick-search">'+
                '<input class="input" id="mq" placeholder="搜索音频文件" value="'+esc(st.q)+'">'+
                '<select class="select" id="mg" style="width:160px"><option value="all">全部媒体库</option>'+
                  S.data.mediaGroups.map(g=>'<option value="'+g.id+'"'+(String(st.g)==String(g.id)?" selected":"")+'>'+esc(g.name)+'</option>').join("")+
                '</select>'+
              '</div>'+
              '<div class="pick" id="mpick"></div>';
            $("#mq").oninput = e => { st.q = e.target.value; drawFiles(); };
            $("#mg").onchange = e => { st.g = e.target.value; drawFiles(); };
            drawFiles();
          } else {
            pane.innerHTML = '<div class="pick" id="mdir"></div>';
            drawDirs();
          }
        };
        /* 预设页签：一条预设一行，名字在左、它绑的文件名在右。
           勾选框和「音频文件」页签是同一套 data-med —— 两页勾的是同一份 st.media，
           所以在哪儿勾都一样，来回切不会丢。 */
        const drawPresets = ()=>{
          const box = $("#mpre"); if (!box) return;
          box.innerHTML = PRESETS.length ? PRESETS.map(p=>
            '<label class="pick-row"><input type="checkbox" data-med="'+esc(p.media)+'"'+(st.media.indexOf(p.media)>=0?" checked":"")+'>'+
            '<span class="nm">'+esc(p.label)+'</span>'+
            '<span class="ip">'+esc(p.media)+'</span></label>'
          ).join("") : '<div class="hint" style="padding:14px">无预设，可在全局设置中添加</div>';
        };
        const drawFiles = ()=>{
          const q = (st.q||"").trim().toLowerCase();
          let list = S.data.medias;
          if (st.g && st.g!=="all") list = list.filter(m=>String(m.medias_groups_id)===String(st.g));
          if (q) list = list.filter(m=> m.name.toLowerCase().indexOf(q)>=0);
          const box = $("#mpick"); if (!box) return;
          box.innerHTML = list.length ? list.map(m=>
            '<label class="pick-row"><input type="checkbox" data-med="'+esc(m.name)+'"'+(st.media.indexOf(m.name)>=0?" checked":"")+'>'+
            '<span class="nm">'+esc(m.name)+'</span><span class="ip">'+secToHMS(Number(m.length)||0).slice(3)+'</span></label>'
          ).join("") : '<div class="hint" style="padding:14px">没有匹配的音频文件</div>';
        };
        const drawDirs = ()=>{
          const box = $("#mdir"); if (!box) return;
          const counts = {};
          S.data.medias.forEach(m=>{ counts[m.medias_groups_id] = (counts[m.medias_groups_id]||0)+1; });
          box.innerHTML = S.data.mediaGroups.length ? S.data.mediaGroups.map(g=>
            '<label class="pick-row"><input type="checkbox" data-dir="'+esc(g.name)+'"'+(st.groups.indexOf(g.name)>=0?" checked":"")+'>'+
            '<span class="nm">'+esc(g.name)+'</span><span class="ip">'+(counts[g.id]||0)+' 个铃音</span></label>'
          ).join("") : '<div class="hint" style="padding:14px">服务器上没有媒体文件夹</div>';
        };

        body.addEventListener("click", e=>{
          const rm = e.target.closest("[data-rm]");
          if (rm){
            const k = rm.dataset.rm==="m" ? "media" : "groups", n = rm.dataset.n;
            st[k] = st[k].filter(x=>x!==n);
            drawChips(); drawPane(); return;
          }
          const tb = e.target.closest("[data-t]");
          if (tb && tb.parentElement.id==="mTabs"){
            st.tab = tb.dataset.t;
            $$("#mTabs button").forEach(x=>x.classList.toggle("on", x===tb));
            drawPane();
          }
        });
        body.addEventListener("change", e=>{
          const f = e.target.closest("[data-med]"), d = e.target.closest("[data-dir]");
          if (f){ const n=f.dataset.med;
            /* 只挑一个的地方：勾中一个就把别的让出来，等于单选。
               两个 pane 都重画一遍 —— 单选之后「上一个勾」得在**当前这一页**上
               跟着取消，而只有画出来的那个 pane 有盒子，另一个自己会早退。 */
            if (filesOnly){ st.media = f.checked ? [n] : []; drawChips(); drawPresets(); drawFiles(); return; }
            const i=st.media.indexOf(n);
            if (f.checked && i<0) st.media.push(n);
            if (!f.checked && i>=0) st.media.splice(i,1);
            drawChips(); return; }
          if (d){ const n=d.dataset.dir, i=st.groups.indexOf(n);
            if (d.checked && i<0) st.groups.push(n);
            if (!d.checked && i>=0) st.groups.splice(i,1);
            drawChips(); }
        });
        $("#mClear").onclick = ()=>{ st.media=[]; st.groups=[]; drawChips(); drawPane(); };
        $("#mCancel").onclick = ()=> closeModal(mm.id);
        $("#mOk").onclick = ()=>{
          const r = {media:st.media.slice(), groups:st.groups.slice()};
          /* validate 说不行就别关 —— 关掉之后才喊「你还没选」，用户得重新开一遍框 */
          if (opts.validate && !opts.validate(r)) return;
          closeModal(mm.id);
          onDone && onDone(r);
        };
        drawChips(); drawPane();
        if (extra && extra.mount) extra.mount(body);
      }
    }});
}


/* ══ 时间平移小控件 ══════════════════════════════════════════════════
   批量改时间（铃声、定时任务）共用。数值 + 单位两格：秒 / 分 / 时。
   以前只有「分钟」一种说法，想挪 30 秒得写 0.5 —— 数字框是整数步进，
   写不下去，只能去编辑单条。 */
function shiftFieldHTML(id){
  return '<div class="field"><label>时间平移</label>'+
    '<div style="display:flex;gap:8px;align-items:center">'+
      '<input class="input mono" id="'+id+'N" type="number" step="1" value="0" style="width:120px">'+
      '<select class="select" id="'+id+'U" style="width:88px">'+
        '<option value="1">秒</option><option value="60" selected>分</option><option value="3600">时</option>'+
      '</select>'+
    '</div>'+
    '<div class="hint">整体提前 10 分钟就填 <span class="mono">-10</span> 选「分」；'+
      '想不动时间就留 <span class="mono">0</span>。</div>'+
  '</div>';
}
/* 读出来一律换成秒，后面拿它算时刻 */
function readShiftSec(id){
  const n = Number(document.getElementById(id+"N").value) || 0;
  const u = Number(document.getElementById(id+"U").value) || 1;
  return n * u;
}
/* 队列里那行说明。整数能进位的就用大单位说，读起来是「平移 -10 分」不是「-600 秒」 */
function shiftWord(sec){
  const a = Math.abs(sec);
  if (a % 3600 === 0) return "时间平移 "+(sec/3600)+" 时";
  if (a % 60 === 0)   return "时间平移 "+(sec/60)+" 分";
  return "时间平移 "+sec+" 秒";
}

/* ══ 全局设置 ════════════════════════════════════════════════════════
   时间偏移是「面板 → 服务器」方向上的差值，读回来的时候会原样减回去：
     偏移 −60 秒 → 面板 06:00:00 写出去是 05:59:00；服务器上放着 05:59:00 时面板显示 06:00:00
   两个方向成对，所以「读回来不动它、直接再存一次」不会每存一次再偏一分钟。
   写走 offsetHMS，读走 unoffsetHMS（在 normBell / normTask 里）。
   ═════════════════════════════════════════════════════════════════ */
function setOffsetSec(v){
  S.offsetSec = Number(v)||0;
  LS.set("offsetSec", S.offsetSec);
  /* 偏移也在那份共享配置里（05-config.js）—— 换台电脑打开得是同一个口径。
     输入框每敲一下都走这儿，攒着推的那套会把它们并成一趟。 */
  S.cfg.offsetSec = S.offsetSec;
  cfgSave("offsetSec");
  reapplyOffset();
  renderTopbar();
  /* 设置页上不整页重画 —— 正在敲的那个数字框会被换掉，光标和输入法就飞了。
     只把右边那条说明改掉，数字该算的（b.times、_base）上面已经算完了。 */
  if (S.mode==="settings") drawOffsetNow(); else renderMain();
}
function setDebug(on){
  S.debug = !!on;
  LS.set("debug", S.debug);
  toast(S.debug ? "已启用调试模式：提交前将展开报文详情" : "调试模式已关闭", "ok");
}
/* 偏移那句说明要跟着数字变：不偏移时说「填几点写几点」，偏了就把 12:00 这个
   例子摆出来 —— 偏移是这套东西里最容易看反的一处（正数是推后）。 */
function offsetHintHTML(){
  const o = Number(S.offsetSec)||0;
  return '正数=整体推后，负数=整体提前。'+
    (o ? '面板 <span class="mono">12:00:00</span> ↔ 报文 <span class="mono">'+esc(hm(offsetHMS("12:00:00")))+'</span>'
       : '面板上填几点，报文里就写几点');
}
/* 改偏移时不重画整页，就地更新（见 setOffsetSec） */
function drawOffsetNow(){
  const h = $("#stOffHint"); if (h) h.innerHTML = offsetHintHTML();
}
/* ══ 铃声预设（全局设置里那一段）═══════════════════════════════════
   一条预设 = 一个名字 + 一个服务器上的文件名。名字是给人看的，文件名是要写进
   报文的 —— 所以只能从媒体库里挑，不让手打（打错一个字符，提交出去就是一段静音）。
   预设全是本机存的，没有内置项。 */
function presetSectionHTML(){
  const rows = rawPresets().map((p,i)=>
    '<div class="pre-row" data-pre-i="'+i+'">'+
      '<input class="input" data-pre="label" placeholder="预设名称" value="'+esc(p.label||"")+'">'+
      '<button class="btn btn-sm sel-file" type="button" data-pre="media" title="'+esc(p.media||"还没绑定文件")+'">'+
        '<span class="fn">'+esc(p.media||"选择文件…")+'</span></button>'+
      '<button class="btn btn-sm btn-quiet btn-icon" type="button" data-pre="del" title="删掉这条预设">'+ICON.del+'</button>'+
    '</div>').join("");
  return rows+
    '<div style="margin-top:10px"><button class="btn btn-sm" type="button" id="preNew">'+ICON.plus+' 新建预设</button></div>';
}
function wirePresets(body, redraw){
  body.querySelectorAll("[data-pre-i]").forEach(row=>{
    const i = Number(row.dataset.preI);
    /* 每次改动都整份写回并重算 PRESETS —— 别的地方（打开中的选择器）也跟着变 */
    const put = fn => { const l = rawPresets().slice(); fn(l); setUserPresets(l); };
    row.querySelector('[data-pre="label"]').oninput = e =>
      put(l=>{ l[i] = Object.assign({}, l[i], {label:e.target.value}); });
    row.querySelector('[data-pre="media"]').onclick = ()=>{
      const cur = (rawPresets()[i]||{}).media;
      openMediaPicker(cur?[cur]:[], [], r=>{
        put(l=>{ l[i] = Object.assign({}, l[i], {media:(r && r.media[0]) || ""}); });
        redraw();
      }, {filesOnly:true, title:"选择预设音源", sub:"预设绑定的那一个铃音文件"});
    };
    row.querySelector('[data-pre="del"]').onclick = ()=>{ put(l=>{ l.splice(i,1); }); redraw(); };
  });
  const nu = body.querySelector("#preNew");
  if (nu) nu.onclick = ()=>{ const l = rawPresets().slice(); l.push({label:"", media:""}); setUserPresets(l); redraw(); };
}

/* 设置页尾部那张「版本信息」。五行键值，用 .kv —— 它本来就是给这种表准备的
   （两列网格、值那列等宽），一直没人用过，正好。

   有两行其实不是「版本」，但少了这张表就不完整：
     · 广播服务器 —— 地址和厂商版本，出问题时报的是这两样
     · 运行方式 —— 设置到底存在哪儿。这是这张表里唯一会改变人行为的答案：
       本地模式下在这台设备上改的东西，换台设备打开是看不见的。

   值那一列是等宽的（.kv 定的），所以「运行方式」只放两个词，那半句解释摆在
   表格下面的 .hint 里 —— 一整句中文塞进等宽列里字形会打架。 */
function versionInfoHTML(){
  const local = location.protocol === "file:";
  const addr  = S.server ? S.server.replace(/^https?:\/\//,"") : "—";
  const kv = (k,v)=> '<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>';
  return '<dl class="kv">'+
      kv("面板版本",   PANEL_VERSION)+
      kv("运行方式",   local ? "本地模式" : "服务器模式")+
      kv("广播服务器", addr)+
      /* 这一格 id 是给 setSrvVersion 用的：刷新页面时它是本机存的那份画的，
         /language 回来之后由那边就地补上（见 10-data.js），整页不重画。 */
      '<dt>服务器版本</dt><dd id="verSrv">'+esc(S.srvVersion || "—")+'</dd>'+
      kv("登录用户",   userNameText() || "—")+
    '</dl>'+
    '<div class="hint" style="margin-top:10px">'+
      (local
        ? "本地模式：设置只保存在这台设备的浏览器里，换台设备打开看不到。"
        : "服务器模式：配置信息保存在服务器端，可在多个客户端间自动同步。")+
    '</div>';
}

/* ══ 全局设置（一整页）═══════════════════════════════════════════════
   以前是个模态框。改成页面是因为里面能改的东西越攒越多（偏移、草稿、调试、
   预设的增删改），模态一窄就得上下滚；而且它和另外三个视图本来就是平级的
   —— 顶栏那个齿轮现在就是切换组里的第四个按钮。 */
function renderSettings(){
  const el = $("#main"); if (!el) return;
  el.classList.add("headfix");   /* 「全局设置」那一行钉住，下面三张面板自己滚 */
  const o = Number(S.offsetSec)||0;
  el.innerHTML =
    '<div class="sec-head">'+
      '<div class="title-row">'+
        '<h2 class="serif">全局设置</h2>'+
      '</div>'+
    '</div>'+

    '<div class="page-body">'+

    '<div class="panel">'+
      '<div class="panel-head"><h3>时间偏移</h3></div>'+
      '<div class="panel-body">'+
        '<div class="set-row">'+
          '<div class="set-lab">'+
            '<div class="set-t">全局时间偏移</div>'+
            '<div class="hint" id="stOffHint">'+offsetHintHTML()+'</div>'+
          '</div>'+
          '<div class="set-ctl">'+
            '<input class="input mono" id="stOff" type="number" step="1" style="width:64px" value="'+o+'">'+
            '<span class="dimmer">秒</span>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+

    /* 「发送方式」这张面板 = 草稿模式 + 调试模式两个开关，也就是这两个模式在界面上
       仅有的入口。两个入口一起收着的时候（SHOW_MODE_SWITCHES，见 00-core.js）
       **整张面板都不渲染** —— 留着就是个光剩标题的空壳。要放回来改那一个值。 */
    (SHOW_MODE_SWITCHES ?
    '<div class="panel">'+
      '<div class="panel-head"><h3>发送方式</h3></div>'+
      '<div class="panel-body">'+
        '<div class="set-row">'+
          '<div class="set-lab">'+
            '<div class="set-t">草稿模式</div>'+
            '<div class="hint">开启后会保留本次会话所有修改直到用户手动提交</div>'+
          '</div>'+
          '<div class="set-ctl">'+
            '<label class="switch" title="草稿模式"><input type="checkbox" id="stDraft" aria-label="草稿模式"'+(S.draft?" checked":"")+'>'+
              '<span class="track"></span></label>'+
          '</div>'+
        '</div>'+
        '<div class="set-row">'+
          '<div class="set-lab">'+
            '<div class="set-t">调试模式</div>'+
            '<div class="hint">提交前先摊开报文，逐条看过再发。</div>'+
          '</div>'+
          '<div class="set-ctl">'+
            '<label class="switch" title="调试模式"><input type="checkbox" id="stDbg" aria-label="调试模式"'+(S.debug?" checked":"")+'>'+
              '<span class="track"></span></label>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>' : "")+

    '<div class="panel">'+
      '<div class="panel-head"><h3>铃声预设</h3>'+
        '<span class="sub">'+PRESETS.length+' 个</span></div>'+
      '<div class="panel-body">'+presetSectionHTML()+'</div>'+
    '</div>'+

    '<div class="panel">'+
      '<div class="panel-head"><h3>版本信息</h3></div>'+
      '<div class="panel-body">'+versionInfoHTML()+'</div>'+
    '</div>'+

    '</div>';   /* /.page-body */

  const off = $("#stOff");
  off.oninput = e => setOffsetSec(e.target.value);
  /* 两个开关都不用自己重画这一页：开关的状态在它自己那个 checkbox 上，
     草稿那个另外还会走 setDraft() → renderTopbar() + renderMain()。
     入口收着的时候两个都不在（见 SHOW_MODE_SWITCHES），判空再绑。 */
  const dbgSw = $("#stDbg");   if (dbgSw) dbgSw.onchange = e => setDebug(e.target.checked);
  const drfSw = $("#stDraft"); if (drfSw) drfSw.onchange = e => setDraft(e.target.checked);
  wirePresets(el, renderSettings);
}

/* ══ 月历控件（考试模式的「考试日期」和定时任务的「指定日期」共用这一个）═══
   从前这是 40-view-exam.js 里私有的一坨（examCalHTML + 散在 renderAll 后面的
   四行事件绑定）。定时任务的「指定日期」要的是同一个东西，就搬到这里来，
   两边都用，省得两个日历各长各的样。

   调用方自己拿着状态，控件不替谁存：

     st = { month: "YYYY-MM" | null,   // 翻到哪个月；null = 跟着 dates[0]／今天走
            dates: [...] }              // 已选日期，ISO "YYYY-MM-DD"

   dates 建议写成 getter（`get dates(){ return S.tasks[0].dates; }` 那种现取的写法）——
   控件每次重画都现取，调用方那边整个换掉数组也不会指丢。

   控件负责画、翻月、跳今日；**日期的增删由调用方的 on.toggle(iso) 做**，做完
   控件自己重画一次。caller 需要跟着干别的（比如整页重排）就在 on.toggle 里干，
   真把这块 DOM 换掉了的话，控件会发现自己已经不在文档里，不再白画一遍。 */
const CAL_DOW = ["日","一","二","三","四","五","六"];
function shiftMonth(ym, n){
  const [y,m] = ym.split("-").map(Number);
  const d = new Date(y, m-1+n, 1);
  return d.getFullYear()+"-"+pad(d.getMonth()+1);
}
function calHTML(st){
  const sel = new Set(st.dates || []);
  const today = todayISO();
  if (!st.month) st.month = ((st.dates||[])[0] || today).slice(0,7);
  const [y,m] = st.month.split("-").map(Number);
  const dow = new Date(y, m-1, 1).getDay();          /* 0 = 周日 */
  const dim = new Date(y, m, 0).getDate();           /* 当月天数 */
  let cells = "";
  for (let i=0;i<dow;i++) cells += '<button class="cal-d blank" disabled tabindex="-1"></button>';
  for (let d=1; d<=dim; d++){
    const iso = y+"-"+pad(m)+"-"+pad(d);
    cells += '<button class="cal-d'+(sel.has(iso)?" on":"")+(iso===today?" today":"")+
      '" data-day="'+iso+'" title="'+iso+'">'+d+'</button>';
  }
  /* 没有「本月」键：它和「今日」是一回事，两个键挨着摆只会让人多想一秒该点哪个。 */
  return '<div class="cal-head">'+
      '<button class="btn btn-sm btn-quiet btn-icon" data-cal="prev" aria-label="上个月" title="上个月">'+ICON.chevL+'</button>'+
      '<span class="ym">'+y+' 年 '+m+' 月</span>'+
      '<button class="btn btn-sm btn-quiet btn-icon" data-cal="next" aria-label="下个月" title="下个月">'+ICON.chevR+'</button>'+
      '<button class="btn btn-sm btn-quiet" data-cal="today" title="跳到今天">今日</button>'+
    '</div>'+
    '<div class="cal-grid">'+
      CAL_DOW.map(w=>'<span class="cal-dow">'+w+'</span>').join("")+ cells +
    '</div>';
}
/* 画进 box 并绑好事件，返回「重画」那个函数 —— 调用方要是绕过控件直接改了
   st.dates（比如从旁边的 chip 上删掉一天），自己叫一次返回值就行。 */
function calMount(box, st, on){
  const draw = ()=>{
    box.innerHTML = calHTML(st);
    $$(".cal-d[data-day]", box).forEach(b => b.onclick = ()=>{
      on.toggle(b.dataset.day);
      if (box.isConnected) draw();          /* on.toggle 把整页重排了就别再画一遍 */
    });
    box.querySelector("[data-cal=prev]").onclick  = ()=>{ st.month = shiftMonth(st.month,-1); draw(); };
    box.querySelector("[data-cal=next]").onclick  = ()=>{ st.month = shiftMonth(st.month, 1); draw(); };
    box.querySelector("[data-cal=today]").onclick = ()=>{
      st.month = todayISO().slice(0,7);
      /* 默认只跳到今天那个月；考试那边还要顺手把今天选上，由它自己接管重画 */
      if (on.today) on.today(); else draw();
    };
  };
  draw();
  return draw;
}
