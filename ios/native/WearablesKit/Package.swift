// swift-tools-version: 6.0
import PackageDescription

// The Meta Wearables Device Access Toolkit lane for the three.ws iOS app.
// WearablesKit has no Capacitor dependency so it builds and tests on its own:
//   cd ios/native/WearablesKit && xcodebuild test -scheme WearablesKit \
//     -destination 'platform=iOS Simulator,name=iPhone 16'
// The Capacitor plugin that exposes it to the page is App/ThreeWsWearablesPlugin.swift.
// The toolkit is pinned to an exact release (1.0.1, published 2026-10-09).
let package = Package(
    name: "WearablesKit",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "WearablesKit", targets: ["WearablesKit"]),
    ],
    dependencies: [
        .package(url: "https://github.com/facebook/meta-wearables-dat-ios", exact: "1.0.1"),
    ],
    targets: [
        .target(
            name: "WearablesKit",
            dependencies: [
                .product(name: "MWDATCore", package: "meta-wearables-dat-ios"),
                .product(name: "MWDATCamera", package: "meta-wearables-dat-ios"),
            ]
        ),
        .testTarget(
            name: "WearablesKitTests",
            dependencies: [
                "WearablesKit",
                .product(name: "MWDATMockDevice", package: "meta-wearables-dat-ios"),
            ]
        ),
    ]
)
