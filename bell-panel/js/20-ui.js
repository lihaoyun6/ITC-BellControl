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
  /* 这儿曾经有个 fullNarrow：竖屏上整块铺满屏幕的那一档（当时只有「改动预览」
     用它）。用户看过之后把它改成了**整页顶掉当前视图**那一套 —— 顶栏不动，
     出口是顶栏最左那枚「‹ 返回」，和「终端任务反查」的结果页一模一样
     （见 40-view-exam 的 openExamPreview）。铺满屏幕的弹窗连顶栏一起盖住了，
     那不是这一页要的样子，所以那一档连同它的 CSS 一起撤了。 */
  host.innerHTML = '<div class="modal" role="dialog" aria-modal="true">'+
    '<div class="modal-head"><div style="min-width:0"><h3>'+esc(cfg.title)+'</h3>'+(cfg.sub?'<div class="sub">'+esc(cfg.sub)+'</div>':"")+'</div>'+
      '<span style="flex:1"></span>'+
      '<button class="btn btn-sm btn-quiet btn-icon m-x" data-close aria-label="关闭">'+ICON.x+'</button>'+
    '</div>'+
    '<div class="modal-body"></div>'+
    (cfg.footer===false?"":'<div class="modal-foot"></div>')+
  '</div>';
  document.body.appendChild(scrim);
  $("#layers").appendChild(host);
  modalStack.push(id);
  if (cfg.onClose) modalOnClose[id] = cfg.onClose;
  const m = {id, host, scrim, cfg};
  /* 头里那几枚「关掉」（眼下只有一枚 ×，但模态头将来可能不止一枚）—— 它们都是
     data-close，一枚一枚接过去。原来这里只 querySelector 第一枚，多出来的那枚
     就成了个按不动的摆设（点它什么都不会发生）。 */
  $$("[data-close]", host).forEach(b=> b.onclick = ()=> closeModal(id));
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

/* 点位选择器顶上那行红绿点说明（用户定的）：**三个点，永远三个点**。
   它是一份图例，图例就该老老实实摆着，不该跟着连接状态变形。
   原来推送没连上时这儿会换成一整句「未连接终端状态推送，点位在线情况未知」——
   那句话其实是多余的：推送一断，名单上的点本来就全变成灰的空心圈，而「灰点＝
   未知」这条图例就在旁边，两下一对就明白了。 */
function statLegend(){
  return '<div class="pick-legend"><span class="tdot online"></span>在线'+
    '<span class="tdot offline"></span>离线<span class="tdot unknown"></span>未知</div>';
}

