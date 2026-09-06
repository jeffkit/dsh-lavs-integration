/**
 * Shared tsdown presets for out-of-tree dsh plugin packages.
 *
 * The node half is an ordinary esm library: peer dependencies stay imports.
 * The client half implements dsh's dynamic client-module contract (see
 * upstream packages/client/tsdown.client.ts): a CJS browser bundle wrapped in
 * the closure factory the loader's module table executes —
 * `window.__ModuleLoader__.load({id, factory})` — where requested specifiers
 * resolve through the injected `require` and everything else inlines.
 * Value imports of `@deepseek-ai/dsh-*` in client code are forbidden by that
 * contract; our client halves only value-import react, so the external list
 * is the platform baseline plus each package's own request list.
 */
import type { UserConfig } from 'tsdown'

/** The loader module-table baseline every dynamic client bundle may request. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** Node-half library: esm, peers external, no dts (nobody consumes our types). */
export function nodeLib(entry: Record<string, string>, external: readonly string[]): UserConfig {
  return {
    entry,
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    sourcemap: false,
    clean: false,
    external: [...external],
  }
}

/**
 * Browser client bundle: CJS closure factory at lib/client.js.
 * @param id - plugin id (package name), stamped into the __ModuleLoader__ handoff.
 * @param requested - extra module-table specifiers beyond the platform baseline.
 */
export function clientBundle(id: string, requested: readonly string[] = []): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...PLATFORM_MODULES, ...requested],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapExcludeSources: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}
