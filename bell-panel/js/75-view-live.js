/* view-live — 实时对讲 / 在线播放
   广播控制台 · 替代厂商后台的打铃配置面板
   //////////////////////////////////////////////////////////////
   「实时对讲」这一页做的是**拨号对讲**：挑一个终端或分组，说进去，那边出声。
   两种挑法，顶上那个小页签切换：

     拨号呼叫 —— 仿手机拨号盘。号码框上面一行写着这个号码**对得上谁**，
                 下面 3 列 5 行：123 / 456 / 789 / 清空·0·退格，第五行是那三个键
                 （挂断 · 暂停 · 呼叫）。号码就是终端或分组的**呼叫编码**，
                 厂商后台里给每台设备／每个分组设的那个数。**一个号码只呼一个
                 终端**（用户定的）：号码拿整个串去严格匹配，`1101` 只认 1101，
                 不会顺手把 110 也捞进来。要一次喊好几个走「直接呼叫」那一页。
     直接呼叫 —— 选择器**直接摊在页面上**（可多选，点位和分组**可以混着选**），
                 下面同样是那三个键。原来那版是个按钮，点一下才弹出「执行区域」
                 那个模态；挑终端本来就是这一页唯一要做的事，隔一层弹窗就多一次
                 点击，而且弹窗把底下三个键盖住了 —— 挑完还得先关框再按「呼叫」。

   「在线播放」目前**只立了一块牌子**：以后放的是「传一个音频文件上去、
   挑好终端、实时播出来」，页面还没做。

   ── 这一版到哪儿为止 ──────────────────────────────────────────────
   页面这一半是齐的：挑目标、按呼叫、抓麦克风、把 PCM 一帧帧送出去。
   浏览器里没有原始套接字 —— 音频那条推流是 UDP（16k／16 位／单声道 PCM，
   每 10ms 一个 320 字节的包），得有个本地进程代发；而且音频口和控制口都是明文的，
   面板挂 https 时连 `ws://` 都出不去。
   那一半是仓库里的 `play-agent/`，**装在打铃服务器那台机器上**（手机跑不了它），
   网页从局域网连过去说那三种命令。代理在哪台机器、哪个端口由设置页说了算，
   见 00-core.js 的 agentURL()。
   代理没起来，点「呼叫」就是一句「播放代理连接失败!」——
   不是页面坏了，是那台机器上的代理没跑。 */

/* ══ 这个页面能不能真对讲 ═══════════════════════════════════════════
   浏览器只在**安全上下文**里交出麦克风：https、本地回环（localhost / 127.0.0.1）、
   以及直接打开的 file://。面板要是从 http://192.168.1.100:81 这种明文局域网地址
   打开，navigator.mediaDevices 本身就是 undefined —— 页面长得再全也拿不到麦克风，
   按「呼叫」必然失败。那就**干脆不摆这个入口**（用户定的）：摆一个按下去注定
   不成的页签，比不摆更糟。

   问的就是浏览器自己那两个答案，**不自己拼主机名名单**（拼一百条也拼不全
   `[::1]`、`*.localhost`、企业策略这些边角）：
     · isSecureContext —— 规范定义的那一条，https / file: / localhost 都算安全；
     · mediaDevices.getUserMedia —— 真正要用的那样东西在不在。
   两样都齐才算数。

   它同时管着两个入口（顶栏那排页签、竖屏那条导航栏）和启动时的记忆恢复
   —— 见 30-view-list.js 的 renderTopbar／renderNavbar 与 90-boot.js 里
   `S.mode = lastMode` 那一句。 */
function liveUsable(){
  return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/* ══ 状态 ═══════════════════════════════════════════════════════════
   和这一页的所有状态一样存在 S.dt.live 里，不存 DOM：代理回来的那条消息
   会把整页重画一次（renderMain），塞在节点里的东西那一下就冲没了。 */
function liveState(){
  if (!S.dt.live) S.dt.live = {
    tab  : "dial",              /* "dial" 拨号呼叫 | "direct" 直接呼叫 */
    num  : "",                  /* 拨号台上敲出来的号码 */
    area : {t:[], g:[]},        /* 直接呼叫选中的点位名／分组名，和别处一个形状 */
    aTab : "term",              /* 选择器正在看哪一页："term" 终端点位 | "group" 分组 */
    aQ   : "",                  /* 点位那页的搜索词 */
    aGroup: "all",              /* 点位那页的分组筛选，值是分组 id */
    phase: "idle",              /* idle 没在呼 | calling 呼叫中 | talking 已接通 */
    muted: false,               /* 接通之后的「暂停」：对方听不到，链路还挂着 */
    err  : ""                   /* 上一次没做成的一句话，摆在号码下面 */
  };
  return S.dt.live;
}

/* 号码最长敲这么多位。真机上最长的呼叫编码是四位（1101、1103 这样的），
   留到十二位是给「以后编码规则变了」—— 再长号码行就该挤了，到这儿为止。 */
const LIVE_NUM_MAX = 12;

/* ══ 号码 → 目标 ═════════════════════════════════════════════════════
   呼叫编码在服务器上是个数字，**没设的存 0 不是 null** —— 0 得当「没设」看，
   不然一个空编码会把所有没设编码的设备一起匹配上。 */
function liveCodeOf(x){
  const c = String(x && x.call_code == null ? "" : x.call_code).trim();
  return (c === "" || c === "0") ? "" : c;
}
/* 编码在终端和分组两张表之间**全局唯一**（厂商那边的校验规则就是 call_code 要
   同时 unique 于 terminals 和 terminals_groups），所以敲出来的号码最多只对得上
   一个；万一真撞上了，终端优先 —— 那是更具体的那一个。
   数据就在本机名册里（/terminals/all 和 /terminals-groups/all 都带着 call_code，
   面板启动时已经拉过），所以拨号是**纯本地查询**，不碰服务器。 */
function liveByCode(code){
  if (!code) return null;
  const t = S.data.terminals.find(x => liveCodeOf(x) === code);
  /* 这一格是给号码框上面那行用的（`终端 · 高301-小报告厅`）。**写「终端」不写
     「点位」**（用户定的）：这一行说的是「你要找的是谁」，名册上的物件按界面
     上其它地方的说法就是终端和分组两样，而「点位」是那一堆设备的统称
     —— 统称放在具体某一个前面，读起来像在念分类目录。 */
  if (t) return {kind:"终端", id:t.id, name:t.name};
  const g = S.data.termGroups.find(x => liveCodeOf(x) === code);
  if (g) return {kind:"分组", id:g.id, name:g.name};
  return null;
}

/* ══ 直接呼叫：选中的点位／分组 → 要发的终端 id ═══════════════════════
   分组在本机展开成组里的人再发。抓包里那条 EndPointsList 就是一个终端 id
   （"159"），分组能不能直接塞进去还没验过（要再抓一次以分组为目标的包才
   知道），本机展开是稳的那条路。 */
function liveAreaIds(a){
  const ids = [];
  const add = n => { const t = S.data.terminals.find(x=>x.name===n); if (t) ids.push(t.id); };
  (a.t||[]).forEach(add);
  (a.g||[]).forEach(n => groupMembers(n).forEach(add));
  return uniq(ids);
}
/* 「选没选东西」是选择器外面那行副标题用的（"还没有选终端" / "选中的分组里没有目标"）。
   「选了哪几个」不再需要一句话去概括 —— 选择器就摊在旁边，勾着的那几行自己会说话。 */
const liveChosen = a => !!((a && a.t && a.t.length) || (a && a.g && a.g.length));

/* 这一页现在要呼叫谁 —— null 就是还没有目标，呼叫键按不动。

   两种情况返回 null：没输号码，以及**这个编码在本机名册里对不上**。
   对不上就不呼（用户定的）：这是会往外面真出声的操作，宁可按不动，
   也不能按下去没反应或者呼错人。 */
function liveTarget(){
  const st = liveState();
  if (st.tab === "dial"){
    const hit = st.num ? liveByCode(st.num) : null;
    if (!hit) return null;
    return {ids:[hit.id], names:[hit.name]};
  }
  const ids = liveAreaIds(st.area);
  if (!ids.length) return null;
  return {ids:ids, names:(st.area.t||[]).concat(st.area.g||[])};
}

/* ══ 播放代理（内部一直管它叫「桥接」）═══════════════════════════════
   一条长连接，一问一答：每条命令带个 id 发出去，代理回来的那条带同一个 id。
   **内部文案和面向用户的文案是两套名字**：代码注释、Error 的 message 里一律
   叫「桥接」（说的是这东西是什么），而屏幕上给操作员看的那一句叫「播放代理」
   （说的是它替他干什么）—— 见 liveCall 里那句「播放代理连接失败!」。
   超时就把这次判失败 —— 不然按下去没反应、也退不回来。

   桥接那头就是仓库里的 `play-agent/`。协议三句命令加一路二进制：
     {cmd:"call",   data:{ws, udp, token, endpoints:["id"…], names:[…]}} 呼叫
                    endpoints 是**字符串**数组，数字要转（代理那边是 []string）
     {cmd:"mute",   data:{on:true|false}}                               暂停／继续
     {cmd:"hangup", data:{}}                                            挂断
     二进制帧 = 麦克风 PCM（16k／16 位／小端／单声道）
   回 {id, ok:true} 或 {id, ok:false, message:"…"}。

   **服务器地址、JWT、目标终端都在这儿递给代理**，所以代理自己没有配置文件、
   不存口令 —— 它只是「把网页给的东西转交给打铃服务器」。

   代理在哪（地址 / 端口）是设置页里填的，见 00-core.js 的 agentURL()：留空就是
   本机 127.0.0.1、端口 8181；代理装在别处才填地址。**每次连接现算一次**，
   在设置页改完不用刷新页面，下次「呼叫」就按新的连。 */
let liveSock = null;
let liveSockWait = null;      /* 正在连的那一次，连完（成或败）就丢 */
let liveSeq = 0;

function liveConnect(){
  if (liveSock && liveSock.readyState === 1) return Promise.resolve(liveSock);
  if (liveSockWait) return liveSockWait;
  /* 地址现在总算得出来（留空 = 127.0.0.1），这一句留着只是兜个万一。
     **在 liveSockWait 赋值之前就返回**：不然这个失败的 promise 会被当成
     「正在连的那一次」缓存下来，等人在设置页把地址改好了，这儿还拿着旧的那条拒绝不放。 */
  const url = agentURL();
  if (!url) return Promise.reject(new Error("不知道播放代理在哪"));
  let s;
  try { s = new WebSocket(url); }
  catch(e){ return Promise.reject(new Error("桥接地址打不开")); }
  liveSockWait = new Promise((res, rej)=>{
    const t = setTimeout(()=>{
      try { s.close(); } catch(e){}
      liveSockWait = null; rej(new Error("连不上本地桥接"));
    }, 2500);
    s.onopen = ()=>{ clearTimeout(t); liveSock = s; liveSockWait = null; res(s); };
    s.onerror = ()=>{ clearTimeout(t); liveSockWait = null; rej(new Error("连不上本地桥接")); };
    s.onclose = ()=>{
      if (liveSock === s) liveSock = null;
      /* 代理那头没了就别再攥着麦克风 —— 已经不往外送了，浏览器地址栏那个
         「正在录音」的标记没有理由还亮着。 */
      /* **状态也得跟着走。** 代理那边一收到客户端断开就把任务撤了（play-agent 的
         ag.serve），所以这条长连接一断，两条会话就都不成立了。原来这儿只关麦克风、
         phase 留在 talking —— 页面于是一直写着「已接通 · 正在对讲」，顶栏底下那枚
         胶囊（见 syncSessionBadge）也会一直挂着说「正在通话中」，人按「挂断」还会
         撞一句「桥接没有回应」。 */
      const lv = liveState();
      if (lv.phase === "calling" || lv.phase === "talking"){
        lv.phase = "idle"; lv.muted = false; lv.busy = false;
        lv.err = "与播放代理的连接已断开";
        liveMicStop();
      }
      /* 播放那一头同理：本地这条音频链路得收掉（它的 hangup 已经发不出去了），
         回到播放页时才不会看见一个还在走的进度条。 */
      const pl = playState();
      if (pl.phase === "connecting" || pl.phase === "playing" || pl.phase === "paused"){
        pl.busy = false; pl.phase = "idle"; pl.pos = 0;
        pl.err = "与播放代理的连接已断开";
        playTeardown(false);
      }
      /* 终端测试也一样：连接没了，本机还在放就只是白响。
         这条路上**不能再发 hangup** —— 连接刚断，发它等于又去重连一次。 */
      if (moreTestRunning()){
        moreTestState().err = "与播放代理的连接已断开";
        moreTestStop(true, true);
      }
      renderMain();
    };
  });
  return liveSockWait;
}
function liveRequest(cmd, data){
  return liveConnect().then(s => new Promise((res, rej)=>{
    const id = ++liveSeq;
    const h = ev => {
      let m; try { m = JSON.parse(ev.data); } catch(e){ return; }
      if (!m || m.id !== id) return;
      clearTimeout(t); s.removeEventListener("message", h);
      m.ok ? res(m) : rej(new Error(m.message || "桥接没做成这件事"));
    };
    const t = setTimeout(()=>{
      s.removeEventListener("message", h);
      rej(new Error("桥接没有回应"));
    }, 8000);
    s.addEventListener("message", h);
    s.send(JSON.stringify({cmd:cmd, id:id, data:data||{}}));
  }));
}

/* ══ 麦克风 ═════════════════════════════════════════════════════════
   这片是「网页这一半」的全部：把麦克风抓成 16k / 16 位 / 小端 / 单声道的
   PCM，一帧帧丢给播放代理；代理那头套上 20 字节的头，UDP 发到打铃服务器。

   **重采样交给浏览器。** 建 AudioContext 时直接写 {sampleRate:16000}，
   它自己会把设备那档（通常 48k）重采样成 16k 再喂给 worklet。自己写重采样器
   要处理 48k / 44.1k 两档、还要防混叠 —— 那是几百行，而这里只要一个参数。

   **worklet 用 data: URL 装。** AudioWorklet 的模块得是一份单独的 URL，
   而面板是几个 .js 直接摆着的，没有打包器，为这个再立一个文件不值当。
   拼成字符串现做一份就行 —— 但**只能是 data:，不能是 Blob URL**，理由见
   liveWorkletURL() 上头那段。

   **首选 AudioWorklet，ScriptProcessorNode 只当退路**：前者跑在音频线程上，
   标签页切到后台也照常出帧。但它是 [SecureContext] 的，明文 http 下整个不存在 ——
   那时候只能退到后者（见 playCtxMake），功能先得有。 */
const LIVE_WORKLET_SRC = [
  'class Pcm16 extends AudioWorkletProcessor {',
  '  process(inputs){',
  '    const ch = inputs[0] && inputs[0][0];',
  '    if (!ch || !ch.length) return true;',
  '    const out = new Int16Array(ch.length);',
  '    for (let i = 0; i < ch.length; i++){',
  '      let v = ch[i];',
  '      v = v < -1 ? -1 : v > 1 ? 1 : v;',
  '      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;',
  '    }',
  '    this.port.postMessage(out, [out.buffer]);',
  '    return true;',
  '  }',
  '}',
  'registerProcessor("pcm16", Pcm16);'
].join("\n");

/* 那份 worklet 模块的 URL。**必须是 data:，绝不能用 Blob URL** ——
   面板是按 README 那样「双击 index.html」用的，那时页面的 origin 是 null，
   `URL.createObjectURL(new Blob([...]))` 做出来就是 `blob:null/<uuid>`，
   而浏览器不给 null origin 的 blob 加载 worklet 模块，addModule 当场拒绝：

     AbortError: Failed to load worklet module script: blob:null/… (a dependency
     or cross-origin script failed to load)

   （2026-10-17 用户报的。它坑在两处：对讲是**麦克风都拿到了**、浏览器的录音指示灯
   都亮了，面板却写「拿不到麦克风」；在线播放那边则一律是「本机音频起不来」。
   两条路都栽在同一个 URL 上，跟浏览器无关，换浏览器没用。）
   `data:` 两边都认：实测同一份源，file:// 下 blob 挂、data: 过；
   http://127.0.0.1 下两种都过。所以统一走 data:，不留分支。
   用百分号编码而不是 base64：源现在是纯 ASCII 也一样编得对，
   将来往里加一句中文注释也不会在 btoa 上炸掉。 */
function liveWorkletURL(){
  return "data:application/javascript;charset=utf-8," + encodeURIComponent(LIVE_WORKLET_SRC);
}

/* 对讲音频口。**这不是问出来的** —— /language 只给 webSocketIp（51330），
   51340 在 REST 里任何地方都没有。它和 WS 口差 10，但别照着这个规律去猜，
   就写死；哪天换了服务器只改这一行。 */
const LIVE_AUDIO_PORT = 51340;

let liveCtx = null, liveStream = null, liveNode = null, liveSrc = null, liveSink = null;
let liveCtxKick = 0;   /* 把被打断的音频上下文拉回来的重试计时器，见 liveMicStart */
let liveChimeBusyUntil = 0;  /* 提示音要响到什么时候，期间不按拨号音，见 liveChime */
let liveChimeStartTimer = 0; /* 等采集单元让干净的预延时，见 liveChime */
let liveChimeWakeTimer = 0;  /* 放完把麦克风接回来的计时器，见 liveChime */

/* 音频往哪台机器发：主机名跟着面板用的那台广播服务器走（S.wsIp 是 /language
   给的，没有就退到 S.server），端口写死。 */
function liveAudioTarget(){
  const raw = S.wsIp || S.server || "";
  const h = String(raw).replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
  return h ? h + ":" + LIVE_AUDIO_PORT : "";
}

async function liveMicStart(){
  if (liveCtx) return;
  const stream = await navigator.mediaDevices.getUserMedia({audio:{
    channelCount: 1,
    /* 这三样统统关掉：对讲要的是现场原声，不是一路被修过的语音。
       echoCancellation 尤其要关 —— 它会把「自己刚放出来的声音」当成回声削掉，
       而这里是广播，削错了就是整句话变调。 */
    echoCancellation: false, noiseSuppression: false, autoGainControl: false
  }});
  const ctx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:16000});
  await ctx.audioWorklet.addModule(liveWorkletURL());

  const node = new AudioWorkletNode(ctx, "pcm16");
  const src = ctx.createMediaStreamSource(stream);
  /* worklet 得挂在一条通到 destination 的链子上才会被拉 —— 光有输入不接出去，
     浏览器有权不跑它。中间那枚 gain 拧到 0：**不然麦克风的声音会从这台机器的
     喇叭里放出来，当场啸叫。** 这只耳朵是我们的，不给人听。 */
  const sink = ctx.createGain();
  sink.gain.value = 0;
  src.connect(node); node.connect(sink); sink.connect(ctx.destination);
  if (ctx.state === "suspended") { try { await ctx.resume(); } catch(e){} }

  /* iOS 上这个上下文会被「系统打断」停住（来电、别的 App 抢音频会话）。
     停住以后 worklet 不再出帧，表现就是**接通以后怎么说对面都没声音**，
     而且不会自己好（用户实测）。statechange 先拉一次，再挂个低频重试兜底 ——
     打断结束时 resume() 能把它接回来。'closed' 是我们自己收的，别再拉。
     **提示音期间不会有这个上下文**：放之前就整个关掉了，见 liveChime。 */
  const kick = ()=>{
    if (ctx.state === "running" || ctx.state === "closed") return;
    try { ctx.resume().catch(()=>{}); } catch(e){}
  };
  ctx.addEventListener("statechange", kick);
  liveCtxKick = setInterval(kick, 1000);

  /* 一帧一发。攒成整 320 字节是**代理的事**（它那头本来就有个 320 的缓冲），
     这边多发几个零头没关系 —— 硬凑整反而要在两次回调之间存半个包。 */
  node.port.onmessage = e => {
    const st = liveState();
    if (st.phase !== "talking") return;
    if (!liveSock || liveSock.readyState !== 1) return;
    try { liveSock.send(e.data); } catch(err){}
  };

  liveCtx = ctx; liveStream = stream; liveNode = node; liveSrc = src; liveSink = sink;
}

