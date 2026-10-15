/* data — 登录、拉取基础数据、切换铃声列表
   广播控制台 · 替代厂商后台的打铃配置面板
   ////////////////////////////////////////////////////////////// */

/* ══ 登录 · 会话 ═════════════════════════════════════════════════════
   登录成功、并且勾了「记住登录状态」，就把**用户名、密码、令牌**三样一起落进本机，
   外加一个到期时刻 —— 和原版后台存在自己 localStorage 里的那几样是同一个意思
   （jwt_token / userName / userPassword / tokenExpireMonitor）。

   令牌活多久由我们这张表说了算，**一小时**：服务器签出来的那张实际能活两小时出头
   （解开 JWT 的 exp 看过，125 分钟），我们比它严 —— 宁可早退，不赖到服务器翻脸。到期之前
   刷新页面直接拿令牌进主界面，一个字都不用重输；到期之后令牌当场作废，回到登录页，
   那里已经把用户名密码填好了，点一下「连接」就是新的一小时。

   注意这张表**只管刷新那一下**（savedSession）：页面开着的时候它不生效，也没有任何
   定时器看它。真正撑住「用着用着令牌到点」的是下面的 reLogin() —— 哪一趟请求吃了
   401 就静默续一张、把那一趟重发一次（调用点在 00-core.js 的 api()）。 */
const SESSION_MIN = 60;
/* 「记住」= 存这三样 + 到期时刻。不勾则一样不留（包括那张令牌）—— 关掉页面即失效。 */
function rememberLogin(on, name, password){
  if (!on){
    LS.del("token"); LS.del("userName"); LS.del("userPassword"); LS.del("tokenExpireMonitor");
    return;
  }
  LS.set("token", S.token);
  LS.set("userName", name);
  LS.set("userPassword", password);
  LS.set("tokenExpireMonitor", Date.now() + SESSION_MIN*60000);
}
/* 只丢令牌和到期时刻，**用户名密码留着** —— 它们的作用就是到期后把登录页填好。 */
function forgetLogin(){
  LS.del("token"); LS.del("tokenExpireMonitor");
  S.token = null;
}
/* ══ 退出登录 ════════════════════════════════════════════════════════
   点了就**当场**作废本机那张令牌（不等它到期），退回登录页。要清的东西分两拨：

     凭证    forgetLogin() 管：令牌 + 到期时刻。
     数据    **这一趟从服务器带回来的全部东西** —— 列表、铃声、定时任务、还有
             攒着没提交的改动。不清的话，换一个人接着在这台机器上登录，上一位
             攒的改动会跟着进新会话（提交按钮一按就写到新服务器上去了）。

   用户名密码**留着**：登录页要靠它们填好，再点一次「连接」就回来 —— 这正是
   「退出登录」和「关掉页面」的区别。
   本机偏好（草稿开关、时间偏移、设置里那份配置、上次看的列表）都不动，它们
   属于这台机器，不属于哪一次登录。 */
function doLogout(){
  forgetLogin();
  closeStatusFeed();
  S.user = null; S.conn = "idle"; S.view = undefined;
  S.mode = "list"; S.showDetail = false;
  S.data = {groups:[], terminals:[], termGroups:[], medias:[], mediaGroups:[], strategies:[]};
  S.groupId = null; S.bells = []; S.bellsListId = null;
  S.listArea = {t:[],g:[]};
  S.pending = [];
  S.sel.clear(); S.tsel.clear();
  S.tasks = []; S.termStat = {}; S.wsIp = null; S.link = "off";
  S.exam = null;
  renderAll();
  toast("已退出登录", "ok");
}
/* 本机还留着没过期的令牌吗？有就返回它，没有返回 null。 */
function savedSession(){
  const t = LS.get("token", null);
  const until = Number(LS.get("tokenExpireMonitor", 0)) || 0;
  if (!t || !until || Date.now() >= until) return null;
  return t;
}

