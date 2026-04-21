import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "./api/desktop";
import { SettingsModal } from "./components/SettingsModal";
import { WorkspaceModal } from "./components/WorkspaceModal";
import "./App.css";

const LOGIN_POLL_ATTEMPTS = 15;
const LOGIN_POLL_INTERVAL_MS = 2000;
const DEFAULT_THEME = "gruvbox-dark";
const MAX_STREAM_PROGRESS_ITEMS = 12;
const STREAM_NO_TOKEN_WARN_S = 12;
const STREAM_STALL_WARN_S = 25;
const STREAM_NO_TOKEN_WARN_S_WORKSPACE = 30;
const STREAM_STALL_WARN_S_WORKSPACE = 90;
const SESSION_MODE_CONVERSATION = "conversation";
const SESSION_MODE_WORKSPACE = "workspaceCollaboration";
const TURN_INTENT_AUTO = "auto";
const TURN_INTENT_CHOICE = "choice";
const TURN_INTENT_PREVIEW = "preview";
const REJECT_ALL_DECISIONS_ACTION_ID = "reject_all_decisions";
const THEME_OPTIONS = [
  { value: "gruvbox-dark", label: "Gruvbox Dark" },
  { value: "tokyonight", label: "Tokyo Night" },
  { value: "nord", label: "Nord Night" },
  { value: "kanagawa", label: "Kanagawa Ink" },
  { value: "gruvbox-light", label: "Gruvbox Light" },
  { value: "paper-light", label: "Paper Light" },
  { value: "nord-light", label: "Nord Light" },
];
const DEFAULT_SETTINGS = {
  provider: "codex_cli",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  modelId: "",
  theme: DEFAULT_THEME,
  confirmWrites: true,
  confirmCommands: true,
  codexProxyMode: "inherit",
  codexHttpProxy: "",
  codexHttpsProxy: "",
  codexAllProxy: "",
  codexNoProxy: "",
};

const SUPPORTED_THEMES = new Set(THEME_OPTIONS.map((theme) => theme.value));

function normalizeTheme(theme) {
  if (typeof theme !== "string") {
    return DEFAULT_THEME;
  }
  const normalized = theme.trim().toLowerCase();
  return SUPPORTED_THEMES.has(normalized) ? normalized : DEFAULT_THEME;
}

function normalizeSettings(settings) {
  if (!settings || typeof settings !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    provider: typeof settings.provider === "string" && settings.provider.trim()
      ? settings.provider.trim()
      : DEFAULT_SETTINGS.provider,
    baseUrl: typeof settings.baseUrl === "string" ? settings.baseUrl.trim() : DEFAULT_SETTINGS.baseUrl,
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() : "",
    modelId: typeof settings.modelId === "string" ? settings.modelId.trim() : "",
    theme: normalizeTheme(settings.theme),
    confirmWrites: settings.confirmWrites !== false,
    confirmCommands: settings.confirmCommands !== false,
    codexProxyMode:
      settings.codexProxyMode === "direct" || settings.codexProxyMode === "manual"
        ? settings.codexProxyMode
        : "inherit",
    codexHttpProxy: typeof settings.codexHttpProxy === "string" ? settings.codexHttpProxy.trim() : "",
    codexHttpsProxy:
      typeof settings.codexHttpsProxy === "string" ? settings.codexHttpsProxy.trim() : "",
    codexAllProxy: typeof settings.codexAllProxy === "string" ? settings.codexAllProxy.trim() : "",
    codexNoProxy: typeof settings.codexNoProxy === "string" ? settings.codexNoProxy.trim() : "",
  };
}

function normalizeError(error) {
  if (!error) {
    return "发生未知错误。";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && "message" in error && error.message) {
    return error.message;
  }
  return String(error);
}

function normalizeSessionMode(mode) {
  return mode === SESSION_MODE_WORKSPACE ? SESSION_MODE_WORKSPACE : SESSION_MODE_CONVERSATION;
}

function sessionModeLabel(mode) {
  return normalizeSessionMode(mode) === SESSION_MODE_WORKSPACE ? "工作区协作" : "对话";
}

function sessionModeTrailLabel(mode) {
  return normalizeSessionMode(mode) === SESSION_MODE_WORKSPACE ? "协作" : "对话";
}

function normalizeTurnIntent(intent) {
  if (intent === TURN_INTENT_CHOICE || intent === TURN_INTENT_PREVIEW) {
    return intent;
  }
  return TURN_INTENT_AUTO;
}

function providerUsesCodexLogin(provider) {
  return provider === "codex_cli" || provider === "openai-codex";
}

function turnIntentLabel(intent) {
  const normalized = normalizeTurnIntent(intent);
  if (normalized === TURN_INTENT_CHOICE) {
    return "方向建议";
  }
  if (normalized === TURN_INTENT_PREVIEW) {
    return "具体预览";
  }
  return "协作分析";
}

function pendingAssistantLabel(seconds, sessionMode, turnIntent = TURN_INTENT_AUTO) {
  const normalizedMode = normalizeSessionMode(sessionMode);
  if (normalizedMode === SESSION_MODE_WORKSPACE) {
    const normalizedIntent = normalizeTurnIntent(turnIntent);
    if (normalizedIntent === TURN_INTENT_CHOICE) {
      if (seconds >= 20) {
        return `正在查看工作区并整理方向建议…（${seconds}s）`;
      }
      if (seconds >= 3) {
        return `正在整理方向建议…（${seconds}s）`;
      }
      return "正在整理方向建议…";
    }
    if (normalizedIntent === TURN_INTENT_PREVIEW) {
      if (seconds >= 20) {
        return `正在查看工作区并展开具体预览…（${seconds}s）`;
      }
      if (seconds >= 3) {
        return `正在展开具体预览…（${seconds}s）`;
      }
      return "正在展开具体预览…";
    }
    if (seconds >= 20) {
      return `正在查看工作区并整理协作分析…（${seconds}s）`;
    }
    if (seconds >= 3) {
      return `正在整理协作分析…（${seconds}s）`;
    }
    return "正在整理协作分析…";
  }

  if (seconds >= 20) {
    return `正在生成回复…（${seconds}s，回复时间稍长）`;
  }
  if (seconds >= 3) {
    return `正在生成回复…（${seconds}s）`;
  }
  return "正在生成回复…";
}

function normalizeLoginStatus(status) {
  if (!status || typeof status !== "object") {
    return {
      available: false,
      loggedIn: false,
      method: "",
      message: "无法获取登录状态。",
    };
  }

  if (!status.available) {
    return {
      ...status,
      message: status.message || "未检测到 Codex CLI，无法检测登录状态。",
    };
  }

  if (status.loggedIn) {
    const method = status.method?.trim();
    return {
      ...status,
      message: method ? `已检测到 Codex 登录（${method}）。` : "已检测到 Codex 登录。",
    };
  }

  return {
    ...status,
    message: "尚未检测到 Codex 登录。点击下方按钮继续登录。",
  };
}

function sortSessions(sessions) {
  return [...sessions].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

function upsertSession(sessions, nextSession) {
  const found = sessions.some((session) => session.id === nextSession.id);
  if (!found) {
    return sortSessions([nextSession, ...sessions]);
  }
  return sortSessions(
    sessions.map((session) => (session.id === nextSession.id ? { ...session, ...nextSession } : session))
  );
}

function proposalStatusRank(status) {
  if (status === "pending") {
    return 0;
  }
  if (status === "selected") {
    return 1;
  }
  if (status === "approved") {
    return 2;
  }
  if (status === "failed") {
    return 3;
  }
  if (status === "rejected") {
    return 4;
  }
  if (status === "applied" || status === "executed") {
    return 5;
  }
  return 6;
}

function sortProposals(proposals) {
  return [...proposals].sort((left, right) => {
    const rankDiff = proposalStatusRank(left.status) - proposalStatusRank(right.status);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return (right.createdAt ?? 0) - (left.createdAt ?? 0);
  });
}

function upsertProposal(proposals, nextProposal) {
  const found = proposals.some((proposal) => proposal.id === nextProposal.id);
  if (!found) {
    return sortProposals([nextProposal, ...proposals]);
  }
  return sortProposals(
    proposals.map((proposal) => (proposal.id === nextProposal.id ? { ...proposal, ...nextProposal } : proposal))
  );
}

function patchProposalById(proposalsBySession, proposalId, updater) {
  let changed = false;
  const nextEntries = Object.entries(proposalsBySession).map(([sessionId, proposals]) => {
    let sessionChanged = false;
    const nextProposals = proposals.map((proposal) => {
      if (proposal.id !== proposalId) {
        return proposal;
      }
      sessionChanged = true;
      changed = true;
      return updater(proposal);
    });
    return [sessionId, sessionChanged ? sortProposals(nextProposals) : proposals];
  });

  if (!changed) {
    return proposalsBySession;
  }

  return Object.fromEntries(nextEntries);
}

function proposalStatusLabel(status) {
  if (status === "pending") {
    return "待确认";
  }
  if (status === "selected") {
    return "已选择";
  }
  if (status === "approved") {
    return "执行中";
  }
  if (status === "applied") {
    return "已应用";
  }
  if (status === "executed") {
    return "已执行";
  }
  if (status === "rejected") {
    return "已拒绝";
  }
  if (status === "failed") {
    return "失败";
  }
  return status || "未知";
}

function proposalStatusTone(status) {
  if (status === "selected") {
    return "active";
  }
  if (status === "approved") {
    return "active";
  }
  if (status === "applied" || status === "executed") {
    return "ready";
  }
  if (status === "failed" || status === "rejected") {
    return "error";
  }
  if (status === "pending") {
    return "loading";
  }
  return "idle";
}

function normalizeRuntimeSnapshot(snapshot, sessionId = "") {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      sessionId,
      tasks: [],
      turns: [],
      turnItems: [],
    };
  }
  return {
    sessionId:
      typeof snapshot.sessionId === "string" && snapshot.sessionId.trim()
        ? snapshot.sessionId
        : sessionId,
    tasks: Array.isArray(snapshot.tasks) ? snapshot.tasks : [],
    turns: Array.isArray(snapshot.turns) ? snapshot.turns : [],
    turnItems: Array.isArray(snapshot.turnItems) ? snapshot.turnItems : [],
  };
}

function taskStatusLabel(status) {
  if (status === "active") {
    return "进行中";
  }
  if (status === "waitingUser") {
    return "等待你确认";
  }
  if (status === "blocked") {
    return "受阻";
  }
  if (status === "completed") {
    return "已完成";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "cancelled") {
    return "已取消";
  }
  return status || "未知";
}

function turnStatusLabel(status) {
  if (status === "running") {
    return "执行中";
  }
  if (status === "pending") {
    return "排队中";
  }
  if (status === "completed") {
    return "已完成";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "cancelled") {
    return "已取消";
  }
  return status || "未知";
}

function turnItemKindLabel(kind) {
  if (kind === "userMessage") {
    return "用户消息";
  }
  if (kind === "agentMessage") {
    return "助手回复";
  }
  if (kind === "plan") {
    return "计划";
  }
  if (kind === "statusUpdate") {
    return "状态";
  }
  if (kind === "choice") {
    return "方向";
  }
  if (kind === "conceptPreview") {
    return "概念预览";
  }
  if (kind === "fileChangePreview") {
    return "改动预览";
  }
  if (kind === "commandPreview") {
    return "命令预览";
  }
  if (kind === "approvalRequest") {
    return "确认请求";
  }
  if (kind === "commandOutput") {
    return "命令输出";
  }
  if (kind === "commandResult") {
    return "命令结果";
  }
  return kind || "项目";
}

function approvalStateLabel(state) {
  if (state === "pending") {
    return "待确认";
  }
  if (state === "accepted") {
    return "已接受";
  }
  if (state === "rejected") {
    return "已拒绝";
  }
  if (state === "applied") {
    return "已应用";
  }
  if (state === "failed") {
    return "失败";
  }
  return "";
}

function runtimeTone(status, approvalState = "notRequired") {
  if (approvalState === "failed" || approvalState === "rejected") {
    return "error";
  }
  if (approvalState === "applied" || approvalState === "accepted") {
    return "ready";
  }
  if (approvalState === "pending") {
    return "loading";
  }
  if (status === "failed" || status === "cancelled") {
    return "error";
  }
  if (status === "completed") {
    return "ready";
  }
  if (status === "running" || status === "pending") {
    return "loading";
  }
  if (status === "active") {
    return "active";
  }
  if (status === "waitingUser") {
    return "ready";
  }
  return "idle";
}

function runtimeItemStateLabel(item) {
  const approvalLabel = approvalStateLabel(item?.approvalState);
  if (approvalLabel) {
    return approvalLabel;
  }
  return turnStatusLabel(item?.status);
}

