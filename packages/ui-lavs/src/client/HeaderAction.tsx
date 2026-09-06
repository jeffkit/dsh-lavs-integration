/**
 * Session-header LAVS entry: a data-driven button plus the views drawer.
 *
 * Visibility follows the data: the button queries the host for bundles
 * scoped to THIS session (workspace cwd + agent preset + deployment base)
 * and renders nothing when no viewable bundle applies — a project without
 * LAVS data shows no entry at all. Clicking toggles the right-side drawer.
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

/** Read the session's summary off the store snapshot (fresh per call). */
function summaryOf(ctx: NonNullable<typeof appRef.current>, sessionId: string): SummaryFace {
  const state = ctx.sessions.list.getSnapshot() as { byId?: Record<string, SummaryFace> }
  return state.byId?.[sessionId] ?? {}
}

async function listBundlesFor(ctx: NonNullable<typeof appRef.current>, sessionId: string): Promise<LavsWithBundle[]> {
  const connection = ctx.get('connection') as {
    rpc: { call: (channel: string, endpoint: string, payload: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> }
  }
  const summary = summaryOf(ctx, sessionId)
  const result = await connection.rpc.call('/lavs', 'list', {
    ...(summary.agentPreset === undefined ? {} : { presetId: summary.agentPreset }),
    ...(summary.cwd === undefined ? {} : { workspaceCwd: summary.cwd }),
  })
  if (!result.ok) throw new Error(result.error?.message ?? 'lavs list failed')
  return result.value as LavsWithBundle[]
}

export function LavsHeaderAction({ sessionId, t }: HeaderActionProps): JSX.Element | null {
  const [bundles, setBundles] = useState<LavsWithBundle[] | null>(null)
  const [open, setOpen] = useState(false)

  // Re-query when the session changes; the host scopes by this session's
  // cwd + preset, so the entry only appears where data exists.
  useEffect(() => {
    let alive = true
    setBundles(null)
    const ctx = appRef.current
    if (ctx === undefined) return undefined
    listBundlesFor(ctx, sessionId)
      .then((list) => { if (alive) setBundles(list) })
      .catch(() => { if (alive) setBundles([]) })
    return () => { alive = false }
  }, [sessionId])

  const viewable = bundles?.filter(b => b.hasView) ?? []
  // Data-driven visibility: no applicable viewable bundle → no entry.
  if (viewable.length === 0) return null

  const forwardCall = (bundle: string, endpoint: string, input: unknown): Promise<unknown> => {
    const ctx = appRef.current
    if (ctx === undefined) return Promise.reject(new Error('lavs: client context unavailable'))
    const connection = ctx.get('connection') as {
      rpc: { call: (channel: string, endpoint: string, payload: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> }
    }
    return connection.rpc.call('/lavs', 'call', { bundle, endpoint, input }).then((result) => {
      if (!result.ok) throw new Error(result.error?.message ?? 'lavs call failed')
      return result.value
    })
  }

  return (
    <>
      <button
        type="button"
        aria-label={t('view.lavs')}
        title={t('view.lavs')}
        aria-expanded={open}
        onClick={() => { setOpen(v => !v) }}
        style={{
          border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
          background: open ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          borderRadius: 999,
          padding: '2px 10px',
          fontSize: 12,
          fontWeight: open ? 600 : 400,
        }}
      >
        {t('view.lavs')}
      </button>
      {open && (
        <LavsDrawer
          bundles={viewable}
          forwardCall={forwardCall}
          onClose={() => { setOpen(false) }}
          t={t}
        />
      )}
    </>
  )
}
