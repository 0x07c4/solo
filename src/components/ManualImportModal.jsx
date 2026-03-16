import { useEffect, useState } from "react";

const TEMPLATE = `把外部回复粘贴到这里。

如果要自动生成提案，请用下面的 fenced block 格式：

\`\`\`solo-write path=src/App.jsx
// 完整文件内容
\`\`\`

\`\`\`solo-command cwd=. reason=运行构建检查
npm run build
\`\`\`
`;

export function ManualImportModal({ open, onClose, onSubmit }) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setContent("");
      setError("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError("请先粘贴外部回复。");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit(content);
      setContent("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card-wide">
        <div className="section-header">
          <div>
            <p className="section-eyebrow">Manual</p>
            <h2>导入外部回复</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            关闭
          </button>
        </div>

        <label className="field">
          <span>回复内容</span>
          <textarea
            className="composer-input import-input"
            value={content}
            placeholder={TEMPLATE}
            onChange={(event) => setContent(event.target.value)}
          />
          <small>普通文本会作为 assistant 消息保存；带 `solo-write` / `solo-command` 代码块会生成提案。</small>
        </label>

        {error ? (
          <div className="status-banner status-banner-error">
            <strong>导入失败</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <div className="modal-actions">
          <button
            type="button"
            className="primary-button"
            disabled={submitting}
            onClick={handleSubmit}
          >
            导入回复
          </button>
        </div>
      </div>
    </div>
  );
}
