/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-tasks`.
 * @module @deepseek-ai/dsh-client-ui-tasks/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-tasks'

/** Cordis companion plugin name. */
export const name = 'client-ui-tasks-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a zero-dependency projection reader — it emits no
 * cordis events itself and mutates nothing (every interaction routes through
 * the session prompt verb); registration is asserted by behavior specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