function liveMicStop(){
  if (liveNode) { try { liveNode.port.onmessage = null; } catch(e){} }
  if (liveSrc)  { try { liveSrc.disconnect(); } catch(e){} }
  if (liveNode) { try { liveNode.disconnect(); } catch(e){} }
  if (liveSink) { try { liveSink.disconnect(); } catch(e){} }
  /* 轨道要真的 stop()，光关 AudioContext 有时候留着那个录音标记。 */
  if (liveStream) liveStream.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
  clearInterval(liveCtxKick); liveCtxKick = 0;
  clearTimeout(liveChimeWakeTimer); liveChimeWakeTimer = 0;
  if (liveCtx) { try { liveCtx.close(); } catch(e){} }
  liveCtx = liveStream = liveNode = liveSrc = liveSink = null;
}

/* ══ 三个动作 ═══════════════════════════════════════════════════════ */
/* 开这一路任务之前先确认「往哪台机器发」这件事有着落。拿不到就别往下走 ——
   不然这一趟会以「连接播放代理失败」收场，而真正的问题在服务器地址上，
   那句话会把人指错方向。返回空串＝拿到了，否则返回一句给人看的话。
   （对讲和在线播放共用：两边都要往同一个代理递同一个地址。） */
async function liveEnsureAddr(){
  /* 对讲地址是 /language 给的（跟终端状态那条连接同一个字段），面板开着的时候
     一般早有了；万一那次没拿到就现问一次。 */
  if (!S.wsIp){
    try { const l = await api("GET","/language"); S.wsIp = l && l.webSocketIp; setSrvVersion(l); }
    catch(e){}
  }
  if (!S.wsIp || !liveAudioTarget()) return "拿不到广播服务器地址";
  return "";
}

/* 接通／暂停／恢复／挂断的提示音。四个 wav 在 res/ 里，按相对路径找 —— 面板是从 file://
   或同一个静态目录打开的，跟 index.html 走。**只顾着响，不顾别的**：现建一个
   Audio 元素放一次就丢，不等它加载、不管放没放成（网速不好、文件不在、浏览器
   不让自动播，都只当没这回事），也绝不把拒绝的 Promise 漏出去带歪调用方 ——
   提示音迟到或没响，都不能拖住呼叫／挂断本身。

   **App 里提示音和麦克风不能共存。** 真机上只要 WebKit 的采集单元还活着，
   提示音放到 0.3 秒左右必被系统掐断 —— 原生 AVAudioPlayer、<audio>、Web Audio
   三种放法都一样（用户逐个实测）。所以放之前先把麦克风**整个**关掉（轨道
   stop + 上下文 close），留 300ms 让系统那头让干净再放；放完按需要接回来：
   呼叫／暂停／恢复时通话还在，接；挂断就让它一直关着。 */
function nativeCmd(){
  const h = window.webkit && window.webkit.messageHandlers;
  return (window.__ITC_NATIVE_AGENT && h && h.itcAgentCmd) ? h.itcAgentCmd : null;
}

function liveChime(name, onFail){
  /* 设置页「在线对讲」里那个开关，默认开。 */
  if (!S.chime) return null;
  /* App 里走原生播放。WKWebView 的 Audio 偶尔会整条哑掉 —— 音频会话被
     系统打断、或者 WebKit 收完麦克风把会话 setActive(false) 了，之后 new
     Audio 照样不报错，就是一声不响，退 App 重开才恢复（用户实测）。原生
     AVAudioPlayer 每次播之前都会把会话重新激活，不靠网页这一层。 */
  const native = nativeCmd();
  if (native){
    clearTimeout(liveChimeStartTimer); liveChimeStartTimer = 0;
    clearTimeout(liveChimeWakeTimer); liveChimeWakeTimer = 0;
    liveChimeBusyUntil = performance.now() + 3000;   /* 回执来之前先按最长兜底 */
    if (liveCtx) liveMicStop();

    const arm = ms => {
      clearTimeout(liveChimeWakeTimer);
      liveChimeBusyUntil = performance.now() + ms + 250;
      liveChimeWakeTimer = setTimeout(()=>{
        liveChimeWakeTimer = 0;
        liveChimeBusyUntil = 0;
        const st = liveState();
        /* 挂断请求还没走完（busy）就别接 —— 这一通已经要结束了。 */
        if (liveCtx || st.phase !== "talking" || st.busy) return;
        liveMicStart().catch(e=>{
          st.err = "拿不到麦克风：" + ((e && e.name === "NotAllowedError") ? "浏览器没给权限"
                  : (e && e.message) || "打不开");
          renderMain();
        });
      }, ms + 250);
    };

    liveChimeStartTimer = setTimeout(()=>{
      liveChimeStartTimer = 0;
      let p;
      try { p = native.postMessage({cmd:"chime", id:0, data:{name:name}}); }
      catch(e){ liveChimeBusyUntil = 0; return; }
      if (p && p.catch) p.catch(()=>{ try { onFail && onFail(); } catch(e){} });
      if (p && typeof p.then === "function"){
        p.then(rep=>{
          if (rep && rep.ok && rep.durationMs > 0) arm(rep.durationMs);
          else arm(0);   /* 没放成：马上把麦克风接回来 */
        }).catch(()=>{ arm(0); });
      } else {
        arm(1400);       /* 没有回执：按最长的一条兜底 */
      }
    }, 300);   /* 轨道 stop() 只是递了话，系统那头还要几百毫秒才真让开 */
    return true;
  }
  try{
    const a = new Audio("res/" + name + ".wav");
    a.preload = "auto";
    const p = a.play();
    if (p && p.catch) p.catch(()=>{ try { onFail && onFail(); } catch(e){} });
    return a;
  }catch(e){ return null; }
}

async function liveCall(){
  const st = liveState();
  if (st.busy || st.phase !== "idle") return;
  /* 「更多功能 → 终端测试」也占着代理那一条会话，先让它停。 */
  if (moreTestRunning()){
    st.err = "正在测试中，先停止测试";
    renderMain();
    return;
  }
  /* 代理那头**同一时刻只有一条会话**（ag.audio 就一个字段）：播放着的时候再按
     「呼叫」，它会静悄悄把播放那条任务换成麦克风这一条，而面板这边还写着
     「正在播放」。所以这一下先挡住，把原因明说在话筒底下那行（liveTipHTML）。 */
  const pl = playState();
  if (pl.phase === "connecting" || pl.phase === "playing" || pl.phase === "paused"){
    st.err = "在线播放正在运行，先停掉再呼叫";
    renderMain();
    return;
  }
  const tgt = liveTarget();
  if (!tgt) return;
  st.busy = true; st.err = ""; st.phase = "calling"; renderMain();

  const noAddr = await liveEnsureAddr();
  if (noAddr){
    st.phase = "idle"; st.busy = false;
    st.err = noAddr;
    renderMain();
    return;
  }

  /* 先把麦克风拿到手。**放在建任务之前**：这一步弹权限框，也是唯一一件会
     失败在人身上的事；人要是点了「不允许」，就不该去服务器上开一路任务。 */
  let micFail = "";
  try {
    await liveMicStart();
  } catch(e){
    micFail = (e && e.name === "NotAllowedError") ? "浏览器没给权限"
            : (e && e.message) || "打不开";
  }
  if (micFail){
    liveMicStop();
    st.phase = "idle"; st.busy = false;
    st.err = "拿不到麦克风：" + micFail;
    renderMain();
    return;
  }

  try {
    /* 桥接回 ok 才算接通 —— 它报的是「服务器收下了这条任务」，人这时候
       才能开口。地址、令牌、目标全在这一句里递给代理：代理本身零配置，
       口令那类东西一个字节都不落它的盘。 */
    await liveRequest("call", {
      ws: S.wsIp, udp: liveAudioTarget(), token: S.token,
      /* **必须转成字符串**：代理那边 endpoints 是 []string，名册里的 id 是数字，
         原样发过去它在解码那一步就死了（"cannot unmarshal number into Go struct
         field .endpoints of type string"），连打铃服务器都还没连上。 */
      endpoints: tgt.ids.map(String), names: tgt.names
    });
    st.phase = "talking";
    liveChime("call");
  } catch(e){
    liveMicStop();
    st.phase = "idle";
    /* 用户定的文案：就是这一句，**不把 e.message 拼在前头**。底下那几句
       （「连不上本地桥接」「桥接地址打不开」「桥接没有回应」）说的是同一条
       长连接的同一个死法，逐个念出来对操作员没有分别 —— 能做的事只有一件：
       去看那台机器上的代理起没起。拼上去反而把重点冲淡了。
       这句话显示在话筒底下那行（liveTipHTML），不在号码框上面。 */
    st.err = "连接播放代理失败!";
  }
  st.busy = false; renderMain();
}
async function livePause(){
  const st = liveState();
  if (st.phase !== "talking" || st.busy) return;
  /* 响哪一声跟这一下按下去的效果对应：正说着 → 停（pause），正停着 → 续（resume）。 */
  liveChime(st.muted ? "resume" : "pause");
  st.busy = true; st.err = ""; renderMain();
  try {
    await liveRequest("mute", {on: !st.muted});
    st.muted = !st.muted;
  } catch(e){ st.err = e.message; }
  st.busy = false; renderMain();
}
async function liveHangup(){
  const st = liveState();
  if (st.phase !== "talking" || st.busy) return;
  /* 提示音在这一下就放，不等请求走完 —— 人按了挂断，耳朵里该立刻有个回应；
     请求成不成都不影响它已经要结束了（下面无论成败都收麦克风、回 idle）。 */
  liveChime("finish");
  st.busy = true; st.err = ""; renderMain();
  try {
    await liveRequest("hangup", {});
    st.phase = "idle"; st.muted = false;
  } catch(e){ st.err = e.message; }
  /* **不管挂断成没成都把麦克风关掉。** 代理那边没应，人这边照样得退出对讲 ——
     麦克风是浏览器的，我们能关；服务器上那条任务留着最多是一路静音。 */
  liveMicStop();
  /* 挂断后把号码抹掉（用户定的）：这通已经结束，框里不该还留着它；
     切页和切换「拨号／直接呼叫」都不清，只有挂断（和手动清空）才清。 */
  st.num = "";
  st.busy = false; renderMain();
}

/* ══ 号码上面那行：这个号码对得上谁 ═════════════════════════════════
   敲号码时最该实时看见的一件事，所以它摆在号码框**上面**（用户定的），
   眼睛不用在框和键盘之间来回跑。

   它是**常驻的一行**：永远不折行，长了在尾巴上省略、全文进 title。

   **它只管查号这一件事**（用户定的）。出错的那些话（拿不到麦克风、桥接连不上、
   任务没做成）原来也塞在这一行里，现在全归话筒底下那行（liveTipHTML）——
   那一行是常驻的，够用；而且「这一下为什么没成」本来就是通话状态的一部分。
   一行字说一件事，出错时也不会上下两处各说一遍。 */
