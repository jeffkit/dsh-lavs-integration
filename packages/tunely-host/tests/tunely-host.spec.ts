import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { AddressInfo } from 'node:net'
import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { resolveTunnels, type Config, type TunnelEntryConfig } from '../src/resolve.ts'
import * as plugin from '../src/index.ts'

// ============== resolveTunnels（纯函数） ==============

const PORT = 4599

describe('resolveTunnels — config > env > 默认', () => {
  it('config 字段优先于 env，数字缺省与 tunely 客户端内置一致', () => {
    const { tunnels } = resolveTunnels(
      { tunnels: [{ name: 'a', serverUrl: 'ws://cfg', token: 'cfg-token' }] },
      { TUNELY_SERVER: 'ws://env', TUNELY_TOKEN: 'env-token', TUNELY_TARGET: 'http://env:1' },
      PORT,
    )
    expect(tunnels).toHaveLength(1)
    expect(tunnels[0]).toMatchObject({
      name: 'a',
      serverUrl: 'ws://cfg',
      token: 'cfg-token',
      targetUrl: 'http://env:1',
      reconnectInterval: 5000,
      maxReconnectAttempts: 0,
      requestTimeout: 300_000,
      keepaliveInterval: 25_000,
      keepaliveTimeout: 45_000,
      force: false,
    })
  })

  it('targetUrl 缺省 = 本机 dsh web（webServer.port）', () => {
    const { tunnels } = resolveTunnels(
      { tunnels: [{ name: 'a', serverUrl: 'ws://s', token: 't' }] },
      {},
      PORT,
    )
    expect(tunnels[0]?.targetUrl).toBe(`http://127.0.0.1:${PORT}`)
  })

  it('config.tunnels 显式空数组 = 明确关闭，env 不再回落', () => {
    const { tunnels, skipped } = resolveTunnels(
      { tunnels: [] },
      { TUNELY_TOKEN: 'env-token' },
      PORT,
    )
    expect(tunnels).toHaveLength(0)
    expect(skipped).toHaveLength(0)
  })

  it('无 config 时回落 TUNELY_TUNNELS JSON，元素可用 env 补字段', () => {
    const { tunnels } = resolveTunnels(
      {},
      {
        TUNELY_TUNNELS: JSON.stringify([{ name: 'x' }, { name: 'y', token: 'own' }]),
        TUNELY_SERVER: 'ws://env',
        TUNELY_TOKEN: 'env-token',
      },
      PORT,
    )
    expect(tunnels).toHaveLength(2)
    expect(tunnels[0]).toMatchObject({ name: 'x', serverUrl: 'ws://env', token: 'env-token' })
    expect(tunnels[1]).toMatchObject({ name: 'y', token: 'own' })
  })

  it('TUNELY_TUNNELS 非法 JSON → 跳过并给出原因', () => {
    const { tunnels, skipped } = resolveTunnels({}, { TUNELY_TUNNELS: '{not json' }, PORT)
    expect(tunnels).toHaveLength(0)
    expect(skipped[0]?.reason).toContain('TUNELY_TUNNELS')
  })

  it('TUNELY_TUNNELS 非数组 → 跳过', () => {
    const { tunnels, skipped } = resolveTunnels(
      {},
      { TUNELY_TUNNELS: JSON.stringify({ name: 'x' }) },
      PORT,
    )
    expect(tunnels).toHaveLength(0)
    expect(skipped[0]?.reason).toContain('JSON 数组')
  })
})

