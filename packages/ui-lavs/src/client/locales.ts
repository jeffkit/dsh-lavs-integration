/** `lavs` namespace dictionaries (the header entry + drawer copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.lavs': '视图',
  'empty.title': '当前项目没有可用的 LAVS 视图',
  'empty.hint': '在项目下放 .lavs/bundles/<bundle>/lavs.json，或在宿主侧配置 bundlesDir。',
  'pick.bundle': '选择 bundle',
  'load.error': '加载 bundle 列表失败',
  'drawer.close': '关闭视图面板',
  'drawer.title': 'LAVS 视图',
  'drawer.open.tab': '整页打开',
} satisfies Record<string, string>

/** The lavs namespace key union. */
export type LavsKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The LAVS header entry and drawer strings. */
    'lavs': LavsKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'view.lavs': 'Views',
  'empty.title': 'No LAVS views in this project',
  'empty.hint': 'Place .lavs/bundles/<bundle>/lavs.json in the project, or configure bundlesDir on the host.',
  'pick.bundle': 'Choose a bundle',
  'load.error': 'Failed to load the bundle list',
  'drawer.close': 'Close the views panel',
  'drawer.title': 'LAVS views',
  'drawer.open.tab': 'Open full page',
} satisfies Record<LavsKey, string>

/** Locale namespace owned by this plugin. */
export const NS = 'lavs'
