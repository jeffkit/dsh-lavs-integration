/**
 * LAVS views drawer: a collapsible right-side panel hosting the bundle
 * picker plus the iframe view surface. Opened from the session header's
 * LAVS entry; renders above the conversation with no composer involvement.
 *
 * - Bundle tabs stay mounted; switching only flips display so view state
 *   survives.
 * - The spec §7.4 postMessage bridge is scoped by the owning frame: a
 *   `lavs-call` from bundle A never executes against bundle B.
 * - `/lavs/events` SSE (agent/CLI mutations on the host) fans out as
 *   `lavs-agent-action` into every mounted iframe, so views refresh when
 *   data changes outside the view.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** One bundle as `/lavs list` returns it. */
export interface LavsBundleCard {
  name: string
  contentType: string
  version: string
  description: string | undefined
  hasView: boolean
  endpoints: Array<{ id: string; method: string; description: string | undefined }>
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
  action: {
    type: 'tool_executed'
    tool: string
    contentType: string
    timestamp: number
    result?: unknown
  }
}

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
  bundles: LavsWithBundle[]
  forwardCall: (bundle: string, endpoint: string, input: unknown) => Promise<unknown>
  onClose: () => void
}

export function LavsDrawer({ bundles, forwardCall, onClose, t }: LavsWith & PropsLocale<'lavs'>): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const viewable = bundles.filter(b => b.hasView)

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
  // iframes with the spec payload; views refresh themselves.
  useEffect(() => {
    const source = new EventSource('/lavs/events')
    source.onmessage = (event: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(event.data) as AgentActionEvent
        for (const frame of frames.current.values()) {
          frame.contentWindow?.postMessage({ type: 'lavs-agent-action', action: parsed.action }, '*')
        }
      } catch { /* malformed event — views still work on their own actions */ }
    }
    return () => { source.close() }
  }, [])

  // Escape closes the drawer (click-outside would fight the iframes).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return createPortal(
    <aside
      aria-label={t('drawer.title')}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(560px, 42vw)',
        minWidth: 380,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 16px',
        boxSizing: 'border-box',
        background: 'color-mix(in srgb, canvas 96%, transparent)',
        borderLeft: '1px solid color-mix(in srgb, currentColor 15%, transparent)',
        boxShadow: '-12px 0 32px color-mix(in srgb, black 18%, transparent)',
        zIndex: 60,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{t('drawer.title')}</strong>
        <span style={{ flex: 1 }} />
        {selected !== null && (
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

      <div role="tablist" aria-label={t('pick.bundle')} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid color-mix(in srgb, currentColor 12%, transparent)', paddingBottom: 8 }}>
        {viewable.map(b => (
          <button
            key={b.name}
            type="button"
            role="tab"
            aria-selected={selected === b.name}
            title={b.description ?? b.contentType}
            onClick={() => { setSelected(b.name) }}
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
    </aside>,
    document.body,
  )
}
