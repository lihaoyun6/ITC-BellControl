import Foundation
import Dispatch
import Network
import Security

/// 代理类型。网页那边只认原始字符串（见 ProxyStore.injectedScript）。
enum ProxyKind: String, CaseIterable, Identifiable, Equatable {
    case socks5
    case http
    case fakeTLS = "faketls"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .socks5: return "SOCKS5"
        case .http: return "HTTP"
        case .fakeTLS: return "FakeTLS"
        }
    }
}

/// App 级代理设置。
///
/// 地址、端口、类型、开关都存 UserDefaults —— 这是本机偏好，不跟网页那份
/// localStorage 混在一起（网页版没有代理这个概念）。每次建 WebView 之前读一次，
/// 改完设置由 WebViewController 重建页面，让新的代理配置从第一条请求起就生效。
final class ProxyStore {
    static let shared = ProxyStore()

    private enum Key {
        static let enabled = "itc.proxy.enabled"
        static let kind = "itc.proxy.kind"
        static let host = "itc.proxy.host"
        static let port = "itc.proxy.port"
        static let auth = "itc.proxy.auth"
        static let username = "itc.proxy.username"
        static let password = "itc.proxy.password"
    }

    private let defaults = UserDefaults.standard
    private init() {}

    var enabled: Bool {
        get { defaults.bool(forKey: Key.enabled) }
        set { defaults.set(newValue, forKey: Key.enabled) }
    }

    var kind: ProxyKind {
        get { ProxyKind(rawValue: defaults.string(forKey: Key.kind) ?? "") ?? .socks5 }
        set { defaults.set(newValue.rawValue, forKey: Key.kind) }
    }

    var host: String {
        get { defaults.string(forKey: Key.host) ?? "" }
        set { defaults.set(newValue, forKey: Key.host) }
    }

    /// 端口没存过或者存坏了，就回到 SOCKS5 最常见的 1080。
    var port: Int {
        get {
            let p = defaults.integer(forKey: Key.port)
            return (1...65535).contains(p) ? p : 1080
        }
        set { defaults.set(newValue, forKey: Key.port) }
    }

    /// 代理认证。用户名和密码都存 UserDefaults。
    /// 模拟器构建是 ad-hoc 签名、没有 Keychain entitlement，SecItemAdd 会静默
    /// 失败，导致密码存不住；这里用 App 沙盒内的偏好存储。
    var authEnabled: Bool {
        get { defaults.bool(forKey: Key.auth) }
        set { defaults.set(newValue, forKey: Key.auth) }
    }

    var username: String {
        get { defaults.string(forKey: Key.username) ?? "" }
        set { defaults.set(newValue, forKey: Key.username) }
    }

    var password: String {
        get { defaults.string(forKey: Key.password) ?? "" }
        set { defaults.set(newValue, forKey: Key.password) }
    }

    /// WKWebsiteDataStore.proxyConfigurations 是 iOS 17 才有的。
    static var available: Bool {
        if #available(iOS 17.0, *) { return true }
        return false
    }

    /// 生效中的代理。开关关着、地址空着、或者系统版本不够时返回 nil。
    @available(iOS 17.0, *)
    func makeConfiguration() -> ProxyConfiguration? {
        let h = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard enabled, !h.isEmpty, (1...65535).contains(port),
              let p = NWEndpoint.Port(rawValue: UInt16(port)) else { return nil }

        let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(h), port: p)
        var cfg: ProxyConfiguration
        switch kind {
        case .socks5:
            cfg = ProxyConfiguration(socksv5Proxy: endpoint)
        case .http:
            cfg = ProxyConfiguration(httpCONNECTProxy: endpoint)
        case .fakeTLS:
            /* FakeTLS = HTTP CONNECT 外面套一层 TLS。SOCKS5 那套 API 没有
               TLS 选项；服务端证书是启动时生成的自签证书，这里只加密、不校验。 */
            let options = NWProtocolTLS.Options()
            h.withCString {
                sec_protocol_options_set_tls_server_name(options.securityProtocolOptions, $0)
            }
            sec_protocol_options_set_verify_block(options.securityProtocolOptions, { _, _, complete in
                complete(true)
            }, DispatchQueue.global())
            cfg = ProxyConfiguration(httpCONNECTProxy: endpoint, tlsOptions: options)
        }
        /* 面板本体来自进程内的 127.0.0.1；不排除的话它也会被塞进代理。 */
        cfg.excludedDomains = ["127.0.0.1", "localhost", "::1"]
        let user = username.trimmingCharacters(in: .whitespacesAndNewlines)
        if authEnabled, !user.isEmpty {
            cfg.applyCredential(username: user, password: password)
        }
        return cfg
    }

    /// 文档开始时注入给网页看的当前状态（设置页那行说明用）。
    /// 只读、不含任何凭据 —— 现在也没有凭据字段。
    var injectedScript: String {
        let obj: [String: Any] = [
            "available": Self.available,
            "enabled": enabled,
            "type": kind.rawValue,
            "host": host,
            "port": port,
        ]
        let json = (try? JSONSerialization.data(withJSONObject: obj))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.__ITC_PROXY = \(json);"
    }

    /// 用来判断「这次保存有没有改变生效配置」，没变就不用重建页面。
    struct Snapshot: Equatable {
        var enabled: Bool
        var kind: ProxyKind
        var host: String
        var port: Int
        var authEnabled: Bool
        var username: String
        var password: String
    }

    var snapshot: Snapshot {
        Snapshot(enabled: enabled, kind: kind, host: host, port: port,
                 authEnabled: authEnabled, username: username, password: password)
    }
}