function liveTargetHTML(st){
  if (!st.num) return '<div class="dial-target ph">输入呼叫编码</div>';
  const hit = liveByCode(st.num);
  /* 对不上就直接说，而且就摆在这一行（用户定的）：号码敲错时眼睛正盯着这儿，
     不用再往下瞟一眼。号码本身不用在这儿复读一遍 —— 大框里那位数字就是它。 */
  if (!hit){
    const msg = "本机名册里没有这个编码："+st.num;
    return '<div class="dial-target bad" title="'+esc(msg)+'">'+esc(msg)+'</div>';
  }
  const txt = hit.kind+" · "+hit.name;
  return '<div class="dial-target" title="'+esc(txt)+'">'+esc(txt)+'</div>';
}
/* 大话筒底下那行字：**通话状态就这一行**（用户定的）。
   它原来在号码框和键盘之间 —— 那等于在键盘上方凭空插一行，键盘被顶下去一格。
   用户定的（强调了两次）：那儿不许有字。现在挪到话筒正下方，那枚圆自己就站在
   那儿说同一件事，字跟在它下面最顺。两个页签**都从这儿出**，切页签字都在原处。

   **它现在常驻**（用户定的）：原来是「有话说才渲染」，可那样没接通时话筒底下
   是一片空白，人分不清是「还没呼」还是「页面坏了」。现在一个状态一句话：

     未在通话               没在呼（含刚挂断、刚失败）
     正在呼叫…               按了「呼叫」、代理还没回话。这一句用户没点名，但少了
                            它，按下呼叫的那一两秒会显示「未在通话」——那是谎话
     已接通 · 正在对讲        接通了，麦克风正在往外送
     暂停中 · 通话已被静音    接通着、按了暂停
     连接播放代理失败!        呼叫这一步没成

   出错时**整行让给错误**（就是上面那一类，其余错误也原样显示在这儿）：这一行
   常驻，「这一下为什么没成」又正是通话状态本身。原来那些话挂在号码框上面那行，
   现在那儿只管查号了（见 liveTargetHTML）。长句子尾巴上省略、全文进 title。 */
function liveTipHTML(st){
  let cls = "s-idle", txt = "未在通话";
  if (st.err){ cls = "s-bad"; txt = st.err; }
  else if (st.phase === "calling"){ cls = "s-calling"; txt = "正在呼叫…"; }
  else if (st.phase === "talking"){
    if (st.muted){ cls = "s-muted"; txt = "暂停中 · 通话已被静音"; }
    else         { cls = "s-live";  txt = "已接通 · 正在对讲"; }
  }
  return '<div class="live-tip '+cls+'" title="'+esc(txt)+'">'+esc(txt)+'</div>';
}

/* ══ 顶上那枚大话筒 ═════════════════════════════════════════════════
   两个页签共用一枚（用户要的是「两个区域顶部都有」），所以它挂在 renderLive
   里、页签和内容之间，不在任何一页自己的模板里。

   三种样子，说的都是同一句「你这会儿在不在往外说」：
     · 没接通（idle／calling）—— 灰的，一动不动
     · 已接通、正在对讲 —— 绿的，呼吸闪烁
     · 已接通、按了暂停 —— 琥珀色，不闪
   暂停那格是**故意不跟绿色的**：闪烁是「正在出声」的意思，真静音了还让它绿着
   闪，就跟底下那行字（「暂停中 · 通话已被静音」）和同一族的「继续」键互相打脸。
   琥珀是暂停键已经在用的那套颜色，一个状态一种颜色，页面上不多出新的说法。

   下面那句 tip 是给**读屏和鼠标悬停**的，措辞跟着话筒底下那行字走
   （liveTipHTML）—— 同一个状态页面上只能有一种说法。 */
function liveMicHTML(st){
  const talking = st.phase === "talking";
  const cls = !talking ? "" : (st.muted ? " muted" : " on");
  const tip = !talking ? "未在通话" : (st.muted ? "暂停中 · 通话已被静音" : "已接通 · 正在对讲");
  return '<div class="live-mic'+cls+'" id="liveMic" role="img" aria-label="'+esc(tip)+'" title="'+esc(tip)+'">'+
    ICON.mic+'</div>';
}

/* ══ 三个键 ═════════════════════════════════════════════════════════
   接通**之前**挂断和暂停点了也没反应（用户定的）—— 用 disabled 而不是
   「点了当没点」：浏览器自己就不发事件、鼠标也变成禁止标志，不会有
   「我明明点了呀」的错觉。
   暂停那枚的颜色按用户说的走：没接通是灰的，接通后就是一块**纯色实心、无边框**；
   按下去了（已暂停）底色不变，只把字换成「继续」—— 那一步只靠字说话。 */
function liveActsHTML(st, tgt){
  const talking = st.phase === "talking";
  const calling = st.phase === "calling";
  return ''+
    '<button class="key act hang" id="liveHang"'+(talking?"":" disabled")+'>'+
      ICON.hangup+'挂断</button>'+
    '<button class="key act pause'+(st.muted?" on":"")+'" id="livePause"'+(talking?"":" disabled")+
      '>'+(st.muted? ICON.play : ICON.pause)+(st.muted?"继续":"暂停")+'</button>'+
    /* 「呼叫中」后面**不带省略号**（用户定的）：这枚键在呼叫期间是禁用的，
       省略号那种「还在进行」的语气留着也没人点得动，反而显得字在抖。 */
    '<button class="key act call" id="liveCall"'+((talking||calling||!tgt)?" disabled":"")+'>'+
      ICON.phone+(calling?"呼叫中":"呼叫")+'</button>';
}

/* ══ 开着代理时这两页的替身 ═════════════════════════════════════════
   代理只走 TCP，对讲和在线播放的音频是 UDP，开了代理就送不到终端。
   App 里只要代理生效，这两页就只显示这句说明（用户定的文案）。 */
function renderProxyBlocked(el, title){
  el.classList.add("headfix");
  el.innerHTML =
    '<div class="sec-head">'+
      '<div class="title-row"><h2 class="serif">'+title+'</h2></div>'+
    '</div>'+
    '<div class="page-body">'+
      '<div class="panel"><div class="panel-body">'+
        '<div class="hint" style="padding:18px 4px;font-size:14px;text-align:center">'+
          '正在通过代理连接服务器, 暂时无法使用此功能'+
        '</div>'+
      '</div></div>'+
    '</div>';
}

/* ══ 页面 ═══════════════════════════════════════════════════════════
   和「全局设置」「更多功能」同一套骨架（.headfix + .sec-head + .page-body）：
   标题那行钉住，下面那张面板自己滚。键盘那一坨用现成的 .panel，不新写卡片样式。 */
function renderLive(){
  const el = $("#main"); if (!el) return;
  if (proxyBlocksMedia()){ renderProxyBlocked(el, "实时对讲"); return; }
  const st  = liveState();
  const tgt = liveTarget();
  el.classList.add("headfix");
  el.innerHTML =
    '<div class="sec-head">'+
      '<div class="title-row"><h2 class="serif">实时对讲</h2></div>'+
    '</div>'+
    /* 两个页签**都撑满高度**（css 里 `.is-fill` 那一组），但吃高度的不是同一样：
       拨号页是键盘（五行摊开），直接呼叫页是选择器里那张名单（多露几行）。
       所以拨号页多挂一个 `.is-dial`，那边才有多出来的一组键盘规则。 */
    '<div class="page-body is-fill'+(st.tab==="dial"?" is-dial":"")+'">'+
      '<div class="panel"><div class="panel-body">'+
        '<div class="tabbar" id="liveTabs">'+
          '<button data-t="dial"'+(st.tab==="dial"?' class="on"':"")+'>拨号呼叫</button>'+
          '<button data-t="direct"'+(st.tab==="direct"?' class="on"':"")+'>直接呼叫</button>'+
        '</div>'+
        liveMicHTML(st)+
        liveTipHTML(st)+
        '<div class="dial-wrap">'+
          (st.tab === "dial" ? liveDialHTML(st, tgt) : liveDirectHTML(st, tgt))+
        '</div>'+
      '</div></div>'+
    '</div>';
  liveBind(st);
  /* 直接呼叫页那三枚键的高度是「借」拨号页的，见 liveActSync。 */
  if (!liveActResize){
    liveActResize = true;
    /* 转屏、改窗口大小时拨号页那排跟着变，量一次新的。只挂一次 —— 每次
       renderLive 都挂会越积越多。 */
    addEventListener("resize", ()=>{ if (S.mode === "live") liveActSync(); });
  }
  liveActSync();
}

/* ══ 直接呼叫页的动作键尺寸 ══════════════════════════════════════════
   拨号页那排动作键的高度和字号都是算出来的（五行均分 + cqh，见 CSS 的 .is-dial），
   不是写死的。直接呼叫页也摆着同样三枚键，可那一页的键盘不参与均分 —— 尺寸要是
   各算一套，两个页签换着看，底下那排就会跳（用户看见的正是这一下：字号不一样）。
   所以拨号页画完把高度和字号都量下来；切到直接呼叫页时写进 --live-act-h /
   --live-act-fs，那边三枚键跟着这两个数走（CSS 里那两条 var()）。 */
let liveActH = 0;           /* 拨号页实测的动作键高度，0 = 还没量过 */
let liveActFs = 0;          /* 拨号页实测的动作键字号，0 = 还没量过 */
let liveActResize = false;  /* 窗口尺寸的监听只挂一次 */

function liveActSync(){
  const st = liveState();
  const page = $(".page-body.is-fill");
  if (!page) return;
  if (st.tab === "dial"){
    const b = $("#liveHang");
    if (b){
      const h = b.getBoundingClientRect().height;
      if (h > 0) liveActH = h;
      const fs = parseFloat(getComputedStyle(b).fontSize);
      if (fs > 0) liveActFs = fs;
    }
    return;
  }
  if (liveActH > 0) page.style.setProperty("--live-act-h", liveActH + "px");
  if (liveActFs > 0) page.style.setProperty("--live-act-fs", liveActFs + "px");
}
/* 九枚数字键，敲下去是什么就写什么。第四行两边的**清空**和**退格**不混进这个
   数组 —— 它们不是「一位数字」，行为也各自不同，在 liveDialHTML 里单独写。
   这一行原来是「+」（多目标呼叫的连字符），现在拨号台不支持多终端了，
   那一格换成清空（用户定的）：一次拨错一位，退格要按好几下，清空一下到底。 */
const LIVE_KEYS = ["1","2","3","4","5","6","7","8","9"];

/* ══ 拨号音 ═════════════════════════════════════════════════════════
   0–9 每个键一个双音 —— 就是电话键盘那套 DTMF 标准频率对。不用去找九个 wav：
   九个文件要跟面板一起搬、还要处理加载失败，而这里两个正弦振荡器现合成，
   一个字节都不用下载。系统也没有公开的「拨号音」接口（iOS 的
   AudioServicesPlaySystemSound 只有固定的几种提示音，没有按频率来的）。
   只在 idle（还没呼出去）时响：通话中麦克风开着，本机这声「嘀」会被它收回去
   送给终端（对讲关掉了回声消除）。 */
const DTMF = {
  "1":[697,1209], "2":[697,1336], "3":[697,1477],
  "4":[770,1209], "5":[770,1336], "6":[770,1477],
  "7":[852,1209], "8":[852,1336], "9":[852,1477],
  "0":[941,1336]
};
let dialCtx = null;
function dialBeep(k){
  const f = DTMF[k]; if (!f) return;
  /* 提示音正在响（刚挂断那一秒里人可能已经在按号码了）：这一声先不响，
     更不能去 resume 抢会话 —— 抢回来就把提示音掐断了。 */
  if (performance.now() < liveChimeBusyUntil) return;
  /* App 里交给原生合成、原生播。WebKit 的 AudioContext 在用过对讲（采集单元）
     或原生提示音之后，可能停在「state 还是 running、却完全不出声」的状态 ——
     网页这层检测不到，复用它排振荡器就是按键音时不时消失。原生每次播之前
     都重新 setActive，和提示音走同一条已经验证可靠的路。
     网页版没有这个桥，继续走下面那段 Web Audio。 */
  const native = nativeCmd();
  if (native){
    try {
      const p = native.postMessage({cmd:"tone", id:0, data:{freq:f}});
      if (p && p.catch) p.catch(()=>{});
    } catch(e){}
    return;
  }
  try {
    if (!dialCtx) dialCtx = new (window.AudioContext || window.webkitAudioContext)();
    /* 上下文被打断/挂起时（iOS 上放完原生提示音、来电话、切后台回来）
       直接往它里面排振荡器是没声的 —— 表现就是「拨号音时不时消失」。
       等 resume 回来再排这一声。 */
    const fire = ()=>{
      if (!dialCtx || dialCtx.state !== "running") return;
      const t = dialCtx.currentTime;
      const g = dialCtx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
      g.gain.setValueAtTime(0.06, t + 0.09);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      g.connect(dialCtx.destination);
      for (const hz of f){
        const o = dialCtx.createOscillator();
        o.type = "sine"; o.frequency.value = hz;
        o.connect(g); o.start(t); o.stop(t + 0.13);
      }
      /* 振荡器自己会停；增益节点在响完之后断开，别让它一直挂在 destination 上。 */
      setTimeout(()=>{ try { g.disconnect(); } catch(e){} }, 250);
    };
    if (dialCtx.state === "running") fire();
    else dialCtx.resume().then(fire).catch(()=>{});
  } catch(e){}
}

function liveDialHTML(st, tgt){
  return ''+
    '<div class="dial-target-row">'+liveTargetHTML(st)+'</div>'+
    '<div class="dial-num">'+
      '<span class="dial-code">'+esc(st.num)+'</span>'+
    '</div>'+
    /* 号码框和键盘之间**不放任何一行字**（用户定的，强调了两次）—— 状态那行在
       话筒底下（liveTipHTML），不在这一块里。 */
    '<div class="dialpad">'+
      LIVE_KEYS.map(k => '<button class="key" data-k="'+k+'">'+k+'</button>').join("")+
      '<button class="key clear" id="liveClear" aria-label="清空全部" title="清空全部"'+
        (st.num?"":" disabled")+'>'+ICON.del+'</button>'+
      '<button class="key" data-k="0">0</button>'+
      '<button class="key del" id="liveDel" aria-label="删掉最后一位" title="删掉最后一位"'+
        (st.num?"":" disabled")+'>'+ICON.bksp+'</button>'+
      liveActsHTML(st, tgt)+
    '</div>';
}
/* 直接呼叫那一栏的预览行：选了几个，最后会呼出去几个**目标**。
   分组是**当场展开**的，所以「选了 1 个分组」和「会呼 12 个目标」是两个数 ——
   把后者写出来，人才知道这一下按出去有多大。
   （这一行里原来写的是「点位」，用户改成了「目标」：这一行回答的是「这一下
   按出去会惊动多少个」，不是名单上那个点位的名字。）
   出错的话**不归这一行**了（和拨号页同一个口径）：两个页签共用的那行状态
   （liveTipHTML）就挂在话筒底下，出错时它整行让给错误，这一页也看得见 ——
   不用在这儿再说一遍。 */
function liveDirectTargetHTML(st, tgt){
  if (tgt) return '<div class="dial-target">将呼叫 '+tgt.ids.length+' 个目标</div>';
  if (liveChosen(st.area)) return '<div class="dial-target ph">选中的分组里没有目标</div>';
  return '<div class="dial-target ph">还没有选终端</div>';
}
/* ══ 直接呼叫：摊在页面上的选择器 ═══════════════════════════════════
   内容和「执行区域」那个模态是同一套（两个页签 + 搜索 + 全选行 + 名单），样式
   全部复用现成的类（.tabbar／.pick-search／.pick-head／.pick／.grp-grid／
   .pick-row／.grp-card），没有新写卡片样子。

   一条纪律：**勾一行、打字、换筛选，都不重画整页**。renderMain() 会把搜索框的
   光标和名单的滚动位置一起冲掉 —— 勾一个名单深处的点位就得从头再找一遍、搜索框
   还得重新点。所以只有换页签才整块重画（那边结构真的变了），其余一概只动该动的
   那一小块（模态那边踩过同一个坑，见 js/20-ui.js 的 syncAllRow）。 */

/* 点位那页当前列出来的：先过分组筛选，再过搜索词。 */
function livePickTerms(st){
  let list = S.data.terminals;
  if (String(st.aGroup) !== "all")
    list = list.filter(t => (t.with_groups||[]).some(w => String(w.terminals_groups_id) === String(st.aGroup)));
  const q = (st.aQ||"").trim().toLowerCase();
  if (q) list = list.filter(t => (String(t.name)+" "+String(t.ip_address)).toLowerCase().indexOf(q) >= 0);
  return list;
}
/* 「全选」勾的是**当前列出来的这一批**，不是整个名册 —— 搜索或筛选过之后，
   「全选搜索结果」比「全选两百个点位」有用得多（和模态那边同一个口径）。 */
