// Talqava for the Mac, as a native app. It starts Talqava's own server (the same TypeScript, run by the Node program
// inside the app) and shows it in a window, using the web view that comes with macOS. Closing the window keeps
// Talqava running, so automations and agents carry on; Quit stops everything. A small item in the menu bar brings
// the window back from anywhere.
//
// This does what desktop/main.cjs does for the Electron build, without carrying a browser inside the app.
import AppKit
import UniformTypeIdentifiers
import WebKit

let appName = "Talqava"
let firstPort = 8788 // 8787 is left for the web version, so both can run at once
let host = "127.0.0.1"

// ---------- where things are ----------
let fm = FileManager.default
let home = fm.homeDirectoryForCurrentUser
let support = home.appendingPathComponent("Library/Application Support")
/// Where everything is kept. The app was called "Talqava Agents" before; data made then stays in that folder.
/// True when this run was given its own data folder, to try a build beside the installed app.
let trial = !(ProcessInfo.processInfo.environment["TALQAVA_DATA_DIR"] ?? "").isEmpty
let dataDir: URL = {
  // For trying a build beside the installed app: another data folder, named when starting it.
  if let given = ProcessInfo.processInfo.environment["TALQAVA_DATA_DIR"], !given.isEmpty { return URL(fileURLWithPath: given) }
  let old = support.appendingPathComponent("Talqava Agents/data")
  return fm.fileExists(atPath: old.path) ? old : support.appendingPathComponent("Talqava/data")
}()
/// A trial run keeps its log with its own data, so it never writes into the installed app's log.
let logFile = trial ? dataDir.appendingPathComponent("server.log") : home.appendingPathComponent("Library/Logs/Talqava/server.log")
let resources = Bundle.main.resourceURL ?? URL(fileURLWithPath: ".")
let serverDir = resources.appendingPathComponent("server")
let nodeProgram = resources.appendingPathComponent("node")

func lastLogLines() -> String {
  guard let text = try? String(contentsOf: logFile, encoding: .utf8) else { return "" }
  return text.split(separator: "\n").suffix(12).joined(separator: "\n")
}

