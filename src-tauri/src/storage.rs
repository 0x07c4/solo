use crate::models::{
    ChatSession, FileReadResult, FileTreeNode, Settings, ToolProposal, ToolProposalPayload, Workspace,
};
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::{
    cmp::Ordering,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";
const SESSIONS_FILE: &str = "sessions.json";
const WORKSPACES_FILE: &str = "workspaces.json";
const PROPOSALS_FILE: &str = "approvals.json";

#[derive(Clone)]
pub struct SharedState(pub Arc<InnerState>);

pub struct InnerState {
    pub store: Mutex<Store>,
    pub client: reqwest::Client,
}

pub struct Store {
    pub settings: Settings,
    pub sessions: Vec<ChatSession>,
    pub workspaces: Vec<Workspace>,
    pub proposals: Vec<ToolProposal>,
    data_dir: PathBuf,
}

impl SharedState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|err| format!("resolve app data dir failed: {err}"))?;
        fs::create_dir_all(&data_dir)
            .map_err(|err| format!("create app data dir failed: {err}"))?;

        let store = Store {
            settings: read_json_or_default(data_dir.join(SETTINGS_FILE))?,
            sessions: read_json_or_default(data_dir.join(SESSIONS_FILE))?,
            workspaces: read_json_or_default(data_dir.join(WORKSPACES_FILE))?,
            proposals: read_json_or_default(data_dir.join(PROPOSALS_FILE))?,
            data_dir,
        };

        Ok(Self(Arc::new(InnerState {
            store: Mutex::new(store),
            client: reqwest::Client::new(),
        })))
    }

    pub fn client(&self) -> reqwest::Client {
        self.0.client.clone()
    }

    pub fn read<R>(&self, f: impl FnOnce(&Store) -> R) -> R {
        let guard = self.0.store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&guard)
    }

    pub fn update<R>(&self, f: impl FnOnce(&mut Store) -> Result<R, String>) -> Result<R, String> {
        let mut guard = self.0.store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut guard)
    }
}

impl Store {
    pub fn save_settings(&self) -> Result<(), String> {
        write_json(self.data_dir.join(SETTINGS_FILE), &self.settings)
    }

    pub fn save_sessions(&self) -> Result<(), String> {
        write_json(self.data_dir.join(SESSIONS_FILE), &self.sessions)
    }

    pub fn save_workspaces(&self) -> Result<(), String> {
        write_json(self.data_dir.join(WORKSPACES_FILE), &self.workspaces)
    }

    pub fn save_proposals(&self) -> Result<(), String> {
        write_json(self.data_dir.join(PROPOSALS_FILE), &self.proposals)
    }

    pub fn sorted_sessions(&self) -> Vec<ChatSession> {
        let mut sessions = self.sessions.clone();
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        sessions
    }

    pub fn sorted_workspaces(&self) -> Vec<Workspace> {
        let mut workspaces = self.workspaces.clone();
        workspaces.sort_by(|left, right| right.last_opened_at.cmp(&left.last_opened_at));
        workspaces
    }

    pub fn sorted_proposals(&self, session_id: Option<&str>) -> Vec<ToolProposal> {
        let mut proposals = self
            .proposals
            .iter()
            .filter(|proposal| session_id.map(|id| proposal.session_id == id).unwrap_or(true))
            .cloned()
            .collect::<Vec<_>>();
        proposals.sort_by(|left, right| match right.created_at.cmp(&left.created_at) {
            Ordering::Equal => right.id.cmp(&left.id),
            other => other,
        });
        proposals
    }
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

pub fn make_id(prefix: &str) -> String {
    format!("{prefix}_{}", now_millis())
}

pub fn canonicalize_workspace(path: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|err| format!("open workspace failed: {err}"))?;
    if !canonical.is_dir() {
        return Err("workspace path is not a directory".to_string());
    }
    Ok(canonical)
}

pub fn relative_workspace_path(path: &str) -> Result<PathBuf, String> {
    let raw = PathBuf::from(path);
    if raw.is_absolute() {
        return Err("path must stay inside the workspace".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("path traversal is not allowed".to_string());
            }
        }
    }

    Ok(normalized)
}

pub fn resolve_workspace_file(workspace: &Workspace, relative_path: &str) -> Result<PathBuf, String> {
    let relative = relative_workspace_path(relative_path)?;
    Ok(Path::new(&workspace.path).join(relative))
}

pub fn build_workspace_tree(workspace: &Workspace, max_depth: u8) -> Result<FileTreeNode, String> {
    let root = Path::new(&workspace.path);
    build_node(root, root, max_depth)
}

