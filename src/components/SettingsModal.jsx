import { useEffect, useMemo, useState } from "react";

function validateForm(form) {
  const errors = {};
  if (!form.provider?.trim()) {
    errors.provider = "请先选择模式";
  }
  if (form.provider === "manual" || form.provider === "codex_cli") {
    return errors;
  }
  if (!form.baseUrl.trim()) {
    errors.baseUrl = "Base URL 不能为空";
  }
  if (!form.apiKey.trim()) {
    errors.apiKey = "API Key 不能为空";
  }
  if (!form.modelId.trim()) {
    errors.modelId = "Model ID 不能为空";
  }
  return errors;
}

function proxyModeLabel(mode) {
  if (mode === "direct") {
    return "直连：不跟随环境变量。";
  }
  if (mode === "manual") {
    return "手动代理：只注入给 ChatGPT / Codex 通道，不影响 Solo 页面。";
  }
  return "跟随环境：继续使用当前 shell / 系统里的代理变量。";
}

export function SettingsModal({
  open,
  settings,
  connectionState,
  onClose,
  onSave,
  onTest,
}) {
  const [form, setForm] = useState(settings);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setForm(settings);
    setErrors({});
  }, [settings]);

  const connectionLabel = useMemo(() => {
    if (form.provider === "manual") {
      return "当前为手动协作模式：问题在本地记录，外部回复手动导入。";
    }
    if (form.provider === "codex_cli") {
      return "当前为 ChatGPT 账号模式：直接复用本机 Codex 登录态。";
    }
    if (connectionState.status === "success") {
      return connectionState.message;
    }
    if (connectionState.status === "error") {
      return connectionState.message;
    }
    if (connectionState.status === "testing") {
      return "正在测试连接…";
    }
    return "保存后请先测试连接，再开始聊天。";
  }, [connectionState, form.provider]);
  const proxyMode = form.codexProxyMode || "inherit";

  if (!open) {
    return null;
  }

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const runValidation = () => {
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = async () => {
    if (!runValidation()) {
      return;
    }

    setSubmitting(true);
    try {
      await onSave(form);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async () => {
    if (!runValidation()) {
      return;
    }

    setSubmitting(true);
    try {
      await onTest(form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="section-header">
          <div>
            <p className="section-eyebrow">Settings</p>
            <h2>模型配置</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className={`status-banner status-banner-${connectionState.status}`}>
          <strong>连接状态</strong>
          <span>{connectionLabel}</span>
        </div>

        <label className="field">
          <span>工作模式</span>
          <select
            value={form.provider}
            onChange={(event) => updateField("provider", event.target.value)}
          >
            <option value="codex_cli">ChatGPT 账号模式（Codex CLI）</option>
            <option value="manual">手动协作模式</option>
            <option value="openai">OpenAI API</option>
          </select>
          {errors.provider ? <small className="field-error">{errors.provider}</small> : null}
        </label>

        {form.provider === "openai" ? (
          <>
            <label className="field">
              <span>Base URL</span>
              <input
                value={form.baseUrl}
                onChange={(event) => updateField("baseUrl", event.target.value)}
              />
              {errors.baseUrl ? <small className="field-error">{errors.baseUrl}</small> : null}
            </label>

            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={form.apiKey}
                onChange={(event) => updateField("apiKey", event.target.value)}
              />
              {errors.apiKey ? <small className="field-error">{errors.apiKey}</small> : null}
            </label>

            <label className="field">
              <span>Model ID</span>
              <input
                value={form.modelId}
                onChange={(event) => updateField("modelId", event.target.value)}
              />
              {errors.modelId ? <small className="field-error">{errors.modelId}</small> : null}
            </label>
          </>
        ) : (
          <div className="status-banner status-banner-info">
            <strong>{form.provider === "manual" ? "Manual" : "ChatGPT"}</strong>
            <span>
              {form.provider === "manual"
                ? "发送按钮会只记录你的提问。你可以在 ChatGPT / Codex 里拿到回复后，再用“导入外部回复”贴回 Solo。"
                : "应用会直接通过本机 Codex 登录态进行对话，无需 API Key。"}
            </span>
          </div>
        )}

        {form.provider === "codex_cli" ? (
          <>
            <label className="field">
              <span>Codex 代理</span>
              <select
                value={proxyMode}
                onChange={(event) => updateField("codexProxyMode", event.target.value)}
              >
                <option value="direct">直连</option>
                <option value="inherit">跟随环境</option>
                <option value="manual">手动配置</option>
              </select>
              <small className="field-hint">{proxyModeLabel(proxyMode)}</small>
            </label>

            {proxyMode === "manual" ? (
              <>
                <label className="field">
                  <span>HTTP Proxy</span>
                  <input
                    value={form.codexHttpProxy || ""}
                    placeholder="http://127.0.0.1:7897"
                    onChange={(event) => updateField("codexHttpProxy", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>HTTPS Proxy</span>
                  <input
                    value={form.codexHttpsProxy || ""}
                    placeholder="http://127.0.0.1:7897"
                    onChange={(event) => updateField("codexHttpsProxy", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>ALL_PROXY</span>
                  <input
                    value={form.codexAllProxy || ""}
                    placeholder="socks5://127.0.0.1:7897"
                    onChange={(event) => updateField("codexAllProxy", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>NO_PROXY</span>
                  <input
                    value={form.codexNoProxy || ""}
                    placeholder="localhost,127.0.0.1,::1"
                    onChange={(event) => updateField("codexNoProxy", event.target.value)}
                  />
                  <small className="field-hint">
                    这里只作用于 ChatGPT / Codex 子进程，不会影响 Solo 自己的页面加载。
                  </small>
                </label>
              </>
            ) : null}
          </>
        ) : null}

        <div className="toggle-row">
          <label>
            <input
              type="checkbox"
              checked={form.confirmWrites}
              onChange={(event) => updateField("confirmWrites", event.target.checked)}
            />
            写文件前确认
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.confirmCommands}
              onChange={(event) => updateField("confirmCommands", event.target.checked)}
            />
            执行命令前确认
          </label>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={submitting || connectionState.status === "testing" || form.provider !== "openai"}
            onClick={handleTest}
          >
            测试连接
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={submitting}
            onClick={handleSave}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