function livePickNames(st){
  return st.aTab === "group" ? S.data.termGroups.map(g=>g.name) : livePickTerms(st).map(t=>t.name);
}
function livePickSel(st){ return st.aTab === "group" ? st.area.g : st.area.t; }
function livePickOn(st){ return livePickNames(st).filter(n => livePickSel(st).indexOf(n) >= 0).length; }

function livePickHeadHTML(st){
  const names = livePickNames(st), nOn = livePickOn(st);
  /* 红绿点那份说明**只在点位页挂**（用户定的）。分组那一页每张卡片说的是
     「N 个点位 · M 在线」—— 那是聚合出来的数，一整组没有单一的红或绿，
     图例摆在那儿等于在讲一件这一页根本不显示的事。 */
  return '<label class="chk"><input type="checkbox" id="livePickAll"'+
      (nOn>0 && nOn===names.length ? " checked":"")+'>'+
      '<span>全选</span></label>'+
    '<span class="hint" id="livePickN">已选择 '+nOn+' 个</span>'+
    (st.aTab === "group" ? "" : statLegend());
}
/* 名单／网格的内容。分组卡片得整个重画（选中态是卡片自己身上的 .on），
   点位那页不用 —— 勾没勾由 input 自己显示，重画只会把滚动条弹回顶上。 */
function livePickItemsHTML(st){
  if (st.aTab === "group"){
    const counts = {}, ons = {};
    S.data.terminals.forEach(t=>{
      const hot = statusOf(t.name)==="online" || statusOf(t.name)==="busy";
      (t.with_groups||[]).forEach(w=>{
        counts[w.terminals_groups_id] = (counts[w.terminals_groups_id]||0)+1;
        if (hot) ons[w.terminals_groups_id] = (ons[w.terminals_groups_id]||0)+1;
      });
    });
    return S.data.termGroups.map(g=>{
      const on = st.area.g.indexOf(g.name) >= 0;
      const total = counts[g.id]||0, hot = ons[g.id]||0;
      /* 分组是聚合，给不了单一红绿点，就摊开说几个在线 */
      const tail = S.link==="ok" ? ' · <span class="on">'+hot+'</span> 在线' : '';
      return '<button class="grp-card'+(on?" on":"")+'" data-grp="'+esc(g.name)+'">'+
        '<span class="n">'+esc(g.name)+'</span><span class="c">'+total+' 个点位'+tail+'</span></button>';
    }).join("");
  }
  const list = livePickTerms(st);
  return list.length ? list.map(t=>{
    const on = st.area.t.indexOf(t.name) >= 0;
    return '<label class="pick-row" title="'+statusTitle(t.name)+'">'+
      '<input type="checkbox" data-term="'+esc(t.name)+'"'+(on?" checked":"")+'>'+
      statusDot(t.name)+
      '<span class="nm">'+esc(t.name)+'</span><span class="ip">'+esc(t.ip_address||"")+'</span></label>';
  }).join("") : '<div class="hint" style="padding:14px">没有匹配的点位</div>';
}
function livePickPaneHTML(st){
  if (st.aTab === "group")
    return '<div class="pick-head" id="livePickHead">'+livePickHeadHTML(st)+'</div>'+
      '<div class="grp-grid" id="livePickGrid">'+livePickItemsHTML(st)+'</div>';
  return '<div class="pick-search">'+
      '<span class="sbox">'+ICON.search+
        '<input class="input" id="livePickQ" placeholder="搜索名称或 IP" value="'+esc(st.aQ||"")+'">'+
      '</span>'+
      '<select class="select" id="livePickG" style="width:132px">'+
        '<option value="all">全部分组</option>'+
        S.data.termGroups.map(g=>'<option value="'+g.id+'"'+
          (String(st.aGroup)===String(g.id)?" selected":"")+'>'+esc(g.name)+'</option>').join("")+
      '</select>'+
    '</div>'+
    /* 「全选」那一行和普通设备选择器一样，是列表框自己的题头（.pick-box）：
       钉在框子顶上不跟列表滚，不再单独占框子外面的一行。 */
    '<div class="pick-box">'+
      '<div class="pick-head" id="livePickHead">'+livePickHeadHTML(st)+'</div>'+
      '<div class="pick" id="livePickList">'+livePickItemsHTML(st)+'</div>'+
    '</div>';
}
/* 页签上那个数字跟着**当前列出的**走：搜索一过滤，它就从「全部点位」变成
   「搜出来几个」（和模态那边一个口径）。 */
function livePickHTML(st){
  const isT = st.aTab !== "group";
  const n = isT ? livePickTerms(st).length : S.data.terminals.length;
  return '<div class="live-pick">'+
      '<div class="tabbar" id="livePickTabs">'+
        '<button data-t="term"'+(isT?' class="on"':"")+'>终端点位 · '+n+'</button>'+
        '<button data-t="group"'+(!isT?' class="on"':"")+'>分组 · '+S.data.termGroups.length+'</button>'+
      '</div>'+
      '<div id="livePickPane">'+livePickPaneHTML(st)+'</div>'+
    '</div>';
}

/* 换搜索词／换筛选之后：名单和那一行「已选择 N 个」都得跟上，页签上那个数字也是。
   页签数字写回去而不是重画 —— 重画会把搜索框里的光标顶掉。 */
function livePickListDraw(st){
  const box = $("#livePickList");
  if (box) box.innerHTML = livePickItemsHTML(st);
  const grid = $("#livePickGrid");
  if (grid) grid.innerHTML = livePickItemsHTML(st);
  const tab = $("#livePickTabs button[data-t='term']");
  if (tab) tab.textContent = "终端点位 · "+livePickTerms(st).length;
  livePickHeadDraw(st);
}
/* 「全选」那一格。**每次重画那一行都得重挂一次** —— innerHTML 把旧的整枚换掉了，
   挂在它身上的 onchange 跟着一起没（模态那边是在 drawAllRow 里当场重挂的，
   见 js/20-ui.js）。 */
function livePickAllBind(st){
  const all = $("#livePickAll"); if (!all) return;
  all.onchange = ()=>{
    const names = livePickNames(st), sel = livePickSel(st);
    if (all.checked){
      /* sel 拿到的就是那个数组本身，直接往里塞 */
      names.forEach(n=>{ if (sel.indexOf(n) < 0) sel.push(n); });
    } else {
      /* 过滤出来的是新数组，得写回去；写错一边就变成「在分组页上清空了点位」 */
      const drop = new Set(names);
      const kept = sel.filter(n => !drop.has(n));
      if (st.aTab === "group") st.area.g = kept; else st.area.t = kept;
    }
    livePickListDraw(st); liveDirectSync(st);
  };
}
function livePickHeadDraw(st){
  const head = $("#livePickHead"); if (!head) return;
  head.innerHTML = livePickHeadHTML(st);
  const cb = $("#livePickAll", head), names = livePickNames(st), nOn = livePickOn(st);
  if (cb){
    /* indeterminate 只能从 JS 设，HTML 里没这个属性 —— 所以画完再补一次。 */
    cb.checked = nOn>0 && nOn===names.length;
    cb.indeterminate = nOn>0 && nOn<names.length;
  }
  livePickAllBind(st);
}
/* 勾选之后，选择器**外面**有两样东西跟着变：那句「将呼叫 N 个点位」，和
   「呼叫」键能不能按。只动这两处，别去 renderMain()。 */
function liveDirectSync(st){
  const row = $("#liveDirectRow");
  if (row) row.innerHTML = liveDirectTargetHTML(st, liveTarget());
  const call = $("#liveCall");
  if (call && st.phase === "idle") call.disabled = !liveTarget();
}

function liveDirectHTML(st, tgt){
  return ''+
    '<div class="dial-target-row" id="liveDirectRow">'+liveDirectTargetHTML(st, tgt)+'</div>'+
    livePickHTML(st)+
    /* 这一页原来也把状态行摆在这儿（选择器和三个动作键之间）—— 一样是「键盘
       上方插一行」，一起摘掉，状态在话筒底下（liveTipHTML）。 */
    '<div class="dialpad">'+liveActsHTML(st, tgt)+'</div>';
}

function livePickBind(st, root){
  const pane = $("#livePickPane", root); if (!pane) return;
  /* 换页签：结构真的变了（搜索行+名单 ↔ 网格），整块重画一次再重绑。
     换搜索词、换筛选、勾一行都**不走这条路**。 */
  $$("#livePickTabs button", root).forEach(b => b.onclick = ()=>{
    if (st.aTab === b.dataset.t) return;
    st.aTab = b.dataset.t; renderMain();
  });
  const q = $("#livePickQ", root);
  if (q) q.oninput = ()=>{ st.aQ = q.value; livePickListDraw(st); };
  const g = $("#livePickG", root);
  if (g) g.onchange = ()=>{ st.aGroup = g.value; livePickListDraw(st); };
  /* 全选：勾的是**当前列出来的这一批**，换到另一页签选的那些一概不动。 */
  livePickAllBind(st);
  /* 点位那一页勾一行：名单**不重画**（重画会把滚动条弹回顶上，勾名单深处的
     一个点位就得从头再找），只把头上那句「已选择 N 个」和「呼叫」键跟上。 */
  pane.addEventListener("change", e=>{
    const cb = e.target.closest("input[data-term]"); if (!cb) return;
    const n = cb.dataset.term, i = st.area.t.indexOf(n);
    if (cb.checked){ if (i < 0) st.area.t.push(n); }
    else if (i >= 0) st.area.t.splice(i,1);
    livePickHeadDraw(st); liveDirectSync(st);
  });
  /* 分组那一页点卡片：选中态长在卡片自己身上（.grp-card.on），得重画网格。 */
  pane.addEventListener("click", e=>{
    const gc = e.target.closest("[data-grp]"); if (!gc) return;
    const n = gc.dataset.grp, i = st.area.g.indexOf(n);
    if (i >= 0) st.area.g.splice(i,1); else st.area.g.push(n);
    livePickListDraw(st); liveDirectSync(st);
  });
}

function liveBind(st){
  const el = $("#main"); if (!el) return;
  $$("#liveTabs button", el).forEach(b => b.onclick = ()=>{
    if (st.tab === b.dataset.t) return;
    st.tab = b.dataset.t; st.err = "";
    renderMain();
  });
  /* 数字键：一律往号码尾巴上接一位。**按 `[data-k]` 认，不按类名排** ——
     同一个 .key 类底下还住着清空、退格和三个动作键，用 `:not()` 一个个往外挑，
     下次再添一枚就又得回来补一笔，漏了就是把它的 dataset 接到号码屁股上。 */
  $$(".dialpad .key[data-k]", el).forEach(b => b.onclick = ()=>{
    if (st.num.length >= LIVE_NUM_MAX) return;
    if (st.phase === "idle") dialBeep(b.dataset.k);
    st.num += b.dataset.k; st.err = ""; renderMain();
  });
  /* 清空：一下把号码抹光。退格是一位一位往回删，拨错一串时得按好几下。 */
  const clr = $("#liveClear", el);
  if (clr) clr.onclick = ()=>{ st.num = ""; st.err = ""; renderMain(); };
  /* 退格：删最后一位。 */
  const del = $("#liveDel", el);
  if (del) del.onclick = ()=>{ st.num = st.num.slice(0,-1); st.err = ""; renderMain(); };
  /* 直接呼叫那个内嵌选择器。它只在那一页有节点，绑不上就说明人在拨号页。 */
  livePickBind(st, el);
  const hang = $("#liveHang", el);   if (hang)  hang.onclick  = liveHangup;
  const pause = $("#livePause", el); if (pause) pause.onclick = livePause;
  const call = $("#liveCall", el);   if (call)  call.onclick  = liveCall;
}

/* ══ 在线播放 ═══════════════════════════════════════════════════════
   一件「把本机的一个音频文件实时放到终端上」的事。走的是**对讲那条一模一样的
   路**：本机那个 play-agent 开一路任务，浏览器把 PCM 一帧一帧喂给它，它按
   10ms 一个包往终端发（见 play-agent/audio.go）。区别只有喂进去的东西 ——
   对讲喂的是麦克风（getUserMedia），这里喂的是一个文件的解码结果。
   所以代理（Go）**一个字节都不用改**，协议还是那三句 call／mute／hangup
   加一路二进制帧。

   三件当初定下来的事：
   1. **本机不出声** —— 和麦克风那条同一个做法：链子末尾拧一个 0 增益的 gain
      再进 destination（不接到 destination 上 worklet 根本不会被拉起来，
      接上了就得堵住，不然这台机器自己就成了一个音箱）。
   2. **文件不出这台机器** —— 所谓「上传」只是一个本机选文件的按钮；解码在浏览器里
      做，递给代理的只有 PCM。学校服务器那边一个字节都不落。
   3. **切页继续播** —— 这条会话不挂在页面上：真正的时钟是 AudioContext 那个音频
      线程，页面只是「画进度条的那只手」。切到别的页只是把那只手收起来
      （playTick 里取不到节点就自己停），声音照旧往终端走。

   ⚠ 代理那头**同一时刻只有一条会话**（ag.audio 就一个字段）：播放中再按「呼叫」，
   它会静悄悄把这一条换成那一条，两条面板状态谁也不动。所以两边在入口上互相挡住
   —— liveCall 那边一句、playStart 这边一句，谁也别想踩着谁起来。 */

/* 这条链路是 16k／16 位／单声道 —— 和对讲共用同一副管子，不是这一页挑的。
   采样率高一点的文件在这一步被浏览器重采样下来，音乐听着会闷一截（语声听不出）。 */
const PLAY_RATE = 16000;
/* 选文件时的体积上限：16k 单声道一分钟约 1.9 MB，一小时约 115 MB，解出来还要在
   内存里翻好几倍。手机上撑不住，所以宁可当场说一句，也别让它把标签页卡死。 */
const PLAY_FILE_MAX = 80 * 1024 * 1024;
/* 一张单子的上限。16k 单声道解出来是 float32，一分钟约 3.8 MB —— 光靠「单个文件 80 MB」
   挡不住「多选十个大文件」：那就是几个 GB，标签页当场崩，连按停止的机会都不给。
   所以条数和总内存各封一道，超了当场说一句、不往里塞。 */
const PLAY_LIST_MAX = 50;
const PLAY_MEM_MAX  = 256 * 1024 * 1024;   /* 所有解码后的样本加起来的字节数上限 */

function playState(){
  if (!S.dt.play) S.dt.play = {
    area : {t:[], g:[]},        /* 要推到哪儿，和别处一个形状（点位名／分组名） */
    /* 单子里的每一项：{uid, name, size, dur, buf}。buf 是解好的 16k 单声道，
       没有 buf 就是「还在读」——**不是**读坏了（读坏的根本不进这张单子）。 */
    list : [],
    /* **当前这一首就是这一项本身**，不是一个下标。存下标的话，删掉前面一项
       它就指到别人身上去了 —— 而那几处读它的地方（起播、切歌、画高亮）
       恰恰都在 await 之后。要下标时用 playCurIdx() 现算。 */
    cur  : null,
    mode : "list",              /* list 列表 | loop 列表循环 | one 单曲 | one-loop 单曲循环
                                   | shuffle 随机 —— 见 playModeNext / playAdvance */
    phase: "idle",              /* idle 没在放 | ready 备好了没起 | connecting 正在开那一路
                                   任务 | playing | paused。**放完和停止都回 idle**
                                   （用户定的词表只有「播放中／已暂停／未在播放」三句） */
    pos  : 0,                   /* 没在放的时候进度停在哪一秒（放的时候由音频时钟现算） */
    vol  : 100,                 /* 推给终端的音量（0-100）。**本机一直不出声**，所以这个
                                   数调的不是这台电脑的音箱，是终端听见的那一份 */
    volMuted: false,            /* 竖屏那枚喇叭的静音状态：音量条归零、图标划线 */
    volPrev : 100,              /* 静音前那一档，解除静音时回到这里 */
    err  : "",                  /* 上一次没做成的一句话，摆在转盘底下那行。**只留给
                                   「按播放没做成」这类传输性的事** —— 读文件失败走 toast，
                                   不然它会盖掉「播放中 · 已推送到 N 个终端」那句 */
    busy : false,               /* 正在开／收那一路任务：防连点 */
    reading: null               /* 正在解码 {done, total}，null = 没在读。**跟 phase 分家**：
                                   播放中也能加文件，那几秒要是把 phase 写成「读文件中」，
                                   playFeed 立刻不再推帧 —— 终端当场静音 */
  };
  return S.dt.play;
}

