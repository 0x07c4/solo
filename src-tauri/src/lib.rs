mod models;
mod openai;
mod storage;

use crate::models::{
    ChatMessage, ChatSession, ChatStreamDoneEvent, ChatStreamStatusEvent, ChatStreamTokenEvent,
    CodexLoginStatus, CommandFinishedEvent, CommandOutputEvent, ConnectionTestResult,
    ManualImportResult, MessageAttachment, ProposalChooseResult, SessionInteractionMode, Settings,
    SettingsUpdate, ToolProposal, ToolProposalPayload, TurnIntent, Workspace,
};
use crate::openai::{chat_completion, test_connection, CompletionMessage};
use crate::storage::{
    apply_write_proposal, build_workspace_tree, canonicalize_workspace, diff_text, make_id,
    now_millis, preview_file_result, read_workspace_file, read_workspace_ignore_patterns,
    resolve_workspace_file, update_recent_files, SharedState,
};
use serde::Deserialize;
use std::{
    fs,
    io::{BufRead, BufReader},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};

#[derive(Clone, Copy, PartialEq, Eq)]
enum TurnExecutionMode {
    QuickChat,
    Agent,
}

impl From<SessionInteractionMode> for TurnExecutionMode {
    fn from(value: SessionInteractionMode) -> Self {
        match value {
            SessionInteractionMode::Conversation => TurnExecutionMode::QuickChat,
            SessionInteractionMode::WorkspaceCollaboration => TurnExecutionMode::Agent,
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = SharedState::new(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_chatgpt_in_browser,
            codex_login_status,
            codex_login_start,
            settings_get,
            settings_update,
            settings_test_connection,
            sessions_list,
            session_create,
            session_open,
            session_mode_set,
            workspaces_list,
            workspace_add,
            workspace_remove,
            workspace_select,
            workspace_tree,
            workspace_read_file,
            chat_send,
            manual_import_assistant_reply,
            approval_list,
            proposal_choose,
            approval_accept,
            approval_reject
        ])
        .run(tauri::generate_context!())
        .expect("error while running solo");
}

#[tauri::command]
fn open_chatgpt_in_browser() -> Result<bool, String> {
    let url = "https://chatgpt.com/";
    let candidates = [("xdg-open", vec![url]), ("gio", vec!["open", url])];

    let mut last_error = String::new();
    for (command, args) in candidates {
        match Command::new(command).args(args).spawn() {
            Ok(_) => return Ok(true),
            Err(err) => last_error = format!("{command}: {err}"),
        }
    }

    Err(format!("无法打开默认浏览器：{last_error}"))
}

#[tauri::command]
fn codex_login_status() -> Result<CodexLoginStatus, String> {
    let command_output = Command::new("codex").args(["login", "status"]).output();

    match command_output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let mut lines = stdout
                .lines()
                .chain(stderr.lines())
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .filter(|line| !line.starts_with("WARNING:"))
                .filter(|line| !line.starts_with("Warning:"))
                .map(str::to_string)
                .collect::<Vec<_>>();

            if lines.is_empty() {
                lines.push("未检测到登录信息。".to_string());
            }

            let login_line = lines
                .iter()
                .find(|line| line.starts_with("Logged in using"))
                .cloned();

            let (logged_in, method, message) = if let Some(login_line) = login_line {
                let method = login_line
                    .trim_start_matches("Logged in using")
                    .trim()
                    .to_string();
                (true, method, login_line)
            } else {
                let fallback = lines
                    .last()
                    .cloned()
                    .unwrap_or_else(|| "Codex 未登录。".to_string());
                (false, String::new(), fallback)
            };

            Ok(CodexLoginStatus {
                available: true,
                logged_in,
                method,
                message,
            })
        }
        Err(err) => {
            let auth_snapshot = read_codex_auth_snapshot();
            if let Some((logged_in, method, message)) = auth_snapshot {
                return Ok(CodexLoginStatus {
                    available: true,
                    logged_in,
                    method,
                    message,
                });
            }

            Ok(CodexLoginStatus {
                available: false,
                logged_in: false,
                method: String::new(),
                message: format!("未检测到 Codex CLI：{err}"),
            })
        }
    }
}

#[tauri::command]
fn codex_login_start() -> Result<bool, String> {
    Command::new("codex")
        .arg("login")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("启动 Codex 登录失败：{err}"))?;
    Ok(true)
}

#[tauri::command]
fn settings_get(state: State<'_, SharedState>) -> Result<Settings, String> {
    Ok(state.read(|store| store.settings.clone()))
}

#[tauri::command]
fn settings_update(
    update: SettingsUpdate,
    state: State<'_, SharedState>,
) -> Result<Settings, String> {
    state.update(|store| {
        if let Some(value) = update.provider {
            store.settings.provider = value.trim().to_string();
        }
        if let Some(value) = update.base_url {
            store.settings.base_url = value.trim().trim_end_matches('/').to_string();
        }
        if let Some(value) = update.api_key {
            store.settings.api_key = value.trim().to_string();
        }
        if let Some(value) = update.model_id {
            store.settings.model_id = value.trim().to_string();
        }
        if let Some(value) = update.theme {
            store.settings.theme = value;
        }
        if let Some(value) = update.confirm_writes {
            store.settings.confirm_writes = value;
        }
        if let Some(value) = update.confirm_commands {
            store.settings.confirm_commands = value;
        }
        store.save_settings()?;
        Ok(store.settings.clone())
    })
}

#[tauri::command]
async fn settings_test_connection(
    settings: Settings,
    state: State<'_, SharedState>,
) -> Result<ConnectionTestResult, String> {
    let normalized = normalize_settings(settings);
    if normalized.provider == "codex_cli" {
        let status = codex_login_status()?;
        if status.logged_in {
            return Ok(ConnectionTestResult {
                success: true,
                model_id: "codex_cli".to_string(),
                message: "已检测到 ChatGPT 登录态，可直接在应用内对话。".to_string(),
            });
        }
        return Err("未检测到 ChatGPT 登录态，请先登录。".to_string());
    }
    if normalized.provider == "manual" {
        return Ok(ConnectionTestResult {
            success: true,
            model_id: "manual".to_string(),
            message: "当前为手动协作模式，无需测试 API 连接。".to_string(),
        });
    }
    validate_model_settings(&normalized)?;
    test_connection(&state.client(), &normalized).await
}

#[tauri::command]
fn sessions_list(state: State<'_, SharedState>) -> Result<Vec<ChatSession>, String> {
    Ok(state.read(|store| store.sorted_sessions()))
}

#[tauri::command]
fn session_create(state: State<'_, SharedState>) -> Result<ChatSession, String> {
    state.update(|store| {
        let timestamp = now_millis();
        let session = ChatSession {
            id: make_id("session"),
            title: "新会话".to_string(),
            created_at: timestamp,
            updated_at: timestamp,
            interaction_mode: SessionInteractionMode::Conversation,
            workspace_id: None,
            messages: Vec::new(),
            pending_approvals: Vec::new(),
        };
        store.sessions.push(session.clone());
        store.save_sessions()?;
        Ok(session)
    })
}

#[tauri::command]
fn session_open(session_id: String, state: State<'_, SharedState>) -> Result<ChatSession, String> {
    state
        .read(|store| {
            store
                .sessions
                .iter()
                .find(|session| session.id == session_id)
                .cloned()
        })
        .ok_or_else(|| "session not found".to_string())
}

#[tauri::command]
fn session_mode_set(
    session_id: String,
    interaction_mode: SessionInteractionMode,
    state: State<'_, SharedState>,
) -> Result<ChatSession, String> {
    state.update(|store| {
        let session = store
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
            .ok_or_else(|| "session not found".to_string())?;
        if interaction_mode == SessionInteractionMode::WorkspaceCollaboration
            && session.workspace_id.is_none()
        {
            return Err("请先为当前会话挂载工作区，再进入工作区协作。".to_string());
        }
        session.interaction_mode = interaction_mode;
        session.updated_at = now_millis();
        let cloned = session.clone();
        store.save_sessions()?;
        Ok(cloned)
    })
}

#[tauri::command]
fn workspaces_list(state: State<'_, SharedState>) -> Result<Vec<Workspace>, String> {
    Ok(state.read(|store| store.sorted_workspaces()))
}

#[tauri::command]
fn workspace_add(path: String, state: State<'_, SharedState>) -> Result<Workspace, String> {
    let canonical = canonicalize_workspace(&path)?;
    state.update(|store| {
        let canonical_str = canonical.to_string_lossy().to_string();
        if let Some(existing) = store
            .workspaces
            .iter()
            .find(|workspace| workspace.path == canonical_str)
        {
            return Err(format!("工作区已存在：{}", existing.path));
        }

        let timestamp = now_millis();
        let workspace = Workspace {
            id: make_id("workspace"),
            name: canonical
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("workspace")
                .to_string(),
            path: canonical_str,
            created_at: timestamp,
            last_opened_at: timestamp,
            recent_files: Vec::new(),
        };
        store.workspaces.push(workspace.clone());
        store.save_workspaces()?;
        Ok(workspace)
    })
}

#[tauri::command]
fn workspace_remove(workspace_id: String, state: State<'_, SharedState>) -> Result<bool, String> {
    state.update(|store| {
        store
            .workspaces
            .retain(|workspace| workspace.id != workspace_id);
        for session in &mut store.sessions {
            if session.workspace_id.as_deref() == Some(workspace_id.as_str()) {
                session.workspace_id = None;
                session.interaction_mode = SessionInteractionMode::Conversation;
            }
        }
        for proposal in &mut store.proposals {
            let matches_workspace = match &proposal.payload {
                ToolProposalPayload::Write {
                    workspace_id: value,
                    ..
                } => value == &workspace_id,
                ToolProposalPayload::Command {
                    workspace_id: value,
                    ..
                } => value == &workspace_id,
                ToolProposalPayload::Choice {
                    workspace_id: value,
                    ..
                } => value == &workspace_id,
            };
            if matches_workspace && proposal.status == "pending" {
                proposal.status = "rejected".to_string();
                proposal.error = Some("workspace removed".to_string());
            }
        }
        store.save_workspaces()?;
        store.save_sessions()?;
        store.save_proposals()?;
        Ok(true)
    })
}

#[tauri::command]
fn workspace_select(
    session_id: String,
    workspace_id: Option<String>,
    state: State<'_, SharedState>,
) -> Result<ChatSession, String> {
    state.update(|store| {
        let next_workspace_id = workspace_id.clone();
        if let Some(workspace_id) = workspace_id {
            let workspace = store
                .workspaces
                .iter_mut()
                .find(|workspace| workspace.id == workspace_id)
                .ok_or_else(|| "workspace not found".to_string())?;
            workspace.last_opened_at = now_millis();
        }

        let session = store
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
            .ok_or_else(|| "session not found".to_string())?;
        session.workspace_id = next_workspace_id;
        if session.workspace_id.is_none() {
            session.interaction_mode = SessionInteractionMode::Conversation;
        }
        session.updated_at = now_millis();
        let cloned = session.clone();
        store.save_sessions()?;
        store.save_workspaces()?;
        Ok(cloned)
    })
}

#[tauri::command]
fn workspace_tree(
    workspace_id: String,
    max_depth: Option<u8>,
    state: State<'_, SharedState>,
) -> Result<crate::models::FileTreeNode, String> {
    let workspace = state
        .read(|store| {
            store
                .workspaces
                .iter()
                .find(|workspace| workspace.id == workspace_id)
                .cloned()
        })
        .ok_or_else(|| "workspace not found".to_string())?;
    build_workspace_tree(&workspace, max_depth.unwrap_or(4))
}

#[tauri::command]
fn workspace_read_file(
    workspace_id: String,
    relative_path: String,
    state: State<'_, SharedState>,
) -> Result<crate::models::FileReadResult, String> {
    state.update(|store| {
        let workspace = store
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;
        let result = preview_file_result(read_workspace_file(workspace, &relative_path)?, 12_000);
        update_recent_files(workspace, &relative_path);
        store.save_workspaces()?;
        Ok(result)
    })
}

