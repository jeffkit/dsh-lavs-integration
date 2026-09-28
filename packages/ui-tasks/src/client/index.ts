/**
 * Browser tasks plugin: the session's `todos` projection as a native
 * right-Sidebar tab type. Reads ride the standard session-scoped slot kit
 * (`useProjection`); every interaction is sent to the agent as an ordinary
 * queued user message through the sessions service, so the whole surface
 * stays inside the auditable, replayable session log.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer plugin's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: merges the session-scoped standard kit (sessionId, useProjection)
// into the slots system's SessionStandardProps.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the sidebar-right client face (ctx.sidebarRightTabs) must be in the program.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls the client `sessions` Context merge (ISessions) for ctx.sessions.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { appRef } from './context.ts'
import { TASKS_ID, tasksDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { TasksTabBody } from './TasksView.tsx'

/** Required services: the Sidebar tab registry, the tab-body slot, the session registry, and the locale service. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions']

/**
 * Client plugin body: publish the app-lifetime context handle, register the
 * dictionaries, and mount the tab type. Every registration rides an effect
 * wrapper, so plugin unload removes the type and its body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  appRef.current = ctx
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-tasks: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(tasksDefinition(t)), 'ui-tasks: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TASKS_ID, locale: NS },
    TasksTabBody,
  )), 'ui-tasks: tab body')
}
