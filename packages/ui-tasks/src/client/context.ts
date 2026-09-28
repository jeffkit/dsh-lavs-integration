/**
 * App-lifetime client context handle for slot components.
 *
 * Slot components receive runtime props — sessionId, projection hook,
 * locale — but not the plugin Context. The sessions service (the queued
 * user-message path) is reached through this reference, which `apply()`
 * sets once for the client app's lifetime.
 */
import type { Context } from '@deepseek-ai/cordis'

export const appRef: { current: Context | undefined } = { current: undefined }