/* ══ 令牌到点了，自己续一张 ══════════════════════════════════════════
   上面那张一小时的表只管「刷新页面时收不收旧令牌」。**页面开着的时候没有任何东西
   看这个钟** —— 而服务器签的令牌到点就死：解开 JWT 看，寿命 125 分钟（两小时零五
   分），不因为我们还在用就往后挪。于是页面开够两个钟头以后，改一笔发一笔，统统吃回
   一句「登录过期,请重新登录!」（服务器原话），非刷新重登一次不可。

   刷新之所以救得回来，是因为「记住登录状态」把用户名密码留在了本机
   （rememberLogin）。这里就是把这件事搬到运行时来做：拿那两样**静默**换一张新的，
   界面一个字都不动 —— 不重画、不重拉数据、不弹报喜。什么时候调它见 00-core.js 的
   api()：那一趟吃了 401 就调这里一次，成了把原请求原样重发一次。

   三种交代，调用方按这个分岔：
     "ok"      换到了，S.token 已经是新的
     "none"    本机没留用户名密码（没勾「记住登录状态」）—— 续不了
     "offline" 连不上服务器，不知道会话死没死
     "failed"  服务器明确把本机留的那对用户名密码退回来了 —— 会话真死了
   ───────────────────────────────────────────────────────────────── */
let reLoginP = null;                    /* 同时只许办一张：见下面那段 */
let reLoginDead = false;                /* 已经送回过登录页了，别再送一次 */
function reLogin(){
  if (reLoginP) return reLoginP;
  const name = LS.get("userName", null), password = LS.get("userPassword", null);
  if (!name || !password) return Promise.resolve("none");
  /* **只开一趟**：一次批量操作可能十几条报文一起撞 401，后来的共用第一趟的结果。
     这个标记也是「/auth 自己不再走重登」那道闸（noRetry，见 00-core.js）。 */
  reLoginP = api("GET","/auth",{params:{userinfo:"true",withRoles:"true",withUsersConfig:"true",name,password}, noRetry:true})
    .then(r=>{
      if (!r || !r.token) return "failed";
      S.token = String(r.token);
      if (r.user) S.user = r.user;
      setSrvVersion(r);
      S.conn = "ok";
      rememberLogin(LS.get("remember", true), name, password);   /* 本机那张到期表跟着往后拨 */
      reLoginDead = false;
      return "ok";
    })
    .catch(e=> (e && e.network) ? "offline" : "failed")
    .then(how=>{ reLoginP = null; return how; });
  return reLoginP;
}
/* 会话真死了才把人送回去（服务器把本机留的那对用户名密码退了回来）。密码还留着，
   登录页会把它填好，点一下「连接」就回来。
   **别在「本机没留密码」时也走这一趟**：那时登录页是空的，送回去等于白白把攒着没提
   交的改动扔掉，而抽屉里那行「登录过期,请重新登录!」本来就说得清楚。 */
function kickToLogin(){
  if (reLoginDead) return;
  reLoginDead = true;
  forgetLogin();
  closeStatusFeed();
  S.conn = "idle"; S.view = undefined;
  renderAll();
  toast("登录已过期，请重新登录", "err");
}

/* ══ bootstrap ══════════════════════════════════════════════════════ */
/* 厂商版本号在 /auth 的响应里 —— 顶层一个 version，config.version 是同一个值
   （两个都试一下：这版接口两种形状都见过）。取不到就给空串，设置页那边显示成
   「—」，不编一个版本号出来。 */
const srvVersionOf = r => String((r && r.version) || (r && r.config && r.config.version) || "");

/* 拿到就记下来，**并且在本机存一份** —— 刷新页面走的是「拿本机那张没过期的令牌
   直接进主界面」那条路（见 90-boot.js），整趟都不经过 /auth；不存的话设置页上
   那一格每次刷新都会变回「—」，非得注销重登才回来。
   空值直接忽略：宁可留着上一次拿到的那份，也别把好数据抹成空白。
   （/language 也报这个字段，所以它每开一次页面都会跟着刷新一次，见 15-status.js。） */
function setSrvVersion(r){
  const v = srvVersionOf(r);
  if (!v) return;
  S.srvVersion = v;
  LS.set("srvVersion", v);
  /* 设置页正开着就把那一格当场补上 —— 不重画整页：重画会把人正在输入的东西弄丢。
     刷新页面走的正是这条路：先拿本机存的那份把页面画出来，等 /language 回来
     再补一次（本机从来没存过的机器，就靠这一补）。 */
  const cell = $("#verSrv");
  if (cell) cell.textContent = v;
}

