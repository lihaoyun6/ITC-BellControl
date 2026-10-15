/* config —— 面板配置的持久化（本机一份，服务器上页面旁边一份）
   //////////////////////////////////////////////////////////////

   面板现在由 dufs 提供，而 dufs 除了发静态文件，**还允许 PUT 往服务器本地写文件**。
   网页自己是写不了文件的（File System Access API 只在安全上下文里有，而且写下去的
   是「看这个页面的人」那块硬盘，不是服务器的），但可以让 dufs 替它写 —— 所以配置
   就摆在 index.html 旁边，一个 config.json。

   两份：

     · 浏览器里那份（localStorage 的 bc.cfg）—— 同步写，关页面也不会丢，
       任何一头出问题它都还在；
     · 服务器上那个 config.json —— 换一台电脑、换一个浏览器也能读到同一份。

   装的是**这个面板自己的设置**：分组（lists）、铃音预设（presets）、
   全局时间偏移（offsetSec）、考试模式那一份（exam —— 分区／科目／日期／静音区域，
   以及这一场建了哪些临时列表、开没开着）。

   考试模式原先只写在本机那个 bc.exam 键里，换台电脑打开就是一份空白配置页 ——
   而它管的是一场真的考试，两台机器上看到的不该是两个样子。现在它跟别的一样走
   这份配置（键名仍然叫 exam，值就是 S.exam 那个对象）。

   ── 谁赢：**一个键一个版本号** ────────────────────────────────
   每个键（上面那四样）各带一个 rev，改哪个键、哪个键的 rev +1。两边都拿到的时候
   一个键一个键地比，哪边大听哪边的，**没动过的键根本不参与**。

   为什么不是整份一个时间戳：那样一来，在 A 机上改完分组、再去 B 机上打开，只要 B
   动过任何一处（哪怕只是调了一下时间偏移），推上去的就是 B 那份旧的分组，A 改的
   没了。分开记之后，B 没碰过的键不会拿自己手上的旧值去盖。

   推开之前**先拉一趟**（见 cfgUpload）：不先看一眼服务器上那份，就不知道哪些键是
   别处动过的，那不叫推送、叫覆盖。拉不到就不推，等下一次。

   rev 只在**真人动手改**的那条路上抬（cfgSave）。开机读出来的默认值、从服务器采纳
   回来的一份、老键搬家 —— 那几条路一律不抬。抬了就出事：一台从没配过考试的机器，
   打开面板的第一步就会给一份空的考试配置盖上「刚改过」的章，推上去把正在用的那份
   抹了。**「本机有服务器上没有的改动」在数字上就是「rev 比服务器大」，推不推全看它。**

   ── 面向用户的说法 ──────────────────────────────────────────────
   这一层是纯技术实现，**不要出现在任何通知、弹窗、说明文字里**。用户看到的是
   「分组」这个功能；它怎么存的跟他没关系。 */

/* ══ 载体 ═══════════════════════════════════════════════════════════
   **同源**：配置就摆在页面旁边，路径写相对的就行。
   好处是这一层里**一个口令字都不用写** —— dufs 那道认证（basic）在打开页面时
   浏览器已经问过一次了，同一个 origin 下的 fetch 自动带着它。 */
const CFG_URL = "config.json";
const CFG_TMP = "config.json.tmp";          /* 只在写入的那一刹那存在 */

/* 老载体留下的痕迹：配置原先挂在媒体库里一个 1 秒静音 mp3 的屁股后面，传进一个叫
   custom_config 的文件夹。换成 config.json 之后，媒体库里那两样东西还在，而挑铃音的
   面板列的是整个媒体库 —— 让人能挑中它们既没意义，也会把「这里为什么有个
   custom_config」摆到台面上。这两个名字只用来把它们滤掉（见本文件末尾 cfgMediaHide）。 */
const CFG_FOLDER = "custom_config";
const CFG_FILE   = "custom_config.mp3";

