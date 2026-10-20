import WebKit
import ObjectiveC

/// App 的界面缩放。三档：正常 / 放大 / 特大 = 100% / 110% / 120%。
///
/// 网页设置页里的三枚按钮就是这三个值（见 bell-panel/js/20-ui.js）。
/// 应用方式见下面 `WKWebView.setDisplayScale(_:)`。
final class DisplayScaleStore {
    static let shared = DisplayScaleStore()

    private enum Key {
        static let percent = "itc.display.percent"
    }

    private let defaults = UserDefaults.standard
    private init() {}

    static let levels = [100, 110, 120]

    private static func nearest(_ value: Int) -> Int {
        levels.min(by: { abs($0 - value) < abs($1 - value) }) ?? 100
    }

    var percent: Int {
        get {
            let raw = defaults.integer(forKey: Key.percent)
            if raw == 0 { return 100 }
            /* 旧版本是个 100–120 的滑块，存过中间任意一档。取最近的三档之一，
               设置页里那三枚按钮才总有一枚是亮的。 */
            return Self.nearest(raw)
        }
        set {
            defaults.set(Self.nearest(newValue), forKey: Key.percent)
        }
    }

    var scale: CGFloat { CGFloat(percent) / 100 }

    /// 文档开始时注入给网页：设置页据此把当前档位点亮。
    var injectedScript: String {
        "window.__ITC_DISPLAY={percent:\(percent),levels:\(Self.levels)};"
    }
}

extension WKWebView {
    /// 界面缩放用 Safari「aA / 网页缩放」的那套 SPI：`_setViewScale:`。
    ///
    /// 它把页面的最小布局尺寸按比例收窄、再把结果放大铺满屏幕，所以页面是真正的
    /// CSS 布局重排 —— 字、卡片、间距一起按比例变大，可用宽度按比例变窄，和浏览器
    /// 里放大网页一样。公开的 `pageZoom` 是 CSS `zoom` 语义（WebKit bug 213603），
    /// 在 iOS 上只是把整体画面拉大，布局并不会按窄屏重排，正是我们要避免的效果。
    ///
    /// 这是私有接口，App Store 审核过不了；本项目是自签侧载，不受这条限制。
    /// 万一以后系统把它拿掉，退回公开的 `pageZoom`，至少还有放大效果。
    func setDisplayScale(_ scale: CGFloat) {
        let selector = NSSelectorFromString("_setViewScale:")
        guard let method = class_getInstanceMethod(type(of: self), selector) else {
            pageZoom = scale
            return
        }
        typealias SetViewScale = @convention(c) (AnyObject, Selector, Double) -> Void
        let call = unsafeBitCast(method_getImplementation(method), to: SetViewScale.self)
        call(self, selector, Double(scale))
    }
}

/// 网页 → 原生：设置页「界面缩放」点了某一档。message.body 就是百分比
/// （100 / 110 / 120），原生存下来并当场换缩放，不重载页面。
final class DisplayScaleBridge: NSObject, WKScriptMessageHandler {
    weak var controller: WebViewController?

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "itcDisplayScale" else { return }
        let percent = (message.body as? NSNumber)?.intValue ?? 100
        DispatchQueue.main.async { [weak controller] in
            controller?.applyDisplayScale(percent)
        }
    }
}
