/**
 * The one-shot app's command-line provider: it parses the task positional,
 * `--resume`, `--print-session-id`, and `--help`, then publishes
 * {@link HEADLESS_STARTUP_SERVICE}. The runner is an ordinary consumer whose
 * lazy config waits for that service.
 * @module @deepseek-ai/dsh-headless/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'headless-resume-startup'

/** Services required before the task can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the one-shot runner. */
export const HEADLESS_STARTUP_SERVICE = 'headlessStartup'

/** What the runner row reads from {@link HEADLESS_STARTUP_SERVICE}. */
export interface HeadlessStartupValues {
  /** The task text this invocation asked for. */
  task: string
  /** The persisted session id to resume instead of creating a fresh Agent. */
  resume: string | undefined
  /** Whether to print the run's session id to stderr for process wrappers. */
  printSessionId: boolean
}

/**
 * This app's command: the task positional, its options, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function headlessCommand(): Command {
  return new Command()
    .name('dsh --profile headless')
    .description('Answer one task, stream reasoning to stderr, print the final assistant message, and exit.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'the task text; multiple words are joined by spaces')
    .option('--resume <session-id>', 'resume a persisted session for one more turn instead of starting a new one')
    .option('--print-session-id', 'print this run\'s session id to stderr (for process wrappers to capture)')
    .addHelpText('after', `
Examples:
  dsh --profile headless "run the tests"     answer one task and exit
  dsh --profile headless --print-session-id "run the tests"    also print the session id
  dsh --profile headless --resume <session-id> "follow up"     continue a persisted session
`)
}

/**
 * Parse and provide the one-shot task as an ordinary Cordis service. The
 * command's action publishes the startup values; a missing or whitespace-only
 * task is a usage error, so on rejection (and on `--help`) nothing is
 * provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = headlessCommand()
  program.action(() => {
    const task = program.args.join(' ')
    if (task.trim() === '') program.error('error: a task is required, for example: dsh --profile headless "run the tests"')
    const options = program.opts<{ resume?: unknown; printSessionId?: unknown }>()
    const resume = typeof options.resume === 'string' ? options.resume.trim() : ''
    if (options.resume !== undefined && resume === '') program.error('error: --resume needs a session id')
    ctx.provide(HEADLESS_STARTUP_SERVICE, {
      task,
      resume: resume === '' ? undefined : resume,
      printSessionId: options.printSessionId === true,
    } satisfies HeadlessStartupValues)
  })
  parseCmdline(ctx, program)
}
