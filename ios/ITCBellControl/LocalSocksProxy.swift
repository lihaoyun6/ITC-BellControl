import Foundation
import Darwin
import Network
import Security
import Dispatch

/// FakeTLS 模式下给 WKWebView 用的本机桥。
///
/// WebKit 有个已知问题：`WKWebsiteDataStore.proxyConfigurations` 里带的 TLS
/// 选项不会传到网络进程，`sec_protocol_options_set_verify_block` 永远不触发，
/// 自签证书被默认校验拒绝，服务端只看到 `tls: unknown certificate`。URLSession
/// 没有这个问题，但网页的 fetch/WebSocket 只能走 WebView。
///
/// 所以这里在 127.0.0.1 起一个普通 SOCKS5：WebView 连它（SOCKS5 不涉及 TLS），
/// 每个 CONNECT 再由 Network.framework 建 TLS 到远端 FakeTLS-Proxy，证书校验
/// 放行后双向转发。WebView 眼里只是一个本机 SOCKS5，不再碰到 WebKit 的 TLS
/// 代理缺陷。
///
/// 监听用 BSD socket 而不是 NWListener：NWListener 会绑所有网卡，而且在这个
/// 环境下启动直接 EINVAL；BSD socket 能明确绑到回环，端口也能同步拿到。
final class LocalSocksProxy {
    static let shared = LocalSocksProxy()

    private struct Config: Equatable {
        var host: String
        var port: UInt16
        var username: String
        var password: String
    }

    /// 一条本机连接。fd 可能被多个回调路径关闭，只允许关一次。
    private final class Client {
        let fd: Int32
        private let lock = NSLock()
        private var closed = false

        init(fd: Int32) { self.fd = fd }

        func closeOnce() {
            lock.lock()
            if closed {
                lock.unlock()
                return
            }
            closed = true
            lock.unlock()
            close(fd)
        }
    }

    private let lock = NSLock()
    private var listenFD: Int32 = -1
    private var listenPort: UInt16?
    private var config = Config(host: "", port: 0, username: "", password: "")

    private init() {}

    /// 启动或更新本机桥，返回 WebView 要用的 SOCKS5 端点。
    @available(iOS 17.0, *)
    func endpoint(host: String, port: UInt16, username: String, password: String) -> NWEndpoint? {
        lock.lock()
        defer { lock.unlock() }

        config = Config(host: host, port: port, username: username, password: password)
        if listenFD >= 0, let p = listenPort, let ep = NWEndpoint.Port(rawValue: p) {
            return .hostPort(host: "127.0.0.1", port: ep)
        }

        guard let fd = Self.makeLoopbackListener(), let p = Self.localPort(of: fd),
              let ep = NWEndpoint.Port(rawValue: p) else {
            NSLog("[LocalSocksProxy] cannot bind loopback listener")
            return nil
        }
        listenFD = fd
        listenPort = p
        Thread.detachNewThread { [weak self] in self?.acceptLoop(fd) }
        return .hostPort(host: "127.0.0.1", port: ep)
    }

    private func currentConfig() -> Config {
        lock.lock()
        defer { lock.unlock() }
        return config
    }

    // MARK: - 监听与 SOCKS5

