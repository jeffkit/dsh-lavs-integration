/**
 * LAVS views drawer: a resizable right-side panel hosting the bundle
 * picker plus the iframe view surface. Opened from the session header's
 * LAVS entry; the panel stays MOUNTED for the session's lifetime and only
 * flips visibility, so iframe view state survives open/close cycles.
 *
 * - Bundle tabs stay mounted; switching only flips display so view state
 *   survives.
 * - The spec §7.4 postMessage bridge is scoped by the owning frame: a
 *   `lavs-call` from bundle A never executes against bundle B.
 * - `/lavs/events` SSE (agent/CLI mutations on the host) fans out as
 *   `lavs-agent-action` into every mounted iframe; a `bundles_changed`
 *   action additionally refreshes the picker through `onBundlesChanged`.
 * - Width and the selected bundle persist in localStorage.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** One bundle as `/lavs list` returns it. */
export interface LavsWithBundle {
  name: string
  contentType: string
  version: string
  description: string | undefined
  hasView: boolean
  endpoints: Array<{ id: string; method: string; description: string | undefined }>
}

export interface LavsWith {
  open: boolean
  bundles: LavsWithBundle[]
  /** Set when the bundle list itself failed to load — the drawer shows a retry. */
  error?: string | null
  onRetry?: () => void
  /** Host saw bundle files change (fs.watch) — re-run the list. */
  onBundlesChanged?: () => void
  forwardCall: (bundle: string, endpoint: string, input: unknown) => Promise<unknown>
  onClose: () => void
}

const WIDTH_KEY = 'lavs:drawer.width'
const SELECTED_KEY = 'lavs:drawer.selected'
const MIN_WIDTH = 380
const MAX_WIDTH = 1000

function clampWidth(value: number, viewport: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value, viewport - 120))
}

interface LavsCallMessage {
  type: 'lavs-call'
  id: string
  endpoint: string
  input?: unknown
  source: Window
}

function isLavsCall(data: unknown): data is LavsCallMessage {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return d.type === 'lavs-call' && typeof d.id === 'string' && typeof d.endpoint === 'string'
}

/** `/lavs/events` SSE payload (spec §7.4.5 action plus this host's seq). */
interface AgentActionEvent {
  seq: number
  action: { type: string; [key: string]: unknown }
}

