# Subagents Taskbar & Subagent Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide full subagent visibility in the top-right pinned taskbar (with spinner on running and contraction on completion) and a dedicated 1:1 "子智能体目录" (Subagents Directory) tab & search integration in the right panel.

**Architecture:** 
- Enhance `useSubagentViewer` and `usePlanTracker` to reliably extract subagents from nested JSON strings and track live `running`/`completed`/`failed` states.
- Update `PlanProgressCard` to render when subagents exist even without plan tasks, displaying active running agents with a spinning loader and completed agents in a collapsed bar (`智能体` | `✔ 已结束 N >`).
- Create `SubagentDirectoryView` matching 1:1 desktop screenshot 2 (`正在运行 · N` & `已结束 · N` with relative times and markdown summaries) and integrate it into `SidePanel` editor tabs & search dropdown.

**Tech Stack:** React 19, TypeScript, Vitest, CSS Modules / Vanilla CSS.

## Global Constraints
- Must preserve 1:1 visual match with desktop Antigravity screenshots (Screenshot 1 & Screenshot 2).
- Zero breaking changes to existing ChatPanel, PlanProgressCard, and SidePanel APIs.
- All unit and component tests must pass 100%.

---

### Task 1: Subagent Extraction & State Engine Enhancement

**Files:**
- Modify: `packages/web/src/hooks/useSubagentViewer.ts`
- Modify: `packages/web/src/hooks/usePlanTracker.ts`
- Test: `packages/web/src/__tests__/useSubagentViewer.test.ts`

**Interfaces:**
- `useSubagentViewer(steps)` produces `{ subagents, activeSubagent, activeSubagentId, setActiveSubagentId, openSubagent, closeSubagent }`
- `usePlanTracker(cascadeId, steps)` produces `PlanProgressData` with accurate `subagents: { total, completed, active }` and `hasPlan`

- [ ] **Step 1: Write unit tests for subagent extraction with stringified Subagents JSON**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Update `useSubagentViewer.ts` and `usePlanTracker.ts` to parse stringified JSON args and compute real `active` and `completed` counts**
- [ ] **Step 4: Run tests to verify pass**
- [ ] **Step 5: Commit changes**

---

### Task 2: Pinned Top-Right Taskbar Running Spinner & Completed Contraction

**Files:**
- Modify: `packages/web/src/components/PlanProgressCard.tsx`
- Modify: `packages/web/src/styles/chat.css`
- Test: `packages/web/src/__tests__/PlanProgressCard.test.tsx`

**Interfaces:**
- `PlanProgressCard` accepts `{ planData, subagentSessions, onOpenPlanDetail, onOpenSubagents, onSelectSubagent, className, isMobile }`

- [ ] **Step 1: Write tests for PlanProgressCard rendering when tasks=0 but subagents>0, and verifying running vs completed states**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Update `PlanProgressCard.tsx` to remove the strict `total===0` block, render running subagent rows with spinning bot icon and click handler, and render collapsed bar for completed subagents**
- [ ] **Step 4: Add CSS styles for running subagent items, rotating animation, and subagent bars**
- [ ] **Step 5: Run tests to verify pass**
- [ ] **Step 6: Commit changes**

---

### Task 3: Subagent Directory Component (`SubagentDirectoryView.tsx`)

**Files:**
- Create: `packages/web/src/components/SubagentDirectoryView.tsx`
- Modify: `packages/web/src/styles/artifacts.css`
- Test: `packages/web/src/__tests__/SubagentDirectoryView.test.tsx`

**Interfaces:**
- `SubagentDirectoryView` accepts `{ subagents: SubagentSession[], onSelectSubagent: (id: string) => void, onClose?: () => void }`

- [ ] **Step 1: Write test for `SubagentDirectoryView` checking `正在运行 · N` and `已结束 · N` sections, icons, relative time formatting, and selection callback**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement `SubagentDirectoryView.tsx` with clean layout matching screenshot 2**
- [ ] **Step 4: Add CSS styles in `artifacts.css`**
- [ ] **Step 5: Run test to verify pass**
- [ ] **Step 6: Commit changes**

---

### Task 4: SidePanel Tab Search & Directory Tab Integration

**Files:**
- Modify: `packages/web/src/components/SidePanel.tsx`
- Test: `packages/web/src/__tests__/SidePanel.test.tsx`

**Interfaces:**
- `SidePanelTab` includes `"subagent_directory"`
- `SideReviewView` tab search includes subagents and directory quick link

- [ ] **Step 1: Write tests for opening subagent directory in SidePanel and searching subagents in editor tab dropdown**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Integrate `SubagentDirectoryView` into `SidePanel.tsx` and enhance tab search dropdown**
- [ ] **Step 4: Run tests to verify pass**
- [ ] **Step 5: Commit changes**

---

### Task 5: End-to-End Verification & Real Conversation Regression Check

- [ ] **Step 1: Run full test suite (`pnpm test`) across web and proxy packages**
- [ ] **Step 2: Verify `1f6db4aa-0d91-4a45-a543-bf679812928d` logs render subagents correctly**
- [ ] **Step 3: Final commit and walkthrough generation**
