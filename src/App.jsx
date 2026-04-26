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
const SOLO_OBS_STALE_MS = 5 * 60 * 1000;
const SOLO_PROJECTION_EVIDENCE_MAX = 3;
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
      visibility:
        typeof agent.visibility === "string" && agent.visibility.trim()
          ? agent.visibility.trim()
          : "processOnly",
      activityState:
        typeof agent.activityState === "string" && agent.activityState.trim()
          ? agent.activityState.trim()
          : "unknown",
      lastActivityAt:
        agent.lastActivityAt === null ? null : Number.isFinite(agent.lastActivityAt) ? agent.lastActivityAt : null,
      lastEventType:
        typeof agent.lastEventType === "string" && agent.lastEventType.trim()
          ? agent.lastEventType.trim()
          : "",
      lastEventSummary:
        typeof agent.lastEventSummary === "string" && agent.lastEventSummary.trim()
          ? agent.lastEventSummary.trim()
          : "",
      observedSessionId:
        typeof agent.observedSessionId === "string" && agent.observedSessionId.trim()
          ? agent.observedSessionId.trim()
          : null,
    }));
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

function compactText(value, maxChars) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "unknown";
  }
  const maxLength = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 54;
  if (text.length <= maxLength) {
    return text;
  }
  const head = Math.max(16, Math.floor(maxLength * 0.48));
  const tail = Math.max(14, maxLength - head - 3);
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function compactAgentWorkspaceLabel(agent) {
  const cwd = typeof agent?.cwd === "string" ? agent.cwd.trim() : "";
  if (!cwd) {
    return "untracked workspace";
  }
  const normalized = cwd.split("\\").join("/");
  const segments = normalized.split("/").filter(Boolean);
  const label = segments.length > 0 ? segments[segments.length - 1] : normalized;
  return compactText(label, 32);
}

function compactAgentVisibilityLabel(agent) {
  const visibility = typeof agent?.visibility === "string" ? agent.visibility.trim().toLowerCase() : "";
  if (visibility === "sessionlog" || visibility === "session-log" || visibility === "session_log") {
    return "session log";
  }
  return "process only";
}

function compactAgentActivityState(agent) {
  const state = typeof agent?.activityState === "string" ? agent.activityState.trim().toLowerCase() : "";
  if (state === "active" || state === "recent" || state === "stale") {
    return state;
  }
  return "unknown";
}

function formatObservedActivityTime(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "unknown";
  }
  return new Date(timestamp).toLocaleString("en-US", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function projectEvidenceText(values, maxCount = SOLO_PROJECTION_EVIDENCE_MAX) {
  const normalized = values
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => compactText(value, 72));
  return normalized.slice(0, Math.max(1, Math.min(maxCount, normalized.length)));
}

function pickLatestTime(...values) {
  return values
    .map((value) => (Number.isFinite(value) ? value : NaN))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];
}

function mapActivityStateFromTimestamp({ state, activityState, lastActivityAt, hasRecent = false }) {
  const normalizedState = typeof state === "string" ? state.trim().toLowerCase() : "";
  const normalizedActivity = typeof activityState === "string" ? activityState.trim().toLowerCase() : "";

  if (normalizedState === "running") {
    return "running";
  }
  if (normalizedState === "sleeping" || normalizedActivity === "waiting") {
    return "waiting";
  }
  if (normalizedActivity === "active" || normalizedActivity === "recent") {
    return "running";
  }
  if (normalizedActivity === "stale") {
    return "stale";
  }

  if (typeof lastActivityAt === "number" && Number.isFinite(lastActivityAt)) {
    if (Date.now() - lastActivityAt > SOLO_OBS_STALE_MS) {
      return "stale";
    }
    if (hasRecent || Number.isFinite(lastActivityAt)) {
      return "running";
    }
  }

  if (normalizedActivity) {
    return normalizedActivity;
  }
  return "unknown";
}

function buildManagedRuntimeProjection({
  activeSession,
  runtimeTask,
  runtimeTurn,
  runtimeFailedCount = 0,
  pendingApprovalCount = 0,
  providerNeedsCodexLogin,
  codexAuth,
  chatSending = false,
}) {
  const isCodexReady =
    !providerNeedsCodexLogin ||
    (providerNeedsCodexLogin && codexAuth?.loggedIn && codexAuth?.available);

  const hasTask = Boolean(runtimeTask);
  const hasTurn = Boolean(runtimeTurn);
  const turnIntent = runtimeTurn?.intent && normalizeTurnIntent(runtimeTurn.intent);
  const turnStatus = runtimeTurn?.status;
  const taskStatus = runtimeTask?.status;
  const hasFailure = runtimeFailedCount > 0;
  const hasTerminalTurn = ["completed", "failed", "cancelled"].includes(String(turnStatus ?? ""));
  const isRunning =
    turnStatus === "running" ||
    chatSending ||
    (!hasTerminalTurn && (taskStatus === "active" || taskStatus === "running"));
  const isWaiting =
    turnStatus === "pending" || taskStatus === "waitingUser" || taskStatus === "waiting";
  const hasPendingApproval = pendingApprovalCount > 0;
  const latestTs = pickLatestTime(
    runtimeTurn?.updatedAt,
    runtimeTurn?.createdAt,
    runtimeTask?.updatedAt,
    runtimeTask?.createdAt,
    activeSession?.updatedAt
  );
  const hasRecentEvent =
    Number.isFinite(latestTs) && Date.now() - latestTs < SOLO_OBS_STALE_MS;

  let activityState = "idle";
  if (!activeSession) {
    activityState = "unknown";
  } else if (!isCodexReady) {
    activityState = "waiting";
  } else if (hasFailure) {
    activityState = "blocked";
  } else if (hasPendingApproval) {
    activityState = "waiting";
  } else if (isRunning) {
    activityState = "running";
  } else if (isWaiting) {
    activityState = "waiting";
  } else if (hasTerminalTurn) {
    activityState = "idle";
  } else if (!hasRecentEvent && (hasTurn || hasTask)) {
    activityState = "stale";
  } else if (hasTask || hasTurn) {
    activityState = "idle";
  } else {
    activityState = "idle";
  }

  let currentIntent = "wait";
  if (providerNeedsCodexLogin && !codexAuth?.loggedIn) {
    currentIntent = "wait";
  } else if (hasPendingApproval || runtimeTurn?.status === "waitingUser") {
    currentIntent = "approve";
  } else if (hasFailure) {
    currentIntent = "revise";
  } else if (isRunning || chatSending) {
    currentIntent = "send";
  } else if (hasTask || hasTurn) {
    currentIntent = "inspect";
  } else if (activeSession) {
    currentIntent = "create";
  }

  const evidence = projectEvidenceText([
    runtimeTask?.title ? `任务: ${compactText(runtimeTask.title, 48)}` : "",
    runtimeTurn?.id ? `turn: ${compactText(runtimeTurn.id, 40)}` : "",
    hasPendingApproval
      ? `${pendingApprovalCount}条待审批`
      : hasFailure
        ? `${runtimeFailedCount}条异常`
        : taskStatus
          ? `任务状态: ${taskStatus}`
          : turnStatus
            ? `执行状态: ${turnStatus}`
            : turnIntent
              ? `意图: ${turnIntent}`
              : "No active run.  Create first task."
  ]);

  return {
    owner: activeSession ? "solo" : "external",
    capability: isCodexReady
      ? activeSession
        ? "managed"
        : "readonly"
      : "requiresLogin",
    activityState,
    currentIntent,
    evidence,
    debug: {
      sessionId: activeSession?.id ?? "",
      runtimeTaskId: runtimeTask?.id ?? "",
      runtimeTurnId: runtimeTurn?.id ?? "",
      runtimeTaskTitle: runtimeTask?.title ?? activeSession?.title ?? "",
      runtimeTurnStatus: turnStatus ?? "",
      turnIntent,
      pendingApprovalCount,
      runtimeFailedCount,
      latestTs,
    },
  };
}

function buildObservedCodexProjection(agent, index = 0) {
  const hasRecent = Number.isFinite(agent?.lastActivityAt)
    ? Date.now() - agent.lastActivityAt < SOLO_OBS_STALE_MS
    : false;
  const activityState = mapActivityStateFromTimestamp({
    state: agent?.state,
    activityState: agent?.activityState,
    lastActivityAt: agent?.lastActivityAt,
    hasRecent,
  });
  const lastEventLabel = agent?.lastEventSummary || agent?.lastEventType || "unknown";

  const evidence = projectEvidenceText([
    `workspace: ${compactAgentWorkspaceLabel(agent)}`,
    `visibility: ${compactAgentVisibilityLabel(agent)}`,
    `activity: ${compactAgentActivityState(agent)}`,
    `last event: ${compactText(lastEventLabel, 48)}`,
    `last activity: ${formatObservedActivityTime(agent?.lastActivityAt)}`,
  ]);

  return {
    owner: "external",
    capability: "observeOnly",
    activityState,
    currentIntent: "inspect",
    evidence,
    debug: {
      order: index,
      pid: Number.isFinite(agent?.pid) ? agent.pid : 0,
      id: agent?.id ?? "",
      matchedWorkspaceId: agent?.matchedWorkspaceId ?? null,
      matchedSessionId: agent?.matchedSessionId ?? null,
      cwd: agent?.cwd ?? "",
      command: agent?.command ?? "",
      visibility: agent?.visibility ?? "unknown",
      lastActivityAt: agent?.lastActivityAt ?? null,
      lastEventType: agent?.lastEventType ?? "",
      lastEventSummary: agent?.lastEventSummary ?? "",
    },
  };
}

function buildSoloProjection({ managedProjection, observedAgents }) {
  const external = (Array.isArray(observedAgents) ? observedAgents : [])
    .map((agent, index) => ({
      ...agent,
      projection: buildObservedCodexProjection(agent, index),
    }))
    .sort((left, right) => {
      const leftWeight = left.projection.activityState === "running" ? 2 : 1;
      const rightWeight = right.projection.activityState === "running" ? 2 : 1;
      if (rightWeight !== leftWeight) {
        return rightWeight - leftWeight;
      }
      return (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0);
    });

  return {
    managed: managedProjection,
    external,
    externalCount: external.length,
    primaryExternal: external[0] ?? null,
    canControl: managedProjection?.capability === "managed" && managedProjection?.owner === "solo",
  };
}

