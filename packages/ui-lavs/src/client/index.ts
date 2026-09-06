/**
 * Browser LAVS plugin: a session-header entry opening the views drawer.
 * Bundle visibility is data-driven — the host scopes list/call by the
 * session's workspace cwd and agent preset, and the header entry renders
 * nothing for sessions whose project carries no LAVS bundles. The spec's
 * postMessage bridge (`lavs-call` → `lavs-result`/`lavs-error`) is routed
 * to the `/lavs` Connection channel served by the `lavs-host` adapter, so
 * query/mutation execute the manifest's local script handlers unchanged —
 * dsh becomes a spec-conformant LAVS dispatch host.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer plugin's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the session plugin's Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the header-actions SlotMap row must be in the program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { appRef } from './context.ts'
import { en, NS, zh } from './locales.ts'
import { LavsHeaderAction } from './HeaderAction.tsx'

export type { LavsBundleCard } from './Drawer.tsx'

/** Required services: the header action slot, the connection RPC caller, the session registry, and the locale service. */
export const inject = ['slots', 'connection', 'sessions', 'locale']

/**
 * Client plugin body: publish the app-lifetime context handle, register the
 * dictionaries, and mount the header entry. The registration rides the slot
 * service's effect wrapper, so plugin unload removes the entry.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  appRef.current = ctx
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-lavs: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'lavs',
    // After ui-jobs (20): process work reads before data views.
    order: 30,
    locale: NS,
  }, LavsHeaderAction))
}