#[tauri::command]
async fn chat_send(
    session_id: String,
    input: String,
    attachment_paths: Option<Vec<String>>,
    interaction_mode: SessionInteractionMode,
    turn_intent: Option<TurnIntent>,
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
) -> Result<ChatSession, String> {
    let state_handle = state.inner().clone();
    let attachments = attachment_paths.unwrap_or_default();

    let provider = state_handle.read(|store| store.settings.provider.clone());
    let effective_provider = if provider == "openai" {
        match codex_login_status() {
            Ok(status) if status.logged_in => "codex_cli".to_string(),
            _ => "openai".to_string(),
        }
    } else {
        provider.clone()
    };

    let (session, latest_user_message_id) = state_handle.update(|store| {
        if effective_provider == "openai" {
            validate_model_settings(&store.settings)?;
        }

        let session_index = store
            .sessions
            .iter_mut()
            .position(|session| session.id == session_id)
            .ok_or_else(|| "session not found".to_string())?;

        if interaction_mode == SessionInteractionMode::WorkspaceCollaboration
            && store.sessions[session_index].workspace_id.is_none()
        {
            return Err("请先为当前会话挂载工作区，再进入工作区协作。".to_string());
        }

        let archived_proposal_ids = store
            .proposals
            .iter_mut()
            .filter(|proposal| {
                proposal.session_id == session_id
                    && matches!(proposal.status.as_str(), "pending" | "selected")
            })
            .map(|proposal| {
                proposal.status = "rejected".to_string();
                proposal.error = None;
                proposal.latest_output = Some("当前会话已开始新一轮协作。".to_string());
                proposal.id.clone()
            })
            .collect::<Vec<_>>();

        let session = &mut store.sessions[session_index];
        if session.title == "新会话" && !input.trim().is_empty() {
            session.title = derive_session_title(&input);
        }
        session.interaction_mode = interaction_mode.clone();
        if !archived_proposal_ids.is_empty() {
            session.pending_approvals.retain(|proposal_id| {
                !archived_proposal_ids
                    .iter()
                    .any(|entry| entry == proposal_id)
            });
        }

        let message_id = make_id("message");
        let attachment_refs = attachments
            .iter()
            .map(|path| MessageAttachment {
                relative_path: path.clone(),
                label: path.clone(),
            })
            .collect::<Vec<_>>();

        let latest_user_message_id = if let Some(existing_message_id) =
            reuse_retry_user_message(session, &input, &attachment_refs)
        {
            existing_message_id
        } else {
            session.messages.push(ChatMessage {
                id: message_id.clone(),
                role: "user".to_string(),
                content: input.clone(),
                timestamp: now_millis(),
                status: "done".to_string(),
                attachments: attachment_refs,
            });
            message_id
        };
        session.updated_at = now_millis();
        let cloned = session.clone();
        if !archived_proposal_ids.is_empty() {
            store.save_proposals()?;
        }
        store.save_sessions()?;
        Ok((cloned, latest_user_message_id))
    })?;

    if effective_provider == "manual" {
        return Ok(session);
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let execution_mode = TurnExecutionMode::from(interaction_mode);
        let turn_intent = turn_intent.unwrap_or_default();
        if let Err(err) = process_chat_turn(
            app_handle.clone(),
            state_handle.clone(),
            session_id.clone(),
            latest_user_message_id,
            input.clone(),
            attachments,
            effective_provider,
            execution_mode,
            turn_intent,
            None,
        )
        .await
        {
            let assistant_message_id = make_id("message");
            let _ = persist_assistant_message(
                &state_handle,
                &session_id,
                &assistant_message_id,
                &format!("请求失败：{err}"),
                "error",
            );
            let _ = app_handle.emit(
                "chat-stream-done",
                ChatStreamDoneEvent {
                    session_id: session_id.clone(),
                    session_title: state_handle.read(|store| {
                        store
                            .sessions
                            .iter()
                            .find(|session| session.id == session_id)
                            .map(|session| session.title.clone())
                            .unwrap_or_else(|| "新会话".to_string())
                    }),
                    message_id: assistant_message_id,
                    content: format!("请求失败：{err}"),
                    status: "error".to_string(),
                },
            );
        }
    });

    Ok(session)
}

#[tauri::command]
fn manual_import_assistant_reply(
    session_id: String,
    content: String,
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
) -> Result<ManualImportResult, String> {
    let state_handle = state.inner().clone();
    let imported = state_handle.update(|store| {
        let workspace = current_session_workspace(store, &session_id)?;
        let parsed_blocks = parse_manual_reply_blocks(&content)?;

        if !parsed_blocks.is_empty() && workspace.is_none() {
            return Err("当前会话未绑定工作区，无法从外部回复生成文件或命令提案。".to_string());
        }

        let mut created = Vec::new();
        for block in parsed_blocks {
            let workspace = workspace
                .as_ref()
                .ok_or_else(|| "当前会话未绑定工作区。".to_string())?;
            let proposal = create_manual_proposal(store, &session_id, workspace, block)?;
            created.push(proposal);
        }

        let proposal_ids = created
            .iter()
            .map(|proposal| proposal.id.clone())
            .collect::<Vec<_>>();
        let session = store
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
            .ok_or_else(|| "session not found".to_string())?;

        let message_id = make_id("message");
        session.messages.push(ChatMessage {
            id: message_id,
            role: "assistant".to_string(),
            content: content.clone(),
            timestamp: now_millis(),
            status: "done".to_string(),
            attachments: Vec::new(),
        });
        session.pending_approvals.extend(proposal_ids);
        session.updated_at = now_millis();

        let cloned_session = session.clone();
        store.save_sessions()?;
        store.save_proposals()?;
        Ok(ManualImportResult {
            session: cloned_session,
            proposals: created,
        })
    })?;

    for proposal in &imported.proposals {
        let _ = app.emit("tool-proposal-created", proposal);
    }

    Ok(imported)
}

#[tauri::command]
fn approval_list(
    session_id: Option<String>,
    state: State<'_, SharedState>,
) -> Result<Vec<ToolProposal>, String> {
    Ok(state.read(|store| store.sorted_proposals(session_id.as_deref())))
}

#[tauri::command]
async fn proposal_choose(
    proposal_id: String,
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
) -> Result<ProposalChooseResult, String> {
    let state_handle = state.inner().clone();
    let provider = state_handle.read(|store| store.settings.provider.clone());
    let effective_provider = if provider == "openai" {
        match codex_login_status() {
            Ok(status) if status.logged_in => "codex_cli".to_string(),
            _ => "openai".to_string(),
        }
    } else {
        provider.clone()
    };

    let (session, proposal, latest_user_message_id, followup_input) =
        state_handle.update(|store| {
            let proposal = store
                .proposals
                .iter_mut()
                .find(|proposal| proposal.id == proposal_id)
                .ok_or_else(|| "proposal not found".to_string())?;

            let ToolProposalPayload::Choice {
                workspace_id,
                option_key,
                detail,
            } = &proposal.payload
            else {
                return Err("只有方向建议支持展开预览。".to_string());
            };

            if proposal.status != "pending" {
                return Err(format!(
                    "该提案当前状态为 `{}`，不能继续展开。",
                    proposal.status
                ));
            }

            let session = store
                .sessions
                .iter_mut()
                .find(|session| session.id == proposal.session_id)
                .ok_or_else(|| "session not found".to_string())?;

            if session.workspace_id.as_deref() != Some(workspace_id.as_str()) {
                return Err("当前方向建议绑定的工作区已变化，请重新生成建议。".to_string());
            }

            proposal.status = "selected".to_string();
            proposal.error = None;
            proposal.latest_output = Some("已选择这个方向，正在展开具体预览。".to_string());
            session
                .pending_approvals
                .retain(|entry| entry != &proposal_id);
            session.interaction_mode = SessionInteractionMode::WorkspaceCollaboration;

            let message_id = make_id("message");
            let user_content = format!("已选择方向 {}，展开具体预览。", option_key);
            session.messages.push(ChatMessage {
                id: message_id.clone(),
                role: "user".to_string(),
                content: user_content,
                timestamp: now_millis(),
                status: "done".to_string(),
                attachments: Vec::new(),
            });
            session.updated_at = now_millis();

            let followup_input = build_choice_followup_input(option_key, detail);
            let cloned_session = session.clone();
            let cloned_proposal = proposal.clone();
            store.save_proposals()?;
            store.save_sessions()?;
            Ok((cloned_session, cloned_proposal, message_id, followup_input))
        })?;

    let _ = app.emit("approval-updated", &proposal);

    if effective_provider != "manual" {
        let app_handle = app.clone();
        let session_id = session.id.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = process_chat_turn(
                app_handle.clone(),
                state_handle.clone(),
                session_id.clone(),
                latest_user_message_id,
                followup_input.clone(),
                Vec::new(),
                effective_provider,
                TurnExecutionMode::Agent,
                TurnIntent::Preview,
                Some(followup_input),
            )
            .await
            {
                let assistant_message_id = make_id("message");
                let _ = persist_assistant_message(
                    &state_handle,
                    &session_id,
                    &assistant_message_id,
                    &format!("请求失败：{err}"),
                    "error",
                );
                let _ = app_handle.emit(
                    "chat-stream-done",
                    ChatStreamDoneEvent {
                        session_id: session_id.clone(),
                        session_title: state_handle.read(|store| {
                            store
                                .sessions
                                .iter()
                                .find(|session| session.id == session_id)
                                .map(|session| session.title.clone())
                                .unwrap_or_else(|| "新会话".to_string())
                        }),
                        message_id: assistant_message_id,
                        content: format!("请求失败：{err}"),
                        status: "error".to_string(),
                    },
                );
            }
        });
    }

    Ok(ProposalChooseResult { session, proposal })
}

#[tauri::command]
fn approval_accept(
    proposal_id: String,
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
) -> Result<ToolProposal, String> {
    let state_handle = state.inner().clone();
    let proposal = state_handle.read(|store| {
        store
            .proposals
            .iter()
            .find(|proposal| proposal.id == proposal_id)
            .cloned()
    });
    let proposal = proposal.ok_or_else(|| "proposal not found".to_string())?;

    match &proposal.payload {
        ToolProposalPayload::Write { workspace_id, .. } => {
            let applied = state_handle.update(|store| {
                let proposal = store
                    .proposals
                    .iter()
                    .find(|proposal| proposal.id == proposal_id)
                    .ok_or_else(|| "proposal not found".to_string())?;
                if proposal.status != "pending" {
                    return Err(format!(
                        "该提案当前状态为 `{}`，不能再次应用。",
                        proposal.status
                    ));
                }
                let workspace = store
                    .workspaces
                    .iter_mut()
                    .find(|workspace| workspace.id == *workspace_id)
                    .ok_or_else(|| "workspace not found".to_string())?;
                let proposal = store
                    .proposals
                    .iter_mut()
                    .find(|proposal| proposal.id == proposal_id)
                    .ok_or_else(|| "proposal not found".to_string())?;
                let (relative_path, _) = apply_write_proposal(workspace, proposal)?;
                update_recent_files(workspace, &relative_path);
                proposal.status = "applied".to_string();
                proposal.error = None;
                proposal.latest_output = Some(format!("Applied changes to {relative_path}"));
                if let Some(session) = store
                    .sessions
                    .iter_mut()
                    .find(|session| session.id == proposal.session_id)
                {
                    session
                        .pending_approvals
                        .retain(|entry| entry != &proposal_id);
                    session.updated_at = now_millis();
                }
                let cloned = proposal.clone();
                store.save_workspaces()?;
                store.save_proposals()?;
                store.save_sessions()?;
                Ok(cloned)
            })?;
            let _ = app.emit("approval-updated", &applied);
            let _ = app.emit(
                "workspace-updated",
                serde_json::json!({ "kind": "writeApplied", "proposalId": applied.id }),
            );
            Ok(applied)
        }
        ToolProposalPayload::Command { .. } => {
            let approved = state_handle.update(|store| {
                let proposal = store
                    .proposals
                    .iter_mut()
                    .find(|proposal| proposal.id == proposal_id)
                    .ok_or_else(|| "proposal not found".to_string())?;
                if proposal.status != "pending" {
                    return Err(format!(
                        "该提案当前状态为 `{}`，不能再次执行。",
                        proposal.status
                    ));
                }
                proposal.status = "approved".to_string();
                proposal.error = None;
                proposal.latest_output = Some("等待执行…".to_string());
                if let Some(session) = store
                    .sessions
                    .iter_mut()
                    .find(|session| session.id == proposal.session_id)
                {
                    session
                        .pending_approvals
                        .retain(|entry| entry != &proposal_id);
                    session.updated_at = now_millis();
                }
                let cloned = proposal.clone();
                store.save_proposals()?;
                store.save_sessions()?;
                Ok(cloned)
            })?;
            let _ = app.emit("approval-updated", &approved);
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = run_command_proposal(
                    app_handle.clone(),
                    state_handle.clone(),
                    proposal_id.clone(),
                )
                .await
                {
                    let _ = mark_proposal_failed(&state_handle, &proposal_id, &err);
                    let _ = app_handle.emit(
                        "command-finished",
                        CommandFinishedEvent {
                            proposal_id,
                            exit_code: -1,
                        },
                    );
                }
            });
            Ok(approved)
        }
        ToolProposalPayload::Choice { .. } => {
            let accepted = state_handle.update(|store| {
                let proposal = store
                    .proposals
                    .iter_mut()
                    .find(|proposal| proposal.id == proposal_id)
                    .ok_or_else(|| "proposal not found".to_string())?;
                if proposal.status != "pending" {
                    return Err(format!(
                        "该提案当前状态为 `{}`，不能再次采纳。",
                        proposal.status
                    ));
                }
                proposal.status = "applied".to_string();
                proposal.error = None;
                proposal.latest_output = Some("已采纳这个方向。".to_string());
                if let Some(session) = store
                    .sessions
                    .iter_mut()
                    .find(|session| session.id == proposal.session_id)
                {
                    session
                        .pending_approvals
                        .retain(|entry| entry != &proposal_id);
                    session.updated_at = now_millis();
                }
                let cloned = proposal.clone();
                store.save_proposals()?;
                store.save_sessions()?;
                Ok(cloned)
            })?;
            let _ = app.emit("approval-updated", &accepted);
            Ok(accepted)
        }
    }
}

