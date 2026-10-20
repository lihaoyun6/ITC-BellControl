import Foundation
import WebKit

/// 网页 → 原生：只做一件事，打开代理设置弹窗。
/// 网页那边不传参数，也不等回复；当前代理状态是用注入的 __ITC_PROXY 读的。
final class ProxyBridge: NSObject, WKScriptMessageHandler {
    weak var controller: WebViewController?

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "itcProxyOpen" else { return }
        DispatchQueue.main.async { [weak controller] in
            controller?.presentProxySettings()
        }
    }
}
