/* groups —— 铃声分组
   //////////////////////////////////////////////////////////////

   一整个学期的铃声里，真正天天要动的就那么几段：「早间」「上午」「午间」「下午」
   「晚间」。想停掉一整个午间，得在表格里挨个勾、挨个关。分组就是为这一件事存在的：
   把几条铃声捆成一个胶囊，一次启停一整段。

   两条规矩：

     · **一个铃声最多只在一个分组里。** 所以「加进这个组」永远是先把它从别的组摘干净
       再挂上去（见 grpAssign）。两个组同时管着一条铃声，「启用早间」到底该不该把它
       打开，就没有答案了。
     · **分组自己不带开关。** 胶囊前面那个点的颜色是**算出来的** —— 组里全部启用是绿的，
       全部停用是红的，掺着是黄的。「启用这个分组」这件事本身就是把组里每条铃声打开，
       不另存一个状态：存了就会出现「组是启用的、组里铃声是停的」这种自相矛盾的局面。

   存储见 js/05-config.js（本机 + 服务器媒体库各一份）。 */

/* ══ 数据 ═══════════════════════════════════════════════════════════ */

/* 分组里存的是「键」，不是对象 —— 铃声每次重新拉下来都是新的对象，认键才认得住人。
   带前缀是因为**新加的铃声在提交之前根本没有 id**：服务器要等提交回来才发号。
   草稿里的铃声先用临时号 ~tmpId 顶着，提交把 id 接上之后再换成 #id。 */
const bellKeyOf = b => (b && b.id != null && b.id !== "") ? "#"+b.id
                    : (b && b.tmpId ? "~"+b.tmpId : "");