#[tauri::command]
fn approval_reject(
    proposal_id: String,
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
) -> Result<ToolProposal, String> {
    let proposal = state.inner().clone().update(|store| {
        let proposal = store
            .proposals
            .iter_mut()
            .find(|proposal| proposal.id == proposal_id)
            .ok_or_else(|| "proposal not found".to_string())?;
        if proposal.status != "pending" {
            return Err(format!(
                "该提案当前状态为 `{}`，不能拒绝。",
                proposal.status
            ));
        }
        proposal.status = "rejected".to_string();
        proposal.error = None;
        if let Some(session) = store
            .sessions
            .iter_mut()
            .find(|session| session.id == proposal.session_id)
        {
            session
                .pending_approvals
                .retain(|entry| entry != &proposal_id);
            session.updated_at = now_millis();
        }
        let cloned = proposal.clone();
        store.save_proposals()?;
        store.save_sessions()?;
        Ok(cloned)
    })?;
    let _ = app.emit("approval-updated", &proposal);
    Ok(proposal)
}

async fn process_chat_turn(
    app: tauri::AppHandle,
    state: SharedState,
    session_id: String,
    latest_user_message_id: String,
    latest_user_input: String,
    attachment_paths: Vec<String>,
    effective_provider: String,
    execution_mode: TurnExecutionMode,
    turn_intent: TurnIntent,
    model_input_override: Option<String>,
) -> Result<(), String> {
    let snapshot = state.read(|store| {
        let settings = store.settings.clone();
        let session = store
            .sessions
            .iter()
            .find(|session| session.id == session_id)
            .cloned();
        let workspace = if execution_mode == TurnExecutionMode::Agent {
            session.as_ref().and_then(|session| {
                session
                    .workspace_id
                    .as_ref()
                    .and_then(|workspace_id| {
                        store
                            .workspaces
                            .iter()
                            .find(|workspace| &workspace.id == workspace_id)
                    })
                    .cloned()
            })
        } else {
            None
        };
        (settings, session, workspace)
    });
    let (mut settings, session, workspace) = snapshot;
    settings.provider = effective_provider;
    let session = session.ok_or_else(|| "session not found".to_string())?;
    let workspace_ignore_patterns = workspace
        .as_ref()
        .map(read_workspace_ignore_patterns)
        .unwrap_or_default();

    let attachment_blobs = attachment_paths
        .iter()
        .map(|relative_path| {
            let workspace = workspace
                .as_ref()
                .ok_or_else(|| "attachments require an active workspace".to_string())?;
            let file = read_workspace_file(workspace, relative_path)?;
            Ok((relative_path.clone(), file.content))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let system_prompt = if settings.provider == "codex_cli" {
        match execution_mode {
            TurnExecutionMode::QuickChat => {
                "You are ChatGPT. Reply naturally and directly. \
                 Treat this as a normal conversation turn, not a coding task. \
                 A workspace may be attached to the session, but it is out of scope for this turn. \
                 Do not inspect files, infer repository details, or silently switch into workspace-aware help. \
                 Do not introduce yourself unless asked. \
                 Do not mention internal model names unless the user explicitly asks."
                    .to_string()
            }
            TurnExecutionMode::Agent => {
                "You are ChatGPT in workspace-collaboration mode. \
                 The current turn explicitly uses the attached workspace as context. \
                 Be direct, concrete, and task-focused. \
                 Inspect relevant files first and reference the files you actually looked at. \
                 Do not give generic placeholder templates when workspace-specific analysis is expected. \
                 Use the available workspace context when needed, but keep the human in control: frame file changes or command execution as suggestions or previews unless they are explicitly confirmed."
                    .to_string()
            }
        }
    } else {
        build_system_prompt(workspace.as_ref())
    };
    let mut messages = vec![CompletionMessage::system(system_prompt)];
    for message in &session.messages {
        let mut content = message.content.clone();
        if message.role == "user" && message.id == latest_user_message_id {
            if let Some(override_input) = model_input_override.as_ref() {
                content = override_input.clone();
            }
            content = build_augmented_user_message(&content, &attachment_blobs);
        }
        match message.role.as_str() {
            "user" => messages.push(CompletionMessage::user(content)),
            "assistant" => messages.push(CompletionMessage::assistant(Some(content), None)),
            _ => {}
        }
    }

    let assistant_message_id = make_id("message");
    let (mut visible_reply, reply_streamed_live) = if settings.provider == "codex_cli" {
        run_codex_chat_turn_streaming(
            app.clone(),
            session_id.clone(),
            assistant_message_id.clone(),
            &latest_user_input,
            execution_mode,
            turn_intent.clone(),
            &messages,
            workspace.as_ref(),
            &workspace_ignore_patterns,
        )
        .await?
    } else {
        let mut reply = String::new();
        for _ in 0..6 {
            let assistant = chat_completion(&state.client(), &settings, &messages).await?;
            if let Some(content) = assistant.content.clone() {
                if !content.trim().is_empty() {
                    if !reply.is_empty() {
                        reply.push_str("\n\n");
                    }
                    reply.push_str(content.trim());
                }
            }

            if let Some(tool_calls) = assistant.tool_calls.clone() {
                messages.push(CompletionMessage::assistant(
                    assistant.content.clone(),
                    Some(tool_calls.clone()),
                ));
                for tool_call in tool_calls {
                    let tool_result = handle_tool_call(
                        &app,
                        &state,
                        &session_id,
                        workspace.as_ref(),
                        &settings,
                        &tool_call,
                    )
                    .await;
                    messages.push(CompletionMessage::tool(tool_call.id.clone(), tool_result));
                }
                continue;
            }

            break;
        }
        (reply, false)
    };

    let mut generated_proposals = Vec::new();
    if settings.provider == "codex_cli" {
        let raw_reply = visible_reply.clone();
        visible_reply = strip_manual_reply_blocks(&raw_reply).trim().to_string();

        if let Some(active_workspace) = workspace.as_ref() {
            let parsed_blocks = parse_manual_reply_blocks(&raw_reply).unwrap_or_default();
            let parsed_choice_blocks = parsed_blocks
                .iter()
                .filter_map(|block| {
                    matches!(block, ManualReplyBlock::Choice { .. }).then_some(block.clone())
                })
                .collect::<Vec<_>>();
            let choice_blocks = if !parsed_choice_blocks.is_empty() {
                parsed_choice_blocks
            } else {
                parse_reply_choice_blocks(&visible_reply)
            };
            let proposal_blocks = if execution_mode == TurnExecutionMode::Agent
                && turn_intent == TurnIntent::Choice
            {
                choice_blocks
            } else if parsed_blocks.is_empty() {
                choice_blocks
            } else {
                parsed_blocks
            };
            if !proposal_blocks.is_empty() {
                generated_proposals = state.update(|store| {
                    let created = create_reply_proposals(
                        store,
                        &session_id,
                        active_workspace,
                        proposal_blocks,
                    )?;
                    if !created.is_empty() {
                        store.save_sessions()?;
                        store.save_proposals()?;
                    }
                    Ok(created)
                })?;

                for proposal in &generated_proposals {
                    let _ = app.emit("tool-proposal-created", proposal);
                }
            }
        }
    }

    if !generated_proposals.is_empty() {
        visible_reply = build_proposal_focused_reply(&visible_reply, &generated_proposals);
    }

    if visible_reply.trim().is_empty() {
        visible_reply = if generated_proposals.is_empty() {
            "我已经整理出当前请求的建议；如果涉及改动项目或运行命令，会先给出预览并等待你确认。"
                .to_string()
        } else {
            format!(
                "我整理了 {} 条建议，已经放到主区卡片里，等你确认。",
                generated_proposals.len()
            )
        };
    }

    if !reply_streamed_live {
        emit_streamed_reply(&app, &session_id, &assistant_message_id, &visible_reply).await;
    }
    let session_title = persist_assistant_message(
        &state,
        &session_id,
        &assistant_message_id,
        &visible_reply,
        "done",
    )?;
    app.emit(
        "chat-stream-done",
        ChatStreamDoneEvent {
            session_id,
            session_title,
            message_id: assistant_message_id,
            content: visible_reply,
            status: "done".to_string(),
        },
    )
    .map_err(|err| format!("emit chat completion failed: {err}"))?;

    Ok(())
}

fn build_proposal_focused_reply(reply: &str, proposals: &[ToolProposal]) -> String {
    let count = proposals.len();
    let title_summary = proposals
        .iter()
        .take(2)
        .map(|proposal| proposal.title.as_str())
        .collect::<Vec<_>>()
        .join("、");
    let conclusion = first_meaningful_reply_line(reply);
    let all_choices = proposals.iter().all(|proposal| proposal.kind == "choice");

    match conclusion {
        Some(line) if all_choices && !title_summary.is_empty() => {
            format!("我整理了 {count} 个可选方向，先看下方方向卡：{title_summary}。\n结论：{line}")
        }
        Some(line) if all_choices => {
            format!("我整理了 {count} 个可选方向，先看下方方向卡。\n结论：{line}")
        }
        Some(line) if !title_summary.is_empty() => format!(
            "我把这个方向整理成 {count} 张预览卡，直接看下方：{title_summary}。\n结论：{line}"
        ),
        Some(line) => format!("我把这个方向整理成 {count} 张预览卡，直接看下方。\n结论：{line}"),
        None if !title_summary.is_empty() => {
            if all_choices {
                format!("我整理了 {count} 个可选方向，先看下方方向卡：{title_summary}。")
            } else {
                format!("我把这个方向整理成 {count} 张预览卡，直接看下方：{title_summary}。")
            }
        }
        None => {
            if all_choices {
                format!("我整理了 {count} 个可选方向，先看下方方向卡。")
            } else {
                format!("我把这个方向整理成 {count} 张预览卡，直接看下方。")
            }
        }
    }
}

fn first_meaningful_reply_line(reply: &str) -> Option<String> {
    reply
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with("```"))
        .filter(|line| !line.starts_with('#'))
        .map(|line| summarize_status_text(line, 120))
        .find(|line| !line.is_empty())
}

async fn run_codex_chat_turn_streaming(
    app: tauri::AppHandle,
    session_id: String,
    message_id: String,
    latest_user_input: &str,
    execution_mode: TurnExecutionMode,
    turn_intent: TurnIntent,
    messages: &[CompletionMessage],
    workspace: Option<&Workspace>,
    workspace_ignore_patterns: &[String],
) -> Result<(String, bool), String> {
    let status = codex_login_status()?;
    if !status.logged_in {
        return Err("未登录 ChatGPT，请先点击“登录 ChatGPT”。".to_string());
    }

    let prompt = build_codex_exec_prompt(
        messages,
        execution_mode,
        turn_intent,
        workspace_ignore_patterns,
    );
    let workspace_path = workspace.map(|entry| entry.path.clone());
    let latest_user_input = latest_user_input.to_string();
    let workspace_ignore_patterns = workspace_ignore_patterns.to_vec();

    tauri::async_runtime::spawn_blocking(move || {
        let output_file =
            std::env::temp_dir().join(format!("solo-codex-reply-{}.txt", now_millis()));
        let (max_total_timeout, idle_timeout, no_text_warn_1, no_text_warn_2) =
            if execution_mode == TurnExecutionMode::QuickChat {
                (
                    Duration::from_secs(180),
                    Duration::from_secs(75),
                    Duration::from_secs(15),
                    Duration::from_secs(45),
                )
            } else {
                (
                    Duration::from_secs(600),
                    Duration::from_secs(240),
                    Duration::from_secs(30),
                    Duration::from_secs(90),
                )
            };
        emit_chat_stream_status(
            &app,
            &session_id,
            &message_id,
            "准备",
            if execution_mode == TurnExecutionMode::QuickChat {
                "进入快速对话模式…"
            } else {
                "进入工作区协作模式…"
            },
            "info",
        );

        let mut command = Command::new("codex");
        command
            .arg("exec")
            .arg("--skip-git-repo-check")
            .arg("--sandbox")
            .arg("read-only")
            .arg("--json")
            .arg("--output-last-message")
            .arg(&output_file)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(path) = workspace_path.as_deref() {
            command.arg("--cd").arg(path);
            let workspace_name = Path::new(path)
                .file_name()
                .and_then(|entry| entry.to_str())
                .unwrap_or(path);
            emit_chat_stream_status(
                &app,
                &session_id,
                &message_id,
                "工作区",
                &format!("使用工作区：{workspace_name}"),
                "info",
            );
            if !workspace_ignore_patterns.is_empty() {
                emit_chat_stream_status(
                    &app,
                    &session_id,
                    &message_id,
                    "工作区",
                    &format!(
                        "已应用 .ignore，默认跳过 {}",
                        summarize_ignore_patterns(&workspace_ignore_patterns, 3)
                    ),
                    "info",
                );
            }
        }

        if execution_mode == TurnExecutionMode::QuickChat {
            emit_chat_stream_status(
                &app,
                &session_id,
                &message_id,
                "快答",
                &format!(
                    "本轮只做直接回复，不读取工作区：{}",
                    summarize_status_text(&latest_user_input, 48)
                ),
                "info",
            );
        }

        command.arg(&prompt);
        let mut child = command
            .spawn()
            .map_err(|err| format!("启动 Codex 对话失败：{err}"))?;
        emit_chat_stream_status(
            &app,
            &session_id,
            &message_id,
            "连接",
            "已连接模型，开始接收中间过程…",
            "info",
        );

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法捕获 Codex stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "无法捕获 Codex stderr".to_string())?;

        let streamed_reply = Arc::new(Mutex::new(String::new()));
        let streamed_reply_stdout = Arc::clone(&streamed_reply);
        let last_activity_at = Arc::new(Mutex::new(Instant::now()));
        let last_activity_stdout = Arc::clone(&last_activity_at);
        let last_activity_stderr = Arc::clone(&last_activity_at);
        let app_stdout = app.clone();
        let app_status = app.clone();
        let session_for_stdout = session_id.clone();
        let message_for_stdout = message_id.clone();
        let session_for_status = session_id.clone();
        let message_for_status = message_id.clone();
        let stdout_handle = std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let mut last_status = String::new();
            for raw_line in reader.lines().map_while(Result::ok) {
                if let Ok(mut timestamp) = last_activity_stdout.lock() {
                    *timestamp = Instant::now();
                }
                if let Some((stage, detail, level)) = extract_codex_status_from_json_line(&raw_line)
                {
                    let key = format!("{stage}|{detail}|{level}");
                    if key != last_status {
                        last_status = key;
                        let _ = app_status.emit(
                            "chat-stream-status",
                            ChatStreamStatusEvent {
                                session_id: session_for_status.clone(),
                                message_id: message_for_status.clone(),
                                stage,
                                detail,
                                level,
                            },
                        );
                    }
                }
                if let Some(delta) = extract_codex_delta_from_json_line(&raw_line) {
                    if let Ok(mut content) = streamed_reply_stdout.lock() {
                        content.push_str(&delta);
                    }
                    let _ = app_stdout.emit(
                        "chat-stream-token",
                        ChatStreamTokenEvent {
                            session_id: session_for_stdout.clone(),
                            message_id: message_for_stdout.clone(),
                            delta,
                        },
                    );
                }
            }
        });

        let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let stderr_lines_capture = Arc::clone(&stderr_lines);
        let reconnect_exhausted = Arc::new(AtomicBool::new(false));
        let reconnect_exhausted_stderr = Arc::clone(&reconnect_exhausted);
        let app_stderr = app.clone();
        let session_for_stderr = session_id.clone();
        let message_for_stderr = message_id.clone();
        let stderr_handle = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            let mut last_status = String::new();
            for raw_line in reader.lines().map_while(Result::ok) {
                let trimmed = raw_line.trim();
                if trimmed.is_empty()
                    || trimmed.starts_with("WARNING:")
                    || trimmed.starts_with("Warning:")
                {
                    continue;
                }
                if let Ok(mut timestamp) = last_activity_stderr.lock() {
                    *timestamp = Instant::now();
                }
                if let Ok(mut lines) = stderr_lines_capture.lock() {
                    lines.push(trimmed.to_string());
                }
                let (stage, detail, level, terminal) = classify_codex_cli_stderr(trimmed)
                    .unwrap_or_else(|| {
                        let level = if trimmed.to_ascii_lowercase().contains("error") {
                            "error".to_string()
                        } else {
                            "warn".to_string()
                        };
                        (
                            "CLI".to_string(),
                            summarize_status_text(trimmed, 96),
                            level,
                            false,
                        )
                    });
                if terminal {
                    reconnect_exhausted_stderr.store(true, Ordering::Relaxed);
                }
                let key = format!("{stage}|{detail}|{level}");
                if key == last_status {
                    continue;
                }
                last_status = key;
                let _ = app_stderr.emit(
                    "chat-stream-status",
                    ChatStreamStatusEvent {
                        session_id: session_for_stderr.clone(),
                        message_id: message_for_stderr.clone(),
                        stage,
                        detail,
                        level,
                    },
                );
            }
        });

        let started_at = Instant::now();
        let mut warned_no_text_20s = false;
        let mut warned_no_text_60s = false;
        let mut warned_near_timeout = false;
        let mut warned_idle = false;
        let exit_status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    let elapsed = started_at.elapsed();
                    let idle_elapsed = last_activity_at
                        .lock()
                        .map(|timestamp| timestamp.elapsed())
                        .unwrap_or_default();
                    let no_stream_text = streamed_reply
                        .lock()
                        .map(|text| text.trim().is_empty())
                        .unwrap_or(true);
                    if reconnect_exhausted.load(Ordering::Relaxed) {
                        emit_chat_stream_status(
                            &app,
                            &session_id,
                            &message_id,
                            "失败",
                            "Codex CLI 重连失败，本轮请求已终止。",
                            "error",
                        );
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = fs::remove_file(&output_file);
                        return Err("Codex CLI 重连失败，请重试。".to_string());
                    }
                    if no_stream_text && !warned_no_text_20s && elapsed >= no_text_warn_1 {
                        warned_no_text_20s = true;
                        emit_chat_stream_status(
                            &app,
                            &session_id,
                            &message_id,
                            "监控",
                            &format!(
                                "{} 秒仍未收到正文输出，模型可能还在整理结果。",
                                no_text_warn_1.as_secs()
                            ),
                            "warn",
                        );
                    }
                    if no_stream_text && !warned_no_text_60s && elapsed >= no_text_warn_2 {
                        warned_no_text_60s = true;
                        emit_chat_stream_status(
                            &app,
                            &session_id,
                            &message_id,
                            "监控",
                            &format!("{} 秒仍无正文输出，继续等待中。", no_text_warn_2.as_secs()),
                            "warn",
                        );
                    }
                    if !warned_idle && idle_elapsed >= idle_timeout / 2 {
                        warned_idle = true;
                        emit_chat_stream_status(
                            &app,
                            &session_id,
                            &message_id,
                            "监控",
                            &format!(
                                "已经 {} 秒没有新进展，仍在等待模型完成。",
                                idle_elapsed.as_secs()
                            ),
                            "warn",
                        );
                    }
                    if !warned_near_timeout
                        && elapsed
                            >= max_total_timeout
                                .checked_sub(Duration::from_secs(60))
                                .unwrap_or(max_total_timeout)
                    {
                        warned_near_timeout = true;
                        emit_chat_stream_status(
                            &app,
                            &session_id,
                            &message_id,
                            "监控",
                            &format!("请求接近超时阈值（{} 秒）。", max_total_timeout.as_secs()),
                            "warn",
                        );
                    }
                    if idle_elapsed >= idle_timeout {
                        emit_chat_stream_status(
                            &app,
                            &session_id,
                            &message_id,
                            "超时",
                            &format!(
                                "{} 秒没有任何新进展，终止本轮请求。",
                                idle_timeout.as_secs()
                            ),
                            "error",
                        );
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = fs::remove_file(&output_file);
                        return Err(format!(
                            "请求超时：{} 秒没有任何新进展，请重试。",
                            idle_timeout.as_secs()
                        ));
                    }
                    if started_at.elapsed() >= max_total_timeout {
                        emit_chat_stream_status(
                            &app,
                            &session_id,
                            &message_id,
                            "超时",
                            &format!("{} 秒内未收到模型完成信号。", max_total_timeout.as_secs()),
                            "error",
                        );
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = fs::remove_file(&output_file);
                        return Err(format!(
                            "请求超时：{} 秒内未收到模型完成信号，请重试。",
                            max_total_timeout.as_secs()
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(err) => return Err(format!("等待 Codex 返回失败：{err}")),
            }
        };
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        let stderr_output = stderr_lines
            .lock()
            .map(|lines| lines.join("\n"))
            .unwrap_or_default();

        if !exit_status.success() {
            let mut error = if stderr_output.is_empty() {
                format!(
                    "Codex 执行失败，退出码 {}",
                    exit_status.code().unwrap_or(-1)
                )
            } else {
                stderr_output
            };
            if error.contains("Please run `codex login`") || error.contains("logged in") {
                error = "未登录 ChatGPT，请先点击“登录 ChatGPT”。".to_string();
            }
            emit_chat_stream_status(
                &app,
                &session_id,
                &message_id,
                "失败",
                &summarize_status_text(&error, 120),
                "error",
            );
            let _ = fs::remove_file(&output_file);
            return Err(error);
        }

        let content = fs::read_to_string(&output_file).unwrap_or_default();
        let _ = fs::remove_file(&output_file);
        let file_reply = content.trim().to_string();
        if !file_reply.is_empty() {
            let has_streamed_delta = !streamed_reply
                .lock()
                .map(|text| text.trim().is_empty())
                .unwrap_or(true);
            emit_chat_stream_status(
                &app,
                &session_id,
                &message_id,
                "完成",
                "回复生成完成。",
                "success",
            );
            return Ok((file_reply, has_streamed_delta));
        }

        let streamed = streamed_reply
            .lock()
            .map(|text| text.trim().to_string())
            .unwrap_or_default();
        if !streamed.is_empty() {
            emit_chat_stream_status(
                &app,
                &session_id,
                &message_id,
                "完成",
                "回复生成完成。",
                "success",
            );
            return Ok((streamed, true));
        }

        emit_chat_stream_status(
            &app,
            &session_id,
            &message_id,
            "失败",
            "模型没有返回可显示内容。",
            "error",
        );
        Err("Codex 没有返回可显示的回复，请重试。".to_string())
    })
    .await
    .map_err(|err| format!("Codex 对话任务失败：{err}"))?
}

