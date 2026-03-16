import ReactMarkdown from "react-markdown";

function MessageBubble({ message }) {
  const attachmentLabel =
    message.attachments?.length > 0
      ? `${message.attachments.length} 个附件`
      : null;

  return (
    <article className={`message message-${message.role} message-${message.status}`}>
      <div className="message-meta">
        <span>{message.role === "user" ? "You" : "Solo"}</span>
        <span>
          {message.status === "streaming"
            ? "生成中"
            : message.status === "error"
              ? "失败"
              : "已完成"}
        </span>
      </div>
      <div className="message-body">
        {message.role === "assistant" ? (
          <ReactMarkdown>{message.content || ""}</ReactMarkdown>
        ) : (
          <p>{message.content}</p>
        )}
      </div>
      {attachmentLabel ? <p className="message-attachment">{attachmentLabel}</p> : null}
    </article>
  );
}

export function ChatPane({
  session,
  draft,
  canSend,
  canSendReason,
  manualMode,
  attachments,
  streaming,
  onChangeDraft,
  onRemoveAttachment,
  onSend,
  onOpenImport,
}) {
  const submitDisabled = !canSend || streaming || !draft.trim();

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!submitDisabled) {
        onSend();
      }
    }
  };

  return (
    <section className="chat-pane">
      <div className="chat-scroll">
        {session?.messages?.length ? (
          session.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        ) : (
          <div className="empty-state hero">
            <p className="section-eyebrow">Solo</p>
            <h2>对话、读代码、提补丁。</h2>
            <p>
              {manualMode
                ? "手动模式下，先记录你的问题，再把外部回复导回 Solo。"
                : "先完成设置并测试连接，然后给当前会话绑定一个工作区。"}
            </p>
          </div>
        )}
      </div>

      <div className="composer">
        <div className="attachment-row">
          {attachments.map((path) => (
            <button
              key={path}
              type="button"
              className="attachment-chip"
              onClick={() => onRemoveAttachment(path)}
            >
              {path}
            </button>
          ))}
        </div>
        <textarea
          className="composer-input"
          value={draft}
          onChange={(event) => onChangeDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你要做的事，或者让 Solo 读取当前工作区里的文件。"
        />
        <div className="composer-actions">
          <p className="composer-hint">
            {streaming
              ? "正在处理当前请求…"
              : manualMode
                ? canSendReason
                : canSend
                ? "Enter 发送，Shift+Enter 换行。"
                : canSendReason}
          </p>
          <div className="composer-button-row">
            {manualMode ? (
              <button type="button" className="ghost-button" onClick={onOpenImport}>
                导入外部回复
              </button>
            ) : null}
            <button
              type="button"
              className="primary-button"
              disabled={submitDisabled}
              onClick={onSend}
            >
              {manualMode ? "记录问题" : "发送"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
