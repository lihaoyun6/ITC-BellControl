/* groups —— 铃声分组
   //////////////////////////////////////////////////////////////

   一整个学期的铃声里，真正天天要动的就那么几段：「早间」「上午」「午间」「下午」
   「晚间」。想停掉一整个午间，得在表格里挨个勾、挨个关。分组就是为这一件事存在的：
   把几条铃声捆成一个胶囊，一次启停一整段。

   两条规矩（从一开始就没变过）：

     · **一个铃声最多只在一个分组里。** 所以「加进这个组」永远是先把它从别的组摘干净
       再挂上去（见 grpAssign）。两个组同时管着一条铃声，「启用早间」到底该不该把它
       打开，就没有答案了。
     · **分组自己不带开关。** 胶囊前面那个点的颜色是**算出来的** —— 组里全部启用是绿的，
       全部停用是红的，掺着是黄的。「启用这个分组」这件事本身就是把组里每条铃声打开，
       不另存一个状态：存了就会出现「组是启用的、组里铃声是停的」这种自相矛盾的局面。

   ══ 存在哪儿：服务器的铃声名字里 ═══════════════════════════════════
   厂商的铃声表里**没有一个空闲字段**能放这个：字段是定死的，唯一一个自由字符串
   （led_text）是 LED 屏上那行字，占了它是要出事的。名字是唯一一块空地，所以：

     成员   「早自习第一节上课」加进「早间」之后，服务器上存的名字是
            **早自习第一节上课¤早间**。面板显示的时候把 ¤ 连同后面那一截切掉 ——
            切不切由名单说了算，见 grpSplitName。

     名单   分组名本身、连同它们的先后顺序，存在一条**不会响的铃铛**的名字里：
            **¤grp¤早间¤午间¤晚间**。借的是考试模式存静音区域那一招 —— 音源和
            周期都借服务器上现成的（厂商那边这两样是硬要求，不填存不下来），
            再用音量 0 + 停用（is_done=0）把它按死。面板侧它根本不算一条铃声：
            grpAdoptRows 把它从 S.bells 里摘出去，表格、计数、搜索、批量、
            「补空区域」一概看不见它。

   这么存换来三样东西：分组跟着**服务器**走（换台设备打开是同一份，不再只活在这台
   机器的浏览器里）；分组可以是空的（不再要求「至少放一条铃声」）；顺序记下来了。
   代价是改分组名要改服务器上每一条成员铃声的名字，所以那是一串真报文 ——
   和别处一样排队、一样能撤销。

   名字上限 **100 个字符**（厂商原版网页上写明的）：名单那条铃铛的名字装不下
   一个新分组，就是「分组创建已达上限」。 */

/* ══ 名字里的那点记号 ═══════════════════════════════════════════════ */
const GRP_SEP = "¤";                         /* U+00A4，和考试模式同一个分隔符 */
const GRP_META_PREFIX = GRP_SEP+"grp"+GRP_SEP;    /* 名单那条铃铛的名字开头：¤grp¤ */
const GRP_NAME_MAX = 100;                    /* 铃名上限（字符数） */

/* 这条铃铛是不是「名单」本身。这个开头不可能出现在正常铃名里 —— 它一上来就是
   ¤grp¤，而分组标记是加在名字**尾巴**上的（见 grpFullName）。 */
const isGrpMeta = name => String(name||"").indexOf(GRP_META_PREFIX) === 0;

/* 「¤grp¤早间¤午间」→ ["早间","午间"]。分组名里不许有 ¤（见 grpCheckName），
   所以按 ¤ 切一定切得开。 */
function grpNamesOf(metaName){
  return String(metaName||"").split(GRP_SEP).slice(2).filter(Boolean);
}
const grpMetaNameOf = names => GRP_META_PREFIX + (names||[]).join(GRP_SEP);

/* 服务器上存的名字 → 显示名 + 分组名（b.grp）。
   只认**名单里注册过的**那几个名字：名字里带 ¤ 的铃声不止分组这一种，考试铃声
   就是「分区¤角色¤科目」，拿 ¤ 一刀切会把它们切坏。名单是唯一凭据，没注册过的
   ¤ 一律原样留着。 */