/* ══ 批量编辑菜单 ════════════════════════════════════════════════════
   批量条上原来摊着「改区域 / 改音源 / 改时间 / 恢复默认」四个文字按钮，连同
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
      /* 顶上那格「已选区域」整块去掉了（用户要的）：那排胶囊把同一件事说了两遍 ——
         下面列表里每一行自己就勾着，这儿再列一遍、还各带一枚 ×，于是「在哪儿取消」
         有了两个入口。现在只有列表这一个入口，「已选了哪些」由列表头上那句
         「已选择 N 个」交代（全选那一格的右边）。「清空」也跟着没了：
         它清的就是那排胶囊，而全选那一格反勾一下本来就是一键清空。 */
      body.innerHTML =
        '<div class="stack">'+
          '<div class="tabbar" id="aTabs">'+
            '<button data-t="term" class="on">终端点位 · '+S.data.terminals.length+'</button>'+
            '<button data-t="group">分组 · '+S.data.termGroups.length+'</button>'+
          '</div>'+
          '<div id="aPane"></div>'+
          (isList?'<label class="chk"><input type="checkbox" id="aAll"> 同时覆盖已设为「特例」的铃声</label>':"")+
        '</div>';
      foot.innerHTML = '<span class="spacer"></span><button class="btn" id="aCancel">取消</button>'+
        '<button class="btn btn-primary" id="aOk">确定</button>';

      /* 页签上那个数字跟着**当前列出的**走：搜索一过滤，它就从「全部点位」
         变成「搜出来几个」（用户要的口径）。没搜的时候它本来就等于总数。 */
      const setTabCount = (tab, n)=>{
        const b = $("#aTabs button[data-t='"+tab+"']");
        if (b) b.textContent = (tab==="term" ? "终端点位 · " : "分组 · ")+n;
      };
      const drawPane = ()=>{
        const tab = S.dt.areaTab;
        const pane = $("#aPane");
        if (tab==="term"){
          const groups = S.data.termGroups;
          pane.innerHTML =
            '<div style="display:flex;gap:8px;margin-bottom:8px">'+
              '<span class="sbox">'+ICON.search+
                '<input class="input" id="aq" placeholder="搜索名称或 IP" value="'+esc(S.dt.areaQ)+'">'+
              '</span>'+
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
      /* 列表头上那格「全选」+ 它右边那句「已选择 N 个」。勾的是**当前列出来的
         这一批**，不是整个媒体库 —— 搜索或分组筛过之后，「全选搜索结果」比
         「全选两千个点位」有用得多，而后者的入口就是清掉搜索框再点它。
         三种状态照抄「按节次生成」预览表头上那一格：全勾 / 全不勾 / 半勾。
         key 是往哪个数组里写：点位页签是 "t"，分组页签是 "g" —— 两页共用这一格，
         写错就变成「在分组页上全选了所有点位」。 */
      let headNames = [], headKey = "t";
      const drawAllRow = (names, key)=>{
        headNames = names; headKey = key;
        const head = $("#aHead"); if (!head) return;
        /* 红绿点那份说明挂在**这一行的最右边**（CSS 里 margin-left:auto 顶过去）。
           它说的是下面每一行头上那个点的颜色，贴在这行正好。
           它**只归点位页**（key==="t"）：分组页每张卡片写的是「N 个点位 · M 在线」，
           一整组没有单一的红绿点，图例在那儿说的是这一页根本不显示的东西。
           列表空了（搜索没搜着）也照样留着它 —— 状态推送连没连上，跟搜没搜到无关；
           原来那版空列表把整行清成空的，底下 .pick 里那句「没有匹配的点位」
           本来就说得够清楚了，不用这一行再补一句。 */
        head.innerHTML = (names.length ?
            '<label class="chk"><input type="checkbox" id="aAllPick">'+
              '<span>全选</span></label>'+
            '<span class="hint" id="aSelN"></span>'
          : "") + (key === "t" ? statLegend() : "");
        const cb = $("#aAllPick");
        if (cb) cb.onchange = ()=>{
          const sel = S.dt.area[key];
          if (cb.checked){
            names.forEach(n=>{ if (sel.indexOf(n)<0) sel.push(n); });
          } else {
            const drop = new Set(names);
            S.dt.area[key] = sel.filter(n=> !drop.has(n));
          }
          drawPane();
        };
        syncAllRow();
      };
      /* 只把那句数字和「全选」那一格的状态跟上，列表本身**不重画** ——
         重画会把滚动条弹回顶上，勾一个列表深处的点位就得从头再找一遍。
         那句话从前是「当前列出 N 个 · 已选 M」，用户定成「已选择 M 个」：
         顶上那排胶囊去掉之后，这一行就是交代「选了多少」的唯一地方。 */
      const syncAllRow = ()=>{
        const nOn = headNames.filter(n=> S.dt.area[headKey].indexOf(n)>=0).length;
        const c = $("#aSelN"); if (c) c.textContent = "已选择 "+nOn+" 个";
        const cb = $("#aAllPick"); if (!cb) return;
        cb.checked = nOn>0 && nOn===headNames.length;
        cb.indeterminate = nOn>0 && nOn<headNames.length;
      };
      const drawPick = ()=>{
        const q = (S.dt.areaQ||"").trim().toLowerCase();
        const gid = S.dt.areaGroup;
        let list = S.data.terminals;
        if (gid!=="all") list = list.filter(t=> (t.with_groups||[]).some(w=>String(w.terminals_groups_id)===String(gid)));
        if (q) list = list.filter(t=> (String(t.name)+" "+String(t.ip_address)).toLowerCase().indexOf(q)>=0);
        const box = $("#apick"); if (!box) return;
        setTabCount("term", list.length);
        drawAllRow(list.map(t=>t.name), "t");
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
        drawAllRow(S.data.termGroups.map(g=>g.name), "g");
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
      statHook = ()=>{ if (S.dt.areaTab==="term") drawPick(); else drawGroups(); };
      statusHooks.push(statHook);

      body.addEventListener("click", e=>{
        const gc = e.target.closest("[data-grp]");
        if (gc){ const n=gc.dataset.grp; const i=S.dt.area.g.indexOf(n);
          if(i>=0) S.dt.area.g.splice(i,1); else S.dt.area.g.push(n); drawGroups(); return; }
        const tb = e.target.closest("[data-t]");
        if (tb && tb.parentElement.id==="aTabs"){ S.dt.areaTab = tb.dataset.t;
          $$("#aTabs button").forEach(x=>x.classList.toggle("on", x===tb)); drawPane(); return; }
      });
      /* 勾一行**不重画列表**，只把头上那句「已选择 N 个」和全选那一格的状态跟上。
         从前这儿跟的是顶上那排胶囊（现在没了）。 */
      body.addEventListener("change", e=>{
        const cb = e.target.closest("[data-term]");
        if (cb){ const n=cb.dataset.term; const i=S.dt.area.t.indexOf(n);
          if (cb.checked && i<0) S.dt.area.t.push(n);
          if (!cb.checked && i>=0) S.dt.area.t.splice(i,1);
          syncAllRow(); }
      });
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
      drawPane();
    }
  });
}

