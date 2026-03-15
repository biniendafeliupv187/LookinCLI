import Foundation
import LookinShared

@main
struct LookinBridgeCLI {
    static func main() {
        guard CommandLine.arguments.count >= 2 else {
            fputs("Usage: lookin-bridge <decode|encode> [args]\n", stderr)
            exit(1)
        }
        let command = CommandLine.arguments[1]
        switch command {
        case "decode":
            handleDecode()
        case "encode":
            handleEncode()
        case "generate-fixture":
            handleGenerateFixture()
        default:
            fputs("Unknown command: \(command)\n", stderr)
            exit(1)
        }
    }

    static func handleDecode() {
        // Read base64 from stdin
        guard let inputData = readStdinData() else {
            fputs("Error: failed to read stdin\n", stderr)
            exit(1)
        }
        guard let archiveData = Data(base64Encoded: inputData) else {
            fputs("Error: invalid base64 input\n", stderr)
            exit(1)
        }
        do {
            let unarchiver = try NSKeyedUnarchiver(forReadingFrom: archiveData)
            // Map iOS-only classes to macOS equivalents so archives from
            // iOS devices can be decoded on macOS.
            unarchiver.setClass(NSImage.self, forClassName: "UIImage")
            unarchiver.setClass(NSColor.self, forClassName: "UIColor")
            // LookinShared uses the legacy decodeObjectForKey: API (without
            // specifying expected classes).  With requiresSecureCoding=true the
            // unarchiver silently returns nil/0 for every subsequent decode
            // after the first unrecognised-class failure.  Since the bridge
            // only ever decodes trusted device data, we disable secure coding.
            unarchiver.requiresSecureCoding = false

            let obj = unarchiver.decodeObject(forKey: NSKeyedArchiveRootObjectKey)
            unarchiver.finishDecoding()
            let json = objectToJSON(obj)
            if let jsonData = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                print(jsonString)
            } else {
                fputs("Error: failed to serialize to JSON\n", stderr)
                exit(1)
            }
        } catch {
            fputs("Error: NSKeyedUnarchiver failed: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    static func handleEncode() {
        // Read JSON from stdin
        guard let inputData = readStdinData() else {
            fputs("Error: failed to read stdin\n", stderr)
            exit(1)
        }
        guard let jsonString = String(data: inputData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              let jsonData = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            fputs("Error: invalid JSON input\n", stderr)
            exit(1)
        }

        guard let modelClass = json["$class"] as? String else {
            fputs("Error: JSON must contain $class field\n", stderr)
            exit(1)
        }

        let obj: NSObject
        switch modelClass {
        case "LookinConnectionAttachment":
            obj = jsonToConnectionAttachment(json)
        case "LookinConnectionResponseAttachment":
            obj = jsonToConnectionResponseAttachment(json)
        default:
            fputs("Error: unsupported model class '\(modelClass)'\n", stderr)
            exit(1)
        }

        do {
            let archived = try NSKeyedArchiver.archivedData(withRootObject: obj, requiringSecureCoding: true)
            print(archived.base64EncodedString())
        } catch {
            fputs("Error: NSKeyedArchiver failed: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    // MARK: - JSON → Model conversions

    static func jsonToConnectionAttachment(_ json: [String: Any]) -> LookinConnectionAttachment {
        let a = LookinConnectionAttachment()
        if let raw = json["dataType"] as? Int, let dt = LookinCodingValueType(rawValue: raw) {
            a.dataType = dt
        }
        if let data = json["data"] { a.data = data as AnyObject }
        return a
    }

    static func jsonToConnectionResponseAttachment(_ json: [String: Any]) -> LookinConnectionResponseAttachment {
        let a = LookinConnectionResponseAttachment()
        if let raw = json["dataType"] as? Int, let dt = LookinCodingValueType(rawValue: raw) {
            a.dataType = dt
        }
        if let data = json["data"] { a.data = data as AnyObject }
        if let ver = json["lookinServerVersion"] as? Int { a.lookinServerVersion = Int32(ver) }
        if let bg = json["appIsInBackground"] as? Bool { a.appIsInBackground = bg }
        if let total = json["dataTotalCount"] as? Int { a.dataTotalCount = UInt(total) }
        if let current = json["currentDataCount"] as? Int { a.currentDataCount = UInt(current) }
        return a
    }

    // MARK: - Fixture generation

    static func handleGenerateFixture() {
        guard CommandLine.arguments.count >= 3 else {
            fputs("Usage: lookin-bridge generate-fixture <fixture-name>\n", stderr)
            fputs("Available: connection-response, connection-attachment, hierarchy-info, hierarchy-response\n", stderr)
            exit(1)
        }
        let fixtureName = CommandLine.arguments[2]
        let obj: NSObject
        let expectedJSON: [String: Any]

        switch fixtureName {
        case "connection-response":
            let a = LookinConnectionResponseAttachment()
            a.lookinServerVersion = 7
            a.appIsInBackground = false
            a.dataTotalCount = 1
            a.currentDataCount = 1
            a.dataType = .init(rawValue: 0)!
            obj = a
            expectedJSON = [
                "$class": "LookinConnectionResponseAttachment",
                "lookinServerVersion": 7,
                "appIsInBackground": false,
                "dataTotalCount": 1,
                "currentDataCount": 1,
                "dataType": 0,
            ]
        case "connection-attachment":
            let a = LookinConnectionAttachment()
            a.dataType = .init(rawValue: 0)!
            a.data = "hello" as NSString
            obj = a
            expectedJSON = [
                "$class": "LookinConnectionAttachment",
                "dataType": 0,
                "data": "hello",
            ]
        case "hierarchy-info":
            let h = LookinHierarchyInfo()
            h.serverVersion = 7
            let appInfo = LookinAppInfo()
            appInfo.appName = "TestApp"
            appInfo.appBundleIdentifier = "com.test.app"
            appInfo.deviceDescription = "iPhone 15 Pro"
            appInfo.osDescription = "iOS 18.0"
            appInfo.osMainVersion = 18
            appInfo.serverVersion = 7
            appInfo.deviceType = .simulator
            h.appInfo = appInfo
            h.displayItems = []
            h.collapsedClassList = []
            obj = h
            expectedJSON = [
                "$class": "LookinHierarchyInfo",
                "serverVersion": 7,
                "appInfo": [
                    "$class": "LookinAppInfo",
                    "appName": "TestApp",
                    "appBundleIdentifier": "com.test.app",
                    "deviceDescription": "iPhone 15 Pro",
                    "osDescription": "iOS 18.0",
                ],
                "displayItems": [] as [Any],
            ]
        case "hierarchy-response":
            // LookinConnectionResponseAttachment wrapping LookinHierarchyInfo with a small view tree
            let childItem = LookinDisplayItem()
            let childViewObj = LookinObject()
            childViewObj.oid = 2
            childViewObj.classChainList = ["UIView"]
            childViewObj.memoryAddress = "0x1002"
            childItem.viewObject = childViewObj
            childItem.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
            childItem.bounds = CGRect(x: 0, y: 0, width: 390, height: 844)
            childItem.isHidden = false
            childItem.alpha = 1.0

            let rootItem = LookinDisplayItem()
            let rootViewObj = LookinObject()
            rootViewObj.oid = 1
            rootViewObj.classChainList = ["UIWindow", "UIView", "UIResponder", "NSObject"]
            rootViewObj.memoryAddress = "0x1001"
            rootItem.viewObject = rootViewObj
            rootItem.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
            rootItem.bounds = CGRect(x: 0, y: 0, width: 390, height: 844)
            rootItem.isHidden = false
            rootItem.alpha = 1.0
            rootItem.representedAsKeyWindow = true
            rootItem.subitems = [childItem]

            let appInfo = LookinAppInfo()
            appInfo.appName = "TestApp"
            appInfo.appBundleIdentifier = "com.test.app"
            appInfo.deviceDescription = "iPhone 15 Pro"
            appInfo.osDescription = "iOS 18.0"
            appInfo.osMainVersion = 18
            appInfo.serverVersion = 7
            appInfo.deviceType = .simulator

            let hInfo = LookinHierarchyInfo()
            hInfo.serverVersion = 7
            hInfo.appInfo = appInfo
            hInfo.displayItems = [rootItem]
            hInfo.collapsedClassList = []

            let resp = LookinConnectionResponseAttachment()
            resp.lookinServerVersion = 7
            resp.appIsInBackground = false
            resp.dataTotalCount = 1
            resp.currentDataCount = 1
            resp.dataType = .init(rawValue: 0)!
            resp.data = hInfo
            obj = resp
            expectedJSON = [
                "$class": "LookinConnectionResponseAttachment",
                "lookinServerVersion": 7,
                "data": [
                    "$class": "LookinHierarchyInfo",
                    "serverVersion": 7,
                    "appInfo": [
                        "$class": "LookinAppInfo",
                        "appName": "TestApp",
                        "appBundleIdentifier": "com.test.app",
                    ],
                    "displayItems": [
                        [
                            "$class": "LookinDisplayItem",
                            "viewObject": ["$class": "LookinObject", "oid": 1],
                            "subitems": [
                                ["$class": "LookinDisplayItem", "viewObject": ["$class": "LookinObject", "oid": 2]],
                            ],
                        ],
                    ],
                ] as [String : Any],
            ]
        default:
            fputs("Unknown fixture: \(fixtureName)\n", stderr)
            exit(1)
        }

        // Archive -> base64
        do {
            let archived = try NSKeyedArchiver.archivedData(withRootObject: obj, requiringSecureCoding: true)
            let base64 = archived.base64EncodedString()
            // Output JSON with both base64 and expected structure
            let output: [String: Any] = [
                "base64": base64,
                "expected": expectedJSON,
            ]
            if let jsonData = try? JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                print(jsonString)
            }
        } catch {
            fputs("Error: failed to archive fixture: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    static func readStdinData() -> Data? {
        var data = Data()
        let bufferSize = 65536
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }
        while true {
            let bytesRead = fread(buffer, 1, bufferSize, stdin)
            if bytesRead == 0 { break }
            data.append(buffer, count: bytesRead)
        }
        return data.isEmpty ? nil : data
    }

    static func objectToJSON(_ obj: Any?) -> Any {
        switch obj {
        case nil:
            return NSNull()
        case let str as String:
            return str
        case let num as NSNumber:
            if CFBooleanGetTypeID() == CFGetTypeID(num) {
                return num.boolValue
            }
            return num
        case let data as Data:
            return data.base64EncodedString()
        case let arr as [Any]:
            return arr.map { objectToJSON($0) }
        case let dict as [String: Any]:
            var result: [String: Any] = [:]
            for (k, v) in dict { result[k] = objectToJSON(v) }
            return result
        case let attachment as LookinConnectionResponseAttachment:
            return connectionResponseAttachmentToJSON(attachment)
        case let hierarchyInfo as LookinHierarchyInfo:
            return hierarchyInfoToJSON(hierarchyInfo)
        case let displayItem as LookinDisplayItem:
            return displayItemToJSON(displayItem)
        case let appInfo as LookinAppInfo:
            return appInfoToJSON(appInfo)
        case let lookinObj as LookinObject:
            return lookinObjectToJSON(lookinObj)
        case let group as LookinAttributesGroup:
            return attributesGroupToJSON(group)
        case let section as LookinAttributesSection:
            return attributesSectionToJSON(section)
        case let attr as LookinAttribute:
            return attributeToJSON(attr)
        case let connAttachment as LookinConnectionAttachment:
            return connectionAttachmentToJSON(connAttachment)
        default:
            return String(describing: obj!)
        }
    }

    static func connectionResponseAttachmentToJSON(_ a: LookinConnectionResponseAttachment) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinConnectionResponseAttachment",
            "lookinServerVersion": a.lookinServerVersion,
            "appIsInBackground": a.appIsInBackground,
            "dataTotalCount": a.dataTotalCount,
            "currentDataCount": a.currentDataCount,
        ]
        if let error = a.error as NSError? {
            result["error"] = ["domain": error.domain, "code": error.code, "description": error.localizedDescription]
        }
        // Include base class data
        result["dataType"] = a.dataType.rawValue
        if let data = a.data {
            result["data"] = objectToJSON(data)
        }
        return result
    }

    static func connectionAttachmentToJSON(_ a: LookinConnectionAttachment) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinConnectionAttachment",
            "dataType": a.dataType.rawValue,
        ]
        if let data = a.data {
            result["data"] = objectToJSON(data)
        }
        return result
    }

