/** 门面（/api/mobile）的客户端类型。形状来自 mobile-gateway 转发的 DSH 0.2.x 事件。 */

export interface SessionSummary {
  sessionId: string
  title?: string
  updatedAt?: number
  running?: boolean
  blank?: boolean
  cwd?: string
  [key: string]: unknown
}

/** follow 流 / events 页里的持久事件条目 */
export interface SessionEventEntry {
  type: string
  seq: number
  time?: number
  data?: {
    content?: ContentPart[]
    role?: string
    id?: string
    turn?: number
    step?: number
    message?: { role?: string; content?: ContentPart[]; id?: string }
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }
    stream?: StreamRecord[]
    reason?: { kind?: string; error?: unknown }
    callId?: string
    name?: string
    arguments?: string
    title?: string
    [key: string]: unknown
  }
  surfaceOp?: string
}

/** assistant-stream 帧的 chunk 形状（token 级增量） */
export interface StreamChunk {
  type: 'block-start' | 'text-delta' | 'reasoning-delta' | 'tool-call-delta' | 'block-end' | 'usage' | 'finish'
  index?: number
  text?: string
  argumentsDelta?: string
  id?: string
  [key: string]: unknown
}

/**
 * follow 流帧。上游 pre-stable，刻意用宽松单接口 + 判别式访问，
 * 未知形状字段走 [key: string] 透传。
 */
export interface FollowFrame {
  type: 'snapshot' | 'event' | 'assistant-stream' | string
  records?: SessionEventEntry[]
  event?: SessionEventEntry
  frame?: AssistantStreamFrame
  header?: unknown
  cursor?: unknown
  [key: string]: unknown
}

export interface AssistantStreamFrame {
  type: 'start' | 'chunk' | 'end' | string
  attemptId?: string
  index?: number
  chunk?: StreamChunk
  outcome?: { kind?: string }
  [key: string]: unknown
}

export interface ContentPart {
  type: 'text' | 'image' | string
  text?: string
  [key: string]: unknown
}

export interface StreamRecord {
  type: string
  text?: string
  thinking?: string
  [key: string]: unknown
}

export interface EventsPage {
  records?: SessionEventEntry[]
  hasMore?: boolean
  cursor?: unknown
}
