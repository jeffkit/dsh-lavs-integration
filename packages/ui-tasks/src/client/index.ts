/**
 * Browser tasks plugin: one `conversation.view` tab rendering the `todos`
 * session projection as a first-class task application. Reads are projection
 * snapshots (zero client-side folding); every interaction is sent to the
 * agent as an ordinary queued user message through the session prompt verb,
 * so the whole surface stays inside the auditable, replayable session log.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, RpcResult } from '@deepseek-ai/dsh-api-remotes/client'

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer plugin's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the session plugin's Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, NS, zh } from './locales.ts'
import { TasksView, type TaskItemView, type TasksViewInjected } from './TasksView.tsx'

/** Required services: the conversation view slot, ordinary Session binding, and the locale service. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Client plugin body: register the tasks view tab. The registration rides
 * the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-tasks: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'tasks',
    order: 15,
    locale: NS,
    label: () => t('view.tasks'),
    inject: (sessionId: SessionId): TasksViewInjected => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) {
        throw new Error(`ui-tasks: session "${sessionId}" is unavailable`)
      }
      return {
        todos: session.projections.faceOf('todos') as ObservableSnapshot<TaskItemView[] | null>,
        send: (text: string) => session.prompt([{ type: 'text', text }], 'queue')
          .then((result: RpcResult<{ accepted: true }>) => { if (!result.ok) throw new Error(result.error.message) }),
      }
    },
  }, TasksView))
}
