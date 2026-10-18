/* device — 设备本身那几个字段的增删改（名称 / IP / 呼叫编码 / 三个音量）
   广播控制台 · 替代厂商后台的打铃配置面板
   //////////////////////////////////////////////////////////////
   入口全在 15-status.js 那张「终端管理」里：每行 IP 右边两枚按钮（铅笔 / 垃圾桶），
   表头那排页签右边两枚（刷新 / 添加设备）。这是面板里唯一会往 /terminals 写东西的
   地方 —— 别的文件对这台服务器一律只读。

   ── 报文形状是照着厂商前端抄的，没有一处是猜的 ────────────────────
   厂商前端那包在本地扒过一遍，设备管理页 / 编辑页在 chunk 37、41、17：

     单台详情  GET    /terminals/{id}?withDisabledTime=true&withGroups=true
               一条**平铺**记录。三个音量是**顶层**字段（default_volume /
               broadcast_volume / phone_volume，整数），呼叫编码也是**数字**。
               名册（/terminals/all）里**没有**这三个音量 —— 所以编辑面板必须
               按 id 单独拉一趟，这也是它存在的唯一理由。
     修改      PUT    /terminals/{id}
               厂商是把整条记录铺进表单、改完整条回传的：
               put("/terminals/"+ruleForm.id, {...ruleForm, other_config, disabled_time})。
               面板照抄这条 —— **整条原样回传、只换掉这 6 个字段**，才丢不了
               priority / relay_servers_id / shortcut_frequnce / shortcut_time /
               other_config / disabled_time 这些面板不显示、也不该被面板抹掉的字段。
     新增      POST   /terminals
               没有旧记录可回传，只能照厂商新建页那套初始值拼（下面的 DEV_BLANK）。
     删除      DELETE /terminals/{id}
               返回的 result 是**数字**，>0 才算真删掉了一条。

   ── 唯一性不在这儿查 ──────────────────────────────────────────────
   名称 / IP / 呼叫编码不能和别的设备重，这条规矩服务器自己会拦（厂商那边另发
   一趟 /validator 先问一遍，面板不重复这一趟）：重了它会退回来一句「已存在」，
   原位弹出来就是。同一条规矩写两处，早晚有一处是错的。
   ══════════════════════════════════════════════════════════════════ */

/* 新建时面板不显示的那几个字段，逐字照厂商新建页那份 ruleForm 抄（别自己省字段：
   那台服务器上 PUT/POST 是整条替换的语义，少发一个就等于把它抹了）。 */
const DEV_BLANK = {
  priority: 60, relay_servers_id: 0, shortcut_frequnce: 0, shortcut_time: 0, type: 1,
  other_config: {terminals_light_id:1, show_time_luminance:1, show_time_model:1,
                 open_time_interval:"", alarm:[], power:[], amplifier:[]},
  terminals: [], disabled_time: []
};
const DEV_VOL_MAX = 100;      /* 三个音量的上下限，厂商表单上是 min 0 / max 100 */

/* 写操作成没成，看服务器**回来的那个东西本身**，不看状态码：删除回的是数字
   （>0 才是删掉了一条），新增回的是新记录。api() 只在 HTTP 不 2xx 时抛，
   「200 但 result 是 0」这一类没做成又不报错的，全靠这一句兜住。 */
const devOk = r => typeof r === "number" ? r > 0 : !!r;

/* ══ 表单 ════════════════════════════════════════════════════════════
   编辑和添加共用这一份 HTML（字段完全一样，只有初值不同）。
   版式横竖屏是同一套，见 css 的 .dev-form —— 整张表单是**一张**网格：
     第一行 名称整行
     第二行 IP（吃两格）+ 呼叫编码（吃一格）
     第三行 默认 / 广播 / 对讲三个音量各一格
   三列等宽，所以 IP 那格和下面「默认 + 广播」两个音量的总宽**正好一样宽**，
   呼叫编码和「对讲音量」也是 —— 上下两行右边缘对得齐，没有错位。
   IP 和呼叫编码并排是有道理的：这两样都是从别处抄来的号码（IP 从机柜上抄、
   编码从厂商表里抄），改的时候多半是连着一起改；名称和音量是另一回事。
   ══════════════════════════════════════════════════════════════════ */
