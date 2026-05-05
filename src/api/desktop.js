import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const desktop = {
  listen,
  openChatGptInBrowser: () => invoke("open_chatgpt_in_browser"),
  codexLoginStatus: () => invoke("codex_login_status"),
  codexLoginStart: () => invoke("codex_login_start"),
  runningAgents: () => invoke("running_agents"),
  settingsGet: () => invoke("settings_get"),
  settingsUpdate: (payload) => invoke("settings_update", { update: payload }),
  settingsTestConnection: (settings) => invoke("settings_test_connection", { settings }),
  sessionsList: () => invoke("sessions_list"),
  sessionCreate: () => invoke("session_create"),
  sessionOpen: (sessionId) => invoke("session_open", { sessionId }),
  sessionRuntimeSnapshot: (sessionId) => invoke("session_runtime_snapshot", { sessionId }),
  sessionDelete: (sessionId) => invoke("session_delete", { sessionId }),
  sessionModeSet: (sessionId, interactionMode) =>
    invoke("session_mode_set", { sessionId, interactionMode }),
  workspacesList: () => invoke("workspaces_list"),
  workspaceAdd: (path) => invoke("workspace_add", { path }),
  workspaceRemove: (workspaceId) => invoke("workspace_remove", { workspaceId }),
  workspaceSelect: (sessionId, workspaceId) =>
    invoke("workspace_select", { sessionId, workspaceId }),
  workspaceTree: (workspaceId, maxDepth = 4) =>
    invoke("workspace_tree", { workspaceId, maxDepth }),
  workspaceReadFile: (workspaceId, relativePath) =>
    invoke("workspace_read_file", { workspaceId, relativePath }),
  chatSend: (sessionId, input, attachmentPaths, interactionMode, turnIntent) =>
    invoke("chat_send", { sessionId, input, attachmentPaths, interactionMode, turnIntent }),
  manualImportAssistantReply: (sessionId, content) =>
    invoke("manual_import_assistant_reply", { sessionId, content }),
  approvalList: (sessionId = null) => invoke("approval_list", { sessionId }),
  proposalChoose: (proposalId) => invoke("proposal_choose", { proposalId }),
  approvalAccept: (proposalId) => invoke("approval_accept", { proposalId }),
  approvalReject: (proposalId) => invoke("approval_reject", { proposalId }),
};
