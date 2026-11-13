/** 门面客户端：所有请求同源，鉴权靠登录后的 cookie（/?token= 换发）。 */

import type { EventsPage, FollowFrame, SessionSummary } from './types.js'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (response.status === 401) {
    throw new ApiError(401, 'unauthenticated')
  }
  if (!response.ok) {
    let message = response.statusText
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error !== undefined) message = body.error
    } catch {
      // 保留 statusText
    }
    throw new ApiError(response.status, message)
  }
  return (await response.json()) as T
}

export const api = {
  async health(): Promise<boolean> {
    try {
      await request<{ ok: boolean }>('/api/mobile/health')
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return false
      throw error
    }
  },

  /** 用启动横幅里的 token 登录：整页跳转让服务端 303 + Set-Cookie，回来后已认证 */
  login(token: string): void {
    window.location.href = `/?token=${encodeURIComponent(token)}&back=/m/`
  },

  listSessions(): Promise<{ items?: SessionSummary[] }> {
    return request('/api/mobile/sessions')
  },

  createSession(cwd?: string): Promise<{ sessionId: string }> {
    return request('/api/mobile/sessions', { method: 'POST', body: JSON.stringify({ cwd }) })
  },

  prompt(sessionId: string, text: string, requestId?: string): Promise<{ accepted: boolean }> {
    return request(`/api/mobile/sessions/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ text, requestId }),
    })
  },

  cancel(sessionId: string): Promise<{ accepted: boolean }> {
    return request(`/api/mobile/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' })
  },

  events(sessionId: string, before?: number, max?: number): Promise<EventsPage> {
    const params = new URLSearchParams()
    if (before !== undefined) params.set('before', String(before))
    if (max !== undefined) params.set('max', String(max))
    const qs = params.toString()
    return request(`/api/mobile/sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ''}`)
  },

  /**
   * 订阅会话事件流（SSE）。返回一个可 abort 的句柄；断线不自动重连，
   * 调用方根据 onFrame('close') 自行决定（v0.1 由视图层重开）。
   */
  stream(
    sessionId: string,
    onFrame: (frame: FollowFrame) => void,
    onDone: (error?: unknown) => void,
  ): { abort: () => void } {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/mobile/sessions/${encodeURIComponent(sessionId)}/stream`, {
          signal: controller.signal,
          headers: { accept: 'text/event-stream' },
        })
        if (!response.ok || response.body === null) {
          throw new ApiError(response.status, `stream failed: ${response.statusText}`)
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let boundary = buffer.indexOf('\n\n')
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            for (const line of block.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  onFrame(JSON.parse(line.slice(6)) as FollowFrame)
                } catch {
                  // 跳过无法解析的帧
                }
              }
            }
            boundary = buffer.indexOf('\n\n')
          }
        }
        onDone()
      } catch (error) {
        if (controller.signal.aborted) {
          onDone()
        } else {
          onDone(error)
        }
      }
    })()
    return { abort: () => controller.abort() }
  },
}