/// True when nothing is listening on the port yet.
func portIsFree(_ port: Int) -> Bool {
  let sock = socket(AF_INET, SOCK_STREAM, 0)
  guard sock >= 0 else { return false }
  defer { close(sock) }
  // A port a copy of Talqava has just let go of counts as free, so restarting takes the same port again.
  var yes: Int32 = 1
  setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
  var addr = sockaddr_in()
  addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  addr.sin_family = sa_family_t(AF_INET)
  addr.sin_port = in_port_t(port).bigEndian
  addr.sin_addr.s_addr = inet_addr(host)
  let bound = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
  return bound == 0
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var server: Process?
  var address: URL?
  var window: NSWindow?
  var web: WKWebView?
  var status: NSStatusItem?
  var quitting = false

  // ---------- the server ----------
  func startServer() throws -> URL {
    try fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
    try fm.createDirectory(at: logFile.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let port = (firstPort..<(firstPort + 50)).first(where: portIsFree) else { throw NSError(domain: appName, code: 1, userInfo: [NSLocalizedDescriptionKey: "No free port was found between 8788 and 8837."]) }
    if !fm.fileExists(atPath: logFile.path) { fm.createFile(atPath: logFile.path, contents: nil) }
    let log = try FileHandle(forWritingTo: logFile)
    log.seekToEndOfFile()
    log.write("\n--- \(ISO8601DateFormatter().string(from: Date())) starting on port \(port) (native Mac app) ---\n".data(using: .utf8)!)
    let run = Process()
    run.executableURL = nodeProgram
    run.arguments = [serverDir.appendingPathComponent("src/local/main.ts").path]
    run.currentDirectoryURL = serverDir
    var env = ProcessInfo.processInfo.environment
    // An app opened from Finder gets a bare PATH; add the usual places for tools the agents' shell uses.
    let extra = ["/opt/homebrew/bin", "/usr/local/bin", home.appendingPathComponent(".local/bin").path]
    env["PATH"] = (extra + [env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"]).joined(separator: ":")
    env["TALQAVA_DATA_DIR"] = dataDir.path
    env["TALQAVA_DESKTOP"] = "mac"
    // A build tried on another data folder is not the installed app: it leaves Claude's settings alone.
    if trial { env["TALQAVA_SECOND_COPY"] = "1" }
    env["HOST"] = host
    env["PORT"] = String(port)
    run.environment = env
    run.standardInput = FileHandle.nullDevice
    run.standardOutput = log
    run.standardError = log
    run.terminationHandler = { [weak self] done in
      DispatchQueue.main.async {
        guard let self, self.server === done else { return }
        self.server = nil
        if !self.quitting { self.serverStopped(code: done.terminationStatus) }
      }
    }
    try run.run()
    server = run
    return URL(string: "http://\(host):\(port)")!
  }

  /// Waits until the server answers, for up to thirty seconds.
  func whenAnswering(_ url: URL, tries: Int = 150, then done: @escaping (Bool) -> Void) {
    guard server != nil, tries > 0 else { return done(false) }
    var request = URLRequest(url: url.appendingPathComponent("api/state"))
    request.timeoutInterval = 1
    URLSession.shared.dataTask(with: request) { _, response, _ in
      DispatchQueue.main.async {
        if response != nil { return done(true) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.whenAnswering(url, tries: tries - 1, then: done) }
      }
    }.resume()
  }

  func launch() {
    do {
      let url = try startServer()
      whenAnswering(url) { ok in
        guard ok else { return self.fail("\(appName) could not start.", self.server == nil ? "The app stopped while starting.\n\n\(lastLogLines())" : "The app did not start within 30 seconds.\n\n\(lastLogLines())") }
        self.address = url
        self.showWindow()
      }
    } catch {
      fail("\(appName) could not start.", error.localizedDescription)
    }
  }

  func fail(_ message: String, _ detail: String) {
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = message
    alert.informativeText = detail
    alert.runModal()
    NSApp.terminate(nil)
  }

  func serverStopped(code: Int32) {
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = "\(appName) stopped unexpectedly (code \(code))."
    alert.informativeText = lastLogLines().isEmpty ? "No details were written." : lastLogLines()
    alert.addButton(withTitle: "Restart")
    alert.addButton(withTitle: "Show Log")
    alert.addButton(withTitle: "Quit")
    let answer = alert.runModal()
    if answer == .alertSecondButtonReturn { NSWorkspace.shared.activateFileViewerSelecting([logFile]) }
    if answer == .alertThirdButtonReturn { return NSApp.terminate(nil) }
    web?.removeFromSuperview()
    window?.orderOut(nil)
    window = nil
    web = nil
    launch()
  }

  /// Stops the server and waits for it, for up to four seconds; after that it is stopped the hard way.
  func stopServer() {
    guard let running = server, running.isRunning else { return }
    running.terminationHandler = nil
    running.terminate()
    let until = Date().addingTimeInterval(4)
    while running.isRunning && Date() < until { usleep(50_000) }
    if running.isRunning { kill(running.processIdentifier, SIGKILL) }
    server = nil
  }

  // ---------- the window ----------
  func isOurs(_ target: URL?) -> Bool {
    guard let target, let address else { return false }
    return target.scheme == address.scheme && target.host == address.host && target.port == address.port
  }

  @objc func showWindow() {
    NSApp.activate(ignoringOtherApps: true)
    if let window {
      if window.isMiniaturized { window.deminiaturize(nil) }
      window.makeKeyAndOrderFront(nil)
      return
    }
    guard let address else { return }
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default() // the page's own settings (the look, the last tab) are kept between runs
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    let view = WKWebView(frame: .zero, configuration: config)
    view.navigationDelegate = self
    view.uiDelegate = self
    view.allowsBackForwardNavigationGestures = false
    view.setValue(false, forKey: "drawsBackground") // no white flash before the page draws
    let made = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    made.title = appName
    made.minSize = NSSize(width: 980, height: 600)
    made.backgroundColor = NSColor(calibratedRed: 0.039, green: 0.039, blue: 0.039, alpha: 1)
    made.titlebarAppearsTransparent = true
    made.titleVisibility = .hidden
    made.appearance = NSAppearance(named: .darkAqua)
    made.isReleasedWhenClosed = false
    made.delegate = self
    made.contentView = view
    made.setFrameAutosaveName("TalqavaMain")
    if !made.setFrameUsingName("TalqavaMain") { made.center() }
    window = made
    web = view
    view.load(URLRequest(url: address))
    made.makeKeyAndOrderFront(nil)
  }

  /// Closing the window hides it; the app keeps running until Quit.
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if quitting { return true }
    sender.orderOut(nil)
    return false
  }

  // Links to other sites open in the person's own browser.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    guard let target = action.request.url else { return decisionHandler(.cancel) }
    if isOurs(target) || target.scheme == "about" || target.scheme == "blob" || target.scheme == "data" { return decisionHandler(.allow) }
    if target.scheme == "http" || target.scheme == "https" { NSWorkspace.shared.open(target) }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    // A file the server hands over as an attachment is saved, not shown.
    let attached = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().hasPrefix("attachment") ?? false
    decisionHandler(attached || !response.canShowMIMEType ? .download : .allow)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let target = action.request.url, target.scheme == "http" || target.scheme == "https" {
      if isOurs(target) { webView.load(action.request) } else { NSWorkspace.shared.open(target) }
    }
    return nil
  }

  // The page's own questions ("Delete this?") are asked with the Mac's dialogs.
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = appName
    alert.informativeText = message
    alert.runModal()
    completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    let parts = message.components(separatedBy: "\n\n")
    alert.messageText = parts.first ?? message
    alert.informativeText = parts.dropFirst().joined(separator: "\n\n")
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    let alert = NSAlert()
    alert.messageText = prompt
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
    field.stringValue = defaultText ?? ""
    alert.accessoryView = field
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.window.initialFirstResponder = field
    completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
  }

  // Choosing a file to attach or import.
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  // The microphone, for voice memos and for speaking instead of typing. macOS asks the person the first time.
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == host && type == .microphone ? .grant : .deny)
  }

  // Saving a file the app hands over: it goes to Downloads, under a name that is not already taken.
  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
  var saved: [ObjectIdentifier: URL] = [:]
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let folder = fm.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? home.appendingPathComponent("Downloads")
    let name = suggestedFilename.isEmpty ? "Talqava file" : suggestedFilename.replacingOccurrences(of: "/", with: "-")
    let base = (name as NSString).deletingPathExtension
    let ending = (name as NSString).pathExtension
    var target = folder.appendingPathComponent(name)
    var n = 2
    while fm.fileExists(atPath: target.path) {
      target = folder.appendingPathComponent(ending.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ending)")
      n += 1
    }
    saved[ObjectIdentifier(download)] = target
    completionHandler(target)
  }
  func downloadDidFinish(_ download: WKDownload) {
    if let file = saved.removeValue(forKey: ObjectIdentifier(download)) { NSWorkspace.shared.activateFileViewerSelecting([file]) }
  }
  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    saved.removeValue(forKey: ObjectIdentifier(download))
    let alert = NSAlert()
    alert.messageText = "The file could not be saved."
    alert.informativeText = error.localizedDescription
    alert.runModal()
  }

  /// If the web view's own process ever stops, the page is loaded again.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

  // ---------- menus ----------
  func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
    let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
    it.keyEquivalentModifierMask = mods
    if let action, responds(to: action) { it.target = self }
    return it
  }

  func buildMenu() {
    let bar = NSMenu()
    func add(_ title: String, _ items: [NSMenuItem]) {
      let top = NSMenuItem()
      let menu = NSMenu(title: title)
      items.forEach(menu.addItem)
      top.submenu = menu
      bar.addItem(top)
      if title == "Window" { NSApp.windowsMenu = menu }
      if title == "Help" { NSApp.helpMenu = menu }
    }
    add(appName, [
      item("About \(appName)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      .separator(),
      item("Show Data Folder", #selector(showData)),
      item("Show Log", #selector(showLog)),
      .separator(),
      item("Hide \(appName)", #selector(NSApplication.hide(_:)), "h"),
      item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("Quit \(appName)", #selector(NSApplication.terminate(_:)), "q"),
    ])
    add("Edit", [
      item("Undo", Selector(("undo:")), "z"),
      item("Redo", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      item("Cut", #selector(NSText.cut(_:)), "x"),
      item("Copy", #selector(NSText.copy(_:)), "c"),
      item("Paste", #selector(NSText.paste(_:)), "v"),
      item("Select All", #selector(NSText.selectAll(_:)), "a"),
    ])
    add("View", [
      item("Reload", #selector(reload), "r"),
      .separator(),
      item("Actual Size", #selector(zoomReset), "0"),
      item("Zoom In", #selector(zoomIn), "+"),
      item("Zoom Out", #selector(zoomOut), "-"),
      .separator(),
      item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
    ])
    add("Window", [
      item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Zoom", #selector(NSWindow.performZoom(_:))),
      .separator(),
      item("Show \(appName)", #selector(showWindow), "1"),
    ])
    add("Help", [
      item("Talqava User Guide", #selector(showGuide), "?"),
      .separator(),
      docItem("Terms of Use", "terms"), docItem("Privacy Policy", "privacy"), docItem("Acceptable Use Policy", "acceptable-use"), docItem("Licence", "license"), docItem("Third-party Notices", "notices"),
      .separator(),
      item("Talqava Website", #selector(openWebsite)),
      item("Report a Problem", #selector(reportProblem)),
    ])
    NSApp.mainMenu = bar
  }

  func docItem(_ title: String, _ id: String) -> NSMenuItem {
    let it = item(title, #selector(showLegal(_:)))
    it.representedObject = id
    return it
  }

  /// A small item in the menu bar: bring the window back, start a new session, or quit, from anywhere.
  func buildStatusItem() {
    let made = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    made.button?.title = "T"
    made.button?.font = NSFont.systemFont(ofSize: 14, weight: .bold)
    made.button?.toolTip = appName
    let menu = NSMenu()
    menu.addItem(item("Open \(appName)", #selector(showWindow)))
    menu.addItem(item("New Session", #selector(newSession)))
    menu.addItem(.separator())
    menu.addItem(item("Quit \(appName)", #selector(NSApplication.terminate(_:))))
    made.menu = menu
    status = made
  }

  func run(_ script: String) { showWindow(); web?.evaluateJavaScript(script, completionHandler: nil) }
  @objc func showData() { NSWorkspace.shared.open(dataDir) }
  @objc func showLog() { NSWorkspace.shared.activateFileViewerSelecting([logFile]) }
  @objc func reload() { web?.reload() }
  @objc func zoomReset() { web?.pageZoom = 1 }
  @objc func zoomIn() { if let web { web.pageZoom = min(3, web.pageZoom + 0.1) } }
  @objc func zoomOut() { if let web { web.pageZoom = max(0.5, web.pageZoom - 0.1) } }
  @objc func showGuide() { run("window.talqavaShowGuide && window.talqavaShowGuide('getting-started')") }
  @objc func showLegal(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String, id.range(of: "^[a-z-]+$", options: .regularExpression) != nil else { return }
    run("window.talqavaShowLegal && window.talqavaShowLegal('\(id)')")
  }
  @objc func newSession() { run("window.talqavaNewSession && window.talqavaNewSession()") }
  @objc func openWebsite() { NSWorkspace.shared.open(URL(string: "https://talqava.com")!) }
  @objc func reportProblem() { NSWorkspace.shared.open(URL(string: "https://github.com/Talqava/Talqava/issues/new/choose")!) }

  // ---------- start and stop ----------
  var signals: [DispatchSourceSignal] = []
  /// Being told to stop from outside (a shutdown, or `kill`) stops the server too, like Quit.
  func stopOnSignals() {
    for sig in [SIGTERM, SIGINT, SIGHUP] {
      signal(sig, SIG_IGN)
      let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
      source.setEventHandler { NSApp.terminate(nil) }
      source.resume()
      signals.append(source)
    }
  }

  func applicationDidFinishLaunching(_ note: Notification) {
    // Only one copy works on a data folder at a time. The first holds a lock on a small file there for as long as
    // it runs (the lock goes away by itself if it stops, however it stops); a second copy finds it held, brings
    // the first to the front if it can, and leaves.
    try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
    let lock = open(dataDir.appendingPathComponent(".app-running").path, O_CREAT | O_RDWR, 0o600)
    if lock < 0 || flock(lock, LOCK_EX | LOCK_NB) != 0 {
      NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "com.talqava.agents").first { $0 != NSRunningApplication.current && $0.activationPolicy == .regular }?.activate(options: [.activateAllWindows])
      return NSApp.terminate(nil)
    }
    stopOnSignals()
    buildMenu()
    buildStatusItem()
    launch()
  }

  /// Clicking the Dock icon brings the window back.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    showWindow()
    return false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    quitting = true
    stopServer()
    return .terminateNow
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
