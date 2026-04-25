import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

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

  const handlePickDirectory = async () => {
    setError("");
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择项目目录",
      });
      if (typeof selected === "string" && selected.trim()) {
        setPath(selected.trim());
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSubmit = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("请先选择一个目录。");
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
            <p className="section-eyebrow">Resource</p>
            <h2>添加目录资源</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            关闭
          </button>
        </div>

        <label className="field">
          <span>已选目录</span>
          <input
            value={path}
            readOnly
            placeholder="点击下方按钮选择目录"
          />
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
            className="ghost-button"
            disabled={submitting}
            onClick={() => void handlePickDirectory()}
          >
            {path ? "重新选择目录" : "选择目录"}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={submitting || !path.trim()}
            onClick={handleSubmit}
          >
            添加为资源
          </button>
        </div>
      </div>
    </div>
  );
}
