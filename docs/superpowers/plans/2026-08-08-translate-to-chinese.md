# UI Chinese Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate the Porta mobile/web frontend interface from English to Chinese, including settings page, sidebar, chat input, chat panel, file permissions, subagent states, and desktop notification prompts.

**Architecture:** Modify React TSX components, TypeScript utilities, hooks, and index.html to localize English strings into Chinese.

**Tech Stack:** React 19, Vite, TypeScript.

## Global Constraints
- Do not break existing TypeScript/React code or logic.
- Ensure all tests continue to pass after translation.
- Maintain existing code styles and import paths.

---

### Task 1: Main HTML and App Structure Localization
**Files:**
- Modify: [index.html](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/index.html)
- Modify: [App.tsx](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/App.tsx)

- [ ] **Step 1: Set HTML lang attribute to zh-CN in `index.html`**
  ```html
  <html lang="zh-CN">
  ```
- [ ] **Step 2: Translate default session / new chat titles and empty states in `App.tsx`**
  ```diff
  -    ? (activeConv?.summary.summary ?? "Session")
  -    : "New Chat";
  +    ? (activeConv?.summary.summary ?? "会话")
  +    : "新建对话";
  ```
  ```diff
  -                <div className="chat-empty-text">Start a conversation</div>
  +                <div className="chat-empty-text">开始新对话</div>
  ```
  ```diff
  -                    <IconFolder size={13} /> {projectSlug ?? "Others"}
  +                    <IconFolder size={13} /> {projectSlug ?? "其他"}
  ```
- [ ] **Step 3: Run project tests to verify compilation**
  Run: `pnpm test`
  Expected: All 338 tests pass.
- [ ] **Step 4: Commit changes**
  ```bash
  git add packages/web/index.html packages/web/src/App.tsx
  git commit -m "translate: localize index.html and App.tsx to Chinese"
  ```

### Task 2: Translate Header and Workspace Utility
**Files:**
- Modify: [ChatHeader.tsx](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/components/ChatHeader.tsx)
- Modify: [WorkspaceSelector.tsx](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/components/WorkspaceSelector.tsx)
- Modify: [workspaceNames.ts](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/utils/workspaceNames.ts)

- [ ] **Step 1: Translate header button tooltip in `ChatHeader.tsx`**
  ```diff
  -          title="Open menu"
  +          title="打开菜单"
  ```
- [ ] **Step 2: Translate workspace helper defaults in `workspaceNames.ts`**
  ```diff
  -  if (!workspace) return "Others";
  ...
  -  return uri ? workspaceNameFromUri(uri) : "Others";
  +  if (!workspace) return "其他";
  ...
  +  return uri ? workspaceNameFromUri(uri) : "其他";
  ```
- [ ] **Step 3: Translate fallback label and title in `WorkspaceSelector.tsx`**
  ```diff
  -    workspaces.find((w) => w.uri === selected)?.name ?? "Project";
  ...
  -        title="Select workspace"
  +    workspaces.find((w) => w.uri === selected)?.name ?? "项目";
  ...
  +        title="选择工作区"
  ```
- [ ] **Step 4: Run tests to verify correctness**
  Run: `pnpm test`
  Expected: All 338 tests pass.
- [ ] **Step 5: Commit changes**
  ```bash
  git add packages/web/src/components/ChatHeader.tsx packages/web/src/components/WorkspaceSelector.tsx packages/web/src/utils/workspaceNames.ts
  git commit -m "translate: localize ChatHeader, WorkspaceSelector, and workspaceNames"
  ```

### Task 3: Translate Sidebar & Model Selector Components
**Files:**
- Modify: [Sidebar.tsx](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/components/Sidebar.tsx)
- Modify: [ModelSelector.tsx](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/components/ModelSelector.tsx)

- [ ] **Step 1: Localize relative time rendering in `Sidebar.tsx`**
  ```diff
  -  if (mins < 1) return "just now";
  -  if (mins < 60) return `${mins}m ago`;
  -  const hours = Math.floor(mins / 60);
  -  if (hours < 24) return `${hours}h ago`;
  -  const days = Math.floor(hours / 24);
  -  return `${days}d ago`;
  +  if (mins < 1) return "刚刚";
  +  if (mins < 60) return `${mins}分钟前`;
  +  const hours = Math.floor(mins / 60);
  +  if (hours < 24) return `${hours}小时前`;
  +  const days = Math.floor(hours / 24);
  +  return `${days}天前`;
  ```
