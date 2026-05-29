export type RecorderState = 'idle' | 'recording' | 'saving' | 'done'

export interface AudioRecorderCallbacks {
  onStateChange: (state: RecorderState) => void
  onDurationUpdate: (seconds: number) => void
  onSaved: (vaultPath: string) => void
  onError: (error: string) => void
}

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startTime = 0
  private timer: number | null = null
  private _state: RecorderState = 'idle'

  constructor(private callbacks: AudioRecorderCallbacks) {}

  get state(): RecorderState {
    return this._state
  }

  /** Current elapsed seconds, or 0 if not recording. */
  getElapsed(): number {
    if (this._state !== 'recording') return 0
    return Math.floor((Date.now() - this.startTime) / 1000)
  }

  async start(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1 }
      })

      this.chunks = []

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      this.mediaRecorder = new MediaRecorder(stream, { mimeType })

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data)
      }

      this.mediaRecorder.start(1000)
      this.startTime = Date.now()
      this._state = 'recording'
      this.callbacks.onStateChange('recording')

      this.timer = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000)
        this.callbacks.onDurationUpdate(elapsed)
      }, 200)

    } catch (e: any) {
      const msg = e.name === 'NotAllowedError'
        ? '麦克风权限被拒绝'
        : `无法启动录音: ${e.message || String(e)}`
      this.callbacks.onError(msg)
      throw e
    }
  }

  async stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No active recorder'))
        return
      }

      this._state = 'saving'
      this.callbacks.onStateChange('saving')

      if (this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' })
        this.mediaRecorder!.stream.getTracks().forEach(t => t.stop())
        this.mediaRecorder = null
        resolve(blob)
      }

      this.mediaRecorder.stop()
    })
  }

  cancel(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.mediaRecorder) {
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop())
      this.mediaRecorder = null
    }
    this._state = 'idle'
    this.callbacks.onStateChange('idle')
  }
}
