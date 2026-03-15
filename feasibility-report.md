# Lookin MCP Server — 技术可行性报告

## 一、结论：完全可行 ✅

将 Lookin 客户端能力封装为 MCP Server，让 Claude 等 AI 以自然语言驱动 iOS UI 调试，**技术上完全可行**。核心发现：

| 维度 | 评估 | 说明 |
|------|------|------|
| 协议逆向 | ✅ 完全可复刻 | 16 字节帧头 + NSKeyedArchiver payload |
| 序列化格式 | ⚠️ 需要桥接 | NSKeyedArchiver 是 Apple 私有格式，但有成熟方案绕过 |
| 端口发现 | ✅ 简单 | 固定端口范围扫描（模拟器 47164-47169，真机 47175-47179） |
| 功能覆盖 | ✅ 14 个 RPC 接口全部可封装 | 从获取层级到修改属性到执行方法 |
| 你的技术栈匹配度 | ✅ 极高 | iOS + TS 双栈正好覆盖两端 |

---

## 二、架构概览 — 已确认的事实

### 2.1 LookinServer 本质

LookinServer 是嵌入 iOS App 的 **TCP RPC 服务端**：
- 基于 **Peertalk** 框架（非 Bonjour），直接绑定 TCP 端口监听
- 模拟器端口：`47164-47169`，真机 USB 端口：`47175-47179`
- 帧协议：16 字节固定头 + payload

### 2.2 帧格式（完全逆向）

```
┌──────────┬──────────┬──────────┬──────────────┐
│ version  │  type    │  tag     │ payloadSize  │
│ uint32   │ uint32   │ uint32   │ uint32       │
│ 4 bytes  │ 4 bytes  │ 4 bytes  │ 4 bytes      │
└──────────┴──────────┴──────────┴──────────────┘
│           payload (payloadSize bytes)          │
└────────────────────────────────────────────────┘
```

- 所有字段使用 **网络字节序**（Big Endian）
- `type`: 请求类型编号（200-304）
- `tag`: 请求-响应匹配标签（客户端用时间戳生成）
- `payload`: **NSKeyedArchiver** 编码的二进制数据

### 2.3 支持的 RPC 操作（14 个）

| Type ID | 名称 | 功能 | MCP Tool 价值 |
|---------|------|------|---------------|
| 200 | Ping | 检测连接/App 状态 | 🔧 内部使用 |
| 201 | App | 获取 App 信息、截图、图标 | ⭐ `get_app_info` |
| 202 | Hierarchy | **获取完整视图层级树** | ⭐⭐⭐ `dump_hierarchy` |
| 203 | HierarchyDetails | 异步获取截图+属性详情 | ⭐⭐ `get_view_details` |
| 204 | InbuiltAttrModification | **修改内置属性** (frame/color/hidden等) | ⭐⭐⭐ `modify_view` |
| 205 | AttrModificationPatch | 修改后批量更新截图 | 🔧 内部使用 |
| 206 | InvokeMethod | **执行任意 ObjC 方法** | ⭐⭐⭐ `invoke_method` |
| 207 | FetchObject | 获取对象元数据(类名/ivar) | ⭐⭐ `inspect_object` |
| 208 | FetchImageViewImage | 获取 UIImageView 的图片 | ⭐ `get_image` |
| 209 | ModifyRecognizerEnable | 开关手势识别器 | ⭐ `toggle_gesture` |
| 210 | AllAttrGroups | 列出所有属性分组 | ⭐⭐ `list_attributes` |
| 213 | AllSelectorNames | 列出类的所有方法 | ⭐⭐ `list_methods` |
| 214 | CustomAttrModification | 修改自定义属性 | ⭐ `modify_custom_attr` |
| 304 | CancelHierarchyDetails | 取消详情请求 | 🔧 内部使用 |

### 2.4 数据模型（NSSecureCoding 序列化）

```
LookinHierarchyInfo                    ← 根节点
  ├─ appInfo: LookinAppInfo            ← App/设备信息
  ├─ displayItems: [LookinDisplayItem] ← UIWindow 数组
  │   ├─ viewObject: LookinObject      ← UIView 元数据 (oid, className)
  │   ├─ layerObject: LookinObject     ← CALayer 元数据
  │   ├─ frame, bounds, isHidden, alpha
  │   ├─ backgroundColor: [r,g,b,a]
  │   ├─ soloScreenshot / groupScreenshot: NSData(PNG)
  │   ├─ attributesGroupList: [LookinAttributesGroup]
  │   │   └─ sections → attributes → {identifier, attrType, value}
  │   ├─ eventHandlers: [LookinEventHandler]
  │   └─ subitems: [LookinDisplayItem] ← 递归子视图
  └─ colorAlias, collapsedClassList
```

