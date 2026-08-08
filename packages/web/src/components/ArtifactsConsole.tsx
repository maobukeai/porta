import { useState, useMemo, useEffect, useCallback } from "react";
import {
  IconBox,
  IconFileCode,
  IconFileText,
  IconSearch,
  IconCopy,
  IconCheck,
  IconDownload,
  IconX,
  IconSparkles,
  IconMedia,
  IconGitBranch,
  IconRefresh,
  IconSpinner,
  IconPlus,
  IconUndo,
  IconMoreHorizontal,
  IconChevron,
  IconCloud,
} from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import type { TrajectoryStep, ChatMessage } from "../types";
import { api } from "../api/client";
import {
  extractArtifactsFromSteps,
  parseFilename,
  getFileBadge,
  type ArtifactItem,
} from "../utils/extractArtifacts";

interface Props {
  steps?: TrajectoryStep[];
  messages?: ChatMessage[];
  workspaceUri?: string;
  onClose?: () => void;
}

// Side-by-Side Diff Line Parser
interface DiffLine {
  type: "add" | "del" | "ctx" | "header";
  leftNum?: number;
  rightNum?: number;
  leftText?: string;
  rightText?: string;
}

function parseSideBySideDiff(rawDiff: string): DiffLine[] {
  if (!rawDiff) return [];
  const lines = rawDiff.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: "header", leftText: line, rightText: line });
    } else if (line.startsWith("-")) {
      result.push({
        type: "del",
        leftNum: oldLine++,
        leftText: line.slice(1),
        rightText: "",
      });
    } else if (line.startsWith("+")) {
      result.push({
        type: "add",
        rightNum: newLine++,
        leftText: "",
        rightText: line.slice(1),
      });
    } else if (line.startsWith(" ")) {
      result.push({
        type: "ctx",
        leftNum: oldLine++,
        rightNum: newLine++,
        leftText: line.slice(1),
        rightText: line.slice(1),
      });
    }
  }

  return result;
}

