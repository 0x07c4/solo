use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model_id: String,
    pub theme: String,
    pub confirm_writes: bool,
    pub confirm_commands: bool,
    pub codex_proxy_mode: String,
    pub codex_http_proxy: String,
    pub codex_https_proxy: String,
    pub codex_all_proxy: String,
    pub codex_no_proxy: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: "codex_cli".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model_id: String::new(),
            theme: "tokyonight".to_string(),
            confirm_writes: true,
            confirm_commands: true,
            codex_proxy_mode: "inherit".to_string(),
            codex_http_proxy: String::new(),
            codex_https_proxy: String::new(),
            codex_all_proxy: String::new(),
            codex_no_proxy: String::new(),
        }
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model_id: Option<String>,
    pub theme: Option<String>,
    pub confirm_writes: Option<bool>,
    pub confirm_commands: Option<bool>,
    pub codex_proxy_mode: Option<String>,
    pub codex_http_proxy: Option<String>,
    pub codex_https_proxy: Option<String>,
    pub codex_all_proxy: Option<String>,
    pub codex_no_proxy: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachment {
    pub relative_path: String,
    pub label: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    pub status: String,
    pub attachments: Vec<MessageAttachment>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SessionInteractionMode {
    #[default]
    Conversation,
    WorkspaceCollaboration,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TurnIntent {
    #[default]
    Auto,
    Choice,
    Preview,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub interaction_mode: SessionInteractionMode,
    pub workspace_id: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub pending_approvals: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub last_opened_at: i64,
    pub recent_files: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub children: Vec<FileTreeNode>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadResult {
    pub relative_path: String,
    pub content: String,
    pub hash: String,
    pub size_bytes: usize,
    pub is_truncated: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub success: bool,
    pub model_id: String,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLoginStatus {
    pub available: bool,
    pub logged_in: bool,
    pub method: String,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualImportResult {
    pub session: ChatSession,
    pub proposals: Vec<ToolProposal>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolProposal {
    pub id: String,
    pub session_id: String,
    pub kind: String,
    pub title: String,
    pub summary: String,
    pub created_at: i64,
    pub status: String,
    pub payload: ToolProposalPayload,
    pub latest_output: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ToolProposalPayload {
    Write {
        workspace_id: String,
        relative_path: String,
        base_hash: String,
        diff_text: String,
        next_content_preview: String,
    },
    Command {
        workspace_id: String,
        cwd: String,
        argv: Vec<String>,
        display_command: String,
        reason: String,
    },
    Choice {
        workspace_id: String,
        option_key: String,
        detail: String,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamTokenEvent {
    pub session_id: String,
    pub message_id: String,
    pub delta: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamStatusEvent {
    pub session_id: String,
    pub message_id: String,
    pub stage: String,
    pub detail: String,
    pub level: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamDoneEvent {
    pub session_id: String,
    pub session_title: String,
    pub message_id: String,
    pub content: String,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutputEvent {
    pub proposal_id: String,
    pub chunk: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandFinishedEvent {
    pub proposal_id: String,
    pub exit_code: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalChooseResult {
    pub session: ChatSession,
    pub proposal: ToolProposal,
}
