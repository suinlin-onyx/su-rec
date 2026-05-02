export interface ServiceMonitorConfig {
  host: string
  port: number
  autoStart: boolean
  startTimeout: number
  serverPath: string
  cwd: string
}

export class ServiceMonitor {
  private isStarting = false

  constructor(private config: ServiceMonitorConfig) {}

  async isServiceRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const net = require('net') as any
      const socket = new net.Socket()

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
      if (this.config.autoStart) {
        console.log('[ServiceMonitor] Attempting to start service...')

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cp: any = require('child_process')

          // Try multiple methods to hide console window
          let child = null

          // Method 1: Try pythonw.exe with full path (Python 3.11 default location)
          const pythonwPaths = [
            'C:\\Users\\tuoyi5\\AppData\\Local\\Programs\\Python\\Python311\\pythonw.exe',
            'C:\\Python311\\pythonw.exe',
          ]

          for (const pythonwPath of pythonwPaths) {
            try {
              child = cp.spawn(pythonwPath, [this.config.serverPath], {
                cwd: this.config.cwd,
                detached: true,
                stdio: 'ignore'
              })
              console.log('[ServiceMonitor] Using pythonw:', pythonwPath)
              break
            } catch (e) {
              // Try next path
            }
          }

          // Method 2: If no pythonw found, use py launcher with CREATE_NO_WINDOW
          if (!child) {
            const child_process = cp.spawn('py', ['-3.11', '-X', 'utf8', this.config.serverPath], {
              cwd: this.config.cwd,
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              shell: false
            })
            child = child_process
            console.log('[ServiceMonitor] Using py launcher with hidden window')
          }

          // Unref so parent process doesn't wait for child
          child.unref()

          child.on('error', (err: Error) => {
            console.error('[ServiceMonitor] Process error:', err)
          })

          child.on('close', (code: number) => {
            console.log('[ServiceMonitor] Process exited with code:', code)
          })

          console.log('[ServiceMonitor] Service start command executed')
        } catch (e) {
          console.error('[ServiceMonitor] Failed to spawn process:', e)
        }
      }

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
    // No process to stop in renderer context
    console.log('[ServiceMonitor] Service stop requested (no-op in renderer)')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
