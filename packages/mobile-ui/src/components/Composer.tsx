import { memo, useRef, useState } from 'react'

export const Composer = memo(function Composer({
  running,
  disabled,
  onSend,
  onStop,
}: {
  running: boolean
  disabled: boolean
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  const grow = () => {
    const el = areaRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed === '' || running || disabled) return
    onSend(trimmed)
    setText('')
    requestAnimationFrame(grow)
  }

  return (
    <div className="composer">
      <textarea
        ref={areaRef}
        value={text}
        rows={1}
        placeholder={running ? '生成中…' : '给 agent 发消息'}
        onChange={(event) => {
          setText(event.target.value)
          grow()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {running ? (
        <button type="button" className="send-button stop" onClick={onStop} aria-label="停止">
          ■
        </button>
      ) : (
        <button
          type="button"
          className="send-button"
          onClick={submit}
          disabled={text.trim() === '' || disabled}
          aria-label="发送"
        >
          ➤
        </button>
      )}
    </div>
  )
})
