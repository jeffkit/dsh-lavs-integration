/**
 * Browser LAVS Views plugin: one `conversation.view` tab mounting LAVS view
 * bundles in an iframe. The spec's postMessage bridge (`lavs-call` →
 * `lavs-result`/`lavs-error`) is routed to the `/rpc/lavs` Connection
 * channel served by the `lavs-host` adapter, so query/mutation execute the
 * manifest's local script handlers unchanged — dsh becomes a spec-conformant
 * LAVS dispatch host.
 *
 * Bundle visibility follows the session's composed preset: base-root bundles
 * (deployment-wide) are always listed; a preset-local bundle appears only
 * when the session runs that preset (the host adapter filters by the
 * `presetId` this client reads from the session summary on every list).
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, RpcResult } from '@deepseek-ai/dsh-api-remotes/client'

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer plugin's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the session plugin's Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: the 'conversation.view' SlotMap row must be in the program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, NS, zh } from './locales.ts'
import { ViewsView, type LavsBundleCard, type ViewsViewInjected } from './ViewsView.tsx'

/** Required services: the conversation view slot, the connection RPC caller, the session registry, and the locale service. */
export const inject = ['slots', 'connection', 'sessions', 'locale']

// The connection Context merge is not part of the client type program; read
// the service through the store and narrow by its runtime face (same pattern
// as ui-deliverables).
const connectionOf = (ctx: Context): ConnectionHandle => ctx.get('connection') as ConnectionHandle

/** The session-summary face the preset read needs (avoiding a full ISessions import). */
interface SessionSummaryLike {
  agentPreset?: string
}

/**
 * Read the session's currently composed preset id, re-read on every call so
 * a blank session that switches presets immediately filters accordingly.
 */
const presetOf = (ctx: Context, sessionId: SessionId): string | undefined => {
  const state = ctx.sessions.list.getSnapshot() as { byId?: Record<string, SessionSummaryLike> }
  return state.byId?.[sessionId]?.agentPreset
}

/**
 * Client plugin body: register the Views tab. The registration rides the
 * slot service's effect wrapper, so plugin unload removes the tab and its
 * message listener with it.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-lavs: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'lavs',
    order: 20,
    locale: NS,
    label: () => t('view.lavs'),
    inject: (sessionId: SessionId): ViewsViewInjected => {
      const connection = connectionOf(ctx)
      return {
        listBundles: async (): Promise<LavsBundleCard[]> => {
          const presetId = presetOf(ctx, sessionId)
          const result: RpcResult<unknown> = await connection.rpc.call('/lavs', 'list', { presetId })
          if (!result.ok) throw new Error(result.error.message)
          return result.value as LavsBundleCard[]
        },
        forwardCall: async (bundle: string, endpoint: string, input: unknown): Promise<unknown> => {
          const result: RpcResult<unknown> = await connection.rpc.call('/lavs', 'call', { bundle, endpoint, input })
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
      }
    },
  }, ViewsView))
}