fn emit_chat_stream_status(
    app: &tauri::AppHandle,
    session_id: &str,
    message_id: &str,
    stage: &str,
    detail: &str,
    level: &str,
) {
    let compact_detail = summarize_status_text(detail, 120);
    if compact_detail.is_empty() {
        return;
    }
    let _ = app.emit(
        "chat-stream-status",
        ChatStreamStatusEvent {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            stage: stage.to_string(),
            detail: compact_detail,
            level: level.to_string(),
        },
    );
}

fn extract_codex_status_from_json_line(line: &str) -> Option<(String, String, String)> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    let event_type = value
        .get("type")
        .and_then(|entry| entry.as_str())
        .unwrap_or_default()
        .trim();
    if event_type.is_empty() {
        return None;
    }

    let lower = event_type.to_ascii_lowercase();
    if lower.contains("delta") || lower.contains("usage") || lower.contains("token") {
        return None;
    }

    if let Some(item_status) = extract_codex_item_status(event_type, &value) {
        return Some(item_status);
    }

    let (stage, level) = map_codex_event_stage(event_type);
    let detail = value
        .get("message")
        .and_then(json_value_to_string)
        .or_else(|| value.get("summary").and_then(json_value_to_string))
        .or_else(|| value.get("status").and_then(json_value_to_string))
        .or_else(|| value.get("text").and_then(json_value_to_string))
        .or_else(|| value.get("detail").and_then(json_value_to_string))
        .or_else(|| value.get("name").and_then(json_value_to_string))
        .or_else(|| value.get("title").and_then(json_value_to_string))
        .or_else(|| value.get("event").and_then(extract_status_text))
        .or_else(|| value.get("data").and_then(extract_status_text))
        .unwrap_or_else(|| humanize_codex_event_type(event_type));
    let compact_detail = summarize_status_text(&detail, 96);
    if is_noisy_codex_status(event_type, &compact_detail) {
        return None;
    }
    if compact_detail.is_empty() {
        return None;
    }
    Some((stage.to_string(), compact_detail, level.to_string()))
}

