## 1. 数据暴露：viewMemoryAddress + ivarTrace

- [x] 1.1 扩展 `lookin-cli-service.ts` 的 `search` 结果，新增 `viewMemoryAddress` 字段（从 `viewObj?.memoryAddress` 读取）
- [x] 1.2 扩展 `lookin-cli-service.ts` 的 `toViewNode()`，在 JSON 输出中新增 `viewMemoryAddress` 字段（无 viewObject 时为 null）
- [x] 1.3 扩展 `lookin-cli-service.ts` 的 `getView()`，解析并返回 `specialTrace` 和 `ivarTraces` 字段
- [x] 1.4 扩展 `get_hierarchy` 文本输出，当节点有 ivarTrace 数据时在行末追加 `[OwnerClass._ivarName]` 注解
- [x] 1.5 在 `command-definitions.ts` 中更新 `get_hierarchy` JSON output 的 ViewNode 类型注释以反映新字段

## 2. 扩展 modify_view：图层高级属性

- [x] 2.1 在 `lookin-cli-service.ts` 的 `ATTR_WHITELIST` 中新增 9 个图层属性映射（`cornerRadius`/`borderWidth`/`borderColor`/`shadowColor`/`shadowOpacity`/`shadowRadius`/`shadowOffsetX`/`shadowOffsetY`/`masksToBounds`，含 setter、attrType、target: 'layer'）
- [x] 2.2 在 `command-definitions.ts` 的 `modifyViewInputShape` 中扩展 `attribute` 枚举，新增 9 个属性值
- [x] 2.3 在 `lookin-cli-service.ts` 的 `validateValue()` 中为新属性添加验证逻辑（number 类型、UIColor 数组格式、boolean）

## 3. 扩展 get_view：includeConstraints 参数

- [x] 3.1 在 `lookin-cli-service.ts` 的 `getView()` 中解析 `attributesGroupList` 里的 `LookinAutoLayoutConstraint` 数据
- [x] 3.2 实现 `NSLayoutAttribute` 枚举值到可读字符串的映射函数（`1=left, 2=right, 3=top` 等）
- [x] 3.3 在 `command-definitions.ts` 的 `getViewInputShape` 中新增 `includeConstraints?: boolean` 可选参数
- [x] 3.4 在 `getView()` 中当 `includeConstraints: true` 时将解析后的约束数组追加到返回结果

## 4. 截图持久化（get_screenshot 落盘）

- [x] 4.1 在 `lookin-cli-service.ts` 中实现 `saveScreenshotToDisk(base64: string, className: string): Promise<string>` 共享函数，写入 `~/LookinCLI/screenshots/{timestamp}_{className}.png`，目录不存在时自动创建
- [x] 4.2 在 `getScreenshot()` 的 execute 逻辑中调用 `saveScreenshotToDisk`，并在返回结果中追加 `savedPath` 字段

## 5. 新 Tool：get_memory_address

- [x] 5.1 在 `lookin-cli-service.ts` 中实现 `getMemoryAddress()` 方法，支持 `query`/`text`/`viewOid` 三种输入模式，至少一个参数必须提供
- [x] 5.2 在 `command-definitions.ts` 中新增 `getMemoryAddressCommand` 定义（inputShape、execute、toMcpContent）
- [x] 5.3 在 `mcp/index.ts` 中注册 `get_memory_address` tool

## 6. 新 Tool：measure_distance

- [x] 6.1 在 `lookin-cli-service.ts` 中实现 `calculateFrameToRoot(oid)` 辅助函数，沿层级树向上累加 origin，换算到根坐标系
- [x] 6.2 实现 `measureDistance(oidA, oidB)` 方法：通过两次 `getView` 取 frame，换算坐标系后计算四方向间距，返回 `top/bottom/left/right` 和 `relationship` 枚举
- [x] 6.3 在 `command-definitions.ts` 中新增 `measureDistanceCommand` 定义
- [x] 6.4 在 `mcp/index.ts` 中注册 `measure_distance` tool

## 7. 新 Tool：get_event_handlers

- [x] 7.1 在 `lookin-cli-service.ts` 中实现 `getEventHandlers(oid)` 方法，通过 `AllAttrGroups(210)` 请求获取 `LookinDisplayItemDetail.eventHandlers` 并解析
- [x] 7.2 实现 `LookinEventHandler` 解码：区分 `targetAction` 和 `gesture` 两种类型，提取 `recognizerOid`
- [x] 7.3 在 `command-definitions.ts` 中新增 `getEventHandlersCommand` 定义
- [x] 7.4 在 `mcp/index.ts` 中注册 `get_event_handlers` tool

## 8. 新 Tool：get_methods

- [x] 8.1 确认 `AllSelectorNames(213)` 协议的请求 payload 格式（`className + hasArg`），检查 bridge encode 是否支持（如不支持，在 `main.swift` 中新增 case）
- [x] 8.2 在 `lookin-cli-service.ts` 中实现 `getMethods({ oid?, className?, includeArgs? })` 方法：当提供 oid 时先从缓存/`getView` 取 className，再调用 `AllSelectorNames(213)`
- [x] 8.3 在 `command-definitions.ts` 中新增 `getMethodsCommand` 定义（oid 和 className 至少一个必须提供的验证逻辑）
- [x] 8.4 在 `mcp/index.ts` 中注册 `get_methods` tool

## 9. 新 Tool：get_image

- [x] 9.1 确认 `FetchImageViewImage(208)` 协议的请求 payload 格式（`layerOid`），检查 bridge encode 支持
- [x] 9.2 在 `lookin-cli-service.ts` 中实现 `getImage(oid)` 方法：通过 oid 找到对应的 `layerOid`，调用协议 208，解码图片 base64 数据
- [x] 9.3 在 `getImage()` 中调用 `saveScreenshotToDisk`（文件名后缀 `_image`），返回 MCP image 块 + `imageSize` + `savedPath`
- [x] 9.4 处理非 UIImageView 的错误返回（从 response 中识别错误并返回描述性消息）
- [x] 9.5 在 `command-definitions.ts` 中新增 `getImageCommand` 定义
- [x] 9.6 在 `mcp/index.ts` 中注册 `get_image` tool

## 10. 新 Tool：toggle_gesture

- [x] 10.1 确认 `ModifyRecognizerEnable(209)` 协议的请求 payload 格式（`recognizerOid + enabled`），检查 bridge encode 支持
- [x] 10.2 在 `lookin-cli-service.ts` 中实现 `toggleGesture({ recognizerOid, enabled })` 方法，调用协议 209，返回操作确认
- [x] 10.3 在 `command-definitions.ts` 中新增 `toggleGestureCommand` 定义
- [x] 10.4 在 `mcp/index.ts` 中注册 `toggle_gesture` tool

## 11. 测试与验证

- [x] 11.1 为 `ATTR_WHITELIST` 扩展更新 `modify_view` 相关测试（新属性的 encode 格式验证）
- [x] 11.2 为 `search` 和 `get_hierarchy` 新字段编写单元测试（`viewMemoryAddress` 存在性和 null 场景）
- [x] 11.3 为 `measure_distance` 编写纯逻辑单元测试（各种 separated/overlapping/containing 场景）
- [x] 11.4 更新 `get_hierarchy` 和 `search` 的 tool 描述文字，注明 `viewMemoryAddress` 可与 lldb-mcp 配合使用
- [x] 11.5 更新 `get_view` 的 tool 描述文字，注明 `memoryAddress` 字段可用于 lldb-mcp 表达式调用