- [ ] **Step 2: Translate Workspace name extraction fallback and delete actions in `Sidebar.tsx`**
  ```diff
  -  return name === "Others" ? "No Workspace" : name;
  +  return name === "Others" ? "无工作区" : name;
  ```
  ```diff
  -        Delete
  +        删除
  ```
- [ ] **Step 3: Translate actions list and step metadata strings in `Sidebar.tsx`**
  ```diff
  -    { icon: <IconPlus size={14} />, label: "New Chat", onClick: onNew },
  -    {
  -      icon: <IconSearch size={14} />,
  -      label: "Search",
  +    { icon: <IconPlus size={14} />, label: "新建对话", onClick: onNew },
  +    {
  +      icon: <IconSearch size={14} />,
  +      label: "搜索",
  ```
  ```diff
  -    { icon: <IconGear size={14} />, label: "Settings", onClick: onSettings },
  +    { icon: <IconGear size={14} />, label: "设置", onClick: onSettings },
  ```
  ```diff
  -            {conv.summary.stepCount} steps
  +            {conv.summary.stepCount} 步
  ```
  ```diff
  -            title="More options"
  +            title="更多选项"
  ```
- [ ] **Step 4: Localize Sidebar open/collapsed states and tooltips in `Sidebar.tsx`**
  ```diff
  -            title="Expand sidebar"
  +            title="展开侧边栏"
  ```
  ```diff
  -          title={connected ? "Connected" : "Disconnected"}
  +          title={connected ? "已连接" : "未连接"}
  ```
  ```diff
  -          title="Collapse sidebar"
  +          title="折叠侧边栏"
  ```
  ```diff
  -                        {isExpanded ? "Show less" : `Show all (${totalCount})`}
  +                        {isExpanded ? "收起" : `显示全部 (${totalCount})`}
  ```
- [ ] **Step 5: Localize search overlay strings in `Sidebar.tsx`**
  ```diff
  -                placeholder="Search conversations..."
  +                placeholder="搜索对话..."
  ```
  ```diff
  -                  Type to search across all conversations
  +                  输入以在所有对话中搜索
  ```
  ```diff
  -                  No results for "{searchQuery}"
  +                  没有找到关于 "{searchQuery}" 的结果
  ```
  ```diff
  -                      {result.matchCount} match
  -                      {result.matchCount !== 1 ? "es" : ""}
  +                      {result.matchCount} 处匹配
  ```
- [ ] **Step 6: Translate fallback texts, buttons, and tooltips in `ModelSelector.tsx`**
  ```diff
  -    models.find((m) => m.modelOrAlias.model === active)?.label ?? "Model";
  +    models.find((m) => m.modelOrAlias.model === active)?.label ?? "模型";
  ```
  ```diff
  -        title="Select model"
  +        title="选择模型"
  ```
  ```diff
  -              ⟳ Retry loading models
  +              ⟳ 重新加载模型
  ```
- [ ] **Step 7: Run tests to verify correctness**
  Run: `pnpm test`
  Expected: All 338 tests pass.
- [ ] **Step 8: Commit changes**
  ```bash
  git add packages/web/src/components/Sidebar.tsx packages/web/src/components/ModelSelector.tsx
  git commit -m "translate: localize Sidebar and ModelSelector components"
  ```

### Task 4: Translate Chat Input & Settings Panel
**Files:**
- Modify: [ChatInput.tsx](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/components/ChatInput.tsx)
- Modify: [SettingsPanel.tsx](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/components/SettingsPanel.tsx)

