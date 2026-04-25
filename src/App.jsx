import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "./api/desktop";
import { SettingsModal } from "./components/SettingsModal";
import { WorkspaceModal } from "./components/WorkspaceModal";
import "./App.css";

const LOGIN_POLL_ATTEMPTS = 15;
const LOGIN_POLL_INTERVAL_MS = 2000;
const CODEX_AGENT_POLL_INTERVAL_MS = 5000;
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

function normalizeTheme() {
  return DEFAULT_THEME;
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
  return normalizeSessionMode(mode) === SESSION_MODE_WORKSPACE ? "resource-attached" : "managed";
}

function sessionModeTrailLabel(mode) {
  return normalizeSessionMode(mode) === SESSION_MODE_WORKSPACE ? "resource-attached" : "managed";
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
    return "direction";
  }
  if (normalized === TURN_INTENT_PREVIEW) {
    return "preview";
  }
  return "analysis";
}

function pendingAssistantLabel(seconds, sessionMode, turnIntent = TURN_INTENT_AUTO) {
  const normalizedMode = normalizeSessionMode(sessionMode);
  if (normalizedMode === SESSION_MODE_WORKSPACE) {
    const normalizedIntent = normalizeTurnIntent(turnIntent);
    if (normalizedIntent === TURN_INTENT_CHOICE) {
      if (seconds >= 20) {
        return `正在查看附加资源并整理方向建议…（${seconds}s）`;
      }
      if (seconds >= 3) {
        return `正在整理方向建议…（${seconds}s）`;
      }
      return "正在整理方向建议…";
    }
    if (normalizedIntent === TURN_INTENT_PREVIEW) {
      if (seconds >= 20) {
        return `正在查看附加资源并展开具体预览…（${seconds}s）`;
      }
      if (seconds >= 3) {
        return `正在展开具体预览…（${seconds}s）`;
      }
      return "正在展开具体预览…";
    }
    if (seconds >= 20) {
      return `正在查看附加资源并整理协作分析…（${seconds}s）`;
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
    return "Pending";
  }
  if (status === "selected") {
    return "Selected";
  }
  if (status === "approved") {
    return "Approved";
  }
  if (status === "applied") {
    return "Applied";
  }
  if (status === "executed") {
    return "Executed";
  }
  if (status === "rejected") {
    return "Rejected";
  }
  if (status === "failed") {
    return "Failed";
  }
  return status || "Unknown";
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

function normalizeObservedCodexAgents(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((agent) => agent && typeof agent === "object")
    .map((agent) => ({
      id: typeof agent.id === "string" && agent.id.trim() ? agent.id : `external-codex-${agent.pid ?? "unknown"}`,
      pid: Number.isFinite(agent.pid) ? agent.pid : 0,
      cwd: typeof agent.cwd === "string" && agent.cwd.trim() ? agent.cwd : "unknown",
      command: typeof agent.command === "string" ? agent.command : "",
      startedAt: agent.startedAt ?? null,
      state: typeof agent.state === "string" && agent.state.trim() ? agent.state : "unknown",
      ownership: typeof agent.ownership === "string" && agent.ownership.trim() ? agent.ownership : "external",
      controlLevel:
        typeof agent.controlLevel === "string" && agent.controlLevel.trim()
          ? agent.controlLevel
          : "observeOnly",
      matchedWorkspaceId:
        typeof agent.matchedWorkspaceId === "string" && agent.matchedWorkspaceId.trim()
          ? agent.matchedWorkspaceId
          : null,
      matchedSessionId:
        typeof agent.matchedSessionId === "string" && agent.matchedSessionId.trim()
          ? agent.matchedSessionId
          : null,
      lastSeenAt: Number.isFinite(agent.lastSeenAt) ? agent.lastSeenAt : Date.now(),
    }));
}

function codexAgentStateLabel(state) {
  if (state === "running") {
    return "running";
  }
  if (state === "sleeping") {
    return "waiting";
  }
  return "unknown";
}

function codexAgentTone(agent) {
  if (agent?.state === "running") {
    return "active";
  }
  if (agent?.state === "sleeping") {
    return "loading";
  }
  return "idle";
}

function ExternalAgentResourceCard({ agent, workspace, session, current, onFocusSession }) {
  return (
    <div className={`external-resource-agent-card ${current ? "is-current" : ""}`}>
      <div className="external-resource-agent-head">
        <div>
          <span className="section-eyebrow">External Codex</span>
          <strong>{workspace?.name ?? "Untracked workspace"}</strong>
        </div>
        <span className={`drawer-chip drawer-chip-${codexAgentTone(agent)}`}>
          {codexAgentStateLabel(agent.state)}
        </span>
      </div>
      <div className="external-agent-meta">
        <span>observe-only</span>
        <span>{workspace ? "linked" : "untracked"}</span>
      </div>
      {session ? (
        <button
          type="button"
          className="ghost-button external-agent-action"
          onClick={() => onFocusSession(session.id)}
        >
          Focus
        </button>
      ) : null}
    </div>
  );
}

function taskStatusLabel(status) {
  if (status === "active") {
    return "active";
  }
  if (status === "waitingUser") {
    return "waiting approval";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "completed") {
    return "done";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return status || "unknown";
}

function turnStatusLabel(status) {
  if (status === "running") {
    return "running";
  }
  if (status === "pending") {
    return "queued";
  }
  if (status === "completed") {
    return "done";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return status || "unknown";
}

function turnItemKindLabel(kind) {
  if (kind === "userMessage") {
    return "user";
  }
  if (kind === "agentMessage") {
    return "agent";
  }
  if (kind === "plan") {
    return "plan";
  }
  if (kind === "statusUpdate") {
    return "status";
  }
  if (kind === "choice") {
    return "decision";
  }
  if (kind === "conceptPreview") {
    return "preview";
  }
  if (kind === "fileChangePreview") {
    return "file preview";
  }
  if (kind === "commandPreview") {
    return "command preview";
  }
  if (kind === "approvalRequest") {
    return "approval";
  }
  if (kind === "commandOutput") {
    return "command output";
  }
  if (kind === "commandResult") {
    return "command result";
  }
  return kind || "event";
}

function approvalStateLabel(state) {
  if (state === "pending") {
    return "waiting";
  }
  if (state === "accepted") {
    return "accepted";
  }
  if (state === "rejected") {
    return "rejected";
  }
  if (state === "applied") {
    return "applied";
  }
  if (state === "failed") {
    return "failed";
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
    return "now";
  }
  return new Date(timestamp).toLocaleString("en-US", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function proposalPrimaryActionLabel(proposal) {
  if (proposal.kind === "choice") {
    return "Choose";
  }
  if (proposal.kind === "command") {
    return "Run";
  }
  return "Approve";
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
    title = "正在查看相关文件和资源…";
  } else if (latest.stage === "工作区") {
    title = latestDetail || "正在接入当前资源…";
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

function EmptyVisual({ label = "Empty", tone = "idle" }) {
  return (
    <div className={`empty-visual empty-visual-${tone}`} aria-label={label} role="img">
      <span />
      <span />
      <span />
    </div>
  );
}

function MessageBubble({ message, progress = [] }) {
  const status = messageStatusLabel(message.status);
  const roleLabel = message.role === "user" ? "You" : "ChatGPT";
  const messageText =
    message.role === "assistant" && message.status === "streaming" && !message.content?.trim()
      ? "Generating..."
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
              <span className="proposal-meta-label">File</span>
              <span className="proposal-meta-value">{card.relativePath || "not provided"}</span>
            </div>
            {previewText ? (
              <div className="proposal-preview-block">
                <span className="proposal-block-label">Preview</span>
                <pre>{previewText}</pre>
              </div>
            ) : null}
          </>
        ) : isChoice ? (
          <>
            <div className="proposal-meta-row">
              <span className="proposal-meta-label">Option</span>
              <span className="proposal-meta-value">{card.optionKey || "not provided"}</span>
            </div>
            {card.detail ? (
              <div className="proposal-preview-block">
                <span className="proposal-block-label">Detail</span>
                <pre>{truncateBlock(card.detail, 1200)}</pre>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="proposal-meta-row">
              <span className="proposal-meta-label">Command</span>
              <span className="proposal-meta-value">{card.reason || "suggested command"}</span>
            </div>
            {commandText ? (
              <div className="proposal-preview-block">
                <span className="proposal-block-label">Preview</span>
                <pre>{commandText}</pre>
              </div>
            ) : null}
            {outputText ? (
              <div className="proposal-preview-block">
                <span className="proposal-block-label">Latest output</span>
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
            {busy ? "Working..." : proposalPrimaryActionLabel(card)}
          </button>
          <button type="button" className="ghost-button" disabled={busy} onClick={() => onReject(card)}>
            Reject
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
          <span className="section-eyebrow">Option {optionKey}</span>
          <div className="decision-option-badges">
            <span className="decision-option-index">{String(index + 1).padStart(2, "0")}</span>
            {active ? <span className="drawer-chip drawer-chip-active">Preview</span> : null}
          </div>
        </div>
        <div className="decision-option-body">
          <strong>{option.title}</strong>
          <p>{option.summary}</p>
        </div>
        <div className="decision-option-foot">
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
  const scopeUnit = scopeCount > 0 ? "files" : "local";
  const costValue = scopeCount > 3 ? "medium" : "low";
  const costNote = scopeCount > 3 ? "touches multiple files" : "localized change";

  return (
    <div className="decision-preview-panel">
      <div className="decision-preview-hero">
        <div className="decision-preview-head">
          <div>
            <p className="section-eyebrow">Direction preview</p>
            <h4>{option.title}</h4>
            <p className="decision-preview-kicker">Inspecting option {optionKey}</p>
          </div>
          <span className="drawer-chip drawer-chip-idle">preview</span>
        </div>
        <p className="decision-preview-summary">{heroSummary}</p>
      </div>

      <div className="decision-judgment-board">
        <section className="decision-judgment-card decision-judgment-card-scope">
          <span className="decision-judgment-label">Scope</span>
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
            <p className="decision-judgment-note">one local entry</p>
          )}
        </section>

        <section className="decision-judgment-card decision-judgment-card-gain">
          <span className="decision-judgment-label">Gain</span>
          <div className="decision-judgment-copy">
            {(gainSignals.length ? gainSignals : ["improves the current bottleneck"]).map((signal) => (
              <p key={signal}>{signal}</p>
            ))}
          </div>
        </section>

        <section className="decision-judgment-card decision-judgment-card-risk">
          <span className="decision-judgment-label">Risk</span>
          <div className="decision-judgment-copy">
            {(riskSignals.length ? riskSignals : ["controlled risk; confirm boundaries"]).map((signal) => (
              <p key={signal}>{signal}</p>
            ))}
          </div>
        </section>

        <section className="decision-judgment-card decision-judgment-card-cost">
          <span className="decision-judgment-label">Cost</span>
          <div className="decision-judgment-metric is-compact">
            <strong>{costValue}</strong>
            <span>complexity</span>
          </div>
          <p className="decision-judgment-note">{costNote}</p>
        </section>
      </div>

      {preview.sections.length > 0 ? (
        <details className="decision-preview-details">
          <summary>View details</summary>
          <div className="decision-preview-details-grid">
            {preview.sections.map((section) => (
              <section
                key={`${option.id}-${section.title}-detail`}
                className={`decision-preview-card decision-preview-card-${section.kind}`}
              >
                <div className="decision-preview-card-head">
                  <span className="section-eyebrow">{section.title}</span>
                  {section.kind === "files" && section.files.length > 0 ? (
                    <span className="drawer-chip drawer-chip-active">{section.files.length} files</span>
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
        <div className="decision-preview-actions">
          <button
            type="button"
            className="primary-button"
            disabled={busy || skipBusy}
            onClick={() => onConfirm(option)}
          >
            {busy ? "Working..." : "Choose"}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={busy || skipBusy}
            onClick={() => onSkipAll(decisionSet)}
          >
            {skipBusy ? "Working..." : decisionSet?.dismissAction?.label ?? "Skip"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RuntimeSummaryCard({ label, value, tone = "idle", detail = "" }) {
  return (
    <article className={`runtime-summary-card runtime-summary-card-${tone}`} title={detail || label}>
      <span className="runtime-summary-label">{label}</span>
      <strong className="runtime-summary-value">{value}</strong>
      <span className="runtime-summary-signal" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </article>
  );
}

function TaskBoardCard({ entry, active, onSelect }) {
  return (
    <button
      type="button"
      className={`task-board-card task-board-card-${entry.tone} ${active ? "is-active" : ""}`}
      onClick={() => onSelect(entry.id)}
      aria-label={`查看任务流 ${entry.title}`}
    >
      <div className="task-board-card-head">
        <div className="task-board-card-heading">
          <strong>{entry.title}</strong>
          <span className="task-board-card-meta">{entry.meta}</span>
        </div>
        <span className={`list-badge list-badge-${entry.tone}`}>{entry.statusLabel}</span>
      </div>
      <p className="task-board-card-summary">{entry.summary}</p>
      <div className="task-board-card-foot">
        <span className={`task-board-pill ${entry.hasException ? "is-alert" : ""}`}>
          {entry.hasException ? entry.exceptionSummary : "点击切换到详情区"}
        </span>
        {active ? <span className="task-board-pill is-active">当前选中</span> : null}
      </div>
    </button>
  );
}

function TaskBoardLane({
  title,
  eyebrow,
  tone = "idle",
  entries,
  activeSessionId,
  onSelect,
  emptyLabel,
}) {
  return (
    <section className={`task-board-lane task-board-lane-${tone}`}>
      <div className="task-board-lane-head">
        <div>
          <p className="section-eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        <span className={`drawer-chip drawer-chip-${tone}`}>{entries.length}</span>
      </div>
      {entries.length ? (
        <div className="task-board-lane-list">
          {entries.map((entry) => (
            <TaskBoardCard
              key={entry.id}
              entry={entry}
              active={entry.id === activeSessionId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <div className="task-board-empty">
          <EmptyVisual label={emptyLabel} tone={tone} />
        </div>
      )}
    </section>
  );
}

function WorkstreamCard({ entry, active, onSelect, onDelete, deletingDisabled = false }) {
  return (
    <div className={`session-card ${active ? "is-active" : ""}`}>
      <button
        type="button"
        className={`session-main ${active ? "is-active" : ""}`}
        onClick={() => onSelect(entry.id)}
        aria-label={`打开任务流 ${entry.title}`}
      >
        <div className="session-row">
          <span className="session-title">{entry.title}</span>
          <span className={`list-badge list-badge-${entry.tone}`}>{entry.statusLabel}</span>
        </div>
        <span className="session-meta">{entry.meta}</span>
        <span className="session-caption">{entry.summary}</span>
      </button>
      <button
        type="button"
        className="danger-button session-delete-button"
        onClick={() => onDelete(entry.id)}
        aria-label={`删除任务流 ${entry.title}`}
        disabled={deletingDisabled}
      >
        Remove
      </button>
    </div>
  );
}

function ExceptionCard({ entry, active, onSelect }) {
  return (
    <button
      type="button"
      className={`exception-card ${active ? "is-active" : ""}`}
      onClick={() => onSelect(entry.id)}
      aria-label={`查看异常任务流 ${entry.title}`}
    >
      <div className="exception-card-head">
        <strong>{entry.title}</strong>
        <span className={`drawer-chip drawer-chip-${entry.tone}`}>{entry.exceptionLabel}</span>
      </div>
      <span className="exception-card-meta">{entry.meta}</span>
      <p>{entry.exceptionSummary}</p>
    </button>
  );
}

export default function App() {
  const [observedCodexState, setObservedCodexState] = useState({
    agents: [],
    loading: false,
    error: "",
  });

  useEffect(() => {
    let cancelled = false;

    const loadObservedCodexAgents = async () => {
      setObservedCodexState((current) => ({
        ...current,
        loading: current.agents.length === 0,
        error: "",
      }));
      try {
        const agents = normalizeObservedCodexAgents(await desktop.codexRunningAgents());
        if (cancelled) {
          return;
        }
        setObservedCodexState({
          agents,
          loading: false,
          error: "",
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setObservedCodexState((current) => ({
          ...current,
          loading: false,
          error: normalizeError(error),
        }));
      }
    };

    void loadObservedCodexAgents();
    const timer = window.setInterval(() => void loadObservedCodexAgents(), CODEX_AGENT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const mountedRef = useRef(true);
  const activeSessionIdRef = useRef("");
  const composerInputRef = useRef(null);

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
  const [inspectorTab, setInspectorTab] = useState("trace");

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
  const layoutMode = "workbench";
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
  const sessionRuntimeSummaries = useMemo(
    () =>
      sessions.map((session) => {
        const snapshot = normalizeRuntimeSnapshot(runtimeSnapshotBySession[session.id], session.id);
        const tasks = snapshot.tasks ?? [];
        const turns = snapshot.turns ?? [];
        const task = tasks[0] ?? null;
        const preferredTurnId = task?.currentTurnId ?? task?.latestTurnId ?? "";
        const turn =
          turns.find((item) => item.id === preferredTurnId) ??
          turns[0] ??
          null;
        const pendingApprovals = (snapshot.turnItems ?? []).filter(
          (item) => item.approvalState === "pending"
        ).length;
        const failedItems = (snapshot.turnItems ?? []).filter(
          (item) =>
            item.status === "failed" ||
            item.status === "cancelled" ||
            item.approvalState === "failed" ||
            item.approvalState === "rejected"
        ).length;
        const tone = failedItems > 0
          ? "error"
          : pendingApprovals > 0 || task?.status === "waitingUser"
            ? "loading"
            : task?.status === "completed" || turn?.status === "completed"
              ? "ready"
              : task?.status === "active" || turn?.status === "running"
                ? "active"
                : "idle";
        const statusLabel = task
          ? taskStatusLabel(task.status)
          : turn
            ? turnStatusLabel(turn.status)
            : sessionModeTrailLabel(session.interactionMode);
        const summary =
          task?.summary?.trim() ||
          turn?.summary?.trim() ||
          snapshot.turnItems.at(-1)?.summary?.trim() ||
          "No structured task summary yet.";
        const meta = turn
          ? `${turnIntentLabel(turn.intent)} · ${formatRuntimeTime(turn.updatedAt ?? turn.createdAt)}`
          : `${sessionModeTrailLabel(session.interactionMode)} · ${formatRuntimeTime(session.updatedAt)}`;
        const bucket = failedItems > 0
          ? "blocked"
          : pendingApprovals > 0 || task?.status === "waitingUser"
            ? "waiting"
            : task?.status === "completed" || task?.status === "cancelled" || turn?.status === "completed"
              ? "done"
              : "active";
        let exceptionLabel = "";
        let exceptionSummary = "";
        if (failedItems > 0) {
          exceptionLabel = "异常";
          exceptionSummary = `${failedItems} 个失败或拒绝事件需要处理`;
        } else if (pendingApprovals > 0) {
          exceptionLabel = "待确认";
          exceptionSummary = `${pendingApprovals} 个检查点等待你介入`;
        } else if (task?.status === "waitingUser") {
          exceptionLabel = "待决策";
          exceptionSummary = "当前任务停在等待用户决策状态。";
        }
        return {
          id: session.id,
          title: task?.title || session.title,
          statusLabel,
          tone,
          summary,
          meta,
          bucket,
          hasException: Boolean(exceptionLabel),
          exceptionLabel,
          exceptionSummary,
        };
      }),
    [sessions, runtimeSnapshotBySession]
  );
  const activeWorkstreamEntries = useMemo(
    () => sessionRuntimeSummaries.filter((entry) => entry.bucket === "active"),
    [sessionRuntimeSummaries]
  );
  const waitingWorkstreamEntries = useMemo(
    () => sessionRuntimeSummaries.filter((entry) => entry.bucket === "waiting"),
    [sessionRuntimeSummaries]
  );
  const doneWorkstreamEntries = useMemo(
    () => sessionRuntimeSummaries.filter((entry) => entry.bucket === "done"),
    [sessionRuntimeSummaries]
  );
  const exceptionEntries = useMemo(
    () => sessionRuntimeSummaries.filter((entry) => entry.hasException),
    [sessionRuntimeSummaries]
  );
  const activeSessionSummary = useMemo(
    () => sessionRuntimeSummaries.find((entry) => entry.id === activeSessionId) ?? null,
    [sessionRuntimeSummaries, activeSessionId]
  );

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
    document.documentElement.setAttribute("data-theme", DEFAULT_THEME);
  }, []);

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
              ? `已启用附加资源，${noTokenWarnS}s 仍在整理建议与预览。`
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
              ? `${stallWarnS}s 没有新进展，资源参与 run 仍在等待结果。`
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
        text: "当前没有待授权的资源请求。",
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
            ? "当前 run 已启用附加资源，默认先给方向建议。"
            : "当前 run 已切回纯对话，不会读取附加资源。",
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
      text: `已添加目录资源：${workspace.name}。Solo 只会在你启用资源参与时读取它。`,
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
        text: "已附加到当前 run。是否读取它，由资源参与开关决定。",
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
      setNotice({ kind: "info", text: "已移除当前资源，后续 run 不会读取该目录。" });
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

  const handleSaveSettings = async (form) => {
    const normalized = normalizeSettings(form);
    const saved = normalizeSettings(await desktop.settingsUpdate(normalized));
    setSettings(saved);
    if (!providerUsesCodexLogin(saved.provider)) {
      setCodexLoginDetail("");
    }
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
    ? "Log in to Codex before sending."
    : activeProvider === "manual"
      ? "Manual provider: sending only records the request."
      : "Enter to send, Shift+Enter for newline.";
  const modeLabel = sessionModeLabel(activeSessionMode);
  const inspectorWorkspaceState = activeSessionWorkspaceId ? "linked" : "detached";
  const previewTitle = selectedFilePath || "暂无文件";
  const previewStateLabel = previewState.loading
    ? "loading"
    : previewState.error
      ? "error"
      : filePreview
        ? "ready"
        : "empty";
  const inspectorWorkspaceStateText = activeSessionWorkspaceId ? "linked" : "detached";
  const previewStateText = previewState.loading
    ? "读取中"
    : previewState.error
      ? "错误"
      : filePreview
        ? "ready"
        : "empty";
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
    ? "error"
    : showDecisionDeck
      ? `${decisionOptions.length} directions`
      : previewDeckActive
        ? `${previewProposals.length} previews`
        : proposalPanelState.loading
          ? "loading"
          : selectedDecisionOption
            ? "selected"
            : "clear";
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
    ? "error"
    : runtimePanelState.loading
      ? "loading"
      : activeRuntimeTurn
        ? turnStatusLabel(activeRuntimeTurn.status)
        : activeRuntimeTask
          ? taskStatusLabel(activeRuntimeTask.status)
          : "idle";
  const runtimeItemList = activeRuntimeItems.slice(-6);
  const runtimeTimelineItems = activeRuntimeItems.slice(-8).reverse();
  const primaryObservedCodexAgent = observedCodexState.agents[0] ?? null;
  const runtimeTimelineDisplayItems = runtimeTimelineItems.length
    ? runtimeTimelineItems
    : [
        {
          id: "fallback-task-target",
          kind: "summary",
          status: "pending",
          approvalState: "notRequired",
          title: "Task target missing",
          summary: "Create a task to start a managed run.",
          createdAt: null,
          updatedAt: null,
        },
        {
          id: "fallback-no-run",
          kind: "statusUpdate",
          status: "pending",
          approvalState: "notRequired",
          title: "No active run",
          summary: "Solo is waiting for a concrete target.",
          createdAt: null,
          updatedAt: null,
        },
        primaryObservedCodexAgent
          ? {
              id: "fallback-external-codex",
              kind: "statusUpdate",
              status: primaryObservedCodexAgent.state === "running" ? "running" : "pending",
              approvalState: "notRequired",
              title: "External Codex observed",
              summary: "observe-only resource; controls disabled.",
              createdAt: primaryObservedCodexAgent.lastSeenAt,
              updatedAt: primaryObservedCodexAgent.lastSeenAt,
            }
          : null,
      ].filter(Boolean);
  const runtimePendingApprovalCount = activeRuntimeItems.filter(
    (item) => item.approvalState === "pending"
  ).length;
  const runtimeFailedCount = activeRuntimeItems.filter(
    (item) =>
      item.status === "failed" ||
      item.status === "cancelled" ||
      item.approvalState === "failed" ||
      item.approvalState === "rejected"
  ).length;
  const runtimeResourceCount =
    (activeSessionWorkspaceId ? 1 : 0) +
    (activeSessionMode === SESSION_MODE_WORKSPACE ? 1 : 0);
  const runtimeWorkstreamLabel =
    activeRuntimeTask?.title || activeSession?.title || "Untitled workstream";
  const runtimeTaskCount = activeRuntimeSnapshot.tasks.length;
  const runtimeTurnCount = activeRuntimeSnapshot.turns.length;
  const runtimeArtifactCount = previewProposals.length + (filePreview ? 1 : 0);
  const runtimeExceptionCount = runtimePendingApprovalCount + runtimeFailedCount;
  const hasPendingApproval =
    showDecisionDeck || showPreviewCards || runtimePendingApprovalCount > 0;
  const supervisionState = runtimeExceptionCount > 0
    ? "blocked"
    : hasPendingApproval
      ? "waitingApproval"
      : activeRuntimeTurn
        ? "running"
        : "idle";
  const currentTaskTitle =
    activeRuntimeTask?.title || (supervisionState === "idle" ? "No task target yet" : "Waiting task");
  const currentTaskStateLabel =
    supervisionState === "blocked"
      ? "blocked"
      : supervisionState === "waitingApproval"
        ? "waiting approval"
        : supervisionState === "running"
          ? "running"
          : "idle";
  const currentRunStateLabel = activeRuntimeTurn
    ? turnStatusLabel(activeRuntimeTurn.status)
    : chatSending
      ? "running"
      : "idle";
  const nextIntentLabel =
    supervisionState === "waitingApproval"
      ? "approve"
      : supervisionState === "running"
        ? "observe"
        : supervisionState === "blocked"
          ? "inspect"
          : "create";
  const visibleRuntimeTimelineItems = runtimeTimelineDisplayItems.slice(0, 2);
  const hiddenRuntimeTimelineCount = Math.max(0, runtimeTimelineDisplayItems.length - visibleRuntimeTimelineItems.length);
  
  const runtimeOutputCards = [
    ...previewProposals.map((card) => ({
      id: card.id,
      title: card.title || "Preview",
      meta: card.relativePath || card.kind || "preview",
      tone: card.status === "failed" ? "error" : "approval",
    })),
    ...(filePreview
      ? [
          {
            id: "file-preview",
            title: previewTitle,
            meta: "file preview",
            tone: "external",
          },
        ]
      : []),
    ...(selectedDecisionOption
      ? [
          {
            id: selectedDecisionOption.id,
            title: selectedDecisionOption.title || "Selected direction",
            meta: "direction",
            tone: "active",
          },
        ]
      : []),
  ];
  const visibleOutputCards = runtimeOutputCards.slice(0, 3);
  const outputOverflowCount = Math.max(0, runtimeOutputCards.length - visibleOutputCards.length);
  const outputCountLabel =
    runtimeOutputCards.length > 3 ? `3 +${outputOverflowCount}` : String(runtimeOutputCards.length);
  const activeRunLabel = activeRuntimeTurn
    ? `${turnIntentLabel(activeRuntimeTurn.intent)} · ${turnStatusLabel(activeRuntimeTurn.status)}`
    : "no active run";
  const activeRunTimeLabel = activeRuntimeTurn
    ? formatRuntimeTime(activeRuntimeTurn.updatedAt ?? activeRuntimeTurn.createdAt)
    : "not started";
  const activeRunSummary = activeRuntimeItems.length
    ? truncateInline(
        activeRuntimeItems.at(-1)?.summary || activeRuntimeItems.at(-1)?.content || "Waiting for runtime events.",
        96
      )
    : "Waiting for a task target.";
  const runtimeFocusTitle = runtimeExceptionCount > 0
    ? "Needs review"
    : showPreviewCards || showDecisionDeck || runtimePendingApprovalCount > 0
      ? "Waiting approval"
      : activeRuntimeTurn
        ? "Run healthy"
        : "Waiting task";
  const runtimeFocusDetail = runtimeExceptionCount > 0
    ? `${runtimeExceptionCount} exception or approval item needs review`
    : showDecisionDeck
      ? `${decisionOptions.length} directions waiting`
      : showPreviewCards
        ? `${previewProposals.length} previews waiting`
        : activeRuntimeTurn
          ? "Run is moving; inspect the timeline for detail"
          : "Create a task or send a goal to start the first run";
  const showPreviewPanel = previewState.loading || Boolean(previewState.error) || Boolean(filePreview);
  const inspectorTitle = hasPendingApproval
    ? "Checkpoint · direction approval"
    : supervisionState === "running"
      ? "Active run"
      : primaryObservedCodexAgent
        ? "External Codex"
        : "No checkpoint selected";
  const inspectorStatus = hasPendingApproval
    ? "Needs approval"
    : supervisionState === "blocked"
      ? "Blocked"
      : supervisionState === "running"
        ? "Running"
        : "Idle";
  const inspectorQuestion = hasPendingApproval
    ? "Accept current direction?"
    : supervisionState === "running"
      ? "Inspect current run?"
      : primaryObservedCodexAgent
        ? "Review observed external run?"
        : "Describe the next task target.";
  const inspectorImpact = hasPendingApproval
    ? "Impact: next phase can continue after approval"
    : supervisionState === "running"
      ? "Impact: runtime remains managed"
      : primaryObservedCodexAgent
        ? "Impact: observe-only, controls disabled"
        : "Impact: no runtime changes until a task is created";
  const inspectorEvidence = hasPendingApproval
    ? ["Decision pending", "Preview available", "Runtime unchanged"]
    : supervisionState === "running"
      ? ["Active run present", "Timeline is authoritative", "Outputs remain evidence-only"]
      : primaryObservedCodexAgent
        ? ["External Codex observed", "observe-only", "Can convert later"]
        : ["No active run", "No pending checkpoint", "Task target missing"];
  const inspectorTabs = [
    {
      id: "trace",
      label: "Trace",
      description: `${runtimeTaskCount} task / ${runtimeTurnCount} turn`,
      badgeTone: runtimePanelTone,
      badgeText: runtimePanelStatus,
    },
    {
      id: "artifacts",
      label: "Artifacts",
      description: runtimeArtifactCount > 0 ? `${runtimeArtifactCount} outputs` : "no outputs",
      badgeTone: previewStateLabel === "empty" ? "idle" : previewStateLabel,
      badgeText: runtimeArtifactCount > 0 ? String(runtimeArtifactCount) : "0",
    },
    {
      id: "resources",
      label: "Resources",
      description: activeWorkspace?.name ?? "no resource",
      badgeTone: inspectorWorkspaceState,
      badgeText: String(runtimeResourceCount),
    },
    {
      id: "controls",
      label: "Controls",
      description: runtimeFocusTitle,
      badgeTone: runtimeExceptionCount > 0 ? "error" : showSuggestionPanel ? suggestionInspectorTone : "idle",
      badgeText: runtimeExceptionCount > 0 ? String(runtimeExceptionCount) : showSuggestionPanel ? suggestionInspectorStatus : "clear",
    },
  ];
  const inspectorSummaryCards = [
    {
      label: "Focus",
      value: runtimeFocusTitle,
      detail: runtimeFocusDetail,
      tone: runtimeExceptionCount > 0 ? "error" : runtimePanelTone,
    },
    {
      label: "Run",
      value: activeRunLabel,
      detail: `${activeRunTimeLabel} · ${runtimeWorkstreamLabel}`,
      tone: runtimePanelTone,
    },
    {
      label: "Items",
      value: `${activeRuntimeSnapshot.turnItems.length} events`,
      detail: `${runtimeTaskCount} task / ${runtimeTurnCount} turn / ${runtimeArtifactCount} artifact`,
      tone: activeRuntimeSnapshot.turnItems.length > 0 ? "active" : "idle",
    },
    {
      label: "Exceptions",
      value: runtimeExceptionCount > 0 ? `${runtimeExceptionCount} pending` : "clear",
      detail:
        runtimePendingApprovalCount > 0
          ? `${runtimePendingApprovalCount} approvals waiting`
          : runtimeFailedCount > 0
            ? `${runtimeFailedCount} failed or rejected`
            : "No exceptions",
      tone: runtimeExceptionCount > 0 ? "error" : "ready",
    },
  ];
  const composerPlaceholder = collaborationEnabled
    ? activeTurnIntent === TURN_INTENT_CHOICE
      ? "Describe the goal; Solo will propose directions first."
      : activeTurnIntent === TURN_INTENT_PREVIEW
        ? "Describe the preview you want expanded."
        : "Describe the task target..."
    : supervisionState === "waitingApproval"
      ? "Add approval condition..."
      : supervisionState === "running"
        ? "Steer the current run..."
        : supervisionState === "blocked"
          ? "Add recovery detail..."
          : "Describe the task target...";
  const commandBarTitle = supervisionState === "waitingApproval"
    ? "Waiting approval"
    : supervisionState === "running"
      ? "Running"
      : supervisionState === "blocked"
        ? "Blocked"
        : "Waiting task";
  const commandPrimaryLabel = supervisionState === "waitingApproval"
    ? "Approve"
    : supervisionState === "running"
      ? "Pause"
      : supervisionState === "blocked"
        ? "Inspect"
        : "Create";
  const commandPrimaryDisabled = supervisionState === "waitingApproval"
    ? !hasPendingApproval
    : supervisionState === "running"
      ? !activeRuntimeTurn && !chatSending
      : supervisionState === "blocked"
        ? false
        : !canSend;
  const modeIntentText = collaborationEnabled
    ? `这一轮会读取附加资源，当前阶段：${turnIntentLabel(activeTurnIntent)}`
    : collaborationAvailable
      ? "这一轮不读取附加资源"
      : "当前没有附加资源";
  const modeGuidanceText = collaborationEnabled
    ? activeTurnIntent === TURN_INTENT_CHOICE
      ? "Solo 会先查看相关文件，再把多个方向整理成可点开的方向卡。"
      : activeTurnIntent === TURN_INTENT_PREVIEW
        ? "Solo 会直接展开更具体的改动预览，但仍然不会自动应用。"
        : "Solo 会先查看相关文件，再给结论、依据和下一步建议。"
    : collaborationAvailable
      ? "目录只是附加资源。只有启用资源参与后，它才会真正进入回答。"
      : "先直接提问；只有需要代码依据时再补充目录。";
  const composerContextButtonLabel = activeSessionWorkspaceId
    ? `Change resource, current: ${activeWorkspace?.name ?? "selected directory"}`
    : "Attach resource";
  const connectionStatusLabel = providerNeedsCodexLogin
    ? (!codexAuth.available
        ? "unavailable"
        : codexAuth.loggedIn
          ? "logged in"
          : "logged out")
    : activeProvider === "manual"
      ? "manual"
      : settings.modelId
        ? "configured"
        : "not configured";
  const topbarWorkstreamState = activeSessionSummary?.statusLabel ?? "waiting";
  const topbarExceptionLabel = exceptionEntries.length > 0 ? `${exceptionEntries.length} pending` : "clear";
  const topbarExceptionTone = exceptionEntries.length > 0 ? "error" : "ready";
  const externalAgentsByWorkspaceId = observedCodexState.agents.reduce((groups, agent) => {
    if (!agent.matchedWorkspaceId) {
      return groups;
    }
    return {
      ...groups,
      [agent.matchedWorkspaceId]: [...(groups[agent.matchedWorkspaceId] ?? []), agent],
    };
  }, {});
  const untrackedExternalAgents = observedCodexState.agents.filter((agent) => !agent.matchedWorkspaceId);
  const resourceDisplayCount = workspaces.length + untrackedExternalAgents.length;
  const topbarResourceLabel = observedCodexState.agents.length
    ? `${workspaces.length} resources / ${observedCodexState.agents.length} external`
    : `${workspaces.length} resources`;
  const topbarRunLabel = `${activeWorkstreamEntries.length} active / ${waitingWorkstreamEntries.length} waiting`;
  const primaryExceptionEntry = exceptionEntries[0] ?? null;
  const commandActionCards = [
    {
      id: "task",
      eyebrow: "Task",
      title: "New",
      tone: "idle",
      disabled: false,
      onClick: handleCreateSession,
    },
    {
      id: "exception",
      eyebrow: "Intervene",
      title: primaryExceptionEntry ? "Review" : "Clear",
      tone: primaryExceptionEntry ? "error" : "ready",
      disabled: !primaryExceptionEntry,
      onClick: () => {
        if (!primaryExceptionEntry) {
          return;
        }
        handleSelectSession(primaryExceptionEntry.id);
        setInspectorTab("controls");
        composerInputRef.current?.focus();
      },
    },
  ];
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
              <span className="topbar-logo" aria-hidden="true" />
              <div className="topbar-trail" aria-label="current context">
                <span className="topbar-app">solo</span>
                <span className="topbar-separator">/</span>
                <span className="topbar-context">control plane</span>
              </div>
              <span className="topbar-title-divider" aria-hidden="true" />
              <div className="topbar-title-stack">
                <h1>{activeWorkspace?.path ?? "~/workspace/solo"}</h1>
                <span className="topbar-title-meta">branch: ui-ddd</span>
              </div>
            </div>
          </div>
        </div>
        <div className="topbar-status">
          <button
            type="button"
            className="status-pill status-pill-button status-pill-compact"
            onClick={() => {
              setConnectionState({ status: "idle", message: "" });
              setSettingsModalOpen(true);
            }}
          >
            <strong className="status-pill-value">
              {providerNeedsCodexLogin ? "Codex Login" : "Connection"}
            </strong>
          </button>
          <span className="status-pill status-pill-compact status-pill-active">
            <strong className="status-pill-value">managed</strong>
          </span>
          <span
            className={`status-pill status-pill-compact status-pill-${
              observedCodexState.agents.length ? "active" : "idle"
            }`}
            title={topbarResourceLabel}
          >
            <strong className="status-pill-value">observe-only</strong>
          </span>
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
                  <p className="section-eyebrow">Workstreams</p>
                  <div className="section-title-row">
                    <h2>Workstreams</h2>
                    <span className="section-count">{sessions.length}</span>
                  </div>
              </div>
              <button type="button" className="ghost-button" onClick={handleCreateSession}>
                New
              </button>
            </div>
            <div className="workstream-groups">
              <section className="workstream-group">
                <div className="workstream-group-head">
                  <span className="section-eyebrow">Active</span>
                  <span className="section-count">{activeWorkstreamEntries.length}</span>
                </div>
                {activeWorkstreamEntries.length ? (
                  <div className="session-list">
                    {activeWorkstreamEntries.map((entry) => (
                      <WorkstreamCard
                        key={entry.id}
                        entry={entry}
                        active={entry.id === activeSessionId}
                        onSelect={handleSelectSession}
                        onDelete={handleDeleteSession}
                        deletingDisabled={chatSending && entry.id === activeSessionId}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="panel-collapsed-note">
                    <EmptyVisual label="No active workstreams" tone="active" />
                  </div>
                )}
              </section>

              <section className="workstream-group">
                <div className="workstream-group-head">
                  <span className="section-eyebrow">Waiting</span>
                  <span className="section-count">{waitingWorkstreamEntries.length}</span>
                </div>
                {waitingWorkstreamEntries.length ? (
                  <div className="session-list">
                    {waitingWorkstreamEntries.map((entry) => (
                      <WorkstreamCard
                        key={entry.id}
                        entry={entry}
                        active={entry.id === activeSessionId}
                        onSelect={handleSelectSession}
                        onDelete={handleDeleteSession}
                        deletingDisabled={chatSending && entry.id === activeSessionId}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="panel-collapsed-note">
                    <EmptyVisual label="No waiting workstreams" tone="loading" />
                  </div>
                )}
              </section>

              <section className="workstream-group">
                <div className="workstream-group-head">
                  <span className="section-eyebrow">Done</span>
                  <span className="section-count">{doneWorkstreamEntries.length}</span>
                </div>
                {doneWorkstreamEntries.length ? (
                  <div className="session-list">
                    {doneWorkstreamEntries.map((entry) => (
                      <WorkstreamCard
                        key={entry.id}
                        entry={entry}
                        active={entry.id === activeSessionId}
                        onSelect={handleSelectSession}
                        onDelete={handleDeleteSession}
                        deletingDisabled={chatSending && entry.id === activeSessionId}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="panel-collapsed-note">
                    <EmptyVisual label="No completed workstreams" tone="ready" />
                  </div>
                )}
              </section>
            </div>
          </section>

          <section className="panel-block panel-exceptions">
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Exceptions</p>
                <div className="section-title-row">
                  <h2>Exceptions</h2>
                  <span className="section-count">{exceptionEntries.length}</span>
                </div>
              </div>
            </div>
            {exceptionEntries.length ? (
              <div className="exception-list">
                {exceptionEntries.map((entry) => (
                  <ExceptionCard
                    key={entry.id}
                    entry={entry}
                    active={entry.id === activeSessionId}
                    onSelect={handleSelectSession}
                  />
                ))}
              </div>
            ) : (
              <div className="panel-collapsed-note">
                <EmptyVisual label="No exceptions" tone="ready" />
              </div>
            )}
          </section>

          <section className="panel-block panel-workspaces">
            <div className="section-header">
              <div>
                  <p className="section-eyebrow">Resources</p>
                  <div className="section-title-row">
                    <h2>Resources</h2>
                    <span className="section-count">{resourceDisplayCount}</span>
                    {observedCodexState.error ? (
                      <span className="list-badge list-badge-error">scan failed</span>
                    ) : null}
                    {observedCodexState.agents.length ? (
                      <span className="list-badge list-badge-accent">
                        {observedCodexState.agents.length} external
                      </span>
                    ) : null}
                  </div>
              </div>
            </div>
            {workspaces.length || observedCodexState.agents.length ? (
              <div className="workspace-list">
                {observedCodexState.error ? (
                  <div className="resource-inline-error">
                    <strong>External Codex scan failed</strong>
                    <span>{observedCodexState.error}</span>
                  </div>
                ) : null}
                {workspaces.map((workspace) => {
                  const workspaceAgents = externalAgentsByWorkspaceId[workspace.id] ?? [];
                  return (
                    <div
                      key={workspace.id}
                      className={`workspace-card ${
                        workspace.id === activeWorkspaceId ? "is-active" : ""
                      } ${workspaceAgents.length ? "has-external-agent" : ""}`}
                    >
                      <button
                        type="button"
                        className="workspace-main"
                        onClick={() => void handleSelectWorkspace(workspace.id)}
                      >
                        <div className="workspace-row">
                          <span className="workspace-title">{workspace.name}</span>
                          {workspace.id === activeSessionWorkspaceId ? (
                            <span className="list-badge list-badge-accent">current</span>
                          ) : null}
                          {workspaceAgents.length ? (
                            <span className="list-badge list-badge-loading">
                              {workspaceAgents.length} external
                            </span>
                          ) : null}
                        </div>
                        <span className="workspace-path">{workspace.path}</span>
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => handleRemoveWorkspace(workspace.id)}
                      >
                        Remove
                      </button>
                      {workspaceAgents.length ? (
                        <div className="workspace-agent-stack">
                          {workspaceAgents.slice(0, 2).map((agent) => {
                            const matchedSession = sessions.find(
                              (session) => session.id === agent.matchedSessionId
                            );
                            return (
                              <ExternalAgentResourceCard
                                key={agent.id}
                                agent={agent}
                                workspace={workspace}
                                session={matchedSession}
                                current={workspace.id === activeWorkspaceId}
                                onFocusSession={setActiveSessionId}
                              />
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {untrackedExternalAgents.length ? (
                  <div className="workspace-untracked-group">
                    <div className="workspace-untracked-head">
                      <span className="section-eyebrow">Untracked</span>
                      <span className="section-count">{untrackedExternalAgents.length}</span>
                    </div>
                    {untrackedExternalAgents.slice(0, 1).map((agent) => {
                      const matchedSession = sessions.find(
                        (session) => session.id === agent.matchedSessionId
                      );
                      return (
                        <ExternalAgentResourceCard
                          key={agent.id}
                          agent={agent}
                          workspace={null}
                          session={matchedSession}
                          current={false}
                          onFocusSession={setActiveSessionId}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="panel-collapsed-note">
                <EmptyVisual
                  label={
                    observedCodexState.error
                      ? "External Codex scan failed"
                      : observedCodexState.loading
                        ? "Scanning external Codex"
                        : "No resources"
                  }
                  tone={observedCodexState.error ? "error" : observedCodexState.loading ? "loading" : "idle"}
                />
              </div>
            )}
          </section>

          <section
            className={`panel-block panel-explorer ${explorerOpen ? "is-grow" : "is-collapsed"}`}
          >
            <div className="section-header">
              <div>
                  <p className="section-eyebrow">Resource Lens</p>
                  <div className="section-title-row">
                    <h2>Resource lens</h2>
                  </div>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setExplorerOpen((current) => !current)}
                disabled={!activeWorkspace}
              >
                {explorerOpen ? "Collapse" : "Expand"}
              </button>
            </div>
            {!explorerOpen ? (
              <div className="panel-collapsed-note">
                <EmptyVisual
                  label={activeWorkspace ? "File tree collapsed" : "No directory resource"}
                  tone={activeWorkspace ? "active" : "idle"}
                />
              </div>
            ) : activeWorkspace ? (
              workspaceTreeLoading ? (
                <div className="empty-state compact">
                  <EmptyVisual label="Loading file tree" tone="loading" />
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
                  <EmptyVisual label="No visible file tree" tone="idle" />
                </div>
              )
            ) : (
              <div className="empty-state compact">
                <EmptyVisual label="No directory resource" tone="idle" />
              </div>
            )}
          </section>
        </aside>

        <section className="chat-pane">
          <div className="chat-head">
            <div className="chat-head-shell runtime-head-shell">
              <div className="chat-head-main">
                <p className="section-eyebrow">Current task</p>
                <h2>{currentTaskTitle}</h2>
                <p className="runtime-task-subtitle">
                  Workstream: {runtimeWorkstreamLabel} · {currentTaskStateLabel}
                </p>
              </div>
              <div className="runtime-state-strip" aria-label="task state">
                <div className={`runtime-state-tile tone-${runtimePanelTone}`}>
                  <span>Run</span>
                  <strong>{currentRunStateLabel}</strong>
                </div>
                <div className={`runtime-state-tile tone-${nextIntentLabel === "approve" ? "approval" : "idle"}`}>
                  <span>Next</span>
                  <strong>{nextIntentLabel}</strong>
                </div>
                <div className={`runtime-state-tile tone-${runtimeOutputCards.length ? "active" : "idle"}`}>
                  <span>Outputs</span>
                  <strong>{outputCountLabel}</strong>
                </div>
              </div>
            </div>
          </div>
          <div className="chat-scroll">
            <div className="conversation-stack">
              {!(providerNeedsCodexLogin && !codexAuth.loggedIn) ? (
                <>
                  <section className="shell-card active-run-card">
                    <div className="task-panel-head">
                      <div>
                        <p className="section-eyebrow">Active run</p>
                        <h3>{activeRuntimeTurn ? "Managed Codex run" : "No active run"}</h3>
                      </div>
                      <span className={`drawer-chip drawer-chip-${runtimePanelTone}`}>managed</span>
                    </div>
                    <div
                      className={`active-run-summary tone-${
                        activeRuntimeTurn ? (runtimeExceptionCount > 0 ? "error" : "active") : "idle"
                      }`}
                    >
                      <div>
                        <strong>{activeRunSummary}</strong>
                        <p>next: {nextIntentLabel}</p>
                      </div>
                    </div>
                  </section>

                  <section className="shell-card runtime-timeline-card">
                    <div className="task-panel-head">
                      <div>
                        <p className="section-eyebrow">Timeline</p>
                        <h3>Run events</h3>
                      </div>
                      <span className="drawer-chip drawer-chip-idle">
                        {hiddenRuntimeTimelineCount
                          ? `${visibleRuntimeTimelineItems.length} shown`
                          : `${visibleRuntimeTimelineItems.length} items`}
                      </span>
                    </div>
                    <div className="task-timeline-list runtime-timeline-list">
                      {runtimePanelState.error ? (
                        <div className="status-banner status-banner-error">
                          <strong>Runtime read failed</strong>
                          <span>{runtimePanelState.error}</span>
                        </div>
                      ) : (
                        visibleRuntimeTimelineItems.map((item) => (
                          <div key={item.id} className="task-timeline-item">
                            <div className="task-timeline-marker" aria-hidden="true" />
                            <div className="task-timeline-body">
                              <div className="task-timeline-head">
                                <span className="task-timeline-time">
                                  {formatRuntimeTime(item.updatedAt ?? item.createdAt)}
                                </span>
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
                              <p>{item.summary || truncateInline(item.content || "No summary.", 120)}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  {visibleOutputCards.length ? (
                    <section className="shell-card runtime-outputs-card">
                      <div className="task-panel-head">
                        <div>
                          <p className="section-eyebrow">Outputs</p>
                          <h3>Artifacts</h3>
                        </div>
                        <span className="drawer-chip drawer-chip-active">
                          {`${runtimeOutputCards.length} visible`}
                        </span>
                      </div>
                      <div className="runtime-output-grid">
                        {visibleOutputCards.map((output) => (
                          <button
                            key={output.id}
                            type="button"
                            className={`runtime-output-tile tone-${output.tone}`}
                            onClick={() => setInspectorTab("artifacts")}
                          >
                            <strong>{output.title}</strong>
                            <span>{output.meta}</span>
                          </button>
                        ))}
                        {outputOverflowCount > 0 ? (
                          <button
                            type="button"
                            className="runtime-output-tile tone-idle is-overflow"
                            onClick={() => setInspectorTab("artifacts")}
                          >
                            <strong>{`+${outputOverflowCount}`}</strong>
                            <span>more</span>
                          </button>
                        ) : null}
                      </div>
                    </section>
                  ) : (
                    <section className="runtime-outputs-strip" aria-label="Outputs">
                      <div>
                        <p className="section-eyebrow">Outputs</p>
                        <h3>Artifacts</h3>
                      </div>
                      <span className="drawer-chip drawer-chip-active">
                        {`${runtimeOutputCards.length} visible`}
                      </span>
                    </section>
                  )}
                </>
              ) : null}
              {providerNeedsCodexLogin && !codexAuth.loggedIn ? (
                <div className="shell-card hero-card">
                  <p className="section-eyebrow">Codex</p>
                  <h2>Codex Login</h2>
                  <p>{codexAuth.message}</p>
                  {codexLoginDetail ? <p className="field-hint">{codexLoginDetail}</p> : null}
                  <div className="compact-row">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={codexChecking}
                      onClick={handleCodexLogin}
                    >
                      {codexChecking ? "Logging in..." : "Login"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={codexChecking}
                      onClick={handleRefreshCodexStatus}
                    >
                      {codexChecking ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                </div>
              ) : layoutMode === "chat" && activeSession?.messages?.length ? (
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
                          <h3>Directions</h3>
                        </div>
                        <div className="decision-deck-meta">
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={rejectingAllDecisions}
                            onClick={() => handleDismissDecisionSet(activeDecisionSet)}
                          >
                            {rejectingAllDecisions
                              ? "Working..."
                              : activeDecisionSet.dismissAction?.label ?? "Skip"}
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
                        <span className="drawer-chip drawer-chip-active">selected</span>
                      </div>
                      <h3>{selectedChoiceLabel || "Selected direction"}</h3>
                      <p>
                        {previewDeckActive
                          ? "Preview is expanded below. Approval is still required before applying."
                          : "Solo is generating a more specific preview for this direction."}
                      </p>
                    </section>
                  ) : null}
                  {showPreviewCards ? (
                    <section className="shell-card inline-proposals preview-card-set">
                      <div className="inline-proposals-head">
                        <div>
                          <p className="section-eyebrow">Preview</p>
                          <h3>Preview</h3>
                        </div>
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
              ) : layoutMode === "chat" ? (
                <div className="empty-state hero">
                  <p className="section-eyebrow">Operator Log</p>
                  <h2>What should move next?</h2>
                </div>
              ) : null}
            </div>
          </div>

          <div className="composer">
            <div className="composer-shell">
              <div className="composer-bar-head">
                <div>
                  <p className="section-eyebrow">Command Bar</p>
                  <strong>{commandBarTitle}</strong>
                </div>
              </div>
              <div className="composer-control-strip" aria-label="command quick actions">
                {commandActionCards.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={`composer-control-card tone-${action.tone}`}
                    disabled={action.disabled}
                    onClick={action.onClick}
                  >
                    <span className="section-eyebrow">{action.eyebrow}</span>
                    <strong>{action.title}</strong>
                  </button>
                ))}
              </div>
              {activeSessionWorkspaceId ? (
                <div className="composer-resource-strip">
                  <div className="composer-resource-main">
                    <span className="composer-resource-label">Resource</span>
                    <strong>{activeWorkspace?.name ?? "selected directory"}</strong>
                    <span className="composer-resource-path">
                      {activeWorkspace?.path ?? "path unavailable"}
                    </span>
                  </div>
                  <div className="composer-resource-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setWorkspaceModalOpen(true)}
                    >
                      Change
                    </button>
                    <button type="button" className="ghost-button" onClick={handleDetachWorkspace}>
                      Detach
                    </button>
                  </div>
                </div>
              ) : null}
              <textarea
                ref={composerInputRef}
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
                    className="primary-button"
                    disabled={commandPrimaryDisabled}
                    onClick={() => {
                      if (supervisionState === "idle") {
                        handleSend();
                      }
                    }}
                  >
                    {commandPrimaryLabel}
                  </button>
                  {supervisionState === "waitingApproval" ? (
                    <>
                      <button type="button" className="ghost-button">
                        Revise
                      </button>
                      <button type="button" className="ghost-button">
                        Evidence
                      </button>
                    </>
                  ) : null}
                  {supervisionState === "idle" ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setWorkspaceModalOpen(true)}
                      aria-label={composerContextButtonLabel}
                      title={composerContextButtonLabel}
                    >
                      More
                    </button>
                  ) : null}
                  {supervisionState === "blocked" ? (
                    <button type="button" className="danger-button">
                      Abort
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-head">
            <div>
              <p className="section-eyebrow">Inspecting</p>
              <h2>{inspectorTitle}</h2>
            </div>
            <span className="section-count">{runtimePanelStatus}</span>
          </div>

          <div className="inspector-cockpit">
            <section className="inspector-checkpoint-card">
              <span className="section-eyebrow">{inspectorStatus}</span>
              <h3>{inspectorQuestion}</h3>
              <p>{inspectorImpact}</p>
              {hasPendingApproval ? (
                <div className="inspector-action-row">
                  <button type="button" className="primary-button">
                    Approve
                  </button>
                  <button type="button" className="ghost-button">
                    Revise
                  </button>
                  <button type="button" className="ghost-button">
                    Evidence
                  </button>
                </div>
              ) : null}
            </section>

            <section className="inspector-evidence-card">
              <h3>Evidence</h3>
              <div className="inspector-evidence-list">
                {inspectorEvidence.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            </section>

            <section className="inspector-external-card">
              <div>
                <span className="section-eyebrow">External Codex</span>
                <h3>
                  {primaryObservedCodexAgent
                    ? `${codexAgentStateLabel(primaryObservedCodexAgent.state)} · observe-only`
                    : "observe-only"}
                </h3>
              </div>
              <p>
                {primaryObservedCodexAgent
                  ? `workspace: ${primaryObservedCodexAgent.cwd}`
                  : observedCodexState.loading
                    ? "scanning local Codex processes"
                    : "no external run selected"}
              </p>
            </section>
          </div>

          <div className="inspector-summary-strip" aria-label="运行摘要">
            {inspectorSummaryCards.map((card) => (
              <article key={card.label} className={`inspector-summary-card tone-${card.tone}`}>
                <span className="section-eyebrow">{card.label}</span>
                <strong>{card.value}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </div>

          <div className="inspector-tablist" role="tablist" aria-label="运行详情分区">
            {inspectorTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                id={`inspector-tab-${tab.id}`}
                role="tab"
                aria-selected={inspectorTab === tab.id}
                aria-controls={`inspector-panel-${tab.id}`}
                className={`inspector-tab ${inspectorTab === tab.id ? "is-active" : ""}`}
                onClick={() => setInspectorTab(tab.id)}
              >
                <span className="inspector-tab-topline">
                  <span className="inspector-tab-label">{tab.label}</span>
                  <span className={`drawer-chip drawer-chip-${tab.badgeTone}`}>{tab.badgeText}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="inspector-scroll">
            {inspectorTab === "trace" ? (
              <div
                id="inspector-panel-trace"
                role="tabpanel"
                aria-labelledby="inspector-tab-trace"
                className="inspector-panel-stack"
              >
                <section className="drawer-panel">
                  <div className="drawer-panel-head">
                    <div className="drawer-panel-title">
                      <span className="section-eyebrow">Trace</span>
                      <strong>运行轨迹</strong>
                    </div>
                    <span className={`drawer-chip drawer-chip-${runtimePanelTone}`}>{runtimePanelStatus}</span>
                  </div>
                  <div className="drawer-meta-grid">
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">焦点</span>
                      <span className="drawer-meta-value">{runtimeFocusDetail}</span>
                    </div>
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">任务</span>
                      <span className="drawer-meta-value">
                        {activeRuntimeTask?.title || "当前还没有任务骨架。"}
                      </span>
                    </div>
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">回合</span>
                      <span className="drawer-meta-value">{activeRunLabel}</span>
                    </div>
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">最近</span>
                      <span className="drawer-meta-value">{activeRunSummary}</span>
                    </div>
                  </div>
                </section>

                <section className="drawer-panel">
                  <div className="drawer-panel-head">
                    <div className="drawer-panel-title">
                      <span className="section-eyebrow">Events</span>
                      <strong>事件时间线</strong>
                    </div>
                    <span className="drawer-chip drawer-chip-idle">{`${activeRuntimeSnapshot.turnItems.length} item`}</span>
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
                        <EmptyVisual label="当前会话还没有可展示的结构化 item" tone="idle" />
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}

            {inspectorTab === "artifacts" ? (
              <div
                id="inspector-panel-artifacts"
                role="tabpanel"
                aria-labelledby="inspector-tab-artifacts"
                className="inspector-panel-stack"
              >
                <section className="drawer-panel">
                  <div className="drawer-panel-head">
                    <div className="drawer-panel-title">
                      <span className="section-eyebrow">Artifacts</span>
                      <strong>产物面板</strong>
                    </div>
                    <span className={`drawer-chip drawer-chip-${previewStateLabel}`}>{previewStateText}</span>
                  </div>
                  <div className="drawer-meta-grid">
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">文件</span>
                      <span className="drawer-meta-value">{previewTitle}</span>
                    </div>
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">状态</span>
                      <span className="drawer-meta-value">
                        {showPreviewPanel
                          ? "右侧已载入文件预览"
                          : previewDeckActive
                            ? `主区有 ${previewProposals.length} 张预览卡`
                            : showDecisionDeck
                              ? `主区有 ${decisionOptions.length} 个方向卡`
                              : "当前没有可展开的文件产物"}
                      </span>
                    </div>
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">产物数</span>
                      <span className="drawer-meta-value">{`${runtimeArtifactCount} 个产物或预览节点`}</span>
                    </div>
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">视图</span>
                      <span className="drawer-meta-value">artifact</span>
                    </div>
                  </div>
                </section>

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
                      {previewState.loading ? <EmptyVisual label="正在读取文件" tone="loading" /> : null}
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
                ) : (
                  <section className="drawer-panel">
                    <div className="drawer-panel-head">
                      <div className="drawer-panel-title">
                        <span className="section-eyebrow">Preview</span>
                        <strong>等待产物</strong>
                      </div>
                      <span className="drawer-chip drawer-chip-idle">空</span>
                    </div>
                    <div className="drawer-preview-body">
                      <div className="proposal-empty">
                        <EmptyVisual
                          label={previewDeckActive ? "主区已经生成预览卡" : "当前还没有文件级产物"}
                          tone={previewDeckActive ? "active" : "idle"}
                        />
                      </div>
                    </div>
                  </section>
                )}
              </div>
            ) : null}

            {inspectorTab === "resources" ? (
              <div
                id="inspector-panel-resources"
                role="tabpanel"
                aria-labelledby="inspector-tab-resources"
                className="inspector-panel-stack"
              >
                <section className="drawer-panel">
                  <div className="drawer-panel-head">
                    <div className="drawer-panel-title">
                      <span className="section-eyebrow">Resources</span>
                      <strong>当前资源</strong>
                    </div>
                    <span className={`drawer-chip drawer-chip-${inspectorWorkspaceState}`}>
                      {inspectorWorkspaceStateText}
                    </span>
                  </div>
                  <div className="drawer-meta-grid">
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">目录</span>
                      <span className="drawer-meta-value">{activeWorkspace?.name ?? "未附加目录资源"}</span>
                    </div>
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">路径</span>
                      <span className="drawer-meta-value drawer-meta-path">
                        {activeWorkspace?.path ?? "需要代码依据时，再通过回形针添加目录资源。"}
                      </span>
                    </div>
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">方式</span>
                      <span className="drawer-meta-value">{modeIntentText}</span>
                    </div>
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-label">会话</span>
                      <span className="drawer-meta-value">
                        {activeSession?.title ?? "请先创建会话。"}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="drawer-panel">
                  <div className="drawer-panel-head">
                    <div className="drawer-panel-title">
                      <span className="section-eyebrow">External Codex</span>
                      <strong>外部运行</strong>
                    </div>
                    <span
                      className={`drawer-chip drawer-chip-${
                        observedCodexState.error
                          ? "error"
                          : observedCodexState.agents.length > 0
                            ? "active"
                            : observedCodexState.loading
                              ? "loading"
                              : "idle"
                      }`}
                    >
                      {observedCodexState.error
                        ? "读取失败"
                        : observedCodexState.agents.length > 0
                          ? `${observedCodexState.agents.length} agent`
                          : observedCodexState.loading
                            ? "扫描中"
                            : "无外部运行"}
                    </span>
                  </div>
                  <div className="drawer-preview-body">
                    {observedCodexState.error ? (
                      <div className="status-banner status-banner-error">
                        <strong>外部 Codex 扫描失败</strong>
                        <span>{observedCodexState.error}</span>
                      </div>
                    ) : observedCodexState.agents.length > 0 ? (
                      <div className="external-agent-list">
                        {observedCodexState.agents
                          .slice(0, 6)
                          .map((agent) => {
                            const matchedWorkspace = workspaces.find(
                              (workspace) => workspace.id === agent.matchedWorkspaceId
                            );
                            const matchedSession = sessions.find(
                              (session) => session.id === agent.matchedSessionId
                            );
                            const isCurrentResource =
                              activeWorkspace?.id && agent.matchedWorkspaceId === activeWorkspace.id;
                            return (
                              <div
                                key={agent.id}
                                className={`external-agent-card ${isCurrentResource ? "is-current" : ""}`}
                              >
                                <div className="external-agent-head">
                                  <span className="section-eyebrow">pid {agent.pid || "unknown"}</span>
                                  <span className={`drawer-chip drawer-chip-${codexAgentTone(agent)}`}>
                                    {codexAgentStateLabel(agent.state)}
                                  </span>
                                </div>
                                <strong>{matchedWorkspace?.name ?? "Codex"}</strong>
                                <p>{agent.cwd}</p>
                                <div className="external-agent-meta">
                                  <span>external</span>
                                  <span>observe-only</span>
                                  {matchedWorkspace ? (
                                    <span>{isCurrentResource ? "current resource" : "matched workspace"}</span>
                                  ) : (
                                    <span>unmatched workspace</span>
                                  )}
                                  {matchedSession ? <span>{truncateInline(matchedSession.title, 48)}</span> : null}
                                  <span>{formatRuntimeTime(agent.lastSeenAt)}</span>
                                </div>
                                {agent.command ? <pre>{truncateInline(agent.command, 220)}</pre> : null}
                                {matchedSession ? (
                                  <button
                                    type="button"
                                    className="ghost-button external-agent-action"
                                    onClick={() => setActiveSessionId(matchedSession.id)}
                                  >
                                    聚焦匹配会话
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                        {activeWorkspace?.id &&
                        observedCodexState.agents.every(
                          (agent) => agent.matchedWorkspaceId !== activeWorkspace.id
                        ) ? (
                          <div className="proposal-empty">
                            <EmptyVisual label="当前资源没有匹配到外部 Codex，已显示全部外部运行" tone="idle" />
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="proposal-empty">
                        <EmptyVisual
                          label={observedCodexState.loading ? "正在扫描本机 Codex 进程" : "没有检测到外部 Codex"}
                          tone={observedCodexState.loading ? "loading" : "idle"}
                        />
                      </div>
                    )}
                  </div>
                </section>

                <section className="drawer-panel">
                  <div className="drawer-panel-head">
                    <div className="drawer-panel-title">
                      <span className="section-eyebrow">Boundary</span>
                      <strong>资源边界</strong>
                    </div>
                    <span className="drawer-chip drawer-chip-idle">{`${runtimeResourceCount} 个资源`}</span>
                  </div>
                  <div className="drawer-preview-body">
                    <div className="proposal-empty">
                      <EmptyVisual label={modeGuidanceText} tone={collaborationEnabled ? "active" : "idle"} />
                    </div>
                  </div>
                </section>
              </div>
            ) : null}

            {inspectorTab === "controls" ? (
              <div
                id="inspector-panel-controls"
                role="tabpanel"
                aria-labelledby="inspector-tab-controls"
                className="inspector-panel-stack"
              >
                <section className="drawer-panel">
                  <div className="drawer-panel-head">
                    <div className="drawer-panel-title">
                      <span className="section-eyebrow">Checkpoint</span>
                      <strong>待决策节点</strong>
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
                        <EmptyVisual
                          label={
                            showDecisionDeck
                              ? `主区有 ${decisionOptions.length} 个方向卡`
                              : previewDeckActive
                                ? `主区有 ${previewProposals.length} 张预览卡`
                                : proposalPanelState.loading
                                  ? "正在展开具体预览"
                                  : selectedDecisionOption
                                    ? `已选择 ${selectedChoiceLabel || "一个方向"}`
                                    : "当前没有额外建议"
                          }
                          tone={showDecisionDeck || previewDeckActive || selectedDecisionOption ? "active" : "idle"}
                        />
                      </div>
                    )}
                  </div>
                </section>

                <section className="drawer-panel">
                  <div className="drawer-panel-head">
                    <div className="drawer-panel-title">
                      <span className="section-eyebrow">Controls</span>
                      <strong>控制面板</strong>
                    </div>
                    <span className="drawer-chip drawer-chip-idle">{modeLabel}</span>
                  </div>
                  <div className="drawer-preview-body control-stack">
                    <div className="mode-switch" role="tablist" aria-label="资源参与方式">
                      <button
                        type="button"
                        className={`ghost-button mode-switch-button ${
                          activeSessionMode === SESSION_MODE_CONVERSATION ? "is-active" : ""
                        }`}
                        onClick={() => void handleSetSessionMode(SESSION_MODE_CONVERSATION)}
                        aria-pressed={activeSessionMode === SESSION_MODE_CONVERSATION}
                      >
                        不使用资源
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
                          collaborationAvailable ? "让当前 run 读取附加资源" : "等待资源请求"
                        }
                      >
                        使用资源
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
                    <div className="control-button-grid">
                      {activeSessionWorkspaceId ? (
                        <button type="button" className="ghost-button" onClick={handleDetachWorkspace}>
                          移除资源
                        </button>
                      ) : null}
                      <button type="button" className="ghost-button" onClick={handleCreateSession}>
                        新任务流
                      </button>
                      <button type="button" className="ghost-button" onClick={() => setWorkspaceModalOpen(true)}>
                        附加资源
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
                </section>
              </div>
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
