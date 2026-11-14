import MWDATCore
import MWDATMockDevice
import UIKit
import XCTest
@testable import WearablesKit

/// Runs on the simulator against MockDeviceKit: no glasses needed.
final class GlassesServiceTests: XCTestCase {
    /// The kit exposes both a sync and an async `disable()`; tearing down here
    /// with the async one keeps overload resolution unambiguous in async tests.
    override func tearDown() async throws {
        if MockDeviceKit.shared.isEnabled { await MockDeviceKit.shared.disable() }
        try await super.tearDown()
    }

    func testStateMapping() {
        XCTAssertEqual(mapGlassesState(registered: false, hasDevice: true, link: .connected), .disconnected)
        XCTAssertEqual(mapGlassesState(registered: true, hasDevice: false, link: nil), .disconnected)
        XCTAssertEqual(mapGlassesState(registered: true, hasDevice: true, link: .connecting), .connecting)
        XCTAssertEqual(mapGlassesState(registered: true, hasDevice: true, link: .connected), .connected)
    }

    func testErrorCodesAreStable() {
        XCTAssertEqual(GlassesError.notConnected.code, "not_connected")
        XCTAssertEqual(GlassesError.permissionDenied("camera").code, "permission_denied")
        XCTAssertEqual(GlassesError.captureTimedOut.code, "capture_timeout")
    }

    func testMockGlassesReportConnected() async throws {
        let service = GlassesService()
        MockDeviceKit.shared.enable()
        try service.configure()
        let glasses = try MockDeviceKit.shared.pairGlasses(model: .metaRayBanDisplay)
        glasses.powerOn()
        glasses.don()
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertEqual(service.snapshot().state, .connected)
        glasses.powerOff()
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertNotEqual(service.snapshot().state, .connected)
    }

    func testCapturePhotoFromMockCamera() async throws {
        let service = GlassesService()
        MockDeviceKit.shared.enable()
        try service.configure()
        let glasses = try MockDeviceKit.shared.pairGlasses(model: .metaRayBanDisplay)
        glasses.powerOn()
        glasses.don()
        let url = try Self.writeSampleJpeg()
        defer { try? FileManager.default.removeItem(at: url) }
        glasses.services.cameraCapture.setCapturedPhoto(fileURL: url)
        try await Task.sleep(nanoseconds: 500_000_000)
        let jpeg = try await service.capturePhoto()
        XCTAssertEqual(jpeg.prefix(2), Data([0xFF, 0xD8]))
    }

    func testCapturePhotoRefusesWhenNotConnected() async {
        let service = GlassesService()
        do {
            _ = try await service.capturePhoto()
            XCTFail("expected notConnected")
        } catch {
            XCTAssertEqual(error as? GlassesError, .notConnected)
        }
    }

    /// A real 640x480 JPEG drawn on the spot, handed to the mock camera as the "captured" photo.
    private static func writeSampleJpeg() throws -> URL {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 640, height: 480))
        let data = renderer.jpegData(withCompressionQuality: 0.9) { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 640, height: 480))
            UIColor.black.setFill()
            ctx.fill(CGRect(x: 250, y: 170, width: 140, height: 140))
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("wearables-sample-\(UUID().uuidString).jpg")
        try data.write(to: url)
        return url
    }
}