export function ArtifactsConsole({ steps = [], messages = [], workspaceUri, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<"all" | "doc" | "code" | "diff" | "media">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── Git Source Control 2.0 States ──
  const [gitBranch, setGitBranch] = useState("main");
  const [gitFiles, setGitFiles] = useState<Array<{ status: string; path: string; staged: boolean }>>([]);
  const [gitLogs, setGitLogs] = useState<Array<{ hash: string; message: string; author: string; relativeTime: string }>>([]);
  const [gitLoading, setGitLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitStatusMsg, setCommitStatusMsg] = useState<string | null>(null);

  // Diff inspection
  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null);
  const [activeDiffText, setActiveDiffText] = useState<string | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "split">("split");

  // Branch manager drawer
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [branchList, setBranchList] = useState<string[]>([]);
  const [newBranchInput, setNewBranchInput] = useState("");
  const [branchActionMsg, setBranchActionMsg] = useState<string | null>(null);

  // Accordion & Dropdown States
  const [commitDropdownOpen, setCommitDropdownOpen] = useState(false);
  const [changesCollapsed, setChangesCollapsed] = useState(false);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);

  const fetchGitData = useCallback(async () => {
    setGitLoading(true);
    try {
      const [statusRes, logRes] = await Promise.all([
        api.gitStatus(workspaceUri),
        api.gitLog(workspaceUri, 10),
      ]);
      setGitBranch(statusRes.branch || "main");
      setGitFiles(statusRes.files || []);
      setGitLogs(logRes.logs || []);
    } catch {
      // Non-git repo fallback
    } finally {
      setGitLoading(false);
    }
  }, [workspaceUri]);

  useEffect(() => {
    fetchGitData();
  }, [fetchGitData]);

  const [aiMsgLoading, setAiMsgLoading] = useState(false);

  const handleGenerateAiCommit = async () => {
    triggerHaptic("light");
    setAiMsgLoading(true);
    try {
      const res = await api.gitAiCommit(workspaceUri);
      if (res.message) setCommitMsg(res.message);
    } catch {
      setCommitMsg("chore: update codebase files");
    } finally {
      setAiMsgLoading(false);
    }
  };

  const handleCommit = async (push = false) => {
    if (!commitMsg.trim()) return;
    triggerHaptic("medium");
    setCommitting(true);
    setCommitStatusMsg(null);
    try {
      const res = await api.gitCommit({
        workspaceUri,
        message: commitMsg.trim(),
        push,
      });
      if (res.error) {
        setCommitStatusMsg(`失败: ${res.error}`);
      } else {
        setCommitStatusMsg(push ? "✓ 提交并推送成功!" : "✓ 本地提交成功!");
        setCommitMsg("");
        fetchGitData();
      }
    } catch (e) {
      setCommitStatusMsg(`错误: ${(e as Error).message}`);
    } finally {
      setCommitting(false);
    }
  };

  const handleStageFile = async (path?: string) => {
    triggerHaptic("light");
    try {
      await api.gitStage(workspaceUri, path);
      fetchGitData();
    } catch (err) {
      console.error("Failed to stage file:", err);
    }
  };

  const handleDiscardFile = async (path?: string) => {
    triggerHaptic("medium");
    const confirmText = path
      ? `确定要放弃对 "${path.split("/").pop()}" 的本地改动吗？此操作无法撤销。`
      : "确定要放弃工作区所有未提交的本地代码改动吗？";
    if (!window.confirm(confirmText)) return;

    try {
      await api.gitDiscard(workspaceUri, path);
      fetchGitData();
      if (activeDiffFile === path) {
        setActiveDiffFile(null);
        setActiveDiffText(null);
      }
    } catch (err) {
      console.error("Failed to discard file:", err);
    }
  };

  const handleInspectDiff = async (file: string) => {
    triggerHaptic("light");
    if (activeDiffFile === file) {
      setActiveDiffFile(null);
      setActiveDiffText(null);
      return;
    }
    setActiveDiffFile(file);
    try {
      const res = await api.gitDiff(workspaceUri, file);
      setActiveDiffText(res.diff || "暂无改动差异");
    } catch {
      setActiveDiffText("读取差异失败");
    }
  };

  const handleOpenBranchModal = async () => {
    triggerHaptic("medium");
    setBranchModalOpen(true);
    setBranchActionMsg(null);
    try {
      const res = await api.gitBranches(workspaceUri);
      setBranchList(res.branches || [gitBranch]);
    } catch {
      setBranchList([gitBranch]);
    }
  };

  const handleCheckoutBranch = async (branchName: string, isCreate = false) => {
    triggerHaptic("medium");
    setBranchActionMsg(null);
    try {
      const res = await api.gitCheckout(workspaceUri, branchName, isCreate);
      if (res.error) {
        setBranchActionMsg(`切换失败: ${res.error}`);
      } else {
        setBranchActionMsg(`已成功切换到分支 "${branchName}"`);
        setNewBranchInput("");
        fetchGitData();
      }
    } catch (err) {
      setBranchActionMsg(`失败: ${(err as Error).message}`);
    }
  };

  const handleGitPull = async () => {
    triggerHaptic("medium");
    setBranchActionMsg("正在从远程仓库拉取代码 (git pull)...");
    try {
      const res = await api.gitPull(workspaceUri);
      if (res.error) {
        setBranchActionMsg(`拉取失败: ${res.error}`);
      } else {
        setBranchActionMsg("✓ 代码已被成功拉取更新");
        fetchGitData();
      }
    } catch (err) {
      setBranchActionMsg(`错误: ${(err as Error).message}`);
    }
  };

  const artifacts = useMemo(
    () => extractArtifactsFromSteps(steps, messages),
    [steps, messages],
  );

  const filtered = useMemo(() => {
    return artifacts.filter((item) => {
      const matchesType = selectedType === "all" || item.type === selectedType;
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.content.toLowerCase().includes(q) ||
        (item.language && item.language.toLowerCase().includes(q));
      return matchesType && matchesSearch;
    });
  }, [artifacts, selectedType, search]);

  const handleCopy = (id: string, text: string) => {
    triggerHaptic("light");
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleDownload = (item: ArtifactItem) => {
    triggerHaptic("medium");
    const blob = new Blob([item.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.path ? item.path.split("/").pop()! : `${item.title.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "_")}.${item.language || "txt"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sideBySideLines = useMemo(() => parseSideBySideDiff(activeDiffText || ""), [activeDiffText]);

  return (
    <div className="artifacts-console">
      <div className="artifacts-header">
        <div className="artifacts-title">
          <IconBox size={18} className="artifacts-icon" />
          <span>Artifacts 交付物与 Git 控制台</span>
          <span className="artifacts-count-badge">{artifacts.length} 项产物</span>
        </div>
        {onClose && (
          <button className="artifacts-close-btn" onClick={onClose} title="返回对话">
            <IconX size={16} />
          </button>
        )}
      </div>

      {/* Toolbar: Search & Filter Tabs */}
      <div className="artifacts-toolbar">
        <div className="artifacts-search-box">
          <IconSearch size={14} className="artifacts-search-icon" />
          <input
            type="text"
            className="artifacts-search-input"
            placeholder="搜索代码、文档、修改点或流程图..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="artifacts-search-clear" onClick={() => setSearch("")}>
              <IconX size={12} />
            </button>
          )}
        </div>

        <div className="artifacts-filter-tabs">
          <button
            className={`artifacts-tab ${selectedType === "all" ? "active" : ""}`}
            onClick={() => setSelectedType("all")}
          >
            全部 ({artifacts.length})
          </button>
          <button
            className={`artifacts-tab ${selectedType === "code" ? "active" : ""}`}
            onClick={() => setSelectedType("code")}
          >
            <IconFileCode size={13} /> 代码 (
            {artifacts.filter((a) => a.type === "code").length})
          </button>
          <button
            className={`artifacts-tab ${selectedType === "doc" ? "active" : ""}`}
            onClick={() => setSelectedType("doc")}
          >
            <IconFileText size={13} /> 文档 (
            {artifacts.filter((a) => a.type === "doc").length})
          </button>
          <button
            className={`artifacts-tab ${selectedType === "diff" ? "active" : ""}`}
            onClick={() => {
              setSelectedType("diff");
              fetchGitData();
            }}
          >
            <IconSparkles size={13} /> 变更 ({gitFiles.length || artifacts.filter((a) => a.type === "diff").length})
          </button>
          <button
            className={`artifacts-tab ${selectedType === "media" ? "active" : ""}`}
            onClick={() => setSelectedType("media")}
          >
            <IconMedia size={13} /> 图表/媒体 (
            {artifacts.filter((a) => a.type === "media").length})
          </button>
        </div>
      </div>

      {/* Content List */}
      <div className="artifacts-list">
        {/* Git Source Control Panel 2.0 */}
        {(selectedType === "diff" || selectedType === "all") && (
          <div className="vscode-git-container">
              {/* VS Code Top Header */}
              <div className="vscode-git-header">
                <span className="vscode-git-title">源代码管理</span>
                <div className="vscode-git-header-actions">
                  <button onClick={fetchGitData} title="刷新" disabled={gitLoading}>
                    <IconRefresh size={14} className={gitLoading ? "icon-spin" : ""} />
                  </button>
                  <button onClick={handleOpenBranchModal} title="更多操作">
                    <IconMoreHorizontal size={14} />
                  </button>
                </div>
              </div>

              {/* Top Action Bar */}
              <div className="vscode-git-action-bar">
                <span className="vscode-git-sub-title">更改</span>
                <div className="vscode-git-bar-tools">
                  <button onClick={() => handleCommit(false)} title="提交">
                    <IconCheck size={14} />
                  </button>
                  <button onClick={fetchGitData} title="刷新">
                    <IconRefresh size={14} />
                  </button>
                  <button onClick={handleOpenBranchModal} title="更多操作">
                    <IconMoreHorizontal size={14} />
                  </button>
                </div>
              </div>

              {/* Commit Form Box */}
              <div className="vscode-commit-form">
                <div className="vscode-commit-input-wrap">
                  <input
                    type="text"
                    className="vscode-commit-input"
                    placeholder={`提交变更内容(Ctrl+Enter 在“${gitBranch}”...`}
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        handleCommit(false);
                      }
                    }}
                  />
                  <div className="vscode-input-actions">
                    <button
                      className="vscode-ai-spark-btn"
                      disabled={aiMsgLoading}
                      onClick={handleGenerateAiCommit}
                      title="AI 自动生成 Commit 说明"
                    >
                      {aiMsgLoading ? <IconSpinner size={12} className="icon-spin" /> : <IconSparkles size={12} />}
                      <IconChevron size={10} />
                    </button>
                  </div>
                </div>

                {/* Primary Split Commit Button */}
                <div className="vscode-split-commit-btn-group">
                  <button
                    className="vscode-main-commit-btn"
                    disabled={committing || !commitMsg.trim()}
                    onClick={() => handleCommit(false)}
                  >
                    {committing ? <IconSpinner size={14} className="icon-spin" /> : <IconCheck size={14} />}
                    <span>✓ 提交</span>
                    <span className="vscode-btn-shortcut">Ctrl+Enter</span>
                  </button>
                  <button
                    className="vscode-commit-dropdown-trigger"
                    onClick={() => setCommitDropdownOpen(!commitDropdownOpen)}
                    title="更多提交方式 (Commit Options)"
                  >
                    <IconChevron size={12} className={commitDropdownOpen ? "icon-spin-180" : ""} />
                  </button>

                  {commitDropdownOpen && (
                    <div className="vscode-commit-dropdown-menu">
                      <button
                        onClick={() => {
                          setCommitDropdownOpen(false);
                          handleCommit(false);
                        }}
                      >
                        ✓ 提交 (Commit)
                      </button>
                      <button
                        onClick={() => {
                          setCommitDropdownOpen(false);
                          handleCommit(true);
                        }}
                      >
                        ✓ 提交并推送 (Commit & Push)
                      </button>
                      <button
                        onClick={() => {
                          setCommitDropdownOpen(false);
                          handleStageFile();
                          handleCommit(true);
                        }}
                      >
                        ✓ 暂存所有并提交 (Stage All & Commit)
                      </button>
                    </div>
                  )}
                </div>
                {commitStatusMsg && (
                  <div className={`vscode-status-toast ${commitStatusMsg.startsWith("✓") ? "success" : "error"}`}>
                    {commitStatusMsg}
                  </div>
                )}
              </div>

              {/* Changes Section (更改) */}
              <div className="vscode-section">
                <div
                  className="vscode-section-header"
                  onClick={() => setChangesCollapsed(!changesCollapsed)}
                >
                  <div className="vscode-section-title-wrap">
                    <IconChevron size={12} className={`vscode-accordion-chevron ${changesCollapsed ? "collapsed" : ""}`} />
                    <span>更改</span>
                  </div>
                  <div className="vscode-section-tools" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        handleStageFile();
                        setCommitStatusMsg("✓ 已暂存所有改动");
                      }}
                      title="全部暂存 (+)"
                    >
                      <IconPlus size={13} />
                    </button>
                    <button onClick={() => handleDiscardFile()} title="放弃全部改动 (↩)">
                      <IconUndo size={13} />
                    </button>
                    <button
                      onClick={() => {
                        handleStageFile();
                        setCommitStatusMsg("✓ 已暂存更改");
                      }}
                      title="暂存"
                    >
                      <IconPlus size={13} />
                    </button>
                    <span className="vscode-count-badge">{gitFiles.length}</span>
                  </div>
                </div>

                {!changesCollapsed && (
                  gitFiles.length === 0 ? (
                    <div className="vscode-empty-hint">工作区无修改点</div>
                  ) : (
                    <div className="vscode-file-list">
                      {gitFiles.map((file) => {
                        const parsed = parseFilename(file.path);
                        const isDiffOpen = activeDiffFile === file.path;
                        const dirPath = file.path.includes("/") || file.path.includes("\\")
                          ? file.path.substring(0, file.path.lastIndexOf(file.path.includes("/") ? "/" : "\\"))
                          : "src";

                        return (
                          <div key={file.path} className="vscode-file-item-wrap">
                            <div
                              className="vscode-file-row"
                              onClick={() => handleInspectDiff(file.path)}
                            >
                              <span className={`vscode-file-badge ${parsed.ext.toUpperCase()}`}>
                                {getFileBadge(file.path)}
                              </span>
                              <span className="vscode-file-name">{parsed.filename}</span>
                              <span className="vscode-file-dir">{dirPath}</span>
                              <div className="vscode-file-hover-tools" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => {
                                    handleStageFile(file.path);
                                    setCommitStatusMsg(`✓ 已暂存 ${parsed.filename}`);
                                  }}
                                  title="暂存该文件 (+)"
                                >
                                  <IconPlus size={12} />
                                </button>
                                <button
                                  onClick={() => handleDiscardFile(file.path)}
                                  title="放弃该文件改动 (↩)"
                                >
                                  <IconUndo size={12} />
                                </button>
                              </div>
                              <span className={`vscode-file-status ${file.status}`}>{file.status}</span>
                            </div>

                            {isDiffOpen && (
                              <div className="git-diff-preview-box">
                                <div className="git-diff-preview-header">
                                  <span>差异对比: {parsed.filename}</span>
                                  <div className="git-diff-mode-toggle">
                                    <button
                                      className={diffViewMode === "split" ? "active" : ""}
                                      onClick={() => setDiffViewMode("split")}
                                    >
                                      双栏对比
                                    </button>
                                    <button
                                      className={diffViewMode === "unified" ? "active" : ""}
                                      onClick={() => setDiffViewMode("unified")}
                                    >
                                      单栏
                                    </button>
                                    <button onClick={() => setActiveDiffFile(null)}><IconX size={12} /></button>
                                  </div>
                                </div>

                                {diffViewMode === "split" ? (
                                  <div className="git-diff-split-view">
                                    {sideBySideLines.map((l, idx) => (
                                      <div key={idx} className={`diff-line-row ${l.type}`}>
                                        <div className="diff-col left">
                                          <span className="line-num">{l.leftNum || ""}</span>
                                          <span className="line-text">{l.leftText}</span>
                                        </div>
                                        <div className="diff-col right">
                                          <span className="line-num">{l.rightNum || ""}</span>
                                          <span className="line-text">{l.rightText}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <pre className="artifact-code-preview">
                                    <code>{activeDiffText ?? "加载中..."}</code>
                                  </pre>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>

              {/* Git Branch Commit Graph Section (图形) */}
              <div className="vscode-section graph">
                <div
                  className="vscode-section-header"
                  onClick={() => setGraphCollapsed(!graphCollapsed)}
                >
                  <div className="vscode-section-title-wrap">
                    <IconChevron size={12} className={`vscode-accordion-chevron ${graphCollapsed ? "collapsed" : ""}`} />
                    <span>图形</span>
                  </div>
                  <div className="vscode-section-tools" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`vscode-tool-text-btn ${autoRefreshEnabled ? "active" : ""}`}
                      onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
                      title={autoRefreshEnabled ? "已开启自动刷新" : "自动刷新已关"}
                    >
                      {autoRefreshEnabled ? "自动" : "手动"}
                    </button>
                    <button onClick={fetchGitData} title="刷新图形">
                      <IconRefresh size={13} className={gitLoading ? "icon-spin" : ""} />
                    </button>
                    <button onClick={handleOpenBranchModal} title="图表视图与分支选项">
                      <IconMoreHorizontal size={13} />
                    </button>
                  </div>
                </div>

                {!graphCollapsed && (
                  <div className="vscode-graph-timeline">
                    {gitLogs.map((log, idx) => {
                      const isHead = idx === 0;
                      return (
                        <div key={log.hash} className="vscode-graph-item">
                          <div className="vscode-graph-track">
                            <span className="vscode-track-line" />
                            <span className={`vscode-graph-node ${isHead ? "head" : ""}`} />
                          </div>

                          <div className="vscode-graph-content">
                            <span className="vscode-graph-msg" title={log.message}>{log.message}</span>
                            <div className="vscode-graph-badges">
                              {isHead && (
                                <span className="vscode-branch-pill local">
                                  <IconGitBranch size={10} /> {gitBranch}
                                </span>
                              )}
                              {isHead && (
                                <span className="vscode-branch-pill remote">
                                  <IconCloud size={10} /> origin/{gitBranch}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

        {filtered.length === 0 && selectedType !== "diff" ? (
          <div className="artifacts-empty-state">
            <IconBox size={36} />
            <p>当前对话暂无可展示的交付物或代码产物</p>
            <span className="artifacts-empty-hint">
              当 AI 生成代码块、修改本地文件或输出文档报告时，系统会自动提取并在此集中管理。
            </span>
          </div>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="artifact-card">
              <div className="artifact-card-header">
                <div className="artifact-card-meta">
                  {item.type === "code" && <IconFileCode size={15} className="type-icon code" />}
                  {item.type === "doc" && <IconFileText size={15} className="type-icon doc" />}
                  {item.type === "diff" && <IconSparkles size={15} className="type-icon diff" />}
                  {item.type === "media" && <IconMedia size={15} className="type-icon media" />}
                  <span className="artifact-card-title">{item.title}</span>
                  {item.language && (
                    <span className="artifact-lang-pill">{item.language}</span>
                  )}
                </div>
                <div className="artifact-card-actions">
                  <button
                    className="artifact-action-btn"
                    onClick={() => handleCopy(item.id, item.content)}
                    title="复制内容"
                  >
                    {copiedId === item.id ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  </button>
                  <button
                    className="artifact-action-btn"
                    onClick={() => handleDownload(item)}
                    title="下载文件"
                  >
                    <IconDownload size={14} />
                  </button>
                </div>
              </div>

              <div className="artifact-card-body">
                <pre className="artifact-code-preview">
                  <code>{item.content}</code>
                </pre>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Branch Management Modal */}
      {branchModalOpen && (
        <div className="branch-modal-overlay" onClick={() => setBranchModalOpen(false)}>
          <div className="branch-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="branch-modal-header">
              <div className="branch-modal-title">
                <IconGitBranch size={16} />
                <span>Git 分支与远程同步</span>
              </div>
              <button onClick={() => setBranchModalOpen(false)}><IconX size={16} /></button>
            </div>

            <div className="branch-modal-body">
              <div className="branch-sync-bar">
                <span className="branch-current-label">当前分支: <strong>{gitBranch}</strong></span>
                <button className="git-btn secondary" onClick={handleGitPull}>
                  <IconRefresh size={13} /> 拉取远程代码 (Pull)
                </button>
              </div>

              {branchActionMsg && (
                <div className="branch-status-msg">{branchActionMsg}</div>
              )}

              <div className="branch-create-box">
                <input
                  type="text"
                  className="branch-input"
                  placeholder="输入新分支名称..."
                  value={newBranchInput}
                  onChange={(e) => setNewBranchInput(e.target.value)}
                />
                <button
                  className="git-btn primary"
                  disabled={!newBranchInput.trim()}
                  onClick={() => handleCheckoutBranch(newBranchInput.trim(), true)}
                >
                  + 新建并切换
                </button>
              </div>

              <div className="branch-list-section">
                <div className="branch-list-title">本地分支列表</div>
                <div className="branch-list">
                  {branchList.map((b) => {
                    const isCurrent = b === gitBranch;
                    return (
                      <div
                        key={b}
                        className={`branch-item ${isCurrent ? "active" : ""}`}
                        onClick={() => !isCurrent && handleCheckoutBranch(b, false)}
                      >
                        <IconGitBranch size={14} />
                        <span>{b}</span>
                        {isCurrent && <span className="current-pill">当前</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
