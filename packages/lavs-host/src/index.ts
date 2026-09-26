/**
 * LAVS host adapter (`ctx.lavsHost`): mounts Local Agent View Service bundles
 * into the dsh web host.
 *
 * - Discovers `lavs.json` manifests under the session workspace's
 *   `.lavs/bundles/` directory — views are PROJECT property: what a session
 *   sees is exactly what its working directory declares, nothing global.
 * - Serves each bundle's static view files under `/lavs-view/<bundle>/…`
 *   (same origin as the web app, so the iframe postMessage bridge works).
 * - Exposes the `list` / `call` endpoints on the `/lavs` Connection
 *   channel: the browser Views tab forwards the spec's `lavs-call` messages
 *   here, and this adapter executes the manifest's script handlers through
 *   `lavs-runtime`'s ScriptExecutor.
 *
 * This is the spec's dispatch-host role embedded in dsh: views render in an
 * iframe, data operations run as local script handlers, and (future work)
 * agent-side tools plus `lavs-agent-action` notifications ride the same
 * `ctx.lavsHost` seam.
 */

import { chmodSync, createReadStream, mkdirSync, watch, writeFileSync, unlinkSync, type FSWatcher } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { readdir, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { visibleEntries } from './scope.ts'
// Type-only: pulls the webServer Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the connection host-face Context merge (ctx.connection).
import type {} from '@deepseek-ai/dsh-client-connection'
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
   * Register every bundle query/mutation endpoint as a `lavs_<endpoint>`
   * agent tool. Off by default: N tools × schema is a fixed context tax;
   * the agent path is the `lavs` CLI plus a skill, which load per scenario.
   */
  registerAgentTools?: boolean
  /**
   * Serve the CLI listener: a loopback-only HTTP endpoint (Bearer token,
   * discovery file `~/.dsh/lavs-host.json`) so the `lavs` CLI routes
   * list/call through this process — one writer, mutations stay auditable
   * and fan out to mounted views. On by default.
   */
  cli?: boolean
  /** Fixed port for the CLI listener; absent binds an ephemeral loopback port. */
  cliPort?: number
}