/* ══ 屏幕别灭 ══════════════════════════════════════════════════════
   对讲和在线播放的过程中，手机不该自己息屏（用户定的）。
   两条路：
     · App 里走原生 —— itcAgentCmd 的 wake 命令直接开关 idleTimer；WKWebView
       里这条最可靠，也不受「安全上下文」限制；
     · 浏览器里用 Screen Wake Lock —— 它只在安全上下文里有，局域网明文 http
       打开面板时连这个接口都没有。没有就静默跳过，不影响别的功能。 */
let awakeWant = false, awakeLock = null;
function keepAwakeApply(){
  const native = window.__ITC_NATIVE_AGENT && window.webkit
              && webkit.messageHandlers && webkit.messageHandlers.itcAgentCmd;
  if (native){
    try {
      const p = native.postMessage({cmd:"wake", id:0, data:{on:awakeWant}});
      if (p && p.catch) p.catch(()=>{});
    } catch(e){}
    return;
  }
  if (awakeWant){
    if (awakeLock || !navigator.wakeLock) return;
    navigator.wakeLock.request("screen").then(s=>{
      /* 请求回来的路上人已经挂断/停止了：拿到就还回去。 */
      if (!awakeWant){ try { s.release(); } catch(e){} return; }
      awakeLock = s;
      s.addEventListener("release", ()=>{ if (awakeLock === s) awakeLock = null; });
    }).catch(()=>{});
  } else if (awakeLock){
    try { awakeLock.release(); } catch(e){}
    awakeLock = null;
  }
}
function keepAwake(on){
  on = !!on;
  if (on === awakeWant) return;
  awakeWant = on;
  keepAwakeApply();
}
/* 对讲「呼叫中／已接通」和播放「连接中／播放中」都要拦息屏。
   暂停不算 —— 那时候终端是安静的，让人家锁屏。 */
function syncKeepAwake(){
  const lv = liveState(), pl = playState();
  keepAwake(lv.phase === "calling" || lv.phase === "talking"
         || pl.phase === "connecting" || pl.phase === "playing");
}
/* 切回前台时 Wake Lock 可能已经被系统收走了，照着当前想要的状态再要一次；
   App 那条路重发一遍 wake 也无害。 */
document.addEventListener("visibilitychange", ()=>{ if (!document.hidden) keepAwakeApply(); });
addEventListener("pagehide", ()=>{ keepAwake(false); });

/* 当前这一首（没有就是 null）。**所有原来读 st.file 的地方都换成它。** */
function playCur(st){ return st.cur || null; }
/* 当前这一首是第几项（画高亮、算下一首用）。没有当前项就是 -1。 */
function playCurIdx(st){ return st.cur ? st.list.indexOf(st.cur) : -1; }
/* 按 uid 找一项。**点列表那一瞬间捕获的是 uid 不是下标**：菜单/回调都可能跨过
   一次重画才跑，下标那时候已经换人了。 */
function playFind(st, uid){ for (const it of st.list) if (it.uid === uid) return it; return null; }
/* 单子现在占了多少内存（字节）。 */
function playBytes(st){
  let n = 0;
  for (const it of st.list) if (it.buf) n += it.buf.length * 4;
  return n;
}
/* 给单子里每一项发个号。只增不减，删掉再进也不会撞上。 */
let playUid = 0;

/* 在线播放要的是「把正在放的样点截下来送出去」。首选 AudioWorklet —— 它跑在音频
   线程上，标签页切到后台也照常出帧。可 AudioWorklet 是 [SecureContext] 的东西：
   明文 http 打开面板时那个接口**整个不给**（audioWorklet 不在原型上、
   AudioWorkletNode 这个全局也没有）。
   好在播放**不像对讲**那样非安全上下文就彻底没辙 —— Web Audio 本身不受这条限制，
   退一步用 ScriptProcessorNode 照样截得到样点（它跑在主线程，切后台可能被节流，
   那是另一个问题；功能先得有）。所以这一页在明文 http 下也摆得出来，见
   playCtxMake 里的退化那一支。
   两个入口（顶栏页签、竖屏导航栏）和启动时的记忆恢复问的都是这一句
   （30-view-list.js 的 renderTopbar／renderNavbar、90-boot.js 里恢复上次页签那句）。 */
function playWorkletOK(){
  const AC = window.AudioContext || window.webkitAudioContext;
  /* ⚠ 「有没有 audioWorklet」只能用 **in** 问，绝不能读
     `AudioContext.prototype.audioWorklet` —— 那是个带着 brand check 的访问器
     （而且和 getUserMedia 一样标着 [SecureContext]），在**原型**上读它当场抛
     「TypeError: Illegal invocation」：它不是「读到 undefined」，是直接炸。
     这一炸在 renderTopbar 里，整条 renderAll 就断在那儿 —— 顶栏、侧栏、正文全是空的，
     页面上只剩一片背景色（2026-10-17 实测踩过，别再改回去）。
     `in` 只问「这个属性在不在」，不调它的 getter，也就不碰 brand check；
     [SecureContext] 的成员在明文 http 下**根本不存在**，所以这一问在那种页面上
     照样是 false，这正是想要的结果。 */
  return !!(window.isSecureContext && AC && AC.prototype && ("audioWorklet" in AC.prototype)
            && window.AudioWorkletNode);
}
function playUsable(){
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !AC.prototype) return false;
  if (playWorkletOK()) return true;
  /* 非安全上下文：没有 AudioWorklet，但有 ScriptProcessorNode 就还能放。 */
  return ("createScriptProcessor" in AC.prototype);
}

/* 播放这套节点。和对讲那套（liveCtx…）**各是各的**：一个会话一个 AudioContext，
   谁停谁关都不动对方。 */
let playCtx = null, playNode = null, playSrc = null, playSink = null, playGain = null;
let playGen = 0;     /* 第几次起播。onended 回来时对不上代次就说这是旧的，丢掉 */
let playOp  = 0;     /* 第几次「按播放」。起播那一路要跨好几个 await，中间人可能按了
                        停止、又按了一次播放 —— 回来先对号，对不上就整趟作废
                        （见 playStart 里的 alive） */
let playAt  = 0;     /* elapsed = ctx.currentTime - playAt */
let playRaf = 0;     /* 画进度那口呼吸（只在播放中、且页面在这一页时转） */
let playN   = 0;     /* 这一路推给了几个终端 */

/* 这一页现在要推给谁 —— 和 liveTarget 同一个口径：分组当场展开成组里的人。 */
function playTarget(st){
  const ids = liveAreaIds(st.area);
  if (!ids.length) return null;
  return {ids: ids, names: (st.area.t||[]).concat(st.area.g||[])};
}

/* 搭一条只属于播放的音频链路。和对讲那条一模一样的搭法（同一个 worklet 源码，
   只是要在**这个** context 上再注册一次 —— worklet 是按 context 注册的）。

   链子：source → gain(音量) → worklet → gain(0) → destination
     · 头一个 gain 是**音量**：worklet 发出去的是它读到的样点，所以在这个节点上
       缩放，缩的就是递给代理、终端会听见的那一份。播放中拧它立刻见效 ——
       它跟 source 是分开的两颗节点，换 source（拖进度条）也带不走它。
     · 末尾那个 0 增益是**本机静音**（用户定的），和麦克风那条同一个做法。 */
async function playCtxMake(){
  const ctx = new (window.AudioContext || window.webkitAudioContext)({sampleRate: PLAY_RATE});
  let node;
  if (playWorkletOK()){
    await ctx.audioWorklet.addModule(liveWorkletURL());
    node = new AudioWorkletNode(ctx, "pcm16");
  } else {
    /* 非安全上下文（明文 http）没有 AudioWorklet，退到 ScriptProcessorNode。
       它跑在主线程，标签页切到后台可能被节流成一大块一大块 —— 但对讲本来也用不了
       麦克风，这一页在这里能有声音就已经是全部了。回调里做的裁剪和打包跟 worklet
       源码（LIVE_WORKLET_SRC）一模一样，别改一处忘一处。 */
    node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = e => playTap(e.inputBuffer.getChannelData(0));
  }
  const vol  = ctx.createGain();
  vol.gain.value = playVolOf(playState());
  const sink = ctx.createGain();
  sink.gain.value = 0;                       /* 本机不出声（用户定的） */
  vol.connect(node); node.connect(sink); sink.connect(ctx.destination);
  return {ctx, node, sink, vol};
}

/* 音量那枚节点的值（0-1）。状态里存 0-100 的整数，是因为界面上那一格是百分比。 */
function playVolOf(st){
  return Math.min(Math.max(Number(st.vol) || 0, 0), 100) / 100;
}
/* 拧音量。**只在节点在的时候动它** —— 没在放的时候节点是空的，值留在状态里，
   下次起播由 playCtxMake 按状态里的数初始化。
   走 setTargetAtTime（10ms 抹过去）不走直接赋值：直接赋值是一步跳过去，
   音量从 100 猛拉到 20 会「啪」一声。 */
function playVolApply(){
  const g = playGain, ctx = playCtx;
  if (!g || !ctx) return;
  const v = playVolOf(playState());
  try { g.gain.setTargetAtTime(v, ctx.currentTime, 0.01); }
  catch(e){ try { g.gain.value = v; } catch(e2){} }
}

/* 两根音量滑杆（标题栏那根横的、喇叭底下那根竖的）共用这一下：状态里存数、
   两处百分比和两根滑杆的值一起跟上，再拧增益节点。不重画页面 —— 正被拖着的那根
   会被整个换掉，手一松就断了。 */
function playVolInput(st, box, v){
  st.vol = Math.min(Math.max(Number(v) || 0, 0), 100);
  const tx = box.querySelector("#playVolTx");
  if (tx) tx.textContent = st.vol + "%";
  const tx2 = box.querySelector("#playVolPopTx");
  if (tx2) tx2.textContent = st.vol + "%";
  const a = box.querySelector("#playVol");
  if (a){
    a.value = st.vol;
    /* 竖屏那根自绘滑杆的「已选那段」靠这个变量（见 css 的 ::-webkit-slider-track）。 */
    a.style.setProperty("--p", st.vol + "%");
  }
  const b = box.querySelector("#playVol2");
  if (b) b.value = st.vol;
  playVolApply();
}

/* ── 竖屏音量条左边那枚喇叭：点一下静音，再点一下恢复 ────────────────
   静音＝把音量条归零（滑杆、百分比、推给终端的那一档一起归零），图标换成
   带斜线的喇叭；再点一下回到静音前那一档，图标也回去。状态存在 playState 里，
   页面重画后图标仍然对得上。 */
function playVolPaintMute(st, box){
  const btn = box && box.querySelector("#playVolMute");
  if (!btn) return;
  const tx = st.volMuted ? "取消静音" : "静音";
  btn.innerHTML = st.volMuted ? ICON.volumeX : ICON.volume;
  btn.title = tx;
  btn.setAttribute("aria-label", tx);
  btn.setAttribute("aria-pressed", st.volMuted ? "true" : "false");
}
function playVolMuteSet(st, box, on){
  st.volMuted = !!on;
  playVolPaintMute(st, box);
}
function playVolToggleMute(st, box){
  if (st.volMuted){
    playVolInput(st, box, st.volPrev || 0);
    playVolMuteSet(st, box, false);
  } else {
    st.volPrev = st.vol;
    playVolInput(st, box, 0);
    playVolMuteSet(st, box, true);
  }
}

/* 点到竖音量条外面就收起它。**只在 playBind 里挂一次**（每次重画都会跑到那儿），
   用捕获阶段，免得被页面上别处的 stopPropagation 挡住。 */