fn map_codex_event_stage(event_type: &str) -> (&'static str, &'static str) {
    let lower = event_type.to_ascii_lowercase();
    if lower.contains("error") || lower.contains("failed") || lower.contains("fail") {
        ("异常", "error")
    } else if lower.contains("tool") || lower.contains("command") {
        ("执行工具", "info")
    } else if lower.contains("reason") || lower.contains("think") {
        ("思考", "info")
    } else if lower.contains("response") || lower.contains("message") || lower.contains("output") {
        ("生成回复", "info")
    } else if lower.contains("complete")
        || lower.contains("finished")
        || lower.contains("finish")
        || lower.contains("done")
    {
        ("完成", "success")
    } else if lower.contains("start") || lower.contains("init") || lower.contains("create") {
        ("准备", "info")
    } else {
        ("处理中", "info")
    }
}

fn extract_status_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(entry) => {
            if entry.trim().is_empty() {
                None
            } else {
                Some(entry.to_string())
            }
        }
        serde_json::Value::Object(map) => {
            for key in [
                "message", "summary", "status", "text", "detail", "name", "title",
            ] {
                if let Some(text) = map.get(key).and_then(json_value_to_string) {
                    return Some(text);
                }
            }
            map.values().find_map(extract_status_text)
        }
        serde_json::Value::Array(items) => items.iter().find_map(extract_status_text),
        _ => None,
    }
}

fn humanize_codex_event_type(event_type: &str) -> String {
    let text = event_type
        .replace(['.', '_', '-'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        "处理中".to_string()
    } else {
        text
    }
}

fn is_noisy_codex_status(event_type: &str, detail: &str) -> bool {
    let event = event_type.trim().to_ascii_lowercase();
    let text = detail.trim().to_ascii_lowercase();

    if text.is_empty() {
        return true;
    }

    let is_generic_item_event = event == "item.started"
        || event == "item.completed"
        || event == "item.updated"
        || event == "item.created"
        || event.ends_with("item.started")
        || event.ends_with("item.completed")
        || event.ends_with("item.updated")
        || event.ends_with("item.created");

    if is_generic_item_event {
        return text == "item started"
            || text == "item completed"
            || text == "item updated"
            || text == "item created"
            || text == event;
    }

    false
}

fn extract_codex_item_status(
    event_type: &str,
    value: &serde_json::Value,
) -> Option<(String, String, String)> {
    let item = value.get("item")?;
    let item_type = item
        .get("type")
        .and_then(|entry| entry.as_str())
        .unwrap_or_default();
    if item_type.is_empty() {
        return None;
    }

    match item_type {
        "agent_message" => Some((
            if event_type.contains("complete") || event_type.contains("completed") {
                "生成回复"
            } else {
                "思考"
            }
            .to_string(),
            if event_type.contains("complete") || event_type.contains("completed") {
                "正在整理给你的建议与预览…"
            } else {
                "正在分析当前工作区…"
            }
            .to_string(),
            "info".to_string(),
        )),
        "command_execution" => {
            let command = item
                .get("command")
                .and_then(json_value_to_string)
                .map(|text| summarize_command_execution(&text))
                .filter(|text| !text.is_empty())?;
            let started = event_type.contains("start");
            let detail = if started {
                command
            } else {
                format!("{command} 已完成")
            };
            Some(("执行工具".to_string(), detail, "info".to_string()))
        }
        _ => None,
    }
}

fn summarize_command_execution(command: &str) -> String {
    let compact = summarize_status_text(command, 160);
    let lower = compact.to_ascii_lowercase();

    if lower.contains("rg --files") || lower.contains("find ") {
        return "查找相关文件".to_string();
    }
    if lower.contains("git diff") {
        return "查看当前代码改动".to_string();
    }
    if lower.contains("cargo check") {
        return "检查 Rust 构建状态".to_string();
    }
    if lower.contains("cargo test") {
        return "运行 Rust 测试".to_string();
    }
    if lower.contains("npm run build")
        || lower.contains("pnpm build")
        || lower.contains("yarn build")
    {
        return "检查前端构建状态".to_string();
    }
    if lower.contains("npm run lint") || lower.contains("pnpm lint") || lower.contains("yarn lint")
    {
        return "检查前端代码规范".to_string();
    }
    if lower.contains("npm run")
        || lower.contains("pnpm ")
        || lower.contains("yarn ")
        || lower.contains("bun ")
    {
        return "运行项目脚本".to_string();
    }
    if let Some(path) = extract_path_like_token(command) {
        return format!("查看 {}", summarize_status_text(&path, 56));
    }

    "查看工作区上下文".to_string()
}

fn classify_codex_cli_stderr(line: &str) -> Option<(String, String, String, bool)> {
    let lower = line.to_ascii_lowercase();

    if lower.contains("reconnecting")
        && (lower.contains("5/5") || lower.contains("timeout waiting for child process to exit"))
    {
        return Some((
            "连接".to_string(),
            "Codex CLI 与模型连接异常，重连已耗尽。".to_string(),
            "error".to_string(),
            true,
        ));
    }

    if lower.contains("reconnecting") {
        return Some((
            "连接".to_string(),
            "连接出现波动，正在重试…".to_string(),
            "warn".to_string(),
            false,
        ));
    }

    None
}

fn extract_path_like_token(text: &str) -> Option<String> {
    text.split_whitespace().find_map(|token| {
        let cleaned = token.trim_matches(|char| matches!(char, '"' | '\'' | '(' | ')' | '[' | ']'));
        if cleaned.contains('/') && cleaned.contains('.') {
            Some(cleaned.to_string())
        } else if cleaned.ends_with(".rs")
            || cleaned.ends_with(".js")
            || cleaned.ends_with(".jsx")
            || cleaned.ends_with(".ts")
            || cleaned.ends_with(".tsx")
            || cleaned.ends_with(".md")
            || cleaned.ends_with(".json")
            || cleaned.ends_with(".toml")
            || cleaned.ends_with(".c")
            || cleaned.ends_with(".h")
            || cleaned.ends_with(".cpp")
            || cleaned.ends_with(".hpp")
        {
            Some(cleaned.to_string())
        } else {
            None
        }
    })
}

fn extract_codex_delta_from_json_line(line: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    let event_type = value
        .get("type")
        .and_then(|entry| entry.as_str())
        .unwrap_or_default();
    if !event_type.contains("delta") {
        return None;
    }

    extract_delta_from_value(&value)
}

fn extract_delta_from_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(delta) = map.get("delta").and_then(json_value_to_string) {
                return Some(delta);
            }
            if let Some(delta) = map.get("text").and_then(json_value_to_string) {
                return Some(delta);
            }
            for nested in map.values() {
                if let Some(delta) = extract_delta_from_value(nested) {
                    return Some(delta);
                }
            }
            None
        }
        serde_json::Value::Array(items) => items.iter().find_map(extract_delta_from_value),
        _ => None,
    }
}

fn json_value_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(entry) => {
            if entry.is_empty() {
                None
            } else {
                Some(entry.clone())
            }
        }
        serde_json::Value::Array(values) => {
            let merged = values
                .iter()
                .filter_map(|entry| entry.as_str())
                .collect::<String>();
            if merged.is_empty() {
                None
            } else {
                Some(merged)
            }
        }
        _ => None,
    }
}

fn summarize_status_text(input: &str, max_chars: usize) -> String {
    let compact = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() || max_chars == 0 {
        return String::new();
    }
    let mut chars = compact.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn build_codex_exec_prompt(
    messages: &[CompletionMessage],
    execution_mode: TurnExecutionMode,
    turn_intent: TurnIntent,
    workspace_ignore_patterns: &[String],
) -> String {
    let model_hint = read_codex_config_model();
    let latest_user_text = messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .and_then(|message| message.content.as_ref())
        .map(|text| text.trim().to_string());

    if let Some(last_user) = latest_user_text.as_deref() {
        let lower = last_user.to_lowercase();
        let asks_model =
            lower.contains("什么模型") || lower.contains("哪个模型") || lower.contains("model");
        if asks_model {
            return if let Some(model) = model_hint {
                format!("用户问的是当前模型型号。请只回复一句：当前使用的模型是 `{model}`。")
            } else {
                "用户问的是当前模型型号。请只回复一句：当前无法从本机配置读取模型名称。".to_string()
            };
        }
    }

    let mut lines = Vec::new();
    let base_rules = match execution_mode {
        TurnExecutionMode::QuickChat => "你是 ChatGPT。当前是快速对话模式。输出规则：\
             1) 默认用简洁中文，先给结论，再补一句必要解释；\
             2) 除非用户明确要求，不要长篇、不要分点教程、不要模板化免责声明；\
             3) 不要自我介绍，不要谈产品归属，不要说“在这个场景里/作为助手”；\
             4) 把这轮当普通聊天；即使当前会话挂了工作区，这一轮也不要主动分析仓库、代入开发任务或给执行计划；\
             5) 如果用户问“你是什么模型/型号”，且上下文里有“当前模型提示”，就直接回答这个模型名。"
            .to_string(),
        TurnExecutionMode::Agent => "你是 ChatGPT。当前是工作区协作模式。输出规则：\
             1) 默认用简洁中文，先给结论，再补关键依据；\
             2) 这一轮已经明确允许结合当前工作区协作，所以先查看相关文件，再回答，并明确提到你看了哪些文件；\
             3) 优先给基于当前工作区的建议、选项、权衡和预览；\
             4) 不要在工作区协作模式下给脱离仓库的空泛模板，除非用户明确说只要通用示例；\
             5) 涉及写文件、执行命令或其他副作用动作时，不要默认替用户执行，应把决策权交给用户；\
             6) 只有当前轮次明确进入“方向建议”或“具体预览”阶段时，才输出结构化代码块；\
             7) 如果用户问“你是什么模型/型号”，且上下文里有“当前模型提示”，就直接回答这个模型名。"
            .to_string(),
    };
    lines.push(base_rules);
    if execution_mode == TurnExecutionMode::Agent {
        if !workspace_ignore_patterns.is_empty() {
            lines.push(format!(
                "当前工作区存在 .ignore 规则。默认不要查看这些路径，除非用户明确点名要求：{}。",
                summarize_ignore_patterns(workspace_ignore_patterns, 5)
            ));
        }
        if let Some(last_user) = latest_user_text.as_deref() {
            let wants_choices = match turn_intent {
                TurnIntent::Choice => true,
                TurnIntent::Preview => false,
                TurnIntent::Auto => {
                    wants_direction_choices(last_user) && !is_choice_preview_request(last_user)
                }
            };
            let wants_preview = match turn_intent {
                TurnIntent::Preview => true,
                TurnIntent::Choice => false,
                TurnIntent::Auto => is_choice_preview_request(last_user),
            };
            if wants_choices {
                lines.push(
                    "这轮用户要的是多个方向，而不是立刻落地改动。\
                     输出规则再收紧：\
                     1) 先用一句极短结论说明你整理了几个方向；\
                     2) 然后附加 2 到 3 个 ```solo-choice key=\"A\" title=\"方向标题\" summary=\"一句话摘要\"``` 代码块；\
                     3) 每个 solo-choice 代码块正文写这个方向的预览，包括：改动目标、涉及文件、收益、风险；\
                     4) 这一轮不要输出 ```solo-write``` 或 ```solo-command```；\
                     5) 不要把多个方向压成一张写文件预览卡。"
                        .to_string(),
                );
            }
            if wants_preview {
                lines.push(
                    "这轮不是继续发散多个方向，而是沿用户刚选中的方向继续。\
                     输出规则再收紧：\
                     1) 只保留一句极短结论；\
                     2) 直接进入结构化预览，优先给出目标文件/范围、改动目的、影响点、风险提示、预期结果；\
                     3) 如果已经足够具体，至少给出一个 ```solo-write``` 或 ```solo-command``` 候选块；\
                     4) 不要重复前一轮的大段分析，不要再给 A/B 多方向。"
                        .to_string(),
                );
            }
            if !wants_choices
                && !wants_preview
                && workspace_collab_prefers_structured_preview(last_user)
            {
                lines.push(
                    "这轮用户期待的是“建议 + 预览”，不要只停留在口头点评。\
                     如果你针对某个具体文件提出修改建议，至少给出一个 ```solo-write``` 候选改动块；\
                     如果你建议执行命令，给出 ```solo-command``` 候选命令块；\
                     即使用户没有明确说“帮我修改”，只要建议已经足够具体，也要把可确认的候选预览一起给出来。"
                        .to_string(),
                );
            }
        }
    }
    if let Some(model) = read_codex_config_model() {
        lines.push(format!("当前模型提示：{model}"));
    }
    lines.push("以下是当前对话上下文：".to_string());

    for message in messages {
        let role = match message.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            _ => continue,
        };
        let content = message
            .content
            .as_ref()
            .map(|entry| entry.trim())
            .filter(|entry| !entry.is_empty())
            .unwrap_or("");
        if content.is_empty() {
            continue;
        }
        lines.push(format!("\n[{role}]\n{content}"));
    }

    lines.push("\n请继续回答最后一条 User 消息。".to_string());
    lines.join("\n")
}