function projectionToTone(activityState) {
  if (activityState === "running") {
    return "active";
  }
  if (activityState === "waiting") {
    return "loading";
  }
  if (activityState === "blocked") {
    return "error";
  }
  if (activityState === "stale") {
    return "idle";
  }
  return "ready";
}

function projectionToStatus(activityState, currentIntent) {
  if (currentIntent === "approve") {
    return "approval";
  }
  if (activityState === "running") {
    return "running";
  }
  if (activityState === "waiting") {
    return "waiting";
  }
  if (activityState === "stale") {
    return "stale";
  }
  if (activityState === "blocked") {
    return "blocked";
  }
  return "idle";
}

function projectionRuntimeStatusLabel(activityState) {
  if (activityState === "running") {
    return "running";
  }
  if (activityState === "waiting") {
    return "waiting";
  }
  if (activityState === "blocked") {
    return "blocked";
  }
  if (activityState === "stale") {
    return "stale";
  }
  return "idle";
}

function projectionNextIntentChipLabel(intent) {
  if (intent === "approve") {
    return "approve";
  }
  if (intent === "revise") {
    return "revise";
  }
  if (intent === "send") {
    return "send";
  }
  if (intent === "inspect") {
    return "inspect";
  }
  if (intent === "create") {
    return "create";
  }
  return "wait";
}

function projectionPrimaryActionLabel(intent) {
  if (intent === "approve") {
    return "Approve";
  }
  if (intent === "revise") {
    return "Revise";
  }
  if (intent === "send") {
    return "Pause";
  }
  if (intent === "inspect") {
    return "Inspect";
  }
  if (intent === "create") {
    return "Run";
  }
  return "Run";
}

function projectionCapabilityLabel(capability) {
  if (capability === "observeOnly") {
    return "observe-only";
  }
  if (capability === "requiresLogin") {
    return "requires login";
  }
  if (capability === "readonly") {
    return "readonly";
  }
  return "managed";
}

