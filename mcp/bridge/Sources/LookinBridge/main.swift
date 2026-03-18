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
        case "LookinStaticAsyncUpdateTask":
            obj = jsonToStaticAsyncUpdateTask(json)
        case "LookinStaticAsyncUpdateTasksPackage":
            obj = jsonToStaticAsyncUpdateTasksPackage(json)
        case "LookinAttributeModification":
            obj = jsonToAttributeModification(json)
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
        if let data = json["data"] { a.data = convertJSONData(data) as AnyObject }
        return a
    }

    /// Recursively convert JSON data to model objects when $class markers are present.
    static func convertJSONData(_ value: Any) -> Any {
        if let arr = value as? [[String: Any]] {
            // Array of objects — convert each element
            return arr.map { convertJSONData($0) } as NSArray
        }
        if let dict = value as? [String: Any], let cls = dict["$class"] as? String {
            switch cls {
            case "LookinStaticAsyncUpdateTasksPackage":
                return jsonToStaticAsyncUpdateTasksPackage(dict)
            case "LookinStaticAsyncUpdateTask":
                return jsonToStaticAsyncUpdateTask(dict)
            case "LookinAttributeModification":
                return jsonToAttributeModification(dict)
            default:
                return dict as NSDictionary
            }
        }
        return value
    }

    static func jsonToStaticAsyncUpdateTask(_ json: [String: Any]) -> LookinStaticAsyncUpdateTask {
        let t = LookinStaticAsyncUpdateTask()
        if let oid = json["oid"] as? Int { t.oid = UInt(oid) }
        if let raw = json["taskType"] as? Int, let tt = LookinStaticAsyncUpdateTaskType(rawValue: raw) { t.taskType = tt }
        if let raw = json["attrRequest"] as? Int, let ar = LookinDetailUpdateTaskAttrRequest(rawValue: raw) { t.attrRequest = ar }
        if let v = json["needBasisVisualInfo"] as? Bool { t.needBasisVisualInfo = v }
        if let v = json["needSubitems"] as? Bool { t.needSubitems = v }
        return t
    }

    static func jsonToAttributeModification(_ json: [String: Any]) -> LookinAttributeModification {
        let m = LookinAttributeModification()
        if let oid = json["targetOid"] as? Int { m.targetOid = UInt(oid) }
        if let sel = json["setterSelector"] as? String { m.setterSelector = NSSelectorFromString(sel) }
        if let raw = json["attrType"] as? Int, let at = LookinAttrType(rawValue: raw) { m.attrType = at }
        if let v = json["value"] { m.value = convertModificationValue(v, attrType: m.attrType) }
        if let ver = json["clientReadableVersion"] as? String { m.clientReadableVersion = ver }
        return m
    }

    /// Convert JSON value to the appropriate ObjC type for a modification.
    /// Uses rawValue to avoid ObjC→Swift enum name import issues.
    static func convertModificationValue(_ value: Any, attrType: LookinAttrType) -> Any {
        switch attrType.rawValue {
        case 14: // BOOL
            return NSNumber(value: (value as? Bool) ?? false)
        case 12: // Float
            return NSNumber(value: (value as? Double) ?? 0.0)
        case 13: // Double
            return NSNumber(value: (value as? Double) ?? 0.0)
        case 3, 5, 6: // Int, Long, LongLong
            return NSNumber(value: (value as? Int) ?? 0)
        case 20: // CGRect
            if let arr = value as? [Double], arr.count == 4 {
                return NSValue(rect: NSRect(x: arr[0], y: arr[1], width: arr[2], height: arr[3]))
            }
            return NSValue(rect: .zero)
        case 17: // CGPoint
            if let arr = value as? [Double], arr.count == 2 {
                return NSValue(point: NSPoint(x: arr[0], y: arr[1]))
            }
            return NSValue(point: .zero)
        case 19: // CGSize
            if let arr = value as? [Double], arr.count == 2 {
                return NSValue(size: NSSize(width: arr[0], height: arr[1]))
            }
            return NSValue(size: .zero)
        case 22: // UIEdgeInsets
            if let arr = value as? [Double], arr.count == 4 {
                let insets = NSEdgeInsets(top: CGFloat(arr[0]), left: CGFloat(arr[1]), bottom: CGFloat(arr[2]), right: CGFloat(arr[3]))
                return NSValue(edgeInsets: insets)
            }
            return NSValue(edgeInsets: NSEdgeInsets())
        case 27: // UIColor (RGBA array)
            if let arr = value as? [Double], arr.count == 4 {
                return [NSNumber(value: arr[0]), NSNumber(value: arr[1]), NSNumber(value: arr[2]), NSNumber(value: arr[3])] as NSArray
            }
            return [NSNumber(value: 0), NSNumber(value: 0), NSNumber(value: 0), NSNumber(value: 1)] as NSArray
        case 24: // NSString
            return (value as? String ?? "") as NSString
        case 25, 26: // EnumInt, EnumLong
            return NSNumber(value: (value as? Int) ?? 0)
        default:
            return value as AnyObject
        }
    }

    static func jsonToStaticAsyncUpdateTasksPackage(_ json: [String: Any]) -> LookinStaticAsyncUpdateTasksPackage {
        let p = LookinStaticAsyncUpdateTasksPackage()
        if let tasksJSON = json["tasks"] as? [[String: Any]] {
            p.tasks = tasksJSON.map { jsonToStaticAsyncUpdateTask($0) }
        }
        return p
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
            fputs("Available: connection-response, connection-attachment, hierarchy-info, hierarchy-response, hierarchy-response-with-vc\n", stderr)
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
        case "hierarchy-response-with-vc":
            // Hierarchy with ViewController associations: UIWindow → UIView (MainVC) → UITableView
            let vcTableView = LookinDisplayItem()
            let vcTableViewObj = LookinObject()
            vcTableViewObj.oid = 3
            vcTableViewObj.classChainList = ["UITableView", "UIScrollView", "UIView"]
            vcTableViewObj.memoryAddress = "0x2003"
            vcTableView.viewObject = vcTableViewObj
            vcTableView.frame = CGRect(x: 0, y: 44, width: 390, height: 800)
            vcTableView.bounds = CGRect(x: 0, y: 0, width: 390, height: 800)
            vcTableView.isHidden = false
            vcTableView.alpha = 1.0

            let vcContentView = LookinDisplayItem()
            let vcContentViewObj = LookinObject()
            vcContentViewObj.oid = 2
            vcContentViewObj.classChainList = ["UIView"]
            vcContentViewObj.memoryAddress = "0x2002"
            vcContentView.viewObject = vcContentViewObj
            vcContentView.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
            vcContentView.bounds = CGRect(x: 0, y: 0, width: 390, height: 844)
            vcContentView.isHidden = false
            vcContentView.alpha = 1.0
            // Associate with a ViewController
            let mainVCObj = LookinObject()
            mainVCObj.oid = 100
            mainVCObj.classChainList = ["MainViewController", "UIViewController", "UIResponder", "NSObject"]
            mainVCObj.memoryAddress = "0x3001"
            vcContentView.hostViewControllerObject = mainVCObj
            vcContentView.subitems = [vcTableView]

            let vcRootItem = LookinDisplayItem()
            let vcRootViewObj = LookinObject()
            vcRootViewObj.oid = 1
            vcRootViewObj.classChainList = ["UIWindow", "UIView", "UIResponder", "NSObject"]
            vcRootViewObj.memoryAddress = "0x2001"
            vcRootItem.viewObject = vcRootViewObj
            vcRootItem.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
            vcRootItem.bounds = CGRect(x: 0, y: 0, width: 390, height: 844)
            vcRootItem.isHidden = false
            vcRootItem.alpha = 1.0
            vcRootItem.representedAsKeyWindow = true
            vcRootItem.subitems = [vcContentView]

            let vcAppInfo = LookinAppInfo()
            vcAppInfo.appName = "TestApp"
            vcAppInfo.appBundleIdentifier = "com.test.app"
            vcAppInfo.deviceDescription = "iPhone 15 Pro"
            vcAppInfo.osDescription = "iOS 18.0"
            vcAppInfo.osMainVersion = 18
            vcAppInfo.serverVersion = 7
            vcAppInfo.deviceType = .simulator

            let vcHInfo = LookinHierarchyInfo()
            vcHInfo.serverVersion = 7
            vcHInfo.appInfo = vcAppInfo
            vcHInfo.displayItems = [vcRootItem]
            vcHInfo.collapsedClassList = []

            let vcResp = LookinConnectionResponseAttachment()
            vcResp.lookinServerVersion = 7
            vcResp.appIsInBackground = false
            vcResp.dataTotalCount = 1
            vcResp.currentDataCount = 1
            vcResp.dataType = .init(rawValue: 0)!
            vcResp.data = vcHInfo
            obj = vcResp
            expectedJSON = [
                "$class": "LookinConnectionResponseAttachment",
                "lookinServerVersion": 7,
                "data": [
                    "$class": "LookinHierarchyInfo",
                    "serverVersion": 7,
                    "displayItems": [
                        [
                            "$class": "LookinDisplayItem",
                            "viewObject": ["$class": "LookinObject", "oid": 1],
                            "subitems": [
                                [
                                    "$class": "LookinDisplayItem",
                                    "viewObject": ["$class": "LookinObject", "oid": 2],
                                    "hostViewControllerObject": ["$class": "LookinObject", "oid": 100, "className": "MainViewController"],
                                ],
                            ],
                        ],
                    ],
                ] as [String : Any],
            ]

        case "attr-groups-response":
            // LookinConnectionResponseAttachment wrapping NSArray<LookinAttributesGroup>
            let attr1 = LookinAttribute()
            attr1.identifier = "UIView_Class"
            attr1.value = "UILabel" as NSString

            let attr2 = LookinAttribute()
            attr2.identifier = "UIView_Frame"
            attr2.value = NSValue(rect: NSRect(x: 10, y: 20, width: 200, height: 44))

            let attr3 = LookinAttribute()
            attr3.identifier = "UIView_Hidden"
            attr3.value = NSNumber(value: false)

            let attr4 = LookinAttribute()
            attr4.identifier = "UIView_Alpha"
            attr4.value = NSNumber(value: 1.0)

            let section1 = LookinAttributesSection()
            section1.identifier = "UIView_Section_0"
            section1.attributes = [attr1, attr2]

            let section2 = LookinAttributesSection()
            section2.identifier = "UIView_Section_1"
            section2.attributes = [attr3, attr4]

            let group1 = LookinAttributesGroup()
            group1.identifier = "UIView"
            group1.attrSections = [section1, section2]

            let attr5 = LookinAttribute()
            attr5.identifier = "CALayer_CornerRadius"
            attr5.value = NSNumber(value: 8.0)

            let section3 = LookinAttributesSection()
            section3.identifier = "CALayer_Section_0"
            section3.attributes = [attr5]

            let group2 = LookinAttributesGroup()
            group2.identifier = "CALayer"
            group2.attrSections = [section3]

            let attrGroupList: NSArray = [group1, group2]

            let attrResp = LookinConnectionResponseAttachment()
            attrResp.lookinServerVersion = 7
            attrResp.appIsInBackground = false
            attrResp.dataTotalCount = 1
            attrResp.currentDataCount = 1
            attrResp.dataType = .init(rawValue: 0)!
            attrResp.data = attrGroupList
            obj = attrResp
            expectedJSON = [
                "$class": "LookinConnectionResponseAttachment",
                "lookinServerVersion": 7,
                "data": [
                    ["$class": "LookinAttributesGroup", "identifier": "UIView"],
                    ["$class": "LookinAttributesGroup", "identifier": "CALayer"],
                ] as [[String: Any]],
            ]

        case "screenshot-response":
            // LookinConnectionResponseAttachment wrapping NSArray<LookinDisplayItemDetail>
            let detail = LookinDisplayItemDetail()
            detail.displayItemOid = 42
            detail.frameValue = NSValue(rect: NSRect(x: 10, y: 20, width: 200, height: 44))
            detail.boundsValue = NSValue(rect: NSRect(x: 0, y: 0, width: 200, height: 44))
            detail.hiddenValue = NSNumber(value: false)
            detail.alphaValue = NSNumber(value: 1.0)
            // Create a tiny 2x2 red PNG as screenshot
            let img = NSImage(size: NSSize(width: 2, height: 2))
            img.lockFocus()
            NSColor.red.setFill()
            NSBezierPath.fill(NSRect(x: 0, y: 0, width: 2, height: 2))
            img.unlockFocus()
            detail.groupScreenshot = img
            detail.soloScreenshot = img

            let screenshotResp = LookinConnectionResponseAttachment()
            screenshotResp.lookinServerVersion = 7
            screenshotResp.appIsInBackground = false
            screenshotResp.dataTotalCount = 1
            screenshotResp.currentDataCount = 1
            screenshotResp.dataType = .init(rawValue: 0)!
            screenshotResp.data = [detail] as NSArray
            obj = screenshotResp
            expectedJSON = [
                "$class": "LookinConnectionResponseAttachment",
                "lookinServerVersion": 7,
                "data": [
                    ["$class": "LookinDisplayItemDetail", "displayItemOid": 42],
                ] as [[String: Any]],
            ]

        default:
            fputs("Unknown fixture: \(fixtureName)\n", stderr)
            fputs("Available: connection-response, connection-attachment, hierarchy-info, hierarchy-response, hierarchy-response-with-vc, attr-groups-response, screenshot-response\n", stderr)
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
        case let detail as LookinDisplayItemDetail:
            return displayItemDetailToJSON(detail)
        case let group as LookinAttributesGroup:
            return attributesGroupToJSON(group)
        case let section as LookinAttributesSection:
            return attributesSectionToJSON(section)
        case let attr as LookinAttribute:
            return attributeToJSON(attr)
        case let task as LookinStaticAsyncUpdateTask:
            return staticAsyncUpdateTaskToJSON(task)
        case let pkg as LookinStaticAsyncUpdateTasksPackage:
            return staticAsyncUpdateTasksPackageToJSON(pkg)
        case let connAttachment as LookinConnectionAttachment:
            return connectionAttachmentToJSON(connAttachment)
        case let image as NSImage:
            return imageToBase64PNG(image) ?? NSNull()
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

    static func displayItemDetailToJSON(_ d: LookinDisplayItemDetail) -> [String: Any] {
        var result: [String: Any] = [
            "$class": "LookinDisplayItemDetail",
            "displayItemOid": d.displayItemOid,
            "failureCode": d.failureCode,
        ]
        if let frame = d.frameValue { result["frame"] = rectToJSON(frame.rectValue) }
        if let bounds = d.boundsValue { result["bounds"] = rectToJSON(bounds.rectValue) }
        if let hidden = d.hiddenValue { result["isHidden"] = hidden.boolValue }
        if let alpha = d.alphaValue { result["alpha"] = alpha.doubleValue }
        if let title = d.customDisplayTitle { result["customDisplayTitle"] = title }
        if let groupImg = d.groupScreenshot { result["groupScreenshot"] = imageToBase64PNG(groupImg) ?? NSNull() }
        if let soloImg = d.soloScreenshot { result["soloScreenshot"] = imageToBase64PNG(soloImg) ?? NSNull() }
        if let groups = d.attributesGroupList, !groups.isEmpty {
            result["attributesGroupList"] = groups.map { objectToJSON($0) }
        }
        if let customGroups = d.customAttrGroupList, !customGroups.isEmpty {
            result["customAttrGroupList"] = customGroups.map { objectToJSON($0) }
        }
        if let subitems = d.subitems {
            result["subitems"] = subitems.map { objectToJSON($0) }
        }
        return result
    }

    static func imageToBase64PNG(_ image: NSImage) -> String? {
        guard let tiffData = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData),
              let pngData = bitmap.representation(using: .png, properties: [:]) else {
            return nil
        }
        return pngData.base64EncodedString()
    }

    static func staticAsyncUpdateTaskToJSON(_ t: LookinStaticAsyncUpdateTask) -> [String: Any] {
        return [
            "$class": "LookinStaticAsyncUpdateTask",
            "oid": t.oid,
            "taskType": t.taskType.rawValue,
            "attrRequest": t.attrRequest.rawValue,
            "needBasisVisualInfo": t.needBasisVisualInfo,
            "needSubitems": t.needSubitems,
        ]
    }

    static func staticAsyncUpdateTasksPackageToJSON(_ p: LookinStaticAsyncUpdateTasksPackage) -> [String: Any] {
        var result: [String: Any] = ["$class": "LookinStaticAsyncUpdateTasksPackage"]
        if let tasks = p.tasks {
            result["tasks"] = tasks.map { objectToJSON($0) }
        }
        return result
    }
}
