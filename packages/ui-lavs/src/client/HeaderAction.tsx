/**
 * Session-header LAVS entry: a data-driven button plus the views drawer.
 *
 * Visibility follows the data: the button queries the host for bundles
 * scoped to THIS session (workspace cwd + agent preset + deployment base)
 * and renders nothing when no viewable bundle applies — a project without
 * LAVS data shows no entry at all. A load failure is NOT treated as "no
 * data": the entry stays visible in a warning state with a retry path, so
 * a transient RPC blip never makes the surface silently vanish.
 *
 * The drawer stays MOUNTED for the session's lifetime once bundles are
 * known (only its visibility flips), so iframe view state survives
 * open/close cycles. Live bundle changes ride the host's SSE stream.
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { appRef } from './context.ts'
import { LavsDrawer, type LavsWithBundle } from './Drawer.tsx'

/** The session-summary face this entry needs (cwd + preset). */
interface SummaryFace {
  cwd?: string
  agentPreset?: string
}

type HeaderActionProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'lavs'>

/** Connection RPC face as used here (narrowed from the client context). */
interface RpcFace {
  rpc: {
    call: (channel: string, endpoint: string, payload: unknown) => Promise<{
      ok: boolean
      value?: unknown
      error?: { message: string }
    }>
  }
}

function rpcOf(): RpcFace {
  const ctx = appRef.current
  if (ctx === undefined) throw new Error('lavs: client context unavailable')
  return ctx.get('connection') as RpcFace
}

/** Read the session's summary off the store snapshot (fresh per call). */
function summaryOf(ctx: NonNullable<typeof appRef.current>, sessionId: string): SummaryFace {
  const state = ctx.sessions.list.getSnapshot() as { byId?: Record<string, SummaryFace> }
  return state.byId?.[sessionId] ?? {}
}

async function listBundlesFor(ctx: NonNullable<typeof appRef.current>, sessionId: string): Promise<LavsWithBundle[]> {
  const summary = summaryOf(ctx, sessionId)
  const result = await rpcOf().rpc.call('/lavs', 'list', {
    ...(summary.agentPreset === undefined ? {} : { presetId: summary.agentPreset }),
    ...(summary.cwd === undefined ? {} : { workspaceCwd: summary.cwd }),
  })
  if (!result.ok) throw new Error(result.error?.message ?? 'lavs list failed')
  return result.value as LavsWithBundle[]
}

async function callBundle(bundle: string, endpoint: string, input: unknown): Promise<unknown> {
  const result = await rpcOf().rpc.call('/lavs', 'call', { bundle, endpoint, input })
  if (!result.ok) throw new Error(result.error?.message ?? 'lavs call failed')
  return result.value
}

export function LavsHeaderAction({ sessionId, t }: HeaderActionProps): JSX.Element | null {
  const [bundles, setBundles] = useState<LavsWithBundle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = (): void => {
    const ctx = appRef.current
    if (ctx === undefined) return
    listBundlesFor(ctx, sessionId)
      .then((list) => { setBundles(list); setError(null) })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        setError(message)
        console.warn(`lavs: bundle list failed — the entry stays visible with a retry path (${message})`)
      })
  }

  // Re-query when the session changes; the host scopes by this session's
  // cwd + preset, so the entry only appears where data exists.
  useEffect(() => {
    setBundles(null)
    setError(null)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session is the driver; refresh reads fresh state
  }, [sessionId])

  const loading = bundles === null && error === null
  const viewable = bundles?.filter(b => b.hasView) ?? []
  // Data-driven visibility: still loading or genuinely no applicable bundle
  // → no entry. Load FAILURES keep the entry (warning style + retry).
  if (loading) return null
  if (error === null && viewable.length === 0) return null

  const hasError = error !== null

  return (
    <>
      <button
        type="button"
        aria-label={hasError ? `${t('view.lavs')} — ${error}` : t('view.lavs')}
        title={hasError ? `${t('view.lavs')}: ${error}` : t('view.lavs')}
        aria-expanded={open}
        onClick={() => { setOpen(v => !v) }}
        style={{
          border: `1px solid color-mix(in srgb, currentColor 25%, transparent)`,
          background: open
            ? 'color-mix(in srgb, currentColor 12%, transparent)'
            : 'transparent',
          color: hasError ? '#b54708' : 'inherit',
          cursor: 'pointer',
          borderRadius: 999,
          padding: '2px 10px',
          fontSize: 12,
          fontWeight: open ? 600 : 400,
        }}
      >
        {hasError ? `${t('view.lavs')} ⚠` : t('view.lavs')}
      </button>
      {viewable.length > 0 || hasError ? (
        <LavsDrawer
          open={open}
          bundles={viewable}
          error={error}
          onRetry={() => { setError(null); refresh() }}
          forwardCall={callBundle}
          onBundlesChanged={refresh}
          onClose={() => { setOpen(false) }}
          t={t}
        />
      ) : null}
    </>
  )
}