function formatRuntimeTime(timestamp) {
  if (!timestamp) {
    return "刚刚";
  }
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function proposalPrimaryActionLabel(proposal) {
  if (proposal.kind === "choice") {
    return "选择这个方向";
  }
  if (proposal.kind === "command") {
    return "确认执行命令";
  }
  return "确认应用改动";
}

function truncateBlock(text, maxChars = 1800) {
  if (typeof text !== "string" || text.length <= maxChars) {
    return text || "";
  }
  return `${text.slice(0, maxChars)}\n…[已截断]`;
}

function truncateInline(text, maxChars = 96) {
  if (typeof text !== "string" || text.length <= maxChars) {
    return text || "";
  }
  return `${text.slice(0, maxChars - 1).trim()}…`;
}

function splitDecisionParagraphs(text, limit = 4) {
  if (typeof text !== "string") {
    return [];
  }
  return text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function mapDecisionSectionKind(title) {
  if (title === "改动目标") {
    return "goal";
  }
  if (title === "涉及文件") {
    return "files";
  }
  if (title === "收益") {
    return "impact";
  }
  if (title === "风险") {
    return "risk";
  }
  return "note";
}

function extractDecisionFiles(text) {
  if (typeof text !== "string") {
    return [];
  }

  const values = [];
  const seen = new Set();
  const formatFileLabel = (value) => {
    const normalized = value.trim().replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    if (!segments.length) {
      return normalized;
    }
    if (segments.length === 1) {
      return segments[0];
    }
    return segments.slice(-2).join("/");
  };
  const pushValue = (value) => {
    const normalized = formatFileLabel(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    values.push(normalized);
  };

  const markdownLabelPattern = /\[([^[\]]+\.[^[\]]+)\]\([^)]+\)/g;
  for (const match of text.matchAll(markdownLabelPattern)) {
    pushValue(match[1]);
  }

  const pathPattern =
    /\b(?:[\w-]+\/)*[\w.-]+\.(?:rs|jsx|tsx|ts|js|css|toml|json|md|c|h|cpp|hpp|py)\b/g;
  for (const match of text.matchAll(pathPattern)) {
    pushValue(match[0]);
  }

  return values.slice(0, 8);
}

function summarizeDecisionHighlights(text, limit = 2) {
  if (typeof text !== "string") {
    return [];
  }

  const segments = text
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/[。；;]+/))
    .map((part) => truncateInline(part.trim(), 84))
    .filter(Boolean);

  if (!segments.length) {
    return [];
  }

  return segments.slice(0, limit);
}

function projectDecisionPreview(detail, summary) {
  const normalized = truncateBlock(String(detail ?? summary ?? "").replace(/\r\n/g, "\n").trim(), 2600);
  const fallbackSummary = summary?.trim() || "确认这个方向后，Solo 才会继续生成更具体的改动预览。";
  if (!normalized) {
    return {
      intro: fallbackSummary,
      metrics: [{ label: "下一步", value: "确认后展开具体预览" }],
      sections: [],
    };
  }

  const sectionPattern =
    /(?:^|\n)\s*(改动目标|涉及文件|收益|风险|影响范围|执行方式|验证方式|回退方案)[：:]\s*/g;
  const matches = [...normalized.matchAll(sectionPattern)];

  let intro = fallbackSummary;
  let sections = [];

  if (matches.length > 0) {
    const leading = normalized.slice(0, matches[0].index).trim();
    if (leading) {
      intro = leading;
    }

    sections = matches
      .map((match, index) => {
        const start = match.index + match[0].length;
        const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
        const body = normalized.slice(start, end).trim();
        if (!body) {
          return null;
        }
        return {
          title: match[1],
          kind: mapDecisionSectionKind(match[1]),
          body,
          paragraphs: splitDecisionParagraphs(body),
          highlights: summarizeDecisionHighlights(body, match[1] === "涉及文件" ? 1 : 2),
          files: extractDecisionFiles(body),
        };
      })
      .filter(Boolean)
      .slice(0, 4);
  } else {
    const paragraphs = splitDecisionParagraphs(normalized, 5);
    intro = paragraphs.shift() ?? fallbackSummary;
    sections = paragraphs.slice(0, 3).map((body, index) => ({
      title: index === 0 ? "核心变化" : index === 1 ? "影响范围" : "注意事项",
      kind: index === 1 ? "files" : index === 2 ? "risk" : "goal",
      body,
      paragraphs: [body],
      highlights: summarizeDecisionHighlights(body, index === 1 ? 1 : 2),
      files: extractDecisionFiles(body),
    }));
  }

  const fileCount = new Set(sections.flatMap((section) => section.files)).size;
  const metrics = [
    { label: "结构化预览", value: sections.length > 0 ? `${sections.length} 个区块` : "摘要" },
    { label: "涉及文件", value: fileCount > 0 ? `${fileCount} 个` : "待展开" },
    { label: "下一步", value: "确认后展开具体预览" },
  ];

  return {
    intro,
    metrics,
    sections,
  };
}

function buildDecisionOption(proposal) {
  const payload = proposal.payload ?? {};
  const detail = payload.detail ?? proposal.summary;
  return {
    id: proposal.id,
    sessionId: proposal.sessionId,
    status: proposal.status,
    title: proposal.title,
    summary: proposal.summary,
    optionKey: payload.optionKey ?? proposal.title,
    createdAt: proposal.createdAt ?? 0,
    preview: projectDecisionPreview(detail, proposal.summary),
  };
}

function buildApprovalCard(proposal) {
  const payload = proposal.payload ?? {};
  return {
    id: proposal.id,
    sessionId: proposal.sessionId,
    kind: payload.type ?? proposal.kind,
    status: proposal.status,
    title: proposal.title,
    summary: proposal.summary,
    optionKey: payload.optionKey ?? proposal.title,
    relativePath: payload.relativePath ?? "",
    detail: payload.detail ?? "",
    reason: payload.reason ?? "",
    diffText: payload.diffText ?? payload.nextContentPreview ?? "",
    displayCommand: payload.displayCommand ?? "",
    latestOutput: proposal.latestOutput ?? "",
    error: proposal.error ?? "",
  };
}

function buildDecisionSet({ sessionId, sessionMode, proposals, activePreviewId }) {
  const options = proposals
    .filter((proposal) => proposal.kind === "choice")
    .map((proposal) => buildDecisionOption(proposal));
  const pendingOptions = options.filter((option) => option.status === "pending").slice(0, 6);
  const selectedOption =
    options
      .filter((option) => option.status === "selected")
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const activeOption =
    pendingOptions.find((option) => option.id === activePreviewId) ?? pendingOptions[0] ?? null;
  const previewCards = proposals
    .filter((proposal) => proposal.status === "pending" && proposal.kind !== "choice")
    .map(buildApprovalCard);

  let status = "idle";
  if (selectedOption) {
    status = "chosen";
  } else if (pendingOptions.length > 0) {
    status = "open";
  } else if (options.length > 0) {
    status = "dismissed";
  }

  return {
    id: sessionId ? `decision-set-${sessionId}` : "",
    sessionId,
    mode: normalizeSessionMode(sessionMode) === SESSION_MODE_WORKSPACE ? "workspace" : "conversation",
    status,
    options,
    pendingOptions,
    activeOption,
    selectedOption,
    previewCards,
    dismissAction:
      pendingOptions.length > 0
        ? {
            id: sessionId ? `decision-dismiss-${sessionId}` : "decision-dismiss",
            label: "都不选",
            pendingCount: pendingOptions.length,
          }
        : null,
  };
}

function messageStatusLabel(status) {
  if (status === "streaming") {
    return "生成中";
  }
  if (status === "error") {
    return "失败";
  }
  return "已完成";
}

function humanizeProgressDetail(entry) {
  const detail = String(entry?.detail ?? "").trim();
  if (!detail) {
    return "";
  }
  const lower = detail.toLowerCase();
  if (entry?.stage === "思考") {
    return "";
  }
  if (entry?.stage === "生成回复") {
    return "正在整理建议与预览";
  }
  if (entry?.stage === "执行工具" && detail.endsWith("已完成")) {
    return "";
  }
  if (lower.includes("reconnecting") && lower.includes("timeout waiting for child process to exit")) {
    return "Codex CLI 子进程回收超时，正在结束这轮请求。";
  }
  if (lower.includes("reconnecting")) {
    return "Codex CLI 正在重新建立连接。";
  }
  if (lower.includes("timeout waiting for child process to exit")) {
    return "Codex CLI 子进程回收超时。";
  }
  if (detail.includes("秒仍未收到正文输出")) {
    return "模型还在整理结果";
  }
  if (detail.includes("没有任何新进展")) {
    return "本轮等待过久，准备终止";
  }
  return detail;
}

function summarizeProgress(progress) {
  const latest = progress.at(-1);
  if (!latest) {
    return {
      title: "正在准备建议与预览…",
      items: [],
    };
  }

  const latestDetail = humanizeProgressDetail(latest);
  if (latest.level === "error") {
    return {
      title: latestDetail || "当前回合可能卡住了",
      items: progress
        .slice(-2)
        .map((entry) => humanizeProgressDetail(entry))
        .filter(Boolean),
    };
  }

  const detailItems = [];
  for (const entry of progress) {
    const text = humanizeProgressDetail(entry);
    if (!text) {
      continue;
    }
    if (detailItems.at(-1) === text) {
      continue;
    }
    detailItems.push(text);
  }

  let title = latestDetail || "正在准备建议与预览…";
  if (latest.stage === "思考" || latest.stage === "生成回复") {
    title = "正在整理建议与预览…";
  } else if (latest.stage === "执行工具") {
    title = "正在查看相关文件和上下文…";
  } else if (latest.stage === "工作区") {
    title = latestDetail || "正在接入当前工作区…";
  }

  return {
    title,
    items: detailItems.slice(-3),
  };
}

function normalizeProgressLevel(level) {
  if (level === "success" || level === "warn" || level === "error") {
    return level;
  }
  return "info";
}

function appendProgressEntry(state, sessionId, messageId, entry) {
  const sessionProgress = state[sessionId];
  const previous = sessionProgress?.messageId === messageId ? sessionProgress.items ?? [] : [];
  const last = previous.at(-1);
  if (
    last &&
    last.stage === entry.stage &&
    last.detail === entry.detail &&
    last.level === entry.level
  ) {
    return state;
  }
  const items = [...previous, entry].slice(-MAX_STREAM_PROGRESS_ITEMS);
  return {
    ...state,
    [sessionId]: {
      messageId,
      items,
    },
  };
}

function classifyTreeIcon(node) {
  const name = String(node?.name ?? "").toLowerCase();
  const isDirectory = node?.kind === "directory";

  if (isDirectory && (name === ".git" || name.endsWith("/.git"))) {
    return "git";
  }
  if (isDirectory) {
    return "directory";
  }

  if (name === "readme" || name.startsWith("readme.")) {
    return "markdown";
  }
  if (/\.(md|mdx|markdown|txt)$/.test(name)) {
    return "markdown";
  }
  if (/\.(js|jsx|ts|tsx|mjs|cjs|py|rs|go|java|c|cpp|h|hpp|cs|sh|bash|zsh)$/.test(name)) {
    return "code";
  }
  if (/\.(json|ya?ml|toml|ini|env|conf|config|lock)$/.test(name) || name.startsWith(".")) {
    return "config";
  }
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/.test(name)) {
    return "image";
  }
  if (name.includes("git")) {
    return "git";
  }
  return "file";
}

function TreeIcon({ node, expanded }) {
  const iconType = classifyTreeIcon(node);

  if (iconType === "directory") {
    if (expanded) {
      return (
        <svg className="tree-icon-svg tree-icon-directory-open" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M2.5 7.5h15a1.5 1.5 0 0 1 1.45 1.88l-1.3 5A1.5 1.5 0 0 1 16.2 15.5H4A1.5 1.5 0 0 1 2.5 14V7.5Z" />
          <path d="M2.5 7.5V5.5A1.5 1.5 0 0 1 4 4h4l1.4 1.4c.28.28.66.44 1.06.44H16a1.5 1.5 0 0 1 1.5 1.5V7.5" />
        </svg>
      );
    }
    return (
      <svg className="tree-icon-svg tree-icon-directory" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M2.5 6A1.5 1.5 0 0 1 4 4.5h4l1.4 1.4c.28.28.66.44 1.06.44H16A1.5 1.5 0 0 1 17.5 7.8V14A1.5 1.5 0 0 1 16 15.5H4A1.5 1.5 0 0 1 2.5 14V6Z" />
      </svg>
    );
  }

  if (iconType === "code") {
    return (
      <svg className="tree-icon-svg tree-icon-code" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M7 7.5 4.5 10 7 12.5M13 7.5 15.5 10 13 12.5M11.5 6.5 8.5 13.5" />
      </svg>
    );
  }

  if (iconType === "markdown") {
    return (
      <svg className="tree-icon-svg tree-icon-markdown" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5 15.5h10a1.5 1.5 0 0 0 1.5-1.5V6.2a1.5 1.5 0 0 0-.44-1.06l-2.2-2.2A1.5 1.5 0 0 0 12.8 2.5H5A1.5 1.5 0 0 0 3.5 4v10A1.5 1.5 0 0 0 5 15.5Z" />
        <path d="M12.5 2.5V6h3.5M6.5 12v-2.5L8 11l1.5-1.5V12M10.8 12h2.6M12.1 10.8l1.3 1.2-1.3 1.2" />
      </svg>
    );
  }

  if (iconType === "config") {
    return (
      <svg className="tree-icon-svg tree-icon-config" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5 15.5h10a1.5 1.5 0 0 0 1.5-1.5V6.2a1.5 1.5 0 0 0-.44-1.06l-2.2-2.2A1.5 1.5 0 0 0 12.8 2.5H5A1.5 1.5 0 0 0 3.5 4v10A1.5 1.5 0 0 0 5 15.5Z" />
        <path d="M12.5 2.5V6h3.5M6.2 8.6h4.6M6.2 11h6.2M6.2 13.4h3.8" />
      </svg>
    );
  }

  if (iconType === "image") {
    return (
      <svg className="tree-icon-svg tree-icon-image" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5 15.5h10a1.5 1.5 0 0 0 1.5-1.5V6.2a1.5 1.5 0 0 0-.44-1.06l-2.2-2.2A1.5 1.5 0 0 0 12.8 2.5H5A1.5 1.5 0 0 0 3.5 4v10A1.5 1.5 0 0 0 5 15.5Z" />
        <path d="M12.5 2.5V6h3.5M6.3 13.5l2.4-2.8 2.1 2 1.7-1.8 1.2 2.6M7.2 8.2h.01" />
      </svg>
    );
  }

  if (iconType === "git") {
    return (
      <svg className="tree-icon-svg tree-icon-git" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M6.5 5.5v6m0-4h7m-7 4h4" />
        <circle cx="6.5" cy="5.5" r="1.4" />
        <circle cx="13.5" cy="7.5" r="1.4" />
        <circle cx="10.5" cy="11.5" r="1.4" />
      </svg>
    );
  }

  return (
    <svg className="tree-icon-svg tree-icon-file" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 15.5h10a1.5 1.5 0 0 0 1.5-1.5V6.2a1.5 1.5 0 0 0-.44-1.06l-2.2-2.2A1.5 1.5 0 0 0 12.8 2.5H5A1.5 1.5 0 0 0 3.5 4v10A1.5 1.5 0 0 0 5 15.5Z" />
      <path d="M12.5 2.5V6h3.5" />
    </svg>
  );
}