function grpSplitName(name, names){
  const s = String(name||"");
  const i = s.lastIndexOf(GRP_SEP);
  if (i < 0) return {name:s, grp:null};
  const tail = s.slice(i+1);
  return (names||[]).indexOf(tail) >= 0 ? {name:s.slice(0,i), grp:tail} : {name:s, grp:null};
}
/* 显示名 → 服务器上该存的名字。**写报文只有这一个出口**（buildPayload 里叫它），
   所以「改分组」不必去动每一条报文的拼装，改 b.grp 就够了。 */
const grpFullName = b => (b && b.grp) ? String(b.name||"")+GRP_SEP+b.grp : String((b && b.name)||"");

/* ══ 服务器上那一把原始行 → 面板这份数据 ═══════════════════════════
   一张列表的全部铃声响了：名单铃铛混在里面，成员铃声的名字尾巴上挂着分组名。
   这一步做两件事 —— 把名单摘出来、把尾巴切掉。

   **面板里只有这里认得名单。** 别的读路径（考试模式算闪避、终端任务反查）各拿
   自己那一把行，也走这个函数：它们同样会撞见名单铃铛和带尾巴的铃名。
   纯函数，不碰 S —— 它也会被拿去解析**别张列表**的行（考试预览、反查），
   顺手改 S.grpMeta 就把当前这张列表的名单弄丢了。 */
function grpAdoptRows(rows){
  const meta = (rows||[]).find(r=> isGrpMeta(r.name)) || null;
  const names = meta ? grpNamesOf(meta.name) : [];
  const bells = (rows||[]).filter(r=> r !== meta).map(r=>{
    const b = normBell(r);
    const s = grpSplitName(b.name, names);
    b.name = s.name; b.grp = s.grp;
    return b;
  });
  return {meta: meta ? normBell(meta) : null, names, bells};
}

/* ══ 当前这张列表 ═══════════════════════════════════════════════════
   分组名就从名单那条铃铛的名字上读，不另存一份，省得不一致（改了名单，
   grpNames() 当场就是新的）。S.grpMeta 由 selectGroup / reloadBells 填。 */
const grpNames = () => S.grpMeta ? grpNamesOf(S.grpMeta.name) : [];

/* 分组 → 成员。顺序就是名单里的顺序（用户自己排的先后）。 */
function grpList(){
  return grpNames().map(n=>({name:n, bells: S.bells.filter(b=> b.grp===n)}));
}

/* 胶囊前面那个点。四种：全开绿、全停红、掺着黄、一条都没有是灰的。 */
function grpDot(g){
  const hit = g.bells || [];
  if (!hit.length) return "none";
  const on = hit.filter(b=> Number(b.isDone) === 1).length;
  return on === hit.length ? "on" : (on === 0 ? "off" : "part");
}
const GRP_DOT_WORD = {on:"全部启用", off:"全部停用", part:"有的启用、有的停用", none:"没有铃声"};

/* 把一条或多条铃声挂到 name 这个分组上；name=null 就是摘出来。
   **先摘干净再挂** —— 「最多只在一个组里」那条规矩唯一落地的地方。
   动的其实是名字（服务器上那个 ¤ 尾巴），所以每一条都是一份真报文；
   本地先改 b.grp，报文由 buildPayload 现拼（→ grpFullName）。 */
function grpAssign(bells, name){
  let n = 0;
  (bells||[]).forEach(b=>{
    if (!b || b.grp === name) return;
    b.grp = name;
    queueSave(b, name ? "改分组" : "移出分组");
    n++;
  });
  return n;
}

/* ══ 名单那条铃铛 ═══════════════════════════════════════════════════
   厂商那边一条铃声必须挂音源、必须挂时间属性（考试模式的静音铃那段写着为什么），
   名单铃铛也不例外，所以这两样得借服务器上现成的。借来的东西不参与任何判定，
   随手取一个真实存在的就行 —— 但**必须真实存在**，随手编一个文件名，
   服务器会连着这条铃声一起退回来。 */
function grpBorrowMedia(){
  if (S.data.medias.length) return S.data.medias[0].name;
  const b = S.bells.find(x=> (x.mediaNames||[]).length);
  return b ? b.mediaNames[0] : null;
}
function grpBorrowStrategy(){
  const b = S.bells.find(x=> x.strategyId != null);
  return b ? b.strategyId : ensureStrategy();
}
const grpReady = () => !!(grpBorrowMedia() && grpBorrowStrategy() != null);