fn workspace_collab_prefers_structured_preview(input: &str) -> bool {
    let normalized = input.trim().to_ascii_lowercase();
    let normalized_zh = input.trim();

    let preview_keywords = [
        "suggest",
        "suggestion",
        "preview",
        "propose",
        "proposal",
        "rewrite",
        "revise",
        "edit",
        "update",
        "improve",
        "improvement",
        "polish",
        "review",
        "refine",
    ];
    if preview_keywords
        .iter()
        .any(|keyword| normalized.contains(keyword))
    {
        return true;
    }

    let preview_keywords_zh = [
        "建议",
        "预览",
        "改一下",
        "改改",
        "修改",
        "润色",
        "优化",
        "重写",
        "重构",
        "审查",
        "评估",
        "看看",
        "review",
    ];
    if preview_keywords_zh
        .iter()
        .any(|keyword| normalized_zh.contains(keyword))
    {
        return true;
    }

    references_workspace_file(input)
}

fn is_choice_preview_request(input: &str) -> bool {
    input.contains("已选择方向") || input.contains("展开具体预览") || input.contains("继续这一方向")
}

fn wants_direction_choices(input: &str) -> bool {
    let normalized = input.to_ascii_lowercase();
    [
        "两个方向",
        "两种方向",
        "两个方案",
        "两种方案",
        "几个方向",
        "几个方案",
        "先让我选",
        "先给我选项",
        "先给建议",
        "不要直接应用",
        "先不要直接应用",
    ]
    .iter()
    .any(|needle| normalized.contains(&needle.to_ascii_lowercase()))
}

fn build_choice_followup_input(option_key: &str, detail: &str) -> String {
    format!(
        "已选择方向 {option_key}：{detail}\n\
         请直接继续这一方向，并给出结构化预览。\
         输出重点：目标文件或范围、改动目的、影响点、风险提示、预期结果。\
         如果你已经能给出具体候选，至少附加一个 ```solo-write``` 或 ```solo-command```。\
         不要再给多个方向，也不要重复前面的长篇分析。"
    )
}

fn attachments_match(message: &ChatMessage, attachments: &[MessageAttachment]) -> bool {
    if message.attachments.len() != attachments.len() {
        return false;
    }

    message
        .attachments
        .iter()
        .zip(attachments.iter())
        .all(|(left, right)| left.relative_path == right.relative_path && left.label == right.label)
}

fn reuse_retry_user_message(
    session: &mut ChatSession,
    input: &str,
    attachments: &[MessageAttachment],
) -> Option<String> {
    let trimmed_input = input.trim();
    if trimmed_input.is_empty() {
        return None;
    }

    if let Some(last) = session.messages.last() {
        if last.role == "user"
            && last.content.trim() == trimmed_input
            && attachments_match(last, attachments)
        {
            return Some(last.id.clone());
        }
    }

    if session.messages.len() < 2 {
        return None;
    }

    let last_index = session.messages.len() - 1;
    let last_is_error = session.messages[last_index].role == "assistant"
        && session.messages[last_index].status == "error";
    let previous = &session.messages[last_index - 1];
    if last_is_error
        && previous.role == "user"
        && previous.content.trim() == trimmed_input
        && attachments_match(previous, attachments)
    {
        let message_id = previous.id.clone();
        session.messages.pop();
        return Some(message_id);
    }

    None
}

fn summarize_ignore_patterns(patterns: &[String], max_items: usize) -> String {
    if patterns.is_empty() {
        return "无".to_string();
    }

    let shown = patterns
        .iter()
        .take(max_items)
        .map(|pattern| format!("`{pattern}`"))
        .collect::<Vec<_>>();

    if patterns.len() > max_items {
        format!("{} 等 {} 项路径", shown.join("、"), patterns.len())
    } else {
        shown.join("、")
    }
}

fn references_workspace_file(input: &str) -> bool {
    let text = input.trim();
    if text.contains('/') || text.contains('\\') {
        return true;
    }

    let lower = text.to_ascii_lowercase();
    let known_file_names = [
        "readme",
        "package.json",
        "cargo.toml",
        "app.jsx",
        "app.css",
        "context.md",
    ];
    if known_file_names.iter().any(|name| lower.contains(name)) {
        return true;
    }

    lower.contains(".md")
        || lower.contains(".rs")
        || lower.contains(".tsx")
        || lower.contains(".jsx")
        || lower.contains(".ts")
        || lower.contains(".js")
        || lower.contains(".json")
        || lower.contains(".toml")
        || lower.contains(".css")
        || lower.contains(".yml")
        || lower.contains(".yaml")
}

fn read_codex_config_model() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let config_path = Path::new(&home).join(".codex").join("config.toml");
    let content = fs::read_to_string(config_path).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("model") || !trimmed.contains('=') {
            continue;
        }
        let (_, value) = trimmed.split_once('=')?;
        let model = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        if !model.is_empty() {
            return Some(model);
        }
    }
    None
}

async fn handle_tool_call(
    app: &tauri::AppHandle,
    state: &SharedState,
    session_id: &str,
    workspace: Option<&Workspace>,
    settings: &Settings,
    tool_call: &crate::openai::ToolCall,
) -> String {
    match tool_call.function.name.as_str() {
        "list_files" => {
            #[derive(Deserialize)]
            struct Args {
                path: Option<String>,
                max_depth: Option<u8>,
            }
            let args = parse_args::<Args>(&tool_call.function.arguments);
            let Ok(args) = args else {
                return "Failed to parse list_files arguments".to_string();
            };
            let Some(workspace) = workspace else {
                return "No active workspace is attached to this session".to_string();
            };
            let root = match &args.path {
                Some(relative_path) if !relative_path.is_empty() => {
                    match resolve_workspace_file(workspace, relative_path) {
                        Ok(path) => path,
                        Err(err) => return err,
                    }
                }
                _ => Path::new(&workspace.path).to_path_buf(),
            };
            match describe_tree(&root, args.max_depth.unwrap_or(2), 0) {
                Ok(tree) => tree,
                Err(err) => err,
            }
        }
        "read_file" => {
            #[derive(Deserialize)]
            struct Args {
                path: String,
            }
            let args = parse_args::<Args>(&tool_call.function.arguments);
            let Ok(args) = args else {
                return "Failed to parse read_file arguments".to_string();
            };
            let Some(workspace) = workspace else {
                return "No active workspace is attached to this session".to_string();
            };
            match read_workspace_file(workspace, &args.path) {
                Ok(file) => {
                    let _ = state.update(|store| {
                        if let Some(workspace) = store
                            .workspaces
                            .iter_mut()
                            .find(|entry| entry.id == workspace.id)
                        {
                            update_recent_files(workspace, &args.path);
                            store.save_workspaces()?;
                        }
                        Ok(())
                    });
                    format!(
                        "FILE {}\n```text\n{}\n```",
                        args.path,
                        truncate_for_model(&file.content)
                    )
                }
                Err(err) => format!("Failed to read file: {err}"),
            }
        }
        "propose_write_file" => {
            #[derive(Deserialize)]
            struct Args {
                path: String,
                content: String,
                summary: Option<String>,
            }
            let args = parse_args::<Args>(&tool_call.function.arguments);
            let Ok(args) = args else {
                return "Failed to parse propose_write_file arguments".to_string();
            };
            let Some(workspace) = workspace else {
                return "No active workspace is attached to this session".to_string();
            };
            if !settings.confirm_writes {
                return "Write proposals are disabled because confirm_writes is false".to_string();
            }
            match create_write_proposal(
                app,
                state,
                session_id,
                workspace,
                &args.path,
                &args.content,
                args.summary,
            )
            .await
            {
                Ok(proposal) => format!("Created write proposal {} for {}", proposal.id, args.path),
                Err(err) => format!("Failed to create write proposal: {err}"),
            }
        }
        "propose_run_command" => {
            #[derive(Deserialize)]
            struct Args {
                command: String,
                cwd: Option<String>,
                reason: Option<String>,
            }
            let args = parse_args::<Args>(&tool_call.function.arguments);
            let Ok(args) = args else {
                return "Failed to parse propose_run_command arguments".to_string();
            };
            let Some(workspace) = workspace else {
                return "No active workspace is attached to this session".to_string();
            };
            if !settings.confirm_commands {
                return "Command proposals are disabled because confirm_commands is false"
                    .to_string();
            }
            let command_args = CommandProposalArgs {
                command: args.command,
                cwd: args.cwd,
                reason: args.reason,
            };
            match create_command_proposal(app, state, session_id, workspace, command_args).await {
                Ok(proposal) => format!("Created command proposal {}", proposal.id),
                Err(err) => format!("Failed to create command proposal: {err}"),
            }
        }
        _ => "Unknown tool".to_string(),
    }
}

async fn create_write_proposal(
    app: &tauri::AppHandle,
    state: &SharedState,
    session_id: &str,
    workspace: &Workspace,
    relative_path: &str,
    next_content: &str,
    summary: Option<String>,
) -> Result<ToolProposal, String> {
    let proposal = state.update(|store| {
        let absolute = resolve_workspace_file(workspace, relative_path)?;
        let current = if absolute.exists() {
            fs::read_to_string(&absolute)
                .map_err(|err| format!("read current file failed: {err}"))?
        } else {
            String::new()
        };
        let proposal = ToolProposal {
            id: make_id("proposal"),
            session_id: session_id.to_string(),
            kind: "write".to_string(),
            title: format!("修改 {relative_path}"),
            summary: summary.unwrap_or_else(|| "模型建议更新文件内容".to_string()),
            created_at: now_millis(),
            status: "pending".to_string(),
            payload: ToolProposalPayload::Write {
                workspace_id: workspace.id.clone(),
                relative_path: relative_path.to_string(),
                base_hash: crate::storage::hash_text(&current),
                diff_text: diff_text(relative_path, &current, next_content),
                next_content_preview: next_content.to_string(),
            },
            latest_output: None,
            error: None,
        };
        store.proposals.push(proposal.clone());
        if let Some(session) = store
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
        {
            session.pending_approvals.push(proposal.id.clone());
            session.updated_at = now_millis();
        }
        store.save_proposals()?;
        store.save_sessions()?;
        Ok(proposal)
    })?;
    app.emit("tool-proposal-created", &proposal)
        .map_err(|err| format!("emit proposal failed: {err}"))?;
    Ok(proposal)
}