/* ══ 内存里那一份 ═══════════════════════════════════════════════════ */
/* 带版本号的那几个键。**加新的一样要加进这张表**，否则它进不了对账，
   永远是本机一个值、服务器上一个值。 */
const CFG_KEYS = ["lists","presets","exam","offsetSec"];

/* 从服务器上读回来的东西不能直接信 —— 那是个能被别的程序改掉的文件。所以过一遍
   cfgNorm：形状不对的一律丢掉，别让一个坏字段把整个分组界面带崩。 */
function cfgNorm(c){
  const o = {v:2, rev:{}, lists:{}, presets:[]};
  if (!c || typeof c !== "object") return o;
  if (c.lists && typeof c.lists === "object") Object.keys(c.lists).forEach(k=>{
    const arr = c.lists[k];
    if (!Array.isArray(arr)) return;
    o.lists[String(k)] = arr.filter(g => g && typeof g === "object" && g.id).map(g=>({
      id   : String(g.id),
      name : String(g.name==null?"未命名":g.name),
      bells: (Array.isArray(g.bells) ? g.bells : []).map(String)
    }));
  });
  /* 预设两条都要字符串。**填了一半的照留**（只填了名字、还没挑文件的那条）——
     设置面板里就摆着这样一条行，重开面板它得还在，那是人家填到一半的东西。 */
  if (Array.isArray(c.presets)) o.presets = c.presets
    .filter(p => p && typeof p === "object" && !Array.isArray(p))
    .map(p => ({ label:String(p.label==null?"":p.label), media:String(p.media==null?"":p.media) }));
  /* 偏移量：**这一项可能压根没有**（加它之前写下的老配置）。没有就不写进 o，
     见下面 cfgApplyOffset —— 「没有」不等于 0。 */
  if (c.offsetSec != null && isFinite(Number(c.offsetSec))) o.offsetSec = Number(c.offsetSec);
  /* 考试模式那一份**原样收着，不在这儿整形**：它里面是分区／科目／日期那几层嵌套，
     真正认得它的形状的是 loadExam()（40-view-exam.js）。而这个函数跑得比那个文件早
     —— 加载 05-config.js 的时候 loadExam 还没定义出来，这儿调它就是 ReferenceError。
     所以这一层只做一件事：确认它是个对象（不是数组、不是字符串），别让一个坏字段
     把整份配置带崩。缺这一项就是「还没配过考试」，跟没有 offsetSec 是一个意思。 */
  if (c.exam && typeof c.exam === "object" && !Array.isArray(c.exam)) o.exam = c.exam;
  /* 版本号：**只认正数**，别的（字符串、NaN、负数、缺）一律当没改过（0）。
     放一个 NaN 进去最麻烦 —— 它跟谁比都是 false，那个键从此再也不会更新。 */
  CFG_KEYS.forEach(K=>{
    const n = Number(c.rev && c.rev[K]);
    if (isFinite(n) && n > 0) o.rev[K] = n;
  });
  /* 只认逐键 rev 这一种形状。老那份「整份一个 ts、没有 rev」的文档不理它 ——
     面板还没发布过，没有谁的存档要靠那个认；那种文档全是 rev 0，也就是「本机什么都
     没改过」，正是新机器该有的样子。 */
  return o;
}

/* ══ 合并：一个键一个键地判 ═════════════════════════════════════════
   local 是本机手上这份，remote 是刚拉回来的那份（两边都过了 cfgNorm），
   touched 是本机上**改过还没成功推出去**的键（见 cfgSave）。
   返回：

     doc    —— 合并出来的一份**新文档**，接下来要么拿它接着过、要么拿它推上去
     took   —— 从远端采纳了值、而且值真的和本机不一样的键（决定要不要重画）
     ahead  —— 合并之后 rev 比远端大的键 = 服务器上还没有的本机改动（决定要不要推）

   判法：本机刚改过的一律留本机的（对账不能把还没推出去的改动抹了）；服务器上
   压根没有这一项就留本机的（「没有」不等于「清空了」）；服务器那份 rev 更大就听
   服务器的；**一样大又不一样就当服务器对**（同版本号本不该有两个值，那说明本机
   这份是旧的、只是版本号没跟上，服务器是两边共同的那份）。 */
