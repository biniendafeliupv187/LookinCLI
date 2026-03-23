## Tool Call Plan

Tool 1: search
Parameters: `{ "query": "UIButton" }`
Reason: 使用 search 工具快速在当前页面的视图层级中搜索所有类名包含 "UIButton" 的视图，返回匹配的视图列表（包含每个视图的 identifier/objectId），方便后续选择某一个深入查看。已知类名的情况下，search 比遍历完整 get_hierarchy 结果更高效。

Tool 2: get_view
Parameters: `{ "view_id": "<从第一步结果中选取的某个 UIButton 的 objectId>" }`
Reason: 拿到所有 UIButton 的列表后，从中挑选一个感兴趣的（例如根据 frame 位置或标题判断），用其 objectId 调用 get_view，获取该按钮的完整详细属性（frame、backgroundColor、title、hidden、alpha、constraints 等）。

---

## Response to User

好的，分两步来做：

**第一步：搜索所有 UIButton**

调用 `search` 工具，查询关键词为 `"UIButton"`，它会扫描当前页面的完整视图树，返回所有类名匹配 UIButton（包括其子类）的视图，列出它们的 objectId、frame、所在层级等基本信息。

**第二步：查看某个 UIButton 的详细属性**

从第一步返回的列表里，根据 frame 位置或其他信息挑一个你感兴趣的按钮，拿到它的 `objectId`，再调用 `get_view` 传入该 id，即可获取这个按钮的所有详细属性，包括：
- 尺寸与位置（frame / bounds）
- 标题文字、字体、颜色
- 背景色、图片
- hidden / alpha / userInteractionEnabled
- 约束（Auto Layout constraints）
- 以及其他自定义属性

这样就实现了「先批量定位，再精准查看」的工作流。需要我现在执行吗？