describe('resolveTunnels — 校验与跳过', () => {
  it('缺 token → 跳过（原因指向 TUNELY_TOKEN）', () => {
    const { tunnels, skipped } = resolveTunnels(
      { tunnels: [{ name: 'a', serverUrl: 'ws://s' }] },
      {},
      PORT,
    )
    expect(tunnels).toHaveLength(0)
    expect(skipped[0]).toMatchObject({ name: 'a' })
    expect(skipped[0]?.reason).toContain('TUNELY_TOKEN')
  })

  it('TUNELY_TOKEN 单条回落：缺 serverUrl → 跳过', () => {
    const { tunnels, skipped } = resolveTunnels({}, { TUNELY_TOKEN: 'env-token' }, PORT)
    expect(tunnels).toHaveLength(0)
    expect(skipped[0]?.reason).toContain('serverUrl')
  })

  it('重名跳过后者；enabled:false 显式停用；缺省名自动编号', () => {
    const entries: TunnelEntryConfig[] = [
      { serverUrl: 'ws://s', token: 't' },
      { name: 'tunnel-1', serverUrl: 'ws://s', token: 't' },
      { name: 'off', serverUrl: 'ws://s', token: 't', enabled: false },
      { name: 'ok', serverUrl: 'ws://s', token: 't' },
    ]
    const { tunnels, skipped } = resolveTunnels({ tunnels: entries }, {}, PORT)
    expect(tunnels.map(t => t.name)).toEqual(['tunnel-1', 'ok'])
    expect(skipped.map(s => `${s.name}:${s.reason}`)).toEqual([
      'tunnel-1:duplicate name "tunnel-1"',
      'off:disabled',
    ])
  })

  it('非法数字回落默认值', () => {
    const { tunnels } = resolveTunnels(
      { tunnels: [{ name: 'a', serverUrl: 'ws://s', token: 't', reconnectInterval: Number.NaN }] },
      {},
      PORT,
    )
    expect(tunnels[0]?.reconnectInterval).toBe(5000)
  })
})

// ============== 集成：真 cordis + 假隧道服务端 + 真 http 目标 ==============

interface FakeTunnel {
  url: string
  domain: string
  request(id: string, path: string): Promise<Record<string, unknown>>
  sawAuth(): boolean
  closedByClient(): boolean
  close(): Promise<void>
}