    static func hierarchyInfoToJSON(_ h: LookinHierarchyInfo) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinHierarchyInfo",
            "serverVersion": h.serverVersion,
        ]
        if let items = h.displayItems {
            result["displayItems"] = items.map { objectToJSON($0) }
        }
        if let appInfo = h.appInfo {
            result["appInfo"] = objectToJSON(appInfo)
        }
        if let colorAlias = h.colorAlias {
            result["colorAlias"] = objectToJSON(colorAlias)
        }
        if let collapsed = h.collapsedClassList {
            result["collapsedClassList"] = collapsed
        }
        return result
    }

    static func displayItemToJSON(_ d: LookinDisplayItem) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinDisplayItem",
            "isHidden": d.isHidden,
            "alpha": d.alpha,
            "frame": rectToJSON(d.frame),
            "bounds": rectToJSON(d.bounds),
            "representedAsKeyWindow": d.representedAsKeyWindow,
            "shouldCaptureImage": d.shouldCaptureImage,
        ]
        if let viewObj = d.viewObject { result["viewObject"] = objectToJSON(viewObj) }
        if let layerObj = d.layerObject { result["layerObject"] = objectToJSON(layerObj) }
        if let hostVC = d.hostViewControllerObject { result["hostViewControllerObject"] = objectToJSON(hostVC) }
        if let subitems = d.subitems, !subitems.isEmpty {
            result["subitems"] = subitems.map { objectToJSON($0) }
        }
        if let attrGroups = d.attributesGroupList, !attrGroups.isEmpty {
            result["attributesGroupList"] = attrGroups.map { objectToJSON($0) }
        }
        if let eventHandlers = d.eventHandlers, !eventHandlers.isEmpty {
            result["eventHandlers"] = eventHandlers.map { objectToJSON($0) }
        }
        if let title = d.customDisplayTitle { result["customDisplayTitle"] = title }
        if let bgColor = d.backgroundColor { result["backgroundColor"] = colorToJSON(bgColor) }
        return result
    }

    static func appInfoToJSON(_ a: LookinAppInfo) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinAppInfo",
            "appInfoIdentifier": a.appInfoIdentifier,
            "shouldUseCache": a.shouldUseCache,
            "serverVersion": a.serverVersion,
            "swiftEnabledInLookinServer": a.swiftEnabledInLookinServer,
            "osMainVersion": a.osMainVersion,
            "deviceType": a.deviceType.rawValue,
        ]
        if let name = a.appName { result["appName"] = name }
        if let bundleId = a.appBundleIdentifier { result["appBundleIdentifier"] = bundleId }
        if let deviceDesc = a.deviceDescription { result["deviceDescription"] = deviceDesc }
        if let osDesc = a.osDescription { result["osDescription"] = osDesc }
        if let ver = a.serverReadableVersion { result["serverReadableVersion"] = ver }
        return result
    }

    static func lookinObjectToJSON(_ o: LookinObject) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinObject",
            "oid": o.oid,
        ]
        if let addr = o.memoryAddress { result["memoryAddress"] = addr }
        if let chain = o.classChainList { result["classChainList"] = chain }
        if let trace = o.specialTrace { result["specialTrace"] = trace }
        return result
    }

    static func attributesGroupToJSON(_ g: LookinAttributesGroup) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinAttributesGroup",
            "identifier": g.identifier,
        ]
        if let sections = g.attrSections {
            result["attrSections"] = sections.map { objectToJSON($0) }
        }
        return result
    }

    static func attributesSectionToJSON(_ s: LookinAttributesSection) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinAttributesSection",
            "identifier": s.identifier,
        ]
        if let attrs = s.attributes {
            result["attributes"] = attrs.map { objectToJSON($0) }
        }
        return result
    }

    static func attributeToJSON(_ a: LookinAttribute) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinAttribute",
            "identifier": a.identifier,
        ]
        if let value = a.value { result["value"] = objectToJSON(value) }
        return result
    }

    static func rectToJSON(_ r: CGRect) -> [String: Any] {
        return ["x": r.origin.x, "y": r.origin.y, "width": r.size.width, "height": r.size.height]
    }

    static func colorToJSON(_ color: NSColor) -> [String: Any] {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        if let c = color.usingColorSpace(.sRGB) {
            c.getRed(&r, green: &g, blue: &b, alpha: &a)
        }
        return ["r": r, "g": g, "b": b, "a": a]
    }
}