async fn create_command_proposal(
    app: &tauri::AppHandle,
    state: &SharedState,
    session_id: &str,
    workspace: &Workspace,
    args: CommandProposalArgs,
) -> Result<ToolProposal, String> {
    let cwd = args.cwd.unwrap_or_default();
    let summary = args
        .reason
        .clone()
        .unwrap_or_else(|| "模型建议执行本地命令".to_string());
    let reason = args.reason.unwrap_or_else(|| "模型请求".to_string());
    if !cwd.is_empty() {
        let _ = resolve_workspace_file(workspace, &cwd)?;
    }
    let proposal = state.update(|store| {
        let proposal = ToolProposal {
            id: make_id("proposal"),
            session_id: session_id.to_string(),
            kind: "command".to_string(),
            title: format!("运行命令 {}", args.command),
            summary,
            created_at: now_millis(),
            status: "pending".to_string(),
            payload: ToolProposalPayload::Command {
                workspace_id: workspace.id.clone(),
                cwd: cwd.clone(),
                argv: vec![
                    "/usr/bin/zsh".to_string(),
                    "-lc".to_string(),
                    args.command.clone(),
                ],
                display_command: args.command.clone(),
                reason,
            },
            latest_output: Some(String::new()),
            error: None,
        };
        store.proposals.push(proposal.clone());
        if let Some(session) = store
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
        {
            session.pending_approvals.push(proposal.id.clone());
            session.updated_at = now_millis();
        }
        store.save_proposals()?;
        store.save_sessions()?;
        Ok(proposal)
    })?;
    app.emit("tool-proposal-created", &proposal)
        .map_err(|err| format!("emit proposal failed: {err}"))?;
    Ok(proposal)
}

async fn run_command_proposal(
    app: tauri::AppHandle,
    state: SharedState,
    proposal_id: String,
) -> Result<(), String> {
    let proposal = state.read(|store| {
        store
            .proposals
            .iter()
            .find(|proposal| proposal.id == proposal_id)
            .cloned()
    });
    let proposal = proposal.ok_or_else(|| "proposal not found".to_string())?;
    if proposal.status != "approved" {
        return Err(format!(
            "命令提案状态不是 approved，而是 `{}`。",
            proposal.status
        ));
    }

    let ToolProposalPayload::Command {
        workspace_id,
        cwd,
        argv,
        ..
    } = proposal.payload.clone()
    else {
        return Err("proposal is not a command".to_string());
    };

    let workspace = state
        .read(|store| {
            store
                .workspaces
                .iter()
                .find(|workspace| workspace.id == workspace_id)
                .cloned()
        })
        .ok_or_else(|| "workspace not found".to_string())?;
    let cwd_path = if cwd.is_empty() {
        Path::new(&workspace.path).to_path_buf()
    } else {
        resolve_workspace_file(&workspace, &cwd)?
    };
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err(format!("命令工作目录不存在：{}", cwd_path.display()));
    }

    let output_buffer = Arc::new(Mutex::new(String::new()));

    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(&cwd_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("spawn command failed: {err}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture stderr".to_string())?;
    let proposal_id_stdout = proposal_id.clone();
    let proposal_id_stderr = proposal_id.clone();
    let app_stdout = app.clone();
    let app_stderr = app.clone();
    let stdout_buffer = output_buffer.clone();
    let stderr_buffer = output_buffer.clone();

    let stdout_handle = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let chunk = format!("{line}\n");
            if let Ok(mut output) = stdout_buffer.lock() {
                output.push_str(&chunk);
                truncate_command_buffer(&mut output, 24_000);
            }
            let _ = app_stdout.emit(
                "command-output",
                CommandOutputEvent {
                    proposal_id: proposal_id_stdout.clone(),
                    chunk,
                },
            );
        }
    });
    let stderr_handle = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let chunk = format!("{line}\n");
            if let Ok(mut output) = stderr_buffer.lock() {
                output.push_str(&chunk);
                truncate_command_buffer(&mut output, 24_000);
            }
            let _ = app_stderr.emit(
                "command-output",
                CommandOutputEvent {
                    proposal_id: proposal_id_stderr.clone(),
                    chunk,
                },
            );
        }
    });

    let status = child
        .wait()
        .map_err(|err| format!("wait command failed: {err}"))?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    let exit_code = status.code().unwrap_or(-1);
    let latest_output = output_buffer
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_else(|_| String::new());
    let updated = state.update(|store| {
        let proposal = store
            .proposals
            .iter_mut()
            .find(|proposal| proposal.id == proposal_id)
            .ok_or_else(|| "proposal not found".to_string())?;
        proposal.status = if exit_code == 0 {
            "applied".to_string()
        } else {
            "failed".to_string()
        };
        proposal.latest_output = Some(if latest_output.trim().is_empty() {
            format!("命令执行结束，exit code {exit_code}")
        } else {
            latest_output.clone()
        });
        if exit_code != 0 {
            proposal.error = Some(format!("命令退出码为 {exit_code}"));
        } else {
            proposal.error = None;
        }
        if let Some(session) = store
            .sessions
            .iter_mut()
            .find(|session| session.id == proposal.session_id)
        {
            session
                .pending_approvals
                .retain(|entry| entry != &proposal_id);
            session.updated_at = now_millis();
        }
        let cloned = proposal.clone();
        store.save_proposals()?;
        store.save_sessions()?;
        Ok(cloned)
    })?;

    app.emit("approval-updated", &updated)
        .map_err(|err| format!("emit approval update failed: {err}"))?;
    app.emit(
        "command-finished",
        CommandFinishedEvent {
            proposal_id,
            exit_code,
        },
    )
    .map_err(|err| format!("emit command finished failed: {err}"))?;
    Ok(())
}

fn mark_proposal_failed(
    state: &SharedState,
    proposal_id: &str,
    error: &str,
) -> Result<ToolProposal, String> {
    state.update(|store| {
        let proposal = store
            .proposals
            .iter_mut()
            .find(|proposal| proposal.id == proposal_id)
            .ok_or_else(|| "proposal not found".to_string())?;
        proposal.status = "failed".to_string();
        proposal.error = Some(error.to_string());
        proposal.latest_output = Some(error.to_string());
        let cloned = proposal.clone();
        store.save_proposals()?;
        Ok(cloned)
    })
}

fn persist_assistant_message(
    state: &SharedState,
    session_id: &str,
    message_id: &str,
    content: &str,
    status: &str,
) -> Result<String, String> {
    state.update(|store| {
        let session = store
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
            .ok_or_else(|| "session not found".to_string())?;
        session.messages.push(ChatMessage {
            id: message_id.to_string(),
            role: "assistant".to_string(),
            content: content.to_string(),
            timestamp: now_millis(),
            status: status.to_string(),
            attachments: Vec::new(),
        });
        session.updated_at = now_millis();
        let title = session.title.clone();
        store.save_sessions()?;
        Ok(title)
    })
}

async fn emit_streamed_reply(
    app: &tauri::AppHandle,
    session_id: &str,
    message_id: &str,
    content: &str,
) {
    let chunks = chunk_string(content, 18);
    for chunk in chunks {
        let _ = app.emit(
            "chat-stream-token",
            ChatStreamTokenEvent {
                session_id: session_id.to_string(),
                message_id: message_id.to_string(),
                delta: chunk,
            },
        );
        tokio::time::sleep(std::time::Duration::from_millis(18)).await;
    }
}

fn build_system_prompt(workspace: Option<&Workspace>) -> String {
    let workspace_summary = workspace.map(|workspace| {
        format!(
            "Current workspace: {} at {}. Recent files: {}.",
            workspace.name,
            workspace.path,
            if workspace.recent_files.is_empty() {
                "none".to_string()
            } else {
                workspace.recent_files.join(", ")
            }
        )
    });
    format!(
        "You are Solo, a Linux coding assistant inside a desktop client. \
        Default behavior: read files and list files directly when needed. \
        Never claim to have changed files or executed commands until the user approves a proposal. \
        Use propose_write_file for file edits and propose_run_command for shell commands. \
        Keep replies concise and actionable. {}",
        workspace_summary.unwrap_or_else(|| "No workspace is currently attached.".to_string())
    )
}

fn current_session_workspace(
    store: &mut crate::storage::Store,
    session_id: &str,
) -> Result<Option<Workspace>, String> {
    let workspace_id = store
        .sessions
        .iter()
        .find(|session| session.id == session_id)
        .ok_or_else(|| "session not found".to_string())?
        .workspace_id
        .clone();

    Ok(workspace_id.and_then(|workspace_id| {
        store
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .cloned()
    }))
}

fn create_reply_proposals(
    store: &mut crate::storage::Store,
    session_id: &str,
    workspace: &Workspace,
    blocks: Vec<ManualReplyBlock>,
) -> Result<Vec<ToolProposal>, String> {
    let mut created = Vec::new();
    for block in blocks {
        let proposal = create_manual_proposal(store, session_id, workspace, block)?;
        created.push(proposal);
    }

    if created.is_empty() {
        return Ok(created);
    }

    let proposal_ids = created
        .iter()
        .map(|proposal| proposal.id.clone())
        .collect::<Vec<_>>();
    let session = store
        .sessions
        .iter_mut()
        .find(|session| session.id == session_id)
        .ok_or_else(|| "session not found".to_string())?;
    session.pending_approvals.extend(proposal_ids);
    session.updated_at = now_millis();

    Ok(created)
}

#[derive(Clone)]
enum ManualReplyBlock {
    Write {
        path: String,
        content: String,
        summary: Option<String>,
    },
    Command {
        cwd: Option<String>,
        command: String,
        reason: Option<String>,
    },
    Choice {
        option_key: String,
        title: Option<String>,
        summary: Option<String>,
        detail: String,
    },
}

fn parse_manual_reply_blocks(content: &str) -> Result<Vec<ManualReplyBlock>, String> {
    let lines = content.lines().collect::<Vec<_>>();
    let mut index = 0usize;
    let mut blocks = Vec::new();

    while index < lines.len() {
        let line = lines[index].trim();
        if line.starts_with("```solo-write")
            || line.starts_with("```solo-command")
            || line.starts_with("```solo-choice")
        {
            let header = line.trim_start_matches("```").trim();
            let mut body = Vec::new();
            index += 1;
            while index < lines.len() && lines[index].trim() != "```" {
                body.push(lines[index]);
                index += 1;
            }
            if index >= lines.len() {
                return Err("外部回复里的代码块没有正常闭合。".to_string());
            }

            let attrs = parse_block_attrs(header);
            if header.starts_with("solo-write") {
                let path = attrs
                    .iter()
                    .find_map(|(key, value)| (key == "path").then(|| value.clone()))
                    .ok_or_else(|| "solo-write 代码块缺少 path=...".to_string())?;
                let summary = attrs
                    .iter()
                    .find_map(|(key, value)| (key == "summary").then(|| value.clone()));
                blocks.push(ManualReplyBlock::Write {
                    path,
                    content: body.join("\n"),
                    summary,
                });
            } else if header.starts_with("solo-command") {
                let cwd = attrs
                    .iter()
                    .find_map(|(key, value)| (key == "cwd").then(|| value.clone()));
                let reason = attrs
                    .iter()
                    .find_map(|(key, value)| (key == "reason").then(|| value.clone()));
                blocks.push(ManualReplyBlock::Command {
                    cwd,
                    command: body.join("\n").trim().to_string(),
                    reason,
                });
            } else {
                let option_key = attrs
                    .iter()
                    .find_map(|(key, value)| {
                        (key == "key" || key == "option" || key == "option_key")
                            .then(|| value.clone())
                    })
                    .ok_or_else(|| "solo-choice 代码块缺少 key=...".to_string())?;
                let title = attrs
                    .iter()
                    .find_map(|(key, value)| (key == "title").then(|| value.clone()));
                let summary = attrs
                    .iter()
                    .find_map(|(key, value)| (key == "summary").then(|| value.clone()));
                let detail = body.join("\n").trim().to_string();
                if detail.is_empty() {
                    return Err("solo-choice 代码块内容不能为空。".to_string());
                }
                blocks.push(ManualReplyBlock::Choice {
                    option_key,
                    title,
                    summary,
                    detail,
                });
            }
        }
        index += 1;
    }

    Ok(blocks)
}

fn strip_manual_reply_blocks(content: &str) -> String {
    let lines = content.lines().collect::<Vec<_>>();
    let mut index = 0usize;
    let mut kept = Vec::new();

    while index < lines.len() {
        let line = lines[index].trim();
        if line.starts_with("```solo-write")
            || line.starts_with("```solo-command")
            || line.starts_with("```solo-choice")
        {
            index += 1;
            while index < lines.len() && lines[index].trim() != "```" {
                index += 1;
            }
            if index < lines.len() {
                index += 1;
            }
            continue;
        }

        kept.push(lines[index]);
        index += 1;
    }

    kept.join("\n").trim().to_string()
}