- [ ] **Step 1: Localize Planner modes, validation error messages and placeholders in `ChatInput.tsx`**
  ```diff
  -  {
  -    value: "conversational",
  -    label: "Fast",
  -    desc: "Direct, single-step responses",
  -  },
  -  { value: "planning", label: "Plan", desc: "Multi-step structured approach" },
  +  {
  +    value: "conversational",
  +    label: "快速",
  +    desc: "直接、单步响应",
  +  },
  +  { value: "planning", label: "规划", desc: "多步结构化方法" },
  ```
  ```diff
  -    PLANNER_OPTIONS.find((o) => o.value === plannerType)?.label ?? "Fast";
  +    PLANNER_OPTIONS.find((o) => o.value === plannerType)?.label ?? "快速";
  ```
  ```diff
  -        title="Select planner mode"
  +        title="选择规划器模式"
  ```
  ```diff
  -          showFileError(`Unsupported file type: ${file.type || "unknown"}`);
  +          showFileError(`不支持的文件类型: ${file.type || "未知"}`);
  ```
  ```diff
  -        err instanceof Error ? err.message : "Failed to process attachments",
  +        err instanceof Error ? err.message : "处理附件失败",
  ```
- [ ] **Step 2: Localize input area placeholders, tooltips and labels in `ChatInput.tsx`**
  ```diff
  -            placeholder="Send a message..."
  +            placeholder="发送消息..."
  ```
  ```diff
  -              title="Attach image"
  +              title="添加图片"
  ```
  ```diff
  -                title="Stop generation"
  +                title="停止生成"
  ```
  ```diff
  -              title={isPreparingAttachments ? "Processing images..." : "Send (Enter)"}
  +              title={isPreparingAttachments ? "正在处理图片..." : "发送 (Enter)"}
  ```
- [ ] **Step 3: Localize notification labels and Header actions in `SettingsPanel.tsx`**
  ```diff
  -  const notificationStatus =
  -    notificationPermission === "unsupported"
  -      ? "Unsupported"
  -      : notificationPermission === "denied"
  -        ? "Blocked"
  -        : notificationsChecked
  -          ? "On"
  -          : "Off";
  +  const notificationStatus =
  +    notificationPermission === "unsupported"
  +      ? "不支持"
  +      : notificationPermission === "denied"
  +        ? "已禁用"
  +        : notificationsChecked
  +          ? "开启"
  +          : "关闭";
  ```
  ```diff
  -          title="Back to chat"
  +          title="返回对话"
  ```
  ```diff
  -        <h1 className="settings-title">Settings</h1>
  +        <h1 className="settings-title">设置</h1>
  ```
  ```diff
  -          <IconCheck size={12} /> Saved
  +          <IconCheck size={12} /> 已保存
  ```
- [ ] **Step 4: Localize Model settings rows and dropdown options in `SettingsPanel.tsx`**
  ```diff
  -          <h2 className="settings-section-title">Model</h2>
  +          <h2 className="settings-section-title">模型</h2>
  ```
  ```diff
  -              <span className="settings-row-label">Default Model</span>
  +              <span className="settings-row-label">默认模型</span>
  ```
  ```diff
  -              <span className="settings-row-desc">
  -                The model used when you haven't explicitly selected one
  -                per-message. Changes apply to new messages only.
  -              </span>
  +              <span className="settings-row-desc">
  +                在您没有为每条消息显式选择模型时所使用的默认模型。更改仅适用于新消息。
  +              </span>
  ```
  ```diff
  -              <option value="__none__">Server default</option>
  +              <option value="__none__">服务器默认</option>
  ```
  ```diff
  -                <option disabled>⚠ Failed to load models</option>
  +                <option disabled>⚠ 无法加载模型</option>
  ```
  ```diff
  -                  {m.supportsImages ? " [Vision]" : ""}
  -                  {m.isRecommended ? " (Recommended)" : ""}
  +                  {m.supportsImages ? " [视觉]" : ""}
  +                  {m.isRecommended ? " (推荐)" : ""}
  ```
