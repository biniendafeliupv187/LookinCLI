## Tool Call Plan

Tool 1: `get_hierarchy`
Parameters:
- `format: "text"`

Reason: 用户想要的是"适合人看的精简树，不用 JSON"，这正好对应 SKILL.md 中明确推荐的默认路由规则：优先用 `get_hierarchy` 配合 `format: "text"`，因为更适合人读，也更省 token。无需先调 `status`（用户没有提到连接问题），也无需先调 `search`（没有指定具体 class name 或 memory address），直接拉取当前界面的完整 hierarchy 文本树即可。

## Response to User

好的，我用 `get_hierarchy`（text 格式）拉了当前连接 App 的界面层级，以下是精简树：

（此处会展示 tool 返回的 text 格式 hierarchy，例如：）

```
UIWindow
└── UINavigationController
    ├── UINavigationBar
    │   └── _UINavigationBarContentView
    │       ├── UILabel "首页"
    │       └── _UIButtonBarButton
    └── HomeViewController (UIViewController)
        └── UIView
            ├── UITableView
            │   ├── UITableViewCell
            │   │   └── UILabel "最新歌曲"
            │   └── UITableViewCell
            │       └── UILabel "推荐歌单"
            └── UITabBar
                ├── UITabBarButton "首页"
                ├── UITabBarButton "发现"
                └── UITabBarButton "我的"
```

（以上为示例结构，实际内容以 tool 返回为准。）

如果你想深入某个节点的详情、截图某个 view，或者修改某个属性，告诉我目标是哪个，我可以继续操作。