fn parse_reply_choice_blocks(content: &str) -> Vec<ManualReplyBlock> {
    let lower = content.to_ascii_lowercase();
    let looks_like_selection = [
        "你现在直接选",
        "可以选",
        "选一个",
        "两个方向",
        "两种方案",
        "下一步可以走",
        "其中一种预览",
        "两个版本",
        "两个方案",
        "两个优化方向",
        "两种优化方向",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
        || content.contains("A：")
        || content.contains("A:")
        || content.contains("B：")
        || content.contains("B:");

    if !looks_like_selection {
        return Vec::new();
    }

    let mut blocks = Vec::new();
    let mut in_selection_group = false;
    let mut current_key: Option<String> = None;
    let mut current_lines: Vec<String> = Vec::new();

    let push_current = |blocks: &mut Vec<ManualReplyBlock>,
                        current_key: &mut Option<String>,
                        current_lines: &mut Vec<String>| {
        let Some(option_key) = current_key.take() else {
            return;
        };
        let detail = summarize_status_text(&current_lines.join("\n"), 420);
        current_lines.clear();
        if detail.is_empty() {
            return;
        }
        let title = derive_choice_title(&detail, &option_key);
        blocks.push(ManualReplyBlock::Choice {
            option_key,
            title: Some(title),
            summary: Some(summarize_status_text(&detail, 72)),
            detail,
        });
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized_line = trimmed
            .trim_start_matches('-')
            .trim_start_matches('*')
            .trim();
        let lower_line = normalized_line.to_ascii_lowercase();
        if [
            "你现在直接选",
            "可以选",
            "选一个",
            "其中一种预览",
            "两个方向",
            "两种方案",
            "两个版本",
        ]
        .iter()
        .any(|needle| lower_line.contains(needle))
        {
            in_selection_group = true;
            continue;
        }

        let normalized = trimmed
            .trim_start_matches('-')
            .trim_start_matches('*')
            .trim();
        if let Some((raw_key, detail)) = normalized
            .split_once([':', '：'])
            .or_else(|| extract_choice_prefix(normalized))
        {
            let key = raw_key.trim().trim_end_matches(['.', '、', ')']).trim();
            if matches!(key, "A" | "B" | "C" | "1" | "2" | "3") {
                in_selection_group = true;
                push_current(&mut blocks, &mut current_key, &mut current_lines);
                current_key = Some(key.to_string());
                if !detail.trim().is_empty() {
                    current_lines.push(detail.trim().to_string());
                }
                continue;
            }
        }

        if in_selection_group
            && current_key.is_none()
            && (trimmed.starts_with('-') || trimmed.starts_with('*'))
        {
            let option_key = (blocks.len() + 1).to_string();
            let title = derive_choice_title(normalized, &option_key);
            blocks.push(ManualReplyBlock::Choice {
                option_key,
                title: Some(title.clone()),
                summary: Some(summarize_status_text(normalized, 72)),
                detail: summarize_status_text(normalized, 240),
            });
            continue;
        }

        if current_key.is_some() {
            current_lines.push(normalized.to_string());
        } else if in_selection_group {
            break;
        }
    }

    push_current(&mut blocks, &mut current_key, &mut current_lines);
    blocks
}

fn extract_choice_prefix(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim();
    for separator in [")", "）", ".", "、"] {
        if let Some((left, right)) = trimmed.split_once(separator) {
            let key = left.trim();
            if matches!(key, "A" | "B" | "C" | "1" | "2" | "3") {
                let detail = right.trim();
                if !detail.is_empty() {
                    return Some((key, detail));
                }
            }
        }
    }
    None
}

fn derive_choice_title(detail: &str, option_key: &str) -> String {
    let trimmed = detail.trim();
    if trimmed.is_empty() {
        return format!("方向 {option_key}");
    }

    let first = trimmed
        .split(['，', ',', '。', ';', '；', '\n'])
        .find(|entry| !entry.trim().is_empty())
        .map(str::trim)
        .unwrap_or(trimmed);
    let compact = summarize_status_text(first, 36);
    if compact.is_empty() {
        format!("方向 {option_key}")
    } else {
        compact
    }
}

fn parse_block_attrs(header: &str) -> Vec<(String, String)> {
    let mut chars = header.chars().peekable();
    while let Some(ch) = chars.peek() {
        if ch.is_whitespace() {
            break;
        }
        chars.next();
    }

    let mut attrs = Vec::new();
    loop {
        while let Some(ch) = chars.peek() {
            if ch.is_whitespace() {
                chars.next();
            } else {
                break;
            }
        }
        if chars.peek().is_none() {
            break;
        }

        let mut key = String::new();
        while let Some(ch) = chars.peek() {
            if *ch == '=' || ch.is_whitespace() {
                break;
            }
            key.push(*ch);
            chars.next();
        }
        if key.is_empty() {
            break;
        }

        if chars.peek() != Some(&'=') {
            while let Some(ch) = chars.peek() {
                if ch.is_whitespace() {
                    break;
                }
                chars.next();
            }
            continue;
        }
        chars.next();

        let mut value = String::new();
        let quoted = matches!(chars.peek(), Some('"') | Some('\''));
        let quote_char = if quoted { chars.next() } else { None };

        while let Some(ch) = chars.peek() {
            if let Some(quote) = quote_char {
                if *ch == quote {
                    chars.next();
                    break;
                }
            } else if ch.is_whitespace() {
                break;
            }
            value.push(*ch);
            chars.next();
        }

        attrs.push((key, value));
    }

    attrs
}

fn create_manual_proposal(
    store: &mut crate::storage::Store,
    session_id: &str,
    workspace: &Workspace,
    block: ManualReplyBlock,
) -> Result<ToolProposal, String> {
    match block {
        ManualReplyBlock::Write {
            path,
            content,
            summary,
        } => {
            let absolute = resolve_workspace_file(workspace, &path)?;
            let current = if absolute.exists() {
                fs::read_to_string(&absolute)
                    .map_err(|err| format!("read current file failed: {err}"))?
            } else {
                String::new()
            };
            let proposal = ToolProposal {
                id: make_id("proposal"),
                session_id: session_id.to_string(),
                kind: "write".to_string(),
                title: format!("修改 {path}"),
                summary: summary.unwrap_or_else(|| "外部回复建议修改文件".to_string()),
                created_at: now_millis(),
                status: "pending".to_string(),
                payload: ToolProposalPayload::Write {
                    workspace_id: workspace.id.clone(),
                    relative_path: path.clone(),
                    base_hash: crate::storage::hash_text(&current),
                    diff_text: diff_text(&path, &current, &content),
                    next_content_preview: content,
                },
                latest_output: None,
                error: None,
            };
            store.proposals.push(proposal.clone());
            Ok(proposal)
        }
        ManualReplyBlock::Command {
            cwd,
            command,
            reason,
        } => {
            if command.trim().is_empty() {
                return Err("solo-command 代码块不能为空。".to_string());
            }
            if let Some(cwd) = &cwd {
                let _ = resolve_workspace_file(workspace, cwd)?;
            }
            let cwd = cwd.unwrap_or_else(|| ".".to_string());
            let proposal = ToolProposal {
                id: make_id("proposal"),
                session_id: session_id.to_string(),
                kind: "command".to_string(),
                title: format!("运行命令 {}", command.lines().next().unwrap_or("shell")),
                summary: reason
                    .clone()
                    .unwrap_or_else(|| "外部回复建议执行命令".to_string()),
                created_at: now_millis(),
                status: "pending".to_string(),
                payload: ToolProposalPayload::Command {
                    workspace_id: workspace.id.clone(),
                    cwd,
                    argv: vec![
                        "/usr/bin/zsh".to_string(),
                        "-lc".to_string(),
                        command.clone(),
                    ],
                    display_command: command,
                    reason: reason.unwrap_or_else(|| "外部回复".to_string()),
                },
                latest_output: Some(String::new()),
                error: None,
            };
            store.proposals.push(proposal.clone());
            Ok(proposal)
        }
        ManualReplyBlock::Choice {
            option_key,
            title,
            summary,
            detail,
        } => {
            let title = title
                .filter(|entry| !entry.trim().is_empty())
                .unwrap_or_else(|| format!("方向 {option_key}"));
            let proposal = ToolProposal {
                id: make_id("proposal"),
                session_id: session_id.to_string(),
                kind: "choice".to_string(),
                title,
                summary: summary.unwrap_or_else(|| summarize_status_text(&detail, 84)),
                created_at: now_millis(),
                status: "pending".to_string(),
                payload: ToolProposalPayload::Choice {
                    workspace_id: workspace.id.clone(),
                    option_key,
                    detail,
                },
                latest_output: None,
                error: None,
            };
            store.proposals.push(proposal.clone());
            Ok(proposal)
        }
    }
}

fn read_codex_auth_snapshot() -> Option<(bool, String, String)> {
    let home = std::env::var("HOME").ok()?;
    let auth_path = Path::new(&home).join(".codex").join("auth.json");
    let content = fs::read_to_string(auth_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;

    let auth_mode = value
        .get("auth_mode")
        .and_then(|entry| entry.as_str())
        .unwrap_or("")
        .to_string();

    let access_token = value
        .get("tokens")
        .and_then(|tokens| tokens.get("access_token"))
        .and_then(|token| token.as_str())
        .unwrap_or("");

    if access_token.is_empty() {
        return Some((false, auth_mode, "Codex 未登录。".to_string()));
    }

    let method = if auth_mode.is_empty() {
        "chatgpt".to_string()
    } else {
        auth_mode
    };
    Some((
        true,
        method.clone(),
        format!("已检测到 Codex 本地会话：{method}"),
    ))
}

fn normalize_settings(mut settings: Settings) -> Settings {
    settings.provider = settings.provider.trim().to_string();
    settings.base_url = settings.base_url.trim().trim_end_matches('/').to_string();
    settings.api_key = settings.api_key.trim().to_string();
    settings.model_id = settings.model_id.trim().to_string();
    settings
}

fn validate_model_settings(settings: &Settings) -> Result<(), String> {
    if settings.base_url.trim().is_empty() {
        return Err("请先填写 Base URL。".to_string());
    }
    if settings.api_key.trim().is_empty() {
        return Err("请先填写 API Key。".to_string());
    }
    if settings.model_id.trim().is_empty() {
        return Err("请先填写 Model ID。".to_string());
    }
    Ok(())
}

fn build_augmented_user_message(input: &str, attachments: &[(String, String)]) -> String {
    if attachments.is_empty() {
        return input.to_string();
    }

    let mut content = String::from(input);
    content.push_str("\n\nAttached files:\n");
    for (path, body) in attachments {
        content.push_str(&format!(
            "\nFile: {path}\n```text\n{}\n```\n",
            truncate_for_model(body)
        ));
    }
    content
}

fn chunk_string(input: &str, size: usize) -> Vec<String> {
    let chars = input.chars().collect::<Vec<_>>();
    chars
        .chunks(size)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect()
}

fn derive_session_title(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return "新会话".to_string();
    }
    trimmed.chars().take(20).collect()
}

fn truncate_for_model(content: &str) -> String {
    const MAX_CHARS: usize = 12_000;
    let char_count = content.chars().count();
    if char_count <= MAX_CHARS {
        return content.to_string();
    }
    content.chars().take(MAX_CHARS).collect::<String>() + "\n...[truncated]"
}

fn truncate_command_buffer(output: &mut String, max_chars: usize) {
    let count = output.chars().count();
    if count <= max_chars {
        return;
    }
    let keep = output.chars().skip(count - max_chars).collect::<String>();
    *output = format!("...[output truncated]\n{keep}");
}

fn parse_args<T>(raw: &str) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_str(raw).map_err(|err| format!("invalid tool arguments: {err}"))
}

fn describe_tree(path: &Path, max_depth: u8, depth: u8) -> Result<String, String> {
    if depth > max_depth {
        return Ok(String::new());
    }
    let mut lines = Vec::new();
    if depth == 0 {
        lines.push(format!("{}{}", "  ".repeat(depth as usize), path.display()));
    }
    let mut entries = fs::read_dir(path)
        .map_err(|err| format!("read directory failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("read directory failed: {err}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let entry_path = entry.path();
        let name = entry
            .file_name()
            .to_str()
            .map(|name| name.to_string())
            .unwrap_or_else(|| "<invalid utf8>".to_string());
        lines.push(format!(
            "{}{}{}",
            "  ".repeat((depth + 1) as usize),
            if entry_path.is_dir() {
                "📁 "
            } else {
                "📄 "
            },
            name
        ));
        if entry_path.is_dir() && depth + 1 < max_depth {
            let nested = describe_tree(&entry_path, max_depth, depth + 1)?;
            if !nested.is_empty() {
                lines.push(nested);
            }
        }
    }
    Ok(lines.join("\n"))
}

#[derive(Deserialize)]
struct CommandProposalArgs {
    command: String,
    cwd: Option<String>,
    reason: Option<String>,
}
