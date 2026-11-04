import Foundation

/// Session states the page sees. The raw values are the strings
/// src/irl/glasses/native-bridge.js lists in SESSION_STATES.
public enum GlassesSessionState: String, Sendable, Equatable {
    case unavailable
    case disconnected
    case connecting
    case connected
    case error
}

public struct GlassesSnapshot: Sendable, Equatable {
    public var state: GlassesSessionState
    public var deviceName: String?
    public var battery: Int?

    public init(state: GlassesSessionState, deviceName: String? = nil, battery: Int? = nil) {
        self.state = state
        self.deviceName = deviceName
        self.battery = battery
    }
}

public enum GlassesError: Error, Equatable, Sendable {
    case notConnected
    case permissionDenied(String)
    case captureFailed(String)
    case captureTimedOut
    case audioRoute(String)

    /// Stable codes the page can branch on.
    public var code: String {
        switch self {
        case .notConnected: return "not_connected"
        case .permissionDenied: return "permission_denied"
        case .captureFailed: return "capture_failed"
        case .captureTimedOut: return "capture_timeout"
        case .audioRoute: return "audio_route"
        }
    }

    public var message: String {
        switch self {
        case .notConnected: return "The glasses are not connected"
        case .permissionDenied(let what): return "Permission denied: \(what)"
        case .captureFailed(let why): return "Photo capture failed: \(why)"
        case .captureTimedOut: return "The glasses did not return a photo in time"
        case .audioRoute(let why): return "Could not open the glasses audio route: \(why)"
        }
    }
}

/// Maps the toolkit's link state onto the page-facing state. Pure, so it is
/// covered by tests without a device.
public func mapGlassesState(registered: Bool, hasDevice: Bool, link: LinkStateKind?) -> GlassesSessionState {
    guard registered else { return .disconnected }
    guard hasDevice, let link else { return .disconnected }
    switch link {
    case .connected: return .connected
    case .connecting: return .connecting
    case .disconnected: return .disconnected
    }
}

public enum LinkStateKind: Sendable, Equatable {
    case disconnected, connecting, connected
}
