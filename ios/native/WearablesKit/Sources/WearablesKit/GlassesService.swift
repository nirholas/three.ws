import AVFoundation
import Foundation
import MWDATCamera
import MWDATCore
import UIKit

/// Everything the page needs from the glasses, over the Meta Wearables Device
/// Access Toolkit: session state, the microphone and speaker route, and one
/// photo at a time. Frames are returned in memory and never written to disk.
public final class GlassesService: @unchecked Sendable {
    public static let photoTimeoutSeconds: Double = 12

    private let lock = NSLock()
    private var observers: [UUID: @Sendable (GlassesSnapshot) -> Void] = [:]
    private var tokens: [any AnyListenerToken] = []
    private var tasks: [Task<Void, Never>] = []
    private var deviceTokens: [any AnyListenerToken] = []
    private var configured = false
    private var audioOpen = false

    public init() {}

    /// Call once at launch. Safe to call again.
    public func configure() throws {
        lock.lock()
        defer { lock.unlock() }
        if configured { return }
        try Wearables.configure()
        configured = true
    }

    public func handle(url: URL) async -> Bool {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              comps.queryItems?.contains(where: { $0.name == "metaWearablesAction" }) == true
        else { return false }
        do { return try await Wearables.shared.handleUrl(url) } catch { return false }
    }

    public func snapshot() -> GlassesSnapshot {
        let w = Wearables.shared
        let registered = w.registrationState == .registered
        let selector = AutoDeviceSelector(wearables: w)
        let device = selector.activeDevice.flatMap { w.deviceForIdentifier($0) }
        let link: LinkStateKind? = device.map {
            switch $0.linkState {
            case .connected: return .connected
            case .connecting: return .connecting
            case .disconnected: return .disconnected
            }
        }
        return GlassesSnapshot(
            state: mapGlassesState(registered: registered, hasDevice: device != nil, link: link),
            deviceName: device?.nameOrId(),
            battery: device?.batteryLevel
        )
    }

    /// Start the registration flow in the Meta AI app.
    public func register() async throws {
        try await Wearables.shared.startRegistration()
    }

    // MARK: observation

    @discardableResult
    public func observe(_ onChange: @escaping @Sendable (GlassesSnapshot) -> Void) -> UUID {
        let id = UUID()
        lock.lock()
        observers[id] = onChange
        let first = observers.count == 1
        lock.unlock()
        if first { startWatching() }
        return id
    }

    public func stopObserving(_ id: UUID) {
        lock.lock()
        observers[id] = nil
        let empty = observers.isEmpty
        lock.unlock()
        if empty { stopWatching() }
    }

    private func emit() {
        let snap = snapshot()
        lock.lock()
        let fns = Array(observers.values)
        lock.unlock()
        for fn in fns { fn(snap) }
    }

    private func startWatching() {
        let w = Wearables.shared
        let regTask = Task { [weak self] in
            for await _ in w.registrationStateStream() { self?.emit() }
        }
        let devTask = Task { [weak self] in
            for await ids in w.devicesStream() {
                self?.rebindDeviceListeners(ids)
                self?.emit()
            }
        }
        lock.lock()
        tasks = [regTask, devTask]
        lock.unlock()
        rebindDeviceListeners(w.devices)
    }

    private func rebindDeviceListeners(_ ids: [DeviceIdentifier]) {
        let w = Wearables.shared
        lock.lock()
        let old = deviceTokens
        deviceTokens = ids.compactMap { id in
            w.deviceForIdentifier(id)?.addLinkStateListener { [weak self] _ in self?.emit() }
        }
        lock.unlock()
        for t in old { Task { await t.cancel() } }
    }

    private func stopWatching() {
        lock.lock()
        let ts = tasks
        let dt = deviceTokens
        tasks = []
        deviceTokens = []
        lock.unlock()
        ts.forEach { $0.cancel() }
        for t in dt { Task { await t.cancel() } }
    }

    // MARK: audio