/* 名单铃铛的面板对象。没有就现造一个（还没上过服务器，tmpId 顶着）。
   让它永远不响的是**另外两样**，不是「没周期」：is_done=0 加上音量 0。
   执行区域一个都不给 —— 它本来就哪儿都不该响。 */
function grpMetaBell(){
  if (S.grpMeta) return S.grpMeta;
  const media = grpBorrowMedia();
  return S.grpMeta = {
    id:null, tmpId:"g"+Math.random().toString(36).slice(2,8), isNew:true,
    name: GRP_META_PREFIX, times:["00:00:00"], time:"00:00:00",
    strategyId: grpBorrowStrategy(), isDone:0, type:1, priority:50, volume:0, mode:"1",
    lightId:1, ledText:"", ledCfgId:1,
    sound:{life_time: lifeTimeOf([media]), play_model:0},
    mediaNames:[media], mediaGroupNames:[],
    termNames:[], groupNames:[], termIds:{}, groupIds:{}, mediaIds:{}, mediaGroupIds:{}
  };
}

/* 名单写回服务器（names 是**改完之后**的那一串）。

   报文和队列这一块有点讲究：这条铃铛的面板对象不在 S.bells 里，queueUpdate /
   queueCreate 那两件现成的不合用 —— 它们拿 b.name 当抽屉里那行标签，而这条铃铛的
   名字就是「¤grp¤早间」本身，摆到人眼前是一句谁也看不懂的东西。所以自己拼，
   标签一律写「铃声分组」。

   base 一律留空（不抵消）：名单是**这张列表的分组表**，它回到原样不代表成员铃声
   也回到了原样，撤销得由那些铃声自己那份报文去判。 */
function grpQueueMeta(names, why){
  const meta = grpMetaBell();
  meta.name = grpMetaNameOf(names);
  if (meta.id){
    queueOp({
      kind:"update", method:"PUT", url:"/timing-bells/"+meta.id,
      body: buildPayload(meta),
      bellId: meta.id, entity:"bell", label:"铃声分组", sub: why
    });
    return;
  }
  /* 头一回：这张列表上还没有名单铃铛。它不在 S.bells 里，applyLocally 那个
     「按 tmpId 找回来、把真 id 接上」够不着它，所以自己挂一个 onOk ——
     不接上的话，下一次改分组会再建一条名单，服务器上就躺着两条。 */
  queueOp({
    kind:"create", method:"POST", url:"/timing-bells",
    body: createPayload(meta),
    bellId: meta.tmpId, entity:"bell", label:"铃声分组", sub: why,
    onOk: r=>{ const id = r && (r.id || (r.result && r.result.id));
               if (id){ meta.id = Number(id); meta.isNew = false; delete meta.tmpId; } }
  });
}

/* ══ 建 / 改名 / 删 ═════════════════════════════════════════════════
   三件事都是「先改名单，再改成员」（顺序有意义：名单先落地，中间那一帧里
   成员名字上的尾巴才有人认领）。都返回一句给用户看的话，""=办成了。 */
function grpCheckName(v, names, skip){
  const s = String(v||"").trim();
  if (!s) return "先起个名字";
  if (s.indexOf(GRP_SEP) >= 0) return "分组名称里不能有「"+GRP_SEP+"」";
  if (names.some(n=> n===s && n!==skip)) return "已经有同名分组了";
  return "";
}
const GRP_FULL = "分组创建已达上限";     /* 名单那条铃铛的名字装不下这个分组了 */

function grpAdd(v){
  const names = grpNames();
  const bad = grpCheckName(v, names);
  if (bad) return bad;
  const name = String(v).trim();
  if (grpMetaNameOf(names.concat([name])).length > GRP_NAME_MAX) return GRP_FULL;
  if (!grpReady()) return "服务器上还没有可用的音频或时间属性，新建不了分组";
  grpQueueMeta(names.concat([name]), "新建分组「"+name+"」");
  return "";
}
function grpRename(oldName, v){
  const names = grpNames();
  const name = String(v||"").trim();
  if (name === oldName) return "";
  const bad = grpCheckName(name, names, oldName);
  if (bad) return bad;
  if (grpMetaNameOf(names.map(n=> n===oldName ? name : n)).length > GRP_NAME_MAX) return GRP_FULL;
  grpQueueMeta(names.map(n=> n===oldName ? name : n), "分组改名");
  /* 成员名字上的尾巴跟着换 —— 一条一份报文。 */
  S.bells.filter(b=> b.grp===oldName).forEach(b=>{ b.grp = name; queueSave(b, "改分组"); });
  return "";
}
/* 删分组：**铃声一条都不动**，只是不再属于任何分组。
   名单铃铛本身留着（名字退回空的「¤grp¤」）—— 删掉它反而要再发一条报文，
   而且下次建分组还得再造一条。留着它就等于「这张列表有分组这套东西，只是现在
   一个分组都没有」，反正是条不响的铃铛。 */
