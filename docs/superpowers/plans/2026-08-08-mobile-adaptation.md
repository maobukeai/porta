# 移动端完完全全适配 (Mobile 100% Adaptation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 针对移动端设备（iOS Safari / Android Chrome / Web App / PWA）进行全面深度的 UI/UX 适配，包括 Safe Area 刘海与 Bottom Bar 避让、标准 44pt+ 触控热区、iOS 输入框防强制放大、软键盘高度视口协同、侧边栏/弹窗 Sheet 手势与遮罩体验优化。

**Architecture:** 采用 CSS Design Tokens、Safe Area Insets (env)、Visual Viewport 变量联动以及 Touch Target Hit Area 伪元素扩展，辅以单元测试与 Vite 构建验证。

**Tech Stack:** React 19, TypeScript, Vitest, Modern CSS (Flexbox/Grid, Safe-Area-Insets, Dynamic Viewport Units).

## Global Constraints

- Minimum Touch Target Size: >= 44x44pt (per Apple HIG / WCAG AA)
- Prevent Auto Zoom: Input font-size >= 16px on mobile viewports
- Safe Area Compliance: Top notch and bottom home-bar must be offset with `env(safe-area-inset-*)`
- No Horizontal Scrollbar: All layouts fit within 100vw / device viewport

---

### Task 1: 触控热区与点击响应强化 (Touch Target Size & Active Feedback)

**Files:**
- Modify: `packages/web/src/styles/responsive.css`
- Modify: `packages/web/src/styles/chat.css`
- Modify: `packages/web/src/styles/interaction.css`
- Test: `packages/web/src/__tests__/ChatInput.test.tsx`

**Interfaces:**
- Consumes: CSS class hooks (`.header-icon-btn`, `.mobile-menu-btn`, `.chat-action-icon-btn`, `.msg-action-btn`, `.model-selector-btn`)
- Produces: Enhanced `:before` hit-area expansion and `:active` scale state

- [ ] **Step 1: Write failing test assertion for mobile touch targets**

Ensure touch targets and buttons in ChatInput and Header provide high accessibility.

- [ ] **Step 2: Add pseudo-element hit-areas and active states in CSS**

Update `responsive.css` and `interaction.css` to add relative positioning and pseudo element `::before` extending touch hit targets to 44x44px for icon buttons on `<480px` devices.

- [ ] **Step 3: Run vitest to verify UI components render correctly**

Run: `pnpm --filter @porta/web test ChatInput.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit Task 1**

```bash
git add packages/web/src/styles/
git commit -m "style(mobile): expand touch target hit areas and active feedback"
```

---

### Task 2: iOS Safe Area Insets 全面适配 (Notch & Home Indicator Clearance)

**Files:**
- Modify: `packages/web/src/styles/chat.css`
- Modify: `packages/web/src/styles/responsive.css`
- Modify: `packages/web/src/styles/sidebar.css`
- Modify: `packages/web/src/styles/settings.css`
- Test: `packages/web/src/__tests__/useVisualViewport.test.ts`

**Interfaces:**
- Consumes: CSS `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, `env(safe-area-inset-left)`, `env(safe-area-inset-right)`
- Produces: Safe layout boundaries across iPhone notch/island and home bar

- [ ] **Step 1: Update main-header, chat-input-area, sidebar and settings-mobile-header CSS**

Apply padding with `max(..., env(safe-area-inset-*))` to headers and bottom bars.

- [ ] **Step 2: Verify visual viewport hook handles safe area offsets properly**

Run: `pnpm --filter @porta/web test useVisualViewport.test.ts`
Expected: PASS

- [ ] **Step 3: Commit Task 2**

```bash
git add packages/web/src/styles/
git commit -m "style(mobile): add safe area insets for iOS notch and bottom gesture bar"
```

---

### Task 3: iOS 输入框焦点防放大与软键盘协同 (Focus Auto-Zoom Prevention & Keyboard Height Fit)

**Files:**
- Modify: `packages/web/src/styles/responsive.css`
- Modify: `packages/web/src/styles/input.css`
- Test: `packages/web/src/__tests__/ChatInput.test.tsx`

**Interfaces:**
- Consumes: `--keyboard-height`, `.keyboard-visible` class
- Produces: Smooth 16px mobile input & keyboard resize behavior

- [ ] **Step 1: Update chat-input font-size to 16px on mobile viewports**

Fix `.chat-input` font-size in `responsive.css` `@media (max-width: 480px)` to `16px`.

- [ ] **Step 2: Test input behavior in ChatInput test suite**

Run: `pnpm --filter @porta/web test ChatInput.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit Task 3**

```bash
git add packages/web/src/styles/
git commit -m "fix(mobile): enforce 16px font-size to prevent iOS input focus auto-zoom"
```

---

### Task 4: 移动端抽屉, Sheets 弹窗手势与 375px/320px 窄屏适配 (Mobile Drawer & Sheet Modals UX)

**Files:**
- Modify: `packages/web/src/styles/responsive.css`
- Modify: `packages/web/src/styles/settings.css`
- Modify: `packages/web/src/styles/overlays.css`
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/src/components/MessageActionSheet.tsx`
- Modify: `packages/web/src/components/QuickSwitchSheet.tsx`
- Test: `packages/web/src/__tests__/MessageActionSheet.test.tsx`

**Interfaces:**
- Consumes: Overlay backdrop click/swipe, sheet modal layout
- Produces: Smooth drawer & action sheet touch experience

- [ ] **Step 1: Enhance Sidebar backdrop animation and touch dismiss**
- [ ] **Step 2: Add safe-area and overflow protection for MessageActionSheet & QuickSwitchSheet**
- [ ] **Step 3: Refine SettingsPanel mobile header tab scroll on 320-375px screens**
- [ ] **Step 4: Run tests for MessageActionSheet**

Run: `pnpm --filter @porta/web test MessageActionSheet.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit Task 4**

```bash
git add packages/web/src/styles/ packages/web/src/components/
git commit -m "feat(mobile): optimize drawer, sheet modals and settings layout for small screens"
```

---

### Task 5: 完工验证与打包测试 (Full Verification & Build Pass)

**Files:**
- Test: All tests in `packages/web/src/__tests__`

- [ ] **Step 1: Run full workspace test suite**

Run: `pnpm test`
Expected: PASS (all 180+ tests passing)

- [ ] **Step 2: Run full build pass**

Run: `pnpm build`
Expected: PASS (vite production build succeeds with no TypeScript or asset errors)

- [ ] **Step 3: Commit Task 5**

```bash
git commit --allow-empty -m "chore(mobile): complete 100% mobile adaptation pass"
```
