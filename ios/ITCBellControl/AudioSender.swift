import Foundation
import Darwin

/// 那 20 字节的头，和「一秒一百包」这件事。
///
/// 网页送来的 PCM（16k / 16 位 / 小端 / 单声道）在这里套上自定义头，用 UDP
/// 发到广播服务器的音频口。头里没有目标终端 —— 发给谁由控制通道那条
/// collect_pcm 的 EndPointsList 决定，服务器按 HashKey 认领这路流。
///
/// 20 字节头（对着 play-agent 的 audio.go 逐字节抄的）：
///
///     偏移  长度  内容
///     0     4     本机 IPv4 四段原值           ← 必须和 UDP 的真实源地址一致
///     4     2     本机源端口（大端）           ← 同上
///     6     2     固定 04 22
///     8     4     序号，从 0 起（大端）
///     12    4     固定 7f ff ff ff
///     16    2     本帧 PCM 字节数 = 320（大端）
///     18    2     自增计数（大端）
///
/// 前 6 个字节和 HashKey 说的是同一件事：这条 UDP 套接字是谁。所以顺序是死的 ——
/// 先建套接字、connect、问出真实 ip:port，才能拼 HashKey 去发 collect_pcm；
/// 写死端口是不行的（每次绑定拿到的都不一样）。
final class AudioSender {
    static let pcmBytes = 320
    private static let pcmPerSecond = 100
    private static let bufMax = pcmBytes * 100

    /// "ip:port"，要塞进 collect_pcm 的 HashKey。
    let hashKey: String

    private let fd: Int32
    private let srcIP: [UInt8]
    private let srcPort: UInt16

    private let queue = DispatchQueue(label: "itc.audio-sender")
    private var timer: DispatchSourceTimer?
    private var buf = Data()
    private var muted = false
    private var seq: UInt32 = 0
    private var counter: UInt16 = 0
    private var stopped = false