function grpDrop(name){
  const names = grpNames();
  if (names.indexOf(name) < 0) return;
  grpQueueMeta(names.filter(n=> n!==name), "删除分组「"+name+"」");
  S.bells.filter(b=> b.grp===name).forEach(b=>{ b.grp = null; queueSave(b, "移出分组"); });
}

/* ══ 详情页里那块面板 ═══════════════════════════════════════════════
   位置是定死的：和「打铃区域」同一行（横屏并排，竖屏上下两条）、铃声表格上面。
   左边那块管「这些铃声在哪儿响」，这块管「这些铃声分成几段管」，再往下才是逐条的
   明细 —— 从粗到细。
   标题叫「铃声分组」不是「分组」：面板里别处还有一个「分组」，那是区域选择器里的
   终端分组，两件事不能共用一个说法。
   考试期间这一整块停用：往组里加铃声不要紧，但「启用/停用整个分组」是往服务器上
   写启停，正在考的那份配置不能动（和上面「编辑区域」同一个道理）。 */
function grpPanelHTML(lock){
  const gs = grpList();
  const chips = gs.map(g=>{
    const d = grpDot(g);
    return '<button class="grp-chip" data-gn="'+esc(g.name)+'"'+(lock?" disabled":"")+
        ' title="'+esc(g.name+"：" + GRP_DOT_WORD[d])+'">'+
      '<span class="grp-dot '+d+'"></span>'+
      '<span class="grp-name">'+esc(g.name)+'</span>'+
      '<span class="grp-n">'+g.bells.length+'</span>'+
      '<span class="grp-pen">'+ICON.edit+'</span>'+
    '</button>';
  }).join("");

  return '<div class="panel">'+
    '<div class="panel-head">'+
      '<h3>铃声分组</h3>'+
      '<span class="sub">'+(gs.length ? gs.length+' 个分组' : '')+'</span>'+
      '<span class="acts"><button class="btn btn-sm" id="mGrpEdit"'+(lock?" disabled":"")+'>编辑分组</button></span>'+
    '</div>'+
    '<div class="panel-body">'+
      /* 空态那句装在 .grp-chips **里面**：那一格自带「一行胶囊高」的下限
         （见 css 的 .grp-chips），句子搁在外头当兄弟，这一块就还是 18px ↔ 24.6px 地跳。 */
      '<div class="grp-chips">'+
        (gs.length ? chips : '<span class="hint">还没有分组，点右上角「编辑分组」来创建。</span>')+
      '</div>'+
    '</div>'+
  '</div>';
}

function grpBind(el, lock){
  const e = el.querySelector("#mGrpEdit");
  if (e) e.onclick = openGrpEdit;
  $$(".grp-chip", el).forEach(c=>{
    c.onclick = ()=>{ if (!lock) openGrpDetail(c.dataset.gn); };
  });
}

/* ══ 编辑分组：建、改名、删 ═════════════════════════════════════════
   删分组**只删分组本身**，组里的铃声一条不动 —— 这条要写在确认框里，
   不然没人敢按。 */
