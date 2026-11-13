/**
 * 录音 → 16kHz 单声道 PCM16 WAV。
 * MediaRecorder 产出（webm-opus / mp4-aac）经 WebAudio decode 后重采样，
 * 目标形状满足 DeepSeek /v1/tools/asr 的 WAV 约束（≤120s ≤8MiB）。
 */

const TARGET_RATE = 16000

function encodeWav(samples: Int16Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i], true)
  return new Blob([view], { type: 'audio/wav' })
}

function resampleToMono(input: AudioBuffer): Int16Array {
  const channels = input.numberOfChannels
  const sourceRate = input.sampleRate
  const ratio = sourceRate / TARGET_RATE
  const length = Math.floor(input.length / ratio)
  const output = new Int16Array(length)
  const data: Float32Array[] = []
  for (let c = 0; c < channels; c += 1) data.push(input.getChannelData(c))
  for (let i = 0; i < length; i += 1) {
    const srcIndex = Math.floor(i * ratio)
    let sum = 0
    for (let c = 0; c < channels; c += 1) sum += data[c][srcIndex]
    const sample = sum / channels
    output[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
  }
  return output
}

/** MediaRecorder blob → WAV blob（16k mono PCM16） */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer()
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(arrayBuffer)
    if (decoded.numberOfChannels === 0 || decoded.length === 0) {
      throw new Error('empty recording')
    }
    return encodeWav(resampleToMono(decoded), TARGET_RATE)
  } finally {
    void context.close()
  }
}

/** 麦克风录音句柄：start 开录，stop 返回原始 blob（时长上限 110s 自动截断） */
export async function startRecording(): Promise<{
  stop: () => Promise<Blob>
  cancel: () => void
}> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  recorder.start()
  const timer = window.setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop()
  }, 110_000)
  return {
    stop: async () => {
      window.clearTimeout(timer)
      if (recorder.state !== 'inactive') recorder.stop()
      await stopped
      for (const track of stream.getTracks()) track.stop()
      return new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
    },
    cancel: () => {
      window.clearTimeout(timer)
      if (recorder.state !== 'inactive') recorder.stop()
      for (const track of stream.getTracks()) track.stop()
    },
  }
}
