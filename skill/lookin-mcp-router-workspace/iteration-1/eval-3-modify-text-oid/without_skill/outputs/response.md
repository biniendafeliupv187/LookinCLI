## Tool Call Plan

Tool 1: `get_hierarchy`
Parameters: (no required parameters; fetches the full view hierarchy of the current screen)
Reason: Since the user did not provide a specific view ID (oid) for the label, the first step is to retrieve the full view hierarchy to identify all UILabel elements on screen and find which one is the target. This gives us the oid needed for modification.

Tool 2: `search`
Parameters: `{ "query": "UILabel" }` (or the label's known current text if available)
Reason: If the hierarchy is large and hard to parse, using `search` to filter for UILabel elements makes it faster to locate the specific label. This is an alternative or supplementary step to `get_hierarchy`.

Tool 3: `modify_view`
Parameters: `{ "oid": "<id found in step 1 or 2>", "property": "text", "value": "Welcome Back" }`
Reason: Once the correct oid for the label is confirmed, `modify_view` is called to temporarily change the label's text to "Welcome Back". Note: `text` modification requires the `oid`, not `layerOid`.

---

If no suitable oid can be identified (e.g., there are multiple labels and it is unclear which one the user means), the additional step would be:

Tool (fallback): `get_screenshot`
Parameters: (none)
Reason: Take a screenshot to visually confirm which label on screen the user is referring to, then present the list of candidate labels with their oids for the user to confirm.

---

## Response to User

要修改这个 label 的文字，需要先拿到它的 **`oid`**（view object id）。你没有提供 oid，所以我会先通过以下步骤定位：

**第一步**：调用 `get_hierarchy` 获取当前屏幕的完整视图层级，找出所有 UILabel 及其 oid。

**第二步**：在结果中定位目标 label（通过当前显示的文字内容或层级位置判断）。

**第三步**：确认 oid 后，调用 `modify_view`：
```json
{
  "oid": "<目标 label 的 oid>",
  "property": "text",
  "value": "Welcome Back"
}
```

注意：修改 `text` 属性必须用 `oid`，不能用 `layerOid`，这是一个常见的坑。

---

**如果层级里有多个 UILabel，不确定哪个是目标：**
1. 我会调用 `get_screenshot` 截图，结合视觉位置辅助判断。
2. 把所有候选 label 的 oid 和当前文字列出来，请你确认是哪一个。

你可以告诉我这个 label 当前显示的文字，或者它在界面中的大概位置（如"首页顶部"、"登录页标题"），这样我能更快锁定目标。
