import Foundation
import UIKit
import AVFoundation
import WebKit

/// App 内置的「播放代理」。
///
/// 网页那一侧只看见一个普通的 `WebSocket`（注入的垫片把回环地址换成这里），
/// 发三条命令、把 PCM 当二进制帧丢过来；连广播服务器、开 UDP、套 20 字节头、
/// 按 100 包/秒发，全在这一层用原生接口做完。外部 play-agent 在 iOS 上不再需要。
///
/// 命令语义和文案逐条对齐 ITCPlayAgent/main.go。
final class NativeAgent: NSObject {
    private let link = SchoolLink()
    private var audio: AudioSender?
    private var taskID = ""
    private var token = ""
    private var live = false
    /// 正在放的那条提示音。留着强引用，不然播到一半就被回收了。
    private var chimePlayer: AVAudioPlayer?
    /// 拨号键音那套：一个常驻的音频引擎 + 一个常驻的播放节点。
    /// 十组 DTMF 双音在 App 启动时就预渲染成 buffer，按键只往节点上排一段 ——
    /// 不再每次按键 setCategory / setActive / 现造播放器（那是按键音「慢半拍」
    /// 的来源，见 tone() 的说明）。
    private var toneEngine: AVAudioEngine?
    private var toneNode: AVAudioPlayerNode?
    /// 预渲染好的 DTMF buffer，键是「整数频率-整数频率」。
    private var toneBuffers: [String: AVAudioPCMBuffer] = [:]
    /// DTMF buffer 的格式：16k 单声道浮点，和网页那段 Web Audio 一致。
    private let toneFormat = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)
    /// 按键音的串行队列。建引擎、预渲染、排 buffer 都在这里做 —— 这些调用
    /// 会阻塞，快速连按的时候主线程一卡，触摸事件就会被压掉（丢键）。
    private let toneQueue = DispatchQueue(label: "itc.tone", qos: .userInteractive)
    /// 每次挂断加一。异步的 call 链条回来时对不上就说明已经被取代了。
    private var callGen = 0

    /// 打铃服务器那头断了、或者 App 要进后台：通知页面把那条桥接 socket
    /// 关掉，页面自己的 onclose 会把「正在对讲」收回 idle（play-agent 留的
    /// 那个缺口在 App 里顺手补上）。
    var onClientDrop: (() -> Void)?

    let commandHandler = CommandHandler()
    let dataHandler = DataHandler()

    override init() {
        super.init()
        commandHandler.agent = self
        dataHandler.agent = self
        link.onDrop = { [weak self] in
            DispatchQueue.main.async {
                guard let self else { return }
                let wasLive = self.live
                self.hangUp(why: "与打铃服务器的连接已断开")
                if wasLive { self.onClientDrop?() }
            }
        }
        /* 按键音提前备好：引擎建起来、十段 buffer 预渲染、player node 开始
           「播静音」。放进后台队列，不挡 App 启动；第一次按键就是热的。 */
        toneQueue.async { [weak self] in self?.prepareTones() }
        /* 来电 / Siri 这类打断结束之后，AppDelegate 会把会话重新激活；
           引擎这边也得重新拉起来（会话停的时候引擎也跟着停了）。 */
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
                                               object: nil, queue: nil) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
            self?.toneQueue.async { self?.reactivateTones() }
        }
        /* 音频服务被系统重置过：引擎和 buffer 都不作数了，整套重建。 */
        NotificationCenter.default.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification,
                                               object: nil, queue: nil) { [weak self] _ in
            self?.toneQueue.async {
                guard let self else { return }
                self.toneEngine = nil
                self.toneNode = nil
                self.toneBuffers.removeAll()
                self.prepareTones()
            }
        }
    }

    /// 页面重新加载、App 进后台时调用。没在通话时它是空操作。
    func hangUp(why: String) {
        callGen += 1
        let a = audio
        let t = taskID
        let tk = token
        let wasLive = live
        audio = nil
        taskID = ""
        token = ""
        live = false
        guard wasLive, let a else { return }
        a.stop()
        link.stop(token: tk, taskID: t)
        /* 挂断之后 WebKit 会把采集单元收掉，音频会话跟着停，按键音的引擎
           也一起停了。留 0.6 秒让系统把麦克风彻底放掉，再把它重新拉起来，
           下一次按键不用现点火。 */
        toneQueue.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            self?.reactivateTones()
        }
    }

    // MARK: - 命令

    fileprivate func handleCommand(_ body: Any, reply: @escaping (Any?, String?) -> Void) {
        guard let m = body as? [String: Any] else {
            finish(reply, id: 0, error: AgentError("命令解析失败"))
            return
        }
        let id = (m["id"] as? NSNumber)?.intValue ?? 0
        let cmd = m["cmd"] as? String ?? ""
        let data = m["data"] as? [String: Any] ?? [:]

        switch cmd {
        case "call":
            call(data) { err in self.finish(reply, id: id, error: err) }
        case "mute":
            mute(data) { err in self.finish(reply, id: id, error: err) }
        case "hangup":
            hangUp(why: "操作员挂断")
            finish(reply, id: id, error: nil)
        case "wake":
            /* 对讲/播放期间别让手机自动锁屏。网页在状态变化时发这条；
               App 进后台时 WebViewController 会把它关回去。 */
            let on = (data["on"] as? NSNumber)?.boolValue ?? false
            DispatchQueue.main.async {
                UIApplication.shared.isIdleTimerDisabled = on
            }
            finish(reply, id: id, error: nil)
        case "chime":
            chime(data, id: id, reply: reply)
        case "tone":
            /* 回执先走，再把合成和播放交给后台串行队列。网页每次按键之后紧跟着
               一次重画，这条 IPC 要是等音频会话激活完才回，快速连按就会卡出
               「丢键」。 */
            finish(reply, id: id, error: nil)
            toneQueue.async { [weak self] in self?.tone(data) }
        default:
            finish(reply, id: id, error: AgentError("未知命令 \"\(cmd)\""))
        }
    }

    private func call(_ d: [String: Any], done: @escaping (Error?) -> Void) {
        let ws = d["ws"] as? String ?? ""
        let udp = d["udp"] as? String ?? ""
        let tk = d["token"] as? String ?? ""
        let endpoints = d["endpoints"] as? [String] ?? []

        guard !ws.isEmpty, !udp.isEmpty else {
            done(AgentError("客户端未提供对讲地址")); return
        }
        guard !tk.isEmpty else {
            done(AgentError("客户端未发送令牌")); return
        }
        guard !endpoints.isEmpty else {
            done(AgentError("未指定目标终端")); return
        }

        /* 上一通还挂着就先收掉。面板「呼叫」失败一次、人再按一次，第二发就到了。 */
        hangUp(why: "新呼叫已取代上一通")
        let gen = callGen

        link.ensure(url: ws, token: tk) { [weak self] err in
            guard let self else { return }
            if let err { done(err); return }
            guard gen == self.callGen else {
                done(AgentError("新呼叫已取代上一通")); return
            }

            /* ★ 顺序是死的：先建套接字、问出 ip:port，再拿它当 HashKey 去发
               collect_pcm。反过来的话服务器认领的是另一条流，发多少都是白搭。 */
            let sender: AudioSender
            do {
                sender = try AudioSender(target: udp)
            } catch {
                done(error); return
            }

            let collect = Self.makeCollectData(endpoints: endpoints, hashKey: sender.hashKey)
            self.link.startCollect(token: tk, data: collect) { [weak self] err in
                guard let self else { sender.stop(); return }
                guard gen == self.callGen else {
                    sender.stop()
                    done(AgentError("新呼叫已取代上一通")); return
                }
                if let err { sender.stop(); done(err); return }
                self.audio = sender
                self.taskID = collect["TaskID"] as? String ?? ""
                self.token = tk
                self.live = true
                done(nil)
            }
        }
    }

    private func mute(_ d: [String: Any], done: @escaping (Error?) -> Void) {
        let on = (d["on"] as? NSNumber)?.boolValue ?? false
        guard let a = audio else {
            done(AgentError("当前无进行中的对讲")); return
        }
        a.setMuted(on)
        done(nil)
    }

    /* 提示音（接通／暂停／挂断）由原生放，不走网页的 <audio>。
       WKWebView 里 new Audio(...) 有时会整条哑掉：音频会话被系统打断，或者
       WebKit 收完麦克风把会话 setActive(false) 了，之后 play() 照样不报错，
       可就是一点声没有，要退 App 重开才恢复（用户实测）。AVAudioPlayer 每次
       播之前都把会话重新激活一遍，不靠 WebKit 那条路。 */
    private func chime(_ d: [String: Any], id: Int, reply: @escaping (Any?, String?) -> Void) {
        let name = d["name"] as? String ?? ""
        var url: URL?
        if !name.isEmpty, let dir = Bundle.main.resourceURL?
            .appendingPathComponent("bell-panel/res") {
            for ext in ["wav", "mp3"] {
                let u = dir.appendingPathComponent("\(name).\(ext)")
                if FileManager.default.fileExists(atPath: u.path) { url = u; break }
            }
        }
        guard let url, let player = try? AVAudioPlayer(contentsOf: url) else {
            reply(["id": id, "ok": false, "message": "提示音文件缺失: \(name)"], nil)
            return
        }
        /* 播之前把音频会话钉一遍，参数跟 AppDelegate 启动时那一份完全一致。
           网页那边调这一条之前已经把麦克风**整个**关掉（轨道 stop + 上下文
           close），并留了 300ms 让系统收掉采集单元 —— 真机上只要 WebKit 的
           采集还活着，提示音放到 0.3 秒左右必被掐断，原生/<audio>/Web Audio
           三种放法都一样（用户实测）。这里再 setCategory / setActive 一次，
           保证播放器起来时会话是活的、且走扬声器。 */
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try? session.setActive(true)
        chimePlayer?.stop()
        player.prepareToPlay()
        player.play()
        chimePlayer = player
        /* 时长给网页排「放完把麦克风接回来」用。 */
        reply(["id": id, "ok": true, "durationMs": Int(player.duration * 1000)], nil)
    }

    /* 拨号键音（DTMF）。理由和提示音一样：WebKit 的 AudioContext 在用过对讲
       （采集单元）或原生提示音之后，会停在「state 还是 running、却完全不出声」
       的状态 —— 网页那边检测不到，只能退 App 重开。所以按键音全部由原生放，
       不碰 WebKit。

       按键音要够快：快速拨号时每个键都得在触摸后立刻出声。原来的做法每按
       一次 setCategory / setActive、现场合成 WAV、再 new 一个 AVAudioPlayer；
       setActive 每次都让系统重新评估路由，刚用完麦克风时还要重新拉活，几百
       毫秒就过去了，连着按时还会丢键。现在引擎和播放节点常驻、十组双音在
       启动时就渲染好，按键只是往已经开着的节点上排一段 buffer —— 按键路径
       上没有任何同步的音频调用，也不分配对象。 */
    private func tone(_ d: [String: Any]) {
        let freqs = (d["freq"] as? [NSNumber])?.map { $0.intValue } ?? []
        guard freqs.count == 2 else { return }
        let key = "\(freqs[0])-\(freqs[1])"
        /* 引擎没在跑（刚启动还没热好、或者刚用完麦克风被系统停了）：
           重新拉起来，别把这一下吞掉。 */
        if toneEngine?.isRunning != true || toneBuffers[key] == nil {
            prepareTones()
        }
        guard let engine = toneEngine, engine.isRunning,
              let node = toneNode, let buf = toneBuffers[key] else { return }
        if !node.isPlaying { node.play() }
        /* .interrupts：连按时新的一段直接顶掉上一段，不会排成一串。 */
        node.scheduleBuffer(buf, at: nil, options: .interrupts, completionHandler: nil)
    }

    /// 建引擎、预渲染十组 DTMF、让节点开始「播静音」。只在 toneQueue 上调用。
    /// 之后按键就是热的：引擎常驻，buffer 都在内存里。
    private func prepareTones() {
        guard let fmt = toneFormat else { return }
        if toneEngine == nil {
            let engine = AVAudioEngine()
            let node = AVAudioPlayerNode()
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: fmt)
            engine.prepare()
            toneEngine = engine
            toneNode = node
        }
        if toneBuffers.isEmpty {
            /* 十组 DTMF 双音，和网页 75-view-live.js 的 dialBeep 一致。 */
            let pairs: [(Double, Double)] = [
                (697, 1209), (697, 1336), (697, 1477),
                (770, 1209), (770, 1336), (770, 1477),
                (852, 1209), (852, 1336), (852, 1477),
                (941, 1336),
            ]
            for (f1, f2) in pairs {
                toneBuffers["\(Int(f1))-\(Int(f2))"] = NativeAgent.dtmfBuffer(fmt, f1, f2)
            }
        }
        guard let engine = toneEngine, let node = toneNode else { return }
        if !engine.isRunning {
            do {
                try engine.start()
            } catch {
                /* 会话还没活（例如刚被 WebKit 收掉）：重新激活再点一次。 */
                activateSession()
                guard (try? engine.start()) != nil else { return }
            }
        }
        if !node.isPlaying { node.play() }
    }

    /// 会话被打断结束、或者刚挂断之后，把引擎重新拉起来。本来就在跑就什么都不做。
    private func reactivateTones() {
        if toneEngine?.isRunning == true {
            if toneNode?.isPlaying != true { toneNode?.play() }
            return
        }
        activateSession()
        prepareTones()
    }

    /// 对着会话钉一遍参数，跟 AppDelegate 启动时那一份完全一致。
    private func activateSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try? session.setActive(true)
    }

    /// 两个正弦叠加成 130ms 的 16k 单声道浮点 buffer（预渲染，不落盘）。
    /// 频率、包络、峰值都照网页那段 Web Audio。
    private static func dtmfBuffer(_ fmt: AVAudioFormat, _ f1: Double, _ f2: Double) -> AVAudioPCMBuffer? {
        let rate = fmt.sampleRate
        let total = AVAudioFrameCount(rate * 0.13)
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: total),
              let ch = buf.floatChannelData?[0] else { return nil }
        buf.frameLength = total
        for i in 0..<Int(total) {
            let t = Double(i) / rate
            /* 和网页的 GainNode 一致：0.0001 →(10ms) 0.06 →(90ms) →(120ms) 0.0001。
               这里用直线代替指数，耳朵听不出差别，少一段 exp。 */
            let env: Double
            if t < 0.01      { env = 0.0001 + (0.06 - 0.0001) * (t / 0.01) }
            else if t < 0.09 { env = 0.06 }
            else if t < 0.12 { env = 0.06 * (1 - (t - 0.09) / 0.03) }
            else             { env = 0 }
            let v = env * (sin(2 * .pi * f1 * t) + sin(2 * .pi * f2 * t))
            ch[i] = Float(max(-1, min(1, v)))
        }
        return buf
    }

    fileprivate func pushPCM(_ data: Data) {
        audio?.push(data)
    }

    fileprivate func clientClosed() {
        hangUp(why: "客户端断开")
    }

    private func finish(_ reply: @escaping (Any?, String?) -> Void, id: Int, error: Error?) {
        var m: [String: Any] = ["id": id, "ok": error == nil]
        if let error { m["message"] = error.localizedDescription }
        let send = { reply(m, nil) }
        if Thread.isMainThread { send() } else { DispatchQueue.main.async(execute: send) }
    }

    // MARK: - collect_pcm

    /// 字段名和值全部照抓包。EndPointsAdditionalProp 是个空对象，但不能省 ——
    /// 抓包里它在，缺字段和空对象在服务端可能不是一回事。
    private static func makeCollectData(endpoints: [String], hashKey: String) -> [String: Any] {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyMMddHHmmss"
        fmt.timeZone = .current
        return [
            "AudioBlockSize": AudioSender.pcmBytes,
            "AudioQuality": 16,
            "EndPointsAdditionalProp": [String: String](),
            "EndPointsList": endpoints.joined(separator: ","),
            "HashKey": hashKey,
            "TaskID": newTaskID(),
            "TaskName": "声卡_" + fmt.string(from: Date()),
            "TaskPriority": 50,
            /* 播放音量，0–100。原来照抓包写死 5 —— 那是抓包那台官方客户端
               当时的音量，不是协议常量；结果推出去的流只有 5%，喇叭上几乎
               听不见（2026-10-17 用户实测，对讲和在线播放都小得离谱，Go 版
               代理同病）。用户定的是推满：100。 */
            "Volume": 100,
        ]
    }

    /// 照厂商的形状：{32 位大写十六进制}，带花括号。
    private static func newTaskID() -> String {
        let hex = UUID().uuidString.replacingOccurrences(of: "-", with: "").uppercased()
        return "{" + hex + "}"
    }

    // MARK: - 注入脚本

    /// document start 注入。只换回环地址上的 WebSocket —— 学校那条状态连接
    /// （ws://学校IP:51330）还是原生的，一个字节都不碰。
    static let shimScript = #"""
    (function () {
      if (window.__ITC_NATIVE_AGENT) return;
      window.__ITC_NATIVE_AGENT = true;
      var Original = window.WebSocket;
      var sockets = [];

      function isLoopback(url) {
        try {
          var u = new URL(url, window.location.href);
          var h = (u.hostname || "").toLowerCase();
          return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
        } catch (e) { return false; }
      }

      function toBase64(bytes) {
        var out = "", chunk = 0x8000;
        for (var i = 0; i < bytes.length; i += chunk) {
          out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(out);
      }

      class NativeWebSocket extends EventTarget {
        constructor(url, protocols) {
          super();
          this.url = String(url);
          this.readyState = 0;
          this.binaryType = "arraybuffer";
          this.onopen = null;
          this.onmessage = null;
          this.onerror = null;
          this.onclose = null;
          this._protocols = protocols;
          sockets.push(this);
          var self = this;
          /* 面板在 new 之后才挂 onopen，不能同步触发。 */
          setTimeout(function () {
            if (self.readyState !== 0) return;
            self.readyState = 1;
            self._emit("open", new Event("open"));
          }, 0);
        }

        _emit(type, ev) {
          var h = this["on" + type];
          if (typeof h === "function") {
            try { h.call(this, ev); } catch (e) { setTimeout(function () { throw e; }, 0); }
          }
          this.dispatchEvent(ev);
        }

        send(data) {
          if (this.readyState !== 1) {
            throw new Error("WebSocket is not open: readyState " + this.readyState);
          }
          var handlers = window.webkit && window.webkit.messageHandlers;
          if (!handlers) return;
          if (typeof data === "string") {
            var msg;
            try { msg = JSON.parse(data); } catch (e) { return; }
            var self = this;
            try {
              handlers.itcAgentCmd.postMessage(msg).then(function (rep) {
                if (self.readyState !== 1 || !rep) return;
                self._emit("message", new MessageEvent("message", { data: JSON.stringify(rep) }));
              }).catch(function () {
                self._emit("error", new Event("error"));
              });
            } catch (e) {
              self._emit("error", new Event("error"));
            }
            return;
          }
          var bytes;
          if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
          else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          } else return;
          try { handlers.itcAgentPcm.postMessage(toBase64(bytes)); } catch (e) {}
        }

        close() {
          if (this.readyState >= 2) return;
          this.readyState = 2;
          try { window.webkit.messageHandlers.itcAgentClose.postMessage(1); } catch (e) {}
          var self = this;
          setTimeout(function () { self._drop(1000, true); }, 0);
        }

        _drop(code, clean) {
          if (this.readyState >= 3) return;
          var i = sockets.indexOf(this);
          if (i >= 0) sockets.splice(i, 1);
          this.readyState = 3;
          this._emit("close", new CloseEvent("close", { code: code, reason: "", wasClean: !!clean }));
        }
      }

      NativeWebSocket.CONNECTING = 0;
      NativeWebSocket.OPEN = 1;
      NativeWebSocket.CLOSING = 2;
      NativeWebSocket.CLOSED = 3;

      function BridgedWebSocket(url, protocols) {
        if (isLoopback(url)) return new NativeWebSocket(url, protocols);
        return new Original(url, protocols);
      }
      BridgedWebSocket.CONNECTING = 0;
      BridgedWebSocket.OPEN = 1;
      BridgedWebSocket.CLOSING = 2;
      BridgedWebSocket.CLOSED = 3;
      BridgedWebSocket.prototype = Original.prototype;
      window.WebSocket = BridgedWebSocket;

      /* 原生这一层要收摊时（服务器断了 / 进后台），让页面看见 socket 关闭，
         它自己的 onclose 会把「正在对讲」「正在播放」都收回 idle。 */
      window.__itcNativeDrop = function () {
        sockets.slice().forEach(function (s) { s._drop(1006, false); });
      };

      window.addEventListener("pagehide", function () {
        try { window.webkit.messageHandlers.itcAgentClose.postMessage(1); } catch (e) {}
      });
    })();
    """#
}

// MARK: - 消息处理器

/// 命令：带回复的处理器（JS 侧 `postMessage` 回来的 Promise）。
final class CommandHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var agent: NativeAgent?

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let agent else {
            replyHandler(["id": 0, "ok": false, "message": "内置播放代理已释放"], nil)
            return
        }
        agent.handleCommand(message.body, reply: replyHandler)
    }
}

/// 二进制 PCM 和「页面关了」：不需要回复。
final class DataHandler: NSObject, WKScriptMessageHandler {
    weak var agent: NativeAgent?

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let agent else { return }
        switch message.name {
        case "itcAgentPcm":
            if let text = message.body as? String, let data = Data(base64Encoded: text) {
                agent.pushPCM(data)
            }
        case "itcAgentClose":
            agent.clientClosed()
        default:
            break
        }
    }
}
