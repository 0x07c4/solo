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
        title: "选择工作区目录",
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
            <p className="section-eyebrow">Workspace Picker</p>
            <h2>选择工作区目录</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="modal-copy">
          <p>当前版本会直接打开系统目录选择器，由你手动挑选要绑定的工作区。</p>
          <p>选中目录后，Solo 只把它当作协作上下文，不会默认替你改文件或执行命令。</p>
        </div>

        <label className="field">
          <span>已选择目录</span>
          <input
            value={path}
            readOnly
            placeholder="点击下方按钮选择目录"
          />
          <small>你也可以重新选择，直到确认当前工作区正确为止。</small>
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
            添加工作区
          </button>
        </div>
      </div>
    </div>
  );
}