function grpList(listId){
  const a = S.cfg.lists[String(listId)];
  return Array.isArray(a) ? a : [];
}
function grpSave(listId, arr){
  S.cfg.lists[String(listId)] = arr;
  cfgSave("lists");
}
function grpNewId(){ return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

/* 草稿里的铃声提交成功后会拿到真 id（js/00-core.js 的 queueCreate 把它写回对象上），
   可分组里记的还是当初那个临时号。每次画面板顺手换一次 —— 这样不用去动提交那条路，
   漏了一次也不要紧，下次渲染自己会补上。
   顺带把**对不上人的键**清掉：那条铃声在服务器上被删了，键就是一笔死账，
   留着只会让胶囊上的条数虚高。S.bells 空的时候一概不动 —— 那多半是还没拉回来。 */
function grpReconcile(listId){
  /* 手上这份 bells 必须是**这张列表**的，否则一概别动。切列表时 selectGroup 会先
     改 groupId 再 renderAll 一次、最后才拉到新铃声 —— 中间那一帧里，新列表的分组
     会被拿去和旧列表的铃声对账，对不上就全成了死账，一点删除确认都没有。
     空的时候也不动：那多半是还没拉回来。 */
  if (!S.bells.length || String(S.bellsListId) !== String(listId)) return;
  const live = {};
  S.bells.forEach(b=>{ const k = bellKeyOf(b); if (k) live[k] = (b.id != null && b.id !== ""); });
  let dirty = false;
  const arr = grpList(listId).map(g=>{
    const bells = [];
    (g.bells||[]).forEach(k=>{
      if (!(k in live)) return;                     /* 没人认领 → 丢掉 */
      let kk = k;
      if (k.charAt(0) === "~" && live[k]){
        /* 这条已经有 id 了，把临时号换成真号 */
        const b = S.bells.filter(x=>"~"+x.tmpId===k)[0];
        if (b){ kk = "#"+b.id; }
      }
      if (kk !== k) dirty = true;
      if (bells.indexOf(kk) < 0) bells.push(kk); else dirty = true;
    });
    if (bells.length !== (g.bells||[]).length) dirty = true;
    return {id:g.id, name:g.name, bells};
  });
  if (dirty) grpSave(listId, arr);
}

function grpBellsOf(g, bells){
  const want = {};
  (g.bells||[]).forEach(k=> want[k] = 1);
  return (bells||S.bells).filter(b=> want[bellKeyOf(b)]);
}

/* 胶囊前面那个点。四种：全开绿、全停红、掺着黄、一条都对不上是灰的。 */
function grpDot(g){
  const hit = grpBellsOf(g);
  if (!hit.length) return "none";
  const on = hit.filter(b=> Number(b.isDone) === 1).length;
  return on === hit.length ? "on" : (on === 0 ? "off" : "part");
}
const GRP_DOT_WORD = {on:"全部启用", off:"全部停用", part:"有的启用、有的停用", none:"没有铃声"};

function grpOf(listId, key){
  return grpList(listId).filter(g => (g.bells||[]).indexOf(key) >= 0)[0] || null;
}

/* 把一个或多个铃声挂到 gid 这个组上；gid 传 null 就是纯摘出来。
   **先摘干净再挂** —— 这就是「最多只在一个组里」那条规矩唯一落地的地方。 */
function grpAssign(listId, keys, gid){
  const set = {};
  keys.forEach(k=>{ if (k) set[k] = 1; });
  const arr = grpList(listId).map(g=>{
    const bells = (g.bells||[]).filter(k=> !set[k]);
    if (g.id === gid) Object.keys(set).forEach(k=>{ if (bells.indexOf(k) < 0) bells.push(k); });
    return {id:g.id, name:g.name, bells};
  });
  grpSave(listId, arr);
}

/* ══ 详情页里那块面板 ═══════════════════════════════════════════════
   位置是定死的：打铃区域下面、铃声表格上面。上面那块管「这些铃声在哪儿响」，
   这块管「这些铃声分成几段管」，再往下才是逐条的明细 —— 从粗到细。
   考试期间这一整块停用：往组里加铃声不要紧，但「启用/停用整个分组」是往服务器上
   写启停，正在考的那份配置不能动（和上面「编辑区域」同一个道理）。 */
function grpPanelHTML(lock){
  grpReconcile(S.groupId);
  const gs = grpList(S.groupId);
  const chips = gs.map(g=>{
    const d = grpDot(g);
    return '<button class="grp-chip" data-gid="'+esc(g.id)+'"'+(lock?" disabled":"")+
        ' title="'+esc(g.name+"：" + GRP_DOT_WORD[d])+'">'+
      '<span class="grp-dot '+d+'"></span>'+
      '<span class="grp-name">'+esc(g.name)+'</span>'+
      '<span class="grp-n">'+(g.bells||[]).length+'</span>'+
      '<span class="grp-pen">'+ICON.edit+'</span>'+
    '</button>';
  }).join("");

  return '<div class="panel">'+
    '<div class="panel-head">'+
      '<h3>分组</h3>'+
      '<span class="sub">'+(gs.length ? gs.length+' 个分组' : '')+'</span>'+
      '<span class="acts"><button class="btn btn-sm" id="mGrpEdit"'+(lock?" disabled":"")+'>编辑分组</button></span>'+
    '</div>'+
    '<div class="panel-body">'+
      (gs.length
        ? '<div class="grp-chips">'+chips+'</div>'
        : '<div class="hint">还没有分组，点右上角「编辑分组」来创建。</div>')+
    '</div>'+
  '</div>';
}

function grpBind(el, lock){
  const e = el.querySelector("#mGrpEdit");
  if (e) e.onclick = openGrpEdit;
  $$(".grp-chip", el).forEach(c=>{
    c.onclick = ()=>{ if (!lock) openGrpDetail(c.dataset.gid); };
  });
}

/* ══ 编辑分组：建、改名、删 ═════════════════════════════════════════
   删分组**只删分组本身**，组里的铃声一条不动 —— 这条要写在确认框里，
   不然没人敢按。 */
function openGrpEdit(){
  const listId = S.groupId;
  /* 这个弹窗开着的时候攒着不推，关掉那一下推一次（见 js/05-config.js 顶上那段）。
     一次编辑会话 = 一趟上传，而不是编一下推一下。 */
  cfgHoldOn();
  openModal({
    title:"编辑分组", sub:"删掉分组只会去掉这个分组，组里的铃声照旧执行",
    width:"480px",
    onClose: cfgHoldOff,
    mount(body, foot, mm){
      const draw = ()=>{
        const gs = grpList(listId);
        body.innerHTML = '<div class="stack">'+
          (gs.length ? gs.map(g=>
            '<div style="display:flex;gap:8px;align-items:center">'+
              '<input class="input" data-nm="'+esc(g.id)+'" maxlength="12" value="'+esc(g.name)+'" '+
                'placeholder="分组名称" style="flex:1;min-width:0">'+
              '<span class="hint" style="flex:none;white-space:nowrap">'+(g.bells||[]).length+' 条</span>'+
              '<button class="btn btn-sm" data-dl="'+esc(g.id)+'" title="删除这个分组" '+
                'aria-label="删除分组" style="flex:none">'+ICON.del+'</button>'+
            '</div>').join("")
          : '<div class="hint">还没有分组。</div>')+
          '<div style="display:flex;gap:8px;align-items:center">'+
            '<input class="input" id="grpNew" maxlength="12" placeholder="新分组名称，例如「早间」" style="flex:1;min-width:0">'+
            '<button class="btn btn-sm" id="grpAdd" style="flex:none">'+ICON.plus+' 添加</button>'+
          '</div>'+
        '</div>';
        bind();
      };

      function bind(){
        $$("[data-nm]", body).forEach(inp=>{
          const g0 = grpList(listId).filter(g=>g.id===inp.dataset.nm)[0];
          inp.onchange = ()=>{
            const v = inp.value.trim();
            if (!v){ inp.value = g0 ? g0.name : ""; toast("分组名称不能是空的"); return; }
            grpSave(listId, grpList(listId).map(g=> g.id===inp.dataset.nm
              ? {id:g.id, name:v, bells:g.bells} : g));
            refresh();
          };
        });
        $$("[data-dl]", body).forEach(btn=>{
          btn.onclick = ()=>{
            const g = grpList(listId).filter(x=>x.id===btn.dataset.dl)[0];
            if (!g) return;
            openConfirm("删除分组「"+g.name+"」",
              "只会删掉这个分组本身，组里的 "+(g.bells||[]).length+" 条铃声一条都不会动，照旧执行。",
              ()=>{
                grpSave(listId, grpList(listId).filter(x=>x.id!==g.id));
                toast("分组已删除","ok");
                draw(); refresh();
              });
          };
        });
        const nw = body.querySelector("#grpNew"), add = body.querySelector("#grpAdd");
        const doAdd = ()=>{
          const v = nw.value.trim();
          if (!v){ nw.focus(); toast("先起个名字"); return; }
          if (grpList(listId).some(g=>g.name===v)){ toast("已经有同名分组了"); nw.focus(); return; }
          grpSave(listId, grpList(listId).concat([{id:grpNewId(), name:v, bells:[]}]));
          nw.value = ""; draw(); refresh();
          const again = body.querySelector("#grpNew"); if (again) again.focus();
        };
        add.onclick = doAdd;
        nw.onkeydown = e => { if (e.key === "Enter") doAdd(); };
      }

      /* 改了分组就顺手把背后那块详情页也重画一遍 —— 胶囊在那边。 */
      const refresh = ()=> renderMain();

      draw();
      foot.innerHTML = '<span class="spacer"></span><button class="btn" id="geDone">完成</button>';
      foot.querySelector("#geDone").onclick = ()=> closeModal(mm.id);
    }
  });
}

/* ══ 分组详情 ═══════════════════════════════════════════════════════
   点胶囊进这里：上面是「整个组一起启停」，下面是「谁在这个组里」。
   勾选框一勾就生效，没有再一个「保存」 —— 这一屏本来就是分组的编辑态。 */
function openGrpDetail(gid){
  const listId = S.groupId;
  const find = ()=> grpList(listId).filter(g=>g.id===gid)[0] || null;

  /* 同上：勾一个成员就推一趟太吵，攒到关弹窗那一下。 */
  cfgHoldOn();
  openModal({
    title: (find() || {}).name || "分组",
    width:"540px",
    onClose: cfgHoldOff,
    mount(body, foot, mm){
      let q = "";                       /* 成员列表的搜索词，只活在这个弹窗里 */

      /* 重画是把整个 body 换掉 —— 列表滚到下面勾一条铃声，它会「啪」地弹回顶上。
         所以画之前先把滚动位置记下来，画完再放回去。keep=false 是搜索那条路：
         换了关键词本来就该从头看。 */
      const draw = (keep)=>{
        const g = find();
        if (!g){ closeModal(mm.id); return; }
        mm.host.querySelector(".modal-head h3").textContent = g.name;
        const old  = body.querySelector("#gdList");
        const top  = keep && old ? old.scrollTop : 0;
        const mtop = keep ? body.scrollTop : 0;

        const d = grpDot(g);
        const n = (g.bells||[]).length;
        const word = {on:"已全部启用", off:"已全部停用",
                      part:"有的在执行、有的停了", none:"还没有铃声"}[d];

        const mem = grpBellsOf(g);
        const rows = S.bells.filter(b=> !q || String(b.name||"").toLowerCase().indexOf(q.toLowerCase()) >= 0
                                          || String(b.time||"").indexOf(q) >= 0);

        body.innerHTML =
          '<div style="display:flex;gap:10px;align-items:center;padding:2px 0 12px">'+
            '<span class="grp-dot '+d+'" style="width:10px;height:10px"></span>'+
            '<span style="font-size:13px;font-weight:500">'+word+'</span>'+
            '<span class="hint">'+n+' 条铃声</span>'+
            '<span style="flex:1"></span>'+
            '<button class="btn btn-sm" id="gdOn"'+(n?"":" disabled")+'>'+ICON.check+' 全部启用</button>'+
            '<button class="btn btn-sm" id="gdOff"'+(n?"":" disabled")+'>停用</button>'+
          '</div>'+
          '<div class="sect-h" style="border:0;background:none;padding:0 0 6px">组里的铃声'+
            '<span class="acts"><input class="input" id="gdQ" placeholder="找铃声" '+
              'style="width:130px;padding:4px 9px;font-size:12px" value="'+esc(q)+'"></span>'+
          '</div>'+
          '<div id="gdList" style="max-height:44vh;overflow:auto;border:1px solid var(--border);border-radius:var(--r-sm)">'+
            (rows.length ? rows.map(b=>{
              const key = bellKeyOf(b);
              const on = mem.some(x=>bellKeyOf(x) === key);
              const other = on ? null : grpOf(listId, key);
              return '<label class="gd-row">'+
                '<input type="checkbox" data-k="'+esc(key)+'"'+(on?" checked":"")+'>'+
                '<span class="mono gd-t">'+esc(hm(b.time)||"")+'</span>'+
                '<span class="gd-n">'+esc(b.name || "未命名铃声")+'</span>'+
                (other ? '<span class="hint gd-o">现在在「'+esc(other.name)+'」里</span>' : "")+
              '</label>';
            }).join("")
            : '<div class="hint" style="padding:16px 12px">'+(S.bells.length ? "没有匹配的铃声。" : "这张列表里还没有铃声。")+'</div>')+
          '</div>'+
          '<div class="hint" style="padding-top:10px">每条铃声只能添加到一个分组，'+
            '勾选其他分组中的铃声会将它从那个组中移动过来。</div>';

        /* 位置放回去，和上面记下来那两句配对（body 自己也可能在滚：列表 44vh
           封顶，窗口矮的时候外层还得再滚一道）。 */
        const fresh = body.querySelector("#gdList");
        if (fresh){ fresh.scrollTop = top; body.scrollTop = mtop; }

        /* 整组启停：落到的还是每一条铃声自己的开关上（见文件头那条规矩）。
           本地那份状态必须**先改再排队** —— 表格里那个单条开关就是这么写的
           （30-view-list.js 的「先改本地状态再排队」那段），原因也一样：
           报文里的 is_done 是 buildPayload(b) 读出来的，而分组这个点是照着
           b.isDone 算的 —— 不先改本地，排出去的还是老值，点也永远不动。 */
        const setAll = on => {
          let n = 0;
          mem.forEach(b=>{
            if (Number(b.isDone) === (on?1:0)) return;
            b.isDone = on ? 1 : 0;
            queueToggle(b, on); n++;
          });
          after();
          toast(n ? (on ? "已启用 " + n + " 条铃声" : "已停用 " + n + " 条铃声")
                  : "这些铃声本来就是" + (on ? "启用" : "停用") + "的", n ? "ok" : "");
        };
        const on2 = body.querySelector("#gdOn"), off2 = body.querySelector("#gdOff");
        if (on2)  on2.onclick  = ()=> setAll(true);
        if (off2) off2.onclick = ()=> setAll(false);

        /* 重画会把输入框换掉，光标得自己接回去 —— 不然打一个字掉一次焦点。 */
        const q2 = body.querySelector("#gdQ");
        q2.oninput = ()=>{
          q = q2.value; draw(false);
          const nq = body.querySelector("#gdQ");
          if (nq){ nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
        };

        $$("[data-k]", body).forEach(cb=>{
          cb.onchange = ()=>{
            grpAssign(listId, [cb.dataset.k], cb.checked ? g.id : null);
            after();
          };
        });
      };

      const after = ()=>{ renderMain(); draw(true); };

      draw(false);
      foot.innerHTML = '<span class="spacer"></span><button class="btn" id="gdDone">完成</button>';
      foot.querySelector("#gdDone").onclick = ()=> closeModal(mm.id);
    }
  });
}

/* ══ 批量改分组 ═════════════════════════════════════════════════════
   从多选那条路进来：勾了五条铃声，一次归到「午间」。 */
function openGrpBulk(bells){
  const listId = S.groupId;
  const keys = bells.map(bellKeyOf).filter(Boolean);
  const items = grpList(listId).map(g=>({
    icon: "", label: g.name,
    sub: "现在有 " + (g.bells||[]).length + " 条",
    onPick: ()=>{ grpAssign(listId, keys, g.id); done(keys.length + " 条铃声已归到「" + g.name + "」"); }
  }));
  items.push({icon:ICON.plus, label:"新建分组…", sub:"建一个新组，把这些铃声放进去",
              onPick: ()=> openGrpNew(keys)});
  items.push({icon:ICON.x, label:"移出分组", sub:"这些铃声不再属于任何分组",
              onPick: ()=>{ grpAssign(listId, keys, null); done(keys.length + " 条铃声已移出分组"); }});
  openBulkMenu("改分组 · " + keys.length + " 条铃声", "一条铃声只能在一个分组里，选新的会自动从原来的组移走", items);

  function done(msg){
    S.sel.clear(); renderMain(); toast(msg, "ok");
  }
}

function openGrpNew(keys){
  const listId = S.groupId;
  openModal({
    title:"新建分组", sub:"建好之后这些铃声就归在它下面", width:"420px",
    mount(body, foot, mm){
      body.innerHTML = '<div class="field"><label>分组名称</label>'+
        '<input class="input" id="gnName" maxlength="12" placeholder="例如「午间」"></div>'+
        '<div class="hint" style="padding-top:10px">名称最多 12 个字。</div>';
      const inp = body.querySelector("#gnName");
      setTimeout(()=> inp.focus(), 30);
      const go = ()=>{
        const v = inp.value.trim();
        if (!v){ markErr(body, inp.closest(".field")); toast("先起个名字"); inp.focus(); return; }
        if (grpList(listId).some(g=>g.name===v)){ markErr(body, inp.closest(".field")); toast("已经有同名分组了"); inp.focus(); return; }
        const g = {id:grpNewId(), name:v, bells:[]};
        grpSave(listId, grpList(listId).concat([g]));
        grpAssign(listId, keys, g.id);
        closeModal(mm.id);
        S.sel.clear(); renderMain();
        toast(keys.length + " 条铃声已归到「" + v + "」", "ok");
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
