/** `lavs` namespace dictionaries (the Views tab's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.lavs': '视图',
  'empty.title': '没有可用的 LAVS bundle',
  'empty.hint': '在宿主侧配置 lavs-host 的 bundlesDir 指向包含 lavs.json 的 bundle 目录。',
  'pick.bundle': '选择 bundle',
  'load.error': '加载 bundle 列表失败',
} satisfies Record<string, string>

/** The lavs namespace key union. */
export type LavsKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The LAVS Views tab label and status strings. */
    'lavs': LavsKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'view.lavs': 'Views',
  'empty.title': 'No LAVS bundles available',
  'empty.hint': 'Point the lavs-host bundlesDir at a directory of lavs.json bundles on the host.',
  'pick.bundle': 'Choose a bundle',
  'load.error': 'Failed to load the bundle list',
} satisfies Record<LavsKey, string>

/** Locale namespace owned by this plugin. */
export const NS = 'lavs'