所有编码键已完全逆向（使用可读字符串键如 `"subitems"`, `"frame"`, `"viewObject"` 等）。

---

## 三、核心技术难点 & 解决方案

### 难点 1: NSKeyedArchiver 序列化格式 (最大障碍)

**问题**：LookinServer 使用 `NSKeyedArchiver` 进行 payload 序列化，这是 Apple 私有的二进制 plist 格式，内部有 `$archiver`, `$objects`, `$top` 等特殊键维护对象图。

**三种解决方案（推荐度排序）**：

#### 方案 A: Swift/ObjC 原生桥接 CLI（⭐⭐⭐ 推荐）

```
Claude ←MCP(stdio/JSON)→ TypeScript MCP Server ←spawn→ Swift CLI Bridge
                                                           ↕ (TCP/Peertalk)
                                                       iOS LookinServer
```

- 用 Swift 写一个轻量 CLI 工具，复用 LookinServer 已有的 Shared 代码（LookinDisplayItem, LookinConnectionAttachment 等）
- CLI 通过 stdin/stdout 与 TS MCP Server 通信，使用 JSON
- **优势**：零序列化风险，直接复用源码，NSCoding 兼容性 100%
- **工作量评估**：Swift CLI ~500 行 + TS MCP Server ~800 行

#### 方案 B: 纯 TypeScript 实现（⚠️ 有风险但可行）

```
Claude ←MCP(stdio/JSON)→ TypeScript MCP Server ←TCP→ iOS LookinServer
```

- 用 Node.js 的 `bplist-parser` / `bplist-creator` 解析和构建 Binary Plist
- 手动实现 NSKeyedArchiver 的 `$archiver/$objects/$top` 对象图格式
- **优势**：纯 TS 单体部署，最简架构
- **风险**：NSKeyedArchiver 的对象引用图（UID）处理比较复杂，尤其是嵌套的 LookinDisplayItem 递归树
- **工作量评估**：~2000 行 TypeScript（含 NSKeyedArchiver 编解码器）

#### 方案 C: 修改 LookinServer 支持 JSON（⚠️ 侵入性大）

- 在 LookinServer 增加 JSON 序列化支持，新的 frameType 表示 JSON payload
- **优势**：彻底消除序列化难题
- **劣势**：需要修改并重新集成 LookinServer Pod，影响上游兼容性

### 难点 2: USB 设备通信

- 模拟器通过 localhost TCP 直连，**零难度**
- 真机 USB 需要通过 `usbmuxd` 协议转发端口（macOS 内置服务）
- Node.js 可通过 Unix Socket `/var/run/usbmuxd` 与 usbmuxd 通信
- 已有 npm 包 `node-usbmux` 可用

### 难点 3: 多响应流（HierarchyDetails）

- Type 203 返回多个响应帧（进度式），需要累加 `currentDataCount` 直到等于 `dataTotalCount`
- 在 MCP 中可以封装为一次性等待，对外暴露为单次 tool 调用

---

## 四、推荐技术方案 & 架构设计

### 推荐方案 A: **TypeScript MCP Server + Swift Bridge CLI**

这是最稳健的方案，结合你 iOS + TS 双栈经验。

#### 架构图

