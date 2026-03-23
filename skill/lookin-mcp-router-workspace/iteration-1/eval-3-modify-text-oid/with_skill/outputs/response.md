## Tool Call Plan

Tool 1: `search`
Parameters: `{ "className": "UILabel" }`
Reason: 修改 `text` 属性需要的是 `oid`（view object id），不是 `layerOid`。用户没有提供 `oid`，所以必须先通过 `search` 或 `get_hierarchy` 拿到目标 UILabel 的 `oid`，不能盲目调用 `modify_view`。优先用 `search` 传 class name `UILabel`，可以快速过滤出所有候选节点并显示它们的 `oid`。

备选 Tool 1（如果 search 结果太宽或不够清晰）: `get_hierarchy`
Parameters: `{ "format": "text" }`
Reason: 在完整的 view 树里定位目标 UILabel，读取它的 `oid`。

Tool 2: `modify_view`
Parameters:
```json
{
  "oid": "<从上一步拿到的目标 label 的 oid>",
  "property": "text",
  "value": "Welcome Back"
}
```
Reason: 确认 `oid` 之后，调用 `modify_view` 并传入 `oid`（注意不是 `layerOid`），将 text 设置为 `"Welcome Back"`。

---

## Response to User

要把这个 label 的文字改成 `Welcome Back`，需要先明确一个重要的标识符区分：

**修改 `text` 时，`modify_view` 需要传的是 `oid`（view object id），而不是 `layerOid`。** 其他属性（`hidden`、`alpha`、`frame`、`backgroundColor`）才使用 `layerOid`。

由于你目前没有提供 `oid`，我需要先帮你找到它。流程如下：

### 第一步：找到目标 label 的 `oid`

**方式一（推荐）：用 `search` 按 class name 搜索**

调用 `search`，传入 `UILabel`，列出当前页面所有 UILabel 节点。每个节点会显示 `oid`、`layerOid`、`frame`、当前 text 等信息。如果能从结果中识别出目标 label（根据位置或当前显示文字），就直接拿它的 `oid`。

**方式二：用 `get_hierarchy` 看完整树**

调用 `get_hierarchy`（`format: "text"`），在 view 层级树里找到目标 UILabel 节点，读取 `oid`。

### 第二步：用 `oid` 修改文字

拿到 `oid` 之后：

```
modify_view(oid=<目标label的oid>, property="text", value="Welcome Back")
```

---

你能告诉我这个 label 当前显示的文字、或者它在页面的大概位置吗？这样我在 search 结果里可以更快定位到它。如果你已经有 `oid`，直接给我就可以马上改。
