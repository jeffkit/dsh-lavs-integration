/**
 * The tab body's data face: how the browser half reaches the host's
 * `/lavs` Connection channel. The client context is reached through the
 * app-lifetime {@link appRef} handle (slot components receive runtime
 * props, not the plugin Context), so every helper narrows the face it
 * needs and throws a readable error when the plugin is not mounted yet.
 */

import { appRef } from './context.ts'

/** One bundle as the host's `list` returns it. */
export interface LavsWithBundle {
  name: string
  contentType: string
  version: string
  description: string | undefined
  hasView: boolean
  endpoints: Array<{ id: string; method: string; description: string | undefined }>
}

/** The session-summary face this plugin needs (cwd + preset). */
interface SummaryFace {
  cwd?: string
  agentPreset?: string
}

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

/**
 * List the bundles visible to this session: the host scopes by the
 * session's workspace cwd and composed preset, on top of the deployment
 * base roots.
 */
export async function listBundlesFor(ctx: NonNullable<typeof appRef.current>, sessionId: string): Promise<LavsWithBundle[]> {
  const summary = summaryOf(ctx, sessionId)
  const result = await rpcOf().rpc.call('/lavs', 'list', {
    ...(summary.agentPreset === undefined ? {} : { presetId: summary.agentPreset }),
    ...(summary.cwd === undefined ? {} : { workspaceCwd: summary.cwd }),
  })
  if (!result.ok) throw new Error(result.error?.message ?? 'lavs list failed')
  return result.value as LavsWithBundle[]
}

/** Execute one manifest endpoint through the host (the `lavs-call` bridge's backend). */
export async function callBundle(bundle: string, endpoint: string, input: unknown): Promise<unknown> {
  const result = await rpcOf().rpc.call('/lavs', 'call', { bundle, endpoint, input })
  if (!result.ok) throw new Error(result.error?.message ?? 'lavs call failed')
  return result.value
}
