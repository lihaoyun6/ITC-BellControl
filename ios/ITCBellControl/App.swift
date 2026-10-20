import SwiftUI
import AVFoundation

@main
struct ITCBellControlApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            WebScreen().ignoresSafeArea()
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    /* 把音频会话按「要录音」配好并激活。App 里凡是要出声的地方（提示音、
       试听）都靠它；系统打断（来电、Siri、别的 App 抢占）之后会话会停，
       不重新激活的话网页和原生播放都会静悄悄地不出声。 */
    func activateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try? session.setActive(true)
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        /* 这个 app 只服务面板一件事：音频会话一开始就按「要录音」配好。
           对讲那一路是麦克风 → 网页 → play-agent，所以必须是 playAndRecord；
           defaultToSpeaker 让提示音和播放默认走扬声器（不然插过耳机之后
           声音会留在听筒上，听起来像没声）。 */
        activateAudioSession()

        /* 打断结束（挂掉电话、Siri 走了）之后把会话接回来。 */
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
                                               object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
            self?.activateAudioSession()
        }

        /* 系统麦克风授权：WKWebView 自己只会问 web 层那一道（见 WebViewController
           的 WKUIDelegate），app 这一道得我们自己问，不然 getUserMedia 拿不到流。 */
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission { _ in }
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { _ in }
        }
        return true
    }

    /* 从后台回来、或者被别的 App 抢过一轮之后，会话可能已经不在激活状态。 */
    func applicationDidBecomeActive(_ application: UIApplication) {
        activateAudioSession()
    }
}
