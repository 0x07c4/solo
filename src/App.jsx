import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "./api/desktop";
import { WorkspaceModal } from "./components/WorkspaceModal";
import "./App.css";

const LOGIN_POLL_ATTEMPTS = 15;
const LOGIN_POLL_INTERVAL_MS = 2000;
const DEFAULT_THEME = "tokyonight";
const MAX_STREAM_PROGRESS_ITEMS = 12;
const STREAM_NO_TOKEN_WARN_S = 12;
const STREAM_STALL_WARN_S = 25;
const THEME_OPTIONS = [
  { value: "tokyonight", label: "TokyoNight" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { value: "gruvbox-dark", label: "Gruvbox Dark" },
  { value: "nord", label: "Nord" },
  { value: "one-dark", label: "One Dark" },
  { value: "dracula", label: "Dracula" },
  { value: "kanagawa", label: "Kanagawa" },
];

const SUPPORTED_THEMES = new Set(THEME_OPTIONS.map((theme) => theme.value));

function normalizeTheme(theme) {
  if (typeof theme !== "string") {
    return DEFAULT_THEME;
  }
  const normalized = theme.trim().toLowerCase();
  return SUPPORTED_THEMES.has(normalized) ? normalized : DEFAULT_THEME;
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
      message: method ? `已登录 ChatGPT（${method}）。` : "已登录 ChatGPT。",
    };
  }

  return {
    ...status,
    message: "未登录 ChatGPT。点击下方按钮继续登录。",
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

function messageStatusLabel(status) {
  if (status === "streaming") {
    return "生成中";
  }
  if (status === "error") {
    return "失败";
  }
  return "已完成";
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
          {hasChildren ? <span className="tree-node-meta">{node.children.length}</span> : null}
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

  const extension = node.name.includes(".") ? node.name.split(".").at(-1) : "";
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
      {extension ? <span className="tree-node-meta">{extension.slice(0, 4)}</span> : null}
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
          {progress.map((entry) => (
            <div key={entry.id} className={`message-progress-item level-${entry.level}`}>
              <span className="message-progress-dot" aria-hidden="true" />
              <span className="message-progress-stage">{entry.stage}</span>
              <span className="message-progress-detail">{entry.detail}</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
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
  const [chatSending, setChatSending] = useState(false);
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const [streamProgressBySession, setStreamProgressBySession] = useState({});
  const [streamMonitorBySession, setStreamMonitorBySession] = useState({});
  const [draft, setDraft] = useState("");
  const [theme, setTheme] = useState(DEFAULT_THEME);

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
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [windowMaximized, setWindowMaximized] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId]
  );
  const activeSessionWorkspaceId = activeSession?.workspaceId ?? "";
  const layoutMode = activeSessionWorkspaceId ? "workbench" : "chat";
  const hasCustomWindowChrome =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const fetchCodexStatus = async ({ showNotice = false } = {}) => {
    const status = normalizeLoginStatus(await desktop.codexLoginStatus());
    if (mountedRef.current) {
      setCodexAuth(status);
    }
    if (showNotice) {
      setNotice({
        kind: status.loggedIn ? "success" : "info",
        text: status.message,
      });
    }
    return status;
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

        const normalizedTheme = normalizeTheme(loadedSettings?.theme);
        const settingsPatch = {};
        if (loadedSettings.provider !== "codex_cli") {
          settingsPatch.provider = "codex_cli";
        }
        if (loadedSettings.theme !== normalizedTheme) {
          settingsPatch.theme = normalizedTheme;
        }
        if (Object.keys(settingsPatch).length > 0) {
          try {
            await desktop.settingsUpdate(settingsPatch);
          } catch {
            // Non-fatal: UI can continue with local fallback state.
          }
        }

        if (cancelled) {
          return;
        }

        setTheme(normalizedTheme);
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
    let unlistenStatus = null;
    let unlistenToken = null;
    let unlistenDone = null;

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
        if (payload.sessionId === activeSessionIdRef.current) {
          setChatSending(false);
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
        elapsedMs >= STREAM_NO_TOKEN_WARN_S * 1000
      ) {
        updates.warnedNoToken = true;
        syntheticEntries.push({
          stage: "监控",
          detail: `已收到内部状态，但 ${STREAM_NO_TOKEN_WARN_S}s 仍无正文输出。`,
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

      if (!monitor.warnedStall && idleMs >= STREAM_STALL_WARN_S * 1000) {
        updates.warnedStall = true;
        syntheticEntries.push({
          stage: "监控",
          detail: `${STREAM_STALL_WARN_S}s 无新进展，可能卡住。可重试。`,
          level: "error",
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
  }, [chatSending, activeSessionId]);

  const resetPreview = () => {
    setSelectedFilePath("");
    setFilePreview(null);
    setPreviewState({ loading: false, error: "" });
  };

  const handleCodexLogin = async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    setCodexChecking(true);
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
            text: "登录状态已更新：已登录 ChatGPT。",
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

  const handleSend = async () => {
    if (!activeSessionId) {
      return;
    }
    const input = draft.trim();
    if (!input || chatSending || codexChecking || !codexAuth.loggedIn) {
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
    try {
      const updatedSession = await desktop.chatSend(activeSessionId, input, []);
      setSessions((current) => upsertSession(current, updatedSession));
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
    setNotice({ kind: "success", text: `已添加工作区：${workspace.name}` });
  };

  const handleRemoveWorkspace = async (workspaceId) => {
    try {
      await desktop.workspaceRemove(workspaceId);
      const nextWorkspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);
      setWorkspaces(nextWorkspaces);
      setActiveWorkspaceId((current) => (current === workspaceId ? "" : current));
      resetPreview();
      const reloadedSessions = await desktop.sessionsList();
      setSessions(sortSessions(reloadedSessions));
      setNotice({ kind: "info", text: "工作区已移除。" });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleSelectWorkspace = async (workspaceId) => {
    setActiveWorkspaceId(workspaceId);
    resetPreview();
    if (!activeSessionId) {
      return;
    }
    try {
      const updated = await desktop.workspaceSelect(activeSessionId, workspaceId);
      setSessions((current) => upsertSession(current, updated));
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleDetachWorkspace = async () => {
    if (!activeSessionId) {
      setActiveWorkspaceId("");
      resetPreview();
      return;
    }

    try {
      const updated = await desktop.workspaceSelect(activeSessionId, null);
      setSessions((current) => upsertSession(current, updated));
      setActiveWorkspaceId("");
      resetPreview();
      setNotice({ kind: "info", text: "当前会话已切换为纯对话模式。" });
    } catch (error) {
      setNotice({ kind: "error", text: normalizeError(error) });
    }
  };

  const handleOpenFile = async (relativePath) => {
    if (!activeWorkspace) {
      return;
    }

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

  const handleComposerKeyDown = (event) => {
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
    } catch (error) {
      setNotice({ kind: "error", text: `主题保存失败：${normalizeError(error)}` });
    }
  };

  const canSend = Boolean(activeSessionId && draft.trim() && codexAuth.loggedIn && !codexChecking && !chatSending);
  const hasStreamingAssistant = Boolean(
    activeSession?.messages?.some(
      (message) => message.role === "assistant" && message.status === "streaming"
    )
  );
  const showPendingAssistant = Boolean(
    chatSending && codexAuth.loggedIn && activeSessionId && !hasStreamingAssistant
  );
  const activeStreamInfo = activeSessionId ? streamProgressBySession[activeSessionId] ?? null : null;
  const activeStreamMessageId = activeStreamInfo?.messageId ?? "";
  const activeStreamProgress = activeStreamInfo?.items ?? [];
  const pendingAssistantText =
    pendingSeconds >= 20
      ? `正在生成回复…（${pendingSeconds}s，网络可能较慢）`
      : pendingSeconds >= 3
        ? `正在生成回复…（${pendingSeconds}s）`
        : "正在生成回复…";
  const composerHint = !codexAuth.loggedIn
    ? "先登录 ChatGPT 才能发送。"
    : "Enter 发送，Shift+Enter 换行。";
  const workspaceStatusText = activeSessionWorkspaceId
    ? activeWorkspace?.name ?? "已挂载"
    : "纯对话";
  const modeLabel = layoutMode === "workbench" ? "Workbench" : "Chat";
  const topbarContextLabel = activeWorkspace?.name ?? "chat";

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
            <div className="topbar-trail" aria-label="current context">
              <span className="topbar-app">solo</span>
              <span className="topbar-separator">/</span>
              <span className="topbar-context">{topbarContextLabel}</span>
            </div>
            <h1>{activeSession?.title ?? "新会话"}</h1>
          </div>
        </div>
        <div className="topbar-status">
          <div className="status-pill">
            <span className="status-pill-label">ChatGPT</span>
            <strong className="status-pill-value">
              {!codexAuth.available
                ? "不可用"
                : codexAuth.loggedIn
                  ? "已登录"
                  : "未登录"}
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
            <span className="status-pill-label">工作区</span>
            <strong className="status-pill-value status-pill-code">{workspaceStatusText}</strong>
          </div>
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
                <button
                  key={session.id}
                  type="button"
                  className={`session-card ${session.id === activeSessionId ? "is-active" : ""}`}
                  onClick={() => handleSelectSession(session.id)}
                  aria-label={`打开会话 ${session.title}`}
                >
                  <div className="session-row">
                    <span className="session-title">{session.title}</span>
                    <span className="list-badge">{session.messages?.length ?? 0}</span>
                  </div>
                  <span className="session-meta">
                    {session.workspaceId ? "工作区会话" : "纯对话会话"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-block panel-workspaces">
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Workspaces</p>
                <div className="section-title-row">
                  <h2>工作区</h2>
                  <span className="section-count">{workspaces.length}</span>
                </div>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setWorkspaceModalOpen(true)}
              >
                添加
              </button>
            </div>
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
                        <span className="list-badge list-badge-accent">active</span>
                      ) : null}
                    </div>
                    <span className="workspace-path">{workspace.path}</span>
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
          </section>

          <section className="panel-block panel-explorer is-grow">
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Explorer</p>
                <div className="section-title-row">
                  <h2>文件树</h2>
                  {activeWorkspace ? (
                    <span className="section-count section-count-workspace">{activeWorkspace.name}</span>
                  ) : null}
                </div>
              </div>
            </div>
            {activeWorkspace ? (
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
                  <p>当前工作区暂无可显示的文件树。</p>
                </div>
              )
            ) : (
              <div className="empty-state compact">
                <p>先添加一个工作区。</p>
              </div>
            )}
          </section>
        </aside>

        <section className="chat-pane">
          <div className="chat-head">
            <div className="chat-head-main">
              <p className="section-eyebrow">Conversation</p>
              <h2>{activeSession?.title ?? "新会话"}</h2>
              <p className="chat-subtitle">
                {layoutMode === "workbench"
                  ? `已挂载工作区 ${activeWorkspace?.name ?? "workspace"}`
                  : "当前为纯对话模式"}
              </p>
            </div>
            <div className="compact-row">
              {layoutMode === "workbench" ? (
                <button type="button" className="ghost-button" onClick={handleDetachWorkspace}>
                  纯对话
                </button>
              ) : null}
              <button type="button" className="ghost-button" onClick={handleCreateSession}>
                新会话
              </button>
              {!codexAuth.loggedIn ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={codexChecking}
                  onClick={handleCodexLogin}
                >
                  {codexChecking ? "登录中…" : "登录"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="chat-scroll">
            {!codexAuth.loggedIn ? (
              <div className="preview-card shell-card hero-card">
                <p className="section-eyebrow">ChatGPT</p>
                <h2>登录 ChatGPT</h2>
                <p>{codexAuth.message}</p>
                <div className="compact-row">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={codexChecking}
                    onClick={handleCodexLogin}
                  >
                    {codexChecking ? "登录中…" : "登录 ChatGPT"}
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
              </>
            ) : (
              <div className="empty-state hero">
                <p className="section-eyebrow">Chat</p>
                <h2>直接在应用里对话。</h2>
                <p>
                  {layoutMode === "workbench"
                    ? "你已经登录 ChatGPT，现在可以直接提问，也可以让 Solo 结合当前工作区继续分析。"
                    : "你已经登录 ChatGPT，现在可以直接提问；需要代码上下文时再挂载工作区。"}
                </p>
              </div>
            )}
          </div>

          <div className="composer">
            <textarea
              className="composer-input"
              value={draft}
              disabled={!codexAuth.loggedIn || codexChecking || chatSending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="描述你要做的事，或者让 Solo 分析当前工作区。"
            />
            <div className="composer-actions">
              <p className="composer-hint">{composerHint}</p>
              <div className="composer-button-row">
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
        </section>

        <aside className="inspector">
          <div className="section-header">
            <div>
              <p className="section-eyebrow">Workbench</p>
              <h2>上下文面板</h2>
            </div>
          </div>

          <div className="inspector-scroll">
            <div className="info-card">
              <span className="section-eyebrow">Workspace</span>
              <strong>{activeWorkspace?.name ?? "未选择"}</strong>
              <p>{activeWorkspace?.path ?? "添加工作区后，这里会显示当前目录。"}</p>
            </div>

            <div className="info-card">
              <span className="section-eyebrow">Session</span>
              <strong>{activeSession?.title ?? "暂无会话"}</strong>
              <p>{activeSession ? `${activeSession.messages?.length ?? 0} 条消息` : "请先创建会话。"}</p>
            </div>

            <div className="preview-card">
              <div className="preview-header">
                <div>
                  <span className="section-eyebrow">Preview</span>
                  <strong>{selectedFilePath || "暂无文件"}</strong>
                </div>
              </div>
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
                    <p className="preview-note">
                      该文件较大，当前只显示前 12000 个字符预览。
                    </p>
                  ) : null}
                </>
              ) : (
                <pre>从左侧文件树点开文件后，这里会显示内容。</pre>
              )}
            </div>
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
