/**
 * Browser LAVS plugin: the LAVS views as a native right-Sidebar tab type.
 *
 * The tab reaches the Sidebar through its public path only — the definition
 * into `ctx.sidebarRightTabs`, the body into the keyed
 * `sidebar.right.pane.tab` seat under the definition's `id` — the same
 * route the shipped `ui-sidebar-files` type takes; nothing here touches the
 * Sidebar's store, panes, or sequence. Layout chrome (width, collapse,
 * splits, persistence) belongs to the Sidebar; this package owns only the
 * content: bundle discovery scoped per session, the spec §7.4 postMessage
 * bridge (`lavs-call` → `lavs-result`/`lavs-error`) routed to the `/lavs`
 * Connection channel served by the `lavs-host` adapter, and the
 * `/lavs/events` SSE fan-out into mounted iframes.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer plugin's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the session plugin's Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the sidebar-right client face (ctx.sidebarRightTabs) must be in the program.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { appRef } from './context.ts'
import { LAVS_ID, lavsDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { LavsTabBody } from './LavsTabBody.tsx'

/** Required services: the Sidebar tab registry, the tab-body slot, the connection RPC caller, the session registry, and the locale service. */
export const inject = ['slots', 'connection', 'sessions', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body: publish the app-lifetime context handle, register the
 * dictionaries, and mount the tab type. Every registration rides an effect
 * wrapper, so plugin unload removes the type and its body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  appRef.current = ctx
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-lavs: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(lavsDefinition(t)), 'ui-lavs: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: LAVS_ID, locale: NS },
    LavsTabBody,
  )), 'ui-lavs: tab body')
}
