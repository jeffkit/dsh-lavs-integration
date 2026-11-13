/**
 * Mobile gateway (`mobile-gateway`): same-origin REST/SSE facade over the
 * host's session services, plus static hosting for the mobile UI.
 *
 * - One prefix route `/api/mobile` (auth: required — rides the shared
 *   webserver admission fence, so a logged-in browser cookie is the only
 *   credential) routes every REST endpoint and the per-session SSE stream.
 * - The SSE stream bridges `ctx.sessionController.follow` frames (snapshot /
 *   durable events / assistant-stream token deltas) with tunnel-safe
 *   heartbeats and request-close cancellation.
 * - When `staticDir` is configured, the built mobile UI is served under `/m`
 *   (same origin, cookie-gated).
 *
 * Session-controller access is bridged through a local minimal interface:
 * the dsh public APIs are pre-stable and the pinned devDeps types lag the
 * runtime, so only the exact call surface we use is declared here.
 */

import { createReadStream, stat } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { extname, join, normalize, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the connection host-face Context merge (ctx.connection).
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only: pulls the sessionController Context merge when the pinned
// devDeps declare one; runtime access below is bridged defensively.
import type {} from '@deepseek-ai/dsh-api-session-controller'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'mobile-gateway'

/** Host services this gateway composes with. */
export const inject = ['webServer', 'connection', 'sessionController']

/** Gateway config. */
export interface Config {
  /** Built mobile UI directory served under `/m`; absent = no static route. */
  staticDir?: string
  /** Default working directory for sessions created without an explicit cwd. */
  defaultCwd?: string
}

// 仓内可选字段的惯用写法：fork 的 Schema 类型面无 optional() 实例方法，
// 默认 'plain' 模式即非必填（缺省键运行时为 undefined，同 tunely-host 的 proxy）。
export const Config: z<Config> = z.object({
  staticDir: z.string(),
  defaultCwd: z.string(),
})

// ---------------------------------------------------------------------------
// Bridged session-controller surface (pre-stable upstream; see file header).
// ---------------------------------------------------------------------------

export interface MobileSessionAddress {
  kind: 'session'
  sessionId: string
}

export type MobileSessionSummary = Record<string, unknown>

export interface MobileEventsPage {
  records?: Array<{ seq?: number; event?: { type?: string; data?: unknown } } & Record<string, unknown>>
  hasMore?: boolean
  cursor?: unknown
  [key: string]: unknown
}

export type MobileFollowFrame = Record<string, unknown>

export interface MobileSessionController {
  list(request: object, signal?: AbortSignal): Promise<{ items?: MobileSessionSummary[] } & Record<string, unknown>>
  create(
    request: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string },
    signal?: AbortSignal,
  ): Promise<{ sessionId: string; agentPreset?: string } & Record<string, unknown>>
  prompt(
    request: {
      requestId: string
      sessionId: string
      mode?: 'queue' | 'steer'
      content: Array<{ type: 'text'; text: string }>
      clientTimeZone?: string
    },
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean } & Record<string, unknown>>
  cancel(request: { sessionId: string }, signal?: AbortSignal): Promise<{ accepted: boolean } & Record<string, unknown>>
  events(
    request: { address: MobileSessionAddress; beforeSeq?: number; maxMessages?: number; turnWindow?: number },
    signal?: AbortSignal,
  ): Promise<MobileEventsPage>
  state(request: { sessionId: string }, signal?: AbortSignal): Promise<Record<string, unknown>>
  follow(
    request: {
      address: MobileSessionAddress
      activate?: boolean
      assistantStream?: boolean
      maxMessages?: number
      turnWindow?: number
    },
    signal?: AbortSignal,
  ): AsyncIterable<MobileFollowFrame>
}

/** Pull a host service off the context without depending on augmentation drift. */
function service<T>(ctx: Context, key: string): T {
  const value = (ctx as unknown as Record<string, unknown>)[key]
  if (value === undefined) throw new Error(`mobile-gateway: host service ${key} is unavailable`)
  return value as T
}

