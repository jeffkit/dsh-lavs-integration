/**
 * LAVS host adapter (`ctx.lavsHost`): mounts Local Agent View Service bundles
 * into the dsh web host.
 *
 * - Discovers `lavs.json` manifests under the configured bundles directory.
 * - Serves each bundle's static view files under `/lavs-view/<bundle>/…`
 *   (same origin as the web app, so the iframe postMessage bridge works).
 * - Exposes the `list` / `call` endpoints on the `/rpc/lavs` Connection
 *   channel: the browser Views tab forwards the spec's `lavs-call` messages
 *   here, and this adapter executes the manifest's script handlers through
 *   `lavs-runtime`'s ScriptExecutor.
 *
 * This is the spec's dispatch-host role embedded in dsh: views render in an
 * iframe, data operations run as local script handlers, and (future work)
 * agent-side tools plus `lavs-agent-action` notifications ride the same
 * `ctx.lavsHost` seam.
 */

import { createReadStream } from 'node:fs'
import { homedir } from 'node:os'
import { readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the connection host-face Context merge (ctx.connection).
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only: pulls the agent-presets Context merge (ctx.agentPresets) and
// the agent-preset/selected event declaration (src/types.ts side).
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { ManifestLoader, ScriptExecutor } from 'lavs-runtime'
import type { LAVSManifest, ScriptHandler } from 'lavs-runtime'

/** Stable Cordis plugin name. */
export const name = 'lavs-host'

/** Host services this adapter composes with. */
export const inject = ['webServer', 'connection', 'tools']

/** Adapter config. */
export interface Config {
  /**
   * Directory (or directories) containing one bundle sub-directory per
   * `lavs.json` manifest. Absent or empty falls back to the stable defaults:
   * `./bundles` beside the launch cwd and `~/.dsh/lavs-bundles`.
   */
  bundlesDir?: string | string[]
  /**
   * Also scan `<preset-dir>/lavs-bundles` for every agent preset and follow
   * `agent-preset/selected`: a session naming a preset whose bundle
   * directory exists gets those bundles (and their agent tools) composed in.
   */
  followPresets?: boolean
}

export const Config: z<Config> = z.object({
  bundlesDir: z.union([z.string(), z.array(z.string())]),
  followPresets: z.boolean(),
})

/** One discovered bundle as the browser sees it. */
export interface LavsBundleInfo {
  name: string
  contentType: string
  version: string
  description: string | undefined
  /** Whether `view/index.html` exists (the iframe entry this adapter serves). */
  hasView: boolean
  endpoints: Array<{ id: string; method: string; description: string | undefined }>
}

/** The `ctx.lavsHost` service face. */
export interface LavsHostService {
  /**
   * List discovered bundles visible to the given preset context.
   * @param presetId - the session's composed preset id (undefined shows
   *   base-root bundles only).
   */
  list(presetId?: string): Promise<LavsBundleInfo[]>
  /**
   * Invoke one manifest endpoint through its script handler.
   * @param bundle - bundle name (manifest `name`).
   * @param endpoint - endpoint id from the manifest.
   * @param input - endpoint input (JSON).
   */
  call(bundle: string, endpoint: string, input: unknown): Promise<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    lavsHost?: LavsHostService
  }
}

/** Static file content types served for bundle views. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

interface BundleEntry {
  manifest: LAVSManifest
  dir: string
  /** The preset id this bundle came from (undefined = a base root). */
  sourcePreset?: string
}

/** Adapt a raw manifest record to the browser-facing shape. */
function toInfo(entry: BundleEntry, hasView: boolean): LavsBundleInfo {
  const m = entry.manifest as unknown as {
    name: string
    contentType?: string
    version: string
    description?: string
    endpoints: Array<{ id: string; method: string; description?: string }>
  }
  return {
    name: m.name,
    contentType: m.contentType ?? m.name,
    version: m.version,
    description: m.description,
    hasView,
    endpoints: m.endpoints.map(e => ({ id: e.id, method: e.method, description: e.description })),
  }
}

type DshSchemaSpec = Record<string, unknown>

/**
 * JSON Schema term (manifest input) → dsh ValueSchemaSpec. Unknown or
 * unsupported shapes fall back to the lossless `json` type so values pass
 * through unchanged even when the manifest uses schema vocabulary dsh's
 * author-facing spec does not model.
 */