function openGrpEdit(){
  openModal({
    title:"编辑分组", sub:"删除分组不会同时删除分组内的铃声",
    width:"480px",
    mount(body, foot, mm){
      const draw = ()=>{
        const gs = grpList();
        body.innerHTML = '<div class="stack">'+
          (gs.length ? gs.map(g=>
            '<div style="display:flex;gap:8px;align-items:center">'+
              '<input class="input" data-nm="'+esc(g.name)+'" value="'+esc(g.name)+'" '+
                'placeholder="分组名称" style="flex:1;min-width:0">'+
              /* 末尾两枚无边框的图标键：用的是 .cell-btn —— 铃声表行尾那三枚
                 （.ric）是同一个样子，只是那套规则挂在 .rowacts 底下，这儿用不了
                 （css 里「单元格里只有一个图标的按钮」那段写着同样一句）。
                 铅笔进的是分组详情，和点上面那颗分组胶囊是同一件事。 */
              '<button class="cell-btn" data-eg="'+esc(g.name)+'" title="编辑分组内容" '+
                'aria-label="编辑分组内容" style="flex:none">'+ICON.edit+'</button>'+
              '<button class="cell-btn danger" data-dl="'+esc(g.name)+'" title="删除这个分组" '+
                'aria-label="删除分组" style="flex:none">'+ICON.del+'</button>'+
            '</div>').join("")
          : '<div class="hint">还没有分组。</div>')+
          '<div style="display:flex;gap:8px;align-items:center">'+
            '<input class="input" id="grpNew" placeholder="分组1" style="flex:1;min-width:0">'+
            '<button class="btn btn-sm" id="grpAdd" style="flex:none">'+ICON.plus+' 添加</button>'+
          '</div>'+
        '</div>';
        bind();
      };

      /* 名字没改成 → 把框里的字退回去；成了 → 重画（胶囊那边跟着变） */
      const rename = (inp, oldName)=>{
        const err = grpRename(oldName, inp.value);
        if (err){ toast(err,"err"); inp.value = oldName; return; }
        if (String(inp.value).trim() !== oldName) draw();
        renderMain();
      };

      function bind(){
        $$("[data-nm]", body).forEach(inp=>{
          const oldName = inp.dataset.nm;
          inp.onchange = ()=> rename(inp, oldName);
        });
        $$("[data-eg]", body).forEach(btn=>{
          btn.onclick = ()=> openGrpDetail(btn.dataset.eg);
        });
        $$("[data-dl]", body).forEach(btn=>{
          btn.onclick = ()=>{
            const name = btn.dataset.dl;
            openConfirm("删除分组「"+name+"」",
              "删除分组不会影响组内的铃声及其状态。",
              ()=>{
                grpDrop(name);
                toast("分组已删除"+tailFor(),"ok");
                draw(); renderMain();
              });
          };
        });
        const nw = body.querySelector("#grpNew"), add = body.querySelector("#grpAdd");
        const doAdd = ()=>{
          const v = nw.value.trim();
          if (!v){ nw.focus(); toast("先起个名字","err"); return; }
          const err = grpAdd(v);
          if (err){ toast(err,"err"); nw.focus(); return; }
          nw.value = ""; draw(); renderMain();
          const again = body.querySelector("#grpNew"); if (again) again.focus();
        };
        add.onclick = doAdd;
        nw.onkeydown = e => { if (e.key === "Enter") doAdd(); };
      }

      draw();
      foot.innerHTML = '<span class="spacer"></span><button class="btn" id="geDone">完成</button>';
      foot.querySelector("#geDone").onclick = ()=> closeModal(mm.id);
    }
  });
}

/* ══ 分组详情 ═══════════════════════════════════════════════════════
   点胶囊进这里：上面搜索，下面「谁在这个组里」，左下角一个整组启停的开关。

   **勾选框改的是手上这份草稿。** 进去时它 = 服务器上这个组现在的成员，之后随便勾，
   一条也不发报文 —— 点「完成」那一下才把差集一次性发出去（谁进了、谁出了）。
   所以关掉弹窗 = 放弃这次的勾选，和这一屏从前「勾一下就改名」是两种脾气。

   **左下角那个开关是立刻生效的**：它落到的还是每一条铃声自己的启停上（见文件头
   那条规矩），和勾选那份草稿不是一回事。所以作用范围是**当前勾着的**那些 ——
   包含刚勾上、还没点「完成」的铃声：勾几条、顺手一起打开，这一步必须走得通。 */
