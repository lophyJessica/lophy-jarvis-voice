class JarvisPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.enabled = false
    this.targetSampleRate = 16_000
    this.resampleRatio = sampleRate / this.targetSampleRate
    this.sourceSamples = []
    this.sourcePosition = 0
    this.batchBytes = 5_120
    this.resetBatch()
    this.port.onmessage = (event) => {
      if (event.data?.type === 'start') {
        this.sourceSamples = []
        this.sourcePosition = 0
        this.resetBatch()
        this.enabled = true
      }
      if (event.data?.type === 'stop') {
        this.flushBatch()
        this.sourceSamples = []
        this.sourcePosition = 0
        this.enabled = false
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
    if (this.batchOffset === this.batchBytes) this.flushBatch()
  }

  flushBatch() {
    if (this.batchOffset === 0) return
    const output = this.batchOffset === this.batchBytes
      ? this.batchBuffer
      : this.batchBuffer.slice(0, this.batchOffset)
    this.port.postMessage({ type: 'pcm', buffer: output, sampleRate: this.targetSampleRate }, [output])
    this.resetBatch()
  }

  process(inputs) {
    if (!this.enabled) return true
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