    /// Open the glasses microphone and speakers as the system audio route. Once
    /// open, the WebView's getUserMedia capture and <audio> playback use them, so
    /// the conversation runs through the same TalkController as every other
    /// surface. The route follows the connected glasses; this only activates a
    /// session that allows Bluetooth input and output.
    public func openAudioRoute() throws -> (input: String, output: String) {
        guard snapshot().state == .connected else { throw GlassesError.notConnected }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP]
            )
            try session.setActive(true)
        } catch {
            throw GlassesError.audioRoute(error.localizedDescription)
        }
        audioOpen = true
        let route = session.currentRoute
        let input = route.inputs.first?.portName ?? "unknown"
        let output = route.outputs.first?.portName ?? "unknown"
        return (input, output)
    }

    public func closeAudioRoute() {
        guard audioOpen else { return }
        audioOpen = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: camera

    /// One JPEG from the glasses camera. The bytes stay in memory: nothing here
    /// writes a file, and the caller must not either.
    public func capturePhoto() async throws -> Data {
        let w = Wearables.shared
        guard snapshot().state == .connected else { throw GlassesError.notConnected }

        do {
            let status = try await w.checkPermissionStatus(.camera)
            if status != .granted {
                let asked = try await w.requestPermission(.camera)
                if asked != .granted { throw GlassesError.permissionDenied("camera") }
            }
        } catch let e as GlassesError {
            throw e
        } catch {
            throw GlassesError.permissionDenied("camera: \(error)")
        }

        let session: DeviceSession
        do {
            session = try w.createSession(deviceSelector: AutoDeviceSelector(wearables: w))
            try session.start()
        } catch {
            throw GlassesError.captureFailed("\(error)")
        }
        defer { session.stop() }

        let camera: Camera
        do {
            guard let c = try session.addCamera() else { throw GlassesError.captureFailed("no camera capability") }
            camera = c
        } catch let e as GlassesError {
            throw e
        } catch {
            throw GlassesError.captureFailed("\(error)")
        }
        defer { camera.stop() }

        return try await withThrowingTaskGroup(of: Data.self) { group in
            group.addTask {
                try await Self.awaitPhoto(camera.photo)
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(Self.photoTimeoutSeconds * 1_000_000_000))
                throw GlassesError.captureTimedOut
            }
            let first = try await group.next()!
            group.cancelAll()
            return first
        }
    }

    private static func awaitPhoto(_ photo: Photo) async throws -> Data {
        let box = ContinuationBox()
        let dataToken = photo.photoDataPublisher.listen { captured in
            box.finish(.success(captured.imageData))
        }
        let errToken = photo.errorPublisher.listen { err in
            box.finish(.failure(GlassesError.captureFailed(err.description)))
        }
        defer {
            Task {
                await dataToken.cancel()
                await errToken.cancel()
            }
            photo.stop()
        }
        let raw: Data = try await withCheckedThrowingContinuation { cont in
            box.install(cont)
            photo.start()
            photo.capturePhoto(resolution: .medium, quality: .medium)
        }
        return try toJpeg(raw)
    }

    /// The toolkit may hand back HEIC; the page decodes JPEG everywhere.
    static func toJpeg(_ data: Data) throws -> Data {
        guard let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.85) else {
            throw GlassesError.captureFailed("unreadable image")
        }
        return jpeg
    }
}

/// Resolves a checked continuation exactly once, from whichever publisher fires first.
private final class ContinuationBox: @unchecked Sendable {
    private let lock = NSLock()
    private var cont: CheckedContinuation<Data, Error>?
    private var early: Result<Data, Error>?

    func install(_ c: CheckedContinuation<Data, Error>) {
        lock.lock()
        if let early { lock.unlock(); c.resume(with: early); return }
        cont = c
        lock.unlock()
    }

    func finish(_ result: Result<Data, Error>) {
        lock.lock()
        if let c = cont {
            cont = nil
            lock.unlock()
            c.resume(with: result)
        } else {
            if early == nil { early = result }
            lock.unlock()
        }
    }
}