function cfgMerge(local, remote, touched){
  const doc = {v:2, rev:{}}, took = [], ahead = [];
  CFG_KEYS.forEach(K=>{
    const lRev = Number(local.rev[K]) || 0, rRev = Number(remote.rev[K]) || 0;
    const rHas = remote[K] !== undefined;
    const differs = rHas && (local[K] === undefined ||
                             JSON.stringify(remote[K]) !== JSON.stringify(local[K]));
    if (touched.has(K) || !rHas || rRev < lRev || (rRev === lRev && !differs)){
      doc[K] = local[K];
      /* 本机这份是「刚改过的」，版本号得压过服务器手上的那个 —— 不然下一次
         对账又会判成服务器更新，改动永远推不上去。 */
      doc.rev[K] = touched.has(K) ? Math.max(lRev, rRev + 1) : Math.max(lRev, rRev);
    }else{
      doc[K] = remote[K];
      doc.rev[K] = Math.max(lRev, rRev);
      if (differs) took.push(K);
    }
    if ((doc.rev[K] || 0) > rRev) ahead.push(K);
  });
  return {doc, took, ahead};
}

/* 换掉内存里这份配置，并写进本机那份（localStorage）。**只换对象、不重画** ——
   换下来的值要不要让画面跟着变，看 cfgAdopt。 */
function cfgPut(doc){ S.cfg = doc; LS.set("cfg", doc); }

/* 采纳一份文档：换掉内存里这份，并把认这份文档的四样东西各自重新认一遍，最后整页
   重画 —— 画面上那些胶囊、列表是按**旧对象**摆好的，不重画就停在旧的一份上。 */
function cfgAdopt(doc){
  cfgPut(doc);
  loadPresets();
  cfgApplyOffset();
  cfgApplyExam();
  try{ renderMain(); }catch(e){}
}

/* 本机那份必须**同步**读出来 —— 它在任何网络请求之前就得可用（页面第一帧就要画
   分组胶囊），所以是赋值不是 await。 */
S.cfg = cfgNorm(LS.get("cfg", null));
cfgApplyOffset();  /* 偏移量也在这份配置里，开机先对一次 */
loadPresets();     /* 预设就装在这份配置里，读出来才有的画 */

/* 全局时间偏移跟着配置走 —— 换台电脑打开，时刻的显示口径得是同一个。
   **配置里没有这一项的时候什么都不改**：那是加它之前写下的老配置，而「没有」不等于
   0，当成 0 会把本机已经设好的偏移悄悄清零。这时候拿本机那份当基线填进去，
   下次任何一处改动都会捎带着把它写进配置。 */
function cfgApplyOffset(){
  if (S.cfg.offsetSec === undefined){
    S.cfg.offsetSec = Number(LS.get("offsetSec", 0)) || 0;
    return;
  }
  const v = Number(S.cfg.offsetSec) || 0;
  if (v === S.offsetSec) return;
  S.offsetSec = v;
  LS.set("offsetSec", v);
  reapplyOffset();
}

/* 考试模式那一份跟着配置走（见文件头），所以换了一份配置之后要把它重新认一遍 ——
   认得它的形状的是 loadExam()（40-view-exam.js），这里只负责在**对**的时机叫它。
   换的是内存里的对象：考试模式页上那些分区、科目是上一帧按旧对象摆好的，得重画。

   服务器上那份**没有 exam 这一项**的时候，绝不拿一个空默认值顶掉手上的这份 ——
   那可能是别的机器用更早的版本推上来的（升级前写的配置里没这一项），也可能它
   压根没碰过考试模式。手上的留着，下次任何改动会捎着它一起推上去，两边自己合上。
   反过来说：手上的那份是空的，就照实让它空着 —— 那是「这台机器上考试配置被清空了」，
   不是「被顶掉了」。 */
