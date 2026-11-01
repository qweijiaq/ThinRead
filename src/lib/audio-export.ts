export interface AudioSegment {
  base64: string
  mime: string
}

const MAX_DURATION_SECONDS = 45 * 60
const TARGET_SAMPLE_RATE = 24_000

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** 16-bit PCM WAV；听读导出统一成单声道，文件体积可控。 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return buffer
}

function toMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length
  const mono = new Float32Array(length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < length; index++) mono[index] += data[index]! / buffer.numberOfChannels
  }
  return mono
}

async function resampleMono(mono: Float32Array, sourceRate: number, targetRate: number): Promise<Float32Array> {
  if (sourceRate === targetRate) return mono
  const context = new OfflineAudioContext(1, Math.max(1, Math.ceil((mono.length / sourceRate) * targetRate)), targetRate)
  const buffer = context.createBuffer(1, mono.length, sourceRate)
  const copy = new Float32Array(mono.length)
  copy.set(mono)
  buffer.copyToChannel(copy, 0)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
  const rendered = await context.startRendering()
  return toMono(rendered)
}

/** 把逐句音频解码后拼成一个可播放/可导出的整段 WAV。 */
export async function combineAudioSegments(
  segments: AudioSegment[],
  sampleRate = TARGET_SAMPLE_RATE,
): Promise<{ wav: ArrayBuffer; base64: string; duration: number }> {
  if (segments.length === 0) throw new Error('没有可合并的音频。')
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) throw new Error('当前系统不支持音频合并。')
  const context = new AudioContextCtor()
  const parts: Float32Array[] = []
  let totalSamples = 0
  try {
    for (const [index, segment] of segments.entries()) {
      const bytes = base64ToBytes(segment.base64)
      const arrayBuffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(arrayBuffer).set(bytes)
      const decoded = await context.decodeAudioData(arrayBuffer)
      const mono = await resampleMono(toMono(decoded), decoded.sampleRate, sampleRate)
      parts.push(mono)
      totalSamples += mono.length
      if (totalSamples / sampleRate > MAX_DURATION_SECONDS) {
        throw new Error(`音频超过 ${MAX_DURATION_SECONDS / 60} 分钟，建议按章节分开导出。`)
      }
      if (index % 5 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  } finally {
    void context.close()
  }
  const merged = new Float32Array(totalSamples)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }
  const wav = encodeWav(merged, sampleRate)
  let binary = ''
  const bytes = new Uint8Array(wav)
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return { wav, base64: btoa(binary), duration: totalSamples / sampleRate }
}