    private func acceptLoop(_ fd: Int32) {
        while true {
            var addr = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let clientFD = withUnsafeMutablePointer(to: &addr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    accept(fd, $0, &len)
                }
            }
            if clientFD < 0 {
                if errno == EINTR { continue }
                return
            }
            let cfg = currentConfig()
            Thread.detachNewThread { [weak self] in
                self?.handleClient(Client(fd: clientFD), config: cfg)
            }
        }
    }

    private func handleClient(_ client: Client, config cfg: Config) {
        let fd = client.fd

        guard let head = readExactly(fd, 2), byte(head, 0) == 5 else {
            client.closeOnce()
            return
        }
        let count = Int(byte(head, 1))
        guard let methods = readExactly(fd, count), methods.contains(0) else {
            client.closeOnce()
            return
        }
        guard writeAll(fd, Data([5, 0])) else {
            client.closeOnce()
            return
        }

        guard let request = readExactly(fd, 4),
              byte(request, 0) == 5,
              byte(request, 1) == 1 else {
            replyFailure(client)
            return
        }

        var host = ""
        var port: UInt16 = 0
        switch byte(request, 3) {
        case 1:
            guard let data = readExactly(fd, 6) else { client.closeOnce(); return }
            let b = [UInt8](data)
            host = "\(b[0]).\(b[1]).\(b[2]).\(b[3])"
            port = UInt16(b[4]) << 8 | UInt16(b[5])
        case 3:
            guard let lengthData = readExactly(fd, 1) else { client.closeOnce(); return }
            let length = Int(byte(lengthData, 0))
            guard let data = readExactly(fd, length + 2) else { client.closeOnce(); return }
            let b = [UInt8](data)
            host = String(decoding: b[0..<length], as: UTF8.self)
            port = UInt16(b[length]) << 8 | UInt16(b[length + 1])
        case 4:
            guard let data = readExactly(fd, 18) else { client.closeOnce(); return }
            let b = [UInt8](data)
            var parts: [String] = []
            for i in stride(from: 0, to: 16, by: 2) {
                parts.append(String(format: "%x", UInt16(b[i]) << 8 | UInt16(b[i + 1])))
            }
            host = "[" + parts.joined(separator: ":") + "]"
            port = UInt16(b[16]) << 8 | UInt16(b[17])
        default:
            replyFailure(client)
            return
        }

        connectRemote(client: client, target: "\(host):\(port)", config: cfg)
    }

    // MARK: - 远端 TLS

    private func connectRemote(client: Client, target: String, config cfg: Config) {
        guard !cfg.host.isEmpty, let remotePort = NWEndpoint.Port(rawValue: cfg.port) else {
            replyFailure(client)
            return
        }

        let queue = DispatchQueue(label: "itc.local-socks.remote")
        let tls = NWProtocolTLS.Options()
        cfg.host.withCString {
            sec_protocol_options_set_tls_server_name(tls.securityProtocolOptions, $0)
        }
        sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, _, complete in
            complete(true)
        }, queue)

        let remote = NWConnection(host: NWEndpoint.Host(cfg.host),
                                  port: remotePort,
                                  using: NWParameters(tls: tls, tcp: NWProtocolTCP.Options()))

        remote.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                remote.stateUpdateHandler = nil
                self?.sendConnect(remote: remote, target: target, client: client, config: cfg)
            case .failed, .cancelled:
                self?.replyFailure(client)
            default:
                break
            }
        }
        remote.start(queue: queue)
    }

    private func sendConnect(remote: NWConnection, target: String, client: Client, config cfg: Config) {
        var request = "CONNECT \(target) HTTP/1.1\r\nHost: \(target)\r\n"
        if !cfg.username.isEmpty {
            let token = Data("\(cfg.username):\(cfg.password)".utf8).base64EncodedString()
            request += "Proxy-Authorization: Basic \(token)\r\n"
        }
        request += "\r\n"

        remote.send(content: Data(request.utf8), completion: .contentProcessed { [weak self] error in
            guard let self = self, error == nil else {
                self?.replyFailure(client)
                return
            }
            self.readHeader(remote, client: client, buffer: Data())
        })
    }

    private func readHeader(_ remote: NWConnection, client: Client, buffer: Data) {
        let marker = Data("\r\n\r\n".utf8)
        if let range = buffer.range(of: marker) {
            let head = Data(buffer[..<range.upperBound])
            let rest = Data(buffer[range.upperBound...])
            let statusLine = String(decoding: head, as: UTF8.self)
                .split(separator: "\r\n", maxSplits: 1, omittingEmptySubsequences: false)
                .first.map(String.init) ?? ""
            let parts = statusLine.split(separator: " ")
            guard parts.count >= 2, parts[1] == "200" else {
                remote.cancel()
                replyFailure(client)
                return
            }

            /* SOCKS5 成功：BND.ADDR 填 0.0.0.0:0 即可，客户端不关心。 */
            guard writeAll(client.fd, Data([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])) else {
                remote.cancel()
                client.closeOnce()
                return
            }
            if !rest.isEmpty, !writeAll(client.fd, rest) {
                remote.cancel()
                client.closeOnce()
                return
            }
            startRelay(remote: remote, client: client)
            return
        }

        if buffer.count > 16384 {
            remote.cancel()
            replyFailure(client)
            return
        }

        remote.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            var buf = buffer
            if let data = data { buf.append(data) }
            if isComplete || error != nil {
                self.replyFailure(client)
            } else {
                self.readHeader(remote, client: client, buffer: buf)
            }
        }
    }

    // MARK: - 转发

    private func startRelay(remote: NWConnection, client: Client) {
        pumpRemote(remote, client: client)
        Thread.detachNewThread { [weak self] in
            self?.pumpClient(remote: remote, client: client)
        }
    }

    /// 客户端 → 远端。阻塞读 fd，发送完成后再读下一块，天然有背压。
    private func pumpClient(remote: NWConnection, client: Client) {
        var buf = [UInt8](repeating: 0, count: 65536)
        while true {
            let n = read(client.fd, &buf, buf.count)
            if n <= 0 {
                remote.cancel()
                client.closeOnce()
                return
            }
            let data = Data(buf[0..<n])
            let sem = DispatchSemaphore(value: 0)
            remote.send(content: data, completion: .contentProcessed { _ in sem.signal() })
            sem.wait()
        }
    }

    /// 远端 → 客户端。收到 EOF 就半关写端，等客户端自己关。
    private func pumpRemote(_ remote: NWConnection, client: Client) {
        remote.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let data = data, !data.isEmpty {
                if !self.writeAll(client.fd, data) {
                    remote.cancel()
                    client.closeOnce()
                    return
                }
            }
            if isComplete || error != nil {
                shutdown(client.fd, SHUT_WR)
            } else {
                self.pumpRemote(remote, client: client)
            }
        }
    }

    // MARK: - 小工具

    private func byte(_ data: Data, _ offset: Int) -> UInt8 {
        data[data.startIndex + offset]
    }

    private func readExactly(_ fd: Int32, _ count: Int) -> Data? {
        guard count >= 0 else { return nil }
        var out = Data()
        var buf = [UInt8](repeating: 0, count: max(count, 1))
        while out.count < count {
            let n = read(fd, &buf, count - out.count)
            if n <= 0 {
                if n < 0 && errno == EINTR { continue }
                return nil
            }
            out.append(contentsOf: buf[0..<n])
        }
        return out
    }

    @discardableResult
    private func writeAll(_ fd: Int32, _ data: Data) -> Bool {
        var sent = 0
        return data.withUnsafeBytes { raw -> Bool in
            guard let base = raw.baseAddress else { return true }
            while sent < raw.count {
                let n = write(fd, base + sent, raw.count - sent)
                if n <= 0 {
                    if n < 0 && errno == EINTR { continue }
                    return false
                }
                sent += n
            }
            return true
        }
    }

    private func replyFailure(_ client: Client) {
        _ = writeAll(client.fd, Data([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]))
        client.closeOnce()
    }

    private static func makeLoopbackListener() -> Int32? {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }

        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let bound = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0, listen(fd, 16) == 0 else {
            close(fd)
            return nil
        }
        return fd
    }

    private static func localPort(of fd: Int32) -> UInt16? {
        var addr = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let result = withUnsafeMutablePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(fd, $0, &len)
            }
        }
        guard result == 0 else { return nil }
        return UInt16(bigEndian: addr.sin_port)
    }
}