```
┌────────────────────────────────────────────────────────────────┐
│  Claude / AI Agent                                              │
│  (自然语言: "把这个按钮的背景色改成红色")                           │
└─────────────────────┬──────────────────────────────────────────┘
                      │ MCP Protocol (stdio, JSON-RPC)
                      ▼
┌────────────────────────────────────────────────────────────────┐
│  TypeScript MCP Server  (Node.js)                               │
│                                                                 │
│  Tools:                                                         │
│  ├─ list_devices()          → 扫描端口，返回可用 App 列表        │
│  ├─ dump_hierarchy()        → 获取 UI 树，返回结构化 JSON        │
│  ├─ get_view_details(oid)   → 获取指定 view 详细属性             │
│  ├─ modify_view(oid, prop, value)  → 实时修改 view 属性         │
│  ├─ invoke_method(oid, selector, args)  → 执行 ObjC 方法        │
│  ├─ inspect_object(oid)     → 获取对象反射信息                   │
│  ├─ list_methods(className) → 列出类的所有方法                   │
│  ├─ get_screenshot(oid)     → 获取 view 截图(base64)            │
│  └─ search_view(query)      → 按类名/文本搜索 view              │
│                                                                 │
│  Transport Layer:                                               │
│  ├─ SimulatorConnection (TCP to localhost:47164-47169)          │
│  └─ USBConnection (usbmuxd → port forward → 47175-47179)       │
│                                                                 │
│  Serialization:                                                 │
│  └─ SwiftBridge (spawn lookin-bridge CLI)                       │
│     ├─ encode(JSON) → NSKeyedArchiver binary                   │
│     └─ decode(NSKeyedArchiver binary) → JSON                   │
└────────────────────────────────────────────────────────────────┘
                      │ TCP Socket (Peertalk framing)
                      ▼
┌────────────────────────────────────────────────────────────────┐
│  iOS App + LookinServer (已有，无需修改)                         │
│  监听端口 47164-47179                                           │
│  处理 14 种 RPC 请求                                             │
└────────────────────────────────────────────────────────────────┘
```

#### 组件分工

| 组件 | 语言 | 职责 | 代码量估算 |
|------|------|------|-----------|
| `lookin-mcp-server` | TypeScript | MCP 协议处理、Tool 定义、TCP 连接管理、帧收发 | ~800 行 |
| `lookin-bridge` | Swift | NSKeyedArchiver 编解码、复用 Lookin Shared 模型 | ~500 行 |
| 帧协议层 | TypeScript | 16 字节帧头解析/构建 (Buffer 操作) | ~150 行 |
| 设备发现 | TypeScript | 端口扫描 + usbmuxd 转发 | ~200 行 |

---

## 五、MCP Tools 设计

### 5.1 核心 Tools（AI 调试闭环）

```typescript
// 1. 发现设备上运行的 App
tool: "list_apps"
→ 扫描端口，返回 [{appName, bundleId, device, port, screenshot_base64}]

// 2. 获取 UI 层级树（核心！）
tool: "dump_hierarchy"
params: { app_port: number, max_depth?: number }
→ 返回精简 JSON 树:
  { className, oid, frame, isHidden, alpha, text?, children[] }

// 3. 获取 view 详细属性
tool: "get_view_attributes"
params: { app_port: number, oid: number }
→ 返回所有属性分组 [{group, attrs: [{name, type, value, editable}]}]

// 4. 修改 view 属性（实时生效！）
tool: "modify_view"
params: { app_port: number, oid: number, property: string, value: any }
→ 通过 KVC 修改属性，返回更新后状态
→ 示例: modify_view(oid=123, property="backgroundColor", value=[1,0,0,1])

// 5. 执行 ObjC 方法
tool: "invoke_method"
params: { app_port: number, oid: number, selector: string }
→ 返回方法执行结果

// 6. 搜索 view
tool: "search_views"
params: { app_port: number, class_name?: string, text?: string }
→ 在 hierarchy 中过滤，返回匹配的 view 列表
```

### 5.2 使用场景示例

```
用户: "帮我看看当前页面的按钮为什么看不见"

Claude:
1. 调用 list_apps() → 找到运行中的 App
2. 调用 dump_hierarchy() → 获取 UI 树
3. 分析树结构，找到 UIButton
4. 发现 button.isHidden = true 或 alpha = 0
5. 调用 modify_view(oid, "hidden", false) → 实时显示按钮
6. 回复: "按钮被设置了 hidden=true，我已经帮你显示出来了，请看效果"
```

---

## 六、执行步骤（按优先级排序）

### Phase 1: Swift Bridge CLI（1-2 天）

```
1. 创建 Swift Package，引用 LookinServer/Src/Main/Shared/ 源文件
2. 实现 stdin/stdout JSON↔NSKeyedArchiver 双向转换
3. 支持的操作:
   - encode: JSON → NSKeyedArchiver Data (base64)
   - decode: NSKeyedArchiver Data (base64) → JSON
4. 单元测试: 编码 LookinConnectionAttachment, LookinAttributeModification 等
```

