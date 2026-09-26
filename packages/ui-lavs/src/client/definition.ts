/**
 * Stage one of this package's registration: what the `lavs` tab type IS.
 *
 * The type is a page, not a viewer: it claims no `dsh-resource://` address
 * and is opened by kind — from the guide page's entry box, or through
 * `ctx.sidebarRight.openTab(LAVS_KIND)`. `keepMounted` keeps a visited body
 * mounted through hiding and docking so the bundle iframes' view state
 * survives the panel closing; the sidebar's own layout persistence covers
 * everything the old custom drawer kept by hand (width, visibility).
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const LAVS_KIND = 'lavs'

/** This implementation's identity in the tab system: the key its body registers under. */
export const LAVS_ID = 'dsh-plugin-ui-lavs'

/**
 * The lavs type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function lavsDefinition(t: TranslateNS<'lavs'>): SidebarRightTabDefinition {
  return {
    id: LAVS_ID,
    kind: LAVS_KIND,
    keepMounted: true,
    title: () => t('type.label'),
    guide: [{
      id: 'lavs',
      order: 40,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }
}
