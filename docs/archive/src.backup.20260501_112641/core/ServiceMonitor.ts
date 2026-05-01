export interface ServiceMonitorConfig {
  host: string
  port: number
  autoStart: boolean
  startTimeout: number
  serverPath: string
  cwd: string
}

interface ChildProcess {
  pid?: number
  kill(): void
  on(event: 'close', cb: (code: number) => void): void
}

interface NetSocket {
  setTimeout(ms: number): void
  connect(port: number, host: string): void
  destroy(): void
  on(event: 'connect' | 'timeout' | 'error', cb: () => void): void
}

interface ChildProcessModule {
  spawn(cmd: string, args: string[], options: object): ChildProcess
}

export class ServiceMonitor {
  private process: ChildProcess | null = null
  private isStarting = false

  constructor(private config: ServiceMonitorConfig) {}

  async isServiceRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const net = require('net') as any
      const socket: NetSocket = new net.Socket()

      socket.setTimeout(1000)

      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })

      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })

      socket.on('error', () => {
        socket.destroy()
        resolve(false)
      })

      socket.connect(this.config.port, this.config.host)
    })
  }

  async ensureServiceRunning(): Promise<boolean> {
    const isRunning = await this.isServiceRunning()
    if (isRunning) return true
    if (!this.config.autoStart) return false
    return this.startService()
  }

  async startService(): Promise<boolean> {
    if (this.isStarting) return true
    if (await this.isServiceRunning()) return true

    this.isStarting = true

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child_process: any = require('child_process')
      this.process = child_process.spawn('cmd', ['/c', 'start', '/B', 'py', '-3.11', this.config.serverPath], {
        cwd: this.config.cwd,
        shell: false,
        detached: false
      })

      const result = await this.waitForService(this.config.startTimeout)
      return result
    } catch (e) {
      console.error('[ServiceMonitor] Failed to start service:', e)
      return false
    } finally {
      this.isStarting = false
    }
  }

  async waitForService(timeout: number = 60000): Promise<boolean> {
    const startTime = Date.now()
    const interval = 500

    while (Date.now() - startTime < timeout) {
      if (await this.isServiceRunning()) return true
      await this.sleep(interval)
    }

    return false
  }

  stopService(): void {
    if (this.process) {
      try {
        this.process.kill()
      } catch (e) {
        console.error('[ServiceMonitor] Failed to stop service:', e)
      }
      this.process = null
    }
  }

  getProcess(): ChildProcess | null {
    return this.process
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
