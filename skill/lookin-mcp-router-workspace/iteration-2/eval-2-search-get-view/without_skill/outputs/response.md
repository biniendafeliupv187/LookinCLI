## Tool Call Plan

Tool 1: search
Parameters: `{ "query": "UIButton" }`
Reason: 使用 search 工具快速在当前页面的视图层级中搜索所有类名为 UIButton 的视图。这比先调用 get_hierarchy 再手动过滤更高效，能直接返回所有匹配的 UIButton 实例及其基本信息（包括每个 button 的 identifier/objectId）。

Tool 2: get_view
Parameters: `{ "view_id": "<从 search 结果中选取的某个 UIButton 的 id>" }`
Reason: 在拿到所有 UIButton 的列表后，用户可以从中挑选一个感兴趣的。用该 button 的 view_id 调用 get_view，可以获取该控件完整的详细属性，包括 frame、bounds、hidden、alpha、backgroundColor、title、enabled 状态等，满足"继续看它的详细属性"的需求。

---

## Response to User

好的，推荐两步走：

**第一步：搜索所有 UIButton**

调用 `search` 工具，参数 `query` 填 `"UIButton"`，它会扫描当前页面视图树，返回所有类型为 UIButton 的视图列表，每条结果包含视图的 id、类名、简要位置信息。

**第二步：查看某个 UIButton 的详细属性**

从第一步的结果里找到你感兴趣的那个 UIButton，复制它的 `view_id`，再调用 `get_view` 工具，参数填该 `view_id`。返回结果会包含该 button 的完整属性：frame/bounds、alpha、hidden、backgroundColor、titleLabel 文字、isEnabled、layer 信息等。

这样"先批量定位、再精准查看"，效率最高。
