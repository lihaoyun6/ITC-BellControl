import Foundation
import Network

/// 只在 127.0.0.1 上伺服 .app 里那份 bell-panel/ 的小 HTTP 服务器。
///
/// 为什么要起服务器而不是 file://：iOS 只在「安全上下文」里给麦克风，
/// 而 http://127.0.0.1 和 https 一样被算作 potentially trustworthy origin，
/// file:// 不是。端口**写死**同样有原因：WKWebView 的 localStorage 按
/// origin（含端口）隔离，端口一变，面板里存的服务器地址、登录令牌和偏好就全丢了。
final class LocalWebServer {
    static let port: UInt16 = 17818

    private let root: URL
    private let queue = DispatchQueue(label: "itc.local-web-server")
    private var listener: NWListener?

    var onReady: (() -> Void)?
    var onFailure: ((Error) -> Void)?

    init(root: URL) {
        self.root = root
    }

    func start() {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host("127.0.0.1"),
            port: NWEndpoint.Port(rawValue: Self.port)!)

        do {
            let l = try NWListener(using: params)
            l.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    DispatchQueue.main.async { self?.onReady?() }
                case .failed(let err):
                    DispatchQueue.main.async { self?.onFailure?(err) }
                case .waiting(let err):
                    /* 端口被别的进程占住时 listener 会停在 waiting。直接报错，
                       别让页面一直转圈。 */
                    l.cancel()
                    DispatchQueue.main.async { self?.onFailure?(err) }
                default:
                    break
                }
            }
            l.newConnectionHandler = { [weak self] conn in
                self?.accept(conn)
            }
            l.start(queue: queue)
            listener = l
        } catch {
            onFailure?(error)
        }
    }

    // MARK: - 连接与请求

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        read(conn, buffer: Data())
    }

    private func read(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { conn.cancel(); return }
            var buf = buffer
            if let data { buf.append(data) }

            if let headEnd = buf.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(data: buf.subdata(in: 0..<headEnd.lowerBound), encoding: .utf8) ?? ""
                self.respond(conn, head: head)
                return
            }
            if error != nil || isComplete || buf.count > 1_000_000 {
                conn.cancel()
                return
            }
            self.read(conn, buffer: buf)
        }
    }

    private func respond(_ conn: NWConnection, head: String) {
        let requestLine = head.components(separatedBy: "\r\n").first ?? ""
        let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 2 else {
            return send(conn, status: "400 Bad Request", type: "text/plain; charset=utf-8",
                        body: Data("Bad Request".utf8))
        }
        let method = String(parts[0])
        guard method == "GET" || method == "HEAD" else {
            return send(conn, status: "405 Method Not Allowed", type: "text/plain; charset=utf-8",
                        body: Data("Method Not Allowed".utf8))
        }

        var path = String(parts[1])
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }

        guard let file = fileURL(for: path), let data = try? Data(contentsOf: file) else {
            return send(conn, status: "404 Not Found", type: "text/plain; charset=utf-8",
                        body: Data("Not Found".utf8))
        }
        send(conn, status: "200 OK", type: mimeType(for: file.pathExtension),
             body: data, headOnly: method == "HEAD")
    }

    private func send(_ conn: NWConnection, status: String, type: String,
                      body: Data, headOnly: Bool = false) {
        var head = "HTTP/1.1 \(status)\r\n"
        head += "Content-Type: \(type)\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Cache-Control: no-store\r\n"
        head += "Accept-Ranges: none\r\n"
        head += "Connection: close\r\n\r\n"
        var out = Data(head.utf8)
        if !headOnly { out.append(body) }
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }

    // MARK: - 路径与类型

    private func fileURL(for path: String) -> URL? {
        var rel = (path.removingPercentEncoding ?? path)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if rel.isEmpty { rel = "index.html" }
        guard !rel.split(separator: "/").contains("..") else { return nil }

        let rootPath = root.standardizedFileURL.path
        var url = root.appendingPathComponent(rel)
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
            url = url.appendingPathComponent("index.html")
        }
        guard url.standardizedFileURL.path.hasPrefix(rootPath),
              FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "css":         return "text/css; charset=utf-8"
        case "js", "mjs":   return "text/javascript; charset=utf-8"
        case "json":        return "application/json; charset=utf-8"
        case "mp3":         return "audio/mpeg"
        case "wav":         return "audio/wav"
        case "m4a":         return "audio/mp4"
        case "ico":         return "image/x-icon"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg":         return "image/svg+xml"
        case "woff2":       return "font/woff2"
        case "zip":         return "application/zip"
        case "txt", "md":   return "text/plain; charset=utf-8"
        default:            return "application/octet-stream"
        }
    }
}