function WorkspaceTreeNode({ node, level, selectedPath, onOpenFile }) {
  const paddingLeft = 8 + level * 14;
  const isDirectory = node.kind === "directory";
  const hasChildren = (node.children?.length ?? 0) > 0;
  const [expanded, setExpanded] = useState(false);

  if (isDirectory) {
    return (
      <div className={`tree-branch ${expanded ? "is-open" : ""}`}>
        <button
          type="button"
          className="tree-node tree-node-directory"
          style={{ paddingLeft }}
          onClick={() => {
            if (hasChildren) {
              setExpanded((current) => !current);
            }
          }}
        >
          <span
            className={`tree-caret ${expanded ? "is-open" : ""} ${hasChildren ? "" : "is-leaf"}`}
            aria-hidden="true"
          >
            {hasChildren ? (
              <svg className="tree-caret-icon" viewBox="0 0 16 16">
                <path d="m6 3.5 4 4.5-4 4.5" />
              </svg>
            ) : (
              <span className="tree-caret-dot" />
            )}
          </span>
          <TreeIcon node={node} expanded={expanded} />
          <span className="tree-node-label">{node.name}</span>
        </button>
        {expanded && hasChildren ? (
          <div className="tree-children">
            {node.children.map((child) => (
              <WorkspaceTreeNode
                key={`${node.path}:${child.path}`}
                node={child}
                level={level + 1}
                selectedPath={selectedPath}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`tree-node tree-node-file ${selectedPath === node.path ? "is-active" : ""}`}
      style={{ paddingLeft }}
      onClick={() => onOpenFile(node.path)}
    >
      <span className="tree-caret tree-caret-placeholder" aria-hidden="true" />
      <TreeIcon node={node} />
      <span className="tree-node-label">{node.name}</span>
    </button>
  );
}

function WindowControlIcon({ kind, maximized = false }) {
  if (kind === "minimize") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5h9" />
      </svg>
    );
  }

  if (kind === "maximize") {
    return maximized ? (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5 3.5h7.5V11M3.5 5h7.5v7.5H3.5Z" />
      </svg>
    ) : (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 3.5h9v9h-9Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4 4 12" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4.25v6.25a2.5 2.5 0 1 0 5 0V5.25a3.75 3.75 0 1 0-7.5 0v6.5a5 5 0 1 0 10 0V6.5" />
    </svg>
  );
}

function MessageBubble({ message, progress = [] }) {
  const status = messageStatusLabel(message.status);
  const roleLabel = message.role === "user" ? "你" : "ChatGPT";
  const messageText =
    message.role === "assistant" && message.status === "streaming" && !message.content?.trim()
      ? "正在生成回复…"
      : message.content;
  const showProgress =
    message.role === "assistant" &&
    (message.status === "streaming" || message.status === "error") &&
    progress.length > 0;
  const progressSummary = showProgress ? summarizeProgress(progress) : null;
  return (
    <article className={`message message-${message.role} message-${message.status}`}>
      <div className="message-meta">
        <span>{roleLabel}</span>
        {message.status === "streaming" || message.status === "error" ? <span>{status}</span> : null}
      </div>
      <div className="message-body">
        <p style={{ whiteSpace: "pre-wrap" }}>{messageText}</p>
      </div>
      {showProgress ? (
        <div className="message-progress" aria-live="polite">
          <div className={`message-progress-summary level-${progress.at(-1)?.level ?? "info"}`}>
            <span className="message-progress-dot" aria-hidden="true" />
            <span className="message-progress-title">{progressSummary?.title}</span>
          </div>
          {progressSummary?.items?.length ? (
            <div className="message-progress-list">
              {progressSummary.items.map((item) => (
                <div key={item} className="message-progress-item">
                  <span className="message-progress-bullet" aria-hidden="true">
                    ·
                  </span>
                  <span className="message-progress-detail">{item}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ProposalCard({ card, busy, onAccept, onReject }) {
  const statusLabel = proposalStatusLabel(card.status);
  const statusTone = proposalStatusTone(card.status);
  const isWrite = card.kind === "write";
  const isChoice = card.kind === "choice";
  const previewText = isWrite ? truncateBlock(card.diffText) : "";
  const commandText = isWrite || isChoice ? "" : truncateBlock(card.displayCommand);
  const outputText = isWrite || isChoice ? "" : truncateBlock(card.latestOutput, 1400);

  return (
    <article className={`proposal-card proposal-${card.status}`}>
      <div className="proposal-card-head">
        <div className="proposal-card-title">
          <span className="section-eyebrow">
            {isWrite ? "Edit Suggestion" : isChoice ? "Decision Suggestion" : "Command Suggestion"}
          </span>
          <strong>{card.title}</strong>
        </div>
        <span className={`drawer-chip drawer-chip-${statusTone}`}>{statusLabel}</span>
      </div>
      <div className="proposal-card-body">
        <p className="proposal-summary">{card.summary}</p>
        {isWrite ? (
          <>
            <div className="proposal-meta-row">
              <span className="proposal-meta-label">文件</span>
              <span className="proposal-meta-value">{card.relativePath || "未提供"}</span>
            </div>
            {previewText ? (
              <div className="proposal-preview-block">
                <span className="proposal-block-label">改动预览</span>
                <pre>{previewText}</pre>
              </div>
            ) : null}
          </>
        ) : isChoice ? (
          <>
            <div className="proposal-meta-row">
              <span className="proposal-meta-label">方向</span>
              <span className="proposal-meta-value">{card.optionKey || "未提供"}</span>
            </div>
            {card.detail ? (
              <div className="proposal-preview-block">
                <span className="proposal-block-label">建议内容</span>
                <pre>{truncateBlock(card.detail, 1200)}</pre>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="proposal-meta-row">
              <span className="proposal-meta-label">命令</span>
              <span className="proposal-meta-value">{card.reason || "命令建议"}</span>
            </div>
            {commandText ? (
              <div className="proposal-preview-block">
                <span className="proposal-block-label">执行预览</span>
                <pre>{commandText}</pre>
              </div>
            ) : null}
            {outputText ? (
              <div className="proposal-preview-block">
                <span className="proposal-block-label">最近输出</span>
                <pre>{outputText}</pre>
              </div>
            ) : null}
          </>
        )}
        {card.error ? <p className="proposal-error">{card.error}</p> : null}
      </div>
      {card.status === "pending" ? (
        <div className="proposal-actions">
          <button type="button" className="primary-button" disabled={busy} onClick={() => onAccept(card)}>
            {busy ? "处理中…" : proposalPrimaryActionLabel(card)}
          </button>
          <button type="button" className="ghost-button" disabled={busy} onClick={() => onReject(card)}>
            拒绝
          </button>
        </div>
      ) : null}
    </article>
  );
}

function DecisionOptionCard({ option, active, index, total, onPreview }) {
  const optionKey = option.optionKey ?? option.title;
  const tilt = total > 1 ? `${(index - (total - 1) / 2) * 1.6}deg` : "0deg";
  return (
    <article
      className={`decision-option-card ${active ? "is-active" : ""}`}
      style={{ "--card-tilt": tilt }}
    >
      <button
        type="button"
        className="decision-option-surface"
        onClick={() => onPreview(option)}
        aria-pressed={active}
      >
        <div className="decision-option-head">
          <span className="section-eyebrow">方向 {optionKey}</span>
          <div className="decision-option-badges">
            <span className="decision-option-index">{String(index + 1).padStart(2, "0")}</span>
            {active ? <span className="drawer-chip drawer-chip-active">预览中</span> : null}
          </div>
        </div>
        <div className="decision-option-body">
          <strong>{option.title}</strong>
          <p>{option.summary}</p>
        </div>
        <div className="decision-option-foot">
          <span className="decision-option-hint">点击卡片先查看这个方向的预览</span>
          <span className="decision-option-arrow" aria-hidden="true">
            ↗
          </span>
        </div>
      </button>
    </article>
  );
}

function DecisionPreviewPanel({ option, decisionSet, busy, skipBusy, onConfirm, onSkipAll }) {
  if (!option) {
    return null;
  }

  const optionKey = option.optionKey ?? option.title;
  const preview = option.preview;
  const heroSummary = truncateInline(preview.intro, 88);
  const scopeSection =
    preview.sections.find((section) => section.kind === "files") ??
    preview.sections.find((section) => section.files.length > 0) ??
    null;
  const gainSection =
    preview.sections.find((section) => section.kind === "impact") ??
    preview.sections.find((section) => section.kind === "goal") ??
    null;
  const riskSection =
    preview.sections.find((section) => section.kind === "risk") ??
    preview.sections.find((section) => section.kind === "note") ??
    null;
  const scopeCount = scopeSection?.files.length ?? 0;
  const scopeFiles = scopeSection?.files.slice(0, 3) ?? [];
  const gainSignals = (gainSection?.highlights ?? []).slice(0, 2);
  const riskSignals = (riskSection?.highlights ?? []).slice(0, 2);
  const scopeValue = scopeCount > 0 ? `${scopeCount}` : "1";
  const scopeUnit = scopeCount > 0 ? "文件" : "局部";
  const costValue = scopeCount > 3 ? "中" : "低";
  const costNote = scopeCount > 3 ? "涉及多文件联动" : "更偏局部调整";

  return (
    <div className="decision-preview-panel">
      <div className="decision-preview-hero">
        <div className="decision-preview-head">
          <div>
            <p className="section-eyebrow">方向预览</p>
            <h4>{option.title}</h4>
            <p className="decision-preview-kicker">当前查看方向 {optionKey}</p>
          </div>
          <span className="drawer-chip drawer-chip-idle">仅预览</span>
        </div>
        <p className="decision-preview-summary">{heroSummary}</p>
      </div>

      <div className="decision-judgment-board">
        <section className="decision-judgment-card decision-judgment-card-scope">
          <span className="decision-judgment-label">范围</span>
          <div className="decision-judgment-metric">
            <strong>{scopeValue}</strong>
            <span>{scopeUnit}</span>
          </div>
          {scopeFiles.length > 0 ? (
            <div className="decision-judgment-files">
              {scopeFiles.map((file) => (
                <span key={file} className="decision-file-chip">
                  {file}
                </span>
              ))}
              {scopeCount > scopeFiles.length ? (
                <span className="decision-file-chip decision-file-chip-muted">+{scopeCount - scopeFiles.length}</span>
              ) : null}
            </div>
          ) : (
            <p className="decision-judgment-note">聚焦一个局部入口</p>
          )}
        </section>

        <section className="decision-judgment-card decision-judgment-card-gain">
          <span className="decision-judgment-label">收益</span>
          <div className="decision-judgment-copy">
            {(gainSignals.length ? gainSignals : ["会直接改善当前主要瓶颈"]).map((signal) => (
              <p key={signal}>{signal}</p>
            ))}
          </div>
        </section>

        <section className="decision-judgment-card decision-judgment-card-risk">
          <span className="decision-judgment-label">风险</span>
          <div className="decision-judgment-copy">
            {(riskSignals.length ? riskSignals : ["风险可控，但仍需确认边界条件"]).map((signal) => (
              <p key={signal}>{signal}</p>
            ))}
          </div>
        </section>

        <section className="decision-judgment-card decision-judgment-card-cost">
          <span className="decision-judgment-label">代价</span>
          <div className="decision-judgment-metric is-compact">
            <strong>{costValue}</strong>
            <span>复杂度</span>
          </div>
          <p className="decision-judgment-note">{costNote}</p>
        </section>
      </div>

      {preview.sections.length > 0 ? (
        <details className="decision-preview-details">
          <summary>查看详细说明</summary>
          <div className="decision-preview-details-grid">
            {preview.sections.map((section) => (
              <section
                key={`${option.id}-${section.title}-detail`}
                className={`decision-preview-card decision-preview-card-${section.kind}`}
              >
                <div className="decision-preview-card-head">
                  <span className="section-eyebrow">{section.title}</span>
                  {section.kind === "files" && section.files.length > 0 ? (
                    <span className="drawer-chip drawer-chip-active">{section.files.length} 个文件</span>
                  ) : null}
                </div>
                {section.files.length > 0 ? (
                  <div className="decision-preview-file-list">
                    {section.files.map((file) => (
                      <span key={file} className="decision-file-chip">
                        {file}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="decision-preview-copy">
                  {section.highlights.map((highlight, index) => (
                    <div key={`${section.title}-${index}`} className="decision-preview-bullet">
                      <span className="decision-preview-bullet-dot" aria-hidden="true" />
                      <p>{highlight}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </details>
      ) : null}

      <div className="decision-preview-footer">
        <p>先看判断板，再决定是否进入下一层具体预览。</p>
        <div className="decision-preview-actions">
          <button
            type="button"
            className="primary-button"
            disabled={busy || skipBusy}
            onClick={() => onConfirm(option)}
          >
            {busy ? "处理中…" : "确认选择这个方向"}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={busy || skipBusy}
            onClick={() => onSkipAll(decisionSet)}
          >
            {skipBusy ? "处理中…" : decisionSet?.dismissAction?.label ?? "都不选"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const mountedRef = useRef(true);
  const activeSessionIdRef = useRef("");

  const [codexAuth, setCodexAuth] = useState({
    available: true,
    loggedIn: false,
    method: "",
    message: "正在检测登录状态…",
  });
  const [codexChecking, setCodexChecking] = useState(false);
  const [codexLoginDetail, setCodexLoginDetail] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const [streamProgressBySession, setStreamProgressBySession] = useState({});
  const [streamMonitorBySession, setStreamMonitorBySession] = useState({});
  const [draft, setDraft] = useState("");
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [connectionState, setConnectionState] = useState({ status: "idle", message: "" });

  const streamProgressRef = useRef({});
  const streamMonitorRef = useRef({});

  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");

  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [workspaceTree, setWorkspaceTree] = useState(null);
  const [workspaceTreeLoading, setWorkspaceTreeLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [filePreview, setFilePreview] = useState(null);
  const [previewState, setPreviewState] = useState({ loading: false, error: "" });
  const [proposalsBySession, setProposalsBySession] = useState({});
  const [proposalPanelState, setProposalPanelState] = useState({ loading: false, error: "" });
  const [proposalActionId, setProposalActionId] = useState("");
  const [decisionPreviewBySession, setDecisionPreviewBySession] = useState({});
  const [turnIntentBySession, setTurnIntentBySession] = useState({});
  const [runtimeSnapshotBySession, setRuntimeSnapshotBySession] = useState({});
  const [runtimePanelState, setRuntimePanelState] = useState({ loading: false, error: "" });
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId]
  );
  const activeProposals = useMemo(
    () => (activeSessionId ? proposalsBySession[activeSessionId] ?? [] : []),
    [proposalsBySession, activeSessionId]
  );
  const activeSessionMode = normalizeSessionMode(activeSession?.interactionMode);
  const activeTurnIntent = activeSessionId
    ? normalizeTurnIntent(
        turnIntentBySession[activeSessionId] ??
          (activeSessionMode === SESSION_MODE_WORKSPACE ? TURN_INTENT_CHOICE : TURN_INTENT_AUTO)
      )
    : TURN_INTENT_AUTO;
  const activeSessionWorkspaceId = activeSession?.workspaceId ?? "";
  const layoutMode = activeSessionMode === SESSION_MODE_WORKSPACE ? "workbench" : "chat";
  const hasCustomWindowChrome =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const activeDecisionPreviewId = activeSessionId ? decisionPreviewBySession[activeSessionId] ?? "" : "";
  const activeDecisionSet = useMemo(
    () =>
      buildDecisionSet({
        sessionId: activeSessionId,
        sessionMode: activeSessionMode,
        proposals: activeProposals,
        activePreviewId: activeDecisionPreviewId,
      }),
    [activeDecisionPreviewId, activeProposals, activeSessionId, activeSessionMode]
  );
  const decisionOptions = activeDecisionSet.pendingOptions;
  const selectedDecisionOption = activeDecisionSet.selectedOption;
  const activeDecisionPreviewOption = activeDecisionSet.activeOption;
  const previewProposals = activeDecisionSet.previewCards;
  const showDecisionDeck = activeDecisionSet.status === "open" && decisionOptions.length > 0;
  const showPreviewCards =
    previewProposals.length > 0 && (!showDecisionDeck || Boolean(selectedDecisionOption));
  const rejectingAllDecisions = proposalActionId === REJECT_ALL_DECISIONS_ACTION_ID;
  const activeRuntimeSnapshot = useMemo(
    () => normalizeRuntimeSnapshot(runtimeSnapshotBySession[activeSessionId], activeSessionId),
    [runtimeSnapshotBySession, activeSessionId]
  );
  const activeRuntimeTask = useMemo(() => {
    const tasks = activeRuntimeSnapshot.tasks ?? [];
    return tasks[0] ?? null;
  }, [activeRuntimeSnapshot]);
  const activeRuntimeTurn = useMemo(() => {
    const turns = activeRuntimeSnapshot.turns ?? [];
    if (!turns.length) {
      return null;
    }
    const preferredTurnId =
      activeRuntimeTask?.currentTurnId ?? activeRuntimeTask?.latestTurnId ?? "";
    if (!preferredTurnId) {
      return turns[0] ?? null;
    }
    return turns.find((turn) => turn.id === preferredTurnId) ?? turns[0] ?? null;
  }, [activeRuntimeSnapshot, activeRuntimeTask]);
  const activeRuntimeItems = useMemo(() => {
    if (!activeRuntimeTurn?.id) {
      return [];
    }
    return (activeRuntimeSnapshot.turnItems ?? []).filter(
      (item) => item.turnId === activeRuntimeTurn.id
    );
  }, [activeRuntimeSnapshot, activeRuntimeTurn]);

  const fetchCodexStatus = async ({ showNotice = false } = {}) => {
    const status = normalizeLoginStatus(await desktop.codexLoginStatus());
    if (mountedRef.current) {
      setCodexAuth(status);
      if (status.loggedIn) {
        setCodexLoginDetail("");
      }
    }
    if (showNotice) {
      setNotice({
        kind: status.loggedIn ? "success" : "info",
        text: status.message,
      });
    }
    return status;
  };

  const loadSessionProposals = async (sessionId, { silent = false } = {}) => {
    if (!sessionId) {
      if (!silent) {
        setProposalPanelState({ loading: false, error: "" });
      }
      return [];
    }

    if (!silent) {
      setProposalPanelState({ loading: true, error: "" });
    }

    try {
      const proposals = sortProposals(await desktop.approvalList(sessionId));
      if (mountedRef.current) {
        setProposalsBySession((current) => ({
          ...current,
          [sessionId]: proposals,
        }));
        if (!silent) {
          setProposalPanelState({ loading: false, error: "" });
        }
      }
      return proposals;
    } catch (error) {
      if (mountedRef.current && !silent) {
        setProposalPanelState({ loading: false, error: normalizeError(error) });
      }
      throw error;
    }
  };

  const loadSessionRuntimeSnapshot = async (sessionId, { silent = false } = {}) => {
    if (!sessionId) {
      if (!silent) {
        setRuntimePanelState({ loading: false, error: "" });
      }
      return normalizeRuntimeSnapshot(null, "");
    }

    if (!silent) {
      setRuntimePanelState({ loading: true, error: "" });
    }

    try {
      const snapshot = normalizeRuntimeSnapshot(
        await desktop.sessionRuntimeSnapshot(sessionId),
        sessionId
      );
      if (mountedRef.current) {
        setRuntimeSnapshotBySession((current) => ({
          ...current,
          [sessionId]: snapshot,
        }));
        if (!silent) {
          setRuntimePanelState({ loading: false, error: "" });
        }
      }
      return snapshot;
    } catch (error) {
      if (mountedRef.current && !silent) {
        setRuntimePanelState({ loading: false, error: normalizeError(error) });
      }
      throw error;
    }
  };

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    streamProgressRef.current = streamProgressBySession;
  }, [streamProgressBySession]);

  useEffect(() => {
    streamMonitorRef.current = streamMonitorBySession;
  }, [streamMonitorBySession]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!hasCustomWindowChrome) {
      return undefined;
    }

    let unlistenResize = null;
    const appWindow = getCurrentWindow();

    const syncWindowState = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (mountedRef.current) {
          setWindowMaximized(maximized);
        }
      } catch {
        // Ignore window manager state errors.
      }
    };

    void syncWindowState();
    void appWindow
      .onResized(() => {
        void syncWindowState();
      })
      .then((fn) => {
        unlistenResize = fn;
      })
      .catch(() => {
        unlistenResize = null;
      });

    return () => {
      if (typeof unlistenResize === "function") {
        unlistenResize();
      }
    };
  }, [hasCustomWindowChrome]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [loadedWorkspaces, loadedStatus, loadedSessions, loadedSettings] = await Promise.all([
          desktop.workspacesList(),
          desktop.codexLoginStatus(),
          desktop.sessionsList(),
          desktop.settingsGet(),
        ]);

        let nextSessions = loadedSessions;
        if (!nextSessions.length) {
          const createdSession = await desktop.sessionCreate();
          nextSessions = [createdSession];
        }

        const normalizedSettings = normalizeSettings(loadedSettings);

        if (cancelled) {
          return;
        }

        setTheme(normalizedSettings.theme);
        setSettings(normalizedSettings);
        setWorkspaces(loadedWorkspaces);
        setSessions(sortSessions(nextSessions));
        setActiveSessionId(nextSessions[0]?.id ?? "");
        setActiveWorkspaceId(nextSessions[0]?.workspaceId ?? "");
        setCodexAuth(normalizeLoginStatus(loadedStatus));
      } catch (error) {
        if (!cancelled) {
          setNotice({ kind: "error", text: normalizeError(error) });
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!activeWorkspace) {
      setWorkspaceTree(null);
      return () => {
        cancelled = true;
      };
    }

    void Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setWorkspaceTreeLoading(true);
        }
        return desktop.workspaceTree(activeWorkspace.id);
      })
      .then((tree) => {
        if (!cancelled) {
          setWorkspaceTree(tree);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkspaceTree(null);
          setNotice({ kind: "error", text: normalizeError(error) });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceTreeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace]);

  useEffect(() => {
    let cancelled = false;

    if (!activeSessionId) {
      setProposalPanelState({ loading: false, error: "" });
      return () => {
        cancelled = true;
      };
    }

    void loadSessionProposals(activeSessionId).catch((error) => {
      if (!cancelled) {
        setNotice({ kind: "error", text: `建议列表加载失败：${normalizeError(error)}` });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    let cancelled = false;

    if (!activeSessionId) {
      setRuntimePanelState({ loading: false, error: "" });
      return () => {
        cancelled = true;
      };
    }

    void loadSessionRuntimeSnapshot(activeSessionId).catch((error) => {
      if (!cancelled) {
        setNotice({ kind: "error", text: `Runtime 快照加载失败：${normalizeError(error)}` });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const stillExists = decisionOptions.some((option) => option.id === activeDecisionPreviewId);
    if (stillExists || decisionOptions.length === 0) {
      return;
    }

    setDecisionPreviewBySession((current) => ({
      ...current,
      [activeSessionId]: decisionOptions[0].id,
    }));
  }, [activeSessionId, activeDecisionPreviewId, decisionOptions]);

  useEffect(() => {
    let unlistenStatus = null;
    let unlistenToken = null;
    let unlistenDone = null;
    let unlistenProposalCreated = null;
    let unlistenApprovalUpdated = null;
    let unlistenCommandOutput = null;
    let unlistenCommandFinished = null;
    let unlistenCodexLoginProgress = null;

    const patchSession = (sessionId, updater) => {
      setSessions((current) =>
        current.map((session) => {
          if (session.id !== sessionId) {
            return session;
          }
          return updater(session);
        })
      );
    };

    const register = async () => {
      unlistenStatus = await desktop.listen("chat-stream-status", (event) => {
        const payload = event.payload;
        if (!payload?.sessionId || !payload?.messageId || !payload?.detail) {
          return;
        }
        const now = Date.now();
        const detail = String(payload.detail).trim();
        if (!detail) {
          return;
        }
        const stage =
          typeof payload.stage === "string" && payload.stage.trim() ? payload.stage.trim() : "处理中";
        const level = normalizeProgressLevel(payload.level);
        const entry = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          stage,
          detail,
          level,
        };
        setStreamProgressBySession((current) => {
          return appendProgressEntry(current, payload.sessionId, payload.messageId, entry);
        });
        setStreamMonitorBySession((current) => {
          const previous = current[payload.sessionId];
          const base =
            previous?.messageId === payload.messageId
              ? previous
              : {
                  messageId: payload.messageId,
                  startedAt: now,
                  lastStatusAt: 0,
                  lastTokenAt: 0,
                  statusCount: 0,
                  tokenCount: 0,
                  warnedNoToken: false,
                  warnedStall: false,
                  warnedLooping: false,
                };
          return {
            ...current,
            [payload.sessionId]: {
              ...base,
              lastStatusAt: now,
              statusCount: (base.statusCount ?? 0) + 1,
            },
          };
        });
      });

      unlistenToken = await desktop.listen("chat-stream-token", (event) => {
        const payload = event.payload;
        if (!payload?.sessionId || !payload?.messageId || !payload.delta) {
          return;
        }
        const now = Date.now();
        patchSession(payload.sessionId, (session) => {
          const messages = [...(session.messages ?? [])];
          const index = messages.findIndex((message) => message.id === payload.messageId);
          if (index >= 0) {
            const target = messages[index];
            messages[index] = {
              ...target,
              role: "assistant",
              content: `${target.content ?? ""}${payload.delta}`,
              status: "streaming",
            };
          } else {
            messages.push({
              id: payload.messageId,
              role: "assistant",
              content: payload.delta,
              timestamp: Date.now(),
              status: "streaming",
              attachments: [],
            });
          }
          return {
            ...session,
            messages,
            updatedAt: Date.now(),
          };
        });
        setStreamMonitorBySession((current) => {
          const previous = current[payload.sessionId];
          const base =
            previous?.messageId === payload.messageId
              ? previous
              : {
                  messageId: payload.messageId,
                  startedAt: now,
                  lastStatusAt: 0,
                  lastTokenAt: 0,
                  statusCount: 0,
                  tokenCount: 0,
                  warnedNoToken: false,
                  warnedStall: false,
                  warnedLooping: false,
                };
          return {
            ...current,
            [payload.sessionId]: {
              ...base,
              lastTokenAt: now,
              tokenCount: (base.tokenCount ?? 0) + 1,
            },
          };
        });
      });

      unlistenDone = await desktop.listen("chat-stream-done", (event) => {
        const payload = event.payload;
        if (!payload?.sessionId || !payload?.messageId) {
          return;
        }
        if (payload.sessionId === activeSessionIdRef.current) {
          setChatSending(false);
        }
        patchSession(payload.sessionId, (session) => {
          const messages = [...(session.messages ?? [])];
          const index = messages.findIndex((message) => message.id === payload.messageId);
          if (index >= 0) {
            messages[index] = {
              ...messages[index],
              role: "assistant",
              content: payload.content ?? messages[index].content ?? "",
              status: payload.status ?? "done",
            };
          } else {
            messages.push({
              id: payload.messageId,
              role: "assistant",
              content: payload.content ?? "",
              timestamp: Date.now(),
              status: payload.status ?? "done",
              attachments: [],
            });
          }
          return {
            ...session,
            title: payload.sessionTitle ?? session.title,
            messages,
            updatedAt: Date.now(),
          };
        });

        if (payload.status === "error") {
          setNotice({ kind: "error", text: payload.content || "请求失败。" });
        }
        setProposalPanelState((current) => ({ ...current, loading: false, error: "" }));
        void loadSessionRuntimeSnapshot(payload.sessionId, { silent: true }).catch(() => {});
        setStreamProgressBySession((current) => {
          if (!current[payload.sessionId]) {
            return current;
          }
          const next = { ...current };
          delete next[payload.sessionId];
          return next;
        });
        setStreamMonitorBySession((current) => {
          if (!current[payload.sessionId]) {
            return current;
          }
          const next = { ...current };
          delete next[payload.sessionId];
          return next;
        });
      });

      unlistenProposalCreated = await desktop.listen("tool-proposal-created", (event) => {
        const payload = event.payload;
        if (!payload?.sessionId || !payload?.id) {
          return;
        }
        setProposalPanelState((current) => ({ ...current, loading: false, error: "" }));
        void loadSessionRuntimeSnapshot(payload.sessionId, { silent: true }).catch(() => {});
        setProposalsBySession((current) => ({
          ...current,
          [payload.sessionId]: upsertProposal(current[payload.sessionId] ?? [], payload),
        }));
      });

      unlistenApprovalUpdated = await desktop.listen("approval-updated", (event) => {
        const payload = event.payload;
        if (!payload?.sessionId || !payload?.id) {
          return;
        }
        setProposalPanelState((current) => ({ ...current, loading: false, error: "" }));
        void loadSessionRuntimeSnapshot(payload.sessionId, { silent: true }).catch(() => {});
        setProposalsBySession((current) => ({
          ...current,
          [payload.sessionId]: upsertProposal(current[payload.sessionId] ?? [], payload),
        }));
      });

      unlistenCommandOutput = await desktop.listen("command-output", (event) => {
        const payload = event.payload;
        if (!payload?.proposalId || typeof payload.chunk !== "string") {
          return;
        }
        setProposalsBySession((current) =>
          patchProposalById(current, payload.proposalId, (proposal) => ({
            ...proposal,
            latestOutput: `${proposal.latestOutput ?? ""}${payload.chunk}`,
          }))
        );
      });

      unlistenCommandFinished = await desktop.listen("command-finished", (event) => {
        const payload = event.payload;
        if (!payload?.proposalId) {
          return;
        }
        setProposalsBySession((current) =>
          patchProposalById(current, payload.proposalId, (proposal) => ({
            ...proposal,
            latestOutput:
              proposal.latestOutput ??
              `命令执行结束，exit code ${payload.exitCode ?? -1}`,
          }))
        );
      });

      unlistenCodexLoginProgress = await desktop.listen("codex-login-progress", (event) => {
        const payload = event.payload;
        const detail = typeof payload?.detail === "string" ? payload.detail.trim() : "";
        if (!detail) {
          return;
        }
        setCodexLoginDetail(detail);
        if (payload?.terminal) {
          setNotice({ kind: "info", text: detail });
        }
      });
    };

    void register();

    return () => {
      if (typeof unlistenStatus === "function") {
        unlistenStatus();
      }
      if (typeof unlistenToken === "function") {
        unlistenToken();
      }
      if (typeof unlistenDone === "function") {
        unlistenDone();
      }
      if (typeof unlistenProposalCreated === "function") {
        unlistenProposalCreated();
      }
      if (typeof unlistenApprovalUpdated === "function") {
        unlistenApprovalUpdated();
      }
      if (typeof unlistenCommandOutput === "function") {
        unlistenCommandOutput();
      }
      if (typeof unlistenCommandFinished === "function") {
        unlistenCommandFinished();
      }
      if (typeof unlistenCodexLoginProgress === "function") {
        unlistenCodexLoginProgress();
      }
    };
  }, []);

  useEffect(() => {
    if (!chatSending) {
      setPendingSeconds(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setPendingSeconds((value) => value + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [chatSending]);

  useEffect(() => {
    if (!chatSending || !activeSessionId) {
      return undefined;
    }

    const noTokenWarnS =
      activeSessionMode === SESSION_MODE_WORKSPACE ? STREAM_NO_TOKEN_WARN_S_WORKSPACE : STREAM_NO_TOKEN_WARN_S;
    const stallWarnS =
      activeSessionMode === SESSION_MODE_WORKSPACE ? STREAM_STALL_WARN_S_WORKSPACE : STREAM_STALL_WARN_S;

    const timer = window.setInterval(() => {
      const monitor = streamMonitorRef.current[activeSessionId];
      if (!monitor) {
        return;
      }

      const now = Date.now();
      const elapsedMs = now - (monitor.startedAt ?? now);
      const lastProgressAt = Math.max(
        monitor.lastTokenAt ?? 0,
        monitor.lastStatusAt ?? 0,
        monitor.startedAt ?? now
      );
      const idleMs = now - lastProgressAt;

      const updates = {};
      const syntheticEntries = [];

      if (
        !monitor.warnedNoToken &&
        (monitor.tokenCount ?? 0) === 0 &&
        (monitor.statusCount ?? 0) > 0 &&
        elapsedMs >= noTokenWarnS * 1000
      ) {
        updates.warnedNoToken = true;
        syntheticEntries.push({
          stage: "监控",
          detail:
            activeSessionMode === SESSION_MODE_WORKSPACE
              ? `已进入工作区协作，${noTokenWarnS}s 仍在整理建议与预览。`
              : `已收到内部状态，但 ${noTokenWarnS}s 仍无正文输出。`,
          level: "warn",
        });
      }

      if (
        !monitor.warnedLooping &&
        (monitor.tokenCount ?? 0) === 0 &&
        (monitor.statusCount ?? 0) >= 8
      ) {
        const streamInfo = streamProgressRef.current[activeSessionId];
        const items = streamInfo?.items ?? [];
        const noisyCount = items.filter(
          (entry) =>
            typeof entry?.detail === "string" &&
            (entry.detail.toLowerCase().includes("item started") ||
              entry.detail.toLowerCase().includes("item completed"))
        ).length;
        if (noisyCount >= 4) {
          updates.warnedLooping = true;
          syntheticEntries.push({
            stage: "监控",
            detail: "检测到重复内部事件，疑似循环重试。",
            level: "warn",
          });
        }
      }

      if (!monitor.warnedStall && idleMs >= stallWarnS * 1000) {
        updates.warnedStall = true;
        syntheticEntries.push({
          stage: "监控",
          detail:
            activeSessionMode === SESSION_MODE_WORKSPACE
              ? `${stallWarnS}s 没有新进展，工作区协作仍在等待结果。`
              : `${stallWarnS}s 无新进展，回复时间偏长。`,
          level: "warn",
        });
      }

      if (syntheticEntries.length > 0) {
        setStreamProgressBySession((current) => {
          let next = current;
          for (const entry of syntheticEntries) {
            next = appendProgressEntry(next, activeSessionId, monitor.messageId, {
              id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              stage: entry.stage,
              detail: entry.detail,
              level: normalizeProgressLevel(entry.level),
            });
          }
          return next;
        });
      }

      if (Object.keys(updates).length > 0) {
        setStreamMonitorBySession((current) => {
          const existing = current[activeSessionId];
          if (!existing) {
            return current;
          }
          return {
            ...current,
            [activeSessionId]: {
              ...existing,
              ...updates,
            },
          };
        });
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [chatSending, activeSessionId, activeSessionMode]);

  const resetPreview = () => {
    setSelectedFilePath("");
    setFilePreview(null);
    setPreviewState({ loading: false, error: "" });
  };

  const handleCodexLogin = async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    setCodexChecking(true);
    setCodexLoginDetail("");
    try {
      await desktop.codexLoginStart();
      setNotice({
        kind: "info",
        text: "已启动登录流程，正在检测登录状态…",
      });

      for (let attempt = 0; attempt < LOGIN_POLL_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
          await sleep(LOGIN_POLL_INTERVAL_MS);
        }
        const status = await fetchCodexStatus();
        if (status.loggedIn) {
          setNotice({
            kind: "success",
            text: "登录状态已更新：已检测到 Codex 登录。",
          });
          return;
        }
      }

      setNotice({
        kind: "info",
        text: "暂未检测到登录完成。完成登录后可点“刷新状态”再次确认。",
      });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    } finally {
      setCodexChecking(false);
    }
  };

  const handleRefreshCodexStatus = async () => {
    setCodexChecking(true);
    try {
      await fetchCodexStatus({ showNotice: true });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    } finally {
      setCodexChecking(false);
    }
  };

  const handleCreateSession = async () => {
    try {
      let session = await desktop.sessionCreate();
      if (activeWorkspaceId) {
        session = await desktop.workspaceSelect(session.id, activeWorkspaceId);
      }
      setSessions((current) => upsertSession(current, session));
      void loadSessionRuntimeSnapshot(session.id, { silent: true }).catch(() => {});
      setActiveSessionId(session.id);
      setDraft("");
      setNotice({ kind: "success", text: "已创建新会话。" });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleSelectSession = (sessionId) => {
    const session = sessions.find((entry) => entry.id === sessionId);
    setActiveSessionId(sessionId);
    setActiveWorkspaceId(session?.workspaceId ?? "");
  };

  const handleDeleteSession = async (sessionId) => {
    const targetSession = sessions.find((entry) => entry.id === sessionId);
    if (!targetSession) {
      return;
    }

    const deletingActive = sessionId === activeSessionId;

    try {
      let remainingSessions = sortSessions(await desktop.sessionDelete(sessionId));
      if (!remainingSessions.length) {
        remainingSessions = [await desktop.sessionCreate()];
      }

      const nextActiveSession = deletingActive
        ? remainingSessions[0] ?? null
        : remainingSessions.find((entry) => entry.id === activeSessionId) ??
          remainingSessions[0] ??
          null;

      setSessions(remainingSessions);
      setActiveSessionId(nextActiveSession?.id ?? "");
      setActiveWorkspaceId(nextActiveSession?.workspaceId ?? "");
      setDraft("");
      resetPreview();
      setProposalsBySession((current) => {
        if (!current[sessionId]) {
          return current;
        }
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setDecisionPreviewBySession((current) => {
        if (!current[sessionId]) {
          return current;
        }
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setTurnIntentBySession((current) => {
        if (!current[sessionId]) {
          return current;
        }
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setStreamProgressBySession((current) => {
        if (!current[sessionId]) {
          return current;
        }
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setStreamMonitorBySession((current) => {
        if (!current[sessionId]) {
          return current;
        }
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setRuntimeSnapshotBySession((current) => {
        if (!current[sessionId]) {
          return current;
        }
        const next = { ...current };
        delete next[sessionId];
        return next;
      });

      setNotice({ kind: "info", text: `已删除会话：${targetSession.title}` });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleSetSessionMode = async (nextMode) => {
    if (!activeSessionId) {
      return;
    }
    const normalizedNextMode = normalizeSessionMode(nextMode);
    if (normalizedNextMode === activeSessionMode) {
      return;
    }
    if (
      normalizedNextMode === SESSION_MODE_WORKSPACE &&
      !activeSessionWorkspaceId
    ) {
      setNotice({
        kind: "info",
        text: "需要代码上下文时，先为当前会话选择一个目录。",
      });
      return;
    }

    try {
      const updated = await desktop.sessionModeSet(activeSessionId, normalizedNextMode);
      setSessions((current) => upsertSession(current, updated));
      if (normalizedNextMode === SESSION_MODE_WORKSPACE) {
        setTurnIntentBySession((current) => ({
          ...current,
          [activeSessionId]: current[activeSessionId] ?? TURN_INTENT_CHOICE,
        }));
      }
      setNotice({
        kind: "info",
        text:
          normalizedNextMode === SESSION_MODE_WORKSPACE
            ? "当前会话已切到工作区协作，默认先给方向建议。"
            : "当前会话已切回对话模式。",
      });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleSend = async () => {
    if (!activeSessionId) {
      return;
    }
    const input = draft.trim();
    if (!input || chatSending || hasStreamingAssistant || loginBlocked) {
      return;
    }

    setDraft("");
    setChatSending(true);
    setStreamProgressBySession((current) => {
      if (!current[activeSessionId]) {
        return current;
      }
      const next = { ...current };
      delete next[activeSessionId];
      return next;
    });
    setStreamMonitorBySession((current) => {
      if (!current[activeSessionId]) {
        return current;
      }
      const next = { ...current };
      delete next[activeSessionId];
      return next;
    });
    setDecisionPreviewBySession((current) => {
      if (!current[activeSessionId]) {
        return current;
      }
      const next = { ...current };
      delete next[activeSessionId];
      return next;
    });
    setProposalsBySession((current) => {
      const previous = current[activeSessionId];
      if (!previous?.length) {
        return current;
      }
      const nextProposals = previous.map((proposal) => {
        if (proposal.status !== "pending" && proposal.status !== "selected") {
          return proposal;
        }
        return {
          ...proposal,
          status: "rejected",
          latestOutput: "当前会话已开始新一轮协作。",
        };
      });
      return {
        ...current,
        [activeSessionId]: sortProposals(nextProposals),
      };
    });
    try {
      const updatedSession = await desktop.chatSend(
        activeSessionId,
        input,
        [],
        activeSessionMode,
        activeTurnIntent
      );
      setSessions((current) => upsertSession(current, updatedSession));
      void loadSessionRuntimeSnapshot(activeSessionId, { silent: true }).catch(() => {});
    } catch (error) {
      setChatSending(false);
      setDraft(input);
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleAddWorkspace = async (path) => {
    const workspace = await desktop.workspaceAdd(path);
    setWorkspaces((current) => [workspace, ...current]);
    setActiveWorkspaceId(workspace.id);
    resetPreview();

    if (activeSessionId) {
      try {
        const updated = await desktop.workspaceSelect(activeSessionId, workspace.id);
        setSessions((current) => upsertSession(current, updated));
      } catch (error) {
        setNotice({ kind: "error", text: normalizeError(error) });
      }
    }

    setWorkspaceModalOpen(false);
    setNotice({
      kind: "success",
      text: `已添加目录：${workspace.name}。Solo 只有在工作区协作时才会读取它。`,
    });
  };

  const handleRemoveWorkspace = async (workspaceId) => {
    try {
      await desktop.workspaceRemove(workspaceId);
      const nextWorkspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);
      setWorkspaces(nextWorkspaces);
      setActiveWorkspaceId((current) => (current === workspaceId ? "" : current));
      if (activeWorkspaceId === workspaceId) {
        setExplorerOpen(false);
      }
      resetPreview();
      const reloadedSessions = await desktop.sessionsList();
      setSessions(sortSessions(reloadedSessions));
      if (activeSessionId) {
        void loadSessionRuntimeSnapshot(activeSessionId, { silent: true }).catch(() => {});
      }
      setNotice({ kind: "info", text: "工作区已移除。" });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleSelectWorkspace = async (workspaceId) => {
    setActiveWorkspaceId(workspaceId);
    setExplorerOpen(false);
    resetPreview();
    if (!activeSessionId) {
      return;
    }
    try {
      const updated = await desktop.workspaceSelect(activeSessionId, workspaceId);
      setSessions((current) => upsertSession(current, updated));
      setNotice({
        kind: "info",
        text: "已为当前会话选择代码上下文。是否使用它，由你切换模式决定。",
      });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleDetachWorkspace = async () => {
    if (!activeSessionId) {
      setActiveWorkspaceId("");
      setExplorerOpen(false);
      resetPreview();
      return;
    }

    try {
      const updated = await desktop.workspaceSelect(activeSessionId, null);
      setSessions((current) => upsertSession(current, updated));
      setActiveWorkspaceId("");
      setExplorerOpen(false);
      resetPreview();
      setNotice({ kind: "info", text: "已清除当前代码上下文，会话继续保持对话模式。" });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleOpenFile = async (relativePath) => {
    if (!activeWorkspace) {
      return;
    }

    setExplorerOpen(true);
    setPreviewState({ loading: true, error: "" });
    try {
      const preview = await desktop.workspaceReadFile(activeWorkspace.id, relativePath);
      setSelectedFilePath(relativePath);
      setFilePreview(preview);
      setPreviewState({ loading: false, error: "" });
    } catch (error) {
      setSelectedFilePath(relativePath);
      setFilePreview(null);
      setPreviewState({ loading: false, error: normalizeError(error) });
    }
  };

  const handlePreviewDecision = (option) => {
    if (!activeSessionId) {
      return;
    }
    setDecisionPreviewBySession((current) => ({
      ...current,
      [activeSessionId]: option.id,
    }));
  };

  const handleChooseDecisionOption = async (option) => {
    setProposalActionId(option.id);
    try {
      setChatSending(true);
      setProposalPanelState({ loading: true, error: "" });
      setTurnIntentBySession((current) => ({
        ...current,
        [option.sessionId]: TURN_INTENT_PREVIEW,
      }));
      setStreamProgressBySession((current) => {
        if (!current[option.sessionId]) {
          return current;
        }
        const next = { ...current };
        delete next[option.sessionId];
        return next;
      });
      setStreamMonitorBySession((current) => {
        if (!current[option.sessionId]) {
          return current;
        }
        const next = { ...current };
        delete next[option.sessionId];
        return next;
      });
      const result = await desktop.proposalChoose(option.id);
      setSessions((current) => upsertSession(current, result.session));
      void loadSessionRuntimeSnapshot(result.session.id, { silent: true }).catch(() => {});
      setProposalsBySession((current) => {
        const previous = current[result.proposal.sessionId] ?? [];
        const nextProposals = previous.map((entry) => {
          if (entry.id === result.proposal.id) {
            return { ...entry, ...result.proposal };
          }
          if (entry.kind === "choice" && entry.status === "pending") {
            return {
              ...entry,
              status: "rejected",
              latestOutput: "当前会话已选择其他方向。",
            };
          }
          return entry;
        });
        return {
          ...current,
          [result.proposal.sessionId]: sortProposals(nextProposals),
        };
      });
      setNotice({ kind: "info", text: "已选择这个方向，正在展开具体预览。" });
    } catch (error) {
      setChatSending(false);
      setProposalPanelState({ loading: false, error: "" });
      setTurnIntentBySession((current) => ({
        ...current,
        [option.sessionId]: TURN_INTENT_CHOICE,
      }));
      setNotice({ kind: "error", text: normalizeError(error) });
    } finally {
      setProposalActionId("");
    }
  };

  const handleAcceptPreviewCard = async (card) => {
    setProposalActionId(card.id);
    try {
      const updated = await desktop.approvalAccept(card.id);
      void loadSessionRuntimeSnapshot(updated.sessionId, { silent: true }).catch(() => {});
      setProposalsBySession((current) => ({
        ...current,
        [updated.sessionId]: upsertProposal(current[updated.sessionId] ?? [], updated),
      }));

      if (updated.kind === "write") {
        if (activeWorkspace?.id === updated.payload?.workspaceId) {
          const nextTree = await desktop.workspaceTree(activeWorkspace.id);
          setWorkspaceTree(nextTree);
          if (selectedFilePath && selectedFilePath === updated.payload?.relativePath) {
            const preview = await desktop.workspaceReadFile(activeWorkspace.id, selectedFilePath);
            setFilePreview(preview);
            setPreviewState({ loading: false, error: "" });
          }
        }
        setNotice({ kind: "success", text: "已应用建议改动。" });
      } else {
        setNotice({ kind: "info", text: "已确认命令建议，正在执行。" });
      }
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    } finally {
      setProposalActionId("");
    }
  };

  const handleRejectPreviewCard = async (card) => {
    setProposalActionId(card.id);
    try {
      const updated = await desktop.approvalReject(card.id);
      void loadSessionRuntimeSnapshot(updated.sessionId, { silent: true }).catch(() => {});
      setProposalsBySession((current) => ({
        ...current,
        [updated.sessionId]: upsertProposal(current[updated.sessionId] ?? [], updated),
      }));
      setNotice({ kind: "info", text: "已拒绝这条建议。" });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    } finally {
      setProposalActionId("");
    }
  };

  const handleDismissDecisionSet = async (decisionSet) => {
    if (!decisionSet?.pendingOptions?.length) {
      return;
    }

    setProposalActionId(REJECT_ALL_DECISIONS_ACTION_ID);
    try {
      const updatedProposals = [];
      for (const option of decisionSet.pendingOptions) {
        updatedProposals.push(await desktop.approvalReject(option.id));
      }
      for (const updated of updatedProposals) {
        void loadSessionRuntimeSnapshot(updated.sessionId, { silent: true }).catch(() => {});
      }

      setProposalsBySession((current) => {
        const next = { ...current };
        for (const updated of updatedProposals) {
          next[updated.sessionId] = upsertProposal(next[updated.sessionId] ?? [], updated);
        }
        return next;
      });
      setDecisionPreviewBySession((current) => {
        if (!activeSessionId) {
          return current;
        }
        const next = { ...current };
        delete next[activeSessionId];
        return next;
      });
      setNotice({
        kind: "info",
        text: "这组方向已跳过。你可以补充要求，再让 Solo 重新给一组方向。",
      });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    } finally {
      setProposalActionId("");
    }
  };

  const handleComposerKeyDown = (event) => {
    if (event.nativeEvent?.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleThemeChange = async (event) => {
    const nextTheme = normalizeTheme(event.target.value);
    setTheme(nextTheme);
    try {
      await desktop.settingsUpdate({ theme: nextTheme });
      setSettings((current) => ({ ...current, theme: nextTheme }));
    } catch (error) {
      setNotice({ kind: "error", text: `主题保存失败：${normalizeError(error)}` });
    }
  };

  const handleSaveSettings = async (form) => {
    const normalized = normalizeSettings(form);
    const saved = normalizeSettings(await desktop.settingsUpdate(normalized));
    setSettings(saved);
    if (!providerUsesCodexLogin(saved.provider)) {
      setCodexLoginDetail("");
    }
    setTheme(saved.theme);
    setConnectionState({
      status: "success",
      message: saved.provider === "codex_cli"
        ? "设置已保存。后续 ChatGPT / Codex 子进程会使用新的代理规则。"
        : "设置已保存。",
    });
    setSettingsModalOpen(false);
    setNotice({
      kind: "success",
      text:
        saved.provider === "codex_cli"
          ? "设置已保存。新的代理配置会直接用于后续 ChatGPT / Codex 请求。"
          : "设置已保存。",
    });
  };

  const handleTestSettings = async (form) => {
    const normalized = normalizeSettings(form);
    setConnectionState({ status: "testing", message: "正在测试连接…" });
    try {
      const result = await desktop.settingsTestConnection(normalized);
      setConnectionState({
        status: result.success ? "success" : "error",
        message: result.message,
      });
    } catch (error) {
      setConnectionState({ status: "error", message: normalizeError(error) });
      throw error;
    }
  };

  const hasStreamingAssistant = Boolean(
    activeSession?.messages?.some(
      (message) => message.role === "assistant" && message.status === "streaming"
    )
  );
  const activeProvider = settings.provider;
  const providerNeedsCodexLogin = providerUsesCodexLogin(activeProvider);
  const loginBlocked = providerNeedsCodexLogin && (!codexAuth.loggedIn || codexChecking);
  const canSend = Boolean(
    activeSessionId &&
      draft.trim() &&
      !loginBlocked &&
      !chatSending &&
      !hasStreamingAssistant
  );
  const showPendingAssistant = Boolean(chatSending && activeSessionId && !hasStreamingAssistant);
  const activeStreamInfo = activeSessionId ? streamProgressBySession[activeSessionId] ?? null : null;
  const activeStreamMessageId = activeStreamInfo?.messageId ?? "";
  const activeStreamProgress = activeStreamInfo?.items ?? [];
  const pendingAssistantText = pendingAssistantLabel(
    pendingSeconds,
    activeSessionMode,
    activeTurnIntent
  );
  const composerHint = providerNeedsCodexLogin && !codexAuth.loggedIn
    ? "先完成 Codex 登录才能发送。"
    : activeProvider === "manual"
      ? "当前为手动协作模式，发送后只会记录问题。"
      : activeSessionWorkspaceId
        ? "Enter 发送，Shift+Enter 换行。"
        : "Enter 发送，Shift+Enter 换行。需要代码时点回形针。";
  const sessionMessageCount = activeSession?.messages?.length ?? 0;
  const workspaceStatusText = activeSessionWorkspaceId
    ? activeWorkspace?.name ?? "已选择"
    : "按需添加";
  const modeLabel = sessionModeLabel(activeSessionMode);
  const topbarContextLabel = sessionModeTrailLabel(activeSessionMode);
  const inspectorWorkspaceState = activeSessionWorkspaceId ? "linked" : "detached";
  const previewTitle = selectedFilePath || "暂无文件";
  const previewStateLabel = previewState.loading
    ? "loading"
    : previewState.error
      ? "error"
      : filePreview
        ? "ready"
        : "empty";
  const inspectorWorkspaceStateText = activeSessionWorkspaceId ? "已选择" : "未选择";
  const previewStateText = previewState.loading
    ? "读取中"
    : previewState.error
      ? "错误"
      : filePreview
        ? "就绪"
        : "空";
  const collaborationEnabled = activeSessionMode === SESSION_MODE_WORKSPACE;
  const collaborationAvailable = Boolean(activeSessionWorkspaceId);
  const selectedChoiceLabel = selectedDecisionOption?.optionKey ?? selectedDecisionOption?.title ?? "";
  const previewDeckActive = showPreviewCards;
  const suggestionInspectorTone = proposalPanelState.error
    ? "error"
    : decisionOptions.length > 0 || previewDeckActive || proposalPanelState.loading
      ? "loading"
      : selectedDecisionOption
        ? "active"
        : "idle";
  const suggestionInspectorStatus = proposalPanelState.error
    ? "加载失败"
    : showDecisionDeck
      ? `${decisionOptions.length} 个方向`
      : previewDeckActive
        ? `${previewProposals.length} 张预览`
        : proposalPanelState.loading
          ? "展开中"
          : selectedDecisionOption
            ? "已选择"
            : "无待确认";
  const showSuggestionPanel =
    proposalPanelState.loading ||
    Boolean(proposalPanelState.error) ||
    showDecisionDeck ||
    previewDeckActive ||
    Boolean(selectedDecisionOption);
  const runtimePanelTone = runtimePanelState.error
    ? "error"
    : runtimePanelState.loading
      ? "loading"
      : activeRuntimeTurn
        ? runtimeTone(activeRuntimeTurn.status)
        : activeRuntimeTask
          ? runtimeTone(activeRuntimeTask.status)
          : "idle";
  const runtimePanelStatus = runtimePanelState.error
    ? "加载失败"
    : runtimePanelState.loading
      ? "读取中"
      : activeRuntimeTurn
        ? turnStatusLabel(activeRuntimeTurn.status)
        : activeRuntimeTask
          ? taskStatusLabel(activeRuntimeTask.status)
          : "空";
  const runtimeItemList = activeRuntimeItems.slice(-6);
  const showPreviewPanel = previewState.loading || Boolean(previewState.error) || Boolean(filePreview);
  const composerPlaceholder = collaborationEnabled
    ? activeTurnIntent === TURN_INTENT_CHOICE
      ? "描述你想让 Solo 给出的方向建议；它会先生成方向卡，再由你点开预览。"
      : activeTurnIntent === TURN_INTENT_PREVIEW
        ? "描述你想直接展开的具体预览；Solo 会先给改动范围和影响点，不会直接应用。"
        : "描述你想让 Solo 结合当前工作区分析的事；它会先查看相关文件再回答。"
    : collaborationAvailable
      ? "直接提问；如果这轮需要代码上下文，再切到工作区协作。"
      : "直接提问；需要代码上下文时再补充一个目录，并切到工作区协作。";
  const chatSubtitle = collaborationEnabled
    ? activeTurnIntent === TURN_INTENT_CHOICE
      ? `当前会话会显式结合工作区 ${activeWorkspace?.name ?? "当前项目"} 协作，先给方向建议，再由你点开预览并确认。`
      : activeTurnIntent === TURN_INTENT_PREVIEW
        ? `当前会话会显式结合工作区 ${activeWorkspace?.name ?? "当前项目"} 协作，直接沿当前方向展开具体预览。`
        : `当前会话会显式结合工作区 ${activeWorkspace?.name ?? "当前项目"} 协作，先看相关文件，再给结论和依据。`
    : collaborationAvailable
      ? `当前为对话模式。目录 ${activeWorkspace?.name ?? "当前项目"} 已作为可选上下文接入，只有切到工作区协作时才会参与。`
      : "当前为对话模式。先直接提问；需要代码上下文时再补充目录并进入工作区协作。";
  const workspaceContextText = collaborationAvailable
    ? `${activeWorkspace?.name ?? "当前项目"} · 仅在工作区协作里使用`
    : "当前没有代码上下文，先对话也可以";
  const modeIntentText = collaborationEnabled
    ? `这一轮会结合工作区，当前阶段：${turnIntentLabel(activeTurnIntent)}`
    : collaborationAvailable
      ? "这一轮只对话，不自动读工作区"
      : "当前为普通对话";
  const modeGuidanceText = collaborationEnabled
    ? activeTurnIntent === TURN_INTENT_CHOICE
      ? "Solo 会先查看相关文件，再把多个方向整理成可点开的方向卡。"
      : activeTurnIntent === TURN_INTENT_PREVIEW
        ? "Solo 会直接展开更具体的改动预览，但仍然不会自动应用。"
        : "Solo 会先查看相关文件，再给结论、依据和下一步建议。"
    : collaborationAvailable
      ? "代码目录只是可选上下文。只有你切到“工作区协作”后，它才会真正参与回答。"
      : "先直接提问；只有需要代码依据时再补充目录。";
  const composerContextButtonLabel = activeSessionWorkspaceId
    ? `更换代码上下文，当前为 ${activeWorkspace?.name ?? "已选目录"}`
    : "添加代码上下文";

  const handleWindowMinimize = async () => {
    if (!hasCustomWindowChrome) {
      return;
    }
    try {
      await getCurrentWindow().minimize();
    } catch {
      // Ignore window manager errors.
    }
  };

  const handleWindowToggleMaximize = async () => {
    if (!hasCustomWindowChrome) {
      return;
    }
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setWindowMaximized(await appWindow.isMaximized());
    } catch {
      // Ignore window manager errors.
    }
  };

  const handleWindowClose = async () => {
    if (!hasCustomWindowChrome) {
      return;
    }
    try {
      await getCurrentWindow().close();
    } catch {
      // Ignore close errors.
    }
  };

  return (
    <div className={`app-shell mode-${layoutMode}`}>
      <header className="topbar">
        <div
          className="topbar-dragzone"
          data-tauri-drag-region={hasCustomWindowChrome ? true : undefined}
          onDoubleClick={() => void handleWindowToggleMaximize()}
        >
          <div className="topbar-brand">
            <div className="topbar-route">
              <div className="topbar-trail" aria-label="current context">
                <span className="topbar-app">solo</span>
                <span className="topbar-separator">/</span>
                <span className="topbar-context">{topbarContextLabel}</span>
              </div>
              <span className="topbar-title-divider" aria-hidden="true" />
              <h1>{activeSession?.title ?? "新会话"}</h1>
            </div>
          </div>
        </div>
        <div className="topbar-status">
          <div className="status-pill">
            <span className="status-pill-label">
              {providerNeedsCodexLogin ? "Codex 登录" : "连接"}
            </span>
            <strong className="status-pill-value">
              {providerNeedsCodexLogin
                ? (!codexAuth.available
                    ? "不可用"
                    : codexAuth.loggedIn
                      ? "已登录"
                      : "未登录")
                : activeProvider === "manual"
                  ? "手动"
                  : settings.modelId
                    ? "已配置"
                    : "未配置"}
            </strong>
          </div>
          <div className="status-pill">
            <span className="status-pill-label">模式</span>
            <strong className="status-pill-value">{modeLabel}</strong>
          </div>
          <label className="status-pill status-pill-theme">
            <span className="status-pill-label">主题</span>
            <select className="theme-select" value={theme} onChange={(event) => void handleThemeChange(event)}>
              {THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="status-pill">
            <span className="status-pill-label">上下文</span>
            <strong className="status-pill-value status-pill-code">{workspaceStatusText}</strong>
          </div>
          <button
            type="button"
            className="status-pill status-pill-button"
            onClick={() => {
              setConnectionState({ status: "idle", message: "" });
              setSettingsModalOpen(true);
            }}
          >
            <span className="status-pill-label">设置</span>
            <strong className="status-pill-value">网络</strong>
          </button>
        </div>
        {hasCustomWindowChrome ? (
          <div className="window-controls">
            <button
              type="button"
              className="window-control-button"
              aria-label="最小化窗口"
              onClick={() => void handleWindowMinimize()}
            >
              <WindowControlIcon kind="minimize" />
            </button>
            <button
              type="button"
              className="window-control-button"
              aria-label={windowMaximized ? "还原窗口" : "最大化窗口"}
              onClick={() => void handleWindowToggleMaximize()}
            >
              <WindowControlIcon kind="maximize" maximized={windowMaximized} />
            </button>
            <button
              type="button"
              className="window-control-button window-control-close"
              aria-label="关闭窗口"
              onClick={() => void handleWindowClose()}
            >
              <WindowControlIcon kind="close" />
            </button>
          </div>
        ) : null}
      </header>

      <SettingsModal
        open={settingsModalOpen}
        settings={settings}
        connectionState={connectionState}
        onClose={() => {
          setConnectionState({ status: "idle", message: "" });
          setSettingsModalOpen(false);
        }}
        onSave={handleSaveSettings}
        onTest={handleTestSettings}
      />

      {notice ? (
        <section className={`status-banner status-banner-${notice.kind}`}>
          <strong>{notice.kind === "error" ? "错误" : notice.kind === "success" ? "完成" : "提示"}</strong>
          <span>{notice.text}</span>
          <button type="button" className="ghost-button" onClick={() => setNotice(null)}>
            关闭
          </button>
        </section>
      ) : null}

      <main className="workspace-shell">
        <aside className="sidebar">
          <section className="panel-block panel-sessions">
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Sessions</p>
                <div className="section-title-row">
                  <h2>会话</h2>
                  <span className="section-count">{sessions.length}</span>
                </div>
              </div>
              <button type="button" className="ghost-button" onClick={handleCreateSession}>
                新建
              </button>
            </div>
            <div className="session-list">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`session-card ${session.id === activeSessionId ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    className={`session-main ${session.id === activeSessionId ? "is-active" : ""}`}
                    onClick={() => handleSelectSession(session.id)}
                    aria-label={`打开会话 ${session.title}`}
                  >
                    <div className="session-row">
                      <span className="session-title">{session.title}</span>
                      <span className="list-badge">{session.messages?.length ?? 0}</span>
                    </div>
                    <span className="session-meta">{sessionModeTrailLabel(session.interactionMode)}</span>
                  </button>
                  <button
                    type="button"
                    className="danger-button session-delete-button"
                    onClick={() => handleDeleteSession(session.id)}
                    aria-label={`删除会话 ${session.title}`}
                    disabled={chatSending && session.id === activeSessionId}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-block panel-workspaces">
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Context</p>
                <div className="section-title-row">
                  <h2>代码上下文</h2>
                  <span className="section-count">{workspaces.length}</span>
                </div>
                <p className="section-note">默认先对话。需要代码时，用输入框旁的回形针补充目录。</p>
              </div>
            </div>
            {workspaces.length ? (
              <div className="workspace-list">
                {workspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className={`workspace-card ${
                      workspace.id === activeWorkspaceId ? "is-active" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="workspace-main"
                      onClick={() => void handleSelectWorkspace(workspace.id)}
                    >
                      <div className="workspace-row">
                        <span className="workspace-title">{workspace.name}</span>
                        {workspace.id === activeSessionWorkspaceId ? (
                          <span className="list-badge list-badge-accent">当前上下文</span>
                        ) : null}
                      </div>
                      <span className="workspace-path">{workspace.path}</span>
                      <span className="workspace-caption">
                        {workspace.id === activeSessionWorkspaceId
                          ? "当前会话会在工作区协作里读取这个目录"
                          : "设为当前上下文"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => handleRemoveWorkspace(workspace.id)}
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel-collapsed-note">
                <p>还没有保存的目录。需要代码上下文时，用输入框旁的回形针添加。</p>
              </div>
            )}
          </section>

          <section
            className={`panel-block panel-explorer ${explorerOpen ? "is-grow" : "is-collapsed"}`}
          >
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Explorer</p>
                <div className="section-title-row">
                  <h2>文件树</h2>
                </div>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setExplorerOpen((current) => !current)}
                disabled={!activeWorkspace}
              >
                {explorerOpen ? "收起" : "展开"}
              </button>
            </div>
            {!explorerOpen ? (
              <div className="panel-collapsed-note">
                <p>
                  {activeWorkspace
                    ? "文件树默认折叠。需要看文件时再展开。"
                    : "还没有可用代码目录。需要时再添加。"}
                </p>
              </div>
            ) : activeWorkspace ? (
              workspaceTreeLoading ? (
                <div className="empty-state compact">
                  <p>正在加载文件树…</p>
                </div>
              ) : workspaceTree ? (
                <div className="tree-panel">
                  <WorkspaceTreeNode
                    node={workspaceTree}
                    level={0}
                    selectedPath={selectedFilePath}
                    onOpenFile={handleOpenFile}
                  />
                </div>
              ) : (
                <div className="empty-state compact">
                  <p>当前目录暂无可显示的文件树。</p>
                </div>
              )
            ) : (
              <div className="empty-state compact">
                <p>需要代码时，再添加一个目录。</p>
              </div>
            )}
          </section>
        </aside>

        <section className="chat-pane">
          <div className="chat-head">
            <div className="chat-head-shell">
              <div className="chat-head-main">
                <p className="section-eyebrow">Conversation</p>
                <h2>{activeSession?.title ?? "新会话"}</h2>
                <p className="chat-subtitle">{chatSubtitle}</p>
                <div className="chat-context-strip">
                  <div className="chat-context-item">
                    <span className="chat-context-label">代码上下文</span>
                    <strong className="chat-context-value">{workspaceContextText}</strong>
                  </div>
                  <div className="chat-context-item">
                    <span className="chat-context-label">当前方式</span>
                    <strong className="chat-context-value">{modeIntentText}</strong>
                  </div>
                  <p className="chat-context-note">{modeGuidanceText}</p>
                </div>
              </div>
              <div className="compact-row">
                <div className="mode-switch" role="tablist" aria-label="会话模式">
                  <button
                    type="button"
                    className={`ghost-button mode-switch-button ${
                      activeSessionMode === SESSION_MODE_CONVERSATION ? "is-active" : ""
                    }`}
                    onClick={() => void handleSetSessionMode(SESSION_MODE_CONVERSATION)}
                    aria-pressed={activeSessionMode === SESSION_MODE_CONVERSATION}
                  >
                    对话
                  </button>
                  <button
                    type="button"
                    className={`ghost-button mode-switch-button ${
                      activeSessionMode === SESSION_MODE_WORKSPACE ? "is-active" : ""
                    }`}
                    disabled={!collaborationAvailable}
                    onClick={() => void handleSetSessionMode(SESSION_MODE_WORKSPACE)}
                    aria-pressed={activeSessionMode === SESSION_MODE_WORKSPACE}
                    title={
                      collaborationAvailable ? "结合当前工作区协作" : "先选择一个代码目录，再进入工作区协作"
                    }
                  >
                    工作区协作
                  </button>
                </div>
                {collaborationEnabled ? (
                  <div className="mode-switch turn-intent-switch" role="tablist" aria-label="当前回合阶段">
                    <button
                      type="button"
                      className={`ghost-button mode-switch-button ${
                        activeTurnIntent === TURN_INTENT_AUTO ? "is-active" : ""
                      }`}
                      onClick={() =>
                        setTurnIntentBySession((current) => ({
                          ...current,
                          [activeSessionId]: TURN_INTENT_AUTO,
                        }))
                      }
                      aria-pressed={activeTurnIntent === TURN_INTENT_AUTO}
                    >
                      协作分析
                    </button>
                    <button
                      type="button"
                      className={`ghost-button mode-switch-button ${
                        activeTurnIntent === TURN_INTENT_CHOICE ? "is-active" : ""
                      }`}
                      onClick={() =>
                        setTurnIntentBySession((current) => ({
                          ...current,
                          [activeSessionId]: TURN_INTENT_CHOICE,
                        }))
                      }
                      aria-pressed={activeTurnIntent === TURN_INTENT_CHOICE}
                    >
                      方向建议
                    </button>
                    <button
                      type="button"
                      className={`ghost-button mode-switch-button ${
                        activeTurnIntent === TURN_INTENT_PREVIEW ? "is-active" : ""
                      }`}
                      onClick={() =>
                        setTurnIntentBySession((current) => ({
                          ...current,
                          [activeSessionId]: TURN_INTENT_PREVIEW,
                        }))
                      }
                      aria-pressed={activeTurnIntent === TURN_INTENT_PREVIEW}
                    >
                      具体预览
                    </button>
                  </div>
                ) : null}
                {activeSessionWorkspaceId ? (
                  <button type="button" className="ghost-button" onClick={handleDetachWorkspace}>
                    清除上下文
                  </button>
                ) : null}
                <button type="button" className="ghost-button" onClick={handleCreateSession}>
                  新会话
                </button>
                {providerNeedsCodexLogin && !codexAuth.loggedIn ? (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={codexChecking}
                    onClick={handleCodexLogin}
                  >
                    {codexChecking ? "登录中…" : "登录 Codex"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="chat-scroll">
            <div className="conversation-stack">
              {providerNeedsCodexLogin && !codexAuth.loggedIn ? (
                <div className="shell-card hero-card">
                  <p className="section-eyebrow">Codex</p>
                  <h2>登录 Codex</h2>
                  <p>{codexAuth.message}</p>
                  {codexLoginDetail ? <p className="field-hint">{codexLoginDetail}</p> : null}
                  <div className="compact-row">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={codexChecking}
                      onClick={handleCodexLogin}
                    >
                      {codexChecking ? "登录中…" : "登录 Codex"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={codexChecking}
                      onClick={handleRefreshCodexStatus}
                    >
                      {codexChecking ? "刷新中…" : "刷新状态"}
                    </button>
                  </div>
                </div>
              ) : activeSession?.messages?.length ? (
                <>
                  {activeSession.messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      progress={
                        message.id === activeStreamMessageId &&
                        (message.status === "streaming" || message.status === "error")
                          ? activeStreamProgress
                          : []
                      }
                    />
                  ))}
                  {showPendingAssistant ? (
                    <MessageBubble
                      message={{
                        id: "assistant_pending",
                        role: "assistant",
                        status: "streaming",
                        content: pendingAssistantText,
                      }}
                      progress={activeStreamProgress}
                    />
                  ) : null}
                  {showDecisionDeck ? (
                    <section className="shell-card inline-proposals decision-deck">
                      <div className="inline-proposals-head decision-deck-head">
                        <div>
                          <p className="section-eyebrow">Decisions</p>
                          <h3>先选一个方向</h3>
                        </div>
                        <div className="decision-deck-meta">
                          <p className="inline-proposals-note">
                            {decisionOptions.length > 1
                              ? "先左右看完方向卡，再锁定一个方向继续展开预览。"
                              : "先点开这个方向的预览，再决定是否确认。"}
                          </p>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={rejectingAllDecisions}
                            onClick={() => handleDismissDecisionSet(activeDecisionSet)}
                          >
                            {rejectingAllDecisions
                              ? "处理中…"
                              : activeDecisionSet.dismissAction?.label ?? "都不选"}
                          </button>
                        </div>
                      </div>
                      <div className="decision-deck-stage">
                        <div className="decision-choice-rail">
                          <div className={`decision-deck-grid ${decisionOptions.length > 1 ? "is-multi" : ""}`}>
                            {decisionOptions.map((option, index) => (
                              <DecisionOptionCard
                                key={option.id}
                                option={option}
                                active={activeDecisionPreviewOption?.id === option.id}
                                index={index}
                                total={decisionOptions.length}
                                onPreview={handlePreviewDecision}
                              />
                            ))}
                          </div>
                        </div>
                        <DecisionPreviewPanel
                          option={activeDecisionPreviewOption}
                          decisionSet={activeDecisionSet}
                          busy={proposalActionId === activeDecisionPreviewOption?.id}
                          skipBusy={rejectingAllDecisions}
                          onConfirm={handleChooseDecisionOption}
                          onSkipAll={handleDismissDecisionSet}
                        />
                      </div>
                    </section>
                  ) : null}
                  {selectedDecisionOption ? (
                    <section className="shell-card selected-choice-banner">
                      <div className="selected-choice-banner-head">
                        <p className="section-eyebrow">Selected</p>
                        <span className="drawer-chip drawer-chip-active">已选择</span>
                      </div>
                      <h3>{selectedChoiceLabel || "已选择一个方向"}</h3>
                      <p>
                        {previewDeckActive
                          ? "这个方向的预览已经展开在下方，确认后才会应用。"
                          : "正在沿这个方向生成更具体的预览。"}
                      </p>
                    </section>
                  ) : null}
                  {showPreviewCards ? (
                    <section className="shell-card inline-proposals preview-card-set">
                      <div className="inline-proposals-head">
                        <div>
                          <p className="section-eyebrow">Preview</p>
                          <h3>确认具体预览</h3>
                        </div>
                        <p className="inline-proposals-note">这些都只是预览，确认后才会真正应用。</p>
                      </div>
                      <div className="proposal-stack preview-card-grid">
                        {previewProposals.map((card) => (
                          <ProposalCard
                            key={card.id}
                            card={card}
                            busy={proposalActionId === card.id}
                            onAccept={handleAcceptPreviewCard}
                            onReject={handleRejectPreviewCard}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : (
                <div className="empty-state hero">
                  <p className="section-eyebrow">Conversation</p>
                  <h2>先开始对话，代码上下文按需再加。</h2>
                  <p>
                    {collaborationEnabled
                      ? "你已经进入工作区协作。Solo 会先查看相关文件，再给出建议、权衡和改动预览。"
                      : collaborationAvailable
                        ? providerNeedsCodexLogin
                          ? "你已经完成 Codex 登录。现在可以继续直接提问；如果需要代码上下文，再显式切到工作区协作。"
                          : "当前连接已就绪。现在可以继续直接提问；如果需要代码上下文，再显式切到工作区协作。"
                        : providerNeedsCodexLogin
                          ? "你已经完成 Codex 登录。现在可以直接提问；需要代码依据时再补充目录并切到工作区协作。"
                          : "当前连接已就绪。现在可以直接提问；需要代码依据时再补充目录并切到工作区协作。"}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="composer">
            <div className="composer-shell">
              <textarea
                className="composer-input"
                value={draft}
                disabled={loginBlocked || chatSending || hasStreamingAssistant}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={composerPlaceholder}
              />
              <div className="composer-actions">
                <p className="composer-hint">{composerHint}</p>
                <div className="composer-button-row">
                  <button
                    type="button"
                    className={`ghost-button composer-attach-button ${
                      activeSessionWorkspaceId ? "has-context" : ""
                    }`}
                    aria-label={composerContextButtonLabel}
                    title={composerContextButtonLabel}
                    onClick={() => setWorkspaceModalOpen(true)}
                  >
                    <PaperclipIcon />
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!canSend}
                    onClick={handleSend}
                  >
                    发送
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-head">
            <div>
              <p className="section-eyebrow">Inspector</p>
              <h2>上下文与预览</h2>
            </div>
            <span className="section-count">{modeLabel}</span>
          </div>

          <div className="inspector-scroll">
            <section className="drawer-panel">
              <div className="drawer-panel-head">
                <div className="drawer-panel-title">
                  <span className="section-eyebrow">Context</span>
                  <strong>当前上下文</strong>
                </div>
                <span className={`drawer-chip drawer-chip-${inspectorWorkspaceState}`}>
                  {inspectorWorkspaceStateText}
                </span>
              </div>
              <div className="drawer-meta-grid">
                <div className="drawer-meta-row">
                  <span className="drawer-meta-label">代码上下文</span>
                  <span className="drawer-meta-value">{activeWorkspace?.name ?? "未选择"}</span>
                </div>
                <div className="drawer-meta-row">
                  <span className="drawer-meta-label">模式</span>
                  <span className="drawer-meta-value">
                    {collaborationEnabled ? "工作区协作" : "对话"}
                  </span>
                </div>
                <div className="drawer-meta-row">
                  <span className="drawer-meta-label">消息</span>
                  <span className="drawer-meta-value">
                    {activeSession ? `${sessionMessageCount} 条消息` : "请先创建会话。"}
                  </span>
                </div>
                <div className="drawer-meta-row">
                  <span className="drawer-meta-label">会话</span>
                  <span className="drawer-meta-value">{activeSession?.title ?? "暂无会话"}</span>
                </div>
              </div>
            </section>

            <section className="drawer-panel">
              <div className="drawer-panel-head">
                <div className="drawer-panel-title">
                  <span className="section-eyebrow">Runtime</span>
                  <strong>当前任务流</strong>
                </div>
                <span className={`drawer-chip drawer-chip-${runtimePanelTone}`}>
                  {runtimePanelStatus}
                </span>
              </div>
              <div className="drawer-meta-grid">
                <div className="drawer-meta-row">
                  <span className="drawer-meta-label">任务</span>
                  <span className="drawer-meta-value">
                    {activeRuntimeTask?.title || "当前还没有任务骨架。"}
                  </span>
                </div>
                <div className="drawer-meta-row">
                  <span className="drawer-meta-label">任务态</span>
                  <span className="drawer-meta-value">
                    {activeRuntimeTask ? taskStatusLabel(activeRuntimeTask.status) : "空"}
                  </span>
                </div>
                <div className="drawer-meta-row">
                  <span className="drawer-meta-label">回合</span>
                  <span className="drawer-meta-value">
                    {activeRuntimeTurn
                      ? `${turnIntentLabel(activeRuntimeTurn.intent)} · ${formatRuntimeTime(
                          activeRuntimeTurn.updatedAt ?? activeRuntimeTurn.createdAt
                        )}`
                      : "当前还没有回合记录。"}
                  </span>
                </div>
                <div className="drawer-meta-row">
                  <span className="drawer-meta-label">计数</span>
                  <span className="drawer-meta-value">
                    {`${activeRuntimeSnapshot.tasks.length} task / ${activeRuntimeSnapshot.turns.length} turn / ${activeRuntimeSnapshot.turnItems.length} item`}
                  </span>
                </div>
              </div>
              <div className="drawer-preview-body">
                {runtimePanelState.error ? (
                  <div className="status-banner status-banner-error">
                    <strong>Runtime 读取失败</strong>
                    <span>{runtimePanelState.error}</span>
                  </div>
                ) : runtimeItemList.length > 0 ? (
                  <div className="runtime-item-list">
                    {runtimeItemList.map((item) => (
                      <div key={item.id} className="runtime-item-card">
                        <div className="runtime-item-head">
                          <span className="section-eyebrow">{turnItemKindLabel(item.kind)}</span>
                          <span
                            className={`drawer-chip drawer-chip-${runtimeTone(
                              item.status,
                              item.approvalState
                            )}`}
                          >
                            {runtimeItemStateLabel(item)}
                          </span>
                        </div>
                        <strong>{item.title || turnItemKindLabel(item.kind)}</strong>
                        <p>{item.summary || truncateInline(item.content || "暂无摘要。", 96)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="proposal-empty">
                    <p>当前会话还没有可展示的结构化 item。</p>
                  </div>
                )}
              </div>
            </section>

            {showSuggestionPanel ? (
              <section className="drawer-panel drawer-panel-proposals">
                <div className="drawer-panel-head">
                  <div className="drawer-panel-title">
                    <span className="section-eyebrow">Suggestions</span>
                    <strong>当前阶段</strong>
                  </div>
                  <span className={`drawer-chip drawer-chip-${suggestionInspectorTone}`}>
                    {suggestionInspectorStatus}
                  </span>
                </div>
                <div className="drawer-preview-body">
                  {proposalPanelState.error ? (
                    <div className="status-banner status-banner-error">
                      <strong>加载失败</strong>
                      <span>{proposalPanelState.error}</span>
                    </div>
                  ) : (
                    <div className="proposal-empty">
                      <p>
                        {showDecisionDeck
                          ? `主区有 ${decisionOptions.length} 个方向卡，先选一个方向。`
                          : previewDeckActive
                            ? `主区有 ${previewProposals.length} 张预览卡，确认后再应用。`
                            : proposalPanelState.loading
                              ? "正在根据你刚选的方向展开具体预览…"
                              : selectedDecisionOption
                                ? `已选择 ${selectedChoiceLabel || "一个方向"}，等待预览完成。`
                                : "当前没有额外建议。"}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {showPreviewPanel ? (
              <section className="drawer-panel drawer-panel-preview is-grow">
                <div className="drawer-panel-head">
                  <div className="drawer-panel-title">
                    <span className="section-eyebrow">Preview</span>
                    <strong>{previewTitle}</strong>
                  </div>
                  <span className={`drawer-chip drawer-chip-${previewStateLabel}`}>{previewStateText}</span>
                </div>
                <div className="drawer-preview-body">
                  {previewState.loading ? <p>正在读取文件…</p> : null}
                  {previewState.error ? (
                    <div className="status-banner status-banner-error">
                      <strong>预览失败</strong>
                      <span>{previewState.error}</span>
                    </div>
                  ) : null}
                  {filePreview ? (
                    <>
                      <pre>{filePreview.content}</pre>
                      {filePreview.isTruncated ? (
                        <p className="preview-note">该文件较大，当前只显示前 12000 个字符预览。</p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        </aside>
      </main>

      <WorkspaceModal
        open={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        onSubmit={handleAddWorkspace}
      />
    </div>
  );
}
