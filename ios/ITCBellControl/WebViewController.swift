import UIKit
import SwiftUI
import WebKit
import Network

/// 一个只装面板的 WKWebView。页面来自进程内的 LocalWebServer（127.0.0.1），
/// 所以是安全上下文 —— getUserMedia / AudioWorklet 都能用。
final class WebViewController: UIViewController {
    private var webView: WKWebView?
    private var server: LocalWebServer?
    private var agent: NativeAgent?
    private var proxyBridge: ProxyBridge?
    private var displayBridge: DisplayScaleBridge?
    private let errorLabel = UILabel()
    /// 登录状态、面板偏好都在这个持久化 store 里。每次重建 WebView 都复用它，
    /// 代理配置在创建 WebView 之前重新设一遍。
    private let dataStore = WKWebsiteDataStore.default()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        setupErrorLabel()

        guard let root = Bundle.main.resourceURL?.appendingPathComponent("bell-panel"),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            showError("app 里没有找到 bell-panel/ 网页目录，请重新构建。")
            return
        }

        NotificationCenter.default.addObserver(self,
                                               selector: #selector(appDidEnterBackground),
                                               name: UIApplication.didEnterBackgroundNotification,
                                               object: nil)

        buildWebView()

        let server = LocalWebServer(root: root)
        server.onReady = { [weak self] in self?.loadPage() }
        server.onFailure = { [weak self] error in
            self?.showError("本地网页服务启动失败：\(error.localizedDescription)")
        }
        server.start()
        self.server = server
    }

    /// 用当前代理设置造一个新的 WKWebView。
    ///
    /// proxyConfigurations 只在 WebView 发第一条请求之前设才可靠，所以改完代理
    /// 不能只刷新页面，得把整个 WebView（连同配置）重建一次。LocalWebServer
    /// 不动，重建完重新加载同一个回环地址。
    private func buildWebView() {
        webView?.removeFromSuperview()
        agent?.hangUp(why: "页面重新加载")

        if #available(iOS 17.0, *) {
            dataStore.proxyConfigurations = webViewProxyConfigurations()
        }

        let config = WKWebViewConfiguration()
        config.websiteDataStore = dataStore
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        /* 内置播放代理：document start 时把回环地址上的 WebSocket 换成原生桥，
           连广播服务器和发 UDP 都由 App 自己做，iOS 上不再需要外部 play-agent。 */
        let agent = NativeAgent()
        let userContent = config.userContentController
        userContent.addUserScript(WKUserScript(source: NativeAgent.shimScript,
                                               injectionTime: .atDocumentStart,
                                               forMainFrameOnly: true))
        /* 代理状态也在这会儿注入：改完设置整页重载，设置页那行说明自然就新了。 */
        userContent.addUserScript(WKUserScript(source: ProxyStore.shared.injectedScript,
                                               injectionTime: .atDocumentStart,
                                               forMainFrameOnly: true))
        /* 当前界面缩放档位也注进去：设置页那三枚按钮（正常/放大/特大）据此点亮。 */
        userContent.addUserScript(WKUserScript(source: DisplayScaleStore.shared.injectedScript,
                                               injectionTime: .atDocumentStart,
                                               forMainFrameOnly: true))
        userContent.addScriptMessageHandler(agent.commandHandler,
                                            contentWorld: .page,
                                            name: "itcAgentCmd")
        userContent.add(agent.dataHandler, name: "itcAgentPcm")
        userContent.add(agent.dataHandler, name: "itcAgentClose")
        agent.onClientDrop = { [weak self] in
            /* 服务器那头断了：把页面里那条桥接 socket 也关掉，页面自己的
               onclose 会把「正在对讲」收回 idle。 */
            self?.webView?.evaluateJavaScript("window.__itcNativeDrop && window.__itcNativeDrop()")
        }
        self.agent = agent

        /* 网页里的代理齿轮 / 设置页按钮 → 原生弹窗。 */
        let bridge = ProxyBridge()
        bridge.controller = self
        userContent.add(bridge, name: "itcProxyOpen")
        self.proxyBridge = bridge

        /* 设置页的「界面缩放」三档按钮 → 原生。 */
        let displayBridge = DisplayScaleBridge()
        displayBridge.controller = self
        userContent.add(displayBridge, name: "itcDisplayScale")
        self.displayBridge = displayBridge

        let webView = WKWebView(frame: .zero, configuration: config)
        /* 界面缩放（设置页 → 显示大小，见 DisplayScale.swift）：收窄布局视口后
           按比例放大，页面是按 CSS 比例重排的，不是把整体画面拉大。 */
        webView.setDisplayScale(DisplayScaleStore.shared.scale)
        /* WKWebView 默认把安全区算进网页视口：innerHeight 只有 759，内容整体下移
           59pt，屏幕底下平白空出一条。面板自己用 env(safe-area-inset-*) 处理刘海和
           底部横杠，所以这里必须关掉系统的自动内边距。 */
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        /* 双指缩放整个关掉（用户定的）：面板是按安全区排好的，放大只会把控件
           推出屏幕。页面里还有 gesturestart/touch-action 的兜底，这里从根上禁。 */
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        /* 界面缩放之后布局宽度是个小数，按比例放大回来时内容可能比视口多出不到
           1pt —— 手指一推整页就能上下左右挪一点（用户实测）。页面本身是个固定
           高度的壳子，每一页都在自己的滚动区里滚，外层这个 scrollView 不该有
           回弹；关掉回弹，剩下的真实溢出（不到 1pt）也够不成能看出来的位移。 */
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.alwaysBounceVertical = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.underPageBackgroundColor = .systemBackground
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(webView, belowSubview: errorLabel)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        self.webView = webView
    }

    /// WebView 用的代理配置。
    ///
    /// FakeTLS 不能直接把 TLS 选项交给 WKWebView：WebKit 不会把 verify block
    /// 传到网络进程，自签证书会被默认校验拒掉（服务端只看到 unknown certificate）。
    /// 改成让 WebView 连本机 SOCKS5，TLS 由 LocalSocksProxy 用 Network.framework
    /// 自己建立。
    @available(iOS 17.0, *)
    private func webViewProxyConfigurations() -> [ProxyConfiguration] {
        let store = ProxyStore.shared
        let host = store.host.trimmingCharacters(in: .whitespacesAndNewlines)
        if store.enabled, store.kind == .fakeTLS, !host.isEmpty,
           let port = UInt16(exactly: store.port) {
            let user = store.authEnabled
                ? store.username.trimmingCharacters(in: .whitespacesAndNewlines) : ""
            if let endpoint = LocalSocksProxy.shared.endpoint(
                host: host, port: port,
                username: user,
                password: store.authEnabled ? store.password : "") {
                var cfg = ProxyConfiguration(socksv5Proxy: endpoint)
                cfg.excludedDomains = ["127.0.0.1", "localhost", "::1"]
                return [cfg]
            }
            return []
        }

        return ProxyStore.shared.makeConfiguration().map { [$0] } ?? []
    }

    private func loadPage() {
        guard let url = URL(string: "http://127.0.0.1:\(LocalWebServer.port)/") else { return }
        webView?.load(URLRequest(url: url))
    }

    /// 网页按钮和设置页的「设置代理」都落到这里。
    func presentProxySettings() {
        guard presentedViewController == nil else { return }
        let host = UIHostingController(rootView: ProxySettingsView { [weak self] changed in
            guard let self, changed else { return }
            self.rebuildWebViewForProxy()
        })
        host.modalPresentationStyle = .pageSheet
        present(host, animated: true)
    }

    /// 设置页「界面缩放」点了某一档：存下来，当场换缩放（不重载页面）。
    func applyDisplayScale(_ percent: Int) {
        DisplayScaleStore.shared.percent = percent
        webView?.setDisplayScale(DisplayScaleStore.shared.scale)
    }

    private func rebuildWebViewForProxy() {
        guard isViewLoaded else { return }
        UIApplication.shared.isIdleTimerDisabled = false
        buildWebView()
        loadPage()
    }

    private func setupErrorLabel() {
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.font = .systemFont(ofSize: 15)
        errorLabel.textColor = .secondaryLabel
        errorLabel.isHidden = true
        errorLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(errorLabel)
        NSLayoutConstraint.activate([
            errorLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            errorLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            errorLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
        ])
    }

    private func showError(_ text: String) {
        errorLabel.text = text
        errorLabel.isHidden = false
        webView?.isHidden = true
    }

    /// iOS 一进后台就会把计时器挂起，留着只会让服务器上挂一条死任务。
    @objc private func appDidEnterBackground() {
        /* 页面那一趟 `wake` 可能还没跑到就一起被挂起了；回来时别让自动锁屏
           一直关着。 */
        UIApplication.shared.isIdleTimerDisabled = false
        agent?.hangUp(why: "App 进入后台")
        webView?.evaluateJavaScript("window.__itcNativeDrop && window.__itcNativeDrop()")
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

// MARK: - 导航

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        /* 页面要换了：上一页那条对讲已经没有收话的人了。 */
        agent?.hangUp(why: "页面重新加载")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        /* 页面加载完再设一次：视图缩放会跟着导航回到 1。 */
        webView.setDisplayScale(DisplayScaleStore.shared.scale)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        /* 网页进程没了，原生这边还攥着一路 UDP；不挂断服务器上就留一条死任务。 */
        agent?.hangUp(why: "网页进程已终止")
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow, preferences)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "about" || scheme == "data" || scheme == "blob" {
            decisionHandler(.allow, preferences)
            return
        }
        if scheme == "http" || scheme == "https" {
            if url.host == "127.0.0.1" && url.port == Int(LocalWebServer.port) {
                decisionHandler(.allow, preferences)
                return
            }
            /* 面板里的外链（点到的 http(s) 链接、target=_blank）交给 Safari。
               注意 JS 的 fetch/XHR 不走这里，所以广播服务器的 API 请求不受影响。 */
            if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel, preferences)
            return
        }
        decisionHandler(.cancel, preferences)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        /* zip 这类不能直接显示的响应（设置页的「前往下载」）走下载流程，
           别让 WKWebView 把二进制塞进页面把面板顶掉。 */
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }
}

// MARK: - 麦克风授权

extension WebViewController: WKUIDelegate {
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        /* 面板只用到麦克风；摄像头一律拒绝。系统那一层授权在 AppDelegate 里问过了。 */
        decisionHandler(type == .microphone ? .grant : .deny)
    }
}

// MARK: - 下载

extension WebViewController: WKDownloadDelegate {
    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent(suggestedFilename)
        try? FileManager.default.removeItem(at: url)
        completionHandler(url)
    }
}