export const Config: z<Config> = z.object({
  registerAgentTools: z.boolean(),
  cli: z.boolean(),
  cliPort: z.number(),
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
  list(presetId?: string, workspaceCwd?: string): Promise<LavsBundleInfo[]>
  /**
   * Invoke one manifest endpoint through its script handler. Every mutation
   * records an agent-action so mounted views refresh, whichever surface
   * (browser RPC, CLI, or agent tool) drove the write.
   * @param bundle - bundle name (manifest `name`).
   * @param endpoint - endpoint id from the manifest.
   * @param input - endpoint input (JSON).
   * @param source - the calling surface, surfaced in the action log.
   */
  call(bundle: string, endpoint: string, input: unknown, source?: string): Promise<unknown>
  /**
   * Endpoint-level view of one bundle's manifest: the CLI `schema` verb's
   * payload (ids, methods, descriptions, declared input schemas).
   */
  describe(bundle: string): Promise<LavsBundleSchema | undefined>
}

/** Endpoint-level manifest projection served to the CLI. */
export interface LavsBundleSchema {
  name: string
  contentType: string
  version: string
  description?: string
  endpoints: Array<{
    id: string
    method: string
    description?: string
    input?: unknown
  }>
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
  /** The workspace cwd this bundle came from (always set: views are project property). */
  sourceWorkspace: string
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

/** Spec §7.4.5 action payload delivered to every mounted view. */
interface LavsAgentAction {
  seq: number
  action:
    | { type: 'tool_executed'; tool: string; contentType: string; timestamp: number; result?: unknown }
    | { type: 'bundles_changed'; timestamp: number }
}

/**
 * Mount the LAVS host adapter.
 * @param ctx - Host context carrying the web server and connection services.
 */
export function apply(ctx: Context, config: Config): void {
  const loader = new ManifestLoader()
  const executor = new ScriptExecutor()
  const bundles = new Map<string, BundleEntry>()
  /** Project bundle roots discovered so far — one per session workspace. */
  const projectRoots = new Set<string>()
  const rootToWorkspace = new Map<string, string>()
  /** One watcher per live project bundle dir — changes re-scan and fan out. */
  const workspaceWatchers = new Map<string, FSWatcher>()
  const toolDisposers: Array<() => void> = []

  const scanRoot = async (root: string, workspaceCwd: string): Promise<void> => {
    let entries: Array<{ name: string }> = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return // an absent or unreadable root simply contributes nothing
    }
    for (const entry of entries) {
      const dir = join(root, entry.name)
      // stat (not the dirent): a bundle may be a symlink into a shared store.
      const info = await stat(dir).catch(() => undefined)
      if (info === undefined || !info.isDirectory()) continue
      try {
        const manifest = await loader.load(join(dir, 'lavs.json')) as LAVSManifest
        const name = (manifest as unknown as { name: string }).name
        bundles.set(name, {
          manifest, dir,
          sourceWorkspace: workspaceCwd,
        })
      } catch (e) {
        ctx.logger.warn(`lavs-host: skipping bundle "${entry.name}": ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  /**
   * Ensure the workspace's project root (`<cwd>/.lavs/bundles`) is scanned
   * before the caller lists — THE discovery path: a session sees exactly the
   * bundles its working directory declares. Every list re-stats the directory
   * (one syscall), so a project that gains `.lavs/bundles/` mid-session is
   * discovered on the next list without a restart; once present, the fs
   * watcher keeps it live.
   */
  const ensureWorkspaceRoot = async (workspaceCwd: string): Promise<void> => {
    const dir = join(workspaceCwd, '.lavs', 'bundles')
    try {
      await stat(dir)
    } catch {
      return
    }
    projectRoots.add(dir)
    rootToWorkspace.set(dir, workspaceCwd)
    // Hot project data: watch the bundle dir so manifests added, fixed, or
    // removed mid-session reach the drawer without a reopen. Debounced —
    // one authored save tends to emit several events.
    if (!workspaceWatchers.has(dir)) {
      try {
        const watcher = watch(dir, { persistent: false })
        let timer: ReturnType<typeof setTimeout> | undefined
        watcher.on('change', () => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            void loadBundles().then(() => {
              recordAction({ type: 'bundles_changed', timestamp: Date.now() })
            }).catch(() => { /* a failed rescan keeps the last good tree */ })
          }, 400)
        })
        workspaceWatchers.set(dir, watcher)
      } catch { /* watch unavailable — pull-based list still works */ }
    }
    await loadBundles()
  }

  ctx.effect(() => () => {
    for (const watcher of workspaceWatchers.values()) watcher.close()
    workspaceWatchers.clear()
  }, 'lavs-host: workspace watchers')

  const loadBundles = async (): Promise<void> => {
    // Re-load from scratch: dispose every previously registered agent tool
    // so a project's bundles (and their lavs_* tools) leave with the reload.
    for (const dispose of toolDisposers.splice(0)) {
      try { dispose() } catch { /* a disposed registry entry is fine to miss */ }
    }
    bundles.clear()
    usedToolNames.clear()
    for (const root of projectRoots) await scanRoot(root, rootToWorkspace.get(root) as string)
    ctx.logger.info(`lavs-host: loaded ${bundles.size} bundle(s) from ${projectRoots.size} project root(s)`)
    for (const [bundleName, entry] of bundles) registerBundleTools(entry, bundleName)
  }

  const hasViewFile = async (entry: BundleEntry): Promise<boolean> => {
    try {
      await stat(join(entry.dir, 'view', 'index.html'))
      return true
    } catch {
      return false
    }
  }

  // ── Agent-action log + SSE fan-out (spec §7.4.5) ────────────────────
  // Every mutation executed through the service (whichever surface drove
  // it: browser RPC, the `lavs` CLI, or an agent tool) appends one action;
  // the /lavs/events SSE route streams new actions to every connected
  // browser, which forwards them into the mounted view iframes as
  // `lavs-agent-action` messages so views refresh without polling.
  let actionSeq = 0
  const recentActions: LavsAgentAction[] = []
  const actionListeners = new Set<(action: LavsAgentAction) => void>()
  const recordAction = (action: LavsAgentAction['action']): void => {
    const full: LavsAgentAction = { seq: ++actionSeq, action }
    recentActions.push(full)
    if (recentActions.length > 100) recentActions.shift()
    for (const listener of actionListeners) {
      try { listener(full) } catch { /* a slow subscriber never blocks others */ }
    }
  }

  const service: LavsHostService = {
    async list(presetId?: string, workspaceCwd?: string): Promise<LavsBundleInfo[]> {
      if (workspaceCwd !== undefined) await ensureWorkspaceRoot(workspaceCwd)
      if (bundles.size === 0) await loadBundles()
      const infos: LavsBundleInfo[] = []
      for (const entry of visibleEntries(bundles.values(), presetId, workspaceCwd)) {
        infos.push(toInfo(entry, await hasViewFile(entry)))
      }
      return infos
    },
    async call(bundle: string, endpoint: string, input: unknown, source?: string): Promise<unknown> {
      if (bundles.size === 0) await loadBundles()
      const entry = bundles.get(bundle)
      if (entry === undefined) throw new Error(`lavs-host: unknown bundle "${bundle}"`)
      const m = entry.manifest as unknown as {
        name: string
        contentType?: string
        endpoints: Array<{ id: string; handler: ScriptHandler; method?: string }>
        permissions?: Record<string, unknown>
      }
      const found = m.endpoints.find(e => e.id === endpoint)
      if (found === undefined) throw new Error(`lavs-host: bundle "${bundle}" has no endpoint "${endpoint}"`)
      const result = await executor.execute(found.handler, input ?? {}, {
        endpointId: endpoint,
        agentId: source === undefined ? 'dsh-web' : `dsh-${source}`,
        workdir: entry.dir,
        permissions: (m.permissions ?? {}) as never,
      })
      // One writer, one audit log: a mutation records an agent-action and
      // fans out to every mounted view regardless of the driving surface.
      if (found.method === 'mutation') {
        recordAction({
          type: 'tool_executed',
          tool: source === undefined ? `web:${bundle}.${endpoint}` : `${source}:${bundle}.${endpoint}`,
          contentType: m.contentType ?? m.name,
          timestamp: Date.now(),
          ...(result === undefined ? {} : { result }),
        })
      }
      return result
    },
    async describe(bundle: string): Promise<LavsBundleSchema | undefined> {
      if (bundles.size === 0) await loadBundles()
      const entry = bundles.get(bundle)
      if (entry === undefined) return undefined
      const m = entry.manifest as unknown as {
        name: string
        contentType?: string
        version: string
        description?: string
        endpoints: Array<{ id: string; method: string; description?: string; schema?: { input?: unknown } }>
      }
      return {
        name: m.name,
        contentType: m.contentType ?? m.name,
        version: m.version,
        description: m.description,
        endpoints: m.endpoints.map(e => ({
          id: e.id, method: e.method, description: e.description,
          ...(e.schema?.input === undefined ? {} : { input: e.schema.input }),
        })),
      }
    },
  }
  ctx.provide('lavsHost', service)

  // ── /lavs/events SSE route ───────────────────────────────────────────
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

  // ── CLI listener: loopback-only HTTP with a Bearer token, so the `lavs`
  // CLI routes list/schema/call through THIS process. One writer keeps
  // mutations auditable and fan-out intact; direct storage writes from a
  // separate process would leave mounted views stale. The discovery file
  // (~/.dsh/lavs-host.json) publishes {port, token, pid}; the CLI reads it.
  if (config.cli !== false) {
    const token = randomBytes(24).toString('base64url')
    const discoveryPath = join(homedir(), '.dsh', 'lavs-host.json')
    const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolveBody, rejectBody) => {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1_048_576) { rejectBody(new Error('body too large')); req.destroy(); return }
        chunks.push(chunk)
      })
      req.on('end', () => { resolveBody(Buffer.concat(chunks).toString('utf8')) })
      req.on('error', rejectBody)
    })
    const server = createServer((req: IncomingMessage, res: ServerResponse): void => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401
        res.end('unauthorized')
        return
      }
      const url = new URL(req.url ?? '/', 'http://lavs.local')
      const respond = (code: number, value: unknown): void => {
        res.statusCode = code
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(value))
      }
      void (async (): Promise<void> => {
        if (req.method === 'GET' && url.pathname === '/health') {
          respond(200, { ok: true })
          return
        }
        if (req.method === 'GET' && url.pathname === '/schema') {
          const bundle = url.searchParams.get('bundle')
          if (bundle === null || bundle === '') { respond(400, { error: 'bundle query parameter required' }); return }
          respond(200, await service.describe(bundle))
          return
        }
        if (req.method === 'POST' && (url.pathname === '/list' || url.pathname === '/call' || url.pathname === '/schema')) {
          const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
          if (url.pathname === '/list') {
            respond(200, await service.list(
              typeof body.presetId === 'string' ? body.presetId : undefined,
              typeof body.workspaceCwd === 'string' ? body.workspaceCwd : undefined,
            ))
            return
          }
          if (url.pathname === '/schema') {
            respond(200, await service.describe(typeof body.bundle === 'string' ? body.bundle : ''))
            return
          }
          if (typeof body.bundle !== 'string' || typeof body.endpoint !== 'string') {
            respond(400, { error: 'bundle and endpoint must be strings' })
            return
          }
          respond(200, { result: await service.call(body.bundle, body.endpoint, body.input, 'cli') })
          return
        }
        respond(404, { error: 'unknown route' })
      })().catch((e: unknown) => {
        respond(500, { error: e instanceof Error ? e.message : String(e) })
      })
    })
    server.listen(config.cliPort ?? 0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      mkdirSync(dirname(discoveryPath), { recursive: true })
      // 0600: the file carries the bearer token; any local reader could
      // otherwise execute bundle scripts through the listener.
      writeFileSync(discoveryPath, JSON.stringify({ port, token, pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 })
      chmodSync(discoveryPath, 0o600)
      ctx.logger.info(`lavs-host: cli listener on 127.0.0.1:${port} (discovery at ${discoveryPath})`)
    })
    ctx.effect(() => () => {
      server.close()
      try { unlinkSync(discoveryPath) } catch { /* already gone */ }
    }, 'lavs-host: cli listener')
  }

  // ── Agent tools (AI Sync, opt-in): every query/mutation endpoint becomes
  // a `lavs_<endpoint>` tool. Off by default — N tools × schema is a fixed
  // context tax; the default agent path is the `lavs` CLI plus a skill.
  // When enabled, execution rides the same service.call as every surface.
  const usedToolNames = new Set<string>()
  void toolDisposers // referenced by loadBundles above
  const registerBundleTools = (entry: BundleEntry, bundleName: string): void => {
    if (config.registerAgentTools !== true) return
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
          return service.call(bundleName, endpoint.id, args, `tool:${toolName}`) as Promise<never>
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

  // Browser RPC channel: POST /lavs/{list|call}. Mounted directly on the
  // webServer (the connection service's own rpc.handle reads `webServer`
  // from the connection plugin's fiber, which never declares it, so external
  // channels cannot use it). Auth rides the connection service's admission
  // fence; the wire envelope mirrors the shared-channel bridge exactly —
  // request {type:'client-request', rpcId, method, payload}, response
  // {type:'server-response', rpcId, result}.
  ctx.inject(['connection', 'webServer'], (connectionCtx: Context) => {
    const connection = connectionCtx.connection
    const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolveBody, rejectBody) => {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1_048_576) { rejectBody(new Error('body too large')); req.destroy(); return }
        chunks.push(chunk)
      })
      req.on('end', () => { resolveBody(Buffer.concat(chunks).toString('utf8')) })
      req.on('error', rejectBody)
    })
    const respondResult = (res: ServerResponse, rpcId: string, result: unknown): void => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
    }
    ctx.webServer.register({
      kind: 'prefix',
      path: '/lavs',
      handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const admission = connection.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection)
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        const url = new URL(req.url ?? '/', 'http://lavs.local')
        const segments = url.pathname.split('/').filter(s => s !== '')
        // ['lavs', endpoint]
        const endpoint = segments[1]
        if (req.method !== 'POST' || endpoint === undefined) {
          res.writeHead(404)
          res.end('not found')
          return
        }
        let message: { rpcId?: unknown; method?: unknown; payload?: unknown }
        try {
          message = JSON.parse((await readBody(req)) || '{}') as { rpcId?: unknown; method?: unknown; payload?: unknown }
        } catch {
          res.writeHead(400)
          res.end('body is not JSON')
          return
        }
        const rpcId = typeof message.rpcId === 'string' ? message.rpcId : 'invalid'
        if (message.method !== endpoint) {
          respondResult(res, rpcId, { ok: false, error: { code: 'gateway/bad-request', message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`, details: {} } })
          return
        }
        try {
          if (endpoint === 'list') {
            const p = message.payload as { presetId?: unknown; workspaceCwd?: unknown }
            respondResult(res, rpcId, {
              ok: true,
              value: await service.list(
                typeof p?.presetId === 'string' ? p.presetId : undefined,
                typeof p?.workspaceCwd === 'string' ? p.workspaceCwd : undefined,
              ),
            })
            return
          }
          if (endpoint === 'call') {
            const p = message.payload as { bundle?: unknown; endpoint?: unknown; input?: unknown }
            if (typeof p.bundle !== 'string' || typeof p.endpoint !== 'string') {
              respondResult(res, rpcId, { ok: false, error: { code: 'internal', message: 'bundle and endpoint must be strings', details: {} } })
              return
            }
            respondResult(res, rpcId, { ok: true, value: await service.call(p.bundle, p.endpoint, p.input) })
            return
          }
          respondResult(res, rpcId, { ok: false, error: { code: 'internal', message: `unknown lavs endpoint "${endpoint}"`, details: {} } })
        } catch (e) {
          respondResult(res, rpcId, { ok: false, error: { code: 'internal', message: e instanceof Error ? e.message : String(e), details: {} } })
        }
      },
    })
  })
}
