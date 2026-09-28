/**
 * Tasks tab body: the agent's todo list as a first-class application view.
 *
 * Read path: the `todos` session projection through the session-scoped
 * standard kit's `useProjection` hook (host-folded, whole-value — every
 * action re-renders from the durable log, so the view replays identically
 * after restart or fork).
 *
 * Interaction path (the plugin's thesis): no direct data mutation. Clicking
 * a toggle or submitting a new task sends one ordinary queued user message
 * to the agent; the agent performs the change with its own todo tool, and
 * the projection echoes back into this view. Every UI action is therefore a
 * session-log event — auditable, replayable, and consistent with the chat
 * surface beside it.
 */

import { useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the `todos` projection key into SessionProjectionMap for
// useProjection (single source, no consumer-side restated declare).
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { sendQueuedMessage } from './face.ts'

/** Runtime props of the session-scoped tab-body seat plus this plugin's locale. */
export type TasksTabBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'tasks'>

const EMPTY_TODOS: readonly TodoItem[] = []

/** The next status a click cycles to. */
function nextStatus(status: TodoItem['status']): TodoItem['status'] {
  if (status === 'pending') return 'in_progress'
  if (status === 'in_progress') return 'completed'
  return 'pending'
}

export function TasksTabBody({
  sessionId, useProjection, t,
}: TasksTabBodyProps): JSX.Element {
  const projected = useProjection('todos')
  const list = projected ?? null
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => {
    const items = list ?? EMPTY_TODOS
    return {
      pending: items.filter(item => item.status === 'pending').length,
      inProgress: items.filter(item => item.status === 'in_progress').length,
      completed: items.filter(item => item.status === 'completed').length,
    }
  }, [list])

  async function dispatch(text: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await sendQueuedMessage(sessionId, text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function toggle(item: TodoItem): void {
    const to = nextStatus(item.status)
    const key = `send.prefix.${item.status}` as const
    void dispatch(t(key, { content: item.content }) + ` → ${to}`)
  }

  function submitDraft(event: React.FormEvent): void {
    event.preventDefault()
    const content = draft.trim()
    if (content === '') return
    setDraft('')
    void dispatch(t('create.send', { content }))
  }

  return (
    <section
      aria-label={t('view.tasks')}
      style={{
        height: '100%',
        overflowY: 'auto',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxSizing: 'border-box',
        fontFamily: 'inherit',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{t('view.tasks')}</h2>
        {list !== null && (
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            {counts.pending} {t('status.pending')} · {counts.inProgress} {t('status.in_progress')} · {counts.completed} {t('status.completed')}
          </span>
        )}
      </header>

      {list === null && (
        <div style={{ padding: '32px 0', textAlign: 'center', opacity: 0.75 }}>
          <p style={{ margin: '0 0 4px' }}>{t('empty.title')}</p>
          <p style={{ margin: 0, fontSize: 12 }}>{t('empty.hint')}</p>
        </div>
      )}

      {list !== null && list.length === 0 && (
        <p style={{ textAlign: 'center', opacity: 0.75 }}>{t('empty.title')}</p>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(list ?? EMPTY_TODOS).map((item, index) => (
          <li key={`${index}:${item.content}`}>
            <button
              type="button"
              disabled={busy}
              onClick={() => { toggle(item) }}
              title={t(`item.toggle.${item.status}`)}
              aria-label={t(`item.toggle.${item.status}`)}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid color-mix(in srgb, currentColor 15%, transparent)',
                background: 'transparent',
                color: 'inherit',
                cursor: busy ? 'wait' : 'pointer',
                textAlign: 'left',
                opacity: item.status === 'completed' ? 0.6 : 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  flex: '0 0 auto',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: '2px solid currentColor',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  background: item.status === 'completed' ? 'currentColor' : 'transparent',
                }}
              >
                {item.status === 'in_progress' ? '•' : ''}
              </span>
              <span style={{
                flex: 1,
                textDecoration: item.status === 'completed' ? 'line-through' : 'none',
                wordBreak: 'break-word',
              }}>
                {item.content}
              </span>
              <span style={{ flex: '0 0 auto', fontSize: 11, opacity: 0.65 }}>
                {t(`status.${item.status}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={submitDraft} style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <input
          value={draft}
          onChange={(event) => { setDraft(event.target.value) }}
          placeholder={t('create.placeholder')}
          disabled={busy}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
            background: 'transparent',
            color: 'inherit',
          }}
        />
        <button
          type="submit"
          disabled={busy || draft.trim() === ''}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          {t('create.submit')}
        </button>
      </form>

      {error !== null && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: '#d92d20' }}>{error}</p>
      )}

      <footer style={{ fontSize: 11, opacity: 0.55 }}>
        {t('footer.note')}
      </footer>
    </section>
  )
}
