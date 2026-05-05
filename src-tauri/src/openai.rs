use crate::models::{ConnectionTestResult, Settings};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Serialize)]
pub struct CompletionMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
}

impl CompletionMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: Some(content.into()),
            tool_call_id: None,
            tool_calls: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: Some(content.into()),
            tool_call_id: None,
            tool_calls: None,
        }
    }

    pub fn assistant(content: Option<String>, tool_calls: Option<Vec<ToolCall>>) -> Self {
        Self {
            role: "assistant".to_string(),
            content,
            tool_call_id: None,
            tool_calls,
        }
    }

    pub fn tool(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".to_string(),
            content: Some(content.into()),
            tool_call_id: Some(tool_call_id.into()),
            tool_calls: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolFunction,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ToolFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Deserialize)]
struct ChatCompletionChoice {
    message: CompletionAssistantMessage,
}

#[derive(Clone, Deserialize)]
pub struct CompletionAssistantMessage {
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

#[derive(Deserialize)]
struct ModelInfo {
    id: String,
}

pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files inside the active workspace. Use this before reading unfamiliar directories.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative path inside the workspace. Empty means root." },
                        "max_depth": { "type": "integer", "minimum": 1, "maximum": 6 }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a text file from the active workspace.",
                "parameters": {
                    "type": "object",
                    "required": ["path"],
                    "properties": {
                        "path": { "type": "string", "description": "Relative file path inside the workspace." }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "propose_write_file",
                "description": "Prepare a file rewrite proposal. Use this instead of claiming the file was already changed.",
                "parameters": {
                    "type": "object",
                    "required": ["path", "content"],
                    "properties": {
                        "path": { "type": "string" },
                        "content": { "type": "string" },
                        "summary": { "type": "string" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "propose_run_command",
                "description": "Prepare a shell command proposal for user approval.",
                "parameters": {
                    "type": "object",
                    "required": ["command"],
                    "properties": {
                        "command": { "type": "string" },
                        "cwd": { "type": "string", "description": "Relative working directory inside the workspace." },
                        "reason": { "type": "string" }
                    }
                }
            }
        }),
    ]
}

pub async fn test_connection(
    client: &reqwest::Client,
    settings: &Settings,
) -> Result<ConnectionTestResult, String> {
    let url = format!("{}/models", settings.base_url.trim_end_matches('/'));
    let response = client
        .get(url)
        .bearer_auth(&settings.api_key)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(map_transport_error)?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(map_response_error(status, &body));
    }

    let parsed: ModelsResponse = response
        .json()
        .await
        .map_err(|err| format!("连接成功，但模型列表解析失败：{err}"))?;
    let model_available = parsed
        .data
        .iter()
        .any(|model| model.id == settings.model_id);

    if !model_available {
        return Err(format!(
            "连接成功，但没有找到模型 `{}`。请检查模型 ID 是否正确。",
            settings.model_id
        ));
    }

    Ok(ConnectionTestResult {
        success: true,
        model_id: settings.model_id.clone(),
        message: format!("连接成功，可访问模型 `{}`。", settings.model_id),
    })
}

pub async fn chat_completion(
    client: &reqwest::Client,
    settings: &Settings,
    messages: &[CompletionMessage],
) -> Result<CompletionAssistantMessage, String> {
    let url = format!(
        "{}/chat/completions",
        settings.base_url.trim_end_matches('/')
    );
    let response = client
        .post(url)
        .bearer_auth(&settings.api_key)
        .timeout(Duration::from_secs(90))
        .json(&json!({
            "model": settings.model_id,
            "messages": messages,
            "tools": tool_definitions(),
            "tool_choice": "auto",
            "temperature": 0.2,
            "thinking": { "type": "disabled" }
        }))
        .send()
        .await
        .map_err(map_transport_error)?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(map_response_error(status, &body));
    }

    let parsed: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|err| format!("模型返回成功，但响应解析失败：{err}"))?;

    parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message)
        .ok_or_else(|| "模型返回了空结果，请重试。".to_string())
}

fn map_transport_error(err: reqwest::Error) -> String {
    if err.is_timeout() {
        return "请求模型超时，请检查网络或稍后重试。".to_string();
    }
    if err.is_connect() {
        return "无法连接到模型服务，请检查 Base URL 或网络。".to_string();
    }
    format!("请求模型失败：{err}")
}

fn map_response_error(status: reqwest::StatusCode, body: &str) -> String {
    let compact_body = body.trim();
    match status.as_u16() {
        400 => format!("请求格式无效，请检查 Base URL 或模型参数。{compact_body}"),
        401 => "认证失败，请检查 API Key。".to_string(),
        403 => "当前 API Key 没有访问该服务或模型的权限。".to_string(),
        404 => "接口地址不存在，请检查 Base URL。".to_string(),
        408 => "模型服务响应超时，请稍后重试。".to_string(),
        429 => "请求过于频繁或额度不足，请稍后重试。".to_string(),
        500..=599 => "模型服务暂时不可用，请稍后重试。".to_string(),
        _ => {
            if compact_body.is_empty() {
                format!("模型服务返回错误：HTTP {status}")
            } else {
                format!("模型服务返回错误：HTTP {status}，{compact_body}")
            }
        }
    }
}
