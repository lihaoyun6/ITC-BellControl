/* data — 登录、拉取基础数据、切换铃声列表
   广播控制台 · 替代厂商后台的打铃配置面板
   ////////////////////////////////////////////////////////////// */

/* ══ 媒体库里那两样老东西 ═══════════════════════════════════════════
   面板早期版本的设置是挂在媒体库里一个 1 秒静音 mp3 的屁股后面传的，传进一个叫
   custom_config 的文件夹。设置本身早就搬到别处、现在更是哪都不存了，可这两样
   东西还留在服务器的媒体库里 —— 挑音源的面板列的是整个媒体库，让人能挑中它们
   既没意义，也会把「这里为什么有个 custom_config」摆到台面上。
   这两个名字只用来把它们滤掉（见 loadAll / refreshMediaLib）。 */
const LEGACY_MEDIA_FOLDER = "custom_config";
const LEGACY_MEDIA_FILE   = "custom_config.mp3";
function legacyMediaHide(x){
  const n = String((x && x.name) || "");
  return n !== LEGACY_MEDIA_FOLDER && n !== LEGACY_MEDIA_FILE;
}

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
/* 只丢令牌和到期时刻，**用户名密码留着** —— 它们的作用就是到期后把登录页填好。
   外加**上次看的页签**（bc.lastMode，见 30-view-list.js）：那个记忆属于「这一趟登录」，
   不属于这台机器 —— 注销之后换个人接着用，或者令牌过期重登，都该从铃声计划起步，
   而不是把上一趟停在哪儿捡回来。
   （草稿开关、上次看的列表那些是本机偏好，照旧不动。） */
