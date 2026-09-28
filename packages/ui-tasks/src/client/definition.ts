/**
 * Stage one of this package's registration: what the `tasks` tab type IS.
 *
 * The type is a page, not a viewer: it claims no `dsh-resource://` address
 * and is opened by kind — from the guide page's entry, or through
 * `ctx.sidebarRight.openTab(TASKS_KIND)`. `keepMounted` keeps a visited body
 * mounted through hiding and docking so the composer draft survives panel
 * closes; the todo list itself is projection-backed and needs no help.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const TASKS_KIND = 'tasks'

/** This implementation's identity in the tab system: the key its body registers under. */
export const TASKS_ID = 'dsh-plugin-ui-tasks'

/**
 * The tasks type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function tasksDefinition(t: TranslateNS<'tasks'>): SidebarRightTabDefinition {
  return {
    id: TASKS_ID,
    kind: TASKS_KIND,
    keepMounted: true,
    title: () => t('view.tasks'),
    guide: [{
      id: 'tasks',
      order: 45,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }
}