function convertTerm(term: unknown): DshSchemaSpec {
  const t = term as {
    type?: unknown
    description?: unknown
    enum?: unknown
    items?: unknown
    properties?: unknown
    required?: unknown
    additionalProperties?: unknown
  } | undefined
  const base: DshSchemaSpec = {}
  if (typeof t?.description === 'string') base.description = t.description
  if (Array.isArray(t?.enum)) base.enum = t.enum
  switch (t?.type) {
    case 'string': return { ...base, type: 'string' }
    case 'number': return { ...base, type: 'number' }
    case 'integer': return { ...base, type: 'integer' }
    case 'boolean': return { ...base, type: 'boolean' }
    case 'null': return { ...base, type: 'null' }
    case 'array':
      return {
        ...base,
        type: 'array',
        ...(t?.items === undefined ? {} : { items: convertTerm(t.items) }),
      }
    case 'object': {
      const props: Record<string, DshSchemaSpec> = {}
      const required = new Set(Array.isArray(t?.required) ? t.required : [])
      for (const [key, nested] of Object.entries((t?.properties ?? {}) as Record<string, unknown>)) {
        const converted = convertTerm(nested)
        if (required.has(key)) converted.required = true
        props[key] = converted
      }
      return {
        ...base,
        type: 'object',
        ...(Object.keys(props).length === 0 ? {} : { properties: props }),
        additionalProperties: t?.additionalProperties !== false,
      }
    }
    default:
      return { ...base, type: 'json' }
  }
}

/**
 * JSON Schema (manifest input) → dsh parameters shape: properties flat with
 * per-field boolean `required`; each term converted via {@link convertTerm}.
 */
function convertParameters(input: unknown): Record<string, DshSchemaSpec> {
  const schema = input as { type?: string; properties?: Record<string, unknown>; required?: string[] } | undefined
  if (schema?.type !== 'object' || schema.properties === undefined) return {}
  const required = new Set(schema.required ?? [])
  const out: Record<string, DshSchemaSpec> = {}
  for (const [key, term] of Object.entries(schema.properties)) {
    const converted = convertTerm(term)
    if (required.has(key)) converted.required = true
    out[key] = converted
  }
  return out
}

/** Spec §7.4.5 agent-action payload delivered to every mounted view. */
interface LavsAgentAction {
  seq: number
  action: {
    type: 'tool_executed'
    tool: string
    contentType: string
    timestamp: number
    result?: unknown
  }
}

/**
 * Mount the LAVS host adapter.
 * @param ctx - Host context carrying the web server and connection services.
 * @param config - Adapter config (bundles directory).
 */
