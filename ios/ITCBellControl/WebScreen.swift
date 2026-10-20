import SwiftUI
import WebKit

struct WebScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController {
        WebViewController()
    }
    func updateUIViewController(_ uiViewController: WebViewController, context: Context) {}
}