    /// 建一条 UDP 套接字指向 target（形如 192.168.1.100:51340），问出它真实的
    /// 本地地址，然后开始按 100 包/秒往外泵。
    ///
    /// 用 connect 而不是只 bind：只有 connect 过的套接字才问得到内核给的那个
    /// 本地 ip:port（未 connect 的 UDP 套接字是 0.0.0.0:0），而那个 ip:port
    /// 正是 HashKey。顺带每次发就不用再填目标地址。
    init(target: String) throws {
        guard let (host, port) = Self.split(target) else {
            throw AgentError("对讲地址无效（\(target)）")
        }

        var hints = addrinfo()
        hints.ai_family = AF_INET
        hints.ai_socktype = SOCK_DGRAM
        var result: UnsafeMutablePointer<addrinfo>?
        let rc = getaddrinfo(host, String(port), &hints, &result)
        guard rc == 0, let info = result else {
            throw AgentError("对讲地址无效（\(target)）：\(String(cString: gai_strerror(rc)))")
        }
        defer { freeaddrinfo(result) }

        let s = socket(AF_INET, SOCK_DGRAM, 0)
        guard s >= 0 else {
            throw AgentError("创建 UDP 套接字失败：\(Self.errnoText())")
        }
        guard connect(s, info.pointee.ai_addr, info.pointee.ai_addrlen) == 0 else {
            let e = Self.errnoText()
            close(s)
            throw AgentError("创建 UDP 套接字失败：\(e)")
        }

        var local = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let ok = withUnsafeMutablePointer(to: &local) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(s, $0, &len)
            }
        }
        guard ok == 0 else {
            let e = Self.errnoText()
            close(s)
            throw AgentError("无法获取本地地址：\(e)")
        }

        let port16 = UInt16(bigEndian: local.sin_port)
        let ip = withUnsafeBytes(of: local.sin_addr.s_addr) { Array($0) }
        guard ip.count == 4, ip.contains(where: { $0 != 0 }) else {
            close(s)
            throw AgentError("本地地址不是 IPv4")
        }

        fd = s
        srcIP = ip
        srcPort = port16
        hashKey = "\(ip[0]).\(ip[1]).\(ip[2]).\(ip[3]):\(port16)"
        startPump()
    }

    /// 收下网页送来的一段 PCM。不走 muted 分支 —— 静音是发送端的事：
    /// 这里停住不动，泵那头照样按 100 包/秒填静音，UDP 流一直是热的，
    /// 服务器不会因为「突然没包了」把这路任务判掉。
    func push(_ data: Data) {
        guard !data.isEmpty else { return }
        queue.async {
            guard !self.stopped, !self.muted else { return }
            self.buf.append(data)
            /* 网页那头比我们快的时候（切后台再回来一口气补发之类），只留最近的
               一秒 —— 老音频晚到不如不到。 */
            if self.buf.count > Self.bufMax {
                self.buf.removeFirst(self.buf.count - Self.bufMax)
            }
        }
    }

    func setMuted(_ on: Bool) {
        queue.async {
            guard !self.stopped else { return }
            self.muted = on
            if on { self.buf.removeAll(keepingCapacity: true) }
        }
    }

    func stop() {
        queue.async {
            guard !self.stopped else { return }
            self.stopped = true
            self.timer?.cancel()
            self.timer = nil
            self.buf.removeAll()
            close(self.fd)
        }
    }

    // MARK: - 泵

    /// 那口钟。不用「每 10ms 醒一次就发一包」那种写法：定时器的分辨率不保证，
    /// 照着 tick 发会一路偏慢，声音就是拖的。这里对着墙上时间算该发第几包了，
    /// 醒了补差额（一次最多补 4 包，免得长时间挂起后一口气爆发）。tick 只是
    /// 「多久来看一眼」，不是节拍本身。
    private func startPump() {
        let start = DispatchTime.now().uptimeNanoseconds
        var sent: Int64 = 0
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + .milliseconds(2),
                   repeating: .milliseconds(2),
                   leeway: .microseconds(500))
        t.setEventHandler { [weak self] in
            guard let self, !self.stopped else { return }
            let elapsed = DispatchTime.now().uptimeNanoseconds - start
            let due = Int64(elapsed / 10_000_000) + 1
            var n = 0
            while n < 4 && sent < due {
                self.sendOne()
                sent += 1
                n += 1
            }
            /* 落后太多（机器睡了、被挂起了）就不追了，直接对齐到当前时刻 ——
               补发一堆过去的声音没有任何意义。 */
            if sent < due { sent = due }
        }
        t.resume()
        timer = t
    }

    /// 发一包。缓冲里有够 320 字节就用它，不够（或被静音了）就发静音 ——
    /// 两种情况合成同一个分支：包的后 320 字节建出来就是全零。
    private func sendOne() {
        var pkt = [UInt8](repeating: 0, count: 20 + Self.pcmBytes)

        if !muted && buf.count >= Self.pcmBytes {
            pkt.withUnsafeMutableBytes { dst in
                buf.copyBytes(to: dst.baseAddress!.advanced(by: 20).assumingMemoryBound(to: UInt8.self),
                              count: Self.pcmBytes)
            }
            buf.removeFirst(Self.pcmBytes)
        }

        putHeader(&pkt, seq: seq, ctr: counter)
        seq &+= 1
        counter &+= 1

        /* 本地网络权限还没被答完、或网线掉了的时候 send 会失败。丢一包不是大事，
           节拍照走 —— 权限一给，下一包就通了。 */
        pkt.withUnsafeBytes { ptr in
            _ = send(fd, ptr.baseAddress, pkt.count, 0)
        }
    }

    private func putHeader(_ h: inout [UInt8], seq: UInt32, ctr: UInt16) {
        h[0] = srcIP[0]; h[1] = srcIP[1]; h[2] = srcIP[2]; h[3] = srcIP[3]
        h[4] = UInt8(srcPort >> 8); h[5] = UInt8(srcPort & 0xff)
        h[6] = 0x04; h[7] = 0x22
        h[8] = UInt8(seq >> 24); h[9] = UInt8((seq >> 16) & 0xff)
        h[10] = UInt8((seq >> 8) & 0xff); h[11] = UInt8(seq & 0xff)
        h[12] = 0x7f; h[13] = 0xff; h[14] = 0xff; h[15] = 0xff
        let n = UInt16(Self.pcmBytes)
        h[16] = UInt8(n >> 8); h[17] = UInt8(n & 0xff)
        h[18] = UInt8(ctr >> 8); h[19] = UInt8(ctr & 0xff)
    }

    // MARK: - 小工具

    private static func split(_ target: String) -> (String, UInt16)? {
        guard let colon = target.lastIndex(of: ":") else { return nil }
        let host = String(target[target.startIndex..<colon])
        let portText = String(target[target.index(after: colon)...])
        guard !host.isEmpty, let port = UInt16(portText), port > 0 else { return nil }
        return (host, port)
    }

    private static func errnoText() -> String {
        String(cString: strerror(errno))
    }
}

/// 原生这一层的错误，只用来把一句话交回网页（和 play-agent 的 error 文案对齐）。
struct AgentError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
