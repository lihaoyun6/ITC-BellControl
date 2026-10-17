/* view — 列表视图：侧栏、时间轴、铃声表、各类编辑器
   广播控制台 · 替代厂商后台的打铃配置面板
   ////////////////////////////////////////////////////////////// */

/* ══ render ═════════════════════════════════════════════════════════ */
/* renderMain 先把 #rail 造出来（它在「铃声计划」页里面），renderRail 才能填它 */
/* renderRail 由 renderMain 自己在末尾调（它在「铃声计划」页里面造 #rail），这里不用再调一遍 */
/* 登录页端口那一格的默认值，也是没存过端口时拼回去的那个（厂商后台的默认端口）。 */
const LOGIN_PORT = "81";
/* 整页重画之前先把考试日期那个浮层收掉（closeDatePicker，js/40-view-exam.js）：
   它挂在 #layers 下，而 #layers 在 renderMain 的射程之外 —— 不主动收的话，
   开着日历点顶栏切页，那块日历会留在新页面上飘着。
   （时分秒转轮 .tp 是同样的结构，也有同样的毛病，是既有行为，这次没动。）
   行尾那枚「⋯」的小单子（closeRowMenu）也挂在 #layers 下，一并收掉。 */
function renderAll(){ closeDatePicker(); closeRowMenu(); renderRoot(); renderTopbar(); renderNavbar(); renderMain(); }

function renderRoot(){
  const root = $("#root");
  if (S.view === "app"){ if (!$("#app")) root.innerHTML = shellHTML(); return; }
  if ($("#app")) root.innerHTML = "";
  renderLogin();
}

/* 服务器地址拆成「地址 + 端口」两格给登录页用。协议不单独给一格 ——
   这套后台一律是 http，多一个能填错的字段只会让人在这儿卡住。
   S.server 仍然是拼好的完整地址（BASE() 和顶栏那些提示语都用它），
   只有登录页把它拆开显示、点「连接」时再拼回去。
   老存档里要是 https，拆的时候记下协议、拼回去照原样还回去，不会被人悄悄改掉。

   **没存过端口时填 81**：厂商后台的默认端口就是它，绝大多数部署不用改这一格，
   而留空等于每次都要人多打三个字。（地址那格不跟着编一个默认值 —— 编出来的
   地址一定是错的，那还不如空着让人填。） */
function splitServer(v){
  const s = String(v==null?"":v).trim();
  const m = s.match(/^(https?):\/\/([^\/:]*)(?::(\d+))?/i);
  if (m) return {scheme:m[1].toLowerCase(), host:m[2], port:m[3]||LOGIN_PORT};
  /* 没带协议也认（老存档、或者人只存了「ip:端口」） */
  const m2 = s.match(/^([^\/:]*)(?::(\d+))?/);
  return {scheme:"http", host:(m2&&m2[1])||"", port:(m2&&m2[2])||LOGIN_PORT};
}

