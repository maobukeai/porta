# Porta 第四轮细化升级方案（效率向：输入历史召回 + 状态快捷过滤 + 面板最近使用）

三个已精确定位的效率增强，全部增量式。移动端行为不变。

## A. 输入框历史召回（空输入按 ↑ 调出上一条发送）

**现状**：mention/slash 菜单关闭时 ↑/↓ 完全落到原生光标移动，无任何历史能力（已确认无既有实现）。

1. 全局发送历史：`porta:inputHistory`（localStorage，最多 20 条，连续去重），在 ChatInput 的 `handleSubmit` 发送点（:540）追加非空文本
2. `handleKeyDown` 在 slash 菜单分支后（:641 后）插入召回分支：DOM 值为空时按 ↑ 进入浏览（index=0 最新）、继续 ↑ 向上翻、↓ 向下翻、翻到底退出并清空；浏览中任意其他按键退出浏览模式。用现有 `setDomAndSync`（:460-481）写值——它已正确处理草稿同步守卫（lastExternalDraft）与高度自适应，程序赋值不触发 input 事件，无回声风险
3. 菜单打开时 ↑↓ 优先菜单（现有分支在前，天然兼容）；Esc 不劫持（走现有链）
4. 快捷键帮助面板登记"↑ 召回上一条发送"；新增单测（追加/去重/翻阅/退出）

## B. 侧边栏状态快捷过滤（只看运行中 / 只看未读）

**现状**：视图排序弹窗（zcode-filter-popover :1196-1272）只有视图/排序两组，无法快速筛出活跃任务。

1. 弹窗新增"快捷过滤"组：只看运行中 / 只看未读 两个开关项（IconCheck 指示，点击不关闭菜单可组合），状态持久化 `porta:sidebarStatusFilter`
2. 过滤管线扩展：`convMatchesFilter` 增加状态判定（运行中 = `summary.status === "CASCADE_RUN_STATUS_RUNNING"`，未读 = unreadIds 且非当前会话——与 renderItem :814-816 同一表达式），`filteredTimeline/filteredGroups` 的激活条件从 filterActive 扩为 filterActive || 任一状态开关；状态过滤时同样强制展开分组；空态提示覆盖状态过滤场景
3. 过滤框下方新增可关闭的状态 chip 行（"运行中 ×"/"未读 ×"，无开关时隐藏，不设媒体查询——移动端也可用）
4. 新增单测（组合过滤、chip 关闭、持久化）

## C. 命令面板最近使用

**现状**：面板空查询固定展示 动作+8 工作区+6 最近会话，无使用记忆。

1. CommandPalette 新增可选 props：`recents`（App 管理，`porta:paletteRecents`，最多 5 条 {kind,id}，去重）与 `onExecute`（在 runItem 顶部回调 :127）
2. 空查询时置顶"最近"分组：recent 条目解析回 action/conversation/workspace 原类型渲染执行；后续 动作/会话 分组排除已出现在最近中的条目避免重复；无法解析（已删除的会话）自动跳过
3. App 侧：onExecute 记录 + localStorage 持久化 + 跨会话恢复
4. 新增单测（记录去重、置顶渲染、解析失败跳过）

## 实施顺序与验证

A → B → C → 验证：`tsc --noEmit` + `vitest run` + `vite build` + dev server 实机复核（浏览器可用则截图，不可用则以单测兜底）。

**改动面**：ChatInput.tsx、Sidebar.tsx、CommandPalette.tsx、App.tsx、ShortcutsHelpOverlay.tsx、desktop.css（chip 行样式）；新增/扩展 3 组单测。均为增量小编辑。

**本轮明确不做**：搜索文内 `<mark>` 注入（round 2 探索已评估为与 dangerouslySetInnerHTML 渲染机制冲突，风险大于收益，维持消息级闪烁高亮）。