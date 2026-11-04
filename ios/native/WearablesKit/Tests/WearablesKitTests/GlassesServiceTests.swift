import MWDATCore
import MWDATMockDevice
import XCTest
@testable import WearablesKit

/// Runs on the simulator against MockDeviceKit: no glasses needed.
final class GlassesServiceTests: XCTestCase {
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
        defer { MockDeviceKit.shared.disable() }
        try service.configure()
        let glasses = try MockDeviceKit.shared.pairGlasses(model: GlassesModel.allCases[0])
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
        defer { MockDeviceKit.shared.disable() }
        try service.configure()
        let glasses = try MockDeviceKit.shared.pairGlasses(model: GlassesModel.allCases[0])
        glasses.powerOn()
        glasses.don()
        let url = Bundle.module.url(forResource: "marker", withExtension: "jpg")!
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
}