/**
 * Unary session calls want a signal (the 0.2.x runtime calls
 * `signal.throwIfAborted()`); these requests outlive via their response, so a
 * never-aborted controller per request satisfies the contract.
 */
function neverAbort(): AbortController {
  return new AbortController()
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 1_048_576

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectBody)
  })
}

function respondJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

function errorStatus(error: unknown): number {
  const message = String((error as Error | undefined)?.message ?? error)
  if (/not-found/i.test(message)) return 404
  if (/invalid|input/i.test(message)) return 400
  return 500
}

// ---------------------------------------------------------------------------
// Static file serving (mobile UI under /m)
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function createStaticHandler(staticDir: string) {
  const root = normalize(staticDir.endsWith(sep) ? staticDir : staticDir + sep)
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://mobile.local')
      const relative = url.pathname.slice('/m'.length).replace(/^\/+/, '')
      const target = normalize(join(root, relative === '' ? 'index.html' : relative))
      if (target !== root && !target.startsWith(root)) {
        res.statusCode = 403
        res.end('forbidden')
        return
      }
      const info = await new Promise<import('node:fs').Stats | undefined>((resolveStat) => {
        // node 回调成功时 err 为 null（非 undefined），两者都要放行
        stat(target, (err, stats) => resolveStat(err == null ? stats : undefined))
      })
      const isFile = info?.isFile() === true
      if (!isFile) {
        // 诊断：回退 index.html 的请求路径与原因（stderr 走实例日志）
        console.error(`[mobile-gateway] fallback-to-index: url=${req.url} relative=${JSON.stringify(relative)} target=${target} statErr=${info === undefined ? 'missing' : 'not-file'}`)
      }
      const file = isFile ? target : join(root, 'index.html')
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
      res.setHeader('content-type', type)
      // Vite emits content-hashed asset names; only the entry must revalidate.
      res.setHeader('cache-control', file.endsWith('index.html') ? 'no-store' : 'public, max-age=604800')
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(file).pipe(res)
    } catch {
      res.statusCode = 500
      res.end('internal error')
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

/** Session event types that mark a finished model turn (client relies on this). */
const TURN_END_EVENT = 'turn/end'

/**
 * The pinned devDeps WebRoute type face predates the runtime's `auth` field
 * (webserver 0.2.x); the runtime honors it, so route objects carry `auth` and
 * are cast at the register boundary.
 */
type RegisterRoute = Parameters<Context['webServer']['register']>[0]
function routeWithAuth(route: {
  kind: 'prefix'
  path: string
  auth: 'required' | 'anonymous' | 'deny'
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}): RegisterRoute {
  return route as unknown as RegisterRoute
}

export function apply(ctx: Context, config: Config): void {
  const sessions = service<MobileSessionController>(ctx, 'sessionController')

  ctx.effect(
    () =>
      ctx.webServer.register(
        routeWithAuth({
          kind: 'prefix',
          path: '/api/mobile',
          auth: 'required',
          handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
          const url = new URL(req.url ?? '/', 'http://mobile.local')
          const path = url.pathname
          const method = req.method ?? 'GET'
          try {
            // -- GET /api/mobile/health ------------------------------------
            if (path === '/api/mobile/health' && method === 'GET') {
              respondJson(res, 200, { ok: true, gateway: 'mobile-gateway', turnEndEvent: TURN_END_EVENT })
              return
            }

            // -- GET|POST /api/mobile/sessions ------------------------------
            if (path === '/api/mobile/sessions' && method === 'GET') {
              const value = await sessions.list({}, neverAbort().signal)
              respondJson(res, 200, value)
              return
            }
            if (path === '/api/mobile/sessions' && method === 'POST') {
              const body = JSON.parse((await readBody(req)) || '{}') as { cwd?: string }
              const request: { cwd?: string } = {}
              const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : config.defaultCwd
              if (cwd !== undefined) request.cwd = cwd
              const value = await sessions.create(request, neverAbort().signal)
              respondJson(res, 200, value)
              return
            }

            // -- /api/mobile/sessions/:id[/{prompt,cancel,events,stream}] ---
            const match = /^\/api\/mobile\/sessions\/([^/]+)(?:\/(prompt|cancel|events|stream))?$/.exec(path)
            if (match !== null) {
              const sessionId = decodeURIComponent(match[1])
              const action = match[2]

              if (action === undefined && method === 'GET') {
                respondJson(res, 200, await sessions.state({ sessionId }, neverAbort().signal))
                return
              }

              if (action === 'prompt' && method === 'POST') {
                const body = JSON.parse((await readBody(req)) || '{}') as {
                  text?: string
                  mode?: 'queue' | 'steer'
                  requestId?: string
                }
                const text = typeof body.text === 'string' ? body.text : ''
                if (text.trim() === '') {
                  respondJson(res, 400, { error: 'text is required' })
                  return
                }
                const value = await sessions.prompt(
                  {
                    requestId: typeof body.requestId === 'string' && body.requestId !== '' ? body.requestId : randomUUID(),
                    sessionId,
                    mode: body.mode === 'steer' ? 'steer' : 'queue',
                    content: [{ type: 'text', text }],
                    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  },
                  neverAbort().signal,
                )
                respondJson(res, 200, value)
                return
              }

              if (action === 'cancel' && method === 'POST') {
                respondJson(res, 200, await sessions.cancel({ sessionId }, neverAbort().signal))
                return
              }

              if (action === 'events' && method === 'GET') {
                const beforeRaw = url.searchParams.get('before')
                const maxRaw = url.searchParams.get('max')
                const value = await sessions.events(
                  {
                    address: { kind: 'session', sessionId },
                    beforeSeq: beforeRaw !== null && beforeRaw !== '' ? Number(beforeRaw) : undefined,
                    maxMessages: maxRaw !== null && maxRaw !== '' ? Number(maxRaw) : undefined,
                  },
                  neverAbort().signal,
                )
                respondJson(res, 200, value)
                return
              }

              if (action === 'stream' && method === 'GET') {
                const ac = new AbortController()
                req.on('close', () => ac.abort())
                res.writeHead(200, {
                  'content-type': 'text/event-stream; charset=utf-8',
                  'cache-control': 'no-store',
                  connection: 'keep-alive',
                  'x-accel-buffering': 'no',
                })
                res.write('retry: 3000\n\n')
                const heartbeat = setInterval(() => {
                  if (!res.writableEnded) res.write(': hb\n\n')
                }, 15000)
                try {
                  const stream = sessions.follow(
                    { address: { kind: 'session', sessionId }, activate: true, assistantStream: true },
                    ac.signal,
                  )
                  for await (const frame of stream) {
                    if (ac.signal.aborted) break
                    res.write(`data: ${JSON.stringify(frame)}\n\n`)
                  }
                } catch (error) {
                  if (!ac.signal.aborted && !res.writableEnded) {
                    res.write(`event: error\ndata: ${JSON.stringify({ message: String(error) })}\n\n`)
                  }
                } finally {
                  clearInterval(heartbeat)
                  if (!res.writableEnded) res.end()
                }
                return
              }
            }

            respondJson(res, 404, { error: `no route: ${method} ${path}` })
          } catch (error) {
            respondJson(res, errorStatus(error), { error: String((error as Error | undefined)?.message ?? error) })
          }
            },
          }),
        ),
    'mobile-gateway: /api/mobile facade',
  )

  // Optional static hosting of the built mobile UI.
  if (config.staticDir !== undefined && config.staticDir !== '') {
    const handler = createStaticHandler(config.staticDir)
    ctx.effect(
      () =>
        ctx.webServer.register(
          routeWithAuth({
            kind: 'prefix',
            path: '/m',
            auth: 'required',
            handler,
          }),
        ),
      'mobile-gateway: /m static UI',
    )
    ctx.logger?.info?.('mobile-gateway: serving mobile UI from %s', config.staticDir)
  } else {
    ctx.logger?.info?.('mobile-gateway: REST/SSE facade mounted at /api/mobile (no staticDir; UI not served)')
  }
}