export function LavsDrawer({ open, bundles, error, onRetry, onBundlesChanged, forwardCall, onClose, t }: LavsWith & PropsLocale<'lavs'>): JSX.Element {
  const viewable = bundles.filter(b => b.hasView)
  const [selected, setSelected] = useState<string | null>(() => {
    const saved = localStorage.getItem(SELECTED_KEY)
    return saved !== null && viewable.some(b => b.name === saved) ? saved : null
  })
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(saved) && saved > 0 ? clampWidth(saved, window.innerWidth) : Math.min(560, Math.round(window.innerWidth * 0.42))
  })
  const [dragging, setDragging] = useState(false)
  const frames = useRef(new Map<string, HTMLIFrameElement>())

  useEffect(() => {
    if (selected === null && viewable.length > 0) setSelected(viewable[0]?.name ?? null)
  }, [selected, viewable])

  // The postMessage bridge (spec §7.4), scoped by owning frame.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (!isLavsCall(event.data)) return
      const call = event.data
      const target = event.source
      if (target === null) return
      const owner = [...frames.current.entries()].find(([, el]) => el.contentWindow === target)
      if (owner === undefined) return
      const bundle = owner[0]
      void forwardCall(bundle, call.endpoint, call.input)
        .then((result) => {
          target.postMessage({ type: 'lavs-result', id: call.id, result }, { targetOrigin: event.origin })
        })
        .catch((e) => {
          target.postMessage({ type: 'lavs-error', id: call.id, error: e instanceof Error ? e.message : String(e) }, { targetOrigin: event.origin })
        })
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [forwardCall])

  // Agent-action fan-out: forward every host action into all mounted
  // iframes; a bundles_changed action additionally refreshes the picker.
  useEffect(() => {
    const source = new EventSource('/lavs/events')
    source.onmessage = (event: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(event.data) as AgentActionEvent
        if (parsed.action.type === 'bundles_changed') {
          onBundlesChanged?.()
          return
        }
        for (const frame of frames.current.values()) {
          frame.contentWindow?.postMessage({ type: 'lavs-agent-action', action: parsed.action }, '*')
        }
      } catch { /* malformed event — views still work on their own actions */ }
    }
    return () => { source.close() }
  }, [onBundlesChanged])

  // Escape closes the drawer (click-outside would fight the iframes).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  // Left-edge drag resizer. While dragging, a full-screen shield captures
  // pointer events so the iframes cannot swallow the mousemove stream.
  useEffect(() => {
    if (!dragging) return undefined
    const onMove = (event: MouseEvent): void => {
      setWidth(clampWidth(window.innerWidth - event.clientX, window.innerWidth))
    }
    const onUp = (): void => {
      setDragging(false)
      localStorage.setItem(WIDTH_KEY, String(width))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, width])

  const persistWidth = (): void => { localStorage.setItem(WIDTH_KEY, String(width)) }

  return createPortal(
    <aside
      aria-label={t('drawer.title')}
      aria-hidden={!open}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width,
        display: open ? 'flex' : 'none',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 16px',
        boxSizing: 'border-box',
        background: 'color-mix(in srgb, canvas 96%, transparent)',
        borderLeft: '1px solid color-mix(in srgb, currentColor 15%, transparent)',
        boxShadow: open ? '-12px 0 32px color-mix(in srgb, black 18%, transparent)' : 'none',
        zIndex: 60,
        fontFamily: 'inherit',
      }}
    >
      {dragging && <div style={{ position: 'fixed', inset: 0, zIndex: 70, cursor: 'col-resize' }} />}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={(event) => {
          if (event.button === 0) setDragging(true)
        }}
        style={{
          position: 'absolute', left: -3, top: 0, bottom: 0, width: 6,
          cursor: 'col-resize',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{t('drawer.title')}</strong>
        <span style={{ flex: 1 }} />
        {selected !== null && error == null && (
          <a
            href={`/lavs-view/${selected}/view/index.html`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: 'inherit', opacity: 0.75 }}
          >
            {t('drawer.open.tab')}
          </a>
        )}
        <button
          type="button"
          aria-label={t('drawer.close')}
          title={t('drawer.close')}
          onClick={onClose}
          style={{
            border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
            background: 'transparent', color: 'inherit', cursor: 'pointer',
            borderRadius: 6, padding: '2px 8px', fontSize: 12,
          }}
        >
          ✕
        </button>
      </div>

      {error != null ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }} role="alert">
          <p style={{ margin: '0 0 8px', color: '#d92d20', fontSize: 12 }}>{error}</p>
          <button
            type="button"
            onClick={onRetry}
            style={{
              border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
              background: 'transparent', color: 'inherit', cursor: 'pointer',
              borderRadius: 6, padding: '4px 12px', fontSize: 12,
            }}
          >
            {t('load.retry')}
          </button>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label={t('pick.bundle')} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid color-mix(in srgb, currentColor 12%, transparent)', paddingBottom: 8 }}>
            {viewable.map(b => (
              <button
                key={b.name}
                type="button"
                role="tab"
                aria-selected={selected === b.name}
                title={b.description ?? b.contentType}
                onClick={() => {
                  setSelected(b.name)
                  localStorage.setItem(SELECTED_KEY, b.name)
                }}
                style={{
                  padding: '4px 12px',
                  borderRadius: 999,
                  border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
                  background: selected === b.name ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontWeight: selected === b.name ? 600 : 400,
                }}
              >
                {b.name}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            {viewable.map(b => (
              <iframe
                key={b.name}
                ref={(el) => {
                  if (el === null) frames.current.delete(b.name)
                  else frames.current.set(b.name, el)
                }}
                src={`/lavs-view/${b.name}/view/index.html`}
                title={b.name}
                aria-hidden={selected !== b.name}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  border: '1px solid color-mix(in srgb, currentColor 15%, transparent)',
                  borderRadius: 8,
                  background: 'transparent',
                  display: selected === b.name ? 'block' : 'none',
                }}
                sandbox="allow-scripts allow-forms allow-same-origin"
              />
            ))}
          </div>
        </>
      )}
    </aside>,
    document.body,
  )
}
