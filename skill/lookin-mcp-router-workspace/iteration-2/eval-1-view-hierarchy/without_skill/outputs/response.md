## Tool Call Plan

Tool 1: status
Parameters: none (or empty object `{}`)
Reason: 首先确认当前是否有 iOS App 连接上，避免后续调用失败。如果没有连接则直接告知用户。

Tool 2: get_hierarchy
Parameters: none (or empty object `{}`)
Reason: 获取当前界面的完整视图层级数据。这是核心工具，直接返回当前屏幕的 UI 树结构，包含 view controller 和各层级 view 的信息。拿到 JSON 数据后，手动整理成精简的缩进树格式呈现给用户，去掉冗余字段，只保留类名、frame 等关键信息。

---

## Response to User

好的，我会先确认连接状态，再拉取界面层级。整理后的精简树大概长这样（示例格式，实际内容以真实数据为准）：

```
UIWindow (375×812)
└── HomeViewController
    └── UIView (0,0,375,812)
        ├── UINavigationBar (0,44,375,44)
        │   └── UILabel "首页"
        ├── UIScrollView (0,88,375,724)
        │   ├── UIView [卡片区域] (0,0,375,200)
        │   │   ├── UIImageView
        │   │   └── UILabel "推荐歌单"
        │   └── UICollectionView
        │       ├── UICollectionViewCell
        │       └── UICollectionViewCell
        └── UITabBar (0,729,375,83)
            ├── UITabBarButton "发现"
            ├── UITabBarButton "播客"
            └── UITabBarButton "我的"
```

> 注：以上是示意格式。实际调用后会用真实的类名、frame 和层级替换。隐藏视图（hidden=true）和透明度为 0 的视图会过滤掉，只保留可见层级，方便阅读。
