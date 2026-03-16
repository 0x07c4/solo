function WorkspaceTreeNode({
  node,
  level,
  selectedPath,
  onOpenFile,
}) {
  const paddingLeft = 12 + level * 14;

  if (node.kind === "directory") {
    return (
      <div>
        <div className="tree-node tree-node-directory" style={{ paddingLeft }}>
          <span>{node.name}</span>
        </div>
        {node.children?.map((child) => (
          <WorkspaceTreeNode
            key={child.path}
            node={child}
            level={level + 1}
            selectedPath={selectedPath}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`tree-node tree-node-file ${selectedPath === node.path ? "is-active" : ""}`}
      style={{ paddingLeft }}
      onClick={() => onOpenFile(node.path)}
    >
      <span>{node.name}</span>
    </button>
  );
}

export function Sidebar({
  sessions,
  activeSessionId,
  workspaces,
  activeWorkspaceId,
  workspaceTree,
  selectedFilePath,
  onCreateSession,
  onSelectSession,
  onAddWorkspace,
  onRemoveWorkspace,
  onSelectWorkspace,
  onOpenFile,
}) {
  return (
    <aside className="sidebar">
      <section className="panel-block">
        <div className="section-header">
          <div>
            <p className="section-eyebrow">Sessions</p>
            <h2>会话</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onCreateSession}>
            新建
          </button>
        </div>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`session-card ${session.id === activeSessionId ? "is-active" : ""}`}
              onClick={() => onSelectSession(session.id)}
            >
              <span className="session-title">{session.title}</span>
              <span className="session-meta">
                {(session.messages?.length ?? 0)} 条消息
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel-block">
        <div className="section-header">
          <div>
            <p className="section-eyebrow">Workspaces</p>
            <h2>工作区</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onAddWorkspace}>
            添加
          </button>
        </div>
        <div className="workspace-list">
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className={`workspace-card ${workspace.id === activeWorkspaceId ? "is-active" : ""}`}
            >
              <button
                type="button"
                className="workspace-main"
                onClick={() => onSelectWorkspace(workspace.id)}
              >
                <span className="workspace-title">{workspace.name}</span>
                <span className="workspace-path">{workspace.path}</span>
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => onRemoveWorkspace(workspace.id)}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-block is-grow">
        <div className="section-header">
          <div>
            <p className="section-eyebrow">Explorer</p>
            <h2>文件树</h2>
          </div>
        </div>
        {workspaceTree ? (
          <div className="tree-panel">
            <WorkspaceTreeNode
              node={workspaceTree}
              level={0}
              selectedPath={selectedFilePath}
              onOpenFile={onOpenFile}
            />
          </div>
        ) : (
          <div className="empty-state compact">
            <p>给当前会话绑定工作区后，这里会显示文件树。</p>
          </div>
        )}
      </section>
    </aside>
  );
}