function deviceFormHTML(d){
  const vol = (id, lab, v)=> '<div class="field"><label>'+lab+'</label>'+
    '<input class="input mono" id="'+id+'" type="number" inputmode="numeric" min="0" max="'+DEV_VOL_MAX+'" value="'+esc(v==null?"":v)+'"></div>';
  return '<div class="grid3 dev-form">'+
      '<div class="field dev-name"><label>终端名称</label>'+
        '<input class="input" id="dvName" maxlength="60" value="'+esc(d.name||"")+'" placeholder="终端1"></div>'+
      '<div class="field dev-ip"><label>终端 IP</label>'+
        '<input class="input mono" id="dvIp" inputmode="numeric" value="'+esc(d.ip_address||"")+'" placeholder="192.168.1.100"></div>'+
      '<div class="field"><label>呼叫编码</label>'+
        '<input class="input mono" id="dvCode" inputmode="numeric" value="'+esc(d.call_code==null?"":d.call_code)+'" placeholder="留空即不设"></div>'+
      vol("dvVolDef", "默认音量", d.default_volume)+
      vol("dvVolBc",  "广播音量", d.broadcast_volume)+
      vol("dvVolPh",  "对讲音量", d.phone_volume)+
    '</div>';
}

/* 从表单里读回来。校验只做三条：名称非空、IP 看着像四段数字、音量夹进 0–100
   （夹而不报错：手抖打进 300 的，按 100 存下去比弹一句红字强）。
   呼叫编码服务器上存的是数字：纯数字发数字、清空了发空串、别的一律原样发。 */
function deviceFormRead(body){
  const val = s => { const el = $(s, body); return el ? el.value.trim() : ""; };
  const vol = s => {
    const n = Math.round(Number(val(s)));
    return isFinite(n) ? Math.max(0, Math.min(DEV_VOL_MAX, n)) : 0;
  };
  const name = val("#dvName"), ip = val("#dvIp"), code = val("#dvCode");
  if (!name){ markErr(body, $("#dvName", body).closest(".field")); return {err:"请填写终端名称"}; }
  if (!ip){ markErr(body, $("#dvIp", body).closest(".field")); return {err:"请填写终端 IP"}; }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)){
    markErr(body, $("#dvIp", body).closest(".field"));
    return {err:"终端 IP 要写成四段数字，例如 192.168.1.100"};
  }
  return {ok:{
    name, ip_address: ip,
    call_code: code === "" ? "" : (/^\d+$/.test(code) ? Number(code) : code),
    default_volume: vol("#dvVolDef"),
    broadcast_volume: vol("#dvVolBc"),
    phone_volume: vol("#dvVolPh")
  }};
}

/* ══ 重拉整份设备状态 ════════════════════════════════════════════════
   名册（GET /terminals/all）+ 在线状态，一起重来一份 —— 表头那枚「刷新」按钮和
   下面每次写完（增 / 删 / 改）走的都是这一条。在线状态那条是 WebSocket 推的，
   「重拉」就是照最初的握手报文再问一次（15-status.js 的 statSend）：服务器会把
   整份名单连状态一起重发一遍，新加的那台、刚改过名的那台，状态就都有了。

   名册拉不动时**留着手里那份旧的**：晚一步更新，总比整份抹成空的强。 */
async function reloadTerminals(){
  try{
    const r = await api("GET","/terminals/all",{params:{withGroups:"true"}});
    const rows = Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
    if (rows.length) S.data.terminals = rows;
  }catch(e){
    toast("设备名册刷新失败：" + e.message, "err");
  }
  if (statWS && statWS.readyState === 1) statSend(statWS);
  if (termListPaint) termListPaint();
  renderTopbar();          /* 顶栏那格读数按 S.termStat 数，删掉一台得跟着变 */
  renderMain();            /* 主界面上的执行区域、点位名也跟着这份名册走 */
}

/* 写完一轮统一走这儿。forget 是「这些名字从今往后不再是某台设备的名字」（改名时
   那个旧名、被删掉的那台）—— 在线状态是按**名字**记的（S.termStat 的键，推送
   报文里也只有 EndpointName），不清掉的话，顶栏那格读数会把一台已经不存在的
   设备一直算在里头。 */
async function afterDeviceWrite(forget){
  (forget||[]).forEach(n=>{ if (n){ delete S.termStat[n]; delete S.termTask[n]; } });
  await reloadTerminals();
}

/* ══ 改一台 ══════════════════════════════════════════════════════════
   先把名册里那条的名字当标题画出来，正文先占一句「正在读取」—— 单台详情要等
   一趟请求，空框愣着不如先说一声自己在干什么。 */
