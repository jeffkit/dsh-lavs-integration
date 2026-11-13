import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import type {
  AssistantStreamFrame,
  ContentPart,
  FollowFrame,
  SessionEventEntry,
  SessionSummary,
  StreamChunk,
} from './types.js'
import { SessionDrawer } from './components/SessionDrawer.js'
import { ChatView, type ChatItem } from './components/ChatView.js'
import { Composer } from './components/Composer.js'

type Gate = 'checking' | 'login' | 'ready'

interface LiveBuffer {
  text: string
  thinking: string
}

/** follow/events 里的记录带 {type:'event', event} 壳，统一拆包成事件条目 */
function unwrapRecord(raw: unknown): SessionEventEntry | undefined {
  const record = raw as { type?: string; event?: SessionEventEntry; seq?: number } | undefined
  if (record === undefined) return undefined
  if (record.type === 'event' && record.event !== undefined) return record.event
  if (typeof record.seq === 'number') return record as unknown as SessionEventEntry
  return undefined
}

/**
 * 事件 → 消息模型的单向累积器。
 * - 持久事件（snapshot.records / event 帧 / events 页）按 type:seq 去重回放，
 *   乱序到达也能在视图层按 seq 稳定排序；
 * - assistant-stream 帧聚合成「正在生成」的临时消息，assistant/message 落地后替换；
 * - 用户消息只认 source.kind === 'user'（runtime-context/skill-catalog 等
 *   harness 内部注入也记作 user/message，但不是用户可见对话）。
 */
class ConversationModel {
  items: ChatItem[] = []
  seenEvents = new Set<string>()
  seenUsers = new Set<string>()
  live = new Map<string, LiveBuffer>()
  running = false
  title: string | undefined
  private lowestSeqSeen: number | undefined

  private push(item: ChatItem): void {
    this.items.push(item)
    if (item.seq !== undefined && (this.lowestSeqSeen === undefined || item.seq < this.lowestSeqSeen)) {
      this.lowestSeqSeen = item.seq
    }
  }

  /** 历史分页游标：当前已见的最小 seq（events(before) 取更早的记录） */
  lowestSeq(): number | undefined {
    return this.lowestSeqSeen
  }

  applyEvent(entry: SessionEventEntry): boolean {
    const dedupeKey = `${entry.type}:${entry.seq}`
    if (this.seenEvents.has(dedupeKey)) return false
    this.seenEvents.add(dedupeKey)
    const data = entry.data ?? {}
    switch (entry.type) {
      case 'session/title':
        if (typeof data.title === 'string' && data.title !== '') this.title = data.title
        return true
      case 'user/message': {
        const source = data.source as { kind?: string } | undefined
        if (source?.kind !== undefined && source.kind !== 'user') return false
        const id = typeof data.id === 'string' ? data.id : dedupeKey
        if (this.seenUsers.has(id)) return false
        this.seenUsers.add(id)
        this.push({ kind: 'user', key: id, seq: entry.seq, parts: (data.content ?? []) as ContentPart[] })
        return true
      }
      case 'assistant/message': {
        const message = data.message ?? {}
        const parts = (message.content ?? []) as ContentPart[]
        const thinking = (data.stream ?? [])
          .filter((record) => record.type === 'thinking')
          .map((record) => record.thinking ?? record.text ?? '')
          .join('')
        const id = typeof message.id === 'string' ? message.id : dedupeKey
        this.live.clear()
        this.push({
          kind: 'assistant',
          key: id,
          seq: entry.seq,
          text: parts.filter((part) => part.type === 'text').map((part) => part.text ?? '').join(''),
          thinking,
          usage: data.usage,
        })
        return true
      }
      case 'tool/call':
        this.push({
          kind: 'tool',
          key: dedupeKey,
          seq: entry.seq,
          name: typeof data.name === 'string' ? data.name : 'tool',
          args: typeof data.arguments === 'string' ? data.arguments : '',
        })
        return true
      case 'tool/result': {
        for (let i = this.items.length - 1; i >= 0; i -= 1) {
          const item = this.items[i]
          if (item.kind === 'tool' && !item.result) {
            this.items[i] = { ...item, result: true }
            return true
          }
        }
        return false
      }
      case 'turn/start':
        // running 归位是可见状态变化：必须 emit（否则发送按钮卡在停止态）
        this.running = true
        return true
      case 'turn/end': {
        this.running = false
        this.live.clear()
        if (data.reason?.kind === 'error') {
          this.push({ kind: 'status', key: dedupeKey, seq: entry.seq, text: `⚠️ 回合出错：${JSON.stringify(data.reason.error ?? '')}` })
        }
        return true
      }
      default:
        return false
    }
  }