async function doLogin(name, password){
  S.conn = "busy"; renderAll();
  reLoginDead = false;                 /* 人手登了一趟，那扇「送回登录页」的门重新开张 */
  try{
    const r = await api("GET","/auth",{params:{userinfo:"true",withRoles:"true",withUsersConfig:"true",name,password}});
    if (!r || !r.token) throw new Error("登录失败：服务器未返回令牌");
    S.token = String(r.token);
    S.user  = r.user || {};
    setSrvVersion(r);
    S.tenant = (r.config && r.config.apiBaseUrl) ? r.config.apiBaseUrl : null;
    S.conn = "ok";
    /* 地址不在这儿存 —— 点「连接」的时候就存过了（见 30-view-list 的登录卡片），
       存早了才有意义：登录失败的人下次打开也该看见自己刚填的那台。 */
    rememberLogin(LS.get("remember", true), name, password);
    await loadAll();
    S.view = "app";
    renderAll();
    openStatusFeed();                  /* 在线状态是另一条 WebSocket，连不上不影响用 */
    toast("已连接 " + S.server.replace(/^https?:\/\//,""), "ok");
  }catch(e){
    S.conn = "bad"; S.token = null; closeStatusFeed(); renderAll();
    toast(e.message || "登录失败", "err");
  }
}

async function loadAll(){
  const [groups, terms, tgs, medias, mgs, strategies] = await Promise.all([
    api("GET","/timing-bells-groups/all",{params:{withUser:"true"}}),
    api("GET","/terminals/all",{params:{withGroups:"true"}}),
    api("GET","/terminals-groups/all",{params:{"select-terminals-or-groups":"1"}}),
    api("GET","/medias/all",{params:{check:"true"}}),
    api("GET","/medias-groups/all"),
    api("GET","/timing-strategy/all",{params:{withUser:"true"}})
  ]);
  const unwrap = r => Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
  S.data.groups      = unwrap(groups).filter(g=>g.id!==0);
  S.data.terminals   = unwrap(terms);
  S.data.termGroups  = unwrap(tgs);
  /* 配置借媒体库存着（见 js/05-config.js），那个专用文件夹和静音壳子从这儿就滤掉 ——
     在源头滤一次，挑铃音、媒体库页签上的计数、别处任何按名字找媒体的地方，
     全都不会再撞见它们，比在每个用到的地方各拦一道可靠。 */
  S.data.medias      = unwrap(medias).filter(cfgMediaHide);
  S.data.mediaGroups = unwrap(mgs).filter(cfgMediaHide);
  S.data.strategies  = unwrap(strategies);

  S.exam = loadExam();
  cfgSyncOnce();                     /* 服务器上那份配置只在登录后对一次账 */
  loadTasks();                       /* 定时任务是独立资源，不阻塞主流程 */
  const def = S.user && S.user.users_config && S.user.users_config.default_ringing_scheme;
  const want = DEFAULT_GROUP || def;
  /* 只在「铃声计划」看得见的列表里挑。选到一个被考试模式藏起来的临时列表，
     用户会看到一张空白的详情页，还不知道自己是怎么走到那儿的。 */
  const vis = S.data.groups.filter(g=> !isExamHiddenList(g));
  const ok = vis.some(g=>Number(g.id)===Number(want));
  if (ok) await selectGroup(Number(want));
  else if (vis.length) await selectGroup(Number(vis[0].id));
  else S.groupId = null;
}

/* 服务器上某个列表里的全部铃声（读操作，演练模式也照读） */
async function fetchBells(gid){
  const r = await api("GET","/timing-bells",{params:{
    limit:500, page:1, timing_bells_groups_id:gid,
    withLight:"true", withTerminals:"true", withGroups:"true", withMedias:"true"
  }});
  return Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
}

/* _base：这条铃声在服务器上「现在」长什么样。草稿模式的抵消就靠它 ——
   改完又改回去，报文和它逐字相等，那就等于没改，两条一起撤掉。 */
function snapshotBells(){
  S.bells.forEach(b=>{ if (b.id) b._base = JSON.stringify(buildPayload(b)); });
}

async function selectGroup(gid){
  S.groupId = Number(gid); LS.set("lastGroup", S.groupId);
  S.sel.clear();
  S.mode = "list";                 /* 从侧栏点列表 = 回到列表视图 */
  renderAll();
  const rows = await fetchBells(S.groupId);
  S.bells = rows.map(normBell).sort((a,b)=> hmsToSec(a.time)-hmsToSec(b.time));
  S.bellsListId = S.groupId;      /* 这份 bells 是哪张列表的，分组清账时要用（见 00-core.js） */
  recomputeListArea();
  snapshotBells();
  renderAll();
}

async function reloadBells(){
  if (S.groupId==null) return;
  const rows = await fetchBells(S.groupId);
  S.bells = rows.map(normBell).sort((a,b)=> hmsToSec(a.time)-hmsToSec(b.time));
  S.bellsListId = S.groupId;      /* 这份 bells 是哪张列表的，分组清账时要用（见 00-core.js） */
  recomputeListArea();
  snapshotBells();
}

/* 只重拉铃声列表本身（列表的 is_done / 名称 / 日期改了以后） */
async function reloadGroups(){
  const r = await api("GET","/timing-bells-groups/all",{params:{withUser:"true"}});
  const rows = Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
  S.data.groups = rows.filter(g=>g.id!==0);
  renderMain(); renderRail();
}

/* ══ 媒体库：每次挑铃音都重拉一遍 ═══════════════════════════════════
   S.data.medias 是开面板时（loadAll）拉的一份快照，但音频文件是**在厂商原后台上传**
   的 —— 拿着那份快照去开「挑铃音」，刚传上去的文件在这儿根本不存在，人会觉得
   「面板没同步」。所以每次打开选择器前重拉一次。

   顺带把时长也刷新了：听力铃声的 life_time 就是从这张表里量出来的（lifeTimeOf），
   算的是拉下来那一刻的时长。

   并发去重：同一瞬间开两个选择器（考试那两格挨着点）只发一轮请求。
   失败**不抛**，用手里这份旧的照常开框 —— 打不开比看到一份稍微旧的列表糟得多。 */
let mediaRefreshing = null;
function refreshMediaLib(){
  if (mediaRefreshing) return mediaRefreshing;
  const unwrap = r => Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
  mediaRefreshing = Promise.all([
    api("GET","/medias/all",{params:{check:"true"}}),
    api("GET","/medias-groups/all")
  ]).then(([medias, mgs])=>{
    S.data.medias      = unwrap(medias).filter(cfgMediaHide);   /* 同上：把配置那个壳子滤掉 */
    S.data.mediaGroups = unwrap(mgs).filter(cfgMediaHide);
  }).catch(()=>{}).then(()=>{ mediaRefreshing = null; });
  return mediaRefreshing;
}

/* ══ 定时任务（不属于任何铃声列表）════════════════════════════════════ */async function loadTasks(){
  try{
    const r = await api("GET","/timing-tasks",{params:{
      limit:500, page:1, withTerminals:"true", withGroups:"true",
      withMedias:"true", withLight:"true"
    }});
    const rows = Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
    S.tasks = rows.map(normTask).sort((a,b)=> hmsToSec(a.time)-hmsToSec(b.time));
    S.tasks.forEach(t=>{ if (t.id) t._base = JSON.stringify(taskPayload(t)); });
    renderTopbar(); renderMain();      /* 顶栏的「定时任务 N」跟着更新 */
  }catch(e){
    toast("定时任务拉取失败：" + e.message, "err");
  }
}
const taskById = id => S.tasks.find(t=>Number(t.id)===Number(id)) || null;

const groupName = id => { const g = S.data.groups.find(x=>Number(x.id)===Number(id)); return g?g.name:("列表 "+id); };
const strategyName = id => { const s = S.data.strategies.find(x=>Number(x.id)===Number(id)); return s?s.name:("策略 "+id); };
const strategyWeeks = id => {
  const s = S.data.strategies.find(x=>Number(x.id)===Number(id));
  if (!s) return "";
  if (s.time_type===1) return "指定日期";
  const w = (s.repeat_weeks||[]).map(x=>x.repeat_weeks).sort((a,b)=>a-b);
  if (!w.length) return "未设置";
  if (w.length===7) return "每天";
  return w.map(x=>WEEK[x]).join(" ");
};

function ensureStrategy(){
  if (!S.data.strategies.length) return null;
  const weekday = S.data.strategies.find(s=>s.name && s.name.indexOf("周二到周五")>=0)
    || S.data.strategies.find(s=>s.name && s.name.indexOf("周一")>=0 && s.name.indexOf("周日")>=0)
    || S.data.strategies[0];
  return weekday.id;
}