export function apply(ctx: Context, config: Config): void {
  const loader = new ManifestLoader()
  const executor = new ScriptExecutor()
  const bundles = new Map<string, BundleEntry>()
  const declared = config.bundlesDir === undefined ? [] : Array.isArray(config.bundlesDir) ? config.bundlesDir : [config.bundlesDir]
  const baseRoots = (declared.length > 0 ? declared : ['bundles', join(homedir(), '.dsh', 'lavs-bundles')]).map(p => resolve(p))
  const extraRoots = new Set<string>()
  const rootToPreset = new Map<string, string>()
  const toolDisposers: Array<() => void> = []

  const scanRoot = async (root: string, presetId?: string): Promise<void> => {
    let dirs: string[] = []
    try {
      dirs = (await readdir(root, { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => d.name)
    } catch {
      return // an absent or unreadable root simply contributes nothing
    }
    for (const dir of dirs) {
      try {
        const manifest = await loader.load(join(root, dir, 'lavs.json')) as LAVSManifest
        const name = (manifest as unknown as { name: string }).name
        bundles.set(name, { manifest, dir: join(root, dir), ...(presetId === undefined ? {} : { sourcePreset: presetId }) })
      } catch (e) {
        ctx.logger.warn(`lavs-host: skipping bundle "${dir}": ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const loadBundles = async (): Promise<void> => {
    // Re-load from scratch: dispose every previously registered agent tool
    // so a preset's bundles (and their lavs_* tools) leave with the reload.
    for (const dispose of toolDisposers.splice(0)) {
      try { dispose() } catch { /* a disposed registry entry is fine to miss */ }
    }
    bundles.clear()
    usedToolNames.clear()
    for (const root of baseRoots) await scanRoot(root)
    for (const root of extraRoots) await scanRoot(root, rootToPreset.get(root))
    ctx.logger.info(`lavs-host: loaded ${bundles.size} bundle(s) from ${baseRoots.length + extraRoots.size} root(s)`)
    for (const [bundleName, entry] of bundles) registerBundleTools(entry, bundleName)
  }

  if (config.followPresets === true) {
    ctx.inject(['agentPresets'], (presetCtx: Context) => {
      const presets = presetCtx.agentPresets
      // Seed with every currently known preset's bundle directory. All stat
      // probes settle BEFORE the reload, so a present directory can never
      // lose the race with loadBundles.
      void presets.list().then(async (list) => {
        await Promise.all(list.map(async (preset) => {
          const dir = join(dirname(preset.path), 'lavs-bundles')
          try {
            await stat(dir)
            extraRoots.add(dir)
            rootToPreset.set(dir, preset.id)
          } catch { /* most presets ship none */ }
        }))
        await loadBundles()
      }).catch(() => { /* roster absence is fine */ })
      // …and follow live selection: a session naming a preset adds its dir.
      presetCtx.on('agent-preset/selected', (_sessionId: unknown, presetId: unknown) => {
        if (typeof presetId !== 'string') return
        void presets.resolve(presetId).then((preset) => {
          const dir = join(dirname(preset.path), 'lavs-bundles')
          return stat(dir).then(() => dir).catch(() => undefined)
        }).then((dir) => {
          if (dir === undefined) return
          if (extraRoots.has(dir)) return
          extraRoots.add(dir)
          rootToPreset.set(dir, presetId)
          void loadBundles()
        }).catch(() => { /* resolve failures just skip the addition */ })
      })
    })
  }

  const hasViewFile = async (entry: BundleEntry): Promise<boolean> => {
    try {
      await stat(join(entry.dir, 'view', 'index.html'))
      return true
    } catch {
      return false
    }
  }

  const service: LavsHostService = {
    async list(presetId?: string): Promise<LavsBundleInfo[]> {
      if (bundles.size === 0) await loadBundles()
      const infos: LavsBundleInfo[] = []
      for (const entry of bundles.values()) {
        // A preset-sourced bundle is visible only to sessions running that
        // preset; base-root bundles are visible to every session.
        if (entry.sourcePreset !== undefined && entry.sourcePreset !== presetId) continue
        infos.push(toInfo(entry, await hasViewFile(entry)))
      }
      return infos
    },
    async call(bundle: string, endpoint: string, input: unknown): Promise<unknown> {
      const entry = bundles.get(bundle)
      if (entry === undefined) throw new Error(`lavs-host: unknown bundle "${bundle}"`)
      const m = entry.manifest as unknown as {
        endpoints: Array<{ id: string; handler: ScriptHandler }>
        permissions?: Record<string, unknown>
      }
      const found = m.endpoints.find(e => e.id === endpoint)
      if (found === undefined) throw new Error(`lavs-host: bundle "${bundle}" has no endpoint "${endpoint}"`)
      return await executor.execute(found.handler, input ?? {}, {
        endpointId: endpoint,
        agentId: 'dsh-web',
        workdir: entry.dir,
        permissions: (m.permissions ?? {}) as never,
      })
    },
  }
  ctx.provide('lavsHost', service)

  // ── Agent-action log + SSE fan-out (spec §7.4.5) ────────────────────
  // Every mutation executed through the agent tools (below) appends one
  // action; the /lavs/events SSE route streams new actions to every
  // connected browser, which forwards them into the mounted view iframes
  // as `lavs-agent-action` messages so views refresh without polling.
  let actionSeq = 0
  const recentActions: LavsAgentAction[] = []
  const actionListeners = new Set<(action: LavsAgentAction) => void>()
  const recordAction = (action: Omit<LavsAgentAction, 'seq'>): void => {
    const full: LavsAgentAction = { seq: ++actionSeq, ...action }
    recentActions.push(full)
    if (recentActions.length > 100) recentActions.shift()
    for (const listener of actionListeners) {
      try { listener(full) } catch { /* a slow subscriber never blocks others */ }
    }
  }

  ctx.webServer.register({
    kind: 'exact',
    path: '/lavs/events',
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
      })
      // Initial comment flushes the headers immediately for every client
      // (some stacks hold a response with headers-only until first body byte).
      res.write(': connected\n\n')
      const send = (action: LavsAgentAction): void => {
        res.write(`data: ${JSON.stringify(action)}\n\n`)
      }
      // Replay the tail so a late subscriber still sees the latest action
      // (views treat any action as a refresh signal, so one is enough).
      const tail = recentActions.at(-1)
      if (tail !== undefined) send(tail)
      actionListeners.add(send)
      req.on('close', () => { actionListeners.delete(send); res.end() })
    },
  })

  // ── Agent tools (AI Sync): every query/mutation endpoint becomes a
  // `lavs_<endpoint>` tool; execution rides the same script handlers and
  // records an agent-action so mounted views refresh (spec's AI half).
  const usedToolNames = new Set<string>()
  void toolDisposers // referenced by loadBundles above
  const registerBundleTools = (entry: BundleEntry, bundleName: string): void => {
    const m = entry.manifest as unknown as {
      name: string
      contentType?: string
      endpoints: Array<{
        id: string
        method: string
        description?: string
        schema?: { input?: unknown }
      }>
    }
    const contentType = m.contentType ?? m.name
    for (const endpoint of m.endpoints) {
      if (endpoint.method !== 'query' && endpoint.method !== 'mutation') continue
      let toolName = `lavs_${endpoint.id}`
      if (usedToolNames.has(toolName)) toolName = `lavs_${bundleName}_${endpoint.id}`
      if (usedToolNames.has(toolName)) continue
      usedToolNames.add(toolName)
      toolDisposers.push(ctx.tools.register(defineTool({
        name: toolName,
        description: endpoint.description ?? `LAVS ${endpoint.method} "${endpoint.id}" on bundle "${bundleName}"`,
        parameters: convertParameters(endpoint.schema?.input) as unknown as ParameterSchemaSpec,
        output: {
          schema: { type: 'json' },
          render: (_args: unknown, value: unknown) => [{
            type: 'text',
            text: `${toolName}: ${JSON.stringify(value)}`,
          }],
        },
        execute(args: Record<string, unknown>) {
          return service.call(bundleName, endpoint.id, args).then((result) => {
            if (endpoint.method === 'mutation') {
              recordAction({
                action: {
                  type: 'tool_executed',
                  tool: toolName,
                  contentType,
                  timestamp: Date.now(),
                  ...(result === undefined ? {} : { result }),
                },
              })
            }
            return result
          }) as Promise<unknown> as Promise<never>
        },
        presentCall: (callArgs: unknown) => ({ card: 'generic', title: toolName, kind: 'other', rawInput: callArgs }),
      })))
    }
  }

  // Static view serving: /lavs-view/<bundle>/<path within bundle dir>.
  // Path traversal is contained by resolving against the bundle directory
  // and requiring the normalized result to stay under it.
  ctx.webServer.register({
    kind: 'prefix',
    path: '/lavs-view',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      try {
        const url = new URL(req.url ?? '/', 'http://lavs.local')
        const segments = url.pathname.split('/').filter(s => s !== '')
        // ['lavs-view', <bundle>, ...rest]
        const bundleName = segments[1]
        if (bundleName === undefined || bundleName.includes('..')) {
          res.statusCode = 404
          res.end('unknown bundle')
          return
        }
        const rest = segments.slice(2).join('/')
        const entry = bundles.get(bundleName)
        if (entry === undefined) {
          res.statusCode = 404
          res.end('unknown bundle')
          return
        }
        const target = normalize(join(entry.dir, rest))
        if (target !== entry.dir && !target.startsWith(entry.dir + sep)) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }
        const type = extname(target).toLowerCase()
        const mime = MIME[type]
        if (mime === undefined) {
          res.statusCode = 415
          res.end('unsupported file type')
          return
        }
        const info = await stat(target).catch(() => undefined)
        if (info === undefined || !info.isFile()) {
          res.statusCode = 404
          res.end('not found')
          return
        }
        res.setHeader('content-type', mime)
        res.setHeader('cache-control', 'no-store')
        createReadStream(target).pipe(res)
      } catch {
        res.statusCode = 500
        res.end('internal error')
      }
    },
  })

  // Browser RPC channel: POST /rpc/lavs/{list|call}. Errors fold to the
  // closed 'internal' code — the message carries the LAVS detail.
  ctx.inject(['connection'], (connectionCtx: Context) => {
    void connectionCtx.connection.rpc.handle(
      '/lavs',
      async (endpoint: string, payload: unknown) => {
        try {
          if (endpoint === 'list') {
            const p = payload as { presetId?: unknown }
            return { ok: true, value: await service.list(typeof p?.presetId === 'string' ? p.presetId : undefined) }
          }
          if (endpoint === 'call') {
            const p = payload as { bundle?: unknown; endpoint?: unknown; input?: unknown }
            if (typeof p.bundle !== 'string' || typeof p.endpoint !== 'string') {
              return { ok: false, error: { code: 'internal', message: 'bundle and endpoint must be strings', details: {} } }
            }
            return { ok: true, value: await service.call(p.bundle, p.endpoint, p.input) }
          }
          return { ok: false, error: { code: 'internal', message: `unknown lavs endpoint "${endpoint}"`, details: {} } }
        } catch (e) {
          return { ok: false, error: { code: 'internal', message: e instanceof Error ? e.message : String(e), details: {} } }
        }
      },
    )
  })

  if (config.followPresets !== true) void loadBundles()
}
