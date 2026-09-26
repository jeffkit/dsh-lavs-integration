/**
 * The LAVS tab body, drawn inside the right Sidebar's pane tab seat.
 *
 * One pane holds the bundle picker plus the iframe view surface. The body
 * keeps every viewable bundle's iframe MOUNTED and only flips visibility,
 * so view state survives switching; `keepMounted` on the type definition
 * additionally preserves it through panel close/open and docking.
 *
 * - The spec §7.4 postMessage bridge is scoped by the owning frame: a
 *   `lavs-call` from bundle A never executes against bundle B.
 * - `/lavs/events` SSE (agent/CLI mutations on the host) fans out as
 *   `lavs-agent-action` into every mounted iframe; a `bundles_changed`
 *   action additionally re-runs the list.
 * - The selected bundle persists in localStorage.
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { appRef } from './context.ts'
import { callBundle, listBundlesFor, type LavsWithBundle } from './face.ts'

export type LavsTabBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'lavs'>

const SELECTED_KEY = 'lavs:drawer.selected'

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

export function LavsTabBody({ sessionId, t }: LavsTabBodyProps): JSX.Element {
  const [bundles, setBundles] = useState<LavsWithBundle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(SELECTED_KEY))
  const frames = useRef(new Map<string, HTMLIFrameElement>())

  const refresh = (): void => {
    const ctx = appRef.current
    if (ctx === undefined) return
    listBundlesFor(ctx, sessionId)
      .then((list) => {
        setBundles(list)
        setError(null)
      })
      .catch((message: unknown) => {
        setError(message instanceof Error ? message.message : String(message))
        console.warn(`lavs: bundle list failed — the tab stays with a retry path (${String(message)})`)
      })
  }

  // Re-query when the session changes; the host scopes by this session's
  // workspace + preset, so the picker only offers what this session sees.
  useEffect(() => {
    setBundles(null)
    setError(null)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionId is the driver; refresh reads fresh state
  }, [sessionId])

  const viewable = bundles?.filter(b => b.hasView) ?? []

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
      void callBundle(bundle, call.endpoint, call.input)
        .then((result) => {
          target.postMessage({ type: 'lavs-result', id: call.id, result }, { targetOrigin: event.origin })
        })
        .catch((e) => {
          target.postMessage({ type: 'lavs-error', id: call.id, error: e instanceof Error ? e.message : String(e) }, { targetOrigin: event.origin })
        })
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [])

  // Agent-action fan-out: forward every host action into all mounted
  // iframes; a bundles_changed action additionally re-runs the list.
  useEffect(() => {
    const source = new EventSource('/lavs/events')
    source.onmessage = (event: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(event.data) as AgentActionEvent
        if (parsed.action.type === 'bundles_changed') {
          refresh()
          return
        }
        for (const frame of frames.current.values()) {
          frame.contentWindow?.postMessage({ type: 'lavs-agent-action', action: parsed.action }, '*')
        }
      } catch { /* malformed event — views still work on their own actions */ }
    }
    return () => { source.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh reads fresh state per call
  }, [])

  if (error != null) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center' }} role="alert">
        <p style={{ margin: '0 0 8px', color: '#d92d20', fontSize: 12 }}>{error}</p>
        <button
          type="button"
          onClick={refresh}
          style={{
            border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
            background: 'transparent', color: 'inherit', cursor: 'pointer',
            borderRadius: 6, padding: '4px 12px', fontSize: 12,
          }}
        >
          {t('load.retry')}
        </button>
      </div>
    )
  }

  if (bundles === null) {
    return <div style={{ padding: '24px 16px', fontSize: 12, opacity: 0.7, textAlign: 'center' }}>{t('load.loading')}</div>
  }

  if (viewable.length === 0) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 8px', fontSize: 13 }}>{t('empty.title')}</p>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>{t('empty.hint')}</p>
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '8px 12px 12px',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          role="tablist"
          aria-label={t('pick.bundle')}
          style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}
        >
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
                fontSize: 12,
              }}
            >
              {b.name}
            </button>
          ))}
        </div>
        {selected !== null && viewable.some(b => b.name === selected) && (
          <a
            href={`/lavs-view/${selected}/view/index.html`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: 'inherit', opacity: 0.75, whiteSpace: 'nowrap' }}
          >
            {t('view.open.tab')}
          </a>
        )}
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
    </div>
  )
}
