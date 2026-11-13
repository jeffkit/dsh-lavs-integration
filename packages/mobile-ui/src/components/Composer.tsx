import { memo, useRef, useState } from 'react'
import { startRecording, blobToWav } from '../audio.js'

export interface PendingImage {
  name: string
  mediaType: string
  data: string
}

const MAX_RECORD_MS = 110_000

function fileToPendingImage(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve({ name: file.name, mediaType: file.type || 'image/png', data: result.slice(comma + 1) })
    }
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export const Composer = memo(function Composer({
  running,
  disabled,
  onSend,
  onSendParts,
  onStop,
  onTranscribe,
}: {
  running: boolean
  disabled: boolean
  onSend: (text: string, images: PendingImage[]) => void
  onSendParts: (parts: Array<{ type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string; name?: string }>) => void
  onStop: () => void
  onTranscribe: (audio: Blob) => Promise<string>
}) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const recorderRef = useRef<{ stop: () => Promise<Blob>; cancel: () => void } | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const grow = () => {
    const el = areaRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }

  const hasContent = text.trim() !== '' || images.length > 0

  const submit = () => {
    const trimmed = text.trim()
    if ((!hasContent || running || disabled) && trimmed === '') return
    const pendingImages = images
    setText('')
    setImages([])
    requestAnimationFrame(grow)
    if (pendingImages.length > 0) {
      const parts: Array<{ type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string; name?: string }> = []
      for (const image of pendingImages) {
        parts.push({ type: 'image', mediaType: image.mediaType, data: image.data, name: image.name })
      }
      if (trimmed !== '') parts.push({ type: 'text', text: trimmed })
      onSendParts(parts)
    } else {
      onSend(trimmed, [])
    }
  }

  const toggleRecording = async () => {
    if (recording) {
      setRecording(false)
      setBusy(true)
      try {
        const blob = await recorderRef.current?.stop()
        if (blob !== undefined && blob.size > 0) {
          const transcript = await onTranscribe(blob)
          if (transcript.trim() !== '') {
            setText((current) => (current === '' ? transcript : `${current} ${transcript}`))
            requestAnimationFrame(grow)
          }
        }
      } catch {
        // 转写失败静默（输入框不动）
      } finally {
        setBusy(false)
      }
      return
    }
    try {
      recorderRef.current = await startRecording()
      setRecording(true)
      window.setTimeout(() => {
        // 到时自动停（MAX_RECORD_MS 由 audio.ts 兜底）
      }, MAX_RECORD_MS)
    } catch {
      // 麦克风被拒
    }
  }

  const pickImages = async (files: FileList | null) => {
    if (files === null) return
    const picked: PendingImage[] = []
    for (const file of Array.from(files).slice(0, 4)) {
      if (!file.type.startsWith('image/')) continue
      try {
        picked.push(await fileToPendingImage(file))
      } catch {
        // 单文件失败跳过
      }
    }
    if (picked.length > 0) setImages((current) => [...current, ...picked].slice(0, 4))
    if (fileRef.current !== null) fileRef.current.value = ''
  }

  return (
    <div className="composer">
      {images.length > 0 && (
        <div className="image-strip">
          {images.map((image, index) => (
            <button
              type="button"
              key={`${image.name}-${index}`}
              className="image-chip"
              onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
              aria-label={`移除 ${image.name}`}
            >
              <img src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} />
              <span>✕</span>
            </button>
          ))}
        </div>
      )}
      <div className="composer-row">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => void pickImages(event.target.files)}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => fileRef.current?.click()}
          aria-label="添加图片"
          disabled={running || recording || busy}
        >
          📎
        </button>
        <button
          type="button"
          className={recording ? 'icon-button mic recording' : 'icon-button mic'}
          onClick={() => void toggleRecording()}
          aria-label={recording ? '停止录音' : '语音输入'}
          disabled={running || busy}
        >
          {recording ? '⏺' : busy ? '…' : '🎤'}
        </button>
        <textarea
          ref={areaRef}
          value={text}
          rows={1}
          placeholder={recording ? '录音中… 再点一次结束' : running ? '生成中…' : '给 agent 发消息'}
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
            disabled={!hasContent || disabled}
            aria-label="发送"
          >
            ➤
          </button>
        )}
      </div>
    </div>
  )
})

// 供转写按钮使用的 WAV 转换依赖（保持单一来源）
export { blobToWav }
