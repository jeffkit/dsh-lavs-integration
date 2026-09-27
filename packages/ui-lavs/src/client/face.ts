/**
 * The tab body's data face: how the browser half reaches the host's
 * `/lavs` Connection channel. The client context is reached through the
 * app-lifetime {@link appRef} handle (slot components receive runtime
 * props, not the plugin Context), so every helper narrows the face it
 * needs and throws a readable error when the plugin is not mounted yet.
 */

import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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

/** The session-summary face this plugin needs (cwd only — v3 scoping is pure project scope). */
interface SummaryFace {
  cwd?: string
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

/** Read the session's cwd off the store (dsh 0.1.7: `SessionStore.get` + `Session.header`). */
function summaryOf(ctx: NonNullable<typeof appRef.current>, sessionId: string): SummaryFace {
  const session = ctx.sessions.get(sessionId as SessionId)
  return { cwd: session?.header.cwd }
}

/**
 * List the bundles visible to this session: the host scopes by the
 * session's workspace cwd — v3 is pure project scope (`.lavs/bundles/`
 * under the working directory, no preset/deployment roots).
 */
export async function listBundlesFor(ctx: NonNullable<typeof appRef.current>, sessionId: string): Promise<LavsWithBundle[]> {
  const summary = summaryOf(ctx, sessionId)
  const result = await rpcOf().rpc.call('/lavs', 'list', {
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