/* 这儿原来还有一套「media picker (shared)」——mediaPickerHTML / drawMediaPick /
   wireMediaPicker 三件套，状态挂在全局的 S.dt.medSel|medQ|medG 上。它只有
   批量改音源一个调用点。批量改音源改开下面那个正经的多选器之后，三件套和
   那三个全局字段一起下掉了。 */

/* ══ 音源清单（铃声编辑框和定时任务编辑框共用）═══════════════════════
   同一个控件两处用，所以样子必须一模一样：音源文件是素的，文件夹加一枚蓝点 +
   「（文件夹）」后缀 —— 和上面选择器那个「已选」区是同一套标记，三处长得一样，
   用户在哪儿看到的都是同一件事。
   ══════════════════════════════════════════════════════════════════ */
function soundChipsHTML(mn, gs){
  mn = mn||[]; gs = gs||[];
  if (!mn.length && !gs.length)
    return '<span class="chip chip-ph">还没有选音源，点「选择音源」来添加</span>';
  /* data-rm / data-n 挂在**胶囊自己**身上（和区域胶囊那套一样，见 30-view-list.js
     的 areaChips）：整颗都是热区，点名字、点空白、点 × 一个样。末尾那枚 × 只剩个
     样子，还按 <button> 写 —— 键盘落在它身上敲回车，click 冒泡到胶囊，照样删得掉。
     提示语和区域那套一句话一个句式，只是宾语不同（那儿是「区域」）。 */
  const chip = (name, kind)=> '<span class="chip'+(kind==="g"?" chip-group":"")+
    '" data-rm="'+kind+'" data-n="'+esc(name)+'" title="点击移除此音源">'+
    (kind==="g"?'<span class="dot"></span>':"")+esc(name)+(kind==="g"?"（文件夹）":"")+
    '<button class="x" aria-label="移除">'+ICON.x+'</button></span>';
  return mn.map(n=>chip(n,"m")).join("") + gs.map(g=>chip(g,"g")).join("");
}
/* 绑上「点胶囊移除」：onRemove(kind, name)，kind 是 "m"（文件）或 "g"（文件夹）。
   调用方改完自己的状态后重画整块（时长合计、时长框都要跟着变）。 */
function mountSoundChips(box, onRemove){
  $$("[data-rm]", box).forEach(btn => btn.onclick = ()=> onRemove(btn.dataset.rm, btn.dataset.n));
}

/* ══ 二级模态：挑音源 ════════════════════════════════════════════════
   这个系统既能放单个 mp3，也能整包放一个媒体文件夹 —— 所以两类一起选，
   一起回传。onDone({media:[名字], groups:[文件夹名]})。
   状态是本模态自己的，不碰全局 S.dt（那个是批量改音源在用的）。
   ══════════════════════════════════════════════════════════════════ */