  applyStreamFrame(frame: FollowFrame & { frame: AssistantStreamFrame }): boolean {
    const inner = frame.frame
    const attemptId = typeof inner.attemptId === 'string' ? inner.attemptId : '__default__'
    if (inner.type === 'start') {
      this.live.set(attemptId, { text: '', thinking: '' })
      return true
    }
    if (inner.type === 'chunk') {
      const chunk = inner.chunk
      if (chunk === undefined) return false
      let buffer = this.live.get(attemptId)
      if (buffer === undefined) {
        buffer = { text: '', thinking: '' }
        this.live.set(attemptId, buffer)
      }
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') buffer.text += chunk.text
      if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') buffer.thinking += chunk.text
      return chunk.type === 'text-delta' || chunk.type === 'reasoning-delta'
    }
    if (inner.type === 'end') {
      if (inner.outcome?.kind === 'abandoned') this.live.delete(attemptId)
      return true
    }
    return false
  }

  /** 当前视图：持久消息按 seq 稳定排序 + 追加一条聚合中的临时消息 */
  snapshotView(): ChatItem[] {
    const view = [...this.items].sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER))
    const parts: string[] = []
    const thinkings: string[] = []
    for (const buffer of this.live.values()) {
      if (buffer.text !== '') parts.push(buffer.text)
      if (buffer.thinking !== '') thinkings.push(buffer.thinking)
    }
    if (parts.length > 0 || thinkings.length > 0 || this.running) {
      view.push({
        kind: 'assistant',
        key: '__live__',
        text: parts.join('\n'),
        thinking: thinkings.join('\n'),
        streaming: true,
      })
    }
    return view
  }
}

