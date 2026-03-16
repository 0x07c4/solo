import { useEffect, useState } from "react";

export function WorkspaceModal({ open, onClose, onSubmit }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setError("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("请输入工作区绝对路径。");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit(trimmed);
      setPath("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="section-header">
          <div>
            <p className="section-eyebrow">Workspace</p>
            <h2>添加工作区</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            关闭
          </button>
        </div>

        <label className="field">
          <span>绝对路径</span>
          <input
            value={path}
            placeholder="/path/to/your/project"
            onChange={(event) => setPath(event.target.value)}
          />
          <small>当前版本先通过输入路径添加目录，不直接打开系统目录选择器。</small>
        </label>

        {error ? (
          <div className="status-banner status-banner-error">
            <strong>添加失败</strong>
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
            添加工作区
          </button>
        </div>
      </div>
    </div>
  );
}
