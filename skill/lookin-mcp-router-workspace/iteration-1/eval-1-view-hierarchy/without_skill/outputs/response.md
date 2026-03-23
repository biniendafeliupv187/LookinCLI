## Tool Call Plan

Tool 1: get_hierarchy
Parameters: none (or default parameters — no filtering, full hierarchy)
Reason: This tool retrieves the full view hierarchy of the currently connected iOS app. It is the most direct way to get the UI layer structure. I would call this first to get the raw hierarchy data.

Tool 2: (optional) list_view_controllers
Parameters: none
Reason: If the hierarchy output is too verbose or hard to parse, I might also call list_view_controllers to get a cleaner top-level view controller tree, which provides a good skeleton for the human-readable summary.

Why this approach: The user wants a human-readable, concise tree — not raw JSON. So the plan is:
1. Call get_hierarchy to get the full data.
2. Post-process the result by extracting only the essential fields (class name, frame or identifier if available, indentation level) and formatting them as an indented text tree.
3. Present the result as plain text, trimming verbose or repeated leaf nodes (e.g., CALayer, _UILayoutGuide) to keep it readable.

## Response to User

我会先调用 `get_hierarchy` 获取当前连接 App 的完整界面层级，然后将结果整理成如下风格的精简树（去掉冗余的系统内部视图，只保留关键层级）：

```
UIWindow
└── UINavigationController
    ├── UINavigationBar
    │   └── _UINavigationBarContentView
    └── HomeViewController (UIViewController)
        └── UIView
            ├── UITableView
            │   ├── UITableViewCell [x3]
            │   │   └── UILabel
            │   └── UITableViewCell
            │       ├── UIImageView
            │       └── UILabel
            └── UIButton ("登录")
```

（以上为示意结构，实际内容以 App 真实层级为准。）

请确认当前 Lookin 已连接到目标 iOS App，我就可以立即执行并返回真实结果。