fn build_node(root: &Path, path: &Path, max_depth: u8) -> Result<FileTreeNode, String> {
    let name = if path == root {
        root.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("workspace")
            .to_string()
    } else {
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string()
    };

    let relative_path = path
        .strip_prefix(root)
        .ok()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    if path.is_file() || max_depth == 0 {
        return Ok(FileTreeNode {
            name,
            path: relative_path,
            kind: "file".to_string(),
            children: Vec::new(),
        });
    }

    let mut children = Vec::new();
    let mut entries = fs::read_dir(path)
        .map_err(|err| format!("read workspace tree failed: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("read workspace tree failed: {err}"))?;

    entries.sort_by(|left, right| {
        let left_path = left.path();
        let right_path = right.path();
        match (left_path.is_dir(), right_path.is_dir()) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => left.file_name().cmp(&right.file_name()),
        }
    });

    for entry in entries {
        let child_path = entry.path();
        children.push(build_node(root, &child_path, max_depth.saturating_sub(1))?);
    }

    Ok(FileTreeNode {
        name,
        path: relative_path,
        kind: "directory".to_string(),
        children,
    })
}

pub fn read_workspace_file(workspace: &Workspace, relative_path: &str) -> Result<FileReadResult, String> {
    let absolute = resolve_workspace_file(workspace, relative_path)?;
    let content = fs::read_to_string(&absolute)
        .map_err(|err| format!("read file failed for {}: {err}", absolute.display()))?;
    let hash = hash_text(&content);
    Ok(FileReadResult {
        relative_path: relative_path.to_string(),
        content,
        hash,
        size_bytes: fs::metadata(&absolute)
            .map(|metadata| metadata.len() as usize)
            .unwrap_or_default(),
        is_truncated: false,
    })
}

pub fn preview_file_result(mut file: FileReadResult, max_chars: usize) -> FileReadResult {
    let char_count = file.content.chars().count();
    if char_count <= max_chars {
        return file;
    }

    file.content = file.content.chars().take(max_chars).collect::<String>() + "\n...[preview truncated]";
    file.is_truncated = true;
    file
}

pub fn update_recent_files(workspace: &mut Workspace, relative_path: &str) {
    workspace.recent_files.retain(|entry| entry != relative_path);
    workspace.recent_files.insert(0, relative_path.to_string());
    workspace.recent_files.truncate(12);
    workspace.last_opened_at = now_millis();
}

pub fn hash_text(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn diff_text(relative_path: &str, current: &str, next: &str) -> String {
    let current_lines = current.lines().collect::<Vec<_>>();
    let next_lines = next.lines().collect::<Vec<_>>();

    let mut prefix = 0usize;
    while prefix < current_lines.len()
        && prefix < next_lines.len()
        && current_lines[prefix] == next_lines[prefix]
    {
        prefix += 1;
    }

    let mut suffix = 0usize;
    while suffix + prefix < current_lines.len()
        && suffix + prefix < next_lines.len()
        && current_lines[current_lines.len() - 1 - suffix] == next_lines[next_lines.len() - 1 - suffix]
    {
        suffix += 1;
    }

    let current_changed = &current_lines[prefix..current_lines.len().saturating_sub(suffix)];
    let next_changed = &next_lines[prefix..next_lines.len().saturating_sub(suffix)];

    let mut diff = vec![
        format!("--- a/{relative_path}"),
        format!("+++ b/{relative_path}"),
        "@@".to_string(),
    ];

    diff.extend(current_changed.iter().map(|line| format!("-{line}")));
    diff.extend(next_changed.iter().map(|line| format!("+{line}")));

    if current_changed.is_empty() && next_changed.is_empty() {
        diff.push(" no textual changes".to_string());
    }

    diff.join("\n")
}

pub fn apply_write_proposal(
    workspace: &Workspace,
    proposal: &ToolProposal,
) -> Result<(String, String), String> {
    match &proposal.payload {
        ToolProposalPayload::Write {
            relative_path,
            base_hash,
            next_content_preview,
            ..
        } => {
            let absolute = resolve_workspace_file(workspace, relative_path)?;
            let current = if absolute.exists() {
                fs::read_to_string(&absolute)
                    .map_err(|err| format!("read current file failed: {err}"))?
            } else {
                String::new()
            };
            let current_hash = hash_text(&current);
            if &current_hash != base_hash {
                return Err("target file changed since the proposal was generated".to_string());
            }
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("create parent directory failed: {err}"))?;
            }
            fs::write(&absolute, next_content_preview)
                .map_err(|err| format!("write file failed: {err}"))?;
            Ok((relative_path.clone(), hash_text(next_content_preview)))
        }
        ToolProposalPayload::Command { .. } => Err("proposal is not a write action".to_string()),
    }
}

fn read_json_or_default<T>(path: PathBuf) -> Result<T, String>
where
    T: DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|err| format!("read {} failed: {err}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|err| format!("parse {} failed: {err}", path.display()))
}

fn write_json<T>(path: PathBuf, value: &T) -> Result<(), String>
where
    T: Serialize,
{
    let raw = serde_json::to_string_pretty(value)
        .map_err(|err| format!("serialize {} failed: {err}", path.display()))?;
    fs::write(&path, raw).map_err(|err| format!("write {} failed: {err}", path.display()))
}
