class JarvisPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.live = false
    this.preroll = false
    this.targetSampleRate = 16_000
    this.resampleRatio = sampleRate / this.targetSampleRate
    this.sourceSamples = []
    this.sourcePosition = 0
    // ~80ms @ 16kHz Int16 mono，缩短出字延迟
    this.batchBytes = 2_560
    // ~700ms @ 16kHz Int16 mono，用于补回 VAD 判定前的开头
    this.prerollMaxBytes = 16_000 * 2 * 0.7
    this.prerollChunks = []
    this.prerollBytes = 0
    this.resetBatch()
    this.port.onmessage = (event) => {
      if (event.data?.type === 'preroll') {
        this.live = false
        this.preroll = true
        this.sourceSamples = []
        this.sourcePosition = 0
        this.prerollChunks = []
        this.prerollBytes = 0
        this.resetBatch()
      }
      if (event.data?.type === 'start') {
        this.flushBatch(true)
        // 先吐出预滚动缓冲，再进入实时
        for (const chunk of this.prerollChunks) {
          this.port.postMessage({ type: 'pcm', buffer: chunk, sampleRate: this.targetSampleRate }, [chunk])
        }
        this.prerollChunks = []
        this.prerollBytes = 0
        this.sourceSamples = []
        this.sourcePosition = 0
        this.resetBatch()
        this.preroll = false
        this.live = true
      }
      if (event.data?.type === 'stop') {
        this.flushBatch(false)
        this.sourceSamples = []
        this.sourcePosition = 0
        this.prerollChunks = []
        this.prerollBytes = 0
        this.preroll = false
        this.live = false
        this.port.postMessage({ type: 'flushed' })
      }
    }
  }

  resetBatch() {
    this.batchBuffer = new ArrayBuffer(this.batchBytes)
    this.batchView = new DataView(this.batchBuffer)
    this.batchOffset = 0
  }

  writeSample(sample) {
    const clamped = Math.max(-1, Math.min(1, sample))
    const intValue = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
    this.batchView.setInt16(this.batchOffset, intValue, true)
    this.batchOffset += 2
    if (this.batchOffset === this.batchBytes) this.flushBatch(this.preroll)
  }

  flushBatch(toPreroll) {
    if (this.batchOffset === 0) return
    const output = this.batchOffset === this.batchBytes
      ? this.batchBuffer
      : this.batchBuffer.slice(0, this.batchOffset)
    this.resetBatch()
    if (toPreroll) {
      this.prerollChunks.push(output)
      this.prerollBytes += output.byteLength
      while (this.prerollBytes > this.prerollMaxBytes && this.prerollChunks.length > 0) {
        const dropped = this.prerollChunks.shift()
        this.prerollBytes -= dropped.byteLength
      }
      return
    }
    this.port.postMessage({ type: 'pcm', buffer: output, sampleRate: this.targetSampleRate }, [output])
  }

  process(inputs) {
    if (!this.live && !this.preroll) return true
    const channel = inputs[0]?.[0]
    if (!channel?.length) return true

    for (let index = 0; index < channel.length; index += 1) this.sourceSamples.push(channel[index])
    while (this.sourcePosition + 1 < this.sourceSamples.length) {
      const index = Math.floor(this.sourcePosition)
      const fraction = this.sourcePosition - index
      const first = this.sourceSamples[index]
      const second = this.sourceSamples[index + 1]
      this.writeSample(first + ((second - first) * fraction))
      this.sourcePosition += this.resampleRatio
    }

    const consumedSamples = Math.floor(this.sourcePosition)
    if (consumedSamples > 0) {
      this.sourceSamples = this.sourceSamples.slice(consumedSamples)
      this.sourcePosition -= consumedSamples
    }
    return true
  }
}

registerProcessor('jarvis-pcm-capture', JarvisPcmCaptureProcessor)