function openDeviceEditor(id){
  const row = S.data.terminals.find(t=> Number(t.id) === Number(id));
  openModal({
    title: "编辑设备",
    sub: (row && row.name) || ("设备 " + id),
    /* 480px：**比「终端管理」那份名册（560px）窄**（用户定的）。这份表单统共
       七个字段，620px 那会儿三列各占两百多像素，一个 IP 填进去右边空着半格，
       框子显得虚。480 折下来每列 137px，最长的一格（终端 IP，吃两列）288px，
       装 "192.168.1.100" 这种满格还富余一半。 */
    width: "480px",
    mount(body, foot, mm){
      body.innerHTML = '<div class="hint" style="padding:20px 4px">正在读取设备信息…</div>';
      foot.innerHTML = '<span class="spacer"></span><button class="btn" data-cancel>取消</button>'+
                       '<button class="btn btn-primary" data-save disabled>确定</button>';
      foot.querySelector("[data-cancel]").onclick = ()=> closeModal(mm.id);
      const save = foot.querySelector("[data-save]");
      let rec = null;                       /* 服务器上这条现在长什么样，保存时整条回传 */

      api("GET","/terminals/"+id,{params:{withDisabledTime:"true",withGroups:"true"}})
        .then(r=>{
          if (!body.isConnected) return;    /* 框已经关了，别往里头写 */
          rec = (r && typeof r === "object") ? r : null;
          if (!rec){
            body.innerHTML = '<div class="hint" style="color:var(--crit)">没读到这台设备的信息。</div>';
            return;
          }
          body.innerHTML = deviceFormHTML(rec);
          save.disabled = false;
        })
        .catch(e=>{
          if (!body.isConnected) return;
          body.innerHTML = '<div class="hint" style="color:var(--crit)">读取失败：'+esc(e.message)+'</div>';
        });

      save.onclick = async ()=>{
        if (!rec) return;
        const got = deviceFormRead(body);
        if (got.err){ toast(got.err, "err"); return; }
        const payload = Object.assign({}, rec, got.ok);   /* 整条原样回传，只换这 6 个字段 */
        /* 「免打扰时段」这台设备上没有的话，GET 就不再吐这个键了（实测如此），
           而厂商那边无论如何都会发一个 `disabled_time: []` 上去 —— 补成一样的，
           免得服务器把那一位当成「整条替换里少了它」而清掉什么。 */
        if (payload.disabled_time === undefined) payload.disabled_time = [];
        const bz = busyOn(); save.disabled = true;
        try{
          const r = await api("PUT","/terminals/"+id,{body:payload});
          if (!devOk(r)){ toast("保存失败：服务器没有确认这一笔", "err"); save.disabled = false; return; }
          closeModal(mm.id);
          afterDeviceWrite(got.ok.name === rec.name ? null : [rec.name]);
        }catch(e){
          toast("保存失败：" + e.message, "err");
          save.disabled = false;
        }finally{ busyOff(bz); }
      };
    }
  });
}

/* ══ 添加一台 ════════════════════════════════════════════════════════ */
function openDeviceAdd(){
  openModal({
    title: "添加设备",
    sub: "新增一台终端 · 类型按「通用终端」建",
    width: "480px",          /* 和「编辑设备」同一个表单，宽度也跟着它 */
    mount(body, foot, mm){
      body.innerHTML = deviceFormHTML({default_volume:45, broadcast_volume:60, phone_volume:60});
      foot.innerHTML = '<span class="spacer"></span><button class="btn" data-cancel>取消</button>'+
                       '<button class="btn btn-primary" data-ok>添加</button>';
      foot.querySelector("[data-cancel]").onclick = ()=> closeModal(mm.id);
      const okBtn = foot.querySelector("[data-ok]");

      okBtn.onclick = async ()=>{
        const got = deviceFormRead(body);
        if (got.err){ toast(got.err, "err"); return; }
        const bz = busyOn(); okBtn.disabled = true;
        try{
          const r = await api("POST","/terminals",{body:Object.assign({}, DEV_BLANK, got.ok)});
          if (!devOk(r)){ toast("添加失败：服务器没有确认这一笔", "err"); okBtn.disabled = false; return; }
          closeModal(mm.id);
          /* 新加的那台在名册里就有了，不用 forget 谁 —— 但新设备重名顶掉旧设备
             这种事不存在：重名服务器不给建。 */
          afterDeviceWrite(null);
        }catch(e){
          toast("添加失败：" + e.message, "err");
          okBtn.disabled = false;
        }finally{ busyOff(bz); }
      };
    }
  });
}

/* ══ 删一台 ══════════════════════════════════════════════════════════
   先问一句（红按钮），确认之后才发报文。就这么一个写操作是不可逆的。 */
function deleteDevice(id, name){
  openConfirm("删除设备「"+name+"」",
    "这会在广播服务器上把这台设备删掉，不可撤销。设备上挂着的铃声与任务会失去这台终端。",
    async ()=>{
      const bz = busyOn();
      try{
        const r = await api("DELETE","/terminals/"+id);
        if (!devOk(r)){ toast("删除失败：服务器没有确认这一笔", "err"); return; }
        await afterDeviceWrite([name]);
      }catch(e){
        toast("删除失败：" + e.message, "err");
      }finally{ busyOff(bz); }
    }, "确认删除", true);
}