function cfgApplyExam(){
  if (S.cfg.exam) S.exam = loadExam();
  else if (S.exam) S.cfg.exam = S.exam;
}

/* ══ 保存 / 推送 ════════════════════════════════════════════════════ */
/* ══ 什么时候往服务器推 ══════════════════════════════════════════════
   本机那份**每次改动都当场写**（localStorage，就是下面 cfgSave 第一件事）。
   服务器那份**攒着推** —— 编一下推一下太吵。攒的规矩是三句：

     1. 静默 CFG_QUIET 毫秒没再动，才推。
     2. 分组弹窗开着的时候一律不推（cfgHold）—— 改分组这事儿全发生在弹窗里，
        关掉弹窗那一下才算一件事做完。一次编辑会话 = 一趟上传。
     3. 人要走了（切标签页、最小化、关标签页）当场推。

   攒着**不会丢**：本机那份是当场写的（连版本号一起），刷新、关浏览器再开都还在，
   而且 loadAll 时会拿它和服务器那份对账，本机有服务器上没有的改动就推上去
   （见下面 cfgSync 里那个 ahead）。
   第 3 条是为了另半件事：不让人在 A 机上改完随手关掉、转头在 B 机上
   看到一份旧的 —— 那份旧的会被 B 机推上去，把 A 机改的盖掉。 */
const CFG_QUIET = 5000;
let cfgTimer = null, cfgBusy = null, cfgDirty = false, cfgSynced = false;
let cfgHold = 0;            /* 开着的分组弹窗个数 */
let cfgWarned = false;      /* 这一串失败里已经报过一次了，别一直弹 */
/* 本机**这次开机以来**改过、还没成功推出去的键。它挡的是这么一档子事：改动攒着
   还没推（CFG_QUIET 那几秒），对账那趟先回来了 —— 不认得「这几个键是我刚动的」，
   就会拿服务器上那份把刚改的抹掉。跨开机的那些不用它管：版本号本身已经比服务器
   大了，对账照样判成本机赢。 */
const cfgTouched = new Set();

/* 改了就调这个。key 是 CFG_KEYS 里的哪一个 —— **必须传对**，抬的是那个键自己的
   版本号，抬错了就是对账听错了人。 */
function cfgSave(key){
  S.cfg.rev[key] = (Number(S.cfg.rev[key]) || 0) + 1;
  cfgTouched.add(key);
  LS.set("cfg", S.cfg);        /* 本机当场写 —— 拖一次胶囊不用等网络 */
  cfgDirty = true;
  if (cfgHold) return;         /* 弹窗还开着，关掉那一下统一推 */
  clearTimeout(cfgTimer);
  cfgTimer = setTimeout(cfgFlush, CFG_QUIET);
}

/* 分组弹窗开时按住、关时放开。放开那一下就把攒着的推出去。
   成对调用：openModal 的 onClose 只会跑一次（closeModal 里有 indexOf 那道闸）。 */
function cfgHoldOn(){ cfgHold++; }
function cfgHoldOff(){
  if (cfgHold > 0) cfgHold--;
  if (!cfgHold && cfgDirty) cfgFlush();
}

/* 人要走了（切标签页 / 最小化 / 关标签页都会走到这儿）。
   没攒着东西就什么也不做 —— 切来切去不该发出任何请求。
   反过来，**切回来的那一下当场对一次账**：另一台机器上刚改完，回来了立刻就该看见，
   没必要干等下一趟轮询。 */
document.addEventListener("visibilitychange", ()=>{
  if (document.visibilityState === "hidden") cfgFlushIfDirty();
  else if (cfgSynced) cfgSync();
});
function cfgFlushIfDirty(){ if (cfgDirty) cfgFlush(); }
window.addEventListener("pagehide", cfgFlushIfDirty);

/* 推不上去要说一声。本机那份还在（刷新、关掉再开都还在），但换一台电脑就看不到了 ——
   这是「你的改动没丢，只是还没共享出去」，不说的话用户会以为已经好了。
   一串失败只报一次，恢复之后再坏才重新报。 */
