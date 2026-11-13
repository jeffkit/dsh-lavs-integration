import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ContentPart } from '../types.js'
import { Markdown } from '../markdown/components/Markdown.js'

export type ChatItem =
  | { kind: 'user'; key: string; seq?: number; parts: ContentPart[] }
  | { kind: 'assistant'; key: string; seq?: number; text: string; thinking: string; usage?: Record<string, unknown>; streaming?: boolean }
  | { kind: 'tool'; key: string; seq?: number; name: string; args: string; result?: boolean }
  | { kind: 'status'; key: string; seq?: number; text: string }

const UserBubble = memo(function UserBubble({ parts }: { parts: ContentPart[] }) {
  const text = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
  const images = parts.filter((part) => part.type === 'image')
  return (
    <div className="bubble user">
      {images.map((part, index) => (
        <img
          key={index}
          className="user-image"
          src={`data:${part.mediaType as string};base64,${part.data as string}`}
          alt={(part.name as string | undefined) ?? '附件'}
        />
      ))}
      {text !== '' && <div className="user-text">{text}</div>}
    </div>
  )
})

const ThinkingBlock = memo(function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  // 生成中默认跟随滚动到底
  useLayoutEffect(() => {
    if (live && open && ref.current !== null) ref.current.scrollTop = ref.current.scrollHeight
  }, [text, live, open])
  if (text === '') return null
  return (
    <div className={live && !open ? 'thinking live-collapsed' : 'thinking'}>
      <button type="button" className="thinking-toggle" onClick={() => setOpen(!open)}>
        {live ? '思考中…' : '思考过程'}
        <span className="thinking-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="thinking-body" ref={ref}>
          <Markdown content={text} loading={live === true} cacheKey={`think-${text.length}`} disableLink />
        </div>
      )}
    </div>
  )
})

const AssistantBubble = memo(function AssistantBubble({
  text,
  thinking,
  streaming,
  usage,
}: {
  text: string
  thinking: string
  streaming?: boolean
  usage?: Record<string, unknown>
}) {
  return (
    <div className="bubble assistant">
      <ThinkingBlock text={thinking} live={streaming === true} />
      {text === '' && streaming === true ? (
        <div className="dot-pulse" aria-label="生成中">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <Markdown
          content={text}
          loading={streaming === true}
          cacheKey={`a-${text.length}`}
          disableLink={false}
        />
      )}
      {streaming !== true && usage !== undefined && Number(usage.outputTokens ?? 0) > 0 && (
        <div className="usage">
          ↑{Number(usage.inputTokens ?? 0)} ↓{Number(usage.outputTokens ?? 0)}
        </div>
      )}
    </div>
  )
})

const ToolChip = memo(function ToolChip({ name, result }: { name: string; result?: boolean }) {
  return (
    <div className={result === true ? 'tool-chip done' : 'tool-chip'}>
      <span className="tool-dot" />
      {result === true ? name : `${name}…`}
    </div>
  )
})

export const ChatView = memo(function ChatView({ items, running }: { items: ChatItem[]; running: boolean }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const onScroll = () => {
    const el = scrollerRef.current
    if (el === null) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    stickRef.current = nearBottom
    setShowJump(!nearBottom)
  }

  useEffect(() => {
    const el = scrollerRef.current
    if (el !== null && stickRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [items])

  return (
    <div className="chat-area">
      <div className="scroller" ref={scrollerRef} onScroll={onScroll}>
        {items.length === 0 && <div className="empty-hint">发一条消息开始对话</div>}
        {items.map((item) => {
          if (item.kind === 'user') return <UserBubble key={item.key} parts={item.parts} />
          if (item.kind === 'assistant') {
            return (
              <AssistantBubble
                key={item.key}
                text={item.text}
                thinking={item.thinking}
                streaming={item.streaming}
                usage={item.usage}
              />
            )
          }
          if (item.kind === 'tool') return <ToolChip key={item.key} name={item.name} result={item.result} />
          return (
            <div key={item.key} className="status-line">
              {item.text}
            </div>
          )
        })}
        {running && items.every((item) => item.kind !== 'assistant') && (
          <div className="dot-pulse" aria-label="生成中">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      {showJump && (
        <button
          type="button"
          className="jump-bottom"
          onClick={() => {
            const el = scrollerRef.current
            if (el !== null) el.scrollTop = el.scrollHeight
          }}
        >
          ↓
        </button>
      )}
    </div>
  )
})
