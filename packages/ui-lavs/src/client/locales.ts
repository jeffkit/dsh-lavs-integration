/** `lavs` namespace dictionaries (the tab type + sidebar tab body copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'type.label': 'LAVS 视图',
  'guide.title': 'LAVS 视图',
  'guide.description': '本会话可用的 LAVS bundle 视图面板',
  'empty.title': '当前会话没有可用的 LAVS 视图',
  'empty.hint': '在项目下放 .lavs/bundles/<bundle>/lavs.json，或在宿主侧配置 bundlesDir / extraBundleDirs。',
  'pick.bundle': '选择 bundle',
  'load.loading': '正在加载 bundle 列表…',
  'load.error': '加载 bundle 列表失败',
  'load.retry': '重试',
  'view.open.tab': '整页打开',
} satisfies Record<string, string>

/** The lavs namespace key union. */
export type LavsKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The LAVS sidebar tab type and its body strings. */
    'lavs': LavsKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'type.label': 'LAVS views',
  'guide.title': 'LAVS views',
  'guide.description': 'Panel of the LAVS bundle views visible to this session',
  'empty.title': 'No LAVS views for this session',
  'empty.hint': 'Place .lavs/bundles/<bundle>/lavs.json in the project, or configure bundlesDir / extraBundleDirs on the host.',
  'pick.bundle': 'Choose a bundle',
  'load.loading': 'Loading the bundle list…',
  'load.error': 'Failed to load the bundle list',
  'load.retry': 'Retry',
  'view.open.tab': 'Open full page',
} satisfies Record<LavsKey, string>

/** Locale namespace owned by this plugin. */
export const NS = 'lavs'
