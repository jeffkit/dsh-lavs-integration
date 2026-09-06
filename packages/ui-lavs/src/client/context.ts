/**
 * App-lifetime client context handle for slot components.
 *
 * Slot components (session header actions) receive runtime props — sessionId,
 * store hooks, locale — but not the plugin Context. The connection RPC face
 * and the session-summary snapshot are reached through this reference, which
 * `apply()` sets once for the client app's lifetime.
 */
import type { Context } from '@deepseek-ai/cordis'

export const appRef: { current: Context | undefined } = { current: undefined }
