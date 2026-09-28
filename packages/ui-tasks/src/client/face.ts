/**
 * The tab body's interaction face: sending one ordinary queued user message
 * into the owning session. The sessions service is reached through the
 * app-lifetime {@link appRef} handle (slot components receive runtime props,
 * not the plugin Context); the binding is present whenever the tab body is
 * mounted because a right-Sidebar pane exists only for retained sessions.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the client `sessions` Context merge (ISessions) for ctx.sessions.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { appRef } from './context.ts'

/**
 * Send `text` into the session as an ordinary queued user message — the same
 * admission path the composer takes, so the action lands in the auditable,
 * replayable session log and the agent performs it with its own todo tool.
 */
export async function sendQueuedMessage(sessionId: SessionId, text: string): Promise<void> {
  const ctx = appRef.current
  if (ctx === undefined) throw new Error('tasks: client context unavailable')
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) throw new Error(`tasks: session "${sessionId}" has no live binding`)
  const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
  if (!result.ok) throw new Error(`tasks.send failed: ${result.error.code}: ${result.error.message}`)
}
