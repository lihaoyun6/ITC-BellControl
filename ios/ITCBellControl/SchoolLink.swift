import Foundation

/// 对广播服务器那半边。一条长连接，报文是 JSON 文本帧，外面套同一层壳：
///
///     {actioncode, company:"BL", data:{…}, result:0, return_message:"", token:<JWT>}
///
/// 代理自己不登录 —— 面板那条终端状态连接也从来没发过 c2ls_user_login，它把
/// REST 登录拿到的 JWT 直接塞在 token 字段里就通了。这里一样：JWT 由网页在 call
/// 命令里递过来，App 不碰口令、不落盘。
///
/// 一次呼叫是三条报文，顺序不能反：
///   1. collect_pcm   开一路采集任务，HashKey 指着我们那条 UDP 套接字
///   2. stop_task     停掉它
///   3. unsubscribe_remote_task   退订，把这条任务从服务器上摘干净
final class SchoolLink: NSObject {
    private let queue = DispatchQueue(label: "itc.school-link")
    private var session: URLSession!
    private var ws: URLSessionWebSocketTask?
    private var isOpen = false
    private var openWaiters: [(Error?) -> Void] = []
    private var ackWaiter: ((Error?) -> Void)?
    private var pingTimer: DispatchSourceTimer?
    private var currentURL = ""
    private var currentToken = ""

    /// 连接断掉时喊一声。不喊的话这边还会以为在通话，操作员屏幕上写着
    /// 「正在讲话」，其实早断了。
    var onDrop: (() -> Void)?

    private static let collectTimeout: TimeInterval = 5
    private static let keepAlive: TimeInterval = 2