function forgetLogin(){
  LS.del("token"); LS.del("tokenExpireMonitor"); SS.del("lastMode");
  lastMode = "list";     /* 30-view-list.js 那个变量：内存里那份也得跟着忘掉 */
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
   本机偏好（草稿开关、设置里那份配置、上次看的列表）都不动，它们
   属于这台机器，不属于哪一次登录。 */
function doLogout(){
  forgetLogin();
  closeStatusFeed();
  S.user = null; S.conn = "idle"; S.view = undefined;
  S.mode = "list"; S.showDetail = false;
  S.data = {groups:[], terminals:[], termGroups:[], medias:[], mediaGroups:[], strategies:[]};
  S.groupId = null; S.bells = []; S.grpMeta = null;
  S.listArea = {t:[],g:[]};
  S.pending = [];
  S.sel.clear(); S.tsel.clear();
  S.tasks = []; S.termStat = {}; S.termTask = {}; S.sessions = []; S.wsIp = null; S.link = "off";
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
      /* 这一趟回来之前已经被送回登录页（比如开机 6 秒超时）：不许再把令牌写回去。 */
      if (reLoginDead || !r || !r.token) return "failed";
      S.token = String(r.token);
      if (r.user) S.user = r.user;
      setSrvVersion(r);
      noteSrvClock(r.config && r.config.timestamp);   /* 顺手跟服务器对一次钟（见 00-core.js） */
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
  /* 一趟新登录 = 从铃声计划起步，**不是**把上一趟停在哪儿捡回来（用户定的）。
     本机那份页签记忆（bc.lastMode）在 forgetLogin() 里已经跟着令牌一起抹了 ——
     这里收拾的是**内存里**这份：三条回登录页的路（开机没令牌、注销、令牌过期被
     送回）都过 forgetLogin()，可它只管凭证，S.mode 还停在上一趟那一页，详情页
     都可能是开着的。 */
  S.mode = "list"; S.showDetail = false; lastMode = "list";
  S.conn = "busy"; renderAll();
  reLoginDead = false;                 /* 人手登了一趟，那扇「送回登录页」的门重新开张 */
  /* 登录这一趟也有 6 秒的钟（用户定的）。代理 / 隧道卡住时 fetch 可以一直挂着，
     登录键就永远不回来 —— 和开机探针同一个时限，超时按连不上处理。 */
  const ac = new AbortController();
  const timer = setTimeout(()=>ac.abort(), 6000);
  try{
    const r = await api("GET","/auth",{params:{userinfo:"true",withRoles:"true",withUsersConfig:"true",name,password}, signal: ac.signal});
    clearTimeout(timer);
    if (!r || !r.token) throw new Error("登录失败：服务器未返回令牌");
    S.token = String(r.token);
    S.user  = r.user || {};
    setSrvVersion(r);
    noteSrvClock(r.config && r.config.timestamp);     /* 顺手跟服务器对一次钟（见 00-core.js） */
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
    clearTimeout(timer);
    S.conn = "bad"; S.token = null; closeStatusFeed(); renderAll();
    toast(e && e.name === "AbortError" ? "连接超时，请检查服务器地址与代理设置"
                                       : (e.message || "登录失败"), "err");
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
  /* 媒体库里那两样老东西从这儿就滤掉 —— 在源头滤一次，挑音源、媒体库页签上的
     计数、别处任何按名字找媒体的地方，全都不会再撞见它们，比在每个用到的地方
     各拦一道可靠。见下面 legacyMediaHide。 */
  S.data.medias      = unwrap(medias).filter(legacyMediaHide);
  S.data.mediaGroups = unwrap(mgs).filter(legacyMediaHide);
  S.data.strategies  = unwrap(strategies);

  /* 考试模式：服务器上有正在进行的配置就照它重排并覆盖本机那份；没有就留住本机那份
     （见 40-view-exam.js 的 readExamState / saveExamLocal） */
  S.exam = await readExamState();
  loadTasks();                       /* 定时任务是独立资源，不阻塞主流程 */
  const def = S.user && S.user.users_config && S.user.users_config.default_ringing_scheme;
  /* 只在「铃声计划」看得见的列表里挑。选到一个被考试模式藏起来的临时列表，
     用户会看到一张空白的详情页，还不知道自己是怎么走到那儿的。 */
  const vis = S.data.groups.filter(g=> !isExamHiddenList(g));
  /* 正看着的那张列表还在，就留在它上面 —— 刷新、改完任务名走完这一趟都不该把人
     换到另一张列表上（用户实测：在新建的任务详情里改名，一保存视图就跳回上一条）。
     DEFAULT_GROUP 是页面load 那一刻存下的旧值，只该在还没有当前列表时（开机 /
     刚登录）拿来恢复上次那张。 */
  const cur = Number(S.groupId);
  const want = (cur && vis.some(g=>Number(g.id)===cur)) ? cur : (DEFAULT_GROUP || def);
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

/* 选中一张列表，把它的铃声拉回来。**不动 S.mode** —— 这件事两个地方做，意思不一样：
   侧栏上点一下是「回到列表视图」（那一句写在点击处理里，见 30-view-list.js），
   而开机这趟（loadAll）只是恢复上次看的那张列表，页签得留在用户原来待的那一页上。 */
async function selectGroup(gid){
  S.groupId = Number(gid); LS.set("lastGroup", S.groupId);
  S.sel.clear();
  /* 标题上的名字是现成的（S.data.groups），铃声得等这一趟。中间这段标成 gLoad，
     右栏正文就只画一句「正在读取」—— 不标的话，页面会拿手上那份**上一条任务的**
     S.bells / S.listArea / S.grpMeta 在新名字底下摆出来，网慢的时候那就是一整屏
     别人的内容（用户实测报的就是这个）。 */
  S.gLoad = "busy";
  renderAll();
  let rows;
  try{
    rows = await fetchBells(S.groupId);
  }catch(e){
    /* 失败也把这一页交出去：正文换成一句「读取失败」，卡着「正在读取」不放比报错
       更难受。**照旧往上抛** —— 开机那条路（loadAll → doLogin）就指着这个异常
       把「连不上服务器」报出来（侧栏那条路由调用点自己接，见 30-view-list.js）。 */
    S.gLoad = "bad"; renderAll();
    throw e;
  }
  const g = grpAdoptRows(rows);
  S.grpMeta = g.meta;
  S.bells = g.bells.sort((a,b)=> hmsToSec(a.time)-hmsToSec(b.time));
  recomputeListArea();
  snapshotBells();
  S.gLoad = "";
  renderAll();
}

async function reloadBells(){
  if (S.groupId==null) return;
  const rows = await fetchBells(S.groupId);
  const g = grpAdoptRows(rows);
  S.grpMeta = g.meta;
  S.bells = g.bells.sort((a,b)=> hmsToSec(a.time)-hmsToSec(b.time));
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

/* ══ 媒体库：第一次拉完之后就用手里这份 ═════════════════════════════
   S.data.medias 是开面板时（loadAll）拉的一份，挑音源的弹窗直接用它 —— **不再每次
   开框都重拉**（用户定的）。以前每开一次框都要先等一趟网络，慢的时候框里先摆一句
   「正在读取…」，等一两秒才长出列表。

   音频文件是**在厂商原后台上传**的：刚传上去的文件，手里这份里还没有。所以每个
   挑音源的弹窗右上角都有一枚刷新，按下去走下面这个函数重拉一遍再重画。

   顺带把时长也刷新了：听力铃声的 life_time 就是从这张表里量出来的（lifeTimeOf），
   算的是拉下来那一刻的时长。

   并发去重：同一瞬间按了两处刷新只发一轮请求。
   **不抛**：失败时留着手里这份旧的，返回 false 让调用方自己决定怎么说。 */
let mediaRefreshing = null;
function refreshMediaLib(){
  if (mediaRefreshing) return mediaRefreshing;
  const unwrap = r => Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
  mediaRefreshing = Promise.all([
    api("GET","/medias/all",{params:{check:"true"}}),
    api("GET","/medias-groups/all")
  ]).then(([medias, mgs])=>{
    S.data.medias      = unwrap(medias).filter(legacyMediaHide);   /* 同上：把那两样滤掉 */
    S.data.mediaGroups = unwrap(mgs).filter(legacyMediaHide);
    return true;
  }).catch(()=> false).then(ok=>{ mediaRefreshing = null; return ok; });
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
    renderTopbar(); renderMain();      /* 定时任务那一页的表身跟着更新（人不在那一页时，这一趟就是照常重画） */
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