function openGrpDetail(gname){
  const here = ()=> grpNames().indexOf(gname) >= 0;

  openModal({
    title: gname, width:"540px",
    mount(body, foot, mm){
      let q = "";                             /* 搜索词，只活在这个弹窗里 */
      /* 一条铃声在这份勾选里叫什么。有 id 用 id，没有（新加的、还没上服务器）
         用临时号。 */
      const key = b => String(b.id != null ? b.id : (b.tmpId || ""));
      let sel = new Set(S.bells.filter(b=> b.grp === gname).map(key));
      let sw = null;                          /* 左下角那个开关，住在 foot 里 */

      /* 勾着的那些铃声。勾完之后列表被重载过也不怕：重新按名字找就是了。 */
      const picked = ()=> S.bells.filter(b=> sel.has(key(b)));

      /* 只改状态、不重画 —— 勾一条就整块重画，滚动位置和光标全得搭进去重来 */
      const sync = ()=>{
        const ps = picked();
        body.querySelector("#gdCount").textContent = "已选 " + ps.length + " 条铃声";
        $$("[data-dot]", body).forEach(d=>{
          const b = S.bells.find(x=> key(x) === d.dataset.dot);
          const on = !!(b && Number(b.isDone) === 1);
          d.className = "grp-dot " + (on ? "on" : "off");
          d.title = on ? "启用" : "停用";
        });
        if (sw){
          sw.disabled = !ps.length;
          /* 勾着的全开着 → 开关就是开着的。一条没勾 → 关着（反正也点不动） */
          sw.checked = ps.length > 0 && ps.every(b=> Number(b.isDone) === 1);
        }
      };

      const draw = ()=>{
        /* 分组被删掉了（在别的地方删的）就自己关上，别留一张空壳 */
        if (!here()){ closeModal(mm.id); return; }
        const rows = S.bells.filter(b=> !q || String(b.name||"").toLowerCase().indexOf(q.toLowerCase()) >= 0
                                          || String(b.time||"").indexOf(q) >= 0);
        body.innerHTML =
          '<div class="sect-h" style="border:0;background:none;padding:0 0 6px">'+
            '<span id="gdCount"></span>'+
            '<span class="acts"><span class="sbox sbox-sm" style="flex:none;width:150px">'+ICON.search+
              '<input class="input" id="gdQ" placeholder="筛选名称/时间" value="'+esc(q)+'"></span></span>'+
          '</div>'+
          '<div id="gdList" style="max-height:44vh;overflow:auto;border:1px solid var(--border);border-radius:var(--r-sm)">'+
            (rows.length ? rows.map(b=>{
              const k = key(b);
              return '<label class="gd-row">'+
                '<input type="checkbox" data-id="'+esc(k)+'"'+(sel.has(k)?" checked":"")+'>'+
                '<span class="mono gd-t">'+esc(hm(b.time)||"")+'</span>'+
                '<span class="grp-dot off" data-dot="'+esc(k)+'"></span>'+
                '<span class="gd-n">'+esc(b.name || "未命名铃声")+'</span>'+
                /* 不在这个组里、但另有归属的，尾巴上就写个分组名 —— 那一格本来就是
                   右边顶头，位置自己说明「它现在在哪儿」，不用再堆一句「现在在…里」。 */
                (b.grp && b.grp !== gname ? '<span class="hint gd-o">'+esc(b.grp)+'</span>' : "")+
              '</label>';
            }).join("")
            : '<div class="hint" style="padding:16px 12px">'+(S.bells.length ? "没有匹配的铃声。" : "这张列表里还没有铃声。")+'</div>')+
          '</div>'+
          '<div class="hint" style="padding-top:10px">每条铃声只能添加到一个分组，'+
            '勾选其他分组中的铃声会将它从那个组中移动过来。点「完成」才会写进服务器。</div>';

        /* 重画会把输入框换掉，光标得自己接回去 —— 不然打一个字掉一次焦点。 */
        const q2 = body.querySelector("#gdQ");
        q2.oninput = ()=>{
          q = q2.value; draw();
          const nq = body.querySelector("#gdQ");
          if (nq){ nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
        };

        /* 勾选框只动手上这份 sel，一个字都不发出去 */
        $$("[data-id]", body).forEach(cb=>{
          cb.onchange = ()=>{
            if (cb.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id);
            sync();
          };
        });
        sync();
      };

      /* 「完成」：把手上这份勾选和服务器上那份比一比，只发变了的那些 ——
         进了组的改成 gname，出了组的摘干净。 */
      const commit = ()=>{
        let k = 0;
        S.bells.forEach(b=>{
          const want = sel.has(key(b));
          if (want === (b.grp === gname)) return;
          grpAssign([b], want ? gname : null); k++;
        });
        closeModal(mm.id);
        renderMain();
        if (k) toast("分组「"+gname+"」已更新"+tailFor(), "ok");
      };

      draw();
      foot.innerHTML =
        '<label class="switch" style="flex:none">'+
          '<input type="checkbox" id="gdSw">'+
          '<span class="track"></span>'+
          '<span class="dimmer">启用组内所有铃声</span>'+
        '</label>'+
        '<span class="spacer"></span>'+
        '<button class="btn" id="gdDone">完成</button>';
      sw = foot.querySelector("#gdSw");
      sync();                                 /* 开开关的初值：勾着的都开着才亮 */

      /* 本地那份状态必须**先改再排队** —— 表格里那个单条开关就是这么写的
         （30-view-list.js 的「先改本地状态再排队」那段），原因也一样：报文里的
         is_done 是 buildPayload(b) 读出来的，不先改本地，排出去的还是老值，
         点也永远不动。

         还没有 id 的铃声（刚加进列表、还没上服务器）不能发 PUT，那条路是 404，
         按 queueSave 的老规矩走「新建」把状态捎过去。 */
      sw.onchange = ()=>{
        const on = sw.checked;
        let k = 0;
        picked().forEach(b=>{
          if (Number(b.isDone) === (on?1:0)) return;
          b.isDone = on ? 1 : 0;
          if (b.id) queueToggle(b, on); else queueSave(b, on ? "启用" : "停用");
          k++;
        });
        renderMain();
        sync();
        toast(k ? (on ? "已启用 " + k + " 条铃声" : "已停用 " + k + " 条铃声")
                : "这些铃声本来就是" + (on ? "启用" : "停用") + "的", k ? "ok" : "");
      };
      foot.querySelector("#gdDone").onclick = commit;
    }
  });
}

/* ══ 批量改分组 ═════════════════════════════════════════════════════
   从多选那条路进来：勾了五条铃声，一次归到「午间」。 */
function openGrpBulk(bells){
  const items = grpList().map(g=>({
    icon: "", label: g.name,
    sub: "现在有 " + g.bells.length + " 条",
    onPick: ()=>{ const k = grpAssign(bells, g.name); done(k + " 条铃声已归到「" + g.name + "」"); }
  }));
  items.push({icon:ICON.plus, label:"新建分组…", sub:"建一个新组，把这些铃声放进去",
              onPick: ()=> openGrpNew(bells)});
  items.push({icon:ICON.x, label:"移出分组", sub:"这些铃声不再属于任何分组",
              onPick: ()=>{ const k = grpAssign(bells, null);
                            done(k ? k + " 条铃声已移出分组" : "这些铃声本来就不在任何分组里"); }});
  openBulkMenu("改分组 · " + bells.length + " 条铃声", "一条铃声只能在一个分组里，选新的会自动从原来的组移走", items);

  function done(msg){
    S.sel.clear(); renderMain(); toast(msg, "ok");
  }
}

function openGrpNew(bells){
  openModal({
    title:"新建分组", sub:"建好之后这些铃声就归在它下面", width:"420px",
    mount(body, foot, mm){
      body.innerHTML = '<div class="field"><label>分组名称</label>'+
        '<input class="input" id="gnName" placeholder="分组1"></div>'+
        '<div class="hint" style="padding-top:10px">分组名会写进铃声名字里，一共 '+
          GRP_NAME_MAX+' 个字符，所有分组共用这份额度。</div>';
      const inp = body.querySelector("#gnName");
      setTimeout(()=> inp.focus(), 30);
      const go = ()=>{
        const v = inp.value.trim();
        if (!v){ markErr(body, inp.closest(".field")); toast("先起个名字","err"); inp.focus(); return; }
        const err = grpAdd(v);
        if (err){ markErr(body, inp.closest(".field")); toast(err,"err"); inp.focus(); return; }
        grpAssign(bells, v);
        closeModal(mm.id);
        S.sel.clear(); renderMain();
        toast(bells.length + " 条铃声已归到「" + v + "」" + tailFor(), "ok");
      };
      inp.onkeydown = e => { if (e.key === "Enter") go(); };
      foot.innerHTML = '<span class="spacer"></span>'+
        '<button class="btn" id="gnCancel">取消</button>'+
        '<button class="btn btn-primary" id="gnOk">建好并放入</button>';
      foot.querySelector("#gnCancel").onclick = ()=> closeModal(mm.id);
      foot.querySelector("#gnOk").onclick = go;
    }
  });
}
