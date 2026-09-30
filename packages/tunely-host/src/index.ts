/**
 * tunely-host（`ctx.tunely`）：把 tunely 公网隧道客户端**跑在 dsh 进程内**。
 *
 * 与 sidecar 形态（`tunely connect` 子进程 + 状态文件）的差别：
 * - 零子进程、零状态文件、零额外部署物——`dsh plugin add dsh-bundle-tunely` 即挂载；
 * - 生命周期跟随宿主：cordis fiber dispose 时统一 stop，profile 重载（HMR）自动重建；
 * - 单进程 N 条隧道（`tunnels` 数组 / `TUNELY_TUNNELS` env），会话标签区分日志；
 * - targetUrl 缺省就是**本机 dsh web**（`ctx.webServer.port`）——典型用法是把内网的
 *   dsh 控制台经 tunely 公网域名暴露（如 dsht.example.com → 127.0.0.1:<port>）。
 *
 * 复用 `tunely`（npm）客户端 SDK 的既有语义：认证/心跳/自动重连/指数退避/抢占。
 * 配置取值优先级 config > env > 默认，见 ./resolve.ts。
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer Context merge (ctx.webServer / ctx.webServer.port).
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { TunnelClient } from 'tunely'
import type { TunnelClientConfig } from 'tunely'
import {
  resolveTunnels,
  type Config as ResolvedConfig,
  type TunnelEntryConfig,
  type TunnelSpec,
} from './resolve.ts'

export { TUNNEL_DEFAULTS } from './resolve.ts'
export type { TunnelEntryConfig, TunnelSpec } from './resolve.ts'

/** Stable Cordis plugin name. */
export const name = 'tunely-host'

/** Host services this adapter composes with. */
export const inject = ['webServer']

/** Adapter config. */
export type Config = ResolvedConfig

export const Config: z<Config> = z.object({
  tunnels: z.array(
    z.object({
      name: z.string(),
      serverUrl: z.string(),
      token: z.string(),
      targetUrl: z.string(),
      force: z.boolean(),
      reconnectInterval: z.number(),
      maxReconnectAttempts: z.number(),
      requestTimeout: z.number(),
      keepaliveInterval: z.number(),
      keepaliveTimeout: z.number(),
      enabled: z.boolean(),
    }),
  ),
})

/** 一条隧道的运行时快照（`list()` 的行）。 */
export interface TunelyStatus {
  name: string
  serverUrl: string
  targetUrl: string
  connected: boolean
  /** 服务端分配的公网域名；未连接时为 null。 */
  domain: string | null
  lastError: string | null
  uptimeMs: number
}

/** `ctx.tunely` 服务面。 */
export interface TunelyService {
  /** 当前运行中的隧道快照。 */
  list(): TunelyStatus[]
  /** 停止一条隧道（配置保留，可再次 start）；返回是否存在该名称的运行实例。 */
  stop(name: string): boolean
  /** （重新）启动一条隧道；返回是否存在该名称的配置。 */
  start(name: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tunely: TunelyService
  }
}

interface TunnelRun {
  spec: TunnelSpec
  client: TunnelClient
  state: {
    connected: boolean
    domain: string | null
    lastError: string | null
    startedAt: number
  }
}