    override init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        /* 对讲的控制通道跟着 App 的代理走（UDP 音频本身没法代理，见
           ProxySettingsView 底下的说明）。 */
        if #available(iOS 17.0, *), let proxy = ProxyStore.shared.makeConfiguration() {
            config.proxyConfigurations = [proxy]
        }
        super.init()
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    deinit {
        session.invalidateAndCancel()
    }

    // MARK: - 连接

    /// 按需连上，并且认地址和令牌：换了服务器或换了 JWT 就重连一条，没换就接着用。
    /// 省掉的是「每次呼叫都重新握手 + 重新登录」这一趟。
    func ensure(url: String, token: String, completion: @escaping (Error?) -> Void) {
        queue.async {
            if self.ws != nil, self.isOpen, self.currentURL == url, self.currentToken == token {
                self.onMain { completion(nil) }
                return
            }
            self.dropLocked()

            guard let u = URL(string: url), let scheme = u.scheme?.lowercased(),
                  scheme == "ws" || scheme == "wss" else {
                self.onMain { completion(AgentError("对讲地址无效（\(url)）")) }
                return
            }

            let task = self.session.webSocketTask(with: u)
            self.ws = task
            self.currentURL = url
            self.currentToken = token
            self.isOpen = false

            var fired = false
            self.openWaiters.append { err in
                if fired { return }
                fired = true
                self.onMain { completion(err) }
            }

            self.startPingLocked()
            task.resume()
            self.armReceiveLocked(task)

            /* 连学校的时间要比 collect 的 5 秒短：面板等 call 一共 8 秒，
               2.5 + 5 还在它那条线里面，操作员看到的才是具体原因。 */
            self.queue.asyncAfter(deadline: .now() + 2.5) {
                guard task === self.ws, !self.isOpen else { return }
                self.failLocked(AgentError("连不上打铃服务器"), notifyDrop: false)
            }
        }
    }

    /// 发 collect_pcm 并等应答。等到应答才算接通 —— 面板在 call 回来之后就让
    /// 操作员开口了，报早了等于让人对着一条根本没建起来的任务说话。
    func startCollect(token: String,
                      data: [String: Any],
                      completion: @escaping (Error?) -> Void) {
        queue.async {
            guard let task = self.ws, self.isOpen else {
                self.onMain { completion(AgentError("尚未连接打铃服务器")) }
                return
            }
            self.finishAckLocked(AgentError("新呼叫已取代上一通"))

            var fired = false
            self.ackWaiter = { err in
                if fired { return }
                fired = true
                self.onMain { completion(err) }
            }

            guard let text = Self.envelope(actioncode: "c2ls_local_soundcard_collect_pcm",
                                           token: token, data: data) else {
                self.finishAckLocked(AgentError("collect_pcm 报文编码失败"))
                return
            }
            task.send(.string(text)) { [weak self] err in
                guard let self, let err else { return }
                self.queue.async { self.finishAckLocked(err) }
            }
            self.queue.asyncAfter(deadline: .now() + Self.collectTimeout) {
                self.finishAckLocked(AgentError("服务器未在 \(Int(Self.collectTimeout)) 秒内应答"))
            }
        }
    }

    /// 收摊：两条报文各发一次，不等应答。挂断这件事必须立刻办成 —— 人已经松手了，
    /// 这时候还卡着等服务器回话，只会让「挂了但还在响」多持续几秒。
    func stop(token: String, taskID: String) {
        queue.async {
            guard let task = self.ws, self.isOpen else { return }
            let data: [String: Any] = ["TaskID": taskID]
            for actioncode in ["c2ls_stop_task", "c2ls_unsubscribe_remote_task"] {
                guard let text = Self.envelope(actioncode: actioncode, token: token, data: data) else { continue }
                task.send(.string(text)) { _ in }
            }
        }
    }

    func close() {
        queue.async {
            self.dropLocked()
        }
    }

    // MARK: - 接收

    private func armReceiveLocked(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard task === self.ws else { return }
                switch result {
                case .failure(let err):
                    self.failLocked(err, notifyDrop: true)
                case .success(let message):
                    if case .string(let text) = message {
                        self.handleTextLocked(text)
                    }
                    self.armReceiveLocked(task)
                }
            }
        }
    }

    private func handleTextLocked(_ text: String) {
        guard let body = text.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else {
            return
        }
        guard (obj["actioncode"] as? String) == "ls2c_local_soundcard_collect_pcm" else {
            return /* 在线状态那类推送和我们这条任务无关 */
        }
        let result = (obj["result"] as? NSNumber)?.intValue ?? -1
        if result == 200 {
            finishAckLocked(nil)
            return
        }
        let message = obj["return_message"] as? String ?? ""
        finishAckLocked(AgentError(message.isEmpty
                                   ? "服务器拒绝该任务（result=\(result)）"
                                   : "服务器拒绝该任务：\(message)"))
    }

    private func finishAckLocked(_ error: Error?) {
        guard let waiter = ackWaiter else { return }
        ackWaiter = nil
        waiter(error)
    }

    // MARK: - 断开

    /// 把当前连接收掉。**不触发 onDrop** —— 这是我们自己要换掉的，不是半路断了。
    private func dropLocked() {
        if let task = ws {
            ws = nil
            isOpen = false
            task.cancel(with: .goingAway, reason: nil)
        }
        isOpen = false
        pingTimer?.cancel()
        pingTimer = nil
        let waiters = openWaiters
        openWaiters = []
        waiters.forEach { $0(AgentError("打铃服务器连接已断开")) }
        finishAckLocked(AgentError("打铃服务器连接已断开"))
    }

    private func failLocked(_ error: Error, notifyDrop: Bool) {
        let wasOpen = isOpen
        ws?.cancel(with: .goingAway, reason: nil)
        ws = nil
        isOpen = false
        pingTimer?.cancel()
        pingTimer = nil

        let waiters = openWaiters
        openWaiters = []
        waiters.forEach { $0(error) }
        finishAckLocked(error)

        if notifyDrop && wasOpen {
            let cb = onDrop
            DispatchQueue.main.async { cb?() }
        }
    }

    private func startPingLocked() {
        pingTimer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + Self.keepAlive,
                   repeating: Self.keepAlive,
                   leeway: .milliseconds(200))
        t.setEventHandler { [weak self] in
            guard let self, let task = self.ws else { return }
            task.sendPing { [weak self] err in
                guard let self, let err else { return }
                self.queue.async {
                    guard task === self.ws else { return }
                    self.failLocked(err, notifyDrop: true)
                }
            }
        }
        t.resume()
        pingTimer = t
    }

    // MARK: - 报文

    private static func envelope(actioncode: String, token: String, data: [String: Any]) -> String? {
        let env: [String: Any] = [
            "actioncode": actioncode,
            "company": "BL",
            "data": data,
            "result": 0,
            "return_message": "",
            "token": token,
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: env) else { return nil }
        return String(data: body, encoding: .utf8)
    }

    private func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension SchoolLink: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        queue.async {
            guard webSocketTask === self.ws else { return }
            self.isOpen = true
            let waiters = self.openWaiters
            self.openWaiters = []
            waiters.forEach { $0(nil) }
        }
    }

    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                    reason: Data?) {
        queue.async {
            guard webSocketTask === self.ws else { return }
            self.failLocked(AgentError("打铃服务器连接已断开"), notifyDrop: true)
        }
    }
}
