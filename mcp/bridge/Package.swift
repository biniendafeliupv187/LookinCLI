// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LookinBridge",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "lookin-bridge", targets: ["LookinBridge"]),
    ],
    targets: [
        // ObjC target: copied from LookinServer/Src/Main/Shared
        .target(
            name: "LookinShared",
            path: "Sources/LookinShared",
            exclude: [
                "Peertalk/Lookin_PTChannel.m",
                "Peertalk/Lookin_PTUSBHub.m",
            ],
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("."),
                .headerSearchPath("Category"),
                .headerSearchPath("Peertalk"),
                .define("SHOULD_COMPILE_LOOKIN_SERVER", to: "1"),
                .define("LOOKIN_BRIDGE", to: "1"),
                .unsafeFlags(["-include", "Sources/LookinShared/LookinShared-Prefix.pch"]),
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
            ]
        ),
        // Swift CLI that calls into Shared models
        .executableTarget(
            name: "LookinBridge",
            dependencies: ["LookinShared"],
            path: "Sources/LookinBridge"
        ),
    ]
)
