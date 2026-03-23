## Tool Call Plan

Tool 1: `search`
Parameters:
```json
{
  "query": "UIButton"
}
```
Reason: 用户已经明确知道目标 class name 是 `UIButton`，根据 SKILL.md 路由规则第 2 条："如果用户给了 class name，比如 UIButton、UILabel、UITableViewCell、controller 名，或者像 memory address 的字符串，优先先用 `search`。" 直接用 `search` 可以快速定位所有匹配节点，避免拉取完整 hierarchy 带来的无谓开销。

Tool 2: `get_view`
Parameters:
```json
{
  "layerOid": "<用户从 search 结果中选中的那个 UIButton 的 layerOid>"
}
```
Reason: 用户说"再挑一个继续看它的详细属性"，这对应 SKILL.md 中"查找目标 view 并看详情"模式的第 2 步：用选中节点的 `layerOid` 调 `get_view`。注意必须用 `layerOid` 而不是 `oid`，这是 `get_view` 唯一接受的标识符形式。

---

## Response to User

**第一步：用 `search` 快速找出所有 UIButton**

因为你已经知道目标 class name 是 `UIButton`，我会直接调用 `search`（参数 `query: "UIButton"`），不需要先拉整棵 hierarchy 树。`search` 会返回当前页面上所有匹配 `UIButton` 的节点列表，每个节点会带有它的 `layerOid`、frame、以及在树中的层级位置。

**第二步：你挑一个，我用 `get_view` 看它的详细属性**

从 `search` 结果里，你告诉我你感兴趣的是哪一个 UIButton（可以根据位置、大小、或者它的 `layerOid` 来识别），我再用该节点的 `layerOid` 调用 `get_view`，就能拿到它完整的属性列表，包括 frame、alpha、hidden、backgroundColor、border、corner radius 等。

**注意事项：**
- `get_view` 需要的是 `layerOid`，不是 `oid`，两者不能混用，用错会报错或返回错误节点。
- 如果页面刚发生过跳转或结构变化，`search` 结果可能基于缓存；这时可以先调 `reload` 再搜索，确保数据是最新的。