function ExternalAgentResourceCard({ agent, workspace, current, onInspect }) {
  const activityLabel = agent.projection?.activityState || compactAgentActivityState(agent);
  const lastEventLabel = compactText(agent.lastEventSummary || agent.lastEventType || "No recent event", 48);

  return (
    <button
      type="button"
      className={`external-resource-agent-card ${current ? "is-current" : ""}`}
      onClick={() => onInspect(agent.id)}
      aria-label={`Inspect external Codex session for ${workspace?.name ?? "untracked workspace"}`}
    >
      <div className="external-resource-agent-head">
        <div>
          <span className="section-eyebrow">External Codex</span>
          <strong>{workspace?.name ?? "Untracked workspace"}</strong>
        </div>
        <span className={`drawer-chip drawer-chip-${codexAgentTone(agent)}`}>
          {activityLabel}
        </span>
      </div>
      <div className="external-agent-meta">
        <span>observe-only</span>
        <span>{workspace ? "linked" : "untracked"}</span>
      </div>
      <p>{lastEventLabel}</p>
    </button>
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
        aria-label={`Open workstream ${entry.title}`}
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
        aria-label={`Delete workstream ${entry.title}`}
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

function TopStatusBar({
  activeWorkspace,
  providerNeedsCodexLogin,
  managedProjection,
  observedProjectionCount,
  topbarResourceLabel,
  hasCustomWindowChrome,
  windowMaximized,
  onOpenSettings,
  onMinimize,
  onToggleMaximize,
  onClose,
}) {
  return (
    <header className="topbar">
      <div
        className="topbar-dragzone"
        data-tauri-drag-region={hasCustomWindowChrome ? true : undefined}
        onDoubleClick={() => void onToggleMaximize()}
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
          onClick={onOpenSettings}
        >
          <strong className="status-pill-value">
            {providerNeedsCodexLogin ? "Codex Login" : "Connection"}
          </strong>
        </button>
        <span className="status-pill status-pill-compact status-pill-active">
          <strong className="status-pill-value">
            {managedProjection ? projectionCapabilityLabel(managedProjection.capability) : "managed"}
          </strong>
        </span>
        <span
          className={`status-pill status-pill-compact status-pill-${
            observedProjectionCount ? "active" : "idle"
          }`}
          title={topbarResourceLabel}
        >
          <strong className="status-pill-value">
            observe-only{observedProjectionCount ? ` ${observedProjectionCount}` : ""}
          </strong>
        </span>
      </div>
      {hasCustomWindowChrome ? (
        <div className="window-controls">
          <button
            type="button"
            className="window-control-button"
            aria-label="最小化窗口"
            onClick={() => void onMinimize()}
          >
            <WindowControlIcon kind="minimize" />
          </button>
          <button
            type="button"
            className="window-control-button"
            aria-label={windowMaximized ? "还原窗口" : "最大化窗口"}
            onClick={() => void onToggleMaximize()}
          >
            <WindowControlIcon kind="maximize" maximized={windowMaximized} />
          </button>
          <button
            type="button"
            className="window-control-button window-control-close"
            aria-label="关闭窗口"
            onClick={() => void onClose()}
          >
            <WindowControlIcon kind="close" />
          </button>
        </div>
      ) : null}
    </header>
  );
}

function WorkstreamRail({
  sessions,
  activeWorkstreamEntries,
  waitingWorkstreamEntries,
  doneWorkstreamEntries,
  activeSessionId,
  chatSending,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  exceptionEntries,
  resourceDisplayCount,
  observedCodexState,
  workspaces,
  externalAgentsByWorkspaceId,
  activeWorkspaceId,
  activeSessionWorkspaceId,
  onSelectWorkspace,
  onRemoveWorkspace,
  untrackedExternalAgents,
  selectedObservedAgentId,
  onInspectExternalAgent,
  explorerOpen,
  setExplorerOpen,
  activeWorkspace,
  workspaceTreeLoading,
  workspaceTree,
  selectedFilePath,
  onOpenFile,
  externalProjectionAgents,
}) {
  const externalAgentsForDisplay = externalProjectionAgents ?? [];
  const renderWorkstreamGroup = (label, entries, emptyLabel, emptyTone) => (
    <section className="workstream-group">
      <div className="workstream-group-head">
        <span className="section-eyebrow">{label}</span>
        <span className="section-count">{entries.length}</span>
      </div>
      {entries.length ? (
        <div className="session-list">
          {entries.map((entry) => (
            <WorkstreamCard
              key={entry.id}
              entry={entry}
              active={entry.id === activeSessionId}
              onSelect={onSelectSession}
              onDelete={onDeleteSession}
              deletingDisabled={chatSending && entry.id === activeSessionId}
            />
          ))}
        </div>
      ) : (
        <div className="panel-collapsed-note">
          <EmptyVisual label={emptyLabel} tone={emptyTone} />
        </div>
      )}
    </section>
  );

  return (
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
          <button type="button" className="ghost-button" onClick={onCreateSession}>
            New
          </button>
        </div>
        <div className="workstream-groups">
          {renderWorkstreamGroup("Active", activeWorkstreamEntries, "No active workstreams", "active")}
          {renderWorkstreamGroup("Waiting", waitingWorkstreamEntries, "No waiting workstreams", "loading")}
          {renderWorkstreamGroup("Done", doneWorkstreamEntries, "No completed workstreams", "ready")}
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
                onSelect={onSelectSession}
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
              {externalAgentsForDisplay.length ? (
                <span className="list-badge list-badge-accent">
                  {externalAgentsForDisplay.length} external
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {workspaces.length || externalAgentsForDisplay.length ? (
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
                    onClick={() => void onSelectWorkspace(workspace.id)}
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
                    onClick={() => onRemoveWorkspace(workspace.id)}
                  >
                    Remove
                  </button>
	                  {workspaceAgents.length ? (
	                    <div className="workspace-agent-stack">
	                      {workspaceAgents.slice(0, 2).map((agent) => (
	                        <ExternalAgentResourceCard
	                          key={agent.id}
	                          agent={agent}
	                          workspace={workspace}
	                          current={agent.id === selectedObservedAgentId}
	                          onInspect={onInspectExternalAgent}
	                        />
	                      ))}
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
	                {untrackedExternalAgents.slice(0, 1).map((agent) => (
	                  <ExternalAgentResourceCard
	                    key={agent.id}
	                    agent={agent}
	                    workspace={null}
	                    current={agent.id === selectedObservedAgentId}
	                    onInspect={onInspectExternalAgent}
	                  />
	                ))}
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

      <section className={`panel-block panel-explorer ${explorerOpen ? "is-grow" : "is-collapsed"}`}>
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
                onOpenFile={onOpenFile}
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
  );
}

function RuntimeHeader({
  currentTaskTitle,
  runtimeWorkstreamLabel,
  currentTaskStateLabel,
  runtimePanelTone,
  currentRunStateLabel,
  nextIntentLabel,
  runtimeOutputCards,
  outputCountLabel,
}) {
  return (
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
  );
}

function RuntimeWorkbench({
  showActiveRunCard,
  activeRunTitle,
  activeRunChipLabel,
  runtimePanelTone,
  activeRunSummary,
  activeRunDetail,
  activeRunSummaryTone,
  nextIntentLabel,
  hiddenRuntimeTimelineCount,
  visibleRuntimeTimelineItems,
  runtimePanelState,
  visibleOutputCards,
  runtimeOutputCards,
  outputOverflowCount,
  selectedDetailId,
  onSelectDetail,
  onSelectArtifacts,
}) {
  return (
    <>
      {showActiveRunCard ? (
        <section className="shell-card active-run-card">
          <div className="task-panel-head">
            <div>
              <p className="section-eyebrow">Active run</p>
              <h3>{activeRunTitle}</h3>
            </div>
            <span className={`drawer-chip drawer-chip-${runtimePanelTone}`}>{activeRunChipLabel}</span>
          </div>
          <button
            type="button"
            className={`active-run-summary tone-${activeRunSummaryTone} ${selectedDetailId === "active-run" ? "is-selected" : ""}`}
            onClick={() => onSelectDetail("active-run")}
          >
            <div>
              <strong>{activeRunSummary}</strong>
              <p>{activeRunDetail || `next: ${nextIntentLabel}`}</p>
            </div>
          </button>
        </section>
      ) : null}

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
            visibleRuntimeTimelineItems.map((item) => {
              const detailTarget = item.id === "runtime-older-events" ? "history" : `timeline:${item.id}`;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`task-timeline-item ${selectedDetailId === detailTarget ? "is-selected" : ""}`}
                  onClick={() => onSelectDetail(detailTarget)}
                >
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
                </button>
              );
            })
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
                onClick={() => {
                  onSelectDetail(`output:${output.id}`);
                  onSelectArtifacts();
                }}
              >
                <strong>{output.title}</strong>
                <span>{output.meta}</span>
              </button>
            ))}
            {outputOverflowCount > 0 ? (
              <button
                type="button"
                className="runtime-output-tile tone-idle is-overflow"
                onClick={() => {
                  onSelectDetail("outputs");
                  onSelectArtifacts();
                }}
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
  );
}

function CommandBar({
  commandBarTitle,
  commandActionCards,
  activeSessionWorkspaceId,
  activeWorkspace,
  onOpenWorkspaceModal,
  onDetachWorkspace,
  composerInputRef,
  draft,
  setDraft,
  loginBlocked,
  chatSending,
  hasStreamingAssistant,
  onComposerKeyDown,
  composerPlaceholder,
  composerHint,
  commandPrimaryDisabled,
  commandPrimaryLabel,
  supervisionState,
  canControl,
  canUseCommandInput,
  onPrimaryAction,
  composerContextButtonLabel,
}) {
  return (
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
              <button type="button" className="ghost-button" onClick={onOpenWorkspaceModal}>
                Change
              </button>
              <button type="button" className="ghost-button" onClick={onDetachWorkspace}>
                Detach
              </button>
            </div>
          </div>
        ) : null}
        <textarea
          ref={composerInputRef}
          className="composer-input"
          value={draft}
          disabled={loginBlocked || chatSending || hasStreamingAssistant || !canUseCommandInput}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={composerPlaceholder}
        />
        <div className="composer-actions">
          <p className="composer-hint">{composerHint}</p>
          <div className="composer-button-row">
            <button
              type="button"
              className="primary-button"
              disabled={commandPrimaryDisabled}
              onClick={onPrimaryAction}
            >
              {commandPrimaryLabel}
            </button>
            {canControl && supervisionState === "waitingApproval" ? (
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
                onClick={onOpenWorkspaceModal}
                aria-label={composerContextButtonLabel}
                title={composerContextButtonLabel}
              >
                More
              </button>
            ) : null}
            {canControl && supervisionState === "blocked" ? (
              <button type="button" className="danger-button">
                Abort
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function InspectorPanel({
  inspectorEyebrow,
  inspectorTitle,
  runtimePanelStatus,
  inspectorStatus,
  inspectorQuestion,
  inspectorImpact,
  hasPendingApproval,
  isHistoryDetail,
  canReturnToHistory,
  historyItems,
  historyPageLabel,
  historyCanShowNewer,
  historyCanShowOlder,
  detailCanExpand,
  detailExpanded,
  onToggleDetailExpanded,
  inspectorDetailHeading,
  inspectorEvidence,
  canControl,
  onApprove,
  onRevise,
  onEvidence,
  onSelectHistoryItem,
  onBackToLatest,
  onBackToHistory,
  onHistoryNewer,
  onHistoryOlder,
}) {
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <p className="section-eyebrow">{inspectorEyebrow}</p>
          <h2>{inspectorTitle}</h2>
        </div>
        <span className="section-count">{runtimePanelStatus}</span>
      </div>

      <div className="inspector-cockpit">
        <section className={`inspector-checkpoint-card ${hasPendingApproval ? "tone-decision" : "tone-detail"}`}>
          <span className="section-eyebrow">{inspectorStatus}</span>
          <h3>{inspectorQuestion}</h3>
          <p>{inspectorImpact}</p>
          {canControl && hasPendingApproval ? (
            <div className="inspector-action-row">
              <button type="button" className="primary-button" onClick={onApprove}>
                Approve
              </button>
              <button type="button" className="ghost-button" onClick={onRevise}>
                Revise
              </button>
              <button type="button" className="ghost-button" onClick={onEvidence}>
                Evidence
              </button>
            </div>
          ) : detailCanExpand ? (
            <div className="inspector-action-row inspector-detail-action-row">
              {canReturnToHistory ? (
                <button type="button" className="ghost-button" onClick={onBackToHistory}>
                  Back to history
                </button>
              ) : null}
              <button type="button" className="ghost-button" onClick={onToggleDetailExpanded}>
                {detailExpanded ? "Hide full" : "Show full"}
              </button>
            </div>
          ) : canReturnToHistory ? (
            <div className="inspector-action-row inspector-detail-action-row">
              <button type="button" className="ghost-button" onClick={onBackToHistory}>
                Back to history
              </button>
            </div>
          ) : isHistoryDetail ? (
            <div className="inspector-action-row inspector-detail-action-row">
              <button type="button" className="ghost-button" onClick={onBackToLatest}>
                Back to latest
              </button>
            </div>
          ) : null}
        </section>

        {isHistoryDetail ? (
          <section className="inspector-evidence-card inspector-history-card">
            <div className="task-panel-head">
              <h3>{inspectorDetailHeading}</h3>
              <span className="drawer-chip drawer-chip-idle">{historyPageLabel}</span>
            </div>
            <div className="inspector-history-list">
              {historyItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="inspector-history-item"
                  onClick={() => onSelectHistoryItem(item)}
                >
                  <span>
                    {formatRuntimeTime(item.updatedAt ?? item.createdAt)} · {turnItemKindLabel(item.kind)}
                  </span>
                  <strong>{item.title || turnItemKindLabel(item.kind)}</strong>
                  <small>{item.summary || truncateInline(item.content || "No summary.", 96)}</small>
                </button>
              ))}
            </div>
            <div className="inspector-history-nav">
              <button type="button" className="ghost-button" disabled={!historyCanShowNewer} onClick={onHistoryNewer}>
                Newer
              </button>
              <button type="button" className="ghost-button" disabled={!historyCanShowOlder} onClick={onHistoryOlder}>
                Older
              </button>
            </div>
          </section>
        ) : (
          <section className="inspector-evidence-card">
            <h3>{inspectorDetailHeading}</h3>
            <div className="inspector-evidence-list">
              {inspectorEvidence.map((item, index) => (
                <p key={`${index}-${item}`}>{item}</p>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

function isActionableRuntimeFailure(item) {
  const status = String(item?.status ?? "").toLowerCase();
  const approvalState = String(item?.approvalState ?? "").toLowerCase();
  const detailText = [
    item?.title,
    item?.summary,
    item?.message,
    item?.content,
    item?.error,
    runtimeItemVisibleText(item),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isInternalCodexRecordFailure =
    detailText.includes("failed to record rollout items") ||
    detailText.includes("codex_core::session");

  if (isInternalCodexRecordFailure) {
    return false;
  }

  return (
    status === "failed" ||
    status === "cancelled" ||
    approvalState === "failed" ||
    approvalState === "rejected"
  );
}

function runtimeItemVisibleText(item) {
  const message = item?.message;
  const error = item?.error;
  const messageContent =
    typeof message === "string"
      ? message
      : typeof message?.content === "string"
        ? message.content
        : typeof message?.text === "string"
          ? message.text
          : "";
  const errorContent =
    typeof error === "string"
      ? error
      : typeof error?.message === "string"
        ? error.message
        : typeof error?.content === "string"
          ? error.content
          : "";

  return [item?.content, messageContent, errorContent]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n")
    .trim();
}

function isRuntimeStatusOnlyItem(item) {
  const title = String(item?.title ?? "").trim().toLowerCase();
  const summary = String(item?.summary ?? "").trim().toLowerCase();

  if (!title && !summary) {
    return true;
  }

  return [
    "连接",
    "准备",
    "执行工具",
    "生成回复",
    "完成",
    "cli",
    "reply completed",
    "turn completed",
    "回复生成完成",
  ].some((needle) => title.includes(needle) || summary.includes(needle));
}

function findRuntimeTurnAssistantMessage({ runtimeTurn, runtimeItems, sessionMessages }) {
  const messages = Array.isArray(sessionMessages) ? sessionMessages : [];
  if (!messages.length) {
    return null;
  }

  const findAssistantAfterUserIndex = (userIndex) => {
    if (userIndex < 0) {
      return null;
    }
    return (
      messages
        .slice(userIndex + 1)
        .find(
          (message) =>
            String(message?.role ?? "").toLowerCase() === "assistant" &&
            compactText(message?.content ?? "", 1)
        ) ?? null
    );
  };

  const assistantMessageId = runtimeTurn?.assistantMessageId ?? "";
  if (assistantMessageId) {
    const matched = messages.find(
      (message) =>
        String(message?.id ?? "") === assistantMessageId &&
        String(message?.role ?? "").toLowerCase() === "assistant" &&
        compactText(message?.content ?? "", 1)
    );
    if (matched) {
      return matched;
    }
  }

  const userMessageId = runtimeTurn?.userMessageId ?? "";
  if (userMessageId) {
    const matchedById = findAssistantAfterUserIndex(
      messages.findIndex((message) => String(message?.id ?? "") === userMessageId)
    );
    if (matchedById) {
      return matchedById;
    }
  }

  if (String(runtimeTurn?.id ?? "").startsWith("optimistic_")) {
    const optimisticUserItem = (runtimeItems ?? []).find(
      (item) =>
        item?.turnId === runtimeTurn?.id &&
        String(item?.kind ?? "").toLowerCase().includes("user")
    );
    const optimisticUserText = compactText(
      optimisticUserItem?.content ?? optimisticUserItem?.summary ?? "",
      512
    );
    if (optimisticUserText) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (
          String(message?.role ?? "").toLowerCase() === "user" &&
          compactText(message?.content ?? "", 512) === optimisticUserText
        ) {
          return findAssistantAfterUserIndex(index);
        }
      }
    }
  }

  return null;
}

function buildRuntimeVisibleResult({ runtimeTurn, runtimeItems, outputCards, sessionMessages }) {
  const turnStatus = String(runtimeTurn?.status ?? "").toLowerCase();
  const hasOpenTurn = ["pending", "running", "waitinguser"].includes(turnStatus);
  const visibleAssistantItem = [...(runtimeItems ?? [])]
    .reverse()
    .find((item) => {
      const role = String(item?.role ?? item?.message?.role ?? item?.metadata?.role ?? "").toLowerCase();
      const kind = String(item?.kind ?? item?.type ?? "").toLowerCase();
      const text = runtimeItemVisibleText(item);
      return (
        text &&
        (role === "assistant" ||
          kind === "agentmessage" ||
          kind.includes("assistant") ||
          kind.includes("response"))
      );
    });

  if (visibleAssistantItem) {
    const detail = runtimeItemVisibleText(visibleAssistantItem);
    return {
      title: "Assistant response",
      detail: truncateInline(detail, 220),
      fullDetail: detail,
      tone: "active",
      source: "assistantItem",
    };
  }

  const messages = Array.isArray(sessionMessages) ? sessionMessages : [];
  const visibleAssistantMessage =
    findRuntimeTurnAssistantMessage({ runtimeTurn, runtimeItems, sessionMessages }) ??
    (hasOpenTurn
      ? null
      : [...messages]
          .reverse()
          .find(
            (message) =>
              String(message?.role ?? "").toLowerCase() === "assistant" &&
              compactText(message?.content ?? "", 1)
          ) ??
        null);

  if (visibleAssistantMessage) {
    const detail = visibleAssistantMessage.content ?? "";
    return {
      title: "Assistant response",
      detail: truncateInline(detail, 220),
      fullDetail: detail,
      tone: "active",
      source: "assistantMessage",
    };
  }

  const visibleOutputCount = outputCards?.length ?? 0;
  if (visibleOutputCount > 0) {
    return {
      title: `${visibleOutputCount} output${visibleOutputCount === 1 ? "" : "s"} ready`,
      detail: "Open Outputs to inspect generated artifacts.",
      fullDetail: "Open Outputs to inspect generated artifacts.",
      tone: "active",
      source: "output",
    };
  }

  const hasTerminalTurn = ["completed", "failed", "cancelled"].includes(
    String(runtimeTurn?.status ?? "")
  );
  if (hasTerminalTurn) {
    return {
      title: "No visible output captured",
      detail: "The turn finished, but Solo did not receive assistant text or artifacts.",
      fullDetail: "The turn finished, but Solo did not receive assistant text or artifacts.",
      tone: runtimeTurn?.status === "completed" ? "idle" : "error",
      source: "missing",
    };
  }

  const latestActionItem = [...(runtimeItems ?? [])]
    .reverse()
    .find((item) => !isRuntimeStatusOnlyItem(item));
  if (latestActionItem) {
    return {
      title: truncateInline(latestActionItem.title || latestActionItem.summary || "Runtime event", 96),
      detail: truncateInline(latestActionItem.summary || latestActionItem.content || "Waiting for result.", 140),
      fullDetail: latestActionItem.summary || latestActionItem.content || "Waiting for result.",
      tone: "active",
      source: "event",
    };
  }

  return {
    title: hasOpenTurn ? "Codex is working" : "Waiting for visible result",
    detail: hasOpenTurn
      ? "Awaiting progress for the current turn."
      : "Runtime events are being collected.",
    fullDetail: hasOpenTurn
      ? "Awaiting progress for the current turn."
      : "Runtime events are being collected.",
    tone: hasOpenTurn ? "loading" : "idle",
    source: "waiting",
  };
}

export default function App() {
  const [observedCodexState, setObservedCodexState] = useState({
    agents: [],
    loading: false,
    error: "",
  });
  const [selectedObservedAgentId, setSelectedObservedAgentId] = useState("");

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
  const runtimeRefreshLoopRef = useRef(new Set());
  const startRuntimeSnapshotRefreshLoopRef = useRef(null);
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
  const [, setPreviewState] = useState({ loading: false, error: "" });
  const [proposalsBySession, setProposalsBySession] = useState({});
  const [, setProposalPanelState] = useState({ loading: false, error: "" });
  const [proposalActionId, setProposalActionId] = useState("");
  const [decisionPreviewBySession, setDecisionPreviewBySession] = useState({});
  const [turnIntentBySession, setTurnIntentBySession] = useState({});
  const [runtimeSnapshotBySession, setRuntimeSnapshotBySession] = useState({});
  const [runtimePanelState, setRuntimePanelState] = useState({ loading: false, error: "" });
  const [selectedDetailId, setSelectedDetailId] = useState("active-run");
  const [lastHistoryDetailId, setLastHistoryDetailId] = useState("");
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [historyPageIndex, setHistoryPageIndex] = useState(0);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [, setInspectorTab] = useState("trace");

  useEffect(() => {
    setSelectedDetailId("active-run");
    setLastHistoryDetailId("");
  }, [activeSessionId]);

  useEffect(() => {
    setDetailExpanded(false);
  }, [activeSessionId, selectedDetailId]);

  useEffect(() => {
    setHistoryPageIndex(0);
  }, [activeSessionId, selectedDetailId]);

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
        const turnItems = turn
          ? (snapshot.turnItems ?? []).filter((item) => item.turnId === turn.id)
          : [];
        const hasReconciledAssistant = Boolean(
          findRuntimeTurnAssistantMessage({
            runtimeTurn: turn,
            runtimeItems: turnItems,
            sessionMessages: session.messages,
          })
        );
        const pendingApprovals = (snapshot.turnItems ?? []).filter(
          (item) => item.approvalState === "pending"
        ).length;
        const failedItems = (snapshot.turnItems ?? []).filter(isActionableRuntimeFailure).length;
        const tone = failedItems > 0
          ? "error"
          : pendingApprovals > 0
            ? "loading"
            : task?.status === "completed" || turn?.status === "completed" || hasReconciledAssistant
              ? "ready"
              : task?.status === "waitingUser"
                ? "loading"
              : task?.status === "active" || turn?.status === "running"
                ? "active"
                : "idle";
        const statusLabel = turn?.status === "completed" || hasReconciledAssistant
          ? turnStatusLabel("completed")
          : task
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
          : pendingApprovals > 0
            ? "waiting"
            : task?.status === "completed" || task?.status === "cancelled" || turn?.status === "completed" || hasReconciledAssistant
              ? "done"
              : task?.status === "waitingUser"
                ? "waiting"
              : "active";
        let exceptionLabel = "";
        let exceptionSummary = "";
        if (failedItems > 0) {
          exceptionLabel = "异常";
          exceptionSummary = `${failedItems} 个失败或拒绝事件需要处理`;
        } else if (pendingApprovals > 0) {
          exceptionLabel = "待确认";
          exceptionSummary = `${pendingApprovals} 个检查点等待你介入`;
        } else if (task?.status === "waitingUser" && !hasReconciledAssistant) {
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
      const snapshotPayload = await Promise.race([
        desktop.sessionRuntimeSnapshot(sessionId),
        new Promise((resolve) => {
          window.setTimeout(() => resolve(null), 2500);
        }),
      ]);
      const snapshot = normalizeRuntimeSnapshot(snapshotPayload, sessionId);
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

  const startRuntimeSnapshotRefreshLoop = (sessionId) => {
    if (!sessionId) {
      return;
    }
    if (runtimeRefreshLoopRef.current.has(sessionId)) {
      return;
    }

    runtimeRefreshLoopRef.current.add(sessionId);
    const startedAt = Date.now();
    const maxRuntimeRefreshMs = 10 * 60 * 1000;
    const finish = () => {
      runtimeRefreshLoopRef.current.delete(sessionId);
    };
    const refresh = async () => {
      if (!mountedRef.current) {
        finish();
        return;
      }
      try {
        const snapshot = await loadSessionRuntimeSnapshot(sessionId, { silent: true });
        const hasRunningTurn = (snapshot.turns ?? []).some((turn) =>
          ["pending", "running"].includes(String(turn.status ?? ""))
        );
        const hasOptimisticTurn = (snapshot.turns ?? []).some((turn) =>
          String(turn.id ?? "").startsWith("optimistic_")
        );

        if (!hasRunningTurn && activeSessionIdRef.current === sessionId) {
          setChatSending(false);
        }

        if ((hasRunningTurn || hasOptimisticTurn) && Date.now() - startedAt < maxRuntimeRefreshMs) {
          window.setTimeout(refresh, 1200);
          return;
        }
        finish();
      } catch {
        if (Date.now() - startedAt < maxRuntimeRefreshMs) {
          window.setTimeout(refresh, 2000);
          return;
        }
        finish();
      }
    };

    window.setTimeout(refresh, 400);
  };
  startRuntimeSnapshotRefreshLoopRef.current = startRuntimeSnapshotRefreshLoop;

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const snapshot = runtimeSnapshotBySession[activeSessionId];
    const shouldRefreshRuntime = (snapshot?.turns ?? []).some((turn) => {
      const turnStatus = String(turn.status ?? "");
      return (
        turnStatus === "pending" ||
        turnStatus === "running" ||
        String(turn.id ?? "").startsWith("optimistic_")
      );
    });

    if (shouldRefreshRuntime) {
      startRuntimeSnapshotRefreshLoopRef.current?.(activeSessionId);
    }
  }, [activeSessionId, runtimeSnapshotBySession]);

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
        void loadSessionRuntimeSnapshot(payload.sessionId, { silent: true }).catch(() => {});
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
      setSelectedObservedAgentId("");
      setActiveSessionId(session.id);
      setDraft("");
      setNotice({ kind: "success", text: "已创建新会话。" });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleSelectSession = (sessionId) => {
    const session = sessions.find((entry) => entry.id === sessionId);
    setSelectedObservedAgentId("");
    setActiveSessionId(sessionId);
    setActiveWorkspaceId(session?.workspaceId ?? "");
  };

  const handleInspectExternalAgent = (agentId) => {
    setSelectedObservedAgentId(agentId);
    setInspectorTab("trace");
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

  const handleSend = async (options = {}) => {
    const targetSessionId = options.sessionId ?? activeSessionId;
    if (!targetSessionId) {
      return;
    }
    const input = draft.trim();
    if (!input || chatSending || hasStreamingAssistant || loginBlocked) {
      return;
    }

    const requestedInteractionMode = options.interactionMode ?? activeSessionMode;
    const requestedTurnIntent = options.turnIntent ?? activeTurnIntent;

    setDraft("");
    setChatSending(true);
    setStreamProgressBySession((current) => {
      if (!current[targetSessionId]) {
        return current;
      }
      const next = { ...current };
      delete next[targetSessionId];
      return next;
    });
    setStreamMonitorBySession((current) => {
      if (!current[targetSessionId]) {
        return current;
      }
      const next = { ...current };
      delete next[targetSessionId];
      return next;
    });
    setDecisionPreviewBySession((current) => {
      if (!current[targetSessionId]) {
        return current;
      }
      const next = { ...current };
      delete next[targetSessionId];
      return next;
    });
    setProposalsBySession((current) => {
      const previous = current[targetSessionId];
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
        [targetSessionId]: sortProposals(nextProposals),
      };
    });
    const optimisticTimestamp = Date.now();
    const optimisticTurnId = `optimistic_turn_${optimisticTimestamp}`;
    const optimisticItemId = `optimistic_item_${optimisticTimestamp}`;
    const optimisticStatusItemId = `optimistic_status_${optimisticTimestamp}`;
    setRuntimeSnapshotBySession((current) => {
      const previous = normalizeRuntimeSnapshot(current[targetSessionId], targetSessionId);
      const existingTask =
        previous.tasks.find((task) =>
          ["active", "blocked", "waitingUser", "pending"].includes(task.status)
        ) ??
        previous.tasks[0] ??
        null;
      const taskId = existingTask?.id ?? `optimistic_task_${optimisticTimestamp}`;
      const taskTitle =
        existingTask?.title?.trim() && existingTask.title !== "新会话"
          ? existingTask.title
          : truncateInline(input, 42);
      const nextTask = {
        ...(existingTask ?? {}),
        id: taskId,
        sessionId: targetSessionId,
        title: taskTitle,
        summary: truncateInline(input, 84),
        createdAt: existingTask?.createdAt ?? optimisticTimestamp,
        updatedAt: optimisticTimestamp,
        status: "active",
        currentTurnId: optimisticTurnId,
        latestTurnId: optimisticTurnId,
      };
      const nextTurn = {
        id: optimisticTurnId,
        sessionId: targetSessionId,
        taskId,
        createdAt: optimisticTimestamp,
        updatedAt: optimisticTimestamp,
        status: "running",
        intent: requestedTurnIntent,
        userMessageId: optimisticItemId,
        assistantMessageId: null,
        summary: truncateInline(input, 120),
        itemIds: [optimisticItemId, optimisticStatusItemId],
      };
      const optimisticItems = [
        {
          id: optimisticItemId,
          sessionId: targetSessionId,
          taskId,
          turnId: optimisticTurnId,
          createdAt: optimisticTimestamp,
          updatedAt: optimisticTimestamp,
          kind: "userMessage",
          status: "completed",
          approvalState: "notRequired",
          title: "User request",
          summary: truncateInline(input, 84),
          sourceMessageId: optimisticItemId,
          sourceProposalId: null,
          content: input,
          metadata: { optimistic: true },
        },
        {
          id: optimisticStatusItemId,
          sessionId: targetSessionId,
          taskId,
          turnId: optimisticTurnId,
          createdAt: optimisticTimestamp,
          updatedAt: optimisticTimestamp,
          kind: "statusUpdate",
          status: "running",
          approvalState: "notRequired",
          title: "Run queued",
          summary: "Waiting for Codex stream events.",
          sourceMessageId: null,
          sourceProposalId: null,
          content: null,
          metadata: {
            optimistic: true,
            interactionMode: requestedInteractionMode,
            intent: requestedTurnIntent,
          },
        },
      ];
      return {
        ...current,
        [targetSessionId]: normalizeRuntimeSnapshot(
          {
            sessionId: targetSessionId,
            tasks: [nextTask, ...previous.tasks.filter((task) => task.id !== taskId)],
            turns: [nextTurn, ...previous.turns],
            turnItems: [
              ...previous.turnItems.filter((item) => item.turnId !== optimisticTurnId),
              ...optimisticItems,
            ],
          },
          targetSessionId
        ),
      };
    });
    try {
      const updatedSession = await desktop.chatSend(
        targetSessionId,
        input,
        [],
        requestedInteractionMode,
        requestedTurnIntent
      );
      setSessions((current) => upsertSession(current, updatedSession));
      void loadSessionRuntimeSnapshot(targetSessionId, { silent: true }).catch(() => {});
      startRuntimeSnapshotRefreshLoop(targetSessionId);
    } catch (error) {
      setChatSending(false);
      setDraft(input);
      void loadSessionRuntimeSnapshot(targetSessionId, { silent: true }).catch(() => {});
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
    if (!canUseCommandInput) {
      return;
    }
    if (event.nativeEvent?.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!hasManagedControl || supervisionState === "idle") {
        void handleRunCodexTask();
        return;
      }
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
  const canStartManagedRunInput = Boolean(
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
  const previewTitle = selectedFilePath || "暂无文件";
  const selectedChoiceLabel = selectedDecisionOption?.optionKey ?? selectedDecisionOption?.title ?? "";
  const previewDeckActive = showPreviewCards;
  const runtimePendingApprovalCount = activeRuntimeItems.filter((item) => item.approvalState === "pending")
    .length;
  const runtimeFailedCount = activeRuntimeItems.filter(isActionableRuntimeFailure).length;
  const runtimeExceptionCount = runtimePendingApprovalCount + runtimeFailedCount;
  const managedRuntimeProjection = useMemo(
    () =>
      buildManagedRuntimeProjection({
        activeSession,
        runtimeTask: activeRuntimeTask,
        runtimeTurn: activeRuntimeTurn,
        runtimeFailedCount,
        pendingApprovalCount: runtimePendingApprovalCount,
        providerNeedsCodexLogin,
        codexAuth,
        chatSending,
      }),
    [
      activeSession,
      activeRuntimeTask,
      activeRuntimeTurn,
      runtimeFailedCount,
      runtimePendingApprovalCount,
      providerNeedsCodexLogin,
      codexAuth,
      chatSending,
    ]
  );
  const soloProjection = useMemo(
    () =>
      buildSoloProjection({
        managedProjection: managedRuntimeProjection,
        observedAgents: observedCodexState.agents,
      }),
    [managedRuntimeProjection, observedCodexState.agents]
  );
  const externalProjectionAgents = soloProjection.external;
  const selectedObservedAgent = selectedObservedAgentId
    ? externalProjectionAgents.find((agent) => agent.id === selectedObservedAgentId) ?? null
    : null;
  const hasManagedRuntimeSignal = Boolean(
    activeRuntimeTurn ||
      activeRuntimeItems.length ||
      showDecisionDeck ||
      showPreviewCards ||
      chatSending ||
      runtimePendingApprovalCount ||
      runtimeFailedCount
  );
  const hasManagedWorkstream = sessions.length > 0;
  const shouldShowExternalAsPrimary = !hasManagedWorkstream && !hasManagedRuntimeSignal;
  const activeObservedAgent = shouldShowExternalAsPrimary
    ? selectedObservedAgent ?? soloProjection.primaryExternal
    : null;
  const activeObservedProjection = activeObservedAgent?.projection ?? null;
  const isObservingExternal = Boolean(activeObservedProjection);
  const inspectedObservedAgent = selectedObservedAgent ?? activeObservedAgent;
  const inspectedObservedProjection = inspectedObservedAgent?.projection ?? null;
  const isInspectingExternal = Boolean(inspectedObservedProjection);
  const activeObservedAgentId = inspectedObservedAgent?.id ?? "";
  const hasPendingApproval = !isObservingExternal &&
    managedRuntimeProjection.capability === "managed" &&
    managedRuntimeProjection.owner === "solo" &&
    (showDecisionDeck || showPreviewCards || runtimePendingApprovalCount > 0);
  const activeRuntimeAssistantMessage = findRuntimeTurnAssistantMessage({
    runtimeTurn: activeRuntimeTurn,
    runtimeItems: activeRuntimeItems,
    sessionMessages: activeSession?.messages,
  });
  const hasCurrentTurnAssistantResult = Boolean(activeRuntimeAssistantMessage);
  useEffect(() => {
    if (hasCurrentTurnAssistantResult && chatSending) {
      setChatSending(false);
    }
  }, [hasCurrentTurnAssistantResult, chatSending]);
  const hasSessionAssistantFallback =
    !chatSending &&
    (activeSession?.messages ?? []).some(
      (message) =>
        String(message?.role ?? "").toLowerCase() === "assistant" &&
        compactText(message?.content ?? "", 1)
    );
  const runtimePanelLoading = runtimePanelState.loading && !hasSessionAssistantFallback;
  const runtimePanelTone = runtimePanelState.error
    ? "error"
    : runtimePanelLoading
      ? "loading"
      : hasCurrentTurnAssistantResult
        ? "idle"
      : isObservingExternal
        ? projectionToTone(activeObservedProjection.activityState)
        : projectionToTone(managedRuntimeProjection.activityState);
  const runtimePanelStatus = runtimePanelState.error
    ? "error"
    : runtimePanelLoading
      ? "loading"
      : hasCurrentTurnAssistantResult
        ? "idle"
      : isObservingExternal
        ? projectionToStatus(activeObservedProjection.activityState, activeObservedProjection.currentIntent)
        : projectionToStatus(managedRuntimeProjection.activityState, managedRuntimeProjection.currentIntent);
  const resolvedManagedIntent = hasCurrentTurnAssistantResult
    ? "create"
    : managedRuntimeProjection.currentIntent;
  const runtimeTimelineItems = activeRuntimeItems.slice().reverse();
  const observedTimelineItems = activeObservedAgent
    ? [
        {
          id: `${activeObservedAgent.id}-latest-event`,
          kind: "summary",
          status: "pending",
          approvalState: "notRequired",
          title: activeObservedAgent.lastEventSummary || activeObservedAgent.lastEventType || "External session observed",
          summary: `visibility: ${compactAgentVisibilityLabel(activeObservedAgent)} · control: observe-only`,
          createdAt: activeObservedAgent.lastActivityAt ?? activeObservedAgent.lastSeenAt,
          updatedAt: activeObservedAgent.lastActivityAt ?? activeObservedAgent.lastSeenAt,
        },
        {
          id: `${activeObservedAgent.id}-control-boundary`,
          kind: "statusUpdate",
          status: "pending",
          approvalState: "notRequired",
          title: "Read-only boundary",
          summary: "External Codex sessions can be observed, not controlled.",
          createdAt: activeObservedAgent.lastSeenAt,
          updatedAt: activeObservedAgent.lastSeenAt,
        },
      ]
    : [];
  const sessionMessagesForTimeline = activeSession?.messages ?? [];
  const latestUserMessageIndex = [...sessionMessagesForTimeline]
    .reverse()
    .findIndex((message) => String(message?.role ?? "").toLowerCase() === "user");
  const latestUserForwardIndex =
    latestUserMessageIndex >= 0
      ? sessionMessagesForTimeline.length - 1 - latestUserMessageIndex
      : -1;
  const hasAssistantAfterLatestUser =
    latestUserForwardIndex >= 0 &&
    sessionMessagesForTimeline
      .slice(latestUserForwardIndex + 1)
      .some(
        (message) =>
          String(message?.role ?? "").toLowerCase() === "assistant" &&
          compactText(message?.content ?? "", 1)
      );
  const shouldShowRuntimeMonitor =
    !isObservingExternal &&
    managedRuntimeProjection.activityState === "running" &&
    !hasCurrentTurnAssistantResult &&
    !hasAssistantAfterLatestUser;
  const hasRuntimeAssistantItem = activeRuntimeItems.some((item) => {
    const role = String(item?.role ?? item?.message?.role ?? item?.metadata?.role ?? "").toLowerCase();
    const kind = String(item?.kind ?? item?.type ?? "").toLowerCase();
    return role === "assistant" || kind === "agentmessage" || kind.includes("assistant") || kind.includes("response");
  });
  const runtimeAssistantTimelineItem =
    activeRuntimeAssistantMessage && !hasRuntimeAssistantItem
      ? {
          id: `runtime-assistant-${activeRuntimeAssistantMessage.id ?? "matched"}`,
          kind: "agentMessage",
          status: "completed",
          approvalState: "notRequired",
          title: "Assistant response",
          summary: truncateInline(activeRuntimeAssistantMessage.content ?? "", 160),
          content: activeRuntimeAssistantMessage.content ?? "",
          createdAt: activeRuntimeAssistantMessage.createdAt ?? null,
          updatedAt:
            activeRuntimeAssistantMessage.updatedAt ??
            activeRuntimeAssistantMessage.createdAt ??
            null,
        }
      : null;
  const runtimeMonitorTimelineItem = shouldShowRuntimeMonitor
    ? {
        id: "runtime-monitor-waiting-assistant",
        kind: "statusUpdate",
        status: "running",
        approvalState: "notRequired",
        title: "Codex is working",
        summary: "Awaiting progress for the current turn.",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    : null;
  const sessionMessageTimelineItems = [...(activeSession?.messages ?? [])]
    .reverse()
    .filter((message) => compactText(message?.content ?? "", 1))
    .map((message, index) => {
      const role = String(message?.role ?? "").toLowerCase();
      const failed = String(message?.status ?? "").toLowerCase() === "failed";
      return {
        id: `session-message-${message?.id ?? index}`,
        kind: role === "assistant" ? "agentMessage" : "userMessage",
        status: failed ? "failed" : "completed",
        approvalState: "notRequired",
        title: role === "assistant" ? "Assistant response" : "User request",
        summary: truncateInline(message?.content ?? "", 160),
        content: message?.content ?? "",
        createdAt: message?.createdAt ?? null,
        updatedAt: message?.updatedAt ?? message?.createdAt ?? null,
      };
    });
  const runtimeTimelineDisplayItems = isObservingExternal
    ? observedTimelineItems
    : runtimeTimelineItems.length
    ? [runtimeAssistantTimelineItem, runtimeMonitorTimelineItem, ...runtimeTimelineItems].filter(Boolean)
    : sessionMessageTimelineItems.length
      ? [runtimeMonitorTimelineItem, ...sessionMessageTimelineItems].filter(Boolean)
    : [
        runtimeMonitorTimelineItem,
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
      ].filter(Boolean);
  const runtimePriorityTimelineItems = [
    ...runtimeTimelineDisplayItems.filter(isActionableRuntimeFailure),
    ...runtimeTimelineDisplayItems.filter(
      (item) =>
        !isActionableRuntimeFailure(item) &&
        (String(item?.approvalState ?? "") === "pending" ||
          String(item?.status ?? "") === "waitingUser")
    ),
    ...runtimeTimelineDisplayItems.filter(
      (item) =>
        !isActionableRuntimeFailure(item) &&
        String(item?.approvalState ?? "") !== "pending" &&
        String(item?.status ?? "") !== "waitingUser" &&
        !isRuntimeStatusOnlyItem(item)
    ),
    ...runtimeTimelineDisplayItems.filter(
      (item) =>
        !isActionableRuntimeFailure(item) &&
        String(item?.approvalState ?? "") !== "pending" &&
        String(item?.status ?? "") !== "waitingUser" &&
        isRuntimeStatusOnlyItem(item)
    ),
  ];
  const runtimeWorkstreamLabel =
    isObservingExternal
      ? `${compactAgentVisibilityLabel(activeObservedAgent)} · observe-only`
      : managedRuntimeProjection.debug.runtimeTaskTitle || activeSession?.title || "Untitled workstream";
  const hasManagedControl =
    !isObservingExternal &&
    managedRuntimeProjection.owner === "solo" &&
    managedRuntimeProjection.capability === "managed";
  const canStartManagedRunFromObserve = Boolean(
    !hasManagedControl &&
      !loginBlocked &&
      !chatSending &&
      !hasStreamingAssistant
  );
  const canUseCommandInput = hasManagedControl || canStartManagedRunFromObserve;
  const composerHint = hasManagedControl
    ? providerNeedsCodexLogin && !codexAuth.loggedIn
      ? "Log in to Codex before sending."
      : activeProvider === "manual"
        ? "Manual provider: sending only records the request."
        : activeSessionWorkspaceId
          ? "Codex will run in the selected workspace."
          : "Enter to run with Codex, Shift+Enter for newline."
    : isObservingExternal
      ? "Observe-only target selected. Enter a task to start a new managed run."
      : "Enter a task to create a managed run.";
  const supervisionState = hasManagedControl
    ? hasCurrentTurnAssistantResult
      ? "idle"
      : runtimeExceptionCount > 0
      ? "blocked"
      : hasPendingApproval
        ? "waitingApproval"
        : managedRuntimeProjection.activityState === "running"
          ? "running"
          : "idle"
    : "idle";
  const shouldInspectExternal =
    isInspectingExternal && !hasPendingApproval && supervisionState !== "blocked";
  const currentTaskTitle = hasManagedControl
    ? managedRuntimeProjection.debug.runtimeTaskTitle || (supervisionState === "idle" ? "No task target yet" : "Waiting task")
    : isObservingExternal
      ? compactAgentWorkspaceLabel(activeObservedAgent)
      : "No managed task target yet";
  const currentTaskStateLabel = isObservingExternal
    ? projectionRuntimeStatusLabel(activeObservedProjection.activityState)
    : supervisionState === "blocked"
    ? "blocked"
    : supervisionState === "waitingApproval"
      ? "waiting approval"
      : projectionRuntimeStatusLabel(managedRuntimeProjection.activityState);
  const currentRunStateLabel = runtimePanelState.error
    ? "error"
    : runtimePanelLoading
      ? "loading"
      : hasCurrentTurnAssistantResult
        ? "idle"
      : isObservingExternal
        ? projectionRuntimeStatusLabel(activeObservedProjection.activityState)
        : projectionRuntimeStatusLabel(managedRuntimeProjection.activityState);
  const nextIntentLabel = hasManagedControl
    ? projectionNextIntentChipLabel(resolvedManagedIntent)
    : "inspect";
  const runtimeTimelineBudget = isObservingExternal ? 2 : 6;
  const shouldFoldRuntimeTimeline = runtimePriorityTimelineItems.length > runtimeTimelineBudget;
  const primaryRuntimeTimelineItems = runtimePriorityTimelineItems.slice(
    0,
    shouldFoldRuntimeTimeline ? Math.max(1, runtimeTimelineBudget - 1) : runtimeTimelineBudget
  );
  const hiddenRuntimeTimelineCount = Math.max(0, runtimePriorityTimelineItems.length - primaryRuntimeTimelineItems.length);
  const visibleRuntimeTimelineItems = hiddenRuntimeTimelineCount
    ? [
        ...primaryRuntimeTimelineItems,
        {
          id: "runtime-older-events",
          kind: "statusUpdate",
          status: "completed",
          approvalState: "notRequired",
          title: `${hiddenRuntimeTimelineCount} older events`,
          summary: "Older history is folded to keep the cockpit readable.",
          createdAt: runtimePriorityTimelineItems.at(-1)?.createdAt ?? null,
          updatedAt: runtimePriorityTimelineItems.at(-1)?.updatedAt ?? null,
        },
      ]
    : primaryRuntimeTimelineItems;
  const foldedRuntimeTimelineItems = hiddenRuntimeTimelineCount
    ? runtimePriorityTimelineItems.slice(primaryRuntimeTimelineItems.length)
    : [];
  const historyPageSize = 6;
  const historyPageCount = Math.max(1, Math.ceil(foldedRuntimeTimelineItems.length / historyPageSize));
  const safeHistoryPageIndex = Math.min(historyPageIndex, historyPageCount - 1);
  const historyPageItems = foldedRuntimeTimelineItems.slice(
    safeHistoryPageIndex * historyPageSize,
    safeHistoryPageIndex * historyPageSize + historyPageSize
  );
  const historyPageStart = foldedRuntimeTimelineItems.length
    ? safeHistoryPageIndex * historyPageSize + 1
    : 0;
  const historyPageEnd = Math.min(
    foldedRuntimeTimelineItems.length,
    safeHistoryPageIndex * historyPageSize + historyPageItems.length
  );
  
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
  const activeRuntimeVisibleResult = buildRuntimeVisibleResult({
    runtimeTurn: activeRuntimeTurn,
    runtimeItems: activeRuntimeItems,
    outputCards: runtimeOutputCards,
    sessionMessages: activeSession?.messages,
  });
  const hasVisibleRuntimeResult = ["assistantItem", "assistantMessage", "output"].includes(
    activeRuntimeVisibleResult.source
  );
  const activeRunSummary = isObservingExternal
    ? truncateInline(
        activeObservedAgent.lastEventSummary || activeObservedAgent.lastEventType || "No recent session event.",
        96
      )
    : activeRuntimeVisibleResult.title;
  const activeRunDetail = isObservingExternal
    ? `visibility: ${compactAgentVisibilityLabel(activeObservedAgent)} · control: observe-only`
    : activeRuntimeVisibleResult.detail;
  const activeRunFullDetail = isObservingExternal
    ? activeRunDetail
    : activeRuntimeVisibleResult.fullDetail || activeRunDetail;
  const activeRunTitle = isObservingExternal
    ? "Observed Codex session"
    : activeRuntimeTurn
      ? "Managed Codex run"
      : hasVisibleRuntimeResult
        ? "Latest Codex result"
      : "No active run";
  const activeRunChipLabel = isObservingExternal ? "observe-only" : "managed";
  const activeRunSummaryTone = isObservingExternal
    ? projectionToTone(activeObservedProjection.activityState)
    : activeRuntimeTurn
      ? runtimeExceptionCount > 0
        ? "error"
        : activeRuntimeVisibleResult.tone
      : hasVisibleRuntimeResult
        ? activeRuntimeVisibleResult.tone
      : "idle";
  const showActiveRunCard =
    runtimePanelState.error ||
    runtimePanelLoading ||
    supervisionState === "running" ||
    supervisionState === "waitingApproval" ||
    supervisionState === "blocked";
  const effectiveSelectedDetailId =
    !showActiveRunCard && selectedDetailId === "active-run" && visibleRuntimeTimelineItems[0]
      ? `timeline:${visibleRuntimeTimelineItems[0].id}`
      : selectedDetailId;
  const isHistoryDetail = effectiveSelectedDetailId === "history";
  const selectedTimelineItem = !isHistoryDetail && effectiveSelectedDetailId.startsWith("timeline:")
    ? runtimeTimelineDisplayItems.find((item) => `timeline:${item.id}` === effectiveSelectedDetailId) ?? null
    : null;
  const selectedOutputCard = effectiveSelectedDetailId.startsWith("output:")
    ? runtimeOutputCards.find((output) => `output:${output.id}` === effectiveSelectedDetailId) ?? null
    : null;
  const activeRunDetailText = activeRunFullDetail || "No run detail available.";
  const selectedRawDetailText = selectedTimelineItem
    ? runtimeItemVisibleText(selectedTimelineItem) ||
      selectedTimelineItem.summary ||
      "Event detail is captured in the runtime timeline."
    : selectedOutputCard
      ? "Output is available from the current managed run."
      : activeRunDetailText;
  const selectedPreviewDetailText = selectedTimelineItem
    ? truncateInline(selectedRawDetailText, 260)
    : selectedOutputCard
      ? selectedRawDetailText
      : activeRuntimeVisibleResult.detail || truncateInline(activeRunDetailText, 260);
  const detailCanExpand =
    !hasPendingApproval &&
    !isHistoryDetail &&
    !selectedOutputCard &&
    compactText(selectedRawDetailText, 1) &&
    selectedRawDetailText.length > selectedPreviewDetailText.length + 12;
  const detailBodyText = detailCanExpand && detailExpanded
    ? selectedRawDetailText
    : selectedPreviewDetailText;
  const detailPanelTitle = selectedTimelineItem
    ? selectedTimelineItem.title || turnItemKindLabel(selectedTimelineItem.kind)
    : selectedOutputCard
      ? selectedOutputCard.title
      : isHistoryDetail
        ? "History"
      : selectedDetailId === "outputs"
        ? "Outputs"
        : activeRunTitle;
  const detailPanelStatus = selectedTimelineItem
    ? runtimeItemStateLabel(selectedTimelineItem)
    : selectedOutputCard
      ? selectedOutputCard.meta
      : isHistoryDetail
        ? `${foldedRuntimeTimelineItems.length} older`
      : activeRunChipLabel;
  const detailPanelSummary = selectedTimelineItem
    ? selectedTimelineItem.title || turnItemKindLabel(selectedTimelineItem.kind)
    : selectedOutputCard
      ? selectedOutputCard.meta
      : isHistoryDetail
        ? "Folded run history"
      : activeRunSummary;
  const detailPanelImpact = selectedTimelineItem
    ? detailBodyText || selectedTimelineItem.summary || selectedTimelineItem.content || "No event detail."
    : selectedOutputCard
      ? "Output is available from the current managed run."
      : isHistoryDetail
        ? foldedRuntimeTimelineItems.length
          ? `Showing ${historyPageStart}-${historyPageEnd} of ${foldedRuntimeTimelineItems.length} older events.`
          : "No folded history for this run."
      : detailBodyText;
  const detailPanelEvidence = selectedTimelineItem
    ? [
        `kind: ${turnItemKindLabel(selectedTimelineItem.kind)}`,
        `state: ${runtimeItemStateLabel(selectedTimelineItem)}`,
        `time: ${formatRuntimeTime(selectedTimelineItem.updatedAt ?? selectedTimelineItem.createdAt)}`,
        ...(detailCanExpand
          ? [`full text: ${detailExpanded ? "expanded" : `folded · ${selectedRawDetailText.length} chars`}`]
          : []),
      ]
    : selectedOutputCard
      ? [
          `output: ${selectedOutputCard.title}`,
          `meta: ${selectedOutputCard.meta}`,
          "Open Outputs from the center panel for artifact-specific actions.",
        ]
      : isHistoryDetail
        ? []
      : [
          `run: ${activeRunTitle}`,
          `state: ${currentRunStateLabel}`,
          `next: ${nextIntentLabel}`,
          ...(detailCanExpand
            ? [`full text: ${detailExpanded ? "expanded" : `folded · ${selectedRawDetailText.length} chars`}`]
            : []),
        ];
  const inspectorTitle = hasPendingApproval
    ? "Checkpoint · direction approval"
    : shouldInspectExternal
      ? "External Codex"
      : hasManagedControl
      ? detailPanelTitle
      : "No checkpoint selected";
  const inspectorStatus = hasPendingApproval
    ? "Needs approval"
    : shouldInspectExternal
      ? "Read-only"
      : hasManagedControl
      ? detailPanelStatus
      : "Idle";
  const inspectorQuestion = hasPendingApproval
    ? "Accept current direction?"
    : shouldInspectExternal
      ? "Review observed external run?"
      : hasManagedControl
      ? detailPanelSummary
      : "Describe the next task target.";
  const inspectorImpact = hasPendingApproval
    ? "Impact: next phase can continue after approval"
    : shouldInspectExternal
      ? "Impact: observe-only, controls disabled"
      : hasManagedControl
      ? detailPanelImpact
      : "Impact: no managed runtime changes until a task is created.";
  const inspectorEvidence = hasPendingApproval
    ? ["Decision pending", "Preview available", "Runtime unchanged"]
    : shouldInspectExternal
      ? inspectedObservedProjection.evidence
      : hasManagedControl
      ? detailPanelEvidence
      : ["No active run", "No pending checkpoint", "Task target missing"];
  const inspectorEyebrow = hasPendingApproval ? "Decision required" : "Detail";
  const inspectorDetailHeading = hasPendingApproval
    ? "Evidence"
    : isHistoryDetail
      ? "Older events"
      : "Selected context";
  const composerPlaceholder = hasManagedControl
    ? supervisionState === "waitingApproval"
      ? "Add approval criteria or ask for changes..."
      : supervisionState === "running"
        ? "Steer the current run..."
        : supervisionState === "blocked"
          ? "Describe what to inspect or recover..."
          : activeSessionWorkspaceId
            ? "Tell Codex what to do in this workspace..."
            : "Tell Codex what to do..."
    : isObservingExternal
      ? "Start a managed task from this context..."
      : "Describe the managed task target...";
  const commandBarTitle = hasManagedControl
    ? supervisionState === "waitingApproval"
      ? "Waiting approval"
      : supervisionState === "running"
        ? "Running"
        : supervisionState === "blocked"
          ? "Blocked"
          : "Codex task"
    : isObservingExternal
      ? "Observing"
      : "Observe-only";
  const commandPrimaryLabel = hasManagedControl
    ? supervisionState === "waitingApproval"
      ? projectionPrimaryActionLabel("approve")
      : projectionPrimaryActionLabel(resolvedManagedIntent)
    : isObservingExternal
      ? "Start run"
      : "Start run";
  const commandPrimaryDisabled = hasManagedControl
    ? supervisionState === "waitingApproval"
      ? !hasPendingApproval
      : supervisionState === "running"
        ? !activeRuntimeTurn && !chatSending
        : supervisionState === "blocked"
          ? !canSend
          : !canSend
    : !canStartManagedRunInput;
  const composerContextButtonLabel = activeSessionWorkspaceId
    ? `Change resource, current: ${activeWorkspace?.name ?? "selected directory"}`
    : "Attach resource";
  const externalAgentsByWorkspaceId = externalProjectionAgents.reduce((groups, agent) => {
    if (!agent.matchedWorkspaceId) {
      return groups;
    }
    return {
      ...groups,
      [agent.matchedWorkspaceId]: [...(groups[agent.matchedWorkspaceId] ?? []), agent],
    };
  }, {});
  const untrackedExternalAgents = externalProjectionAgents.filter((agent) => !agent.matchedWorkspaceId);
  const resourceDisplayCount = workspaces.length + untrackedExternalAgents.length;
  const topbarResourceLabel = soloProjection.externalCount
    ? `${workspaces.length} resources / ${soloProjection.externalCount} external`
    : `${workspaces.length} resources`;
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
  const handleSelectRuntimeDetail = (detailId) => {
    setLastHistoryDetailId("");
    setSelectedDetailId(detailId);
  };
  const handleInspectorApprove = () => {
    if (showPreviewCards && previewProposals[0]) {
      void handleAcceptPreviewCard(previewProposals[0]);
      return;
    }

    if (showDecisionDeck) {
      const option = activeDecisionPreviewOption ?? decisionOptions[0];
      if (option) {
        void handleChooseDecisionOption(option);
        return;
      }
    }

    setNotice({ kind: "info", text: "当前没有可直接批准的预览。" });
  };

  const handleRunCodexTask = async () => {
    if (!draft.trim()) {
      composerInputRef.current?.focus();
      return;
    }

    let targetSessionId = activeSessionId;
    let targetWorkspaceId = activeSessionWorkspaceId;
    let targetSessionMode = activeSessionMode;

    if (!targetSessionId) {
      try {
        let session = await desktop.sessionCreate();
        if (activeWorkspaceId) {
          session = await desktop.workspaceSelect(session.id, activeWorkspaceId);
        }
        setSessions((current) => upsertSession(current, session));
        targetSessionId = session.id;
        targetWorkspaceId = session.workspaceId ?? "";
        targetSessionMode = normalizeSessionMode(session.interactionMode);
        setActiveSessionId(session.id);
        setActiveWorkspaceId(session.workspaceId ?? "");
      } catch (error) {
        setNotice({ kind: "error", text: normalizeError(error) });
        return;
      }
    }

    setSelectedObservedAgentId("");

    if (targetWorkspaceId) {
      if (targetSessionMode !== SESSION_MODE_WORKSPACE) {
        try {
          const updated = await desktop.sessionModeSet(targetSessionId, SESSION_MODE_WORKSPACE);
          setSessions((current) => upsertSession(current, updated));
        } catch (error) {
          setNotice({ kind: "error", text: normalizeError(error) });
          return;
        }
      }
      void handleSend({
        sessionId: targetSessionId,
        interactionMode: SESSION_MODE_WORKSPACE,
        turnIntent: TURN_INTENT_AUTO,
      });
      return;
    }

    void handleSend({
      sessionId: targetSessionId,
      interactionMode: SESSION_MODE_CONVERSATION,
      turnIntent: TURN_INTENT_AUTO,
    });
  };

  const handleCommandPrimaryAction = () => {
    if (!hasManagedControl) {
      void handleRunCodexTask();
      return;
    }
    if (supervisionState === "idle") {
      void handleRunCodexTask();
      return;
    }
    if (supervisionState === "waitingApproval") {
      handleInspectorApprove();
      return;
    }
    if (supervisionState === "blocked") {
      if (draft.trim()) {
        void handleRunCodexTask();
        return;
      }
      setInspectorTab("controls");
      composerInputRef.current?.focus();
      return;
    }
    if (supervisionState === "running") {
      setNotice({ kind: "info", text: "暂停控制还未接入当前运行。" });
    }
  };

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
      <TopStatusBar
        activeWorkspace={activeWorkspace}
        providerNeedsCodexLogin={providerNeedsCodexLogin}
        managedProjection={managedRuntimeProjection}
        observedProjectionCount={soloProjection.externalCount}
        topbarResourceLabel={topbarResourceLabel}
        hasCustomWindowChrome={hasCustomWindowChrome}
        windowMaximized={windowMaximized}
        onOpenSettings={() => {
          setConnectionState({ status: "idle", message: "" });
          setSettingsModalOpen(true);
        }}
        onMinimize={handleWindowMinimize}
        onToggleMaximize={handleWindowToggleMaximize}
        onClose={handleWindowClose}
      />

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
        <WorkstreamRail
          sessions={sessions}
          activeWorkstreamEntries={activeWorkstreamEntries}
          waitingWorkstreamEntries={waitingWorkstreamEntries}
          doneWorkstreamEntries={doneWorkstreamEntries}
          activeSessionId={activeSessionId}
          chatSending={chatSending}
          onCreateSession={handleCreateSession}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          exceptionEntries={exceptionEntries}
          resourceDisplayCount={resourceDisplayCount}
          observedCodexState={observedCodexState}
          workspaces={workspaces}
          externalAgentsByWorkspaceId={externalAgentsByWorkspaceId}
          activeWorkspaceId={activeWorkspaceId}
          activeSessionWorkspaceId={activeSessionWorkspaceId}
	          onSelectWorkspace={handleSelectWorkspace}
	          onRemoveWorkspace={handleRemoveWorkspace}
	          untrackedExternalAgents={untrackedExternalAgents}
	          selectedObservedAgentId={activeObservedAgentId}
	          onInspectExternalAgent={handleInspectExternalAgent}
	          explorerOpen={explorerOpen}
          setExplorerOpen={setExplorerOpen}
          activeWorkspace={activeWorkspace}
          workspaceTreeLoading={workspaceTreeLoading}
          workspaceTree={workspaceTree}
          selectedFilePath={selectedFilePath}
          onOpenFile={handleOpenFile}
          externalProjectionAgents={externalProjectionAgents}
        />

        <section className="chat-pane">
          <RuntimeHeader
            currentTaskTitle={currentTaskTitle}
            runtimeWorkstreamLabel={runtimeWorkstreamLabel}
            currentTaskStateLabel={currentTaskStateLabel}
            runtimePanelTone={runtimePanelTone}
            currentRunStateLabel={currentRunStateLabel}
            nextIntentLabel={nextIntentLabel}
            runtimeOutputCards={runtimeOutputCards}
            outputCountLabel={outputCountLabel}
          />
          <div className="chat-scroll">
            <div className="conversation-stack">
              {!(providerNeedsCodexLogin && !codexAuth.loggedIn) ? (
	                <RuntimeWorkbench
                    showActiveRunCard={showActiveRunCard}
	                  activeRunTitle={activeRunTitle}
	                  activeRunChipLabel={activeRunChipLabel}
	                  runtimePanelTone={runtimePanelTone}
	                  activeRunSummary={activeRunSummary}
	                  activeRunDetail={activeRunDetail}
	                  activeRunSummaryTone={activeRunSummaryTone}
	                  nextIntentLabel={nextIntentLabel}
                  hiddenRuntimeTimelineCount={hiddenRuntimeTimelineCount}
                  visibleRuntimeTimelineItems={visibleRuntimeTimelineItems}
                  runtimePanelState={runtimePanelState}
                  visibleOutputCards={visibleOutputCards}
                  runtimeOutputCards={runtimeOutputCards}
                  outputOverflowCount={outputOverflowCount}
                  selectedDetailId={effectiveSelectedDetailId}
                  onSelectDetail={handleSelectRuntimeDetail}
                  onSelectArtifacts={() => setInspectorTab("artifacts")}
                />
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

	            <CommandBar
	              commandBarTitle={commandBarTitle}
	              canControl={hasManagedControl}
	              canUseCommandInput={canUseCommandInput}
            commandActionCards={commandActionCards}
            activeSessionWorkspaceId={activeSessionWorkspaceId}
            activeWorkspace={activeWorkspace}
            onOpenWorkspaceModal={() => setWorkspaceModalOpen(true)}
            onDetachWorkspace={handleDetachWorkspace}
            composerInputRef={composerInputRef}
            draft={draft}
            setDraft={setDraft}
            loginBlocked={loginBlocked}
            chatSending={chatSending}
            hasStreamingAssistant={hasStreamingAssistant}
            onComposerKeyDown={handleComposerKeyDown}
            composerPlaceholder={composerPlaceholder}
            composerHint={composerHint}
            commandPrimaryDisabled={commandPrimaryDisabled}
            commandPrimaryLabel={commandPrimaryLabel}
            supervisionState={supervisionState}
            onPrimaryAction={handleCommandPrimaryAction}
            composerContextButtonLabel={composerContextButtonLabel}
          />
        </section>

        <InspectorPanel
          inspectorEyebrow={inspectorEyebrow}
          inspectorTitle={inspectorTitle}
          runtimePanelStatus={runtimePanelStatus}
          inspectorStatus={inspectorStatus}
          inspectorQuestion={inspectorQuestion}
          inspectorImpact={inspectorImpact}
          hasPendingApproval={hasPendingApproval}
          isHistoryDetail={isHistoryDetail}
          historyItems={historyPageItems}
          historyPageLabel={
            foldedRuntimeTimelineItems.length
              ? `${historyPageStart}-${historyPageEnd} / ${foldedRuntimeTimelineItems.length}`
              : "empty"
          }
          historyCanShowNewer={safeHistoryPageIndex > 0}
          historyCanShowOlder={historyPageEnd < foldedRuntimeTimelineItems.length}
          detailCanExpand={Boolean(detailCanExpand)}
          detailExpanded={detailExpanded}
          onToggleDetailExpanded={() => setDetailExpanded((expanded) => !expanded)}
          inspectorDetailHeading={inspectorDetailHeading}
          inspectorEvidence={inspectorEvidence}
          canControl={hasManagedControl}
          onApprove={handleInspectorApprove}
          onRevise={() => composerInputRef.current?.focus()}
          onEvidence={() => setInspectorTab("trace")}
          canReturnToHistory={Boolean(lastHistoryDetailId && effectiveSelectedDetailId === lastHistoryDetailId)}
          onSelectHistoryItem={(item) => {
            const detailId = `timeline:${item.id}`;
            setLastHistoryDetailId(detailId);
            setSelectedDetailId(detailId);
          }}
          onBackToLatest={() => {
            setLastHistoryDetailId("");
            setSelectedDetailId(visibleRuntimeTimelineItems[0] ? `timeline:${visibleRuntimeTimelineItems[0].id}` : "active-run");
          }}
          onBackToHistory={() => setSelectedDetailId("history")}
          onHistoryNewer={() => setHistoryPageIndex((page) => Math.max(0, page - 1))}
          onHistoryOlder={() =>
            setHistoryPageIndex((page) => Math.min(historyPageCount - 1, page + 1))
          }
        />
      </main>

      <WorkspaceModal
        open={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        onSubmit={handleAddWorkspace}
      />
    </div>
  );
}
