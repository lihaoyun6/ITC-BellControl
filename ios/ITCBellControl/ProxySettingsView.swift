import SwiftUI

/// 原生代理设置弹窗。登录页那枚齿轮和全局设置里的「设置代理」都开它。
///
/// 「通过代理访问服务器」关掉时**不清空**下面的服务器和认证信息 —— 用户只是
/// 暂时禁用，下次打开弹窗还能直接开回来。
struct ProxySettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var enabled: Bool
    @State private var kind: ProxyKind
    @State private var host: String
    @State private var port: String
    @State private var authEnabled: Bool
    @State private var username: String
    @State private var password: String
    @State private var error: String?

    private let original: ProxyStore.Snapshot
    private let onFinish: (Bool) -> Void

    init(onFinish: @escaping (Bool) -> Void) {
        let store = ProxyStore.shared
        _enabled = State(initialValue: store.enabled)
        _kind = State(initialValue: store.kind)
        _host = State(initialValue: store.host)
        _port = State(initialValue: String(store.port))
        _authEnabled = State(initialValue: store.authEnabled)
        _username = State(initialValue: store.username)
        _password = State(initialValue: store.password)
        original = store.snapshot
        self.onFinish = onFinish
    }

    var body: some View {
        NavigationStack {
            Form {
                /* 说明挂在开关这一节的脚注上：Form 的 section footer 本来就左对齐、
                   贴着上一行，比单独一节居中一句话更像「这一项的注解」。 */
                Section {
                    Toggle("通过代理访问服务器", isOn: $enabled)
                } footer: {
                    Text("修改代理设置后会重新载入面板")
                }

                Section {
                    Picker("类型", selection: $kind) {
                        ForEach(ProxyKind.allCases) { k in
                            Text(k.label).tag(k)
                        }
                    }

                    LabeledContent("服务器") {
                        TextField("", text: $host)
                            .multilineTextAlignment(.trailing)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                    }

                    LabeledContent("端口") {
                        TextField("", text: $port)
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.numberPad)
                    }

                    Toggle("认证", isOn: $authEnabled)

                    if authEnabled {
                        LabeledContent("用户名") {
                            TextField("", text: $username)
                                .multilineTextAlignment(.trailing)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                        }
                        LabeledContent("密码") {
                            SecureField("", text: $password)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }

                if !ProxyStore.available {
                    Section {
                        Text("当前系统版本不支持代理设置，需要 iOS 17 及以上。")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("代理设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                        .disabled(!ProxyStore.available)
                }
            }
            .alert("代理设置", isPresented: Binding(
                get: { error != nil },
                set: { if !$0 { error = nil } }
            )) {
                Button("好", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        let h = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let p = Int(port.trimmingCharacters(in: .whitespaces)) ?? 0
        let user = username.trimmingCharacters(in: .whitespacesAndNewlines)

        if enabled {
            guard !h.isEmpty else { error = "服务器不能为空。"; return }
            guard (1...65535).contains(p) else { error = "端口需要是 1–65535 之间的数字。"; return }
            if authEnabled {
                guard !user.isEmpty else { error = "开启认证后用户名不能为空。"; return }
            }
        }

        let store = ProxyStore.shared
        store.enabled = enabled
        store.kind = kind
        store.host = h
        if (1...65535).contains(p) { store.port = p }
        store.authEnabled = authEnabled
        store.username = user
        store.password = password

        onFinish(store.snapshot != original)
        dismiss()
    }
}
