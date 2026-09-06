/**
 * LAVS Views: second-level bundle tabs plus the iframe host surface.
 *
 * - Each viewable bundle gets its own inner tab (stays mounted; switching
 *   only flips display, so view state survives). High-frequency bundles can
 *   later be promoted to top-level tabs without changing this component.
 * - The spec §7.4 bridge rides window.message: `lavs-call` from any iframe
 *   forwards to the host adapter over the Connection RPC channel and the
 *   result/error posts back. Calls are scoped by the owning frame, so a
 *   message from bundle A never executes against bundle B.
 * - The `/lavs/events` SSE stream (an agent tool mutated a bundle on the
 *   host) fans out as `lavs-agent-action` into every mounted iframe, so
 *   views refresh when the agent — not the user — mutates data.
 */

import { useEffect, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** One bundle as `/lavs list` returns it. */
export interface LavsBundleCard {
  name: string
  contentType: string
  version: string
  description: string | undefined
  hasView: boolean
  endpoints: Array<{ id: string; method: string; description: string | undefined }>
}

/** Host-injected handles (RPC forwards). */
export interface ViewsViewInjected {
  listBundles: () => Promise<LavsBundleCard[]>
  forwardCall: (bundle: string, endpoint: string, input: unknown) => Promise<unknown>
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

export function ViewsView({
  listBundles, forwardCall, t,
}: ConvViewProps & InjectFace<ViewsViewInjected> & PropsLocale<'lavs'>): JSX.Element {
  const [bundles, setBundles] = useState<LavsBundleCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const frames = useRef(new Map<string, HTMLIFrameElement>())

  useEffect(() => {
    let alive = true
    listBundles()
      .then((list) => {
        if (!alive) return
        setBundles(list)
        const first = list.find(b => b.hasView)
        if (first !== undefined) setSelected(first.name)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { alive = false }
  }, [listBundles])

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

  const viewable = bundles?.filter(b => b.hasView) ?? []

  return (
    <section
      aria-label={t('view.lavs')}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 16px',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
      }}
    >
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

      {error !== null && <p role="alert" style={{ margin: 0, color: '#d92d20', fontSize: 12 }}>{error}</p>}

      {bundles !== null && viewable.length === 0 && error === null && (
        <div style={{ padding: '32px 0', textAlign: 'center', opacity: 0.75 }}>
          <p style={{ margin: '0 0 4px' }}>{t('empty.title')}</p>
          <p style={{ margin: 0, fontSize: 12 }}>{t('empty.hint')}</p>
        </div>
      )}

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

    </section>
  )
}