let playVolOutsideBound = false;
function playVolOutside(e){
  const pop = $("#playVolPop");
  if (!pop || pop.hidden) return;
  const btn = $("#playVolBtn");
  if (pop.contains(e.target) || (btn && btn.contains(e.target))) return;
  pop.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

/* 横屏那枚喇叭钉在**进度条左端**的下面（用户定的），弹出的横条紧贴它右侧。
   两行的宽度规则不一样（.pl-line 有 700px 上限还居中，左边的读数还会变宽），
   所以量出来再钉，不硬算。窗口改宽窄时再量一次。 */
let playVolAlignBound = false;
function playVolAlign(){
  const box = $("#main"); if (!box) return;
  const b = box.querySelector("#playVolBtn");
  const sc = box.querySelector("#playScrub");
  const c = box.querySelector(".pl-ctrl");
  if (!b || !sc || !c) return;
  const cr = c.getBoundingClientRect();
  /* 再往左让出 16px（用户定的：先 20 再回来 4）：正对进度条左端看着偏右，
     退一点刚好压在左边那枚时间读数的右半边上。 */
  const off = Math.max(0, Math.round(sc.getBoundingClientRect().left - cr.left) - 16);
  b.style.left = off + "px";
  const pop = box.querySelector("#playVolPop");
  if (pop){
    const left = off + 32;   /* 用户定的最终值（喇叭本身无边框，压住看不出） */
    pop.style.left = left + "px";
    pop.style.width = Math.max(110, Math.min(190, Math.round(cr.width - left - 2))) + "px";
  }
}

/* 一帧 PCM 推给代理。只有「正在播」才推：暂停时音频线程本来就停了（suspend），
   但拖动和起播的空档也得挡住，不然代理会收到上一段的残帧。 */
/* 把一包样点递给代理。worklet 那条（playFeed）和 ScriptProcessor 那条（playTap）
   最后都到这儿，守卫只此一份。
   更多功能里的「终端测试」也走这条通道，但它有自己的相位判断，所以把「只检查
   连接」这一半单独摘出来给两边共用。 */
function liveSendPcm(buf){
  if (!liveSock || liveSock.readyState !== 1) return;
  try { liveSock.send(buf); } catch(err){}
}
function playSend(buf){
  if (playState().phase !== "playing") return;
  liveSendPcm(buf);
}
function playFeed(e){ playSend(e.data); }
/* ScriptProcessorNode 那条路：Float32 裁到 [-1,1] 再转 16 位，和 LIVE_WORKLET_SRC
   里那段逐行对应（包括负数那半取 0x8000）—— 改一处记得改另一处。 */
function playTap(ch){
  if (!ch || !ch.length) return;
  const out = new Int16Array(ch.length);
  for (let i = 0; i < ch.length; i++){
    let v = ch[i];
    v = v < -1 ? -1 : v > 1 ? 1 : v;
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  playSend(out);
}

/* 降成单声道：worklet 只读第一条声道（inputs[0][0]），立体声文件直接喂进去，
   右声道那一路就整条丢了。平均一下是这条 16k 单声道链路能做的、最不挑文件的一种降法。
   解码是在 16k 的 context 上做的，所以这个 buffer 一般已经是 16k；万一某个浏览器
   还是按文件本来的采样率给（dec.sampleRate 不等于 16000），也不用管 ——
   AudioBufferSourceNode 起播时自己会重采样，音高和时长都是对的。 */
function playMono(dec){
  const n = dec.length, nch = dec.numberOfChannels;
  const out = new AudioBuffer({length:n, sampleRate:dec.sampleRate, numberOfChannels:1});
  const dst = out.getChannelData(0);
  for (let c=0; c<nch; c++){
    const src = dec.getChannelData(c);
    for (let i=0; i<n; i++) dst[i] += src[i]/nch;
  }
  return out;
}

/* 选文件那道口子**只放音频进来**。
   两件事一起做：`accept` 只是文件对话框的**过滤器**（多数系统上都能切成「所有文件」
   绕过去），所以选回来还得自己再判一次 —— 判不过就当没选，状态行照旧那套口径
   把话说在转盘底下。

   判据两条，任一条成立就算过：
     · 浏览器给了 audio/* 的 MIME（Chrome／Safari 对常见格式都会给）；
     · 或者扩展名在白名单里 —— 有些系统对 .m4a、.flac 这类干脆不给 MIME
       （file.type 是空串），只看 MIME 会把正常音频挡在外面。
   不收 mp4／webm：它们解码也能出声音，但那是视频，不是这一页要的东西。 */
const PLAY_EXT = ["mp3","wav","m4a","aac","flac","ogg","oga","opus","wma","aif","aiff","amr","ape"];
function playIsAudio(f){
  if (f.type && f.type.indexOf("audio/") === 0) return true;
  const m = /\.([a-z0-9]+)$/i.exec(f.name || "");
  return !!m && PLAY_EXT.indexOf(m[1].toLowerCase()) >= 0;
}
/* 给 accept 用。⚠ **只列扩展名，一个字都不许写 audio/*** —— 写了 mp4 就能选。
   这条路是这么绕回来的（2026-10-17 用户报「还是能选 mp4」时查出来的，别再改回去）：
   Chrome 把 `audio/*` 展开成 kStandardAudioTypes 里那串 `audio/…` 标准类型再去问系统，
   其中 **`audio/mp4` 在 macOS 上解析成 public.mpeg-4-audio，而那个 UTI 声明的扩展名
   恰恰是 `mp4, mpg4`**；Chrome 拿到扩展名又换回 UTI，落回 public.mpeg-4 ——
   NSOpenPanel 手里于是多了一条 public.mpeg-4，.mp4 文件就不灰了。
   只列扩展名没有这条来回：.m4a 在这台机器上解析成 com.apple.m4a-audio，
   和 public.mpeg-4 是两支，点不动 .mp4（`mdls -name kMDItemContentType` 实测）。
   至于别的系统把对话框切成「所有文件」，accept 管不着 —— 那道门由 playIsAudio() 把着。 */
const PLAY_ACCEPT = PLAY_EXT.map(e=>"."+e).join(",");

/* 读一个文件 + 解码，**只回一项，什么状态都不碰** —— 不写 phase、不写 cur、不写 pos、
   不写 err。旧版那个 playLoadFile 在失败那两句里把 phase 打成 idle，播放中挑到一个
   坏文件就是：playFeed 立刻不再推帧（**终端当场静音，任务还挂着送静音**）、顶栏那枚
   胶囊消失、进度条跳回零、rAF 链断掉。读文件和起播是两件事，从这儿起分开。
   （返回 null 就是「这个读不出来」，由调用方去数、去说。）

   解码仍然在**选完文件那一刻**做（不在按播放那一刻）：解码是异步的，等它回来，
   用户那次点击的「手势」早过期了（Safari 尤其严），AudioContext 会以 suspended 起来、
   之后再也叫不醒 —— 按播放就成了按了没反应。在这儿解完，按播放时就只剩
   「建 source → 起」这么点同步活。
   在 16k 的 OfflineAudioContext 上解，浏览器顺手按它的采样率重采样下来。 */
async function playLoadOne(f){
  try {
    const ab = await f.arrayBuffer();
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const dec = await new OAC(1, 1, PLAY_RATE).decodeAudioData(ab);
    return {uid: ++playUid, name: f.name, size: f.size, dur: dec.duration, buf: playMono(dec)};
  } catch(e){
    return null;
  }
}

/* 往单子上加东西：一次可能来一串（多选），**逐个读、逐个堆** —— 解完一个就画出来，
   不用等整串完事。两件事要守住：
     1. **一个字都不许碰 phase**（见 playState 里 reading 那段）。播放中加文件，
        歌得照放。
     2. **解码完成不走 renderMain()**：播放中正拖着进度条或音量滑杆的时候重画整页，
        节点被换掉，手就丢了（进度条还会拿到 width:0，把进度跳到 0 秒）。
        所以只定点重画列表和底下那行小字。
   读不成的**走 toast 不走 st.err**：那行字在播放中写着正经状态，不能被一句抱怨盖掉。 */
async function playAddFiles(st, files){
  const all = Array.prototype.slice.call(files || []);
  if (!all.length) return;
  let notAudio = 0, tooBig = 0, bad = 0, full = 0;
  st.reading = {done: 0, total: all.length};
  playReadDraw(st);
  for (let k = 0; k < all.length; k++){
    const f = all[k];
    if (!playIsAudio(f)) notAudio++;
    else if (f.size > PLAY_FILE_MAX) tooBig++;
    else if (st.list.length >= PLAY_LIST_MAX) full++;
    else {
      const it = await playLoadOne(f);
      if (!it) bad++;
      /* 解出来才知道真正占多少，所以内存这一道卡在解完之后 */
      else if (playBytes(st) + it.buf.length*4 > PLAY_MEM_MAX) full++;
      else { st.list.push(it); playListDraw(st); }
    }
    st.reading.done++;
    playReadDraw(st);
  }
  st.reading = null;
  playListDraw(st); playReadDraw(st);
  const notes = [];
  if (notAudio) notes.push(notAudio+" 个不是音频文件");
  if (tooBig)   notes.push(tooBig+" 个超过 "+Math.round(PLAY_FILE_MAX/1024/1024)+" MB");
  if (bad)      notes.push(bad+" 个读不出来");
  if (full)     notes.push(full+" 个放不下了（一张单子最多 "+PLAY_LIST_MAX+" 首、合计 "
                          +Math.round(PLAY_MEM_MAX/1024/1024)+" MB）");
  /* 全加成了就什么都不说 —— 列表里多出来的那几行就是回话。 */
  if (notes.length) toast("跳过了："+notes.join("、"), "err");
}

/* 这一项是不是「当前这一项」—— 单子上高亮、垃圾桶禁用都看它。
   没在放（idle／ready）时 cur 还留着（按播放好从这一首接着来），但**不高亮**：
   高亮说的是「这会儿正放着的是它」。 */
function playIsActive(st, it){
  return it === st.cur && (st.phase === "connecting" || st.phase === "playing" || st.phase === "paused");
}
/* 那一枚播放键的提示语：正在放的写「正在播放」（点它不重来），暂停着的写「继续」。 */
function playGoTitle(st, it){
  const act = playIsActive(st, it);
  if (act && st.phase === "paused")  return "继续播放这一首";
  if (act && st.phase === "playing") return "正在播放这一首";
  return "播放这一首";
}

/* 单子里的一行。**正在放的那一项**底色是浅重点色（用户定的），它的垃圾桶禁用
   （也是用户定的：脚下的地不能自己抽）。点行别处什么都不做 —— 只有左边那枚
   播放键才切歌。 */
function playRowHTML(st, it){
  const active = playIsActive(st, it);
  return '<div class="pl-row'+(active ? " cur" : "")+'">'+
    '<span class="nm" title="'+esc(it.name)+'">'+esc(it.name)+'</span>'+
    '<span class="meta">'+playClock(it.dur)+'</span>'+
    '<span class="pl-acts">'+
      '<button class="cell-btn" data-pl="go" data-uid="'+it.uid+'" title="'+
        playGoTitle(st, it)+'">'+ICON.play+'</button>'+
      '<button class="cell-btn danger" data-pl="del" data-uid="'+it.uid+'"'+
        (active ? " disabled" : "")+' title="'+
        (active ? "正在播放的这一项不能删除" : "从列表中删除")+'">'+ICON.del+'</button>'+
    '</span>'+
  '</div>';
}
function playRowsHTML(st){
  let h = "";
  for (let i = 0; i < st.list.length; i++) h += playRowHTML(st, st.list[i]);
  return h;
}
/* 只重画列表这一块（容器本身不换，滚动位置和拖拽都不受影响）。
   单子空了就把它和上头那条分隔线一起收起来。 */
/* 右边那一栈（竖屏是下面那一栈）该不该露面：单子有东西，或者正在读文件（那时
   底下那行小字有话说）。**连分隔线一起收** —— 横屏上这一栈是条固定宽度的栏，
   空着还占着，播放器就被挤到左边去了。 */
function playSideDraw(st){
  const on = !!(st.list.length || st.reading);
  const side = $("#playSide");
  if (side){
    /* 空单子也**不藏**：竖屏上它是要吃掉剩余高度的占位（把控件顶到底部），
       宽屏上由 CSS 那一档 display:none 收掉。 */
    side.hidden = false;
    side.classList.toggle("empty", !on);
  }
  const sep  = $("#playDiv");  if (sep)  sep.hidden  = !on;
  /* 右栏一露面，播放器那一栈就变窄，进度条的位置跟着挪 —— 喇叭是照实测位置
     钉的，得在这时候重量一次，不然它会停在前一版的横坐标上。 */
  playVolAlign();
}
function playListDraw(st){
  const box = $("#playList"); if (!box) return;
  const has = st.list.length > 0;
  box.hidden = !has;
  box.innerHTML = has ? playRowsHTML(st) : "";
  playSideDraw(st);
}
/* 列表底下那行小字：**只在解码时说一句进度**，其余时候一个字都不占。
   空单子不写字（用户明确不要）—— 上面那行「未在播放」和标题栏那枚「添加文件」
   已经把话说完了，再补一句是重复的。 */
function playReadText(st){
  return st.reading ? "正在读取文件… "+st.reading.done+"/"+st.reading.total : "";
}
function playReadDraw(st){
  const el = $("#playRead"); if (!el) return;
  const txt = playReadText(st);
  el.textContent = txt;
  el.hidden = !txt;
  playSideDraw(st);
}

/* 起播：先跟代理开一路任务（和对讲同一个 call），再让本机这条链路出声。
   顺序不能反 —— 代理那边没开成，本机就不该先放起来。 */
async function playStart(st){
  if (st.busy) return;
  if (st.phase === "connecting") return;
  /* 「更多功能 → 终端测试」也占着代理那一条会话，先让它停。 */
  if (moreTestRunning()){
    st.err = "正在测试中，先停止测试"; renderMain(); return;
  }
  /* 代理同一时刻只有一条会话：通话中不许起播（另一头在 liveCall 里挡着）。 */
  const lv = liveState();
  if (lv.phase === "calling" || lv.phase === "talking"){
    st.err = "正在通话中，先挂断再播放"; renderMain(); return;
  }
  /* 没挑过哪一首就是第一首（单子在那儿摆着，按播放总得放点什么）。 */
  if (!st.cur && st.list.length) st.cur = st.list[0];
  const it = playCur(st);
  if (!it){ st.err = "还没有添加音频"; renderMain(); return; }
  const tgt = playTarget(st);
  if (!tgt){
    st.err = liveChosen(st.area) ? "选中的分组里没有终端" : "还没有选终端";
    renderMain(); return;
  }

  st.busy = true; st.err = ""; st.phase = "connecting"; renderMain();

  /* 从这里到起播之间有三段 await（问地址、搭音频链路、跟代理开那一路任务），
     每一段回来都得先问一句「这一趟还算数吗」。**不算数的情形是有的**：人在这中间
     按了「停止」（playStop 会把它打回 idle、并把这一路撤掉），或者按了停止又按了
     播放（那时 op 已经翻到新的一趟上）。不查的话，这个还挂在 await 上的 playStart
     会接着把 call 发出去 —— 面板上写着「未在播放」，终端却响起来了。 */
  const op = ++playOp;
  const alive = ()=> op === playOp && st.phase === "connecting";

  const noAddr = await liveEnsureAddr();
  if (!alive()) return;
  if (noAddr){
    st.busy = false; st.phase = "ready"; st.err = noAddr; renderMain(); return;
  }
  /* 搭本机这条链路。这一步和「连代理」是两件不同的死法（一个是浏览器起不来音频，
     一个是代理没回应），所以两句分开说 —— 合成一句会把人指错方向。 */
  let g;
  try {
    g = await playCtxMake();
  } catch(e){
    st.busy = false; st.phase = "ready";
    st.err = "本机音频起不来，换个浏览器试试"; renderMain(); return;
  }
  if (!alive()){ try { const p = g.ctx.close(); if (p && p.catch) p.catch(()=>{}); } catch(e){} return; }
  playCtx = g.ctx; playNode = g.node; playSink = g.sink; playGain = g.vol;
  /* worklet 那条把每 128 个样点丢过来；ScriptProcessor 那条的回调在
     playCtxMake 里已经挂好了（它是 node 自己的 onaudioprocess）。 */
  if (playNode.port) playNode.port.onmessage = playFeed;
  if (playCtx.state === "suspended") { try { await playCtx.resume(); } catch(e){} }
  try {
    await liveRequest("call", {
      ws: S.wsIp, udp: liveAudioTarget(), token: S.token,
      /* endpoints 必须是**字符串**数组（代理那边是 []string），见 liveCall 里那段。 */
      endpoints: tgt.ids.map(String), names: tgt.names
    });
  } catch(e){
    playTeardown(false);
    st.busy = false; st.phase = "ready";
    /* 用户定的文案，和对讲那句一字不差 —— 两页说的是同一个死法。 */
    st.err = "连接播放代理失败!";
    renderMain(); return;
  }
  /* 这一趟是在「连接中」被人按了停止的：代理那一路刚开起来，得撤掉，
     不然它会一直以 100 包/秒往终端送静音。 */
  if (!alive()){ playTeardown(true); return; }
  playN = tgt.ids.length;
  st.busy = false; st.phase = "playing";
  /* 停在末尾（拖到尾巴上）时从头来，不然一按播放就立刻跳下一首。 */
  playSource(st, st.pos >= it.dur ? 0 : st.pos);
  renderMain();
}

/* 起一个 source：offset 是「从第几秒开始放」。会先把上一个停掉 —— 拖进度条走的就是
   这条路。onended 靠代次号（playGen）认领：自己 stop() 的那几次代次已经翻过去了，
   回来不处理；只有真放到底那一次才算「播完」。 */
function playSource(st, offset){
  const it = playCur(st);
  if (!playCtx || !it) return;
  if (playSrc){
    try { playSrc.onended = null; playSrc.stop(); } catch(e){}
    try { playSrc.disconnect(); } catch(e){}
    playSrc = null;
  }
  const gen = ++playGen;
  const s = playCtx.createBufferSource();
  s.buffer = it.buf;
  s.connect(playGain);            /* 进的是音量那枚节点，不是 worklet 本身 */
  s.onended = ()=>{ if (gen === playGen) playDone(); };
  const at = Math.min(Math.max(offset, 0), it.dur);
  s.start(0, at);
  playSrc = s;
  playAt = playCtx.currentTime - at;
  st.pos = at;
}

/* 这会儿放到第几秒了。音频时钟是唯一的出处 —— 暂停时 currentTime 冻住，
   所以暂停、拖动、继续三种情况都不用另记一个数（playAt 跟着一起挪）。 */
function playElapsed(){
  const st = playState();
  const it = playCur(st);
  if (playCtx && (st.phase === "playing" || st.phase === "paused"))
    return Math.min(Math.max(playCtx.currentTime - playAt, 0), it ? it.dur : 0);
  return st.pos;
}

/* 暂停＝suspend()。音频线程一停，worklet 就不再出帧，代理那头缓冲见底就开始往终端
   送静音 —— 终端安静，而**那一路任务还挂着**（继续播只要 resume，不用再跟代理说话）。
   不走 mute 命令：它会把代理已经攒下的那点缓冲清掉（见 audio.go 的 setMuted），
   一暂停就丢一截声音。 */
function playPause(st){
  if (st.phase !== "playing" || !playCtx) return;
  st.pos = playElapsed();
  st.phase = "paused";
  playRafStop();
  try { playCtx.suspend(); } catch(e){}
  renderMain();
}
function playResume(st){
  if (st.phase !== "paused" || !playCtx) return;
  st.phase = "playing";
  try { playCtx.resume(); } catch(e){}
  renderMain();
}

/* 停止：本地收干净，**并且**让代理把那一路任务撤掉。不发 hangup 的话代理会一直
   挂着任务、以 100 包/秒往终端送静音，人走了声音没了，可那条线还开着。
   进度回零（用户点「停止」的意思是「这一条到此为止」，再按播放从头来）。 */
function playStop(st){
  const was = st.phase;
  if (was === "idle" || was === "ready") return;
  const live = was === "connecting" || was === "playing" || was === "paused";
  st.pos = 0; st.phase = "idle"; st.err = "";
  /* busy 也归零：停在「正在连接」那一刻按停止的话，还挂在 await 上的那一趟
     playStart 是靠 playTeardown 里那句 playOp++ 作废的，而它自己不会再去动 busy ——
     不收的话「播放」那枚键从此按不动了。 */
  st.busy = false;
  playTeardown(live);
  renderMain();
}

/* 下一首该放哪个（没有就是 null）。五种模式就差在「一遍还是绕圈」和「一张单子还是
   这一首」两件事上，见界面上那枚模式键的五个图标。 */
function playNextItem(st){
  const n = st.list.length;
  if (!n) return null;
  const i = playCurIdx(st);
  if (st.mode === "one-loop") return st.cur || st.list[0];   /* 就这一首，从头再来 */
  if (st.mode === "one")      return null;                   /* 放完就停 */
  /* 随机：一直继续（相当于随机循环），但单子里不止一首时不挑回刚放的那一首。 */
  if (st.mode === "shuffle"){
    if (n === 1 || i < 0) return st.list[0];
    let k = i;
    while (k === i) k = Math.floor(Math.random()*n);
    return st.list[k];
  }
  if (i < 0) return st.list[0];
  if (i + 1 < n) return st.list[i+1];
  return st.mode === "loop" ? st.list[0] : null;   /* 列表循环回头，列表播放到头就停 */
}

/* 一首放到底了。**换下一首不重连代理** —— 任务和那几个终端都没变，换的只是一段音源；
   重连要等一秒、还白响一声静音。没有下一首就收摊，回「未在播放」（用户定的词表：
   放完和按停止是同一句话、同一个归宿，所以没有单独的「播放完毕」那一档）。 */
function playDone(){
  const st = playState();
  if (st.phase !== "playing") return;     /* 自己 stop() 的那几次，代次号已经把它挡在外面 */
  const nx = playNextItem(st);
  if (!nx){
    st.pos = 0; st.phase = "idle";
    playTeardown(true);
    renderMain(); return;
  }
  st.cur = nx;
  playSource(st, 0);
  renderMain();
}

/* 点列表里某一首的播放键 —— **只有这一枚键才切歌**（用户定的：点行别处不算）。
   起播之后切歌就走「换音源」那条路：代理那一路是同一批终端，不用也不该重开。 */
function playItem(st, uid){
  const it = playFind(st, uid);
  if (!it) return;
  /* 「正在连接」那一段要明确拒绝，**绝不能先把 cur 换掉**：在途的那一趟 playStart
     从 await 里回来时 alive() 还是真，会照着刚点的这一首起播 —— 面板上写的和实际
     响的对不上。 */
  if (st.phase === "connecting"){ toast("正在连接，稍等一下", "err"); return; }
  /* 点的就是这一首：正在放的不重来（要重来先按停止），暂停着的就接着放。 */
  if (it === st.cur){
    if (st.phase === "playing") return;
    if (st.phase === "paused"){ playResume(st); return; }
  }
  if (st.phase === "playing" || st.phase === "paused"){
    st.err = "";
    /* st.cur 和 playSource 必须同一个同步 tick 里做完：中间要是插了 await，
       playElapsed/playPaint 会拿新曲目的 dur 配旧曲目的 playAt，进度条当场乱跳。 */
    st.cur = it;
    playSource(st, 0);
    if (st.phase === "paused") playResume(st);   /* 那枚键是三角，点了就该出声 */
    else renderMain();
    return;
  }
  st.cur = it;
  playStart(st);
}

/* 从单子上删一项。**正在播的那一项不许删**（用户定的）—— 宽屏上垃圾桶是灰的、
   窄屏上 ⋯ 菜单里那一项也是灰的，这儿再挡一道（菜单也可能是上一帧开的）。 */
function playDel(st, uid){
  const it = playFind(st, uid);
  if (!it) return;
  if (playIsActive(st, it)){ toast("正在播放的这一首不能删除", "err"); return; }
  /* 原地 splice，不整体换一个新数组 —— 别处闭包里攥着的是同一个引用。 */
  st.list.splice(st.list.indexOf(it), 1);
  it.buf = null;                      /* 显式放掉那几兆 */
  if (it === st.cur) st.cur = null;   /* 只是在没在放的时候被选中的话，松开 */
  playListDraw(st); playReadDraw(st);
}

/* 换一档播放模式。**只动那一枚键**：整页重画会把底下正拖着的东西打断，
   而这儿只是换个图标的事。 */
function playModeNext(st){
  let i = -1;
  for (let k = 0; k < PLAY_MODES.length; k++) if (PLAY_MODES[k].k === st.mode) i = k;
  const m = PLAY_MODES[(i + 1) % PLAY_MODES.length];
  st.mode = m.k;
  const b = $("#playMode");
  if (b){
    b.innerHTML = m.icon;
    b.title = m.name;
    b.setAttribute("aria-label", m.name);
  }
  /* 左边那行小字和那枚键是一件事的两半，一起换。 */
  const tx = $("#playModeTx");
  if (tx) tx.textContent = m.name;
}

/* 本地这条链路收干净；hangup 为真时顺带让代理把任务撤了（发不出去就算了，
   连接都断了的时候没什么可做的）。 */
function playTeardown(hangup){
  playRafStop();
  playGen++;                                   /* 把在途的 onended 作废 */
  playOp++;                                    /* 把在途的 playStart 一并作废（见那个函数） */
  if (playSrc){
    try { playSrc.onended = null; playSrc.stop(); } catch(e){}
    try { playSrc.disconnect(); } catch(e){}
    playSrc = null;
  }
  if (playNode){
    /* worklet 那只有 port；ScriptProcessor 那只只有 onaudioprocess（两条路都清干净）。 */
    try { if (playNode.port) playNode.port.onmessage = null; } catch(e){}
    try { playNode.onaudioprocess = null; } catch(e){}
    try { playNode.disconnect(); } catch(e){}
    playNode = null;
  }
  if (playSink){ try { playSink.disconnect(); } catch(e){} playSink = null; }
  if (playGain){ try { playGain.disconnect(); } catch(e){} playGain = null; }
  const ctx = playCtx; playCtx = null;
  if (ctx){
    try { const p = ctx.close(); if (p && p.catch) p.catch(()=>{}); } catch(e){}
  }
  if (hangup) liveRequest("hangup", {}).catch(()=>{});
}

/* 拖动进度条：停掉上一段，按新位置再起一个。暂停着拖也成 —— context 还 suspended
   着，新的 source 会在 resume 那一刻从这个位置接上（playAt 用的是冻住的 currentTime）。 */
function playSeekTo(st, sec){
  const it = playCur(st);
  if (!it) return;
  const at = Math.min(Math.max(sec, 0), it.dur);
  if (st.phase === "playing" || st.phase === "paused") playSource(st, at);
  else st.pos = at;
  playPaint();
}

/* 把进度画到进度条上：**只改这几个节点，不重画整页** —— 一秒六十次 renderMain
   会把按钮的点击和滚动位置一起冲掉。页面不在这几个节点上（人切走了）返回 false，
   调用方据此把 rAF 停下来。 */
function playPaint(){
  const fill = $("#playFill");
  if (!fill) return false;
  const st = playState();
  const it  = playCur(st);
  const dur = it ? it.dur : 0;
  const el  = Math.min(playElapsed(), dur);
  const pc  = dur ? (el / dur * 100) : 0;
  fill.style.width = pc + "%";
  const knob = $("#playKnob"); if (knob) knob.style.left = pc + "%";
  const cur  = $("#playCur");  if (cur)  cur.textContent = playClock(el);
  return true;
}
function playRafStop(){ if (playRaf){ cancelAnimationFrame(playRaf); playRaf = 0; } }
/* 播放中才转的那口气。切到别的页时 #main 里没有那些节点，playPaint 返回 false，
   这一口气就自己停了 —— 声音照旧走（音频线程才是这条会话的时钟），
   人切回来时 renderPlayback 末尾会再把它叫醒。 */
function playTick(){
  playRaf = 0;
  if (playState().phase !== "playing") return;
  if (!playPaint()) return;
  playRaf = requestAnimationFrame(playTick);
}

/* 播放器里的时间读法（3:45 / 1:02:03）。和表格里那套 HH:MM:SS（secToHMS）不同 ——
   那个不足一小时也写着 00:，进度条底下一行「00:03:45 / 00:04:12」太吵。 */
function playClock(s){
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s/3600);
  return (h ? h+":"+pad(Math.floor(s%3600/60)) : String(Math.floor(s%3600/60))) + ":" + pad(s%60);
}

/* ══ 页面 ═══════════════════════════════════════════════════════════
   和对讲那一页同一套骨架（.headfix + .sec-head + .page-body），但**不挂 .is-fill**：
   那一档要的是「一屏装下」（每个 .panel-body 都被压成 flex:none），这一页比一屏高，
   让它整页跟着滚就行 —— 底距由 .main-inner.headfix > .page-body 自带的那 80px
   管着（竖屏那一档是 90px）。 */
function renderPlayback(){
  const el = $("#main"); if (!el) return;
  if (proxyBlocksMedia()){ renderProxyBlocked(el, "在线播放"); return; }
  const st = playState();
  el.classList.add("headfix");
  el.innerHTML =
    '<div class="sec-head">'+
      '<div class="title-row"><h2 class="serif">在线播放</h2></div>'+
    '</div>'+
    /* play-page：横屏时播放器那一栏要吃页面剩下的高度（见 css 那一档）。 */
    '<div class="page-body play-page">'+
      playAreaHTML(st)+
      playDeckHTML(st)+
    '</div>';
  playBind(st);
}

/* 面板一：播放区域。一排可点的胶囊（带 ×，点掉一颗就是把那个终端／分组从这一条里
   去掉），「选择区域」挂在标题栏右端（用户定的版式：这一块只有一处动作，摆到标题
   那一行去，底下就只剩内容本身）。 */
function playAreaHTML(st){
  return '<div class="panel">'+
    '<div class="panel-head"><h3>播放区域</h3>'+
      '<span class="acts"><button class="btn btn-sm" id="playArea">选择区域</button></span>'+
    '</div>'+
    '<div class="panel-body">'+
      '<div class="area-chips">'+
        (liveChosen(st.area) ? areaChips(st.area, true) : '<span class="chip chip-ph">未设置区域</span>')+
      '</div>'+
    '</div>'+
  '</div>';
}

/* 面板二：播放器。转盘 · 状态行 · 进度条 · 传输键 · 分隔线 · 单子。
   「音频文件」原来单摆一块，现在并进这儿了（用户定的）：添加那枚按钮挂标题栏右端，
   单子摆在传输键底下 —— 播放器本来就该显示「在放什么」。**按钮永远叫「添加文件」**：
   一次能多选、也能一回回往上加，它是「加」不是「换」。**文件不出这台机器。**

   转盘「播放时转、不播放就停」是靠 animation-play-state —— 停的时候**停在原地**
   而不是回到零度（用 delay 把角度对到当前进度上，见下面那句 inline style）。
   页面每重画一次节点都是新的，动画会从零开始，所以那个角度每次都得重新对一遍。 */
function playDeckHTML(st){
  const it  = playCur(st);
  const dur = it ? it.dur : 0;
  const playing = st.phase === "playing";
  const mode = playModeOf(st);
  /* 右边那一栈（竖屏是下面那一栈）在不在：单子有东西，或者正在读文件（那时底下
     那行小字有话说）。空着就整栈连分隔线一起收 —— 横屏上它是一条固定宽度的栏，
     收不干净就会把播放器挤到左边去。 */
  const side = !!(st.list.length || st.reading);
  return '<div class="panel">'+
    /* 标题「播放器」（用户定的：横屏下加回来）。竖屏这个位置是音量的滑杆，
       不显示它；横屏音量挪到停止键旁边去了，左上角空出来正好放标题。 */
    '<div class="panel-head">'+
      '<h3 class="pl-h">播放器</h3>'+
      /* 音量调的是**推给终端的那一份**（本机一直不出声），所以在播放中拧也有用 ——
         它改的是喂给 worklet 之前那个增益节点，下一帧就见效，不用停、不用重连。 */
      '<div class="pl-vol">'+
        '<button class="pl-vol-mute" id="playVolMute" type="button" title="'+
          (st.volMuted ? "取消静音" : "静音")+'" aria-label="'+
          (st.volMuted ? "取消静音" : "静音")+'" aria-pressed="'+
          (st.volMuted ? "true" : "false")+'">'+
          (st.volMuted ? ICON.volumeX : ICON.volume)+
        '</button>'+
        '<input type="range" id="playVol" min="0" max="100" step="1" value="'+st.vol+'"'+
          ' aria-label="音量" title="音量">'+
        '<span class="pc" id="playVolTx">'+st.vol+'%</span>'+
      '</div>'+
      /* 项目里第一个 file input。**multiple**：一次能挑好几首（用户要的），
         挑完就清空它（见 playBind），不然再挑同一批文件 onchange 不触发。 */
      '<input type="file" id="playInput" accept="'+PLAY_ACCEPT+'" multiple hidden>'+
      /* 那枚「＋」是 ICON.plus（和「添加铃声」「添加设备」同一枚），**不是加号字符** ——
         ASCII 的 "+" 在 SF Pro 里是当运算符排的，左右自带一大截字边距，
         看着就是「＋　添加文件」中间空一格；图标没有这回事。 */
      '<span class="acts">'+
        '<button class="btn btn-sm btn-primary" id="playPick">'+ICON.plus+' 添加文件</button>'+
      '</span>'+
    '</div>'+
    /* 正文拆成两栈：**转盘和传输键**一栈，**单子**一栈，中间一道分隔线
       （用户定的）。竖屏（≤980px）上下摞着、线是横的；横屏（>980px）并排、
       线是竖的 —— 两档都只是 css，节点不动（见 app.css 的 .pl-deck 那几条）。 */
    '<div class="panel-body pl-deck">'+
      '<div class="pl-stack">'+
      '<div class="pl-disc'+(playing ? " on" : "")+'" style="animation-delay:-'+
        playElapsed().toFixed(2)+'s"><span class="hole"></span></div>'+
      playTipHTML(st)+
      /* 时间和进度条同一行、**分散在这条的两端**（用户定的），整行最多占正文
         min(100%,700px)（见 css 的 .pl-line）。
         时间放在 .pl-scrub **外面**是有讲究的：拖动是按 .pl-scrub 自己的矩形换算
         比例的（见 playBind 里那段），两个时间标签要是坐进去，比例就被它们带偏了。 */
      '<div class="pl-line">'+
        '<span class="pc" id="playCur">'+playClock(playElapsed())+'</span>'+
        '<div class="pl-scrub" id="playScrub">'+
          '<span class="tr"><i id="playFill"></i></span><b id="playKnob"></b>'+
        '</div>'+
        '<span class="pc">'+playClock(dur)+'</span>'+
      '</div>'+
      '<div class="pl-ctrl">'+
        /* 两枚侧键各占一格，**键底下**各写一行注解（用户定的）：模式键底下是当前
           是哪一档，停止键底下是「停止播放」。
           注解是绝对定位的（见 css 的 .pl-slot）：它比键宽，进正常流会把那一格
           撑开，三枚键就不是以它们自己为准居中了。模式名那行和那枚键是一件事的
           两半，换档时一起动（见 playModeNext），不重画整页。 */
        '<span class="pl-slot">'+
          '<button class="pl-btn side" id="playMode" title="'+esc(mode.name)+'"'+
            ' aria-label="'+esc(mode.name)+'">'+mode.icon+'</button>'+
          '<span class="lab" id="playModeTx">'+esc(mode.name)+'</span>'+
        '</span>'+
        '<button class="pl-btn'+(playing ? " on" : "")+'" id="playGo" title="'+
          (playing ? "暂停" : "播放")+'">'+(playing ? ICON.pause : ICON.play)+'</button>'+
        '<span class="pl-slot">'+
          '<button class="pl-btn quiet side" id="playStop" title="停止">'+ICON.stop+'</button>'+
          '<span class="lab">停止播放</span>'+
        '</span>'+
        /* 喇叭（只在横屏出现，见 CSS）：绝对定位钉在**进度条左端**的下面，
           **不进这一行的流** —— 三枚键的居中照旧以它们自己为准，它要占了正常
           位置就把整组顶歪了。左边那格由 playVolAlign 量出来（两行的宽度规则
           不一样：.pl-line 有 700px 上限还居中，硬算会错）。 */
        '<button class="pl-volbtn" id="playVolBtn" title="音量" aria-label="音量"'+
          ' aria-expanded="false">'+ICON.volume+'</button>'+
        /* 点开的音量条：紧贴喇叭右侧，横的一条。宽度由 playVolAlign 按剩余
           空间定（最宽 190px）—— 不越过组框（.panel 是 overflow:hidden）。 */
        '<div class="pl-volpop" id="playVolPop" hidden>'+
          '<input type="range" id="playVol2" min="0" max="100" step="1"'+
            ' value="'+st.vol+'" aria-label="音量" title="音量">'+
          '<span class="pc" id="playVolPopTx">'+st.vol+'%</span>'+
        '</div>'+
      '</div>'+   /* .pl-ctrl */
      '</div>'+   /* .pl-stack */
      /* 两栈之间那条分隔线（用户定的）：横屏竖着（并排）、竖屏横着（上下）。
         空单子的时候它和右边那一栈一起收起来，由 playSideDraw 管 ——
         它只动这几处，不重画整页。 */
      /* 空单子的时候分隔线收起来，右栏**留着** —— 竖屏上它是个占位，把播放
         控件顶到面板底部（用户定的）；宽屏上由 CSS 把它收掉（.pl-side.empty）。 */
      '<div class="divider" id="playDiv"'+(side ? "" : " hidden")+'></div>'+
      '<div class="pl-side'+(side ? "" : " empty")+'" id="playSide">'+
        '<div class="pl-list" id="playList"'+(st.list.length ? "" : " hidden")+'>'+
          playRowsHTML(st)+'</div>'+
        /* 单子底下那行小字：**只有解码进度**，不读文件的时候它整个不占地方。 */
        '<div class="hint" id="playRead"'+(playReadText(st) ? "" : " hidden")+'>'+
          esc(playReadText(st))+'</div>'+
      '</div>'+
    '</div>'+
  '</div>';
}

/* 五档播放模式。顺序就是点一下换下一档的顺序（用户列的那个顺序）。
   图标：一张单子 = list，这一首 = music，绕圈 = loop，绕的还是这一首 = repeat1，
   顺序打乱 = shuffle（后两枚是本项目新增的，照 lucide 原样）。 */
const PLAY_MODES = [
  {k:"list",     name:"列表播放", icon:ICON.list},
  {k:"loop",     name:"列表循环", icon:ICON.loop},
  {k:"one",      name:"单曲播放", icon:ICON.music},
  {k:"one-loop", name:"单曲循环", icon:ICON.repeat1},
  {k:"shuffle",  name:"随机播放", icon:ICON.shuffle}
];
function playModeOf(st){
  for (let i = 0; i < PLAY_MODES.length; i++) if (PLAY_MODES[i].k === st.mode) return PLAY_MODES[i];
  return PLAY_MODES[0];
}

/* 转盘底下那行字（用户要的：和拨号界面麦克风底下那行一样）。一个状态一句话，
   出错时**整行让给错误** —— 和 liveTipHTML 同一个写法、同一套配色（.live-tip
   那五档），样式一行都不用新写。

   **字面是用户定的**：「暂停就写已暂停，播放就写播放中，停止之后就写未在播放」——
   所以这儿只有「播放中 · 已推送到 N 个终端」「已暂停」「未在播放」三句，
   放完和按停止是同一句（列表播完、单曲播完都回 idle）。
   解码进度**不在这行**（它在单子底下那行小字里）：播放中也能加文件，
   这行那会儿正写着「播放中」，不能被一句读取进度盖掉。 */
function playTipHTML(st){
  let cls = "s-idle", txt = "未在播放";
  if (st.err){ cls = "s-bad"; txt = st.err; }
  else if (st.phase === "connecting"){ cls = "s-calling"; txt = "正在连接…"; }
  else if (st.phase === "playing"){ cls = "s-live"; txt = "播放中 · 已推送到 "+playN+" 个终端"; }
  else if (st.phase === "paused"){ cls = "s-muted"; txt = "已暂停"; }
  return '<div class="live-tip '+cls+'" title="'+esc(txt)+'">'+esc(txt)+'</div>';
}

function playBind(st){
  const box = $("#main"); if (!box) return;
  /* 放起来之后不许再改**区域**：这一路推到哪儿是起播那一刻定下的，改了也不会跟着变
     —— 让人以为改了，比直接说「不行」更糟。
     ⚠ **文件那一路不归这道闸管**：单子上的增删跟正在走的那一路没有关系（用户定的：
     播放中能加也能删），它有自己的守卫（见 #playPick 和 playDel）。 */
  const areaLocked = ()=> st.phase === "connecting" || st.phase === "playing" || st.phase === "paused";
  const denyArea = ()=>{ if (areaLocked()){ toast("播放中不能改区域，先按停止","err"); return true; } return false; };

  mountAreaChips(box, (k, n)=>{
    if (denyArea()) return;
    st.area[k] = st.area[k].filter(x=>x !== n);
    renderMain();
  });
  const area = box.querySelector("#playArea");
  if (area) area.onclick = ()=>{
    if (denyArea()) return;
    /* 那个编辑器是拿**全局** S.dt.area 当初值的，所以先把自己的这份放进去；
       回来时立刻拷一份出来 —— 不然它会被下一处开弹窗的当种子，也污染别处的初值。 */
    S.dt.area = {t: st.area.t.slice(), g: st.area.g.slice()};
    openAreaEditor("pick", null, a=>{
      st.area = {t: (a.t||[]).slice(), g: (a.g||[]).slice()};
      renderMain();
    });
  };

  const input = box.querySelector("#playInput");
  const pick  = box.querySelector("#playPick");
  if (pick && input){
    pick.onclick = ()=>{
      /* **只在「正在连接」那一段挡**：那会儿还挂在 await 上，单子这会儿不该动。
         播放中/暂停中不挡 —— 加进来的只是单子上多几行，碰不到正在走的那一路。 */
      if (st.phase === "connecting"){ toast("正在连接，稍等一下","err"); return; }
      input.click();
    };
    /* 解码就在这儿的 playAddFiles 里做（不是按播放的时候），见那段。
       先拷成数组再清 input：**`input.value = ""` 会把那个 FileList 一起掏空**
       （它是活的），不清的话再选**同一批文件** onchange 根本不触发。 */
    input.onchange = ()=>{
      const all = Array.prototype.slice.call(input.files || []);
      input.value = "";
      if (all.length) playAddFiles(st, all);
    };
  }

  /* 拖文件进来 = 走同一条 playAddFiles。挂在整页（.play-page）上，不盯某一格：
     拖放本来就是「往这块地方随手一丢」，盯着一个小目标反而难。
     · 只有真拖着文件（types 里有 "Files"）才接手 —— 拖一段选中文字、一个链接
       经过时不该亮框，也不该拦浏览器的默认行为。
     · dragenter/dragleave 会随着鼠标穿过每一个子节点反复触发，所以拿 depth 计数
       判断「真的离开了没有」；drop 之后一律归零。
     · dragover 必须 preventDefault，否则浏览器会把 mp3 当导航目标、把这一页顶掉。 */
  const page = box.querySelector(".play-page");
  if (page){
    let depth = 0;
    const hasFiles = e=>{
      const t = e.dataTransfer;
      return !!(t && t.types && Array.prototype.includes.call(t.types, "Files"));
    };
    page.addEventListener("dragenter", e=>{
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      page.classList.add("drop-on");
    });
    page.addEventListener("dragover", e=>{
      if (!hasFiles(e)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "copy"; } catch(err){}
    });
    page.addEventListener("dragleave", e=>{
      if (!hasFiles(e)) return;
      if (--depth <= 0){ depth = 0; page.classList.remove("drop-on"); }
    });
    page.addEventListener("drop", e=>{
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      page.classList.remove("drop-on");
      /* 和「添加文件」那枚按钮同一条守卫：正在连接那一段不接（见上面 #playPick）。 */
      if (st.phase === "connecting"){ toast("正在连接，稍等一下","err"); return; }
      const all = Array.prototype.slice.call(e.dataTransfer.files || []);
      if (all.length) playAddFiles(st, all);
    });
  }

  /* 单子上那两枚按钮：**在容器上委托一次**就够。列表会被频繁定点重画
     （解码完一个画一个），逐次重挂处理器迟早漏一个。
     两枚**一直都摆着**，宽窄屏一个样（用户定的）—— 窄屏上两枚 28px 的方块是挤了点，
     可它们是这一行仅有的动作，收进单子里反而多一次点击。 */
  const list = box.querySelector("#playList");
  if (list){
    list.onclick = e=>{
      const b = e.target.closest("[data-pl]");
      if (!b || b.disabled) return;   /* 灰掉的那一枚（正在播的那一项的垃圾桶）点不动 */
      const uid = Number(b.dataset.uid);
      if (b.dataset.pl === "go")  return playItem(st, uid);
      if (b.dataset.pl === "del") return playDel(st, uid);
    };
  }

  const go = box.querySelector("#playGo");
  if (go) go.onclick = ()=>{
    if (st.busy) return;
    if (st.phase === "playing") return playPause(st);
    if (st.phase === "paused")  return playResume(st);
    playStart(st);
  };
  const mode = box.querySelector("#playMode");
  if (mode) mode.onclick = ()=> playModeNext(st);
  const stop = box.querySelector("#playStop");
  if (stop) stop.onclick = ()=> playStop(st);

  /* 横屏那枚喇叭：开关竖音量条。只动 hidden，不重画页面。 */
  const volBtn = box.querySelector("#playVolBtn");
  const volPop = box.querySelector("#playVolPop");
  if (volBtn && volPop) volBtn.onclick = ()=>{
    volPop.hidden = !volPop.hidden;
    volBtn.setAttribute("aria-expanded", volPop.hidden ? "false" : "true");
  };
  if (!playVolOutsideBound){
    playVolOutsideBound = true;
    document.addEventListener("pointerdown", playVolOutside, true);
  }
  playVolAlign();
  if (!playVolAlignBound){
    playVolAlignBound = true;
    addEventListener("resize", playVolAlign);
  }

  /* 音量。**这一下不重画页面**：每滑一寸都 renderMain 的话，正被拖着的那根滑杆
     会被整个换掉，手一松就断了（滑杆不是按钮，它有「正在拖」这个状态）。
     所以只改状态里的数、把两处百分比写上、再拧一下那枚增益节点 ——
     节点是常驻的，改它的值下一帧就见效，不用停、不用重连。 */
  const vol = box.querySelector("#playVol");
  if (vol){
    /* 静音时拖滑杆＝重新给音量，顺手解除静音（滑杆动了图标还划着线就自相矛盾）。 */
    vol.oninput = ()=>{
      if (st.volMuted) playVolMuteSet(st, box, false);
      playVolInput(st, box, vol.value);
    };
    vol.style.setProperty("--p", st.vol + "%");   /* 自绘滑杆的初始着色 */
  }
  const vol2 = box.querySelector("#playVol2");
  if (vol2) vol2.oninput = ()=>{
    if (st.volMuted) playVolMuteSet(st, box, false);
    playVolInput(st, box, vol2.value);
  };
  /* 竖屏那枚喇叭：静音／恢复。 */
  const volMute = box.querySelector("#playVolMute");
  if (volMute) volMute.onclick = ()=> playVolToggleMute(st, box);

  /* 进度条：点一下、按住拖都跳。热区是整条 .pl-scrub（26px 高），手机上也好按。 */
  const sc = box.querySelector("#playScrub");
  if (sc){
    /* 换算成秒。**宽度是 0 就回 null**（节点刚被换掉的那一瞬）：照老写法这时候
       `x/0` 会落到 0，也就是「把进度拖到 0 秒」—— 一次静默的破坏，不如什么都不做。 */
    const at = ev => {
      const r = sc.getBoundingClientRect();
      if (!r.width) return null;
      const it = playCur(st); if (!it) return null;
      const x = Math.min(Math.max(ev.clientX - r.left, 0), r.width);
      return (x / r.width) * it.dur;
    };
    let drag = false;
    sc.onpointerdown = ev => {
      const v = at(ev);
      if (v === null) return;
      drag = true;
      try { sc.setPointerCapture(ev.pointerId); } catch(e){}
      playSeekTo(st, v);
      ev.preventDefault();
    };
    sc.onpointermove = ev => { if (!drag) return; const v = at(ev); if (v !== null) playSeekTo(st, v); };
    const up = ev => { drag = false; try { sc.releasePointerCapture(ev.pointerId); } catch(e){} };
    sc.onpointerup = up; sc.onpointercancel = up;
  }
  /* 从别的页切回来（或者这一页刚画出来）时，把进度和那口呼吸接上 —— 音频线程
     一直在走，页面这只手是刚接上的。
     **先停再叫**：playTick 只在自己那一帧里把 playRaf 归零，已经挂着一帧时再同步
     叫一次就是两条 rAF 链并行，而 playRaf 只记得住后一条 —— 停不干净。 */
  if (st.phase === "playing"){ playRafStop(); playTick(); }
  else playPaint();
}

/* ══ 跨页的会话胶囊 ═════════════════════════════════════════════════
   通话或播放中切到别的页，顶栏下面挂一枚重点色（accent）胶囊，白字 + 一枚记号，
   写着「正在通话中」／「正在播放中」（用户定的）。点它回那一页，回到那一页它就没了；
   再切走它又出现。**这里不记任何状态**：「该不该显示」每次都从当前页和两条会话
   现算，所以「点它回去→消失→再切走→又出现」不用任何记忆就成立。

   元素常驻在 index.html 里（顶栏每收一条终端状态就整个重写一遍 innerHTML，
   挂在顶栏里一分钟会被冲掉好几次）。位置每次同步时按顶栏**实测**的底边写进
   inline style：顶栏在窄屏上会折行，高度不是定数，写死一个 top 迟早压在自己身上。

   谁来调它：renderMain() 的头一行（见 30-view-list.js）—— 换页签和两条会话的每一次
   状态变更最后都汇到那儿。 */
function syncSessionBadge(){
  const b = $("#sessBadge"); if (!b) return;
  const tb = $("#topbar");
  const lv = S.dt.live, pl = S.dt.play;
  const call = !!(lv && (lv.phase === "calling" || lv.phase === "talking"));
  const cast = !!(pl && (pl.phase === "connecting" || pl.phase === "playing" || pl.phase === "paused"));
  /* 通话优先。两边本来就互斥（谁的入口都挡着另一个），这只是个次序。 */
  const owner = call ? "live" : cast ? "online" : "";
  if (!owner || S.mode === owner || !tb){
    if (!b.hidden){ b.hidden = true; b.innerHTML = ""; b.dataset.k = ""; }
    return;
  }
  if (b.dataset.k !== owner){
    b.dataset.k = owner;
    b.innerHTML = (call ? ICON.mic : ICON.play) +
      '<span>'+(call ? "正在通话中" : "正在播放中")+'</span>';
    b.onclick = ()=> goMode(owner);
  }
  const r = tb.getBoundingClientRect();
  if (r.bottom) b.style.top = (r.bottom + 8) + "px";
  b.hidden = false;
}