function openMediaPicker(media, groups, onDone, opts){
  opts = opts || {};
  /* filesOnly：只挑单个文件的地方（考试铃声、听力音频）用。它们只能存一个文件名，
     给个文件夹也放不进去，所以干脆不显示那两个页签。 */
  const filesOnly = !!opts.filesOnly;
  const st = {tab:"file", media:(media||[]).slice(), groups:filesOnly?[]:(groups||[]).slice(), q:"", g:"all"};
  /* extra：调用方想在这个框底下再挂自己的一两格（批量改音源要一格「播放模式」）。
     挂在页签内容区**下面**，不挤那三个恒高的列表。 */
  const extra = opts.extra;
  openModal({
    title: opts.title || "选择音源", sub: opts.sub || "一个或多个音源文件，或整个媒体文件夹", width:"760px",
    mount(body, foot, mm){
      /* 音频文件是在**厂商原后台**上传的，手里这份 S.data.medias 是开面板时拉的快照 ——
         不重拉，刚传上去的文件在这个框里根本不存在，人会以为是面板没同步。
         所以先把框开出来、报一句「读着呢」，拉完再画内容（见 refreshMediaLib）。
         拉失败也照画：用的是手里那份旧的，总比框打不开强。 */
      body.innerHTML = '<div class="stack">'+
        '<div class="hint" style="padding:28px 4px">正在读取服务器上的音源列表…</div></div>';
      foot.innerHTML = '<span class="spacer"></span><button class="btn" id="mCancel">取消</button>';
      foot.querySelector("#mCancel").onclick = ()=> closeModal(mm.id);
      refreshMediaLib().then(draw);

      /* 画完的内容区、页签计数、三个 draw* 都在这一个作用域里 ——
         也正因为整块重画，页签上「音频 · N」那个数才是刚拉回来的那个。 */
      function draw(){
        /* 顶上那格「已选」整块去掉了（用户要的）：那排胶囊和下面列表里勾着的
           是同一件事，还各带一枚 × ——「在哪儿取消」就这么有了两个入口。
           现在只剩列表这一个入口，「选了多少」由搜索框下面那格全选右边的
           「已选择 N 个」交代（见 drawAllRow）。「清空」也跟着没了：
           它清的就是那排胶囊，而全选那一格反勾一下本来就是一键清空。 */
        body.innerHTML =
          '<div class="stack">'+
            (filesOnly ? "" :
            '<div class="tabbar" id="mTabs">'+
              '<button data-t="file"'+(st.tab==="file"?' class="on"':"")+'>音频 · '+S.data.medias.length+'</button>'+
              '<button data-t="dir"'+(st.tab==="dir"?' class="on"':"")+'>媒体库 · '+S.data.mediaGroups.length+'</button>'+
            '</div>')+
            '<div id="mPane"'+(filesOnly?'':' class="pick-stage"')+'></div>'+
            (extra && extra.html ? extra.html : "")+
          '</div>';
        foot.innerHTML = '<span class="spacer"></span><button class="btn" id="mCancel">取消</button>'+
          '<button class="btn btn-primary" id="mOk">确定</button>';

        /* 页签上那个数字跟着**当前列出的**走：搜索或媒体库一筛，它就从
           「全部音频」变成「筛出来几个」（用户要的口径）。没筛的时候就是总数。 */
        const setTabCount = (tab, n)=>{
          const b = $("#mTabs button[data-t='"+tab+"']");
          if (b) b.textContent = (tab==="file" ? "音频 · " : "媒体库 · ")+n;
        };
        /* 搜索框下面那一行：左起一格「全选」，右边一句「已选择 N 个」。
           勾的是**当前列出来的这一批**（搜索 / 媒体库筛过之后就是那一批）——
           和区域选择器那一格是同一套写法、同一句话。filesOnly 没有这一行：
           那儿只挑一个，「全选」跟它说的是反话。 */
        let headNames = [], headKey = "media";
        const drawAllRow = (names, key)=>{
          headNames = names; headKey = key;
          const head = $("#mHead"); if (!head) return;
          head.innerHTML = names.length
            ? '<label class="chk"><input type="checkbox" id="mAllPick"><span>全选</span></label>'+
              '<span class="hint" id="mSelN"></span>'
            : "";
          const cb = $("#mAllPick");
          if (cb) cb.onchange = ()=>{
            const sel = st[key];
            if (cb.checked) names.forEach(n=>{ if (sel.indexOf(n)<0) sel.push(n); });
            else { const drop = new Set(names); st[key] = sel.filter(n=> !drop.has(n)); }
            drawPane();          /* 列表里那些勾要跟着变 */
          };
          syncAllRow();
        };
        /* 只把那句数字和「全选」那一格的状态跟上，列表本身**不重画** ——
           重画会把滚动条弹回顶上，勾一个列表深处的音源就得从头再找一遍。 */
        const syncAllRow = ()=>{
          const nOn = headNames.filter(n=> st[headKey].indexOf(n)>=0).length;
          const c = $("#mSelN"); if (c) c.textContent = "已选择 "+nOn+" 个";
          const cb = $("#mAllPick"); if (!cb) return;
          cb.checked = nOn>0 && nOn===headNames.length;
          cb.indeterminate = nOn>0 && nOn<headNames.length;
        };
        /* 两个页签的内容区恒高（`.pick-stage`，见 css），切页签时框子不动。
           行数账：媒体库 8 行 = 全选行 + 列表 7 行；「音频」顶上多一行搜索框，
           所以它的列表只排 6 行 —— **搜索行 + 全选行 + 列表 = 8 行**，
           正好和另一页一样高，切过去也不会跳。
           filesOnly 那条路没有页签栏，也就没有「切页签跳动」可谈，保持原样
           （考试铃声、听力音频走这条）。 */
        const drawPane = ()=>{
          const pane = $("#mPane");
          if (st.tab==="file"){
            pane.innerHTML =
              '<div class="pick-search">'+
                '<span class="sbox">'+ICON.search+
                  '<input class="input" id="mq" placeholder="搜索音频文件" value="'+esc(st.q)+'">'+
                '</span>'+
                '<select class="select" id="mg" style="width:160px"><option value="all">全部媒体库</option>'+
                  S.data.mediaGroups.map(g=>'<option value="'+g.id+'"'+(String(st.g)==String(g.id)?" selected":"")+'>'+esc(g.name)+'</option>').join("")+
                '</select>'+
              '</div>'+
              /* filesOnly 只挑一个，也就没有「全选」那一行 —— 恒高那套账
                 （见 css 的 .pick-stage）只算走页签的这条路。 */
              (filesOnly ? "" : '<div class="pick-head" id="mHead"></div>')+
              '<div class="pick" id="mpick"></div>';
            $("#mq").oninput = e => { st.q = e.target.value; drawFiles(); };
            $("#mg").onchange = e => { st.g = e.target.value; drawFiles(); };
            drawFiles();
          } else {
            pane.innerHTML = '<div class="pick-head" id="mHead"></div><div class="pick" id="mdir"></div>';
            drawDirs();
          }
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
          if (filesOnly) return;
          setTabCount("file", list.length);
          drawAllRow(list.map(m=>m.name), "media");
        };
        const drawDirs = ()=>{
          const box = $("#mdir"); if (!box) return;
          const counts = {};
          S.data.medias.forEach(m=>{ counts[m.medias_groups_id] = (counts[m.medias_groups_id]||0)+1; });
          box.innerHTML = S.data.mediaGroups.length ? S.data.mediaGroups.map(g=>
            '<label class="pick-row"><input type="checkbox" data-dir="'+esc(g.name)+'"'+(st.groups.indexOf(g.name)>=0?" checked":"")+'>'+
            '<span class="nm">'+esc(g.name)+'</span><span class="ip">'+(counts[g.id]||0)+' 个音源</span></label>'
          ).join("") : '<div class="hint" style="padding:14px">服务器上没有媒体文件夹</div>';
          drawAllRow(S.data.mediaGroups.map(g=>g.name), "groups");
        };

        body.addEventListener("click", e=>{
          const tb = e.target.closest("[data-t]");
          if (tb && tb.parentElement.id==="mTabs"){
            st.tab = tb.dataset.t;
            $$("#mTabs button").forEach(x=>x.classList.toggle("on", x===tb));
            drawPane();
          }
        });
        body.addEventListener("change", e=>{
          const f = e.target.closest("[data-med]"), d = e.target.closest("[data-dir]");
          /* 勾一行**不重画列表**，只把全选那一格和它右边那句「已选择 N 个」
             跟上 —— 重画会把滚动条弹回顶上。 */
          if (f){ const n=f.dataset.med;
            /* 只挑一个的地方：勾中一个就把别的让出来，等于单选 ——
               列表重画一遍，「上一个勾」才会跟着取消。 */
            if (filesOnly){ st.media = f.checked ? [n] : []; drawFiles(); return; }
            const i=st.media.indexOf(n);
            if (f.checked && i<0) st.media.push(n);
            if (!f.checked && i>=0) st.media.splice(i,1);
            syncAllRow(); return; }
          if (d){ const n=d.dataset.dir, i=st.groups.indexOf(n);
            if (d.checked && i<0) st.groups.push(n);
            if (!d.checked && i>=0) st.groups.splice(i,1);
            syncAllRow(); }
        });
        $("#mCancel").onclick = ()=> closeModal(mm.id);
        $("#mOk").onclick = ()=>{
          const r = {media:st.media.slice(), groups:st.groups.slice()};
          /* validate 说不行就别关 —— 关掉之后才喊「你还没选」，用户得重新开一遍框 */
          if (opts.validate && !opts.validate(r)) return;
          closeModal(mm.id);
          onDone && onDone(r);
        };
        drawPane();
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

/* ══ 全局设置 ════════════════════════════════════════════════════════ */
function setDebug(on){
  S.debug = !!on;
  LS.set("debug", S.debug);
  toast(S.debug ? "已启用调试模式：提交前将展开报文详情" : "调试模式已关闭", "ok");
}
/* 设置页尾部那张「版本信息」。五行键值，用 .kv —— 它本来就是给这种表准备的
   （两列网格、值那列等宽），一直没人用过，正好。

   有两行其实不是「版本」，但少了这张表就不完整：
     · 广播服务器 —— 地址和厂商版本，出问题时报的是这两样
     · 环境检测 —— 这个页面跑在不在安全上下文里（见下面最后一段）。

   值那一列是等宽的（.kv 定的），所以「环境检测」只放两个词（安全 / 非安全上下文），
   后果那整句摆在表格下面的 .hint 里 —— 一整句中文塞进等宽列里字形会打架。

   「环境检测」问的是 window.isSecureContext，也就是浏览器自己那一条：https，以及
   **本机回环上的 http**（localhost / 127.0.0.1 / [::1]）和 file:// 算安全，别的
   明文 http 算非安全。这条线是有后果的 —— 安全上下文里才拿得到麦克风和 AudioWorklet，
   「实时对讲」「在线播放」那两个页签出不出现问的是同一个值（见 75-view-live.js 的
   liveUsable）—— 所以它值得写在这一页上：对讲用不了的时候，人第一眼该看到的是
   「非安全上下文」，而不是去查是不是代理没起。
   这一格排在最后一行：它是个**诊断**读数，不是要天天看的信息。 */
function versionInfoHTML(){
  const addr  = S.server ? S.server.replace(/^https?:\/\//,"") : "—";
  const kv = (k,v)=> '<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>';
  return '<dl class="kv">'+
      kv("面板版本",   PANEL_VERSION)+
      kv("广播服务器", addr)+
      /* 这一格 id 是给 setSrvVersion 用的：刷新页面时它是本机存的那份画的，
         /language 回来之后由那边就地补上（见 10-data.js），整页不重画。 */
      '<dt>服务器版本</dt><dd id="verSrv">'+esc(S.srvVersion || "—")+'</dd>'+
      kv("登录用户",   userNameText() || "—")+
      /* 排最后一行：它是个**诊断**读数，不是要天天看的信息。 */
      kv("环境检测",   window.isSecureContext ? "安全上下文" : "非安全上下文")+
    '</dl>'+
    /* 这句只在**真的**处在非安全上下文时才出现（用户定的）——
       安全的时候它是句用不上的警告，白占一行。 */
    (window.isSecureContext ? "" :
    '<div class="hint" style="margin-top:10px">'+
      "在非安全上下文中无法使用「实时对讲」功能, 请本机运行或使用 HTTPS 托管。"+
    '</div>');
}

/* ══ 全局设置（一整页）═══════════════════════════════════════════════
   以前是个模态框。改成页面是因为里面能改的东西越攒越多（草稿、调试），
   模态一窄就得上下滚；而且它和另外三个视图本来就是平级的 —— 顶栏那个齿轮
   现在就是切换组里的第四个按钮。 */
function renderSettings(){
  const el = $("#main"); if (!el) return;
  /* headfix = 「全局设置」那一行钉住，下面几张面板自己滚。
     setpage = 这一页自己的内边距（左右 20 / 顶部 16，见 css）。它和考试模式页共用
     headfix，而用户要的只是**设置这一页**收一收，所以另起一个类名，别去改 headfix
     那条基线 —— 那一条一改，考试模式页跟着变。 */
  el.classList.add("headfix","setpage");
  el.innerHTML =
    '<div class="sec-head">'+
      '<div class="title-row">'+
        '<h2 class="serif">全局设置</h2>'+
      '</div>'+
      /* 这一页的出口，和顶栏那枚「‹ 返回」是同一件事：退到**进设置之前**那一页
         （lastMode，见 30-view-list.js），不是退回首页。
         它是**两栏并排那一份**：窄到一次只显示一栏（≤980px）就收起来
         （css 里 `.acts.set-close` 那条），那儿顶上已经有返回键了，
         两个出口并排站着是同一件事说两遍。 */
      '<div class="acts set-close"><button class="btn btn-primary" id="setClose">关闭设置</button></div>'+
    '</div>'+

    '<div class="page-body">'+

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

    /* 「播放代理」：实时对讲 / 在线播放要用的那个本机进程在哪（源码见仓库的
       play-agent/，为什么非有它不可写在 00-core.js 的 agentURL 上面）。
       地址**留空 = 127.0.0.1**（代理默认就和浏览器装在同一台机器上），所以正常
       情况下这两个框一个字都不用填；远程托管（代理装在别的机器上）才填那一台的地址。
       改一下就地写进 S 和本机存储，不提交、也不重画这一页 —— 它是本机设置，
       服务器上压根没这个东西，下一次「呼叫」时才用到（agentURL 现读）。 */
    '<div class="panel">'+
      '<div class="panel-head"><h3>播放代理</h3></div>'+
      '<div class="panel-body">'+
        '<div class="set-row agent-row">'+
          '<div class="set-lab">'+
            '<div class="set-t">通过播放代理在网页端使用实时对讲和在线播放功能</div>'+
            '<div class="hint">运行 ITC-PlayAgent 的服务器地址, 默认为本机, 远程托管用户可自行修改</div>'+
          '</div>'+
          '<div class="set-ctl agent">'+
            '<div class="field"><label for="stAgentHost">Agent 服务地址</label>'+
              '<input class="input mono" id="stAgentHost" value="'+esc(S.agentHost||"")+
                '" spellcheck="false" autocomplete="off" placeholder="127.0.0.1"></div>'+
            '<div class="field"><label for="stAgentPort">端口</label>'+
              '<input class="input mono" id="stAgentPort" value="'+esc(S.agentPort||"")+
                '" spellcheck="false" autocomplete="off" inputmode="numeric" placeholder="'+AGENT_PORT_DEFAULT+'"></div>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+

    /* 「外观」：两套配色，各自都有浅色/深色（深浅跟着系统走）。
       klein = 苹果系统色，summer = 原来的暖色。纯本机偏好（存 localStorage），
       点一下只换 <html data-palette>，不重画这一页。 */
    '<div class="panel">'+
      '<div class="panel-head"><h3>外观</h3></div>'+
      '<div class="panel-body">'+
        '<div class="set-row">'+
          '<div class="set-lab">'+
            '<div class="set-t">配色主题</div>'+
          '</div>'+
          '<div class="set-ctl">'+
            '<div class="tabbar" id="stPalette">'+
              '<button data-pal="klein"'+(S.palette==="klein"?' class="on"':"")+'>Klein</button>'+
              '<button data-pal="summer"'+(S.palette==="summer"?' class="on"':"")+'>Summer</button>'+
            '</div>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+

    /* 「在线对讲」：实时对讲那四声本机提示音（res/call.wav、pause、resume、finish）。
       默认开着，关掉就一声不响。和上面那两格一样是**纯本机偏好**（存 localStorage），
       服务器上没有这个概念，也不影响终端那头听不听得到。 */
    '<div class="panel">'+
      '<div class="panel-head"><h3>在线对讲</h3></div>'+
      '<div class="panel-body">'+
        '<div class="set-row">'+
          '<div class="set-lab">'+
            '<div class="set-t">接通/挂断时在此设备上播放提示</div>'+
          '</div>'+
          '<div class="set-ctl">'+
            '<label class="switch" title="接通/挂断时在此设备上播放提示">'+
              '<input type="checkbox" id="stChime" aria-label="接通/挂断时在此设备上播放提示"'+(S.chime?" checked":"")+'>'+
              '<span class="track"></span></label>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+

    '<div class="panel">'+
      '<div class="panel-head"><h3>版本信息</h3></div>'+
      '<div class="panel-body">'+versionInfoHTML()+'</div>'+
    '</div>'+

    '</div>';   /* /.page-body */

  /* 两个开关都不用自己重画这一页：开关的状态在它自己那个 checkbox 上，
     草稿那个另外还会走 setDraft() → renderTopbar() + renderMain()。
     入口收着的时候两个都不在（见 SHOW_MODE_SWITCHES），判空再绑。 */
  const dbgSw = $("#stDbg");   if (dbgSw) dbgSw.onchange = e => setDebug(e.target.checked);
  const drfSw = $("#stDraft"); if (drfSw) drfSw.onchange = e => setDraft(e.target.checked);
  /* 「播放代理」那两格：边打边存（存的是原样的字，剥壳留给 agentURL 做 ——
     打字打到一半不该被就地改写）。不 commit 任何东西：它只影响本机。 */
  const aHost = $("#stAgentHost"), aPort = $("#stAgentPort");
  if (aHost) aHost.oninput = e => { S.agentHost = e.target.value; LS.set("agentHost", e.target.value); };
  if (aPort) aPort.oninput = e => { S.agentPort = e.target.value; LS.set("agentPort", e.target.value); };
  /* 「在线对讲」那枚提示音开关：翻一下就存，不重画这一页（这一点只影响下一次响不响）。 */
  const chimeSw = $("#stChime");
  if (chimeSw) chimeSw.onchange = e => { S.chime = e.target.checked; LS.set("chime", S.chime); };
  /* 「外观」那两枚色板：点一下换 <html data-palette>、存本机，不重画这一页。 */
  const palSw = $("#stPalette");
  if (palSw) $$("button", palSw).forEach(b => b.onclick = ()=>{
    S.palette = applyPalette(b.dataset.pal);
    LS.set("palette", S.palette);
    $$("button", palSw).forEach(x => x.classList.toggle("on", x === b));
  });
  /* 标题行最右那枚「关闭设置」（竖屏上看不见它，见 css）。和顶栏那枚返回键同一个动作。 */
  $("#setClose").onclick = ()=> goMode(lastMode);
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

/* ── 窄屏上胶囊条横向拖拽 ─────────────────────────────────────────────
   竖屏那一档把 .area-chips / .grp-chips / .cal-chips 收成一行（见 css），
   手机上用手指滑是浏览器白送的；桌面浏览器用鼠标拖不动，这里补上。
   委托在 document 上：条子是各页现画的，逐个挂挂不住。
   **只对鼠标/笔生效** —— 触摸交给原生滚动，两边同时改 scrollLeft 会滑出两倍速。 */
let chipDrag = null, chipDragEndAt = 0;
document.addEventListener("pointerdown", e=>{
  if (e.pointerType === "touch") return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const box = e.target.closest && e.target.closest(".area-chips,.grp-chips,.cal-chips");
  if (!box || box.scrollWidth <= box.clientWidth + 1) return;
  chipDrag = {box, x: e.clientX, left: box.scrollLeft, moved: false, id: e.pointerId};
});
document.addEventListener("pointermove", e=>{
  const d = chipDrag;
  if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x;
  if (!d.moved && Math.abs(dx) < 5) return;      /* 5px 以内是点击，不是拖 */
  d.moved = true;
  d.box.scrollLeft = d.left - dx;
  e.preventDefault();
});
const chipDragEnd = e=>{
  const d = chipDrag;
  if (!d || (e && e.pointerId !== d.id)) return;
  chipDrag = null;
  if (d.moved) chipDragEndAt = Date.now();
};
document.addEventListener("pointerup", chipDragEnd);
document.addEventListener("pointercancel", chipDragEnd);
/* 拖完松手时落点还在某颗胶囊上，浏览器会补一个 click —— 那一下不该删东西/切页。
   用时间窗而不是 once：拖出容器再松手不会产生 click，once 就会扣住下一次正常点击。 */
document.addEventListener("click", e=>{
  if (Date.now() - chipDragEndAt > 350) return;
  if (e.target.closest && e.target.closest(".area-chips,.grp-chips,.cal-chips")){
    e.stopPropagation();
    e.preventDefault();
  }
}, true);