function cfgFlush(){
  if (cfgBusy) return cfgBusy;            /* 有一趟在飞，等它落地后自动补一趟 */
  clearTimeout(cfgTimer); cfgTimer = null;
  cfgDirty = false;
  cfgBusy = (async ()=>{
    try{
      await cfgUpload();
      cfgWarned = false;
    }catch(e){
      if (!cfgWarned){
        cfgWarned = true;
        toast("改动提交失败，将在下次改动后重试", "err");
      }
    }
    cfgBusy = null;
    if (cfgDirty) cfgFlush();
  })();
  return cfgBusy;
}

/* 写配置。**推之前先拉一趟**（下面那几行）—— 不先看一眼服务器上那份，就不知道
   哪些键是别处动过的，那不叫推送、叫覆盖。拉回来跟手上这份一个键一个键地合，
   只有本机真改过的那几个键会用本机的值，其余的人家那份原样带回去。
   拉不到就**不推**（抛出去，由 cfgFlush 记账）：手上这份有可能是上次没同步完的
   旧账，而服务器上那份可能更新 —— 宁可等下一次，也不能拿手上的把更新的盖掉。

   然后两跳写盘：先写旁边那个临时名字，再 MOVE 盖过来。
   直接 PUT 覆盖是**有过程的**：写到一半的时候别的终端正好来读，就会读到半截 JSON。
   MOVE 在服务器上是一次改名，读的人要么看见旧的、要么看见新的，没有中间那一刻。
   两跳都是几百字节，代价可以忽略。 */
async function cfgUpload(){
  const remote = await cfgPull();            /* 404 → null（服务器上还没有这一份） */
  if (remote){
    const {doc, took} = cfgMerge(S.cfg, cfgNorm(remote), cfgTouched);
    if (took.length) cfgAdopt(doc); else cfgPut(doc);
  }
  const body = JSON.stringify(S.cfg);        /* 合并之后再取字符串：合并那一下可能改动过 S.cfg */
  const put = await fetch(CFG_TMP, { method:"PUT", body,
                                     headers:{ "Content-Type":"application/json" } });
  if (!put.ok) throw new Error("写配置失败（HTTP " + put.status + "）");
  const mv = await fetch(CFG_TMP, { method:"MOVE",
    headers:{ "Destination": new URL(CFG_URL, location.href).href, "Overwrite":"T" } });
  if (!mv.ok) throw new Error("写配置失败（HTTP " + mv.status + "）");
  /* 落盘了，这几个键不再是「本机单方面改过」。清早了也不行、清晚了也不行 ——
     清早了它就不再保护刚改的值，清晚了下一趟推送又会把它们当成本机的新改动。 */
  cfgTouched.clear();
}

/* 读配置。**还没有人写过**是 404，那不是错误，是「服务器上还没有这一份」——
   对账那边靠它决定「该不该把本机这份推上去」。读回来解析不了（文件被写坏了、
   或者正好撞上半截）也当这一趟没读成，绝不能当成「服务器上那份是空的」。 */