- [ ] **Step 5: Localize Planner, Notifications, and Reset settings in `SettingsPanel.tsx`**
  ```diff
  -          <h2 className="settings-section-title">Planner</h2>
  +          <h2 className="settings-section-title">规划器</h2>
  ```
  ```diff
  -              <span className="settings-row-label">Default Mode</span>
  +              <span className="settings-row-label">默认模式</span>
  ```
  ```diff
  -              <span className="settings-row-desc">
  -                Fast gives direct single-step responses. Plan uses a
  -                multi-step structured approach for complex tasks.
  -              </span>
  +              <span className="settings-row-desc">
  +                “快速” 模式提供直接的单步响应。“规划” 模式针对复杂任务使用多步结构化方法。
  +              </span>
  ```
  ```diff
  -              <option value="conversational">Fast</option>
  -              <option value="planning">Plan</option>
  +              <option value="conversational">快速</option>
  +              <option value="planning">规划</option>
  ```
  ```diff
  -          <h2 className="settings-section-title">Notifications</h2>
  +          <h2 className="settings-section-title">通知</h2>
  ```
  ```diff
  -              <span className="settings-row-label">Browser Notifications</span>
  +              <span className="settings-row-label">浏览器通知</span>
  ```
  ```diff
  -              <span className="settings-row-desc">
  -                Run completion and approval requests.
  -              </span>
  +              <span className="settings-row-desc">
  +                在运行完成和需要审批请求时进行通知。
  +              </span>
  ```
  ```diff
  -        <button className="settings-reset-btn" onClick={handleReset}>
  -          Reset all settings to defaults
  -        </button>
  +        <button className="settings-reset-btn" onClick={handleReset}>
  +          将所有设置重置为默认值
  +        </button>
  ```
- [ ] **Step 6: Run tests to verify correctness**
  Run: `pnpm test`
  Expected: All 338 tests pass.
- [ ] **Step 7: Commit changes**
  ```bash
  git add packages/web/src/components/ChatInput.tsx packages/web/src/components/SettingsPanel.tsx
  git commit -m "translate: localize ChatInput and SettingsPanel to Chinese"
  ```

### Task 5: Translate Chat Panel & Browser Notifications Hook
**Files:**
- Modify: [ChatPanel.tsx](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/components/ChatPanel.tsx)
- Modify: [useChatNotifications.ts](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/hooks/useChatNotifications.ts)

- [ ] **Step 1: Localize Plan header labels and buttons in `ChatPanel.tsx`**
  ```diff
  -          {live ? "Live implementation plan" : "Implementation plan"}
  +          {live ? "实时执行计划" : "执行计划"}
  ```
  ```diff
  -          <span className="implementation-plan-live-badge">Live</span>
  +          <span className="implementation-plan-live-badge">实时</span>
  ```
  ```diff
  -          {open ? "Hide" : "View"}
  +          {open ? "隐藏" : "查看"}
  ```
  ```diff
  -             title="Copy implementation plan"
  +             title="复制执行计划"
  ```
- [ ] **Step 2: Localize bubble and empty states in `ChatPanel.tsx`**
  ```diff
  -      title="Copy"
  +      title="复制"
  ```
  ```diff
  -                  title="Revert"
  +                  title="撤回并编辑"
  ```
  ```diff
  -        img.alt = "⚠ Image not found";
  +        img.alt = "⚠ 未找到图片";
  ```
  ```diff
  -          <div className="chat-empty-text">No messages yet</div>
  +          <div className="chat-empty-text">暂无消息</div>
  ```
  ```diff
  -          aria-label="Scroll to bottom"
  +          aria-label="滚动到底部"
  ```
- [ ] **Step 3: Localize notification texts in `useChatNotifications.ts`**
  ```diff
  -        title: "Porta needs file access",
  +        title: "Porta 需要文件访问权限",
  ```
  ```diff
  -        title: "Porta needs approval",
  -        body: command ? truncate(command, 120) : "Approve or reject a command.",
  +        title: "Porta 需要审批",
  +        body: command ? truncate(command, 120) : "允许或拒绝命令。",
  ```
  ```diff
  -          title: "Porta job finished",
  -          body:
  -            latestReply ??
  -            (conversationTitle
  -              ? `${conversationTitle} is now idle.`
  -              : "The current session is now idle."),
  +          title: "Porta 任务已完成",
  +          body:
  +            latestReply ??
  +            (conversationTitle
  +              ? `${conversationTitle} 当前已空闲。`
  +              : "当前会话已空闲。"),
  ```
- [ ] **Step 4: Run tests to verify correctness**
  Run: `pnpm test`
  Expected: All 338 tests pass.
- [ ] **Step 5: Commit changes**
  ```bash
  git add packages/web/src/components/ChatPanel.tsx packages/web/src/hooks/useChatNotifications.ts
  git commit -m "translate: localize ChatPanel and useChatNotifications to Chinese"
  ```

