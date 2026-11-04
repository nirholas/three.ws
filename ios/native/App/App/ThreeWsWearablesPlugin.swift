import Capacitor
import Foundation

#if canImport(WearablesKit)
import WearablesKit
#endif

/// Capacitor face of the Meta Wearables lane, reached from the page as
/// `Capacitor.Plugins.ThreeWsWearables` (src/irl/glasses/native-bridge.js).
///
/// - `getSession()` -> `{ state, deviceName?, battery? }`
/// - `sessionChanged` event, same payload
/// - `startAudioRoute()` / `stopAudioRoute()` open the glasses microphone and
///   speakers as the system audio route so the page's own capture and playback
///   (the TalkController path) run through the glasses
/// - `capturePhoto()` -> `{ base64, mime }`, one JPEG held in memory only
///
/// The toolkit is linked through the local WearablesKit package (see
/// ios/docs/WEARABLES.md). Until that package is added to the app target the
/// plugin still loads and reports `unavailable`, so the shell builds and ships
/// without the toolkit and the web side degrades on its own.
@objc(ThreeWsWearablesPlugin)
public class ThreeWsWearablesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ThreeWsWearablesPlugin"
    public let jsName = "ThreeWsWearables"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startAudioRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAudioRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capturePhoto", returnType: CAPPluginReturnPromise),
    ]

    #if canImport(WearablesKit)
    private let service = GlassesService()
    private var observer: UUID?

    public override func load() {
        do { try service.configure() } catch {
            CAPLog.print("ThreeWsWearables: toolkit configure failed: \(error)")
        }
    }

    private func payload(_ s: GlassesSnapshot) -> JSObject {
        var out: JSObject = ["state": s.state.rawValue]
        if let n = s.deviceName { out["deviceName"] = n }
        if let b = s.battery { out["battery"] = b }
        return out
    }

    @objc func getSession(_ call: CAPPluginCall) {
        if observer == nil {
            observer = service.observe { [weak self] snap in
                guard let self else { return }
                self.notifyListeners("sessionChanged", data: self.payload(snap))
            }
        }
        call.resolve(payload(service.snapshot()))
    }

    @objc func startAudioRoute(_ call: CAPPluginCall) {
        do {
            let route = try service.openAudioRoute()
            call.resolve(["input": route.input, "output": route.output])
        } catch let e as GlassesError {
            call.reject(e.message, e.code)
        } catch {
            call.reject("\(error)", "audio_route")
        }
    }

    @objc func stopAudioRoute(_ call: CAPPluginCall) {
        service.closeAudioRoute()
        call.resolve()
    }

    @objc func capturePhoto(_ call: CAPPluginCall) {
        Task {
            do {
                let jpeg = try await service.capturePhoto()
                call.resolve(["base64": jpeg.base64EncodedString(), "mime": "image/jpeg"])
            } catch let e as GlassesError {
                call.reject(e.message, e.code)
            } catch {
                call.reject("\(error)", "capture_failed")
            }
        }
    }

    deinit {
        if let observer { service.stopObserving(observer) }
    }
    #else
    @objc func getSession(_ call: CAPPluginCall) {
        call.resolve(["state": "unavailable"])
    }

    @objc func startAudioRoute(_ call: CAPPluginCall) {
        call.reject("The Meta Wearables toolkit is not linked into this build", "unavailable")
    }

    @objc func stopAudioRoute(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func capturePhoto(_ call: CAPPluginCall) {
        call.reject("The Meta Wearables toolkit is not linked into this build", "unavailable")
    }
    #endif
}