export function App() {
  const [gate, setGate] = useState<Gate>('checking')
  const [token, setToken] = useState('')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [items, setItems] = useState<ChatItem[]>([])
  const [running, setRunning] = useState(false)
  const [title, setTitle] = useState<string | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const modelRef = useRef(new ConversationModel())
  const abortRef = useRef<{ abort: () => void } | undefined>(undefined)

  const refreshSessions = useCallback(async () => {
    try {
      const value = await api.listSessions()
      const list = (value.items ?? []).filter((session) => !session.blank)
      list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      setSessions(list)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  const openSession = useCallback(
    (sessionId: string) => {
      abortRef.current?.abort()
      const model = new ConversationModel()
      modelRef.current = model
      setItems(model.snapshotView())
      setRunning(false)
      setTitle(undefined)
      setActiveId(sessionId)
      setDrawerOpen(false)
      setError(undefined)

      const emit = () => {
        setItems(model.snapshotView())
        setRunning(model.running)
        if (model.title !== undefined) setTitle(model.title)
      }

      // 历史回填：snapshot 窗口之外的部分经 events(before) 向前翻页，
      // 全部收齐后按 seq 升序一次性重放（applyEvent 去重保证幂等）。
      const hydrateHistory = async (lowestSeq: number | undefined) => {
        if (lowestSeq === undefined) return
        try {
          const pages: SessionEventEntry[][] = []
          let before = lowestSeq
          for (let guard = 0; guard < 12; guard += 1) {
            const page = await api.events(sessionId, before)
            const entries = (page.records ?? [])
              .map(unwrapRecord)
              .filter((entry): entry is SessionEventEntry => entry !== undefined)
            if (entries.length === 0) break
            pages.push(entries)
            if (page.hasMore !== true) break
            const nextLowest = Math.min(...entries.map((entry) => entry.seq))
            if (nextLowest >= before) break
            before = nextLowest
          }
          for (const page of pages.reverse()) {
            for (const entry of page) model.applyEvent(entry)
          }
          emit()
        } catch {
          // 历史回填失败不阻塞实时流
        }
      }

      const handle = api.stream(
        sessionId,
        (frame: FollowFrame) => {
          if (frame.type === 'snapshot') {
            const entries = (frame.records ?? [])
              .map(unwrapRecord)
              .filter((entry): entry is SessionEventEntry => entry !== undefined)
            for (const entry of entries) model.applyEvent(entry)
            emit()
            void hydrateHistory(frame.hasMore === true ? model.lowestSeq() : undefined)
          } else if (frame.type === 'event' && frame.event !== undefined) {
            if (model.applyEvent(frame.event)) emit()
          } else if (frame.type === 'assistant-stream' && frame.frame !== undefined) {
            if (model.applyStreamFrame(frame as FollowFrame & { frame: AssistantStreamFrame })) emit()
          }
        },
        (streamError) => {
          if (streamError !== undefined) setError(`流断开：${String(streamError)}`)
        },
      )
      abortRef.current = handle
    },
    [],
  )

  const newSession = useCallback(async () => {
    try {
      const value = await api.createSession()
      await refreshSessions()
      openSession(value.sessionId)
    } catch (err) {
      setError(String(err))
    }
  }, [openSession, refreshSessions])

  // 首次进入：鉴权 → 会话列表 → 打开最近会话
  useEffect(() => {
    void (async () => {
      try {
        const healthy = await api.health()
        setGate(healthy ? 'ready' : 'login')
        if (healthy) {
          await refreshSessions()
        }
      } catch {
        setGate('login')
      }
    })()
  }, [refreshSessions])

  useEffect(() => {
    if (gate === 'ready' && activeId === undefined && sessions.length > 0) {
      openSession(sessions[0].sessionId)
    }
  }, [gate, activeId, sessions, openSession])

  // 组件卸载时断流
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(
    async (text: string) => {
      if (activeId === undefined) {
        await newSession()
        return
      }
      try {
        setError(undefined)
        await api.prompt(activeId, text)
        setRunning(true)
        void refreshSessions()
      } catch (err) {
        setError(String(err))
      }
    },
    [activeId, newSession, refreshSessions],
  )

  const stop = useCallback(async () => {
    if (activeId === undefined) return
    try {
      await api.cancel(activeId)
    } catch (err) {
      setError(String(err))
    }
  }, [activeId])

  const login = useCallback(() => {
    if (token.trim() !== '') api.login(token.trim())
  }, [token])

  const drawer = useMemo(
    () => (
      <SessionDrawer
        open={drawerOpen}
        sessions={sessions}
        activeId={activeId}
        onClose={() => setDrawerOpen(false)}
        onSelect={openSession}
        onNew={() => void newSession()}
      />
    ),
    [drawerOpen, sessions, activeId, openSession, newSession],
  )

  if (gate === 'checking') {
    return <div className="boot">连接中…</div>
  }

  if (gate === 'login') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>DSH Mobile</h1>
          <p>粘贴实例启动横幅里的 token（dsh web: http://…/?token=…）</p>
          <input
            type="password"
            value={token}
            placeholder="token"
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && login()}
          />
          <button type="button" onClick={login} disabled={token.trim() === ''}>
            进入
          </button>
          {error !== undefined && <p className="error">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="icon-button" onClick={() => setDrawerOpen(true)} aria-label="会话列表">
          ☰
        </button>
        <div className="topbar-title">{title ?? (activeId !== undefined ? '会话' : 'DSH Mobile')}</div>
        <button type="button" className="icon-button" onClick={() => void newSession()} aria-label="新建会话">
          ✎
        </button>
      </header>
      {error !== undefined && <div className="error-banner">{error}</div>}
      <ChatView items={items} running={running} />
      <Composer disabled={false} running={running} onSend={(text) => void send(text)} onStop={() => void stop()} />
      {drawer}
    </div>
  )
}
