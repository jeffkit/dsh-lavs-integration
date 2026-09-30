/**
 * tunely-host 配置解析（纯函数，无副作用，便于单测）。
 *
 * 每条隧道的取值优先级：**插件 config > 环境变量 > 内置默认**——与 tunely CLI
 * 的旗标优先级保持同一套心智（TUNELY_TOKEN / TUNELY_SERVER / TUNELY_TARGET）。
 * 密钥类字段（token）天然适合走 env：config 文件可以进仓库而不泄漏令牌。
 *
 * 多条隧道的 env 形态：`TUNELY_TUNNELS` = JSON 数组（元素即 TunnelEntryConfig），
 * 仅在 config.tunnels 未定义时生效——config 显式给出（哪怕是空数组）就视为
 * 「明确表态」，不再回落 env。
 */

export interface TunnelEntryConfig {
  /** 会话标签；缺省自动编号 tunnel-1/2/…（须唯一，重复者跳过并告警） */
  name?: string
  /** 服务端 WebSocket URL；env TUNELY_SERVER */
  serverUrl?: string
  /** 隧道令牌；env TUNELY_TOKEN */
  token?: string
  /** 转发目标；env TUNELY_TARGET；都缺省 = 本机 dsh web（webServer.port） */
  targetUrl?: string
  /** 总是抢占已有连接 */
  force?: boolean
  /** 重连基础间隔（ms），默认 5000 */
  reconnectInterval?: number
  /** 最大重连次数（0 = 无限），默认 0 */
  maxReconnectAttempts?: number
  /** 单请求超时（ms），默认 300000 */
  requestTimeout?: number
  /** keepalive ping 周期（ms），默认 25000 */
  keepaliveInterval?: number
  /** keepalive 判死超时（ms），默认 45000 */
  keepaliveTimeout?: number
  /** false = 显式停用该条（跳过，不告警级错误） */
  enabled?: boolean
}

export interface Config {
  tunnels?: TunnelEntryConfig[]
}

/** 一条已解析、可直接交给 TunnelClient 的隧道。 */
export interface TunnelSpec {
  name: string
  serverUrl: string
  token: string
  targetUrl: string
  force: boolean
  reconnectInterval: number
  maxReconnectAttempts: number
  requestTimeout: number
  keepaliveInterval: number
  keepaliveTimeout: number
}

export interface SkippedTunnel {
  name?: string
  reason: string
}

/** 与 tunely TS 客户端的内置默认一致（ms）。 */
export const TUNNEL_DEFAULTS = {
  reconnectInterval: 5000,
  maxReconnectAttempts: 0,
  requestTimeout: 300_000,
  keepaliveInterval: 25_000,
  keepaliveTimeout: 45_000,
  force: false,
} as const

/** 解析入口。webServerPort 用于 targetUrl 的最终缺省（本机 dsh web）。 */
export function resolveTunnels(
  config: Config | undefined,
  env: NodeJS.ProcessEnv,
  webServerPort: number,
): { tunnels: TunnelSpec[]; skipped: SkippedTunnel[] } {
  const skipped: SkippedTunnel[] = []
  const entries = pickEntries(config, env, skipped)
  const tunnels: TunnelSpec[] = []
  const seen = new Set<string>()

  for (const [i, entry] of entries.entries()) {
    const name = entry.name?.trim() || `tunnel-${i + 1}`
    if (entry.enabled === false) {
      skipped.push({ name, reason: 'disabled' })
      continue
    }
    if (seen.has(name)) {
      skipped.push({ name, reason: `duplicate name "${name}"` })
      continue
    }

    const serverUrl = entry.serverUrl ?? env.TUNELY_SERVER
    const token = entry.token ?? env.TUNELY_TOKEN
    const targetUrl = entry.targetUrl ?? env.TUNELY_TARGET ?? `http://127.0.0.1:${webServerPort}`
    if (!serverUrl) {
      skipped.push({ name, reason: 'missing serverUrl（config 或 TUNELY_SERVER）' })
      continue
    }
    if (!token) {
      skipped.push({ name, reason: 'missing token（config 或 TUNELY_TOKEN）' })
      continue
    }

    seen.add(name)
    tunnels.push({
      name,
      serverUrl,
      token,
      targetUrl,
      force: entry.force ?? TUNNEL_DEFAULTS.force,
      reconnectInterval: num(entry.reconnectInterval, TUNNEL_DEFAULTS.reconnectInterval),
      maxReconnectAttempts: num(entry.maxReconnectAttempts, TUNNEL_DEFAULTS.maxReconnectAttempts),
      requestTimeout: num(entry.requestTimeout, TUNNEL_DEFAULTS.requestTimeout),
      keepaliveInterval: num(entry.keepaliveInterval, TUNNEL_DEFAULTS.keepaliveInterval),
      keepaliveTimeout: num(entry.keepaliveTimeout, TUNNEL_DEFAULTS.keepaliveTimeout),
    })
  }

  return { tunnels, skipped }
}

/** 条目来源：config 显式 > TUNELY_TUNNELS JSON > TUNELY_TOKEN 单条。 */
function pickEntries(
  config: Config | undefined,
  env: NodeJS.ProcessEnv,
  skipped: SkippedTunnel[],
): TunnelEntryConfig[] {
  if (config?.tunnels !== undefined) return config.tunnels

  const raw = env.TUNELY_TUNNELS
  if (raw !== undefined && raw.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        skipped.push({ reason: 'TUNELY_TUNNELS 必须是 JSON 数组' })
        return []
      }
      return parsed as TunnelEntryConfig[]
    } catch (e) {
      skipped.push({ reason: `TUNELY_TUNNELS 不是合法 JSON: ${e instanceof Error ? e.message : String(e)}` })
      return []
    }
  }

  if (env.TUNELY_TOKEN) return [{}]
  return []
}

function num(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