async function cfgPull(){
  const res = await fetch(CFG_URL, { cache:"no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("HTTP " + res.status);
  let doc = null;
  try{ doc = JSON.parse(await res.text()); }catch(e){ throw new Error("配置读不出来"); }
  return doc;
}

/* ══ 预设：把老的那份本机键搬进配置里 ══════════════════════════════
   预设原先存在本机一个单独的键里（bc.presets），换台电脑就看不见 —— 现在跟配置走。
   这一趟是搬家：对完账、**基线定了之后**才搬，搬完走 cfgSave("presets") 推上去
   —— 和「人手动改了预设」是同一条路，版本号一抬，那一趟推送自然带上它。
   这个键搬一次就没了，之后每趟对账走到这儿都是一句话的事。 */
function cfgAdoptPresets(){
  const old = LS.get("presets", null);
  if (!Array.isArray(old) || !old.length) return;
  LS.del("presets");
  if (S.cfg.presets.length) return;      /* 配置里已经有了（别的机器搬过），老的那份作废 */
  S.cfg.presets = cfgNorm({ presets: old }).presets;   /* 过一遍同一套整形 */
  loadPresets();
  cfgSave("presets");
}

/* 对一次账。本机那份已经在跑了，这一步只决定「哪些键该换成服务器上那份」。
   读不到就悄悄用本机那份 —— 这正是留那份副本的意义，不是什么需要报给用户的事故；
   真出事（推不上去）会在 cfgFlush 里说。 */
async function cfgSync(){
  let remote = null, failed = false;
  try{ remote = await cfgPull(); }catch(e){ failed = true; }
  if (remote){
    const {doc, took, ahead} = cfgMerge(S.cfg, cfgNorm(remote), cfgTouched);
    /* 有键真的采纳了服务器那份 → 换过去并重画（画面上的胶囊、列表是上一帧按旧对象
       摆好的，不重画就停在旧的一份上：一个新浏览器打开面板会一直停在「还没有分组」，
       直到用户碰巧点了别的什么触发一次重绘）。没有值变、只是版本号跟上了 → 悄悄换上
       就行，别为了这个重画一遍。 */
    if (took.length) cfgAdopt(doc); else cfgPut(doc);
    /* 合并之后有键比服务器那份新 = 本机有还没推上去的改动（上一次推失败、或者改动
       是上一次开机攒下的）—— 借着这一趟补推。**新浏览器不会走到这儿**：它的版本号
       全是 0，合出来的和服务器一样大。 */
    if (ahead.length) cfgFlush();
  }
  /* 服务器上还没有那一份（404）—— 本机动过就把它推上去，服务器上那份就是这么
     第一次出现的。**读失败的时候绝不能推** —— 万一服务器上躺着一份更新的，这一推
     就把它盖了，而本机这份有可能只是上次没同步完的旧账。等用户下次动手改再推。
     也没有任何键改过（版本号全是 0）就更不用推：没必要在服务器上留一个空壳 ——
     一台刚打开面板、什么也没碰的机器，不该造出一份空配置去盖别人那份。 */
  else if (!failed && cfgAnyRev()) cfgFlush();
  cfgAdoptPresets();
}
/* 本机有没有「改过」的键（版本号 > 0）。 */
const cfgAnyRev = ()=> CFG_KEYS.some(K=> (Number(S.cfg.rev[K]) || 0) > 0);

/* 每次登录只对一次账 —— loadAll() 会被反复调到，不能每次都去下那个文件。 */
function cfgSyncOnce(){ if (!cfgSynced){ cfgSynced = true; cfgSync(); } }

/* ══ 频繁对账 ══════════════════════════════════════════════════════
   现在配置就是服务器上的一个文件，读一趟几百字节 —— 不像从前那样要绕媒体库下载
   一个 17KB 的壳子。所以可以问得勤一点：另一个终端上刚改完，这边最多 CFG_POLL
   毫秒就跟着变。

   两条闸：**登录过**（没登录时页面还停在登录页，没什么可对的），以及**页面在前台**
   （挂在后台的标签页不该继续发请求）。切回前台的那一下不等这一趟，当场对一次账。 */
const CFG_POLL = 5000;
setInterval(()=>{
  if (!cfgSynced) return;
  if (document.visibilityState !== "visible") return;
  cfgSync();
}, CFG_POLL);

/* ══ 把老载体那两样东西从媒体库里滤掉 ══════════════════════════════
   挑铃音的面板列的是服务器上的整个媒体库，我们从前那个文件夹和静音壳子都还在里面。
   配置本身早就搬到 config.json 了，但这两样留在那儿会让人挑得中：
   既没意义，也会把「这里为什么有个 custom_config」摆到台面上。 */
function cfgMediaHide(x){
  const n = String((x && x.name) || "");
  return n !== CFG_FOLDER && n !== CFG_FILE;
}
