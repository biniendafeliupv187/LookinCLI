## Tool Call Plan

Tool 1: `get_hierarchy`
Parameters:
```json
{
  "format": "text"
}
```
Reason: 用户要求查看当前连接的 iOS App 的界面层级，并且明确说"适合人看的精简树，不用 JSON"。根据 SKILL.md 路由规则第 4 条，调用 `get_hierarchy` 时必须显式传 `format: "text"`，不能省略，省略可能导致返回大段 JSON，正好与用户期望相反。此场景属于"查看整体结构"的标准路径，无需先调 `status`（用户没有反映连接问题），也无需先调 `search`（用户没有给出具体 class name 或 address）。一次 `get_hierarchy(format: "text")` 即可完整满足需求，是最短正确链路。

---

## Response to User

调用 `get_hierarchy`（`format: "text"`）后，我会把返回的文本树直接呈现给你，类似这样的形式：

```
UIWindow
└── UINavigationController
    ├── UINavigationBar
    │   └── UILabel (title)
    └── UIViewController (YourViewController)
        └── UIView
            ├── UITableView
            │   ├── UITableViewCell
            │   │   ├── UILabel
            │   │   └── UIImageView
            │   └── UITableViewCell
            │       └── UILabel
            └── UIButton
```

（以上是示意结构，实际内容以 tool 返回为准。）

如果结构比较深、节点很多，我会适当折叠不重要的层级，只保留关键节点，方便你快速定位目标区域。如果你之后想看某个具体节点的详细属性，告诉我它的 class name 或位置，我可以进一步用 `search` 或 `get_view` 帮你深挖。
