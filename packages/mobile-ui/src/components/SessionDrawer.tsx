import { memo } from 'react'
import type { SessionSummary } from '../types.js'

export const SessionDrawer = memo(function SessionDrawer({
  open,
  sessions,
  activeId,
  onClose,
  onSelect,
  onNew,
}: {
  open: boolean
  sessions: SessionSummary[]
  activeId?: string
  onClose: () => void
  onSelect: (sessionId: string) => void
  onNew: () => void
}) {
  if (!open) return null
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <span>会话</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <button type="button" className="new-session" onClick={onNew}>
          ＋ 新建会话
        </button>
        <nav className="session-list">
          {sessions.length === 0 && <div className="empty-hint">还没有会话</div>}
          {sessions.map((session) => (
            <button
              type="button"
              key={session.sessionId}
              className={session.sessionId === activeId ? 'session-item active' : 'session-item'}
              onClick={() => onSelect(session.sessionId)}
            >
              <span className="session-title">{session.title ?? '未命名会话'}</span>
              {session.running === true && <span className="session-running">生成中</span>}
              <span className="session-time">
                {session.updatedAt !== undefined ? new Date(session.updatedAt).toLocaleString() : ''}
              </span>
            </button>
          ))}
        </nav>
      </aside>
    </>
  )
})