export function apply(ctx: Context, config: Config): void {
  // schemastery 对缺失的数组字段会自动填 []（z.array(undefined) → []，已实测），
  // 会把「未配置」伪装成「显式关闭」、掐断 env 回落——这里归一化回 undefined，
  // 让 resolveTunnels 的「config 缺省 → TUNELY_TUNNELS / TUNELY_TOKEN」链路可用。
  const normalized = config.tunnels && config.tunnels.length > 0 ? config : undefined
  const { tunnels, skipped } = resolveTunnels(normalized, process.env, ctx.webServer.port)
  for (const s of skipped) {
    ctx.logger.warn(`tunely-host: skipping tunnel${s.name ? ` "${s.name}"` : ''}: ${s.reason}`)
  }
  if (tunnels.length === 0) {
    ctx.logger.warn(
      'tunely-host: 没有可用隧道配置——在 config.tunnels 给出，或设置 TUNELY_TOKEN（单条）/ TUNELY_TUNNELS（多条 JSON）',
    )
  }

  /** 运行实例表（name → run）。 */
  const runs = new Map<string, TunnelRun>()
  /** 已解析配置表（name → spec），供 stop 后再次 start。 */
  const specs = new Map<string, TunnelSpec>()

  const forget = (name: string, run: TunnelRun): void => {
    if (runs.get(name) === run) runs.delete(name)
  }

  const start = (spec: TunnelSpec): void => {
    const existing = runs.get(spec.name)
    if (existing !== undefined) existing.client.stop()

    const client = new TunnelClient(toClientConfig(spec))
    const run: TunnelRun = {
      spec,
      client,
      state: { connected: false, domain: null, lastError: null, startedAt: Date.now() },
    }
    client.on('onConnect', (domain) => {
      run.state.connected = true
      run.state.domain = domain
      run.state.lastError = null
      ctx.logger.info(`tunely-host: [${spec.name}] connected ${domain} → ${spec.targetUrl}`)
    })
    client.on('onDisconnect', () => {
      run.state.connected = false
      ctx.logger.warn(`tunely-host: [${spec.name}] disconnected，按退避策略重连`)
    })
    client.on('onError', (err) => {
      run.state.lastError = err?.message ?? String(err)
      ctx.logger.warn(`tunely-host: [${spec.name}] error: ${run.state.lastError}`)
    })

    runs.set(spec.name, run)
    void client.run().then(
      () => {
        ctx.logger.info(`tunely-host: [${spec.name}] client exited`)
        forget(spec.name, run)
      },
      (err) => {
        ctx.logger.warn(`tunely-host: [${spec.name}] client crashed: ${err?.message ?? String(err)}`)
        forget(spec.name, run)
      },
    )
  }

  const service: TunelyService = {
    list(): TunelyStatus[] {
      return [...runs.values()].map((r) => ({
        name: r.spec.name,
        serverUrl: r.spec.serverUrl,
        targetUrl: r.spec.targetUrl,
        connected: r.state.connected,
        domain: r.state.domain,
        lastError: r.state.lastError,
        uptimeMs: Date.now() - r.state.startedAt,
      }))
    },
    stop(name: string): boolean {
      const run = runs.get(name)
      if (run === undefined) return false
      // 同步摘除：stop 语义即时可见（list 不再包含），run() 的善后由 forget 兜底
      runs.delete(name)
      run.client.stop()
      return true
    },
    start(name: string): boolean {
      const spec = specs.get(name)
      if (spec === undefined) return false
      start(spec)
      return true
    },
  }
  ctx.provide('tunely', service)

  for (const spec of tunnels) {
    specs.set(spec.name, spec)
    start(spec)
  }

  // 生命周期：宿主/profile 停卸（含 HMR 重载）时统一停流，避免孤儿 WS 连接
  // 挂着 token 心跳。stop() 幂等，重复触发无害。
  ctx.effect(
    () => () => {
      for (const run of runs.values()) run.client.stop()
    },
    'tunely-host: stop tunnels',
  )
}

function toClientConfig(spec: TunnelSpec): TunnelClientConfig {
  return {
    serverUrl: spec.serverUrl,
    token: spec.token,
    targetUrl: spec.targetUrl,
    name: spec.name,
    force: spec.force,
    reconnectInterval: spec.reconnectInterval,
    maxReconnectAttempts: spec.maxReconnectAttempts,
    requestTimeout: spec.requestTimeout,
    keepaliveInterval: spec.keepaliveInterval,
    keepaliveTimeout: spec.keepaliveTimeout,
  }
}