### Task 6: Translate Cards & Subagent Display Texts
**Files:**
- Modify: [StepCards.tsx](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/components/StepCards.tsx)
- Modify: [subagents.ts](file:///c:/Users/20269/Desktop/项目文件夹/antigravity移动端/packages/web/src/utils/subagents.ts)

- [ ] **Step 1: Translate file permission actions and buttons in `StepCards.tsx`**
  ```diff
  -          {permissionRequest.action === "write_file"
  -            ? "Allow write access to this path: "
  -            : permissionRequest.action === "read_file"
  -              ? "Allow read access to this path: "
  -              : "File access requested: "}
  +          {permissionRequest.action === "write_file"
  +            ? "允许对该路径的写入访问权限："
  +            : permissionRequest.action === "read_file"
  +              ? "允许对该路径的读取访问权限："
  +              : "请求访问文件："}
  ```
  ```diff
  -          {isDir ? " (directory)" : ""}
  +          {isDir ? " (目录)" : ""}
  ```
  ```diff
  -            Deny
  +            拒绝
  ```
  ```diff
  -              Allow
  +              允许
  ```
  ```diff
  -                Allow Once
  +                仅允许一次
  ```
  ```diff
  -                Allow This Conversation
  +                允许在本次会话中访问
  ```
- [ ] **Step 2: Translate question, command, and diff action cards in `StepCards.tsx`**
  ```diff
  -        <span className="step-card-desc">Input requested</span>
  +        <span className="step-card-desc">请求输入</span>
  ```
  ```diff
  -            Skip
  +            跳过
  ```
  ```diff
  -            Submit
  +            提交
  ```
  ```diff
  -        title={output ? "Toggle output" : undefined}
  +        title={output ? "折叠/展开输出" : undefined}
  ```
  ```diff
  -            Waiting for approval
  +            等待审批
  ```
  ```diff
  -              Reject
  +              拒绝
  ```
  ```diff
  -              Approve
  +              允许
  ```
  ```diff
  -  const description = ca.description ?? "Code change";
  +  const description = ca.description ?? "代码更改";
  ```
  ```diff
  -        title={hasDiff ? "Toggle diff" : undefined}
  +        title={hasDiff ? "折叠/展开差异" : undefined}
  ```
- [ ] **Step 3: Translate subagent states and headers in `StepCards.tsx`**
  ```diff
  -      CORTEX_STEP_STATUS_DONE: return { label: "Done", className: "cmd-ok" };
  +      CORTEX_STEP_STATUS_DONE: return { label: "已完成", className: "cmd-ok" };
  ```
  ```diff
  -    const labels: Record<string, string> = {
  -      CORTEX_STEP_STATUS_INVALID: "Invalid",
  -      CORTEX_STEP_STATUS_CANCELED: "Canceled",
  -      CORTEX_STEP_STATUS_ERROR: "Failed",
  -      CORTEX_STEP_STATUS_INTERRUPTED: "Interrupted",
  -    };
  +    const labels: Record<string, string> = {
  +      CORTEX_STEP_STATUS_INVALID: "无效",
  +      CORTEX_STEP_STATUS_CANCELED: "已取消",
  +      CORTEX_STEP_STATUS_ERROR: "失败",
  +      CORTEX_STEP_STATUS_INTERRUPTED: "已中断",
  +    };
  ```
  ```diff
  -    const labels: Record<string, string> = {
  -      CORTEX_STEP_STATUS_GENERATING: "Generating",
  -      CORTEX_STEP_STATUS_QUEUED: "Queued",
  -      CORTEX_STEP_STATUS_PENDING: "Pending",
  -      CORTEX_STEP_STATUS_RUNNING: "Running",
  -      CORTEX_STEP_STATUS_WAITING: "Waiting",
  -    };
  +    const labels: Record<string, string> = {
  +      CORTEX_STEP_STATUS_GENERATING: "正在生成",
  +      CORTEX_STEP_STATUS_QUEUED: "排队中",
  +      CORTEX_STEP_STATUS_PENDING: "挂起中",
  +      CORTEX_STEP_STATUS_RUNNING: "运行中",
  +      CORTEX_STEP_STATUS_WAITING: "等待中",
  +    };
  ```
  ```diff
  -        title={hasDetails ? "Toggle subagent details" : undefined}
  +        title={hasDetails ? "折叠/展开子代理详情" : undefined}
  ```
- [ ] **Step 4: Translate subagent definitions, messaging, and commands in `subagents.ts`**
  ```diff
  -      role: subagent.role?.trim() || "Subagent",
  -      typeName: subagent.typeName?.trim() || "subagent",
  +      role: subagent.role?.trim() || "子代理",
  +      typeName: subagent.typeName?.trim() || "子代理",
  ```
  ```diff
  -      details: detail("Instructions", subagent.initialPrompt?.trim()),
  +      details: detail("指令", subagent.initialPrompt?.trim()),
  ```
  ```diff
  -      role: stringField(subagent, "Role", "role") ?? "Subagent",
  +      role: stringField(subagent, "Role", "role") ?? "子代理",
  ```
  ```diff
  -      typeName:
  -        stringField(subagent, "TypeName", "typeName", "Name", "name") ??
  -        "subagent",
  +      typeName:
  +        stringField(subagent, "TypeName", "typeName", "Name", "name") ??
  +        "子代理",
  ```
  ```diff
  -      details: detail(
  -        "Instructions",
  +      details: detail(
  +        "指令",
  ```
  ```diff
  -      role: role || "Subagent",
  -      typeName: "subagent",
  -      details: detail("Instructions", prompt),
  +      role: role || "子代理",
  +      typeName: "子代理",
  +      details: detail("指令", prompt),
  ```
  ```diff
  -  const name = stringField(args, "name", "Name") ?? "Subagent definition";
  +  const name = stringField(args, "name", "Name") ?? "子代理定义";
  ```
  ```diff
  -  if (description) details.push({ label: "Description", text: description });
  -  if (systemPrompt) details.push({ label: "System prompt", text: systemPrompt });
  -  return [{ role: name, typeName: "definition", details }];
  +  if (description) details.push({ label: "描述", text: description });
  +  if (systemPrompt) details.push({ label: "系统提示词", text: systemPrompt });
  +  return [{ role: name, typeName: "定义", details }];
  ```
  ```diff
  -    stringField(args, "Recipient", "recipient") ?? "Subagent";
  +    stringField(args, "Recipient", "recipient") ?? "子代理";
  ```
  ```diff
  -      typeName: "message",
  -      details: detail("Message", message),
  +      typeName: "消息",
  +      details: detail("消息内容", message),
  ```
  ```diff
  -  const action = stringField(args, "Action", "action") ?? "Manage";
  +  const action = stringField(args, "Action", "action") ?? "管理";
  ```
  ```diff
  -      typeName: "manage",
  -      details: detail("Conversation IDs", ids.join("\n")),
  +      typeName: "管理",
  +      details: detail("会话 ID", ids.join("\n")),
  ```
  ```diff
  -    case "invoke":
  -      return items.length === 1
  -        ? "Subagent Invoked"
  -        : `${items.length} Subagents Invoked`;
  -    case "define":
  -      return `Define ${items[0]?.role ?? "Subagent"}`;
  -    case "message":
  -      return `Message to ${items[0]?.role ?? "Subagent"}`;
  +    case "invoke":
  +      return items.length === 1
  +        ? "已调用子代理"
  +        : `已调用 ${items.length} 个子代理`;
  +    case "define":
  +      return `定义 ${items[0]?.role ?? "子代理"}`;
  +    case "message":
  +      return `发送消息给 ${items[0]?.role ?? "子代理"}`;
  ```
  ```diff
  -      if (action === "list") return "List Subagents";
  -      if (action === "kill_all") return "Stop All Subagents";
  -      if (action === "kill") return "Stop Subagents";
  -      return "Manage Subagents";
  +      if (action === "list") return "列出子代理";
  +      if (action === "kill_all") return "停止所有子代理";
  +      if (action === "kill") return "停止子代理";
  +      return "管理子代理";
  ```
- [ ] **Step 5: Run tests to verify correctness**
  Run: `pnpm test`
  Expected: All 338 tests pass.
- [ ] **Step 6: Commit changes**
  ```bash
  git add packages/web/src/components/StepCards.tsx packages/web/src/utils/subagents.ts
  git commit -m "translate: localize StepCards and subagents helper to Chinese"
  ```