### Phase 2: TypeScript MCP Server 骨架（1 天）

```
1. npm init, 依赖: @modelcontextprotocol/sdk
2. 实现 Peertalk 帧协议 (16 字节帧头读写)
3. 实现 TCP 连接管理 (net.Socket)
4. 与 Swift Bridge 进程通信 (child_process.spawn)
5. 端口扫描逻辑 (模拟器端口 47164-47169)
```

### Phase 3: 核心 Tools 实现（2-3 天）

```
1. list_apps — 端口扫描 + Ping + RequestTypeApp
2. dump_hierarchy — RequestTypeHierarchy → JSON 树
3. get_view_attributes — RequestTypeAllAttrGroups
4. modify_view — RequestTypeInbuiltAttrModification
5. invoke_method — RequestTypeInvokeMethod
```

### Phase 4: 增强功能（1-2 天）

```
1. USB 真机支持 (usbmuxd)
2. 截图获取 (base64 PNG)
3. search_views (本地过滤)
4. 连接保活 & 重连
```

### Phase 5: AI 工作流优化（持续）

```
1. 优化 dump_hierarchy 输出格式（适合 AI 消费）
2. 添加 Resource 类型（如实时截图 URI）
3. 封装常用操作为 Prompt 模板
```

---

## 七、风险与缓解

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| NSKeyedArchiver 版本不兼容 | 低 | 高 | 方案 A 直接复用源码，无此风险 |
| LookinServer 版本升级改协议 | 低 | 中 | 版本号协商机制已内置 (version=7) |
| 大型 App 层级树过大 | 中 | 中 | dump_hierarchy 加 max_depth 限制 |
| USB 连接不稳定 | 中 | 低 | 先聚焦模拟器场景，USB 作为增强 |
| MCP 单次 tool 响应超时 | 低 | 中 | HierarchyDetails 聚合后再返回 |

---

## 八、与纯 TypeScript 方案 (方案 B) 的对比

| 对比维度 | 方案 A (TS + Swift Bridge) | 方案 B (纯 TypeScript) |
|---------|--------------------------|----------------------|
| NSCoding 兼容性 | 100%（原生） | ~90%（需手写编解码器） |
| 开发速度 | ⭐⭐⭐ 快 | ⭐⭐ 中等 |
| 部署复杂度 | 需 Swift 编译 | 纯 npm 安装 |
| 维护成本 | 低（Shared 代码跟随更新） | 高（协议变更需手动同步） |
| 调试便利性 | 可用 Xcode 调试 Bridge | 全 VS Code |
| 适合你的技术栈 | ✅ iOS + TS | ⚠️ 需深入理解 bplist |

**最终推荐：方案 A**，因为你有 iOS 开发经验，Swift Bridge 对你来说开发成本极低，且能保证 100% 协议兼容。

---

## 九、项目结构建议

```
LookinMCP/
├── package.json                    # MCP Server (TypeScript)
├── tsconfig.json
├── src/
│   ├── index.ts                    # MCP Server 入口
│   ├── tools/                      # MCP Tool 定义
│   │   ├── list-apps.ts
│   │   ├── dump-hierarchy.ts
│   │   ├── modify-view.ts
│   │   └── invoke-method.ts
│   ├── connection/
│   │   ├── peertalk-frame.ts       # 帧协议实现 (Buffer)
│   │   ├── device-scanner.ts       # 端口扫描
│   │   └── connection-manager.ts   # TCP 连接管理
│   └── bridge/
│       └── swift-bridge.ts         # Swift CLI 进程管理
├── LookinBridge/                   # Swift Package
│   ├── Package.swift
│   └── Sources/
│       ├── main.swift              # CLI 入口 (stdin/stdout JSON)
│       ├── Encoder.swift           # JSON → NSKeyedArchiver
│       └── Decoder.swift           # NSKeyedArchiver → JSON
│       └── Shared/                 # 软链接到 LookinServer/Src/Main/Shared/
└── README.md
```

---

## 十、总结

Lookin 的协议设计清晰、端口策略简单、RPC 接口丰富——这是一个**理想的 MCP 封装对象**。你作为 iOS + TS 双栈开发者，是执行这个方案的最佳人选。Swift Bridge + TS MCP Server 的混合架构兼顾了**协议兼容性**和 **AI 生态对接能力**，预计 **5-7 个工作日**可以实现核心功能的 MVP。