function renderLogin(){
  const root = $("#root");
  const busy = S.conn==="busy";
  if ($("#login")){
    $("#loginErr").textContent = S.conn==="bad" ? "连接失败，请检查用户名、密码与服务器地址。" : "";
    $("#loginBtn").disabled = busy;
    return;
  }
  const srv = splitServer(S.server);
  root.innerHTML =
  '<div class="login" id="login"><div class="login-card">'+
    '<h1 class="serif">ITC 广播控制台</h1>'+
    '<div class="stack">'+
      '<div class="srv-row">'+
        '<div class="field"><label for="lg-host">服务器地址</label>'+
          '<input class="input mono" id="lg-host" value="'+esc(srv.host)+'" spellcheck="false" autocomplete="off" placeholder="192.168.1.100"></div>'+
        '<div class="field"><label for="lg-port">端口</label>'+
          '<input class="input mono" id="lg-port" value="'+esc(srv.port)+'" spellcheck="false" autocomplete="off" inputmode="numeric" placeholder="'+LOGIN_PORT+'"></div>'+
      '</div>'+
      /* 用户名和密码**永远各占一行**，宽屏也一样。用 grid2 的时候，窗口一宽
         这两格就并成一行 —— 登录框上并排的两个输入框看着像「左右两个选项」，
         而且密码那格一窄，输入时根本看不清自己打了多长。卡片本身封顶 380px，
         竖着排也只多占一行高度。 */
      '<div class="stack">'+
        '<div class="field"><label for="lg-user">用户名</label><input class="input" id="lg-user" value="'+esc(LS.get("userName","admin"))+'" autocomplete="username"></div>'+
        /* 密码也从本机填回来：会话过期后令牌作废，但用户名密码是留着的（见
           10-data.js 的 forgetLogin）—— 登录页于是永远是填好的，点一下「连接」就行。 */
        '<div class="field"><label for="lg-pass">密码</label><input class="input" id="lg-pass" type="password" value="'+esc(LS.get("userPassword",""))+'" autocomplete="current-password"></div>'+
      '</div>'+
      '<label class="chk"><input type="checkbox" id="lg-remember"'+(LS.get("remember",true)?" checked":"")+'> 记住登录状态</label>'+
      '<div id="loginErr" class="hint" style="color:var(--crit)"></div>'+
      '<button class="btn btn-primary" id="loginBtn" style="justify-content:center">连接</button>'+
    '</div>'+
  '</div></div>';

  $("#loginBtn").onclick = ()=>{
    /* 两格拼回一个地址。地址那格**容得下整串粘贴**：人很可能直接把
       「http://192.168.1.100:81」整条贴进来 —— 末尾的斜杠丢掉，冒号后面那截
       补进端口格（端口格自己填了就以它为准）。真写了协议就按他写的来，
       没写才用存档里那个（默认 http）—— 写了不算数，那这个框就成了骗人的。 */
    const raw = $("#lg-host").value.trim();
    const mSch = raw.match(/^(https?):\/\//i);
    const scheme = mSch ? mSch[1].toLowerCase() : srv.scheme;
    let host = raw.replace(/^https?:\/\//i,"").replace(/\/.*$/,"");
    let port = $("#lg-port").value.trim().replace(/\D/g,"");
    const i = host.indexOf(":");
    if (i >= 0){
      if (!port) port = host.slice(i+1).replace(/\D/g,"");
      host = host.slice(0, i);
    }
    if (!host){ toast("请填写服务器地址","err"); $("#lg-host").focus(); return; }
    S.server = scheme + "://" + host + (port ? ":"+port : "");
    /* 地址**一点「连接」就记下来**，不等登录成功 —— 地址打错、密码打错都是常事，
       下次打开还得从头再打一遍就太烦了。原来这一句只在 doLogin 成功那条路上
       （见 10-data.js），等于「错一次就得重来」。 */
    LS.set("server", S.server);
    LS.set("remember", $("#lg-remember").checked);
    doLogin($("#lg-user").value.trim(), $("#lg-pass").value);
  };
  $("#lg-pass").onkeydown = e => { if(e.key==="Enter") $("#loginBtn").click(); };
  $("#lg-user").onkeydown = e => { if(e.key==="Enter") $("#lg-pass").focus(); };
  $("#lg-port").onkeydown = e => { if(e.key==="Enter") $("#lg-user").focus(); };
  $("#lg-host").onkeydown = e => { if(e.key==="Enter") $("#lg-port").focus(); };
  /* 密码框里已经有存好的密码时**别去聚焦它** —— 光标落在满格的字后面，接着敲就是
     往旧密码屁股上接，登不上还看不出为什么。填好了就把焦点交给「连接」，敲回车即进。 */
  setTimeout(()=>{
    const p = $("#lg-pass") || $("#loginBtn");
    if (!p) return;
    if (p.id === "lg-pass" && p.value) $("#loginBtn").focus(); else p.focus();
  }, 30);
}

function shellHTML(){
  return '<div class="app" id="app">'+
    '<header class="topbar" id="topbar"></header>'+
    '<div class="body">'+
      '<main class="main"><div class="main-inner" id="main"></div></main>'+
    '</div>'+
    /* 竖屏那条底部导航栏（见下面的 renderNavbar）。它是 .app 这一列里的最后一块，
       和 .topbar 一头一尾，flex:none —— 它一站进来，中间的 .body 自己就让出那块高度，
       不用给页面另加 padding-bottom，也不会有最后一行铃声被它压在底下。
       宽屏上它整根不显示（css 里 `.navbar{display:none}`），顶栏右上那排页签照旧。
       （它叫 navbar 不叫 tabbar：`.tabbar` 这个名字已经被弹窗里那种横向文字页签
       占着了 —— 区域编辑器、音源选择器、铃声编辑框里各有一条，是另一样东西。） */
    '<nav class="navbar" id="navbar"></nav>'+
  '</div>';
}

/* 顶栏左边那格读数：REST 通不通。它同时是重连按钮，所以文字和提示语都在这里 */
const connText  = () => S.conn==="ok" ? "已连接" : S.conn==="busy" ? "连接中" : "未连接";
/* 三格读数的提示语是同一句格式：**点击什么：对谁**。它们是按钮，提示语就得说清楚
   点下去会发生什么、冲着谁去的。「连接中」那一瞬也照这句写 —— 点下去无非再探一次，
   话仍然是真的，不必为那半秒钟另备一句。 */
const connTitle = () => "点击重新连接服务器：" + S.server;
/* 人物图标旁边那个名字。开机自动登录那一趟，用户名要等服务器回话才知道，那就先用本机
   存着的那个 —— 本机存的就是上次登录用的名字。它是 title 里的字，不是画出来的字。 */
const userNameText = ()=> ((S.user && S.user.name) || LS.get("userName","") || "").trim();
/* 用户名还没回来时只留前半句 —— 「点击注销：」后面挂着空白比不写还难看。
   （这句提示语跟着格子上的字样走：按钮现在写「注销」，提示语就不能还叫「退出登录」。） */
const logoutTitle = ()=>{ const n = userNameText(); return "点击注销" + (n ? "："+n : ""); };

/* 哪一格该带角上那颗小圆点。三件事同一个意思：这一项**正在跑**，人不在那一页
   也看得见 —— 「考试模式」启用中、「实时对讲」接通中、「在线播放」连接/播放/暂停中。
   与 syncSessionBadge 用的判据是同一套（通话的 calling/talking、播放的三档），
   两边别各写各的。 */
function modeDotOn(m){
  if (m === "exam") return !!(S.exam && S.exam.on);
  if (m === "live"){
    const lv = S.dt.live;
    return !!(lv && (lv.phase === "calling" || lv.phase === "talking"));
  }
  if (m === "online"){
    const pl = S.dt.play;
    return !!(pl && (pl.phase === "connecting" || pl.phase === "playing" || pl.phase === "paused"));
  }
  return false;
}

/* 圆点只增删那一颗 span，不重画整条顶栏／导航栏 —— 会话状态每变一次都会走
   renderMain，而顶栏上是连接读数、导航栏上是选中态，整条重写一遍纯属白费，
   还会把别人挂在按钮上的东西冲掉。顶栏页签用的是 .seg-dot（跟在字后面），
   底部导航栏用的是 .navbar-dot（钉在图标右上角），同一个色、同一个意思。 */
function syncModeDots(){
  const put = (host, cls, m, title)=>{
    if (!host) return;
    const has = host.querySelector(":scope > ." + cls);
    const want = modeDotOn(m);
    if (want && !has){
      const s = document.createElement("span");
      s.className = cls;
      if (title) s.title = title;
      host.appendChild(s);
    } else if (!want && has){
      has.remove();
    }
  };
  const seg = $("#modeSeg");
  const nav = $("#navbar");
  put(seg && seg.querySelector('button[data-mode="exam"]'),   "seg-dot", "exam",   "考试模式启用中");
  put(seg && seg.querySelector('button[data-mode="live"]'),   "seg-dot", "live",   "正在通话中");
  put(seg && seg.querySelector('button[data-mode="online"]'), "seg-dot", "online", "正在播放中");
  const ni = m=>{
    const b = nav && nav.querySelector('.navbar-btn[data-mode="'+m+'"]');
    return b && b.querySelector(".navbar-ic");
  };
  put(ni("exam"),   "navbar-dot", "exam");
  put(ni("live"),   "navbar-dot", "live");
  put(ni("online"), "navbar-dot", "online");
}

function renderTopbar(){
  const el = $("#topbar"); if (!el) return;
  const np = S.pending.filter(o=>o.status==="pending").length;
  /* 「‹ 返回」该不该出现。竖屏上它和左边那个标题是**同一个位置的两种占法**
     （那一格只够站一个），所以先算出来，标题照着它决定收不收 —— css 只管
     `.brand.has-back{display:none}`，不去猜「这一页有没有返回」。
     哪几处需要它，见下面 .tb-r 里那段老注释。
     「定时任务」也在里头：它和铃声计划的详情页是同一个版式（左栏 + 右栏），
     窄屏一栏时左栏让位，出口就只剩这一枚。 */
  const showBack = ((!S.mode||S.mode==="list") && S.showDetail) ||
                   S.mode==="tasks" ||
                   (S.mode==="more" && S.dt.more && S.dt.more.full) ||
                   (S.mode==="exam" && S.dt.exPreview) ||
                   S.mode==="settings";
  /* 里面再套一层 .topbar-inner：横条本身通栏（分隔线要顶到两边），
     但内容跟下面 .main-inner 用同一套左右边距，上下边缘才对得齐。
     再往里分 .tb-l / .tb-r 两组，只为窄屏折行用 —— 桌面上这两层是
     display:contents，等于不存在，排出来和分组之前一样（见 css/app.css）。 */
  el.innerHTML =
    '<div class="topbar-inner">'+
     '<div class="tb tb-l">'+
      /* 标题「广播控制台」（横竖屏同一份 —— 用户定的），竖屏上只把字号收一档（15px）。
         这一档一行装不下时四格读数整组折到第二行、靠右；见 css 里 .tb-stats 那段。
         需要「‹ 返回」时整块让位（.has-back），两者同一时刻只站一个。 */
      '<div class="brand'+(showBack?" has-back":"")+'"><h1>广播控制台</h1></div>'+
      /* 四格读数包成一组（.tb-stats）。宽屏（>980px）上这一层是 display:contents，
         等于不存在；只有竖屏上它才成为真的盒子，四格整体右对齐地贴在顶栏右端 ——
         「右对齐」这件事于是只写在这一个盒子上，不用给某一格挂 margin。
         顺带把**折行**也管住了：窄到四格一行放不下时，这一组自己往下折、而且组内
         是右对齐的，四格会从右下往左上排。没有这一层的话，最后那几格会甩到第二行
         的**最左边**（下面「设置」孤零零挂在标题底下），看着像画错了。 */
      '<span class="tb-stats">'+
      /* 标记和它的字样各自包一层 .stat（gap 6px）—— 用顶栏那个 14px 间距的话，
         点和「已连接」会各看各的，像是在说两件事。
         「已连接」这句话**本身就是重连按钮**（以前挂在右边那个「终端 xx/xx」读数上）：
         一个页面只要一个重连入口，长在「连上了没有」这句话上，比长在一个计数上自然 ——
         计数回答的是「有几个终端在线」，不是「点我能重连」。

         三格读数都是 .cellbtn，提示语挂在**格子**上，不挂在里头的字或图标上：
         提示语写着「点击…」，就得连旁边那颗图标一起算数 —— 鼠标落在格子里哪一处
         都是同一件事，不用猜自己指到了哪个元素。 */
      '<span class="stat cellbtn" id="connCell" title="'+esc(connTitle())+'">'+
        '<span class="dotstat '+S.conn+'" id="connDot"></span>'+
        '<button class="dimmer chip-link" id="connBtn">'+connText()+'</button></span>'+
      /* 终端在线状态是另一条 WebSocket，跟 REST 通不通是两回事，分开报。
         这一格点开「终端管理」（在线 / 离线两页签，见 15-status.js 的 openTermList）。
         推送没连上时它照样点得开 —— 那张表会照实写「状态未知」，比一个点不动的读数有用；
         「推送连没连上」这句交代跟着搬进了那张表的副标题（提示语让给「点击查看终端管理」了）。 */
      '<span class="stat cellbtn" id="termCell" title="点击查看终端管理">'+
        '<span class="icostat '+(S.link==="ok"?"ok":S.link==="busy"?"busy":"bad")+'" id="linkDot">'+ICON.monitor+'</span>'+
        '<button class="dimmer chip-link" id="linkText">'+esc(linkText())+'</button></span>'+
      /* 头像 + 「注销」。头像就是图标库里那个人头（ICON.user），不套圈、绿的那颗，
         和左边那颗显示器同尺寸 —— **不是**谁的照片。整格是退出按钮，头像只是这一格的记号。 */
      '<span class="stat cellbtn" id="userCell" title="'+esc(logoutTitle())+'">'+
        '<span class="avatar">'+ICON.user+'</span>'+
        '<button class="dimmer chip-link" id="logoutBtn">注销</button></span>'+
      /* 「设置」跟在「注销」右边（用户定的）。它原来和三个业务页签挤在
         同一排里，还是那一排里唯一一个**光有图标没有字**的项 —— 摆在「账号那几格」
         这一头才对：它说的是「这台面板本身怎么配」，不是「去哪一页干活」。
         绿色的齿轮：和旁边那枚人头同一个绿（--good），说的是「这是设置这一格」，
         不是任何状态。整格可点，和左边三格一个待遇。
         格子里这行字短了（「全局设置」→「设置」，用户定的）：顶栏本来就紧，
         这一格和「注销」一起各让出两个字。full name 挂在格子的提示语上。 */
      '<span class="stat cellbtn" id="setCell" title="打开全局设置">'+
        '<span class="geartic">'+ICON.gear+'</span>'+
        '<button class="dimmer chip-link" id="setBtn">设置</button></span>'+
      '</span>'+   /* .tb-stats ── 四格读数到此为止 */
      '<div class="spacer"></div>'+
     '</div>'+
     '<div class="tb tb-r">'+
      /* 「‹ 返回」= 以前详情页里那个「‹ 任务列表」，搬到顶栏里、改叫「返回」。
         只有竖屏上才显示（.rail-back 那条规则），而且占的是**左端标题那一格**：
         标题和它二选一，同一时刻只站一个（见 css 里 `.brand.has-back` 那条）。
         三个地方要用它：

           1. 铃声计划的详情页，以及**定时任务那一页** —— 这两个是同一个版式
              （左边一栏列表、右边一栏详情），宽屏时侧栏一直摆在左边，点一下
              列表名就回来了，顶栏再来一个是同一个动作的第二遍，所以只管竖屏。
              （定时任务的入口是侧栏底部那张卡片，窄屏上它跟着侧栏一起让位，
              没有这一枚就退不出来了。）
           2. 「更多功能」查到结果之后（70-view-more 的 st.full），以及考试模式那枚
              眼镜后面的「改动预览」（40-view-exam 的 S.dt.exPreview）—— 竖屏上这两份
              结果视图都是**整块顶掉浏览区**的，那一页没有别的出口；页签虽然还在，
              但页签是「去别页」，不是「回到刚才那张表 / 刚才那份配置」。这两处宽屏
              那一支走的都是模态，弹窗自带关闭，所以这一条照样进不来。
           3. 设置页 —— **这一条横竖屏都判真，只是横屏上看不见它**（.rail-back 基线
              就是 display:none）：横屏的出口长在设置页自己那一行标题的最右边
              （「关闭设置」，见 20-ui.js 的 renderSettings），竖屏上那枚收起来，
              改用这一枚。竖屏没有这条退路的话就出不来了 —— 底部那条导航栏里
              压根没有「设置」这一格（它当初就是为这个从页签里搬走的）。

         它在顶栏里，不在 #main 里，而 lockDetail 只遍历 .wb-main 的控件 ——
         所以被考试模式锁住的那张详情页照样退得出来。这一条是刻意的，别改成
         「顺手也锁上」。 */
      (showBack ? '<button class="btn rail-back" id="tbBack">'+ICON.chevL+' 返回</button>' : "")+
      /* 页签和「提交」包成一组（.tb-act）。它在宽屏（>980px）上是 display:contents，
         等于不存在 —— 排出来和包之前一模一样；在竖屏上整组收起来（页签搬去了底下
         那条导航栏，见 renderNavbar）。所以这一层现在的用处只有一个：给「竖屏上把
         这两样一起收掉」一个抓手。
         见 css/app.css 里 .tb-act 那两处。 */
      '<div class="tb-act">'+
      '<div class="seg" id="modeSeg">'+
        '<button data-mode="list"'+(!S.mode||S.mode==="list"?' class="on"':"")+'>铃声计划</button>'+
        /* 「定时任务」原来在这儿（竖屏那条底部导航栏里也有一格）。两处都撤了：
           它不是一个和「铃声计划」平级的视图，而是**铃声计划这一页里**的另一种内容
           —— 入口改成长在侧栏底部的那张常驻卡片（见 renderRail 的 #railTasks），
           点了它之后右边那一栏从「某张列表」换成「定时任务」，左边那份列表照旧站着。 */
        '<button data-mode="exam"'+(S.mode==="exam"?' class="on"':"")+'>考试模式'+
          (modeDotOn("exam")?'<span class="seg-dot" title="考试模式启用中"></span>':"")+'</button>'+
        /* 「实时对讲」和「在线播放」：这两件是**对着终端说话／放东西**，
           和左边那两个「排班打铃」是两种活，所以单摆一段。位置在「更多功能」之前
           —— 那两个是日常会用的，更多功能是「其余」，谁在后头谁更边缘。

           「实时对讲」那一个**只在能拿到麦克风的页面里才摆**（见 75-view-live.js
           的 liveUsable）：明文 http 打开时浏览器根本不给 mediaDevices，摆出来
           就是个按下去必然失败的页签。「在线播放」不受这条管 —— 它不要麦克风，
           AudioWorklet 在明文 http 下虽然没有，但那条路还有 ScriptProcessorNode
           可以退，所以它在非安全上下文里**照样摆得出来**（见 playUsable）。 */
        (liveUsable() ?
          '<button data-mode="live"'+(S.mode==="live"?' class="on"':"")+'>实时对讲'+
            (modeDotOn("live")?'<span class="seg-dot" title="正在通话中"></span>':"")+'</button>' : "")+
        (playUsable() ?
          '<button data-mode="online"'+(S.mode==="online"?' class="on"':"")+'>在线播放'+
            (modeDotOn("online")?'<span class="seg-dot" title="正在播放中"></span>':"")+'</button>' : "")+
        /* 「更多功能」：装那些一年用不上两回、但不该没有的东西（眼下是终端任务
           反查）。它排在最右边 —— 左边那些是「日常在用的」，这一个装的是「其余」。 */
        '<button data-mode="more"'+(S.mode==="more"?' class="on"':"")+'>更多功能</button>'+
        /* 齿轮原来住在这儿（这一排里唯一一个光有图标没有字的项）。现在搬去左边
           「注销」右边那一格，改叫「设置」，竖屏那条底部导航栏里也不放它 ——
           四个页签是「去哪一页干活」，它是「这台面板怎么配」，两件事不该混在一排。 */
      '</div>'+
      /* 这颗按钮**现在一律不显示**：草稿模式收着、S.draft 恒 false，于是它永远挂着
         disabled，CSS 那条 `#pushBtn[disabled]{display:none}` 让它整颗消失。
         下面这一整段是它还在时的账（SHOW_MODE_SWITCHES 一打开就重新生效）。

         即时模式下没有「攒着」这回事，改动当场就写进去了，这一格没有存在的理由。
         队列在即时模式下自己会被 settle() 排干，所以藏掉它不会把改动憋在队列里。
         开关关着时**三档一律整颗消失**（`#pushBtn[disabled]{display:none}`，见
         css/app.css，全局那一条）。
         走过两段弯路，都记在这儿免得再走回去：窄屏一度改成 visibility:hidden
         「留位不可见」—— 最窄那几档它被挤到第三行，那一行就成了一条**全空白**的
         横条；后来改成「看得见的灰按钮」—— 用户说不要常驻，于是又回到消失。
         （那两段弯路都是「竖屏顶栏分两行」那个年代的事。现在竖屏顶栏那一行排满
         就完了 —— 这一档它随 .tb-act 整组收着，在那儿没有去处，见下面的注释。）
         按钮本身永远渲染（这里只管画、显不显示交给 CSS 那条）—— DOM 里少一个节点，
         顶栏的折行会跟着变，那才是真正难查的那种抖。

         **按钮里不写待提交的条数**（用户定的）：那个数字一出现按钮就从 40px 变 58px，
         窄屏上正好够把这一行顶折 —— 又是一种高度抖动。数量的去处有两个，都够用：
         按下去那个二次确认框第一句就是「把攒着的 N 项改动写入广播服务器」，
         调试模式的侧栏里也一直列着队列（那只侧栏跟着调试模式一起收了，见下）。
         于是按钮宽度固定，顶栏就不会因为它变脸。
         有活儿等着的时候按钮仍是主色（btn-primary），一眼看得出「有东西没发」。 */
      '<button class="btn '+(S.draft&&np?"btn-primary":"")+'" id="pushBtn"'+(S.draft?"":" disabled")+'>提交</button>'+
      '</div>'+   /* .tb-act ── 页签 + 提交 到此为止 */
      /* 提交按钮在开关**左边**：先看「有几条等着发」，再是「发不发得出去」这个开关，
         跟这一行从左到右的读法一致（页签 → 动作 → 开关）。
         字样竖排两行（草稿 / 模式）—— 见 css/app.css 里 .topbar .switch > .dimmer
         那段：横着四个字在手机上会把这一行挤爆，竖着只占两个字宽。

         **整块只在 SHOW_MODE_SWITCHES 打开时渲染**（00-core.js 里那个值，现在关着）：
         两个模式的入口都收起来了，这里连节点都不生成。它不在，第一行就少 88px 和
         一条缝 —— 竖屏那档的实测数记在 css 里，跟着一起看。 */
      (SHOW_MODE_SWITCHES ?
      '<label class="switch" title="'+(S.draft?"草稿模式：改动先攒着，一起提交":"即时模式：改动立刻写进服务器")+'">'+
        '<input type="checkbox" id="draftToggle"'+(S.draft?" checked":"")+'>'+
        /* 字在开关**左边**：读法是「草稿模式 → 开着没有」，先认名字再看状态，
           和这一行其它几格（标记在左、字样在右）刚好相反 —— 那几格是「点 + 状态」，
           这一格是「开关的名字」，名字得先出来。 */
        '<span class="dimmer">草稿<br>模式</span><span class="track"></span>'+
      '</label>' : "")+
     '</div>'+
    '</div>';
  /* 点「已连接 / 未连接」= 重连。这句话说的是 REST 通不通，所以重连分两半：
     终端在线状态那条 WebSocket 重开一遍；REST 那边拿存着的令牌**探一次**。

     ── 探针为什么不是 /auth ──────────────────────────────────────────
     服务器的 /auth 是**纯登录**接口：它只认 name + password 两个参数，
     authorization 头上的令牌**它看都不看**。实测（2026-10-14，拿一个当场登录
     换来的有效令牌）：

         GET /api/v2/auth?userinfo=true&withRoles=true&withUsersConfig=true
         + authorization: <有效令牌>        → {"message":"用户名不能为空."}
         + authorization: Bearer <有效令牌> → 同一个错
         同一颗令牌去问 /timing-bells-groups/all?withUser=true → HTTP 200

     以前这里就是拿 /auth 当探针的，于是**每次点都必然失败**，还报成「服务器没有
     响应」—— 用户实测报的就是这个。面板不存密码（也不该存），所以重连不可能再登
     一次；只能拿一个**日常在用的**接口探一次：它认令牌，通了就说明这条链路此刻
     是活的。代价是 S.user 不再刷新 —— 那是 /auth 才给的东西，本地这份本来就是
     登录那一刻的快照，够用。

     ⚠ 同一条错误假设也在 90-boot.js 里（开机拿存着的令牌问 /auth）—— 那边一动就是
     另一件事（「记住登录状态」到底要不要真的记住），没动。

     ── 其余几条口径 ────────────────────────────────────────────────
     **两半都重来，不管当下显示的是什么**。以前连着的时候点它会跳过 REST 那一半，
     于是左边这格（也就是按钮本身）从头到尾不变，动的却是旁边那句「终端 xx/xx」——
     点谁谁不动、旁边的东西在跳，看着像点错了地方（用户实测）。
     既然按钮长在「已连接」这句话上，这句话就得当场变「连接中」，转完再说结果。

     每次点都真去问一趟服务器，不是白跑：REST 是无状态的，本地那个 S.conn 记的是
     「上一次请求的成败」，它可能是几分钟前的事。重连的意义就是此刻重新确认一次。

     顺序：先收掉推送 → 探一次 REST → 再把推送开回来。和开机那条路（REST 全跑完
     才开推送）一致，不让推送和 REST 撞在一起。 */
  /* 绑在**格子**上，不绑里头的按钮：整格可点，点图标和点字是同一件事。
     里头那个 <button> 照旧留着 —— 键盘能聚焦、能回车，事件冒泡上来还是走这里。 */
  el.querySelector("#connCell").onclick = async ()=>{
    if (!S.token) return;              /* 没令牌就是还没登录，这一页本来就不该在 */
    S.conn = "busy"; renderAll();
    closeStatusFeed();                 /* 先收掉那条推送，别和新会话抢同一个令牌 */
    try{
      await api("GET","/timing-bells-groups/all",{params:{withUser:"true"}});
      S.conn = "ok"; renderAll();
      toast("已重新连接到 " + S.server.replace(/^https?:\/\//,""), "ok");
    }catch(e){
      /* 不管什么原因都报「服务器没有响应」等于什么都没说 —— 401、500、真断网
         三种事一句话。api() 给网络层的失败打了 network 标记，照着分开报。 */
      S.conn = "bad"; renderAll();
      toast(e && e.network ? "重连失败：服务器没有响应"
                           : "重连失败：" + ((e && e.message) || e), "err");
    }
    openStatusFeed();                  /* REST 这一趟有结果了，再把推送开回来 */
  };
  el.querySelector("#termCell").onclick = openTermList;
  /* 退出登录先问一句（用户要的）。这一下不是白问：它会**当场作废本机那张令牌**，
     还会把攒着没提交的改动一起清掉（见 10-data.js 的 doLogout）—— 点错了没有后悔药。 */
  el.querySelector("#userCell").onclick = ()=>{
    openConfirm("退出登录", "是否退出登录？", doLogout, "退出登录");
  };
  /* 开关收着的时候这一格根本不在（见 SHOW_MODE_SWITCHES），所以判空再绑。 */
  const draftToggle = el.querySelector("#draftToggle");
  if (draftToggle) draftToggle.onchange = e => setDraft(e.target.checked);
  /* 平时：问一句就提交，不弹侧窗。调试模式：先摊开提交队列，你按下「发送」才走。
     按钮现在**总是**渲染（即时模式下只是挂 disabled，见上面那段），所以不用判空；
     即时模式下它要么 display:none、要么 visibility:hidden，点不着也走不到这里。
     调试模式收着的时候（SHOW_MODE_SWITCHES 关着，S.debug 恒 false）这个分支进不去，
     那个侧栏也就没有了入口 —— 它本来就是「提交前看一眼报文」用的。 */
  el.querySelector("#pushBtn").onclick = ()=>{
    const n = S.pending.filter(o=>o.status==="pending").length;
    if (S.debug) return openDrawer();
    if (!n){ toast("当前没有待提交的修改"); return; }
    openConfirm("提交到服务器", "把攒着的 "+n+" 项改动写入广播服务器，改完立即生效。",
      pushAll, "提交");
  };
  const tbBack = el.querySelector("#tbBack");
  /* 必须是 renderAll() 而不是只 renderMain()：这个按钮住在顶栏里，不重画顶栏
     它自己不会消失。renderAll() 顺带 closeDatePicker()，和别的「整页换视图」同路。

     「更多功能」那一支只把 st.full 收掉，**不碰 st.hits** —— 退回表单页之后
     再点一次「开始查询」就重新出来；查过的东西是这一趟会话的事，不是错误，
     没有理由顺手清掉。（真正要清的是「日期/终端改了」，那条路走 moreInvalidate。） */
  if (tbBack) tbBack.onclick = ()=>{
    /* 定时任务那一页：退回「铃声计划」，侧栏（那张卡片就在它底下）跟着回来。
       S.showDetail 一个字不碰 —— 进来之前那一位是真是假，退回去就还是哪一位：
       从某张列表的详情页点卡片进来的，退回那张详情页；从左侧那份列表点进来的，
       退回那份列表。 */
    if (S.mode==="tasks"){ S.mode = "list"; renderAll(); return; }
    if (S.mode==="more" && S.dt.more && S.dt.more.full){ S.dt.more.full = false; renderAll(); return; }
    /* 考试模式那份「改动预览」同一个道理：收掉这一格，退回**考试模式这一页**，
       手上那份安排（S.exam）一个字都没动过 —— 预览是只读的，退出来就是原来那一页。 */
    if (S.mode==="exam" && S.dt.exPreview){ S.dt.exPreview = false; renderAll(); return; }
    /* 设置页退**来的那一页**（见下面 lastMode），不是退回首页 —— 从考试模式进设置、
       一按返回落到铃声计划，那是走丢了，不是返回。 */
    if (S.mode==="settings"){ goMode(lastMode); return; }
    S.showDetail = false; renderAll();
  };
  /* 「设置」那一格：整格可点（和左边三格一样），点图标和点字是同一件事。 */
  el.querySelector("#setCell").onclick = ()=> goMode("settings");
  /* 顶栏这一排页签（宽屏（>980px）上用它；竖屏上它整排收起来，改用下面那条
     底部导航栏 —— 见 css 里 `.topbar .seg{display:none}` 那一档）。 */
  $$("#modeSeg button", el).forEach(b => b.onclick = ()=> goMode(b.dataset.mode));
}

/* 换页签 = 换 S.mode 再整页重画。三个地方走这一条路：顶栏那排页签、竖屏底部那条
   导航栏、还有「设置」那一格。
   「定时任务」那一页的数据是懒加载的（切过去才拉，见 60-view-tasks.js），这一句留着。

   lastMode 记的是「上次待的那个页签」，一件事两个用处：
     · 刷新页面停回原来那一页 —— 90-boot.js 拿它当第一帧的 S.mode（**在第一帧之前**，
       不是等数据回来再切：晚一步人先看见一整页铃声计划加一句「正在连接广播服务器」，
       然后才跳走）。只在进得了主界面那一支；停在登录页时不走，见那边的注释 ——
       那一支改造了三处地方才站得住，别把哪一处改回去。
     · 从设置里退出来，退到**进来的那一页** —— 从考试模式进设置、一按返回落到
       铃声计划，那是走丢了，不是返回。横竖屏两个出口都是它（见 20-ui.js 的
       「关闭设置」和上面那枚返回键）。

   **它同时记在本机（bc.lastMode）**，不然刷新一下就回默认页了。两个视图**不算页签**
   （见下面那句判断）：设置是「这台面板怎么配」、定时任务是「铃声计划这一页的另一种
   内容」，都不是「去哪一页干活」，记成它们会让上面两件事都失去意义（退设置退到设置；
   刷新停在定时任务上，而它连页签都没有，退出去只能靠顶栏那枚返回键）。
   本机那一份**跟着登录会话走**，forgetLogin() 会把它抹掉 —— 注销或令牌过期重登，
   从铃声计划起步。初值是 list（S.mode 一开始是空串，那也是铃声计划）。 */
let lastMode = LS.get("lastMode", "list");
function goMode(m){
  if (m !== "settings" && m !== "tasks"){ lastMode = m; LS.set("lastMode", m); }
  S.mode = m;
  if (m === "tasks") loadTasks();
  renderAll();
}

/* 点侧栏底部那张「定时任务」卡片。**不走 goMode**：那一趟会把页签记进 lastMode，
   刷新一下就又停在定时任务上了（用户明确不要这一条）。
   数据是懒加载的（切过去才拉，见 60-view-tasks.js），所以在这儿补一句 loadTasks()；
   它回来时会自己 renderMain() 一趟，表身就填上了。 */
function openTasks(){
  S.mode = "tasks";
  loadTasks();
  renderAll();
}

/* ══ 竖屏那条底部导航栏 ══════════════════════════════════════════════
   顶栏那排业务页签在这儿各有一份：图标在上、文字在下，像 iOS 的 tab bar。
   **只有竖屏（≤980px）看得见** —— 宽屏上这整根是 display:none，顶栏右上那排页签
   一个字没动。

   它在 DOM 里一直在（不靠 js 判断屏幕宽窄去增删）：面板里**布局**这一层的断点全由
   css 的媒体查询说了算 —— 全项目唯一一处 matchMedia 在 70-view-more.js，它决定的是
   「结果画在哪个容器里」，不是布局 —— 这里也不破例。

   每一格等宽（flex:1 1 0），所以底部这一条不管屏幕多宽都是平均分 —— 格数跟着
   顶栏那排页签走（「实时对讲」拿不到麦克风时两边一起少一格；「定时任务」那格
   已经撤了，它的入口是侧栏底部那张常驻卡片，不在这一条上）。
   当前这一页染主色、下面的字加粗 —— 颜色之外还有字重这一层，不只靠颜色说话。
   「考试模式」那一格在它启用时角上带一颗小圆点，和顶栏那排页签上的 seg-dot 是同一件事。 */
function renderNavbar(){
  const el = $("#navbar"); if (!el) return;
  const on = m => ((!S.mode && m==="list") || S.mode===m);
  const item = (m, ic, tx)=> '<button class="navbar-btn'+(on(m)?" on":"")+'" data-mode="'+m+'"'+
      ' title="'+esc(tx)+'"'+(on(m)?' aria-current="page"':"")+'>'+
      '<span class="navbar-ic">'+ic+
        (modeDotOn(m) ? '<span class="navbar-dot"></span>' : "")+
      '</span><span class="navbar-tx">'+esc(tx)+'</span></button>';
  el.innerHTML =
    item("list",  ICON.bell,  "铃声计划")+
    item("exam",  ICON.exam,  "考试模式")+
    /* 「实时对讲」和顶栏那排页签同一条规矩：拿不到麦克风就不摆（liveUsable）；
       「在线播放」只要浏览器有 Web Audio 就能放（明文 http 下退到
       ScriptProcessorNode），所以它一般都在（playUsable）。 */
    (liveUsable() ? item("live", ICON.phone, "实时对讲") : "")+
    (playUsable() ? item("online",ICON.play,  "在线播放") : "")+
    item("more",  ICON.grid,  "更多功能");
  $$("[data-mode]", el).forEach(b => b.onclick = ()=> goMode(b.dataset.mode));
}

/* 当前这一页是不是只读的（原件被考试模式锁住）。行点击、批量条这些
   共用一条通路的地方都问它一句，省得给每个入口单独写判断。 */
let LOCK_NOW = false;

/* 侧栏只列「人该管的」列表。考试模式造出来的 ¤exam_task 和 xxx¤temp 副本是它自己的
   中间产物，不在这里露面（见 40-view-exam.js 的 isExamHiddenList）。 */
const railGroups = () => S.data.groups.filter(g=> !isExamHiddenList(g));

function renderRail(){
  const el = $("#rail"); if (!el) return;
  const vis = railGroups();
  const items = vis.map(g=>{
    const on = Number(g.id)===Number(S.groupId);
    /* 正在换任务时这一格写「—」：手上那份 S.bells 还是上一条任务的，数出来是
       别人家的条数（见 00-core.js 的 gLoad）。 */
    const n = (on && !S.gLoad) ? S.bells.length : null;
    const off = !isListEnabled(g);      /* is_done≠1 → 服务器上这张列表是停用的 */
    const dead = isListExpired(g);      /* 执行年份已经过去了 */
    const lock = isExamLocked(g);       /* 原件被考试模式锁着（接管它的那份正在发声） */
    /* 被接管的那张原件在服务器上是**停用**的（考试期间发话的是接管它的那份），可这一栏
       照启用显示：灰色的底加一个关着的开关，看着像「这张列表没人管 / 是不是坏了」，而它
       其实好好待在那儿等着考完（用户定的）。真该显示停用的，是那种本来就停用、因此压根
       没被接管的列表 —— queueExamCopies 只复制 isListEnabled 的那些，所以「被锁住」和
       「本来就停用」互斥，那种列表 lock 为 false，off 照旧生效。 */
    const shownOff = off && !lock;
    /* 提示语里**不能出现服务器上的列表名**，也不提那个替它发声的列表叫什么 ——
       用户只该知道「考试期间这一条归面板管，闪避的时段和区域是它算出来的」。
       替它发声的那份叫什么名字是实现细节，写出来只会让人去服务器上找它。 */
    const tip = (lock ? "已被考试模式锁定，将自动计算闪避时段和区域"
                      : dead ? "该列表的执行年份已过（到 "+String(g.end_date||"").slice(0,10)+"）"
                      : off ? "该列表在服务器上是停用状态，不会打铃" : "该列表已启用");
    return '<div class="rail-item'+(on?" on":"")+(shownOff?" is-off":"")+(dead?" is-dead":"")+(lock?" is-locked":"")+'">'+
      '<button class="rail-pick" data-gid="'+g.id+'" title="'+esc(g.name)+' · '+esc(tip)+'">'+
        '<span class="r1"><span class="nm">'+esc(g.name)+'</span></span>'+
        '<span class="r2"><span>'+(n==null?"—":n+" 条")+'</span></span>'+
      '</button>'+
      (lock?'<span class="pill-lock" title="'+esc(tip)+'">已锁定</span>'
           : dead?'<span class="pill-crit">已过期</span>':"")+
      /* 锁着的那一行也**照常显示开关**，只是点不动（disabled）。开关留在原位、显示成
         开着的样子 —— 那一行是启用的，开关就该是开的；旁边那枚「已锁定」说明为什么
         点不动。和普通开关同一个 .sw-mini，只多一个 disabled 属性。 */
      (lock
        ? '<button class="sw-mini'+(!shownOff?" on":"")+'" disabled aria-checked="'+(!shownOff)+'" title="'+esc(tip)+'"></button>'
        : '<button class="sw-mini'+(!shownOff?" on":"")+'" data-gid="'+g.id+'" role="switch" aria-checked="'+(!shownOff)+'"'+
          ' title="'+esc(off ? "点击启用「"+g.name+"」" : "点击停用「"+g.name+"」")+'"></button>')+
    '</div>';
  }).join("");
  el.innerHTML =
    '<div class="rail-head">任务列表 · '+vis.length+'</div>'+
    '<div class="rail-list">'+(items||'<div class="hint" style="padding:10px">没有可用的铃声列表</div>')+'</div>'+
    /* 常驻在侧栏底部的「定时任务」卡片 —— 它原来在顶栏那排页签和竖屏底部导航栏里
       各占一格，两处都撤了，入口只剩这一张。
       它在 .rail-list **外面**（不跟着列表滚），外形就是一条 .rail-item（同一个圆角、
       边框、白底），只有一处不同：**右边那枚不是开关，是「›」**。开关说的是「这条
       列表启不启用」，而定时任务不是一个列表 —— 点它是换一页，所以给路标不给开关。
       当前就停在定时任务上时它同样染主色（.on），和左边选中的那条列表一个意思。 */
    '<div class="rail-tasks">'+
      '<button class="rail-card'+(S.mode==="tasks"?" on":"")+'" id="railTasks" title="打开定时任务">'+
        '<span class="nm">定时任务</span>'+
        '<span class="chev">'+ICON.chevR+'</span>'+
      '</button>'+
    '</div>'+
    '<div class="rail-foot">'+
      /* 刷新在左、「新建任务」在右（用户定的）：主操作贴着右端那一边，
         它又占着 flex:1，于是左边那颗刷新键被稳稳顶到最前头。 */
      '<button class="btn btn-sm btn-quiet btn-icon" id="reloadAll" title="重新拉取" aria-label="重新拉取">'+ICON.refresh+'</button>'+
      '<button class="btn btn-sm" id="newGroup" style="flex:1;justify-content:center">'+ICON.plus+' 新建任务</button>'+
    '</div>';
  /* 窄屏上「点列表」= 要去看它的详情，所以那一栏也切过去。并排显示时这个值不参与
     布局（CSS 只在 ≤980px 认它），写它没有副作用。
     注意是**点这里**才置位，不是写在 selectGroup() 里 —— 启动时 loadAll() 也会调
     selectGroup() 恢复上次那个列表，写在里面的话手机上开机就直接落在详情页上，
     而这条路的起点应该是列表。
     下一句同理（S.mode = "list" 原来就住在 selectGroup 里）：点列表 = 回到列表视图，
     是**这个动作**的意思，不是「凡是选中一张列表就回列表页」—— 刷新页面时
     loadAll() 也走 selectGroup()，那一趟得把页签留在用户原来待的那一页上。 */
  $$(".rail-pick", el).forEach(b=> b.onclick = ()=>{
    S.mode = "list";
    S.showDetail = true;
    /* 「读取失败」那句正文不解释原因（它只管说清下一步），原因由这儿报一声。
       也**必须**接住这一下：不接的话它就是个没人管的 Promise 拒绝 —— 开机那条
       （loadAll → doLogin）自己带 catch，这一条没有。 */
    selectGroup(Number(b.dataset.gid))
      .catch(e=> toast((e && e.message) || "读取铃声列表失败", "err"));
  });
  $$(".sw-mini", el).forEach(b=> b.onclick = ()=>{
    const g = S.data.groups.find(x=>Number(x.id)===Number(b.dataset.gid));
    if (!g) return;
    const to = !isListEnabled(g);                 /* 当前停用 → 点一下启用 */
    /* 考试期间「启用」要先问一句（考试模式那份提醒，见 40-view-exam 的 examGuard）。
       停用不问：多停一条只会让考试少受干扰，那不是需要提醒的事。
       被考试模式锁住的那种列表压根到不了这儿 —— 它们渲染出来的是 disabled 的开关，
       没有 data-gid（见上面 renderRail 那一段）。 */
    const go = ()=>{
      queueListToggle(g, to);                     /* 本地先改并重画 rail，再排队提交给服务器 */
      /* 两个方向都走 ok，也就是**都不弹**：停用不是警告，不该提醒（用户定的）；
         「启用」那条报喜也早就被 toast() 那道闸拦着了（00-core.js 里 `if(kind==="ok")return`）。
         改没改成，看那一行的开关和旁边的状态就够了。
         文案照旧拼全 —— 哪天要把「启用」放回来，只改那道闸，这里一个字都不用动。 */
      toast((to?"已启用「":"已停用「")+g.name+"」"+tailFor(), "ok");
    };
    if (to) examGuard(go); else go();
  });
  el.querySelector("#newGroup").onclick = ()=> examGuard(openNewGroup);
  el.querySelector("#railTasks").onclick = openTasks;
  el.querySelector("#reloadAll").onclick = async ()=>{ try{ await loadAll(); toast("数据已刷新","ok"); }catch(e){ toast(e.message,"err"); } };
}

function renderMain(){
  /* 会话胶囊（通话中／播放中切到别的页时挂在顶栏下面那枚，见 75-view-live.js 的
     syncSessionBadge）在**这个函数的最前头**同步一次。放这儿是因为「哪一页」和
     「哪条会话还活着」这两件事最后都汇到 renderMain 上：换页签走 goMode→renderAll，
     通话/播放的每一次状态变更也都以 renderMain() 收尾。包一层壳不如加这一行 ——
     底下那六个 if(...) return renderX() 的早退，一行就全绕过去了。
     放在 $("#main") 那句守卫**之前**：登录页上根本没有 #main，可胶囊该收起来。 */
  syncSessionBadge();
  /* 页签／导航栏上那几颗「正在跑」的小圆点（考试模式启用、对讲接通、在线播放
     在放）跟着会话状态走。和胶囊同一条理由：它们的每一次状态变更也都以
     renderMain() 收尾，挂在这儿一分钱不用多花。 */
  syncModeDots();
  const el = $("#main"); if (!el) return;
  el.classList.remove("pane","fill","headfix","setpage"); /* 这几种「整页不滚」的布局，见下面的 add */
  if (S.mode==="exam") return renderExam();
  if (S.mode==="tasks") return renderTasks();
  if (S.mode==="settings") return renderSettings();
  if (S.mode==="more")     return renderMore();
  if (S.mode==="live")     return renderLive();
  if (S.mode==="online")   return renderPlayback();
  const vis = railGroups();
  const g = vis.find(x=>Number(x.id)===Number(S.groupId));
  el.classList.add("pane");
  if (!g){
    /* 选中的那个不见了（考试模式把它藏起来了、服务器上删掉了，或者这台机器第一次
       用、还没挑过任何列表）。**侧栏照样画出来** —— 以前这里直接 return 一句
       「选择一个铃声列表」，连列表都不画，人没有任何办法走出去。宽屏上这只是
       一个死角，窄屏上更严重：那正是「先给列表，点进详情」这条路的起点。
       loadAll() 里 want 落不到任何可见列表时不会调 selectGroup()，这条分支够得着。 */
    renderNoGroup(vis);
    return;
  }
  const listKey = JSON.stringify([S.listArea.t.slice().sort(), S.listArea.g.slice().sort()]);
  /* 铃声还在路上（S.gLoad）时这几样一律按「还不知道」算：手上那份 S.bells 还是
     上一条任务的，照着它数出来的条数、空区域都是别人家的 —— 那条「有 N 条铃声
     没有任何执行区域」的红横幅尤其不能这么冒出来。 */
  const nEmpty = S.gLoad ? 0 : S.bells.filter(isEmptyArea).length;
  const dead = isListExpired(g);
  /* 原件被考试模式锁着：整页只读，加一条说明为什么 */
  const lock = isExamLocked(g);
  LOCK_NOW = !!lock;

  el.innerHTML =
    '<div class="wb'+(S.showDetail?" show-main":"")+'">'+
    '<aside class="rail" id="rail"></aside>'+
    '<div class="wb-main">'+
    '<div class="sec-head'+(dead?" is-dead":"")+'">'+
      '<div class="sec-title">'+
        '<div class="title-row">'+
          /* 那个「‹ 任务列表」原来长在这儿（.rail-back，只有窄屏显示）。现在搬去
             顶栏左端、改叫「‹ 返回」（见 renderTopbar 的 #tbBack）—— 竖屏上它和
             标题是同一格的两种占法（同一时刻只站一个），而「回到列表」这件事
             本来就属于顶栏，不属于标题。 */
          '<h2 class="serif">'+esc(g.name)+'</h2>'+
          '<span class="acts">'+
            '<button class="btn btn-icon" id="mEditList" title="编辑任务属性"'+(lock?" disabled":"")+'>'+ICON.edit+'</button>'+
            '<button class="btn btn-icon btn-danger" id="mDelList" title="删除这个任务"'+(lock?" disabled":"")+'>'+ICON.del+'</button>'+
          '</span>'+
        '</div>'+
        '<div class="meta">'+
          /* 这里原来挂过三枚胶囊，撤掉两枚 ——
             - 「考试模式锁定」：被锁时下面那条横幅已经用同一枚「已锁定」胶囊
               说清楚了，标题栏再挂一枚就是说两遍。
             - 「待提交 N」：报的是攒了多少条改动，而它只等着活儿的时候才冒
               出来，标题底下这行会跟着忽有忽无（.meta 自己还带 5px margin-top，
               有它没它版面不一样）。要数还有几条没发，抽屉里列得更清楚。
             剩下这枚「已过期」是**这张列表**自己的状态，没别处说，留着。 */
          (dead?'<span class="pill-crit">已过期</span>':"")+
        '</div>'+
      '</div>'+
    '</div>'+

    /* 顶上这两条横幅都挂 .banner（css 里「提醒横幅长这样」的那个锚点，扁的），
       并且**包在同一个 .banner-group 里**（缝 8px、下面 16px，见 css）——
       和考试模式页那两条是同一套：不包的话两条之间那道 14px 压不掉，因为它是
       `.panel + .panel` 给的，不是哪一条自己的边距。两条都在时才有那 8px；
       只有一条时这个壳就是个透明容器（一条都没有时整个壳不渲染，省得白留 16px）。
       .lock-banner 另有一份差事：`.wb-main.is-locked > .banner-group > .lock-banner ~ *`
       灰的是**它之后的兄弟**，横幅本身和上面的标题栏不灰。锁定时这条必定渲染，
       别把类名去掉，也别把壳拆了 —— 那条选择器认的就是这个壳。 */
    ((lock||nEmpty)? '<div class="banner-group">'+
      (lock?'<div class="panel banner lock-banner" style="border-color:var(--warn)"><div class="panel-body" style="display:flex;gap:10px;align-items:center">'+
        '<span class="pill-lock">已锁定</span>'+
        '<span style="font-size:13px"><b>此计划已被锁定</b>，关闭考试模式后可修改</span>'+
      '</div></div>':"")+

      /* .banner-btn = 这条横幅里带一枚按钮。按钮比旁边那行字高一头，靠它这一格 css
         会把上下内边距再收一档，两条横幅才一样高（见 css 里 .banner-btn 那段）。 */
      (nEmpty?'<div class="panel banner banner-btn" style="border-color:var(--crit)"><div class="panel-body" style="display:flex;gap:10px;align-items:center">'+
        '<span class="badge" style="background:var(--crit-soft);color:var(--crit)">需处理</span>'+
        '<span style="font-size:13px">有 '+nEmpty+' 条铃声<b>没有任何执行区域</b>，到时间不会响。</span>'+
        '<button class="btn btn-sm" id="fixEmpty" style="margin-left:auto"'+(lock?" disabled":"")+'>设为列表区域</button>'+
      '</div></div>':"")+
    '</div>' : "")+

    /* 正文那三块（打铃区域 / 铃声分组 / 铃声）收进一个盒子：标题栏和上面那两条横幅
       留在盒子外面，竖屏上因此钉得住，只有这里面的东西跟着滚。
       和「全局设置」「考试模式」两页的 .headfix 是同一件事，只是这一页的正文
       长在右栏里，所以这类规则挂在 .wb-main 下面而不是 .main-inner 上（见 css）。 */
    '<div class="page-body">'+
    /* 铃声还在路上（S.gLoad）：正文整块让位给一句话。**三块一起让** —— 手上那份
       S.bells / S.listArea / S.grpMeta 都还是上一条任务的，只把表身换掉的话，
       上面「打铃区域」「铃声分组」两块照旧摆着别人家的内容。
       「读取失败」那句没有第二处交代（侧栏那条路由调用点弹一声报错，见 renderRail
       末尾的 .rail-pick），所以这句自己得说清楚下一步：再点一次这一条就是了。 */
    (S.gLoad
      ? '<div class="hint" style="padding:28px 4px">'+
          (S.gLoad==="bad"
            ? '<span style="color:var(--crit)">铃声列表读取失败，请重新打开这一条</span>'
            : '正在读取铃声…')+
        '</div>'
      :
    /* 「打铃区域」和「铃声分组」装在一个盒子里：横屏（>980px）两块并排一行，省下的
       高度全给下面那张表；竖屏还是上下两条。左边那块管「这些铃声在哪儿响」，右边
       那块管「它们分成几段管」，再往下才是逐条的明细 —— 从粗到细。
       等高那件事在 css 的 .duo 里（矮的跟高的齐平）。 */
    '<div class="duo">'+

    '<div class="panel">'+
      '<div class="panel-head">'+
        '<h3>打铃区域</h3>'+
        '<span class="acts"><button class="btn btn-sm" id="mArea"'+(lock?" disabled":"")+'>编辑区域</button></span>'+
      '</div>'+
      '<div class="panel-body">'+
        /* 空区域原来这儿是两行：一句「各条铃声的区域不一致」，下面 chips 那儿再
           跟一句「未设置区域 — 这些铃声到时间不会响」。同一件事说两遍，还都没告诉
           人该怎么办。现在合成一行，空就是空，顺手指着右上那枚「编辑区域」。
           **那句说明装在 .area-chips 里面**（和编辑面板、考试模式那几处一个写法）：
           那一格自带「一行胶囊高」的下限（见 css），句子搁在外头当兄弟，
           这一块就会在空态和一行胶囊之间 18px ↔ 24.6px 地跳。 */
        '<div class="area-chips">'+
          (S.listArea.t.length+S.listArea.g.length
            ? areaChips(S.listArea)
            : '<span class="hint">未设置打铃区域，点击「编辑区域」来添加</span>')+
        '</div>'+
      '</div>'+
    '</div>'+

    grpPanelHTML(lock)+

    '</div>'+          /* /.duo */

    '<div class="panel grow">'+
      /* 右上角这块是「一栏两态」：没勾选时是筛选+添加铃声，一勾选就原地换成
         批量动作。不再另起一条横条 —— 那会把表格整体往下推，看着像点错了。 */
      '<div class="panel-head"><h3>铃声</h3><span class="sub" id="tableFoot"></span>'+
        '<span class="acts" id="hdActs">'+
          '<span class="hd-seg" id="hdNormal">'+
            /* 宽度钉在 css 的 `.hd-seg > .sbox` 上（竖屏要收窄，内联的 width 收不动） */
            '<span class="sbox sbox-sm">'+ICON.search+
              '<input class="input" id="f-q" placeholder="筛选名称 / 时间" value="'+esc(S.dt.fq||"")+'"></span>'+
            /* 手机上这枚只写「添加」——「铃声」两个字由 .wide-only 藏起来（见
               app.css 的 ≤980px）。它和左边那个筛选框是这一行里最宽的两样，
               加起来约 345px，而 390px 的手机只有 328px 可用，不收就折成两行。
               外面这层 <span> 不是多余的：.btn 是 inline-flex + gap:6px，写成
               「添加<span>铃声</span>」的话那两截会各自变成一个 flex 项，中间多
               出一条 6px 的缝 —— 宽屏上这里一个像素都不该动。 */
            '<button class="btn btn-sm" id="mAddBell"'+(lock?" disabled":"")+'>'+ICON.plus+' <span>添加<span class="wide-only">铃声</span></span></button>'+
          '</span>'+
          '<span class="hd-seg" id="hdBulk" hidden></span>'+
        '</span>'+
      '</div>'+
      '<div class="tbl-wrap"><table class="tbl tbl-bells"><thead><tr>'+
        '<th style="width:34px"><input type="checkbox" id="selAll" '+(S.sel.size&&S.sel.size===S.bells.length?"checked":"")+'></th>'+
        /* 「状态」和行尾那个空表头（装三个图标）的宽度写在 CSS 里（.c-sw / .c-act），
           不写成行内 style：竖屏上要改的正是这两列，而行内样式只输给 !important,
           挪进 CSS 之后那边一条普通规则就压得住。宽度值见 css/app.css 的
           `.tbl-bells .c-sw` / `.tbl-bells .c-act`（60px / 106px）。 */
        /* 「时间属性」「播放时长」这两列只在横屏上露头 —— 竖屏按列号一起收掉
           （见 css 的 ≤980px 那一档），那时候「时间属性」回到名称底下、
           「播放时长」连同「音源」整列不显示。两套写法都在 DOM 里，谁说谁不显示
           由断点定，JS 里没有分支。 */
        '<th style="width:92px">时间</th><th>名称</th>'+
        '<th class="c-stg">时间属性</th><th>音源</th><th class="c-dur">播放时长</th>'+
        '<th>区域</th><th class="c-sw">状态</th><th class="c-act"></th>'+
      '</tr></thead><tbody id="rows"></tbody></table></div>'+
    '</div>')+         /* ← 这个右括号收的是上面那个三元：gLoad 为真时，正文只有那一句 */
    '</div>'+          /* /.page-body */
    '</div>'+          /* .wb-main */
    '</div>';          /* .wb */

  /* 铃声还在路上：正文那儿只有一句「正在读取」，底下这些绑定一个都找不到自己的
     元素（#mArea / #f-q / #rows …），整段跳过。侧栏照画 —— 换任务靠的正是它，
     而且它底下那颗刷新键是这条路唯一的出口。 */
  if (S.gLoad){ renderRail(); return; }

  el.querySelector("#mArea").onclick = ()=> openAreaEditor("list");
  el.querySelector("#mAddBell").onclick = ()=> openBellEditor(null);
  grpBind(el, lock);
  el.querySelector("#mEditList").onclick = openEditGroup;
  el.querySelector("#mDelList").onclick = ()=> deleteGroup(g);
  const fx = el.querySelector("#fixEmpty"); if (fx) fx.onclick = ()=>{ applyAreaToBells(S.bells.filter(isEmptyArea), bellArea({termNames:S.listArea.t,groupNames:S.listArea.g}), "补空区域"); };
  const fq = el.querySelector("#f-q"); if (fq) fq.oninput = e => { S.dt.fq = e.target.value; renderRows(); };
  const sa = el.querySelector("#selAll");
  if (sa) sa.onchange = e => { S.sel.clear(); if(e.target.checked) visibleBells().forEach(b=>S.sel.add(b.id)); renderRows(); renderSelbar(); };
  renderRows(); renderSelbar();
  el.querySelector("#hdActs").addEventListener("click", onSelbarClick);
  /* 锁定的原件：整页只读。按钮上已经挂了 disabled，这里再兜一层 —— 键盘、
     以后新加的入口都从这一个地方过。 */
  if (lock) lockDetail(el);
  renderRail();      /* #rail 是刚造出来的空壳，得填。放在这里 = 单独调 renderMain() 也不会留下空侧栏 */
}

/* 一条任务都没选中时的「铃声计划」页。和正常那份一样是 .wb 两栏，右栏换成一句
   空态 —— 侧栏必须画出来，它是唯一能挑到列表的地方。（见 renderMain 里的说明） */
function renderNoGroup(vis){
  const el = $("#main"); if (!el) return;
  LOCK_NOW = false;
  /* 自动登录那一趟还没回来（boot 先把主界面画出来、再去问服务器）：这会儿一条列表
     都还没有，落下来会写着「服务器上还没有铃声列表」—— 那是句假话，数据还在路上。
     判据用 S.conn==="busy"：连上之后它是 ok，只有「还没连上 / 正在重连」才是 busy。 */
  const connecting = S.conn === "busy" && !vis.length;
  el.innerHTML =
    '<div class="wb'+(S.showDetail?" show-main":"")+'">'+
    '<aside class="rail" id="rail"></aside>'+
    '<div class="wb-main">'+
      /* 这里原来有个只装着「‹ 返回」的空 .sec-head。按钮搬去顶栏（#tbBack）之后，
         留着那个壳只会实打实撑出 .sec-head 那 16px 的 margin-bottom ——
         一个纯占位的空行。整块一起拿掉。 */
      (connecting
        ? '<div class="empty"><h3>正在连接广播服务器</h3><p>'+esc(S.server)+'</p></div>'
        : '<div class="empty"><h3>选择一个铃声列表</h3><p>'+
          /* 空态这句话原来写的是「服务器上只有考试模式的临时列表，它们在『铃声计划』里
             不显示」—— 等于告诉用户「服务器上有些列表你看不到」。看不到就是看不到，
             没必要解释，解释只会让人去找。 */
          (vis.length ? '左侧是服务器上已有的铃声列表。'
                      : '服务器上还没有铃声列表，点左下「新建任务」开始。')+
          '</p></div>')+
    '</div>'+
    '</div>';
  renderRail();
}

/* 只读化一个列表详情页：除了表格里那枚「特例」胶囊（它只开一个只读弹窗），
   一律停用 —— 包括「筛选名称 / 时间」那个框（用户实测：锁着还能打字，看着像能用）。
   不加这一层的话，得给每个动作处理器单独写判断，漏一个就是一个能改的口子。

   「退出去」那一步不用在这儿放行：返回键已经搬去顶栏了（renderTopbar 的 #tbBack），
   而这一层只遍历 .wb-main 里的控件 —— 顶栏不在射程内，被锁住的详情页照样退得出来。
   （以前那个「‹ 任务列表」住在 .wb-main 里面，所以白名单上得专门放过它。）

   光禁用看不出「这是死的」（和考试模式页同一条教训），所以再挂一个 .is-locked
   由 css 压暗。注意**不能整块压**：被锁时页首那条横幅就在 .wb-main 里面，
   父节点的 opacity 会乘到整棵子树上，它顶不回来（考试模式页正是为这个把横幅
   搬到了 .page-body 外面）。这里改用「指名灰横幅之后的兄弟」，横幅和它上面的
   标题栏都留在正常亮度。 */
function lockDetail(el){
  el.querySelectorAll(".wb-main button, .wb-main input, .wb-main select").forEach(x=>{
    /* 让过「特例」那枚胶囊：它只是把那几个点位列出来看，不改任何东西。
       筛选框**不**让了 —— 锁着的时候它照样能打字，看着就不像只读。 */
    if (x.dataset.ovarea) return;
    x.disabled = true;
  });
  const wm = el.querySelector(".wb-main");
  if (wm) wm.classList.add("is-locked");
}

/* 区域胶囊。`rm` 为真时每颗末尾带一枚 ×（点掉自己）—— 只有**改得动**的地方才给：
   铃声编辑器「特例区域」下那排、定时任务编辑器的执行区域。跟着列表默认走的那几份
   （「默认区域」、列表页顶上那块、只读的弹窗）一律不带：那儿点掉一颗等于顺手改了
   整张列表的区域，而列表的区域只该在列表页上改。 */
function areaChips(a, rm){
  /* 点位前面的点一律是「在线状态」，别再拿它做装饰 */
  const x = rm ? '<button class="x" aria-label="移除">'+ICON.x+'</button>' : "";
  /* data-rm / data-n 挂在**胶囊自己**身上，不挂在末尾那枚 × 上 —— 整颗都是热区，
     点名字、点空白、点 × 一个样（用户要的）。末尾那枚 × 只剩个样子（还按 <button>
     写：它是键盘的落点，在它身上敲回车，click 冒泡到胶囊，照样删得掉）。
     不可删的那种（跟着列表默认走的那几份）还是老样子，一个 data-rm 都没有。 */
  const attr = (k, n, tip)=> rm
    ? ' data-rm="'+k+'" data-n="'+esc(n)+'" title="'+esc(tip)+'"'
    : (tip ? ' title="'+esc(tip)+'"' : "");
  const t = a.t.map(n=>'<span class="chip chip-term"'+
      /* 可删的那种，提示语就说这一下要干什么（用户定的：「点击移除此区域」）。
         原来那句是「点一下从这条里移除 · 点位名 · 状态未知」—— 三种信息挤在一条
         提示里，反倒看不出最要紧的那件；在线状态本来就由前头那颗点表示
         （红绿灰的说明见 statLegend）。 */
      attr("t", n, rm ? "点击移除此区域" : statusTitle(n))+
      '>'+statusDot(n)+esc(n)+x+'</span>').join("");
  /* 分组那颗原来没有 title（名字就是全部信息），可删的那种补一句同样的提示 */
  const g = a.g.map(n=>'<span class="chip chip-group"'+
      attr("g", n, rm ? "点击移除此区域" : "")+
      '><span class="dot"></span>'+esc(n)+x+'</span>').join("");
  if (!t && !g) return '<span class="hint">未设置区域 — 这些铃声到时间不会响</span>';
  return t + g;
}
/* 挂上那些热区：onRemove(kind, name)，kind 是 "t"（点位）或 "g"（分组）。
   选择器是 `[data-rm]` —— 它就是胶囊本身（见上面那个 attr()），
   和音源那对（mountSoundChips）一个做法。 */
function mountAreaChips(box, onRemove){
  $$("[data-rm]", box).forEach(b => b.onclick = ()=> onRemove(b.dataset.rm, b.dataset.n));
}

/* 表格里那枚「特例」胶囊点开：这条铃声实际会响在哪些点位 / 分组。
   只读 —— 改区域还是走「编辑」里那个「编辑区域」，免得同一件事有两个入口、
   两个入口还各有各的取消按钮。 */
function openBellArea(b){
  openModal({ title:"特例区域", sub:b.name+" · "+hm(b.time), width:"560px",
    mount(body, foot, mm){
      body.innerHTML = '<div class="area-chips">'+ areaChips(bellArea(b)) +'</div>';
      foot.innerHTML = '<span class="spacer"></span><button class="btn" data-ba-close>关闭</button>';
      foot.querySelector("[data-ba-close]").onclick = ()=> closeModal(mm.id);
    }});
}

function visibleBells(){
  const q = (S.dt.fq||"").trim().toLowerCase();
  if (!q) return S.bells;
  return S.bells.filter(b=> (b.name+" "+hm(b.time)+" "+(b.mediaNames.join(" "))).toLowerCase().indexOf(q)>=0);
}

/* 播放模式（厂商字段 play_model：0 列表 / 1 循环 / 2 采播）→ 一枚记号 + 它的名字。
   表里只画记号，名字挂在 title 上。
   0 和 1 之外一律当「采播」：编辑器里只给得出这两个选项，采播是厂商前端那边才有
   的第三种，面板认得出来就行 —— 这条也是原来那行「时长 · 播放方式」的口径。 */
function pmodeOf(m){
  m = Number(m);
  if (m === 0) return {word:"列表", icon:ICON.list};
  if (m === 1) return {word:"循环", icon:ICON.loop};
  return {word:"采播", icon:ICON.live};
}

function renderRows(){
  const tb = $("#rows"); if (!tb) return;
  const rows = visibleBells();
  if (!rows.length){ tb.innerHTML = '<tr><td colspan="9"><div class="empty" style="padding:36px">没有匹配的铃声</div></td></tr>'; }
  else tb.innerHTML = rows.map(b=>{
    const ov = isOverride(b), em = isEmptyArea(b);
    /* 「特例」是能点的：这一格只放得下一枚胶囊，写不下是哪几个点位，
       点开用模态把那几个点位列全。挂牌子和看内容分两处，表格才不跟着变宽。
       「默认」不用点 —— 它写的就是「跟着列表走」，内容就是上面的「打铃区域」。 */
    const areaCell = em
      ? '<span class="badge" style="background:var(--crit-soft);color:var(--crit)">无区域</span>'
      : ov
        ? '<button type="button" class="badge badge-override badge-btn" data-ovarea="'+b.id+'"'+
            ' title="这条铃声的执行区域和列表默认不一样 —— 点开看是哪几个区域">特例</button>'
        : '<span class="badge badge-inherit">默认</span>';
    /* 名称下面写执行周期的**名字**，不铺「周一 周二 周三」那一串：一串星期在表里
       占掉半行、每行还都不一样，扫一眼看不出差别；名字是给人认的，认名字比认星期快。
       具体哪几天挪进 title —— 「周二到周五」这种名字本来就写着，鼠标停一下更清楚。 */
    const sName = strategyName(b.strategyId), sWeeks = strategyWeeks(b.strategyId);
    const pm = pmodeOf(b.sound.play_model);
    return '<tr data-id="'+b.id+'" class="'+(S.sel.has(b.id)?"sel ":"")+(b.isDone?"":"off")+'">'+
      '<td class="selcell"><input type="checkbox" class="rowsel" '+(S.sel.has(b.id)?"checked":"")+'></td>'+
      '<td class="t">'+esc(hm(b.time))+
        (b.times.length>1?'<div class="sub">+'+(b.times.length-1)+'</div>':"")+'</td>'+
      /* 这里以前还有一枚「含预备」胶囊，标出这条上课铃带着一条预备铃搭档。
         现在没有了：预备铃只是新建时顺手建出来的另一条普通铃声，面板建完就撒手，
         不再认领 —— 既然没有「附带」这回事，也就没什么可标的。 */
      /* 名字后面原先还缀着一小截「待提交 N」。撤了：这一格的字是给人认名字用的，
         缀上条数之后同一行时短时长（攒一条就冒出来），而且哪几条攒着、攒的是哪一
         类改动，抽屉里一条条列着 —— 那儿才说得清楚。 */
      '<td class="n">'+esc(b.name)+
        /* 名称底下这一行**只在竖屏看得见**（横屏收掉它，同样的话搬到右边
           「时间属性」那一列去说了，见 css 的 min-width:981px 那一段）。 */
        '<div class="sub" title="'+esc("执行周期："+(sWeeks||sName||"—"))+'">'+esc(sName||"—")+'</div></td>'+
      '<td class="stg" title="'+esc("执行周期："+(sWeeks||sName||"—"))+'">'+esc(sName||"—")+'</td>'+
      /* 「音源」这一格只剩音频文件的名字了。原来底下还压着一行「时长 · 播放方式」，
         两行一叠，整张表就按两行的高度排 —— 那是行高压不下去的根子。
         这一格挂 `.med` 只为了 css 里那一条字重（和名称、时间属性、播放时长一档）。 */
      '<td class="med">'+(b.mediaNames.length? esc(b.mediaNames.join("、")) : (b.mediaGroupNames.length? esc(b.mediaGroupNames.join("、")) : '<span class="sub">无音源</span>'))+'</td>'+
      /* 播放时长：整串走等宽（`.mono`，日期那几个数字在这张表里一直是等宽的），
         播放模式缩成图标挂在时长**后头**（见 pmodeOf），模式的名字挪进 title。 */
      '<td class="dur mono">'+esc(b.sound.life_time||"")+
        '<span class="pmode" title="'+pm.word+'">'+pm.icon+'</span></td>'+
      '<td>'+areaCell+'</td>'+
      '<td class="swcell"><button class="sw-mini r-sw'+(b.isDone?" on":"")+'" role="switch" aria-checked="'+!!b.isDone+'"'+
        ' title="'+esc(b.isDone?"停用这一条":"启用这一条")+'"></button></td>'+
      '<td><div class="rowacts">'+
        '<button class="ric r-edit" title="编辑">'+ICON.edit+'</button>'+
        '<button class="ric r-copy" title="复制一条">'+ICON.copy+'</button>'+
        '<button class="ric danger r-del" title="删除">'+ICON.del+'</button>'+
        /* 竖屏上这三个收成这一枚（css 换的，宽屏上看不见它也看不见这一枚）——
           这个按钮在 DOM 里一直都在，两套零件各有一份，谁来显示由断点说了算。 */
        '<button class="ric r-more" title="更多操作">'+ICON.dots+'</button>'+
      '</div></td></tr>';
  }).join("");
  tb.onclick = e => {
    /* 「特例」那枚胶囊是**看区域**，不是选这一行 —— 先拦下来，否则它会冒到下面
       把这一行选中/取消，点一下看内容反而多勾一条。放在 LOCK_NOW 前面：被考试
       模式锁住的列表里，这一格照样能点（它只开一个只读的弹窗，不改任何东西；
       锁定时 lockDetail 也专门让过它）。 */
    const ovBtn = e.target.closest("[data-ovarea]");
    if (ovBtn){
      const b = S.bells.find(x=>Number(x.id)===Number(ovBtn.dataset.ovarea));
      if (b) openBellArea(b);
      return;
    }
    if (LOCK_NOW) return;                 /* 考试模式锁住的列表：点哪儿都不改 */
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    const id = Number(tr.dataset.id);
    const bell = ()=> S.bells.find(b=>b.id===id);
    const setSel = on => {
      if (on) S.sel.add(id); else S.sel.delete(id);
      const cb = tr.querySelector(".rowsel"); if (cb) cb.checked = on;
      tr.classList.toggle("sel", on); renderSelbar();
    };
    if (e.target.closest(".r-sw")){
      const b = bell(); if (!b) return;
      const to = !b.isDone;
      /* 先改本地状态再排队：queueToggle 会同步重画整张表，e.target 那一刻已经
         是个脱离文档的旧节点了，再往它身上 toggle class 是改给鬼看的。 */
      b.isDone = to ? 1 : 0;
      queueToggle(b, to);
      /* 同上：停用不弹，启用那条报喜也早被拦了，两个方向都走 ok。 */
      toast((to?"已启用「":"已停用「")+b.name+"」", "ok");
      return;
    }
    if (e.target.closest(".r-edit")){ openBellEditor(bell()); return; }
    if (e.target.closest(".r-copy")){ copyBell(bell()); return; }
    if (e.target.closest(".r-del")){ removeBell(bell()); return; }
    /* 竖屏上那三个图标收成了这一枚（见 css），点开是同一批动作。
       bell() 是**取的时候**才去 S.bells 里找的，所以菜单开着的时候表格被重画了
       也不怕 —— 和上面那三条同一个写法。 */
    if (e.target.closest(".r-more")){
      const b = bell(); if (!b) return;
      openRowMenu(e.target.closest(".r-more"), [
        { icon:ICON.edit, label:"编辑",     onPick:()=> openBellEditor(bell()) },
        { icon:ICON.copy, label:"复制一条", onPick:()=> copyBell(bell()) },
        { icon:ICON.del,  label:"删除",     onPick:()=> removeBell(bell()), danger:true },
      ]);
      return;
    }
    setSel(e.target.classList.contains("rowsel") ? e.target.checked : !S.sel.has(id));
  };
  const tf = $("#tableFoot");
  if (tf){
    /* 特例条数从右上角那枚胶囊挪到这儿：那枚胶囊和「待提交」「已过期」挤在标题
       底下一行，一眼看过去分不清哪个是状态哪个是计数；而它本来就是形容下面这张
       表的，就该长在表的标题上。数的是**当前显示的这些行**，跟「共 N」同一个
       口径 —— 筛过之后说「共 5 · 特例 3」比说「共 5 · 特例 12」讲得通。
       「共 N 条」那个「条」是用户要的：左边标题写着「铃声」，可这一格在标题右边、
       隔着一段距离，「共 5」孤零零一个数，量词得自己带上；「特例」那半截跟在后面，
       后面还有数，读起来不缺东西，就照旧省着。 */
    const nOv = rows.filter(isOverride).length;
    tf.textContent = "共 "+rows.length+" 条"+
      (nOv ? " · 特例 "+nOv : "")+
      (rows.length!==S.bells.length ? "（已筛选，全部 "+S.bells.length+" 条）" : "");
  }
}

/* 一栏两态：勾了就换成批量动作，取消勾选再换回筛选+添加铃声。
   两态都在面板头这一行里，所以表格永远不动。 */
function renderSelbar(){
  const norm = $("#hdNormal"), bulk = $("#hdBulk");
  if (!norm || !bulk) return;
  const n = LOCK_NOW ? 0 : S.sel.size;      /* 只读页面没有批量操作 */
  norm.hidden = n > 0;
  bulk.hidden = n === 0;
  if (!n){ bulk.innerHTML = ""; return; }
  /* 四枚图标键：铅笔（批量编辑，底下还有四个动作）、对勾（启用）、✕（停用）、
     垃圾桶（删除）。文字改到 title / aria-label 里 —— 七个文字按钮在这条栏上
     窄屏要折两行，折完还看不出哪几个是一组。 */
  bulk.innerHTML =
    '<span class="bulk-n">'+n+'</span><span class="dimmer">条已选</span>'+
    '<button class="btn btn-icon" data-act="edit" title="批量编辑：改区域 / 改音源 / 改时间 / 恢复默认" aria-label="批量编辑">'+ICON.edit+'</button>'+
    '<button class="btn btn-icon" data-act="on" title="启用这些铃声" aria-label="启用">'+ICON.check+'</button>'+
    '<button class="btn btn-icon" data-act="off" title="停用这些铃声" aria-label="停用">'+ICON.x+'</button>'+
    '<button class="btn btn-icon btn-danger" data-act="del" title="删除这些铃声" aria-label="删除">'+ICON.del+'</button>';
}
function onSelbarClick(e){
  const b = e.target.closest("button[data-act]"); if(!b) return;
  const act = b.dataset.act;
  const list = S.bells.filter(x=>S.sel.has(x.id));
  if (act==="edit") return openBulkMenu("批量编辑 "+list.length+" 条铃声", "这些改动会一起写进服务器", [
    {icon:ICON.monitor, label:"改区域",   sub:"统一改成同一组点位和分组",     onPick:()=>openAreaEditor("bulk", list)},
    {icon:ICON.music,   label:"改音源",   sub:"换掉这些铃声正在放的音频文件", onPick:()=>openMediaBulk(list)},
    {icon:ICON.clock,   label:"改时间",   sub:"平移时刻，或整批换成同一个周期", onPick:()=>openTimeBulk(list)},
    /* 分组存在服务器上（写进铃声名字的尾巴里，见 js/35-groups.js），所以这一项
       和别的批量动作一样要发报文、一样能撤销。 */
    {icon:ICON.copy,    label:"改分组",   sub:"把这些铃声一起归到某个分组",   onPick:()=>openGrpBulk(list)},
    /* 「恢复默认」不用再弹框问参数，所以它自己就是终点：点完当场做掉 */
    {icon:ICON.refresh, label:"恢复默认", sub:"区域回到列表默认的那一组",
      onPick:()=>{ list.forEach(x=> applyAreaToBells([x], {t:S.listArea.t.slice(),g:S.listArea.g.slice()}, "恢复默认"));
                   S.sel.clear(); renderRows(); renderSelbar(); }}
  ]);
  if (act==="on" || act==="off"){
    const on = act==="on";
    /* 本地那份状态得**先改再排队**，和行上那个单条开关同一个道理（见 renderRows 里
       那句注释）：queueToggle 发的是 buildPayload 读出来的快照，而「状态」那一列
       是照着 isDone 画的 —— 不先改，这批开关会停在老位置上，看着像没点动。 */
    list.forEach(x=>{ x.isDone = on?1:0; queueToggle(x, on); });
    S.sel.clear(); renderRows(); renderSelbar(); toast(wroteWord(),"ok"); return;
  }
  if (act==="del"){ openConfirm("删除 "+list.length+" 条铃声", "删除后该铃声不再执行。此操作会写入服务器，无法在面板内撤销。", ()=>{ list.forEach(queueDelete); S.sel.clear(); renderRows(); renderSelbar(); toast(wroteWord(),"ok"); }); }
}

/* ══ apply area to bells ════════════════════════════════════════════ */
function applyAreaToBells(bells, area, why){
  let n = 0;
  bells.forEach(b=>{
    if (b.termNames.slice().sort().join("|")===area.t.slice().sort().join("|") &&
        b.groupNames.slice().sort().join("|")===area.g.slice().sort().join("|")) return;
    b.termNames = area.t.slice(); b.groupNames = area.g.slice();
    if (b.isNew) return;
    queueUpdate(b, why); n++;
  });
  renderMain();
  if (n) toast(n+" 条铃声"+tailFor(), "ok");
  else toast("没有需要改动的铃声");
}

/* ══ bell editor ════════════════════════════════════════════════════
   新建时三个页签：单条（一条一条填）、按节次生成（一整天的作息一次排完）、
   从模板添加（把一整份打铃计划粘进来）。
   三个页签共用下面那块「执行区域」。 */
function openBellEditor(bell){
  const isNew = !bell;
  const b = bell ? JSON.parse(JSON.stringify(bell)) : {
    id:null, tmpId:"t"+Math.random().toString(36).slice(2,8), isNew:true,
    name:"", times:["08:00:00"], time:"08:00:00",
    strategyId: ensureStrategy(), isDone:1, type:1, priority:50, volume:70, mode:1,
    lightId:1, ledText:"", ledCfgId:1,
    sound:{life_time:"00:00:00", play_model:0},
    mediaNames:[], mediaGroupNames:[], termNames:S.listArea.t.slice(), groupNames:S.listArea.g.slice(),
    inheritArea:true
  };
  if (bell) b.inheritArea = !isOverride(bell);
  /* 编辑已有铃声时**没有预备铃这一块**：它是创建那一下的选项，不是这条铃声的属性。
     所以下面 b.withPrep / b.prepMin 只在 isNew 时被读（新建那条路走默认值）。 */
  b.withPrep = isNew;
  b.prepMin  = prepMinOf(b);

  let tab = "one";
  /* up / down 是生成的「上课」「下课」两条各放哪个音源文件（默认就是那两个名字）。
     预备铃不放这儿：它的名字写死在 PREP_MEDIA 上，除了这个页签它别处不出现。 */
  const gen = { start:"08:00", dur:40, gap:10, n:4, strat:Number(b.strategyId),
                vol:Number(b.volume)||70, prep:true, prepMin:prepMinOf(b), rows:[],
                up:"上课铃.mp3", down:"下课铃.mp3" };
  /* 模板页签的那份状态。rows / errs 是**解析结果**，不是输入 —— 输入本身text 才是
     唯一权威，每次重画都从它重新解析一遍（见 parseBellTemplate）。 */
  const tpl = { text:"", rows:[], errs:[] };

  const m = openModal({
    title: isNew ? "添加铃声" : "编辑铃声",
    sub: esc(groupName(S.groupId)),
    width:"820px",
    mount(body, foot, mm){
      const q  = s => body.querySelector(s);
      const fq = s => foot.querySelector(s);

      /* ── 执行区域：两个页签共用同一份 b.termNames / b.groupNames ── */
      const pickArea = ()=>{
        S.dt.area = {t:b.termNames.slice(), g:b.groupNames.slice()};
        openAreaEditor("pick", null, area=>{
          b.termNames = area.t.slice(); b.groupNames = area.g.slice(); drawAreaBox();
        });
      };
      const areaHTML = ()=>
        '<div class="sect"><div class="sect-h">执行区域<span class="acts" id="bAreaActs"></span></div>'+
        '<div class="sect-b">'+
          '<div class="tabbar" style="margin-bottom:10px">'+
            '<button data-areamode="inherit" class="'+(b.inheritArea?"on":"")+'">默认区域</button>'+
            '<button data-areamode="custom" class="'+(b.inheritArea?"":"on")+'">特例区域</button>'+
          '</div><div id="bAreaBox"></div>'+
        '</div></div>';
      /* 只有「特例区域」才有东西可编辑。但这颗键**一直画着**，默认区域下只是藏起来
         （.is-ghost，见 css）：撤掉不画的话，.sect-h 这一行会矮掉一颗键的高度
         （.btn-sm 约 28.6px 撑起的一行 vs 12px 字撑出的 18.6px 行盒），
         「默认 / 特例」来回切的时候整块面板跟着抖 10px —— 就是用户实测那个抖动。 */
      const drawAreaActs = ()=>{
        const box = q("#bAreaActs"); if (!box) return;
        box.innerHTML = '<button class="btn btn-sm'+(b.inheritArea?" is-ghost":"")+'" id="bPickArea">编辑区域</button>';
        q("#bPickArea").onclick = pickArea;
      };
      const drawAreaBox = ()=>{
        const box = q("#bAreaBox"); if (!box) return;
        /* 盒子自己就是那一格 chips（不再往里面套一层）：标红（markErr）挂在它身上，
           重画一次红自己就掉了 —— 挑完区域回来，红不该还留着。
           「特例区域」下每颗胶囊自带一枚 ×：删一个点位／分组不用再开一遍选择器
           （它本来就得先点「编辑区域」、再在几十行里找到那一项、再取消勾选）。
           跟着列表走的那份是只读的，rm 传 false。 */
        const editable = !b.inheritArea;
        box.className = "area-chips";
        box.innerHTML = areaChips(editable ? {t:b.termNames,g:b.groupNames} : S.listArea, editable);
        if (!editable) return;
        mountAreaChips(box, (k,n)=>{
          if (k==="t") b.termNames  = b.termNames.filter(x=>x!==n);
          else         b.groupNames = b.groupNames.filter(x=>x!==n);
          drawAreaBox();
        });
      };

      /* 「按节次生成」那两格音源（上课 / 下课）：长得像下拉，点开是那个单选的文件
         选择器（filesOnly —— 一节铃声就放一个音源，多选了也没处放）。
         挑空了（把唯一勾着的那一格又取消掉）就当没改：这一栏不给空着，
         空了生成出来的铃声到点没东西可放。 */
      const genPickHTML = (id, key, label)=>
        '<div class="field"><label>'+label+'</label>'+
          '<button class="select-btn" type="button" id="'+id+'">'+
            '<span class="v">'+esc(gen[key])+'</span><span class="chev">'+ICON.chevD+'</span>'+
          '</button></div>';
      const drawGenMedia = ()=>{
        const set = (id,key)=>{ const el = q("#"+id); const v = el && el.querySelector(".v");
                                if (v) v.textContent = gen[key]; };
        set("gUp","up"); set("gDown","down");
      };
      const pickGenMedia = (title, key)=>{
        const cur = gen[key];
        openMediaPicker(cur?[cur]:[], [], r=>{
          const m = (r && r.media[0]) || "";
          if (m) gen[key] = m;
          drawGenMedia();
        }, {filesOnly:true, title:title, sub:"从服务器的媒体库里挑一个音源文件"});
      };

      /* ── 单条 ──
         上面五格是**一个** grid（.bell-top），不是原来那两行 —— 横屏和竖屏的
         分组方式不一样，一个 grid 才排得出两种：宽屏「时间 + 名称(占2格)」/「周期 +
         音量 + 优先级」两行；≤980px 靠 [data-bf] 上的 order 和 span 重排成
         「时间 + 周期」/「名称 + 音量 + 优先级」两行。DOM 顺序按宽屏写。 */
      const oneHTML = ()=>
        '<div class="grid3 bell-top">'+
          '<div class="field" data-bf="time"><label>执行时间</label>'+quickTimeHTML('id="bTime"', b.time)+'</div>'+
          '<div class="field bf-name" data-bf="name"><label>名称</label><input class="input" id="bName" value="'+esc(b.name)+'" placeholder="铃声1"></div>'+
          '<div class="field" data-bf="strat"><label>执行周期</label><select class="select" id="bStrat">'+
            S.data.strategies.map(s=>'<option value="'+s.id+'"'+(Number(b.strategyId)===Number(s.id)?" selected":"")+'>'+esc(s.name)+'</option>').join("")+
          '</select></div>'+
          '<div class="field" data-bf="vol"><label>音量</label><input class="input mono" id="bVol" type="number" min="0" max="100" value="'+Number(b.volume)+'"></div>'+
          '<div class="field" data-bf="pri"><label>优先级</label><input class="input mono" id="bPri" type="number" value="'+Number(b.priority)+'"></div>'+
        '</div>'+
        /* 音源区：一行**已选清单**（多个音源 / 多个文件夹 / 混着选，各自都能点掉），
           右上「选择音源」开多选器。这里不再摆一排「常用」快捷按钮 —— 挑音源
           统一走选择器，不用记两套说法。
           定时任务那边是同一个控件（soundChipsHTML / mountSoundChips，在 20-ui.js）。 */
        '<div class="sect"><div class="sect-h">音源 <span class="sub" id="bLen"></span>'+
          '<span class="acts"><button class="btn btn-sm" id="bSoundPick">选择音源</button></span></div>'+
          '<div class="sect-b"><div class="stack">'+
            /* 一层素排布，不带边框底色 —— 它得跟下面「播放模式/播放时长」并排，
               所以留着自己这一格；箱子那圈虚线去掉了，胶囊直接排在这一行上。 */
            '<div class="area-chips" id="bSoundChips"></div>'+
            /* 分隔线：上面是「放什么」，下面是「怎么放」（见 css 的 .divider）。 */
            '<div class="divider"></div>'+
            '<div class="bell-play">'+
              '<div class="field"><label>播放模式</label><select class="select" id="bMode">'+
                '<option value="0"'+(Number(b.sound.play_model)===0?" selected":"")+'>列表播放</option>'+
                '<option value="1"'+(Number(b.sound.play_model)===1?" selected":"")+'>循环播放</option>'+
              '</select></div>'+
              '<div class="field"><label>播放时长</label><input class="input mono" id="bLife" value="'+esc(b.sound.life_time||"00:00:00")+'"></div>'+
            '</div>'+
          '</div></div>'+
        '</div>'+
        /* 预备铃只在**新建**时出现 —— 它是创建那一下的选项，不是这条铃声的属性，
           所以编辑已有铃声时这一块整个不画（连 id 都不存在，绑定那边也不用判空）。 */
        (isNew ? '<div class="sect" id="bPrepSect" style="display:none"><div class="sect-h">预备铃</div><div class="sect-b">'+
          '<div style="display:flex;gap:16px;align-items:flex-end">'+
            '<label class="switch" id="bPrepLbl"><input type="checkbox" id="bPrep"'+(b.withPrep?" checked":"")+'>'+
              '<span class="track"></span><span>创建预备铃</span></label>'+
            '<div class="field" style="margin:0;width:150px"><label>预备铃提前(分)</label>'+
              '<input class="input mono" id="bPrepMin" type="number" min="1" max="60" step="1" value="'+Number(prepMinOf(b))+'"></div>'+
          '</div>'+
          '<div class="hint" style="margin-top:8px">只在新建时把这条预备铃一起建出来；建好之后它就是列表里一条普通铃声，两边互不影响。</div>'+
        '</div></div>' : "")+
        areaHTML();

      /* ── 按节次生成 ── */
      const genHTML = ()=>
        '<div class="grid4">'+
          '<div class="field"><label>上课时间</label>'+quickTimeHTML('id="gStart"', gen.start)+'</div>'+
          '<div class="field"><label>每节时长（分）</label><input class="input mono" id="gDur" type="number" min="1" value="'+gen.dur+'"></div>'+
          '<div class="field"><label>课间时长（分）</label><input class="input mono" id="gGap" type="number" min="0" value="'+gen.gap+'"></div>'+
          '<div class="field"><label>节数</label><input class="input mono" id="gN" type="number" min="1" max="20" value="'+gen.n+'"></div>'+
        '</div>'+
        '<div class="grid4">'+
          '<div class="field"><label>执行周期</label><select class="select" id="gStrat">'+
            S.data.strategies.map(s=>'<option value="'+s.id+'"'+(Number(gen.strat)===Number(s.id)?" selected":"")+'>'+esc(s.name)+'</option>').join("")+
          '</select></div>'+
          '<div class="field"><label>音量</label><input class="input mono" id="gVol" type="number" min="0" max="100" value="'+gen.vol+'"></div>'+
          '<div class="field"><label>创建预备铃</label>'+
            '<label class="switch" style="align-self:flex-end"><input type="checkbox" id="gPrep"'+(gen.prep?" checked":"")+'>'+
              '<span class="track"></span></label></div>'+
          '<div class="field"><label>预备铃提前(分)</label><input class="input mono" id="gPrepMin" type="number" min="1" max="60" value="'+gen.prepMin+'"></div>'+
        '</div>'+
        /* 音源：一整天的课表就是这么三条一轮一轮排出来的（预备 / 上课 / 下课），
           所以这儿只挑「上课」和「下课」两条各放什么 —— 两格，一格一个文件。
           从前这两条是写死的两个文件名，服务器上那条叫别的名字就一点辙没有。 */
        '<div class="sect"><div class="sect-h">音源</div>'+
          '<div class="sect-b"><div class="grid2">'+
            genPickHTML("gUp","up","上课铃")+genPickHTML("gDown","down","下课铃")+
          '</div></div></div>'+
        areaHTML()+
        '<div class="sect"><div class="sect-h">预览 <span class="mono" id="gCount"></span></div>'+
          '<div class="sect-b" id="gPrev" style="max-height:300px;overflow:auto"></div>'+
        '</div>';

      /* ── 从模板添加 ──
         四块：提示词（拿去喂 AI）、模板（AI 的产物粘进来）、执行区域（模板里没有
         区域这一列，得在这儿挑）、预览（解析结果，可以逐条取消再生成）。
         预览那一块是用户后来加的 —— 原本只打算在模板框底下挂一行校验，但这份模板
         动辄几十行，只看一个「12 行」的数字等于闭着眼睛建。 */
      /* 「AI辅助提示」这一块只剩一颗按钮，没有框。原来那个框是 readonly 的，
         可十行提示词正文摊在那儿，把真正要填的「模板」挤到了折叠线下面 ——
         而它的用法本来就是「复制走、发给 AI」，没人会在这儿读它。
         正文现在活在 bindTpl 的 prompt 变量里，按钮直接复制它。 */
      const tplHTML = ()=>
        '<div class="sect"><div class="sect-h">AI辅助提示'+
          '<span class="acts"><button class="btn btn-sm" id="tCopy">复制提示词</button></span></div>'+
          '<div class="sect-b"><div class="stack">'+
            '<div class="hint">点「复制提示词」，把复制到的这段连同你的打铃计划一起发给任意一个 AI'+
              '（豆包、DeepSeek、ChatGPT 都行），它会按我们的格式给你一份模板，再把那份模板粘到'+
              '下面「模板」那一栏。提示词里的周期名和音源名是从这台服务器上读出来的，AI 照着抄就写不歪。</div>'+
          '</div></div></div>'+
        '<div class="sect"><div class="sect-h">模板</div>'+
          '<div class="sect-b"><div class="stack">'+
            '<textarea class="input mono" id="tText" rows="8" spellcheck="false"'+
              ' placeholder="08:00:00,第一节课上课,周一到周五,上课铃.mp3"></textarea>'+
          '</div></div></div>'+
        areaHTML()+
        '<div class="sect"><div class="sect-h">预览 <span class="mono" id="tCount"></span></div>'+
          '<div class="sect-b" id="tPrev" style="max-height:300px;overflow:auto"></div>'+
        '</div>';

      function draw(){
        body.innerHTML = '<div class="stack">'+
          (isNew?'<div class="tabbar" id="bTabs">'+
            '<button data-t="one"'+(tab==="one"?' class="on"':'')+'>单条</button>'+
            '<button data-t="gen"'+(tab==="gen"?' class="on"':'')+'>按节次生成</button>'+
            '<button data-t="tpl"'+(tab==="tpl"?' class="on"':'')+'>从模板添加</button></div>':"")+
          (tab==="one" ? oneHTML() : tab==="gen" ? genHTML() : tplHTML())+
        '</div>';
        /* 页脚按页签给。模板页签**只有一个**按钮：那一栏里没有「这一条铃声」可存，
           摆一个「确认添加」在旁边只会让人以为要按两下。 */
        foot.innerHTML = '<span class="spacer"></span><button class="btn" id="bCancel">取消</button>'+
          (isNew ? (tab==="gen" ? '<button class="btn" id="gGo">生成任务</button><button class="btn btn-primary" id="bOk">确认添加</button>'
                  : tab==="tpl" ? '<button class="btn btn-primary" id="tOk">生成铃声</button>'
                  :               '<button class="btn btn-primary" id="bOk">确认添加</button>')
                 : '<button class="btn btn-danger" id="bDel">删除</button><button class="btn btn-primary" id="bOk">保存</button>');
        bind();
      }

      /* ══ 单条 ══ */
      function bindOne(){
        const lenEl = ()=>{
          q("#bLen").textContent = (b.mediaNames.length || b.mediaGroupNames.length)
            ? ("合计 "+lifeTimeOf(b.mediaNames)) : "未选择音源";
        };
        function syncLife(force){
          const inp = q("#bLife");
          if (b.mediaGroupNames.length) return;   /* 文件夹里有多少、放多久，本地算不出来 */
          if (force || !inp.dataset.touched) inp.value = lifeTimeOf(b.mediaNames);
        }
        /* 已选清单。渲染和绑定都在 20-ui.js（`soundChipsHTML` / `mountSoundChips`），
           定时任务编辑框用的是同一对函数 —— 两处长得一模一样是代码保证的，不是巧合。 */
        function drawChips(){
          const box = q("#bSoundChips"); if (!box) return;
          box.innerHTML = soundChipsHTML(b.mediaNames, b.mediaGroupNames);
          mountSoundChips(box, (kind, n)=>{
            if (kind==="m") b.mediaNames = b.mediaNames.filter(x=>x!==n);
            else            b.mediaGroupNames = b.mediaGroupNames.filter(x=>x!==n);
            drawSound(); syncLife(true);
          });
        }
        /* 音源区整个重画：清单 + 合计时长 + 预备铃那一块的显隐。
           改完音源一律走这里，别再各处零散地补 lenEl()。 */
        function drawSound(){
          drawChips(); lenEl(); drawPrepSect();
        }
        /* 多选器：音源文件、媒体文件夹、混着选都行 —— 它本来就是这个能力，
           以前被一个「自定义…」的下拉选项藏着，只有点进去才看得见。 */
        function openSoundPicker(){
          openMediaPicker(b.mediaNames, b.mediaGroupNames, r=>{
            b.mediaNames = r.media.slice(); b.mediaGroupNames = r.groups.slice();
            drawSound(); syncLife(true);
          });
        }
        /* 「创建预备铃」只对上课铃有意义 —— 别的铃声下这块不出现。
           编辑已有铃声时整块都不存在（见 oneHTML），q("#bPrepSect") 取不到就退出。 */
        function drawPrepSect(){
          const sect = q("#bPrepSect"); if (!sect) return;
          const isClass = isClassBell(b);
          sect.style.display = isClass ? "" : "none";
          if (!isClass) return;
          if (!b.withPrep && !b._prepTouched){ b.withPrep = true; q("#bPrep").checked = true; }
        }

        if (q("#bPrep")){
          q("#bPrep").onchange = e=>{ b.withPrep = e.target.checked; b._prepTouched = true; drawPrepSect(); };
          q("#bPrepMin").oninput = e=>{
            const n = Number(e.target.value);
            if (isFinite(n) && n >= 1) b.prepMin = Math.min(60, Math.floor(n));
            if (!b.withPrep && !b._prepTouched){ b.withPrep = true; q("#bPrep").checked = true; }
          };
          /* 输入框留空 / 填了 0 时，离开焦点再归整成有效值（打字过程中不回写） */
          q("#bPrepMin").onblur = ()=>{ b.prepMin = prepMinOf(b); q("#bPrepMin").value = b.prepMin; };
          q("#bPrep").checked = !!b.withPrep;
        }
        q("#bTime").oninput = ()=>{ const t=hhmmToHMS(q("#bTime").value); if(t) b.time=t; };
        /* 敲 930 也算数：离开焦点时把框里改写成 09:30:00，再补派一次 input
           让上面那个读取器跑一遍。打字过程中它读不出东西就什么都不做。 */
        wireQuickTime(q("#bTime"));
        q("#bLife").oninput  = e=>{ e.target.dataset.touched="1"; };
        q("#bLife").onblur   = e=>{ if(!e.target.value){ delete e.target.dataset.touched; syncLife(true); } };
        q("#bSoundPick").onclick = openSoundPicker;
        drawSound(); syncLife(true);
      }

      function saveOne(){
        const t = hhmmToHMS(q("#bTime").value);
        /* 缺格除了喊一声，还把那一格套红（markErr，见 20-ui）：toast 三秒就没了，
           回来还得自己找是哪一格。下同。 */
        if (!t){ markErr(body,'[data-bf="time"]'); toast("请填写执行时间","err"); return; }
        const nm = q("#bName").value.trim();
        if (!nm){ markErr(body,'[data-bf="name"]'); toast("请填写名称","err"); return; }
        const dup = S.bells.find(x=> x.name===nm && x.id!==b.id && !x.isNew);
        if (dup){ markErr(body,'[data-bf="name"]'); toast("同一列表内名称不能重复：「"+nm+"」已存在","err"); return; }
        b.time = t; b.times = [t]; b.name = nm;
        b.strategyId = Number(q("#bStrat").value);
        b.volume = Number(q("#bVol").value)||70;
        b.priority = Number(q("#bPri").value)||50;
        b.sound = {life_time: q("#bLife").value || "00:00:00", play_model: Number(q("#bMode").value)};
        /* 预备铃那一块只在新建时有（编辑时 q("#bPrep") 取不到），所以这里读到 null
           就等于「不建预备铃」—— 编辑已有铃声时无论如何都不会碰它那条搭档。 */
        const prepChk = q("#bPrep"), prepMinEl = q("#bPrepMin");
        b.prepMin = prepMinOf({prepMin: prepMinEl && prepMinEl.value});
        b.withPrep = !!(prepChk && prepChk.checked) && isClassBell(b);
        if (b.inheritArea){ b.termNames = S.listArea.t.slice(); b.groupNames = S.listArea.g.slice(); }
        closeModal(mm.id);
        if (isNew){
          S.bells.push(b);
          S.bells.sort((x,y)=> hmsToSec(x.time)-hmsToSec(y.time));
          queueCreate(b);
        } else {
          const i = S.bells.findIndex(x=>x.id===b.id);
          if (i>=0) S.bells[i] = b;
          queueSave(b, "编辑");       /* 复制出来的那条还没有 id，得走 POST */
        }
        /* 预备铃只在**新建**这条路里生成，而且只生成、不改也不删：
           编辑已有铃声时 b.withPrep 恒为 false（那一块根本没画），走 else 分支。 */
        if (b.withPrep){
          createPrepFor(b);
          toast(S.draft ? "已加入待提交（含预备铃）" : "已写入服务器（含预备铃）","ok");
        } else {
          toast(wroteWord(),"ok");
        }
        renderAll();
      }

      /* ══ 按节次生成 ══ */
      function drawPreview(){
        const rows = gen.rows, box = q("#gPrev");
        const nOn = rows.filter(r=>r.on).length;
        if (!rows.length){
          box.innerHTML = '<div class="hint" style="padding:14px">填好上面两行，点「生成任务」。</div>';
        } else {
          box.innerHTML = '<table class="prev-tbl"><thead><tr><th style="width:26px">'+
            '<input type="checkbox" id="gAll"></th>'+
            '<th>时间</th><th>名称</th><th>音源</th></tr></thead><tbody>'+
            rows.map((r,i)=> '<tr class="'+(r.on?"on":"")+'"><td><input type="checkbox" data-qi="'+i+'"'+(r.on?" checked":"")+'></td>'+
              '<td>'+esc(hm(r.time))+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.label)+'</td></tr>').join("")+
            '</tbody></table>';
          const all = q("#gAll");
          all.onchange = ()=>{ gen.rows.forEach(r=> r.on = all.checked); drawPreview(); };
        }
        syncPrevHead();
      }
      /* 表头那个框就是全选：全勾 = checked，勾一半 = 半选 */
      function syncPrevHead(){
        const n = gen.rows.length, nOn = gen.rows.filter(r=>r.on).length;
        const c = q("#gCount"); if (c) c.textContent = nOn+" 条";
        const all = q("#gAll"); if (!all) return;
        all.checked = nOn>0 && nOn===n;
        all.indeterminate = nOn>0 && nOn<n;
      }
      function buildRows(){
        const st = hhmmToHMS(q("#gStart").value);
        if (!st){ markErr(body, q("#gStart").closest(".tfield")); toast("请填写上课时间","err"); return null; }
        const dur = Math.max(1,Number(q("#gDur").value)||40);
        const gap = Math.max(0,Number(q("#gGap").value)||0);
        const n   = Math.max(1,Math.min(20,Number(q("#gN").value)||1));
        const pm  = Math.max(1,Math.min(60,Number(q("#gPrepMin").value)||PREP_MIN_DEFAULT));
        gen.start = hms(st); gen.dur = dur; gen.gap = gap; gen.n = n; gen.prepMin = pm;
        gen.prep = q("#gPrep").checked;
        const out = [];
        let t = hmsToSec(st);
        for (let i=1;i<=n;i++){
          if (gen.prep) out.push(genRow(t-pm*60, "第"+i+"节-预备", PREP_MEDIA));
          out.push(genRow(t, "第"+i+"节-上课", gen.up));
          out.push(genRow(t+dur*60, "第"+i+"节-下课", gen.down));
          t += (dur+gap)*60;
        }
        return out;
      }
      function saveGen(){
        if (!gen.rows.length){ toast("请先点击「生成任务」生成播放安排","err"); return; }
        const rows = gen.rows.filter(r=>r.on);
        if (!rows.length){ toast("预览列表中未勾选任何条目","err"); return; }
        if (!b.inheritArea && !b.termNames.length && !b.groupNames.length){ markErr(body,"#bAreaBox"); toast("请选择执行区域","err"); return; }
        const dup = rows.filter(r=> S.bells.some(x=>x.name===r.name));
        if (dup.length){ toast("名称重复："+dup.slice(0,3).map(d=>d.name).join("、")+(dup.length>3?" 等":""),"err"); return; }
        const strat = Number(q("#gStrat").value), vol = Number(q("#gVol").value)||70;
        const area = b.inheritArea ? {t:S.listArea.t, g:S.listArea.g} : {t:b.termNames, g:b.groupNames};
        closeModal(mm.id);
        rows.forEach(r=>{
          const nb = {
            id:null, tmpId:"t"+Math.random().toString(36).slice(2,8), isNew:true,
            name:r.name, times:[r.time], time:r.time, strategyId:strat, isDone:1, type:1,
            priority:50, volume:vol, mode:1, lightId:1, ledText:"", ledCfgId:1,
            sound:{life_time:r.life, play_model:r.model},
            mediaNames:r.mediaNames.slice(), mediaGroupNames:[],
            termNames:area.t.slice(), groupNames:area.g.slice()
          };
          S.bells.push(nb); queueCreate(nb);
        });
        S.bells.sort((x,y)=> hmsToSec(x.time)-hmsToSec(y.time));
        renderAll();
        toast("已生成 "+rows.length+" 条铃声"+tailFor(),"ok");
      }
      function bindGen(){
        /* 「生成任务」在页脚，得从 foot 里找 */
        fq("#gGo").onclick = ()=>{ const rows = buildRows(); if (rows){ gen.rows = rows; drawPreview(); } };
        q("#gPrev").onchange = e=>{
          const cb = e.target.closest("[data-qi]"); if (!cb) return;
          gen.rows[Number(cb.dataset.qi)].on = cb.checked;
          cb.closest("tr").classList.toggle("on", cb.checked);
          syncPrevHead();
        };
        q("#gUp").onclick   = ()=> pickGenMedia("选择上课铃音源", "up");
        q("#gDown").onclick = ()=> pickGenMedia("选择下课铃音源", "down");
        drawPreview();
        wireQuickTime(q("#gStart"));
      }

      /* ══ 从模板添加 ══ */
      function drawTplPreview(){
        const box = q("#tPrev"); if (!box) return;
        const bad = tpl.errs.length;
        const cnt = q("#tCount");
        if (cnt) cnt.textContent = bad ? "有 "+bad+" 处问题" : (tpl.rows.length ? tpl.rows.length+" 条" : "");
        /* 有错就**一条都不给建**：按钮置灰，比按下去再弹一句「模板有错」更早地
           把话说清楚。行数也没有的时候同样置灰（空模板没什么可生成的）。 */
        const ok = fq("#tOk"); if (ok) ok.disabled = bad>0 || !tpl.rows.length;

        let html = "";
        if (bad){
          /* 报错**逐行列**，不折成一句「模板有 3 处问题」—— 用户拿着行号回去让 AI
             改，或者自己动手改，都得分得清是哪一行。 */
          html += '<div class="hint" style="color:var(--crit);padding:10px 4px">'+
            tpl.errs.map(e=>esc(e)).join("<br>")+'</div>';
        }
        if (tpl.rows.length){
          html += '<table class="prev-tbl"><thead><tr><th style="width:26px">'+
            '<input type="checkbox" id="tAll"></th>'+
            '<th>时间</th><th>名称</th><th>周期</th><th>音源</th></tr></thead><tbody>'+
            tpl.rows.map((r,i)=> '<tr class="'+(r.on?"on":"")+'">'+
              '<td><input type="checkbox" data-ti="'+i+'"'+(r.on?" checked":"")+'></td>'+
              '<td>'+esc(hm(r.time))+'</td><td>'+esc(r.name)+'</td>'+
              '<td>'+esc(r.stratName)+'</td><td>'+esc(r.label)+'</td></tr>').join("")+
            '</tbody></table>';
        } else if (!bad){
          html = '<div class="hint" style="padding:14px">把模板粘到上面，这里就会列出解析结果。</div>';
        }
        box.innerHTML = html;

        if (!tpl.rows.length) return;
        /* 表头那个框就是全选：全勾 = checked，勾一半 = 半选。和「按节次生成」
           那张预览表是同一套写法。 */
        const all = q("#tAll");
        const sync = ()=>{
          const nOn = tpl.rows.filter(r=>r.on).length;
          all.checked = nOn>0 && nOn===tpl.rows.length;
          all.indeterminate = nOn>0 && nOn<tpl.rows.length;
        };
        all.onchange = ()=>{ tpl.rows.forEach(r=> r.on = all.checked); drawTplPreview(); };
        $$("[data-ti]", box).forEach(cb => cb.onchange = ()=>{
          tpl.rows[Number(cb.dataset.ti)].on = cb.checked;
          cb.closest("tr").classList.toggle("on", cb.checked);
          sync();
        });
        sync();
      }
      function bindTpl(){
        const tt = q("#tText");
        /* 提示词正文不再摆在页面上了（那个框删了），就留在这个闭包里给复制按钮用。
           每次进这个页签都重算一遍：周期名和音源名是从服务器读出来的，外面刷过就得跟上。 */
        const prompt = bellTemplatePrompt();
        tt.value = tpl.text;
        q("#tCopy").onclick = ()=> copyText(prompt, "提示词已复制");
        /* 输入即解析，不设「解析」按钮：满打满算几百行的字符串比较，代价可以忽略，
           而少按一下按钮就少一次「我明明粘了啊」的困惑。*/
        tt.oninput = ()=>{ tpl.text = tt.value; const r = parseBellTemplate(tpl.text);
                           tpl.rows = r.rows; tpl.errs = r.errs; drawTplPreview(); };
        const r = parseBellTemplate(tpl.text);
        tpl.rows = r.rows; tpl.errs = r.errs;
        drawTplPreview();
        /* 切页签不丢已粘的内容（tpl.text 活在这个闭包里，draw() 重画时又填回去），
           但**区域选择跟着 b 走**，和另外两个页签共用同一份，切来切去不会各选各的。 */
      }
      function saveTpl(){
        if (tpl.errs.length){ toast("模板有 "+tpl.errs.length+" 处问题，先照预览里的提示改","err"); return; }
        const rows = tpl.rows.filter(r=>r.on);
        if (!rows.length){ toast("预览列表里没有勾选任何条目","err"); return; }
        if (!b.inheritArea && !b.termNames.length && !b.groupNames.length){ markErr(body,"#bAreaBox"); toast("请选择执行区域","err"); return; }
        /* 模板**永远是追加**（用户定的），所以和列表里现有的铃声撞名这条一定会遇上。
           同一列表内重名是服务器那边也不接受的（saveOne 里同一条规矩），在这儿先拦。 */
        const dup = rows.filter(r=> S.bells.some(x=> x.name===r.name));
        if (dup.length){ toast("名称重复："+dup.slice(0,3).map(d=>d.name).join("、")+(dup.length>3?" 等":""),"err"); return; }

        const area = b.inheritArea ? {t:S.listArea.t, g:S.listArea.g} : {t:b.termNames, g:b.groupNames};
        closeModal(mm.id);
        rows.forEach(r=>{
          /* 音量 / 优先级 / 播放模式模板里没有，走这一份默认值（和「单条」新建时一致）。
             预备铃**一条都不建**（用户定的）：模板是「完全遵照输入」，
             自己多出来的东西就是没遵照。 */
          const nb = {
            id:null, tmpId:"t"+Math.random().toString(36).slice(2,8), isNew:true,
            name:r.name, times:[r.time], time:r.time, strategyId:Number(r.stratId), isDone:1, type:1,
            priority:50, volume:70, mode:1, lightId:1, ledText:"", ledCfgId:1,
            sound:{life_time:r.life, play_model:0},
            mediaNames:r.mediaNames.slice(), mediaGroupNames:[],
            termNames:area.t.slice(), groupNames:area.g.slice()
          };
          S.bells.push(nb); queueCreate(nb);
        });
        S.bells.sort((x,y)=> hmsToSec(x.time)-hmsToSec(y.time));
        renderAll();
        toast("已从模板加入 "+rows.length+" 条铃声"+tailFor(),"ok");
      }

      function bind(){
        if (isNew) $$("#bTabs button", body).forEach(btn => btn.onclick = ()=>{ tab = btn.dataset.t; draw(); });
        $$("[data-areamode]", body).forEach(btn => btn.onclick = ()=>{
          b.inheritArea = btn.dataset.areamode==="inherit";
          if (b.inheritArea){ b.termNames = S.listArea.t.slice(); b.groupNames = S.listArea.g.slice(); }
          $$("[data-areamode]", body).forEach(x=>x.classList.toggle("on", x===btn));
          drawAreaActs(); drawAreaBox();
        });
        (tab==="gen" && isNew) ? bindGen() : (tab==="tpl" && isNew) ? bindTpl() : bindOne();
        drawAreaActs(); drawAreaBox();

        fq("#bCancel").onclick = ()=> closeModal(mm.id);
        if (!isNew) fq("#bDel").onclick = ()=>{
          closeModal(mm.id);
          openConfirm("删除「"+bell.name+"」", "该铃声将从列表中移除，不可撤销。",
            ()=>{ queueDelete(bell); toast(wroteWord(),"ok"); }, "删除", true);
        };
        /* 模板页签的页脚是另一颗按钮，没有 #bOk —— 取不到就跳过，别去 .onclick 一个 null。 */
        const okBtn = fq("#bOk");
        if (okBtn) okBtn.onclick = ()=> (tab==="gen" && isNew) ? saveGen() : saveOne();
        const tplBtn = fq("#tOk");
        if (tplBtn) tplBtn.onclick = saveTpl;
      }

      draw();
    }
  });
}

/* ══ 从模板添加：解析 ════════════════════════════════════════════════
   模板是拿去给 AI 生成的纯文本，一行一条铃声、四列：

       时间,名称,周期,音源

   时间走 parseQuickTime（08:00:00 / 080000 / 8:00 都收，规范成 HH:MM:SS）；
   名称是这条铃的名字；周期必须是系统里现成的周期方案名；音源是媒体库里的文件名。

   **认不出来就整份拒绝**（用户定的）。模板是 AI 出的，错一行就该把行号报回去让它
   重出，而不是留下另一半 —— 打铃计划少一条，到点就是不响，比整份没进去难发现得多。
   所以这里把每处毛病都收进 errs 继续往下走，而不是抛第一个就返回。

   一行一列是**写死**的四列，不做引号 / 转义那一套：名称里带英文逗号会解析成 5 列，
   然后被当成错行报出来。这是故意的 —— 与其猜他想表达什么，不如让他把逗号去掉。 */
function parseBellTemplate(text){
  const rows = [], errs = [], seenAt = {};
  const stratByName = {}; S.data.strategies.forEach(s=>{ stratByName[String(s.name).trim()] = s; });

  String(text==null?"":text).split(/\r?\n/).forEach((raw, i)=>{
    const ln = i + 1;
    const line = raw.trim();
    /* 空行和 # 开头一律放行：AI 有时在开头写一句说明，为这个报错太苛刻，
       而 # 在铃名里几乎不可能出现。注释不算行号偏移，报的仍是文件里的真实行号。 */
    if (!line || line.charAt(0)==="#") return;

    const c = line.split(",");
    if (c.length !== 4){
      errs.push("第 "+ln+" 行：应该是「时间,名称,周期,音源」四列，这行切出来是 "+c.length+" 列");
      return;
    }
    const [tRaw, nm, stName, mdRaw] = c.map(x=>x.trim());

    const time = parseQuickTime(tRaw);
    if (!time){ errs.push("第 "+ln+" 行：时间「"+tRaw+"」不是 24 小时制时间（要写成 08:00:00）"); return; }

    if (!nm){ errs.push("第 "+ln+" 行：名称是空的"); return; }
    if (seenAt[nm]!=null){ errs.push("第 "+ln+" 行：名称「"+nm+"」和第 "+seenAt[nm]+" 行重了"); return; }

    const st = stratByName[stName];
    if (!st){ errs.push("第 "+ln+" 行：周期「"+stName+"」不在系统的周期方案里"); return; }

    /* 音源**必须**在媒体库里查得到 —— 查不到的名字会建出一条**不发声**的铃声：
       服务器照收，列表上也看不出毛病，到点就是一片安静。 */
    const found = mediaByName(mdRaw);
    if (!found){ errs.push("第 "+ln+" 行：音频文件「"+mdRaw+"」在媒体库里找不到"); return; }
    const media = found.name;

    seenAt[nm] = ln;
    rows.push({ on:true, time:time, name:nm, stratId:st.id, stratName:String(st.name).trim(),
                media:media, mediaNames:[media], life:lifeTimeOf([media]),
                label:mediaLabel({media:[media], groups:[]}) });
  });

  /* 列表本来就是按时刻排的（S.bells 每次增删后都排一遍），预览照这个来，
     粘进去的模板是乱序也看得明白。 */
  rows.sort((x,y)=> hmsToSec(x.time) - hmsToSec(y.time));
  return {rows:rows, errs:errs};
}

/* 交给用户去喂 AI 的那段提示词。
   周期名是**从这台服务器现读的**，不是写死在代码里的 —— 厂商后台里改过的周期名
   会跟着变。AI 照着这份清单抄，第三列就不会写出对不上的名字。 */
function bellTemplatePrompt(){
  const stratList = S.data.strategies.map(s=>"- "+s.name).join("\n");
  const fallback = S.data.strategies.length ? String(S.data.strategies[0].name) : "";
  return [
    "你是一个校园广播打铃计划的排版助手。下面我会给你一份打铃计划（可能是上级通知、",
    "作息表，或者一段口语描述）。请把它整理成我们的广播系统能直接导入的模板。",
    "",
    "【输出格式】",
    "纯文本，一行一条铃声，每行正好四列，用英文逗号分隔：",
    "时间,名称,周期,音源",
    "",
    "【四列分别怎么写】",
    "1. 时间：24 小时制，写成 8 位 HH:MM:SS，例如 08:00:00、14:05:30。",
    "2. 名称：这条铃叫什么，例如「第一节课上课」。整份模板里不能重名。",
    "3. 周期：必须从下面这份清单里原样复制一个，一个字都不要改：",
    stratList,
    "4. 音源：音频文件名，必须以 .mp3 结尾。",
    "",
    "【硬性要求】",
    "· 只输出模板本身。不要表头、不要序号、不要标题、不要解释、不要 Markdown 代码块。",
    "· 每行必须正好四列，不要用中文逗号「，」。",
    "· 按时间从早到晚排列。",
    "· 周期只能用上面清单里出现过的写法，不要自己编。",
    /* 服务器上一条周期方案都没有时，这句「没说就用 X」会变成「一律用「」」——
       一句读不通的话。那种情况下周期清单本身也是空的，AI 无解，索性不写这一条。 */
    fallback ? "· 计划里没说周期时，一律用「"+fallback+"」。" : "",
    fallback ? "" : "（注意：这台服务器上还没有任何周期方案，请先到服务器后台建一个。）",
    "",
    "【打铃计划】",
    "（把通知或作息表粘贴在这里，然后发给我）"
  ].join("\n");
}

/* 按节次生成出来的一行预览 → 一条铃声 */
function genRow(sec, name, media){
  const md = media ? mediaByName(media) : null;
  const mn = media ? [md?md.name:media] : [];
  return {on:true, time:secToHMS(Math.max(0,sec)), name:name,
          mediaNames:mn, life: lifeTimeOf(mn), model:0, label: mediaLabel({media:mn, groups:[]})};
}
/* ══ group (list) create / edit ═════════════════════════════════════ */
function openNewGroup(){
  const today = new Date().toISOString().slice(0,10);
  const m = openModal({ title:"新建任务", sub:"一个任务 = 打铃方案的一套完整配置", width:"520px",
    mount(b,f,mm){
      b.innerHTML = '<div class="stack">'+
        '<div class="field"><label>名称</label><input class="input" id="ngName" placeholder="任务1"></div>'+
        '<div class="grid2">'+
          '<div class="field"><label>开始日期</label><input class="input mono" id="ngStart" type="date" value="'+today+'"></div>'+
          '<div class="field"><label>结束日期</label><input class="input mono" id="ngEnd" type="date" value="'+today.slice(0,4)+"-12-31"+'"></div>'+
        '</div>'+
        '<div class="field"><label>从已有列表复制（可选）</label><select class="select" id="ngClone"><option value="">不复制</option>'+
          railGroups().map(g=>'<option value="'+g.id+'">'+esc(g.name)+'</option>').join("")+'</select></div>'+
              '</div>';
      f.innerHTML = '<span class="spacer"></span><button class="btn" id="ngC">取消</button><button class="btn btn-primary" id="ngOk">创建</button>';
      $("#ngC").onclick = ()=> closeModal(mm.id);
      $("#ngOk").onclick = ()=>{
        const name = $("#ngName").value.trim();
        if (!name){ markErr(b, $("#ngName").closest(".field")); toast("请填写名称","err"); return; }
        const clone = $("#ngClone").value;
        const start = $("#ngStart").value, end = $("#ngEnd").value;
        closeModal(mm.id);
        /* 走队列：草稿模式下也得等提交才落到服务器上。列表先拿一个临时负数 id
           在本地用着，报文提交成功时 ensureList 会把真 id 回填进去。 */
        const id = ensureList(name, {start_date:start, end_date:end, is_year_repeat:0},
                              clone ? {clone_by_group_id: clone} : null);
        S.groupId = Number(id); LS.set("lastGroup", S.groupId);
        S.bells = []; S.sel.clear(); S.mode = "list";
        recomputeListArea(); renderAll();
        toast(S.draft ? "已加入待提交" : "已写入服务器","ok");
      };
    }});
}

function deleteGroup(g){
  if (!g || !g.id) return;
  openConfirm("删除任务「"+(g.name||"")+"」",
    "服务器上会删掉这个任务和它里面的 "+S.bells.length+" 条铃声，不可撤销。",
    async ()=>{
      const n = await queueClearList(g.id, g.name);
      queueOp({
        kind:"list-delete", method:"DELETE", url:"/timing-bells-groups/"+Number(g.id),
        bellId:"list:"+g.id, entity:"list", label:"[任务] "+(g.name||""),
        sub:"删除任务"+(n?("（含 "+n+" 条铃声）"):""),
        onOk: ()=>{ S.data.groups = S.data.groups.filter(x=>Number(x.id)!==Number(g.id)); }
      });
      /* 任务删掉了，详情页也就没有「当前任务」可看了。一次只显示一栏的那些宽度下，
         详情页整个是靠 S.showDetail 这个开关撑着的（≤980px 那套 CSS 只认它），不清掉的
         话人就停在一个「任务不存在」的空壳上，还得自己摸返回键。并排显示时不看这个值。 */
      S.bells = []; S.showDetail = false; renderAll();
      toast(wroteWord(),"ok");
    }, "删除", true);
}

function openEditGroup(){
  const g = S.data.groups.find(x=>Number(x.id)===Number(S.groupId)) || {};
  const m = openModal({ title:"任务属性", sub:esc(g.name||""), width:"520px",
    mount(b,f,mm){
      b.innerHTML = '<div class="stack">'+
        '<div class="field"><label>名称</label><input class="input" id="egName" value="'+esc(g.name||"")+'"></div>'+
        '<div class="grid2">'+
          '<div class="field"><label>开始日期</label><input class="input mono" id="egStart" type="date" value="'+esc((g.start_date||"").slice(0,10))+'"></div>'+
          '<div class="field"><label>结束日期</label><input class="input mono" id="egEnd" type="date" value="'+esc((g.end_date||"").slice(0,10))+'"></div>'+
        '</div>'+
        '<label class="chk"><input type="checkbox" id="egYear"'+(Number(g.is_year_repeat)?" checked":"")+'> 按年重复</label>'+
        '<label class="chk"><input type="checkbox" id="egOn"'+(isListEnabled(g)?" checked":"")+'> 启用该任务</label>'+
      '</div>';
      f.innerHTML = '<span class="spacer"></span><button class="btn" id="egC">取消</button><button class="btn btn-primary" id="egOk">保存</button>';
      $("#egC").onclick = ()=> closeModal(mm.id);
      $("#egOk").onclick = async ()=>{
        const btn=$("#egOk"); btn.disabled=true; btn.textContent="保存中…";
        try{
          await api("PUT","/timing-bells-groups/"+S.groupId,{body:{
            name:$("#egName").value.trim(), is_year_repeat: $("#egYear").checked?1:0,
            start_date:$("#egStart").value, end_date:$("#egEnd").value,
            is_done: $("#egOn").checked?1:0 }});
          closeModal(mm.id); await loadAll(); toast("已保存","ok");
        }catch(e){ btn.disabled=false; btn.textContent="保存"; toast(e.message,"err"); }
      };
    }});
}

/* ══ bulk helpers ═══════════════════════════════════════════════════ */
/* 批量改音源：和单条编辑框开的是**同一个**多选器（音频 · 媒体库），
   底下借 opts.extra 挂一格「播放模式」。
   播放时长**没有**了 —— 它是跟着音源总长算出来的，一批几十条各算各的，在这儿填
   一个数字等于把它们全抹成同一个值。要改时长去单条编辑框里改。
   以前这套是另一个实现（mediaPickerHTML 那三件套），顶上一排「常用」按钮，正是
   这一轮从别处删掉的那种「常用行」。 */
function openMediaBulk(list){
  const first = list[0] || {};
  let mode = Number((first.sound && first.sound.play_model) || 0) || 0;
  openMediaPicker((first.mediaNames||[]).slice(), (first.mediaGroupNames||[]).slice(), r=>{
    const ms = (r && r.media) || [], gs = (r && r.groups) || [];
    list.forEach(x=>{
      x.mediaNames = ms.slice();
      x.mediaGroupNames = gs.slice();
      x.sound = Object.assign({}, x.sound, {play_model: mode});
      /* 时长只有「只挑文件」时算得出来：选了整个媒体库文件夹的话，本地不知道里面
         有多少、多长，那就沿用原来的值 —— 和批量改音源（tkBulkMedia）同一条规矩。 */
      if (ms.length && !gs.length) x.sound.life_time = lifeTimeOf(ms);
      queueUpdate(x,"改音源");
    });
    S.sel.clear(); renderAll(); toast(wroteWord(),"ok");
  }, {
    title:"批量修改音源（"+list.length+" 条）",
    sub:"这些铃声统一改用这些音源",
    validate(r){ if (r.media.length || r.groups.length) return true; toast("请选择音源","err"); return false; },
    extra:{
      /* 这一格占满整行宽（从前钉着 max-width:220px）—— 它和铃声/任务编辑器里那格
         「播放模式」是同一件事，那两处现在各占半行、把整行分掉，这里只有它一格，
         就自己把整行占了；钉着 220px 会显得是另一套排法。 */
      html:'<div class="field"><label>播放模式</label>'+
        '<select class="select" id="mbMode"><option value="0">列表播放</option><option value="1">循环播放</option></select></div>',
      mount(box){
        const s = box.querySelector("#mbMode"); if (!s) return;
        s.value = String(mode);
        s.onchange = ()=> mode = Number(s.value)||0;
      }
    }
  });
}

/* 批量改时间：周期和执行偏移在同一张框里。
   以前是两个按钮、两张框 —— 改周期是一张，改时移是另一张，两条都在改同一个
   PUT /timing-bells/{id}。想「换周期，顺便整体提前五分钟」得开两次、来回看两遍。
   合并之后两个字段都留空也能点确定（等于什么都没改，直接说一声）。 */
function openTimeBulk(list){
  const opts = S.data.strategies.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join("");
  openModal({ title:"改时间（"+list.length+" 条）", width:"520px",
    mount(b,f,mm){
      b.innerHTML = '<div class="stack">'+
        '<div class="field"><label>执行周期</label>'+
          '<select class="select" id="tbS"><option value="">不改周期</option>'+opts+'</select>'+
          /* 只写名字，不跟「 · 周一 周二 …」。这一条和「创建铃声」里那个下拉
             是同一份数据、同一个看法：名字本身就是用户起的那句描述 */
          '<div class="hint">换成另一个周期就选一个；不改就留在「不改周期」。</div>'+
        '</div>'+
        shiftFieldHTML("tb")+
      '</div>';
      f.innerHTML = '<span class="spacer"></span><button class="btn" id="tbC">取消</button>'+
        '<button class="btn btn-primary" id="tbOk">应用</button>';
      $("#tbC").onclick = ()=> closeModal(mm.id);
      $("#tbOk").onclick = ()=>{
        const sid = $("#tbS").value ? Number($("#tbS").value) : null;
        const d = readShiftSec("tb");            /* 秒，正负都行 */
        if (!sid && !d){ toast("周期和时间都没改，不用应用","err"); return; }
        closeModal(mm.id);
        list.forEach(x=>{
          const bits = [];
          if (sid){ x.strategyId = sid; bits.push("改周期"); }
          if (d){
            x.time = secToHMS(wrapDay(hmsToSec(x.time) + d));
            x.times = [x.time];
            bits.push(shiftWord(d));
          }
          /* 两件事一起改也只发一条 —— 都落在同一个 PUT 上，队列里按下标
             去重（同 bellId + 同 method + 同 url 的后一条顶掉前一条），
             分两次 queueUpdate 会把前一件丢掉。 */
          queueUpdate(x, bits.join(" + "));
        });
        S.bells.sort((x,y)=> hmsToSec(x.time)-hmsToSec(y.time));
        S.sel.clear(); renderMain(); toast(wroteWord(),"ok");
      };
    }});
}

/* ══ 行尾图标 ═════════════════════════════════════════════════════
   以前是一个 ⋯ 菜单，里面「编辑 / 启停 / 恢复继承 / 复制 / 删除」混在一起，
   启停还和别处的开关两套说法。现在启停归开关，菜单只留三个能一眼看懂的动作。
   图标在 00-core.js 的 ICON 里，全部抄自 lucide.dev。 */

function copyBell(b){
  if (!b) return;
  const c = JSON.parse(JSON.stringify(b));
  c.id = null; c.tmpId = "t"+Math.random().toString(36).slice(2,8); c.isNew = true;
  c.name = b.name + " 副本";
  S.bells.push(c);
  S.bells.sort((x,y)=> hmsToSec(x.time)-hmsToSec(y.time));
  queueCreate(c);
  renderAll();
  toast("已复制「"+b.name+"」"+tailFor(), "ok");
}

function removeBell(b){
  if (!b) return;
  openConfirm("删除「"+b.name+"」", "该铃声将从列表中移除，不可撤销。",
    ()=>{ queueDelete(b); renderAll(); toast(wroteWord(),"ok"); }, "删除", true);
}

/* ══ 行尾那枚「⋯」点开的小单子 —— 只有竖屏上看得见（见 css/app.css）═════
   竖屏上那三枚图标收成一枚：三个 26px 的方块并排，占掉屏宽的十分之一还多，
   指头还按不准 —— 误触哪个都是改数据。点开是同样三个动作，一行一个、字写全。

   浮层照「时 / 分 / 秒 转轮」那一套（js/00-core.js 的 openTimePicker）：挂
   #layers 下、position:fixed（不这样会被 .tbl-wrap 的 overflow 裁掉），位置按
   锚点算，下面放不下就翻到上面。同时只开一个：再点别的 ⋯ 先把前一个收了。

   和转轮不一样的一处：**外面那一下要用遮罩吃掉**。转轮是「先把浮层收起来，
   那一指接着落到它该落的地方」（值域就摆在输入框上，点哪儿都是选时间）；
   这里正相反 —— 落到该落的地方就是落到某一行上，顺手把那条铃声选中了。
   遮罩在 pointerdown 那一瞬间还不能撤（撤了 click 就没东西接，一样穿到后面
   那行去），所以由它自己接 click 再收。 */
let RM = null;
function closeRowMenu(){
  if (!RM) return;
  const m = RM; RM = null;
  m.host.remove(); m.scrim.remove();
  document.removeEventListener("keydown", m.onKey, true);
  window.removeEventListener("scroll", m.onScroll, true);
}
function openRowMenu(anchor, items){
  closeRowMenu();
  const host = document.createElement("div");
  host.className = "rowmenu";
  host.innerHTML = items.map((it,i)=>
    '<button type="button" class="rm-row'+(it.danger?" danger":"")+'" data-rmi="'+i+'">'+
      '<span class="ri">'+(it.icon||"")+'</span>'+esc(it.label)+
    '</button>').join("");
  const scrim = document.createElement("div");
  scrim.className = "rowmenu-scrim";
  const layers = $("#layers") || document.body;
  layers.appendChild(scrim);
  layers.appendChild(host);

  /* 位置：右边缘对齐那枚 ⋯，就在它下面；底下不够就翻到它上面。
     先量后设，不然它会先在左上角闪一帧。 */
  const r = anchor.getBoundingClientRect();
  const w = host.offsetWidth, h = host.offsetHeight;
  host.style.left = Math.min(Math.max(8, r.right - w), Math.max(8, window.innerWidth - 8 - w))+"px";
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 6 - h);
  host.style.top = top+"px";

  const onKey    = e=>{ if (e.key==="Escape"){ e.stopPropagation(); closeRowMenu(); } };
  /* 页面一动它就和锚点错位了，直接收掉，不追（同转轮） */
  const onScroll = e=>{ if (RM && !RM.host.contains(e.target)) closeRowMenu(); };
  RM = { host, scrim, onKey, onScroll };
  scrim.onclick = ()=> closeRowMenu();
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);

  /* data-rmi 不叫 data-rm：那个名字已经被区域编辑器里的「移除」叉占着了
     （js/20-ui.js），两处虽然不在同一棵树里，名字留着同一份只会让人看错。 */
  host.onclick = e=>{
    const b = e.target.closest("[data-rmi]"); if (!b) return;
    const it = items[Number(b.dataset.rmi)];
    closeRowMenu();      /* 先收再跑：复制会重画整张表，删除还会再叠一层确认框 */
    it.onPick();
  };
}