async function startFakeTunnelServer(domain: string): Promise<FakeTunnel> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  let client: WebSocket | null = null
  let sawAuth = false
  let closed = false
  const queue: Array<Record<string, unknown>> = []
  const waiters: Array<(m: Record<string, unknown>) => void> = []

  const url = await new Promise<string>((resolve, reject) => {
    wss.on('listening', () => {
      const addr = wss.address() as AddressInfo
      resolve(`ws://127.0.0.1:${addr.port}/ws/tunnel`)
    })
    wss.on('error', reject)
  })

  wss.on('connection', (ws) => {
    client = ws
    ws.on('close', () => { closed = true })
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>
      if (msg.type === 'auth') {
        sawAuth = true
        ws.send(JSON.stringify({ type: 'auth_ok', domain, tunnel_id: 't-test' }))
        return
      }
      const waiter = waiters.shift()
      if (waiter !== undefined) waiter(msg)
      else queue.push(msg)
    })
  })

  return {
    url,
    domain,
    sawAuth: () => sawAuth,
    closedByClient: () => closed,
    request(id: string, path: string): Promise<Record<string, unknown>> {
      client?.send(JSON.stringify({ type: 'request', id, method: 'GET', path, headers: {}, body: null, timeout: 5 }))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待 ${id} 响应超时`)), 5000)
        const take = (m: Record<string, unknown>): void => {
          clearTimeout(timer)
          resolve(m)
        }
        if (queue.length > 0) take(queue.shift()!)
        else waiters.push(take)
      })
    },
    close(): Promise<void> {
      return new Promise((resolve) => wss.close(() => resolve()))
    },
  }
}

async function startTarget(): Promise<{ port: number; paths: string[]; close: () => Promise<void> }> {
  const paths: string[] = []
  const server = http.createServer((req, res) => {
    paths.push(req.url ?? '')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, path: req.url }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    paths,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

class FakeWebServer extends Service {
  constructor(ctx: Context, private readonly p: number) {
    super(ctx)
  }
  get port(): number {
    return this.p
  }
}

describe('tunely-host — 进程内隧道端到端', () => {
  let target: Awaited<ReturnType<typeof startTarget>>
  let tunnel: FakeTunnel

  beforeEach(async () => {
    target = await startTarget()
    tunnel = await startFakeTunnelServer('dsh.test')
  })

  afterEach(async () => {
    await tunnel.close()
    await target.close()
  })

  it('挂载即连接 → 服务端下发请求转发到本机目标 → dispose 全部收口', async () => {
    const ctx = new Context()
    ctx.provide('webServer', new FakeWebServer(ctx, target.port))
    const fiber = ctx.plugin(plugin, {
      tunnels: [{ name: 'dsh', serverUrl: tunnel.url, token: 'tok' }],
    })
    await fiber

    // 服务端看到认证，插件拿到 domain（连接是异步完成的，一律 waitFor）
    await vi.waitFor(() => expect(tunnel.sawAuth()).toBe(true))
    await vi.waitFor(() => {
      const s = ctx.tunely.list().find(x => x.name === 'dsh')
      expect(s).toBeDefined()
      expect(s?.connected).toBe(true)
      expect(s?.domain).toBe('dsh.test')
      expect(s?.targetUrl).toBe(`http://127.0.0.1:${target.port}`)
    })

    // 服务端下发一条 HTTP 请求 → 客户端转发到本机 target → 响应回服务端
    const resp = await tunnel.request('req-1', '/api/echo')
    expect(resp).toMatchObject({ type: 'response', id: 'req-1', status: 200 })
    expect(JSON.parse(String(resp.body))).toEqual({ ok: true, path: '/api/echo' })
    expect(target.paths).toContain('/api/echo')

    // dispose：fiber 卸载 → 服务随 fiber 注销 → 所有 client stop、WS 关闭
    const service = ctx.tunely
    await fiber.dispose()
    await vi.waitFor(() => {
      expect(service.list()).toHaveLength(0)
      expect(tunnel.closedByClient()).toBe(true)
    })
  }, 15_000)

  it('env 单条回落（TUNELY_TOKEN/TUNELY_SERVER）+ service.stop/start 生命周期', async () => {
    process.env.TUNELY_TOKEN = 'tok'
    process.env.TUNELY_SERVER = tunnel.url
    delete process.env.TUNELY_TARGET
    try {
      const ctx = new Context()
      ctx.provide('webServer', new FakeWebServer(ctx, target.port))
      const fiber = ctx.plugin(plugin, {}) // 全部走 env
      await fiber

      await vi.waitFor(() => {
        expect(ctx.tunely.list().map(s => s.name)).toEqual(['tunnel-1'])
        expect(ctx.tunely.list()[0]?.connected).toBe(true)
      })

      // stop → 实例移除；start → 按 spec 重建并重连
      expect(ctx.tunely.stop('tunnel-1')).toBe(true)
      expect(ctx.tunely.stop('tunnel-1')).toBe(false)
      await vi.waitFor(() => expect(ctx.tunely.list()).toHaveLength(0))
      expect(ctx.tunely.start('tunnel-1')).toBe(true)
      await vi.waitFor(() => expect(ctx.tunely.list()[0]?.connected).toBe(true))
      await fiber.dispose()
    } finally {
      delete process.env.TUNELY_TOKEN
      delete process.env.TUNELY_SERVER
    }
  }, 15_000)

  it('缺 token 的条目被跳过并告警，不阻塞其它隧道', async () => {
    const ctx = new Context()
    ctx.provide('webServer', new FakeWebServer(ctx, target.port))
    const fiber = ctx.plugin(plugin, {
      tunnels: [
        { name: 'broken', serverUrl: tunnel.url }, // 缺 token，env 也没有
        { name: 'good', serverUrl: tunnel.url, token: 'tok' },
      ],
    })
    await fiber

    await vi.waitFor(() => {
      const names = ctx.tunely.list().map(s => s.name)
      expect(names).toEqual(['good'])
    })
    await fiber.dispose()
  }, 15_000)
})
