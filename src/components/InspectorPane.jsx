function formatTime(timestamp) {
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

function statusLabel(status) {
  switch (status) {
    case "pending":
      return "待确认";
    case "approved":
      return "已批准";
    case "applied":
      return "已完成";
    case "rejected":
      return "已拒绝";
    case "failed":
      return "失败";
    default:
      return status;
  }
}

function ProposalCard({ proposal, isActive, onSelect }) {
  return (
    <button
      type="button"
      className={`proposal-card ${isActive ? "is-active" : ""}`}
      onClick={() => onSelect(proposal.id)}
    >
      <span className="proposal-kind">{proposal.kind}</span>
      <strong>{proposal.title}</strong>
      <span>{proposal.summary}</span>
      <span className="proposal-meta">{formatTime(proposal.createdAt)}</span>
      <span className={`proposal-status proposal-status-${proposal.status}`}>
        {statusLabel(proposal.status)}
      </span>
    </button>
  );
}

export function InspectorPane({
  activeTab,
  onChangeTab,
  settings,
  activeWorkspace,
  selectedFile,
  preview,
  previewState,
  attachedFiles,
  proposals,
  activeProposal,
  commandOutput,
  onToggleAttach,
  onSelectProposal,
  onAcceptProposal,
  onRejectProposal,
  onOpenSettings,
}) {
  return (
    <aside className="inspector">
      <div className="section-header">
        <div>
          <p className="section-eyebrow">Inspector</p>
          <h2>上下文</h2>
        </div>
        <button type="button" className="ghost-button" onClick={onOpenSettings}>
          设置
        </button>
      </div>

      <div className="tab-row">
        {["context", "diff", "command"].map((tab) => (
          <button
            key={tab}
            type="button"
            className={`tab-button ${activeTab === tab ? "is-active" : ""}`}
            onClick={() => onChangeTab(tab)}
          >
            {tab === "context" ? "Context" : tab === "diff" ? "Diff" : "Command"}
          </button>
        ))}
      </div>

      {activeTab === "context" ? (
        <div className="inspector-scroll">
          <div className="info-card">
            <span className="section-eyebrow">Workspace</span>
            <strong>{activeWorkspace?.name ?? "未绑定"}</strong>
            <p>{activeWorkspace?.path ?? "当前会话还没有绑定工作区。"}</p>
          </div>

          <div className="info-card">
            <span className="section-eyebrow">Model</span>
            <strong>
              {settings.provider === "manual"
                ? "手动协作模式"
                : settings.provider === "codex_cli"
                  ? "ChatGPT 账号模式"
                  : settings.modelId || "未配置模型"}
            </strong>
            <p>
              {settings.provider === "manual"
                ? "问题先记录在本地，会话回复由你从 ChatGPT / Codex 手动导入。"
                : settings.provider === "codex_cli"
                  ? "直接复用本机 Codex 登录态，不需要 API Key。"
                  : settings.baseUrl || "未配置 Base URL"}
            </p>
          </div>

          <div className="info-card">
            <span className="section-eyebrow">Attachments</span>
            {attachedFiles.length ? (
              attachedFiles.map((file) => (
                <div key={file} className="compact-row">
                  <span>{file}</span>
                </div>
              ))
            ) : (
              <p>从左侧文件树打开文件后，可以把它附加到当前消息。</p>
            )}
          </div>

          <div className="preview-card">
            <div className="preview-header">
              <div>
                <span className="section-eyebrow">Preview</span>
                <strong>{selectedFile || "暂无文件"}</strong>
              </div>
              {selectedFile ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onToggleAttach(selectedFile)}
                >
                  {attachedFiles.includes(selectedFile) ? "移除附件" : "附加到消息"}
                </button>
              ) : null}
            </div>
            {previewState.loading ? <p>正在读取文件…</p> : null}
            {previewState.error ? (
              <div className="status-banner status-banner-error">
                <strong>预览失败</strong>
                <span>{previewState.error}</span>
              </div>
            ) : null}
            {preview ? (
              <>
                <pre>{preview.content}</pre>
                {preview.isTruncated ? (
                  <p className="preview-note">
                    该文件较大，当前只显示前 12000 个字符预览。
                  </p>
                ) : null}
              </>
            ) : (
              <pre>在左侧打开一个文件后，这里会显示内容预览。</pre>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "diff" ? (
        <div className="inspector-scroll">
          {proposals
            .filter((proposal) => proposal.kind === "write")
            .map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                isActive={proposal.id === activeProposal?.id}
                onSelect={onSelectProposal}
              />
            ))}

          {activeProposal?.kind === "write" ? (
            <div className="preview-card">
              <div className="preview-header">
                <div>
                  <span className="section-eyebrow">Diff</span>
                  <strong>{activeProposal.payload.relativePath}</strong>
                </div>
              </div>
              <pre>{activeProposal.payload.diffText}</pre>
              {activeProposal.error ? <p className="error-text">{activeProposal.error}</p> : null}
              {activeProposal.status === "pending" ? (
                <div className="approval-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onAcceptProposal(activeProposal.id)}
                  >
                    应用补丁
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onRejectProposal(activeProposal.id)}
                  >
                    拒绝
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state compact">
              <p>还没有待确认的文件修改提案。</p>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "command" ? (
        <div className="inspector-scroll">
          {proposals
            .filter((proposal) => proposal.kind === "command")
            .map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                isActive={proposal.id === activeProposal?.id}
                onSelect={onSelectProposal}
              />
            ))}

          {activeProposal?.kind === "command" ? (
            <div className="preview-card">
              <div className="preview-header">
                <div>
                  <span className="section-eyebrow">Command</span>
                  <strong>{activeProposal.payload.displayCommand}</strong>
                </div>
              </div>
              <pre>{commandOutput || activeProposal.latestOutput || "等待执行。"}</pre>
              {activeProposal.error ? <p className="error-text">{activeProposal.error}</p> : null}
              {activeProposal.status === "pending" ? (
                <div className="approval-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onAcceptProposal(activeProposal.id)}
                  >
                    运行命令
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onRejectProposal(activeProposal.id)}
                  >
                    拒绝
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state compact">
              <p>还没有待确认的命令提案。</p>
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}
