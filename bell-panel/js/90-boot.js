/* boot
   广播控制台 · 替代厂商后台的打铃配置面板
   ////////////////////////////////////////////////////////////// */

/* ══ boot ═══════════════════════════════════════════════════════════ */
(function boot(){
  const saved = savedSession();          /* 本机留着没过期的令牌吗（见 10-data.js） */
  if (!saved){ forgetLogin(); renderAll(); return; }   /* 没有 / 已过期 → 停在登录页 */
  /* **先把界面画成主界面，再去问服务器。** 这一笔就是「不闪登录页」的全部：
     先画登录页、等结果回来再换成主界面，人就会看见登录页闪一下 —— 而答案其实
     早在开局就知道了（savedSession() 是同步的），没理由先画错的再改。
     这趟往返期间顶栏写着「连接中」、主区写着「正在连接广播服务器」，都是实话。

     代价：令牌真被服务器否掉、而本机又没留用户名密码时（没勾「记住登录状态」），
     会反过来闪一下主界面外壳再落到登录页。那时人本来就得重登，比每次刷新都闪
     登录页划算。本机留着用户名密码的话连这一下都没有 —— 探针吃 401 会自己续一张
     令牌重发一次（见 10-data.js 的 reLogin），人就停在主界面上。 */
  S.token = saved;
  S.conn = "busy";
  S.view = "app";
  renderAll();
  /* 拿存着的令牌去问一个**认令牌**的接口，通了就直接进主界面 —— 刷新不用重输密码
     就是这一趟办到的事。

     **别拿 /auth 当探针**：那是纯登录接口，只认 name + password，请求头上的令牌
     它看都不看（带 Bearer 前缀也一样）。以前这里问的就是 /auth，于是拿着有效令牌
     也必然吃「用户名不能为空」，还把令牌当场删掉 —— 「记住登录状态」等于摆设。
     实测见 30-view-list.js 里「探针为什么不是 /auth」那段。 */
  api("GET","/timing-bells-groups/all",{params:{withUser:"true"}})
    .then(()=>{ S.conn = "ok"; return loadAll(); })
    .then(()=>{ renderAll(); openStatusFeed(); })
    .catch(()=>{ forgetLogin(); S.conn = "idle"; S.view = undefined; renderAll(); });
})();
