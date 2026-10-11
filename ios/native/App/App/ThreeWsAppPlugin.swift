import Foundation
import Capacitor
import UIKit
import UserNotifications

/// The app's own Capacitor plugin, for the things no packaged plugin does.
///
/// - `takeShare({ id })` hands the page the files the share extension parked in
///   the App Group (see SharedInbox.swift). src/shared/share-target.js calls it
///   in place of reading the service worker cache, which the iOS WebView lacks.
/// - `setBadge({ count })` keeps the home screen icon's badge equal to the
///   inbox's unread count. APNs sets it when a push arrives; this is what
///   brings it back down when the notifications are read in the app.
/// - `openInSafari({ url })` hands a page to the real Safari app. Payments,
///   token launches and trading leave the app this way (ios/docs/REVIEW-RISK.md),
///   and it has to be Safari itself: @capacitor/browser opens an in-app
///   SFSafariViewController, which App Review treats as still inside the app.
///   Only https://three.ws/api/auth/handoff is accepted. That endpoint carries
///   the session across (api/auth/handoff.js), and /api/* is excluded from
///   universal links, so iOS cannot route the URL straight back into this app.
///
/// Registered in MainViewController.capacitorDidLoad, and reached from the web
/// as `Capacitor.Plugins.ThreeWsApp`.
@objc(ThreeWsAppPlugin)
public class ThreeWsAppPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ThreeWsAppPlugin"
    public let jsName = "ThreeWsApp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takeShare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openInSafari", returnType: CAPPluginReturnPromise),
    ]

    static let handoffHosts: Set<String> = ["three.ws", "www.three.ws"]
    static let handoffPath = "/api/auth/handoff"

    @objc func takeShare(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), SharedInbox.isValidId(id) else {
            call.reject("A share id is required", "invalid_id")
            return
        }
        // File reads and base64 of a model can take a moment; keep them off the
        // main thread the bridge dispatches on.
        DispatchQueue.global(qos: .userInitiated).async {
            guard let taken = SharedInbox.take(id: id) else {
                call.reject("That share has expired or was already opened", "not_found")
                return
            }
            let files: [JSObject] = zip(taken.share.files, taken.files).map { meta, bytes in
                ["name": meta.name, "type": meta.type, "data": bytes.base64EncodedString()]
            }
            call.resolve([
                "kind": taken.share.kind.rawValue,
                "createdAt": Int(taken.share.createdAt.timeIntervalSince1970 * 1000),
                "files": files,
            ])
        }
    }

    @objc func setBadge(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        UNUserNotificationCenter.current().setBadgeCount(count) { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func openInSafari(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"),
              let url = URL(string: raw),
              url.scheme == "https",
              let host = url.host?.lowercased(),
              Self.handoffHosts.contains(host),
              url.path == Self.handoffPath
        else {
            call.reject("Only three.ws handoff links open in Safari", "invalid_url")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("Safari could not be opened", "open_failed")
                }
            }
        }
    }
}
