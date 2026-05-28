export interface ServiceMonitorConfig {
  host: string
  port: number
  autoStart: boolean
  startTimeout: number
  serverPath: string
  cwd: string
  debugMode: boolean
  pythonPath: string
}

export class ServiceMonitor {
  private isStarting = false
  private childExited = false
  private _cachedPythonPath: string | null = null
  lastError: string = ''

  constructor(private config: ServiceMonitorConfig) {}

  /** 刷新配置（用户修改设置后调用） */
  updateConfig(partial: Partial<ServiceMonitorConfig>): void {
    Object.assign(this.config, partial)
  }

  async isServiceRunning(port?: number): Promise<boolean> {
    const p = port ?? this.config.port
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

      socket.connect(p, this.config.host)
    })
  }

  async ensureServiceRunning(): Promise<boolean> {
    const isRunning = await this.isServiceRunning()
    if (isRunning) return true
    if (!this.config.autoStart) return false
    return this.startService()
  }

  /**
   * 自动检测 python.exe 的绝对路径
   * 优先级: py launcher > where python > LOCALAPPDATA 遍历 > registry
   */
  static autoDetectPython(): string | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cp: any = require('child_process')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fs: any = require('fs')

      // 1. Windows Python launcher: py -0p
      try {
        const out = cp.execSync('py -0p', { encoding: 'utf8', timeout: 3000 })
        const match = out.match(/([A-Za-z]:\\.+python\.exe)/)
        if (match && fs.existsSync(match[1])) {
          console.log('[ServiceMonitor] Auto-detected via py launcher:', match[1])
          return match[1]
        }
      } catch { /* py launcher not available */ }

      // 2. where python (PATH) — 找 python.exe
      try {
        const out = cp.execSync('where python', { encoding: 'utf8', timeout: 3000 })
        const lines = out.trim().split(/\r?\n/)
        for (const line of lines) {
          const exe = line.trim()
          if (exe && /python\.exe$/i.test(exe) && fs.existsSync(exe)) {
            console.log('[ServiceMonitor] Auto-detected via PATH:', exe)
            return exe
          }
        }
      } catch { /* python not in PATH */ }

      // 3. %LOCALAPPDATA%\Programs\Python
      const localAppData = process.env.LOCALAPPDATA
      if (localAppData) {
        const pyBase = `${localAppData}\\Programs\\Python`
        if (fs.existsSync(pyBase)) {
          const dirs = fs.readdirSync(pyBase)
          const versionDirs = dirs
            .filter((d: string) => /^Python3\d+$/i.test(d))
            .sort()
            .reverse()
          for (const d of versionDirs) {
            const exe = `${pyBase}\\${d}\\python.exe`
            if (fs.existsSync(exe)) {
              console.log('[ServiceMonitor] Auto-detected via LOCALAPPDATA:', exe)
              return exe
            }
          }
        }
      }

      // 4. Registry (Windows)
      if (process.platform === 'win32') {
        try {
          const regOut = cp.execSync(
            'reg query "HKEY_CURRENT_USER\\Software\\Python\\PythonCore" /s 2>nul',
            { encoding: 'utf8', timeout: 3000, shell: 'cmd.exe' }
          )
          const match = regOut.match(/([A-Za-z]:\\.+python\.exe)/)
          if (match && fs.existsSync(match[1])) {
            console.log('[ServiceMonitor] Auto-detected via registry:', match[1])
            return match[1]
          }
        } catch { /* registry unavailable */ }
      }

      console.warn('[ServiceMonitor] Could not auto-detect Python')
      return null
    } catch (e) {
      console.error('[ServiceMonitor] autoDetectPython error:', e)
      return null
    }
  }

  /**
   * 获取 Python 安装目录（去掉 python.exe / pythonw.exe 后缀）
   * 用户配置优先 → 自动检测 → 缓存
   */
  private getPythonDir(): string | null {
    let exePath: string | null = null

    if (this.config.pythonPath) {
      const fs: any = require('fs')
      const userPath = this.config.pythonPath.trim()
      if (fs.existsSync(userPath)) {
        exePath = userPath
      } else {
        console.warn('[ServiceMonitor] Configured Python path not found:', userPath)
      }
    }

    if (!exePath) {
      if (!this._cachedPythonPath) {
        this._cachedPythonPath = ServiceMonitor.autoDetectPython()
      }
      exePath = this._cachedPythonPath
    }

    if (!exePath) return null

    // 提取目录：去掉末尾的 python.exe 或 pythonw.exe
    return exePath.replace(/pythonw?\.exe$/i, '')
  }

  clearCache(): void {
    this._cachedPythonPath = null
  }

  /**
   * 根据 debug 模式解析最终的可执行文件
   * - debug=true  → python.exe（有控制台窗口）
   * - debug=false → pythonw.exe 优先（无窗口），回退 python.exe
   */
  private resolveExecutable(): string | null {
    const dir = this.getPythonDir()
    if (!dir) {
      console.error('[ServiceMonitor] Cannot find Python installation')
      return null
    }

    const fs: any = require('fs')

    if (this.config.debugMode) {
      const exe = dir + 'python.exe'
      console.log('[ServiceMonitor] Debug mode ON →', exe)
      return exe
    }

    const pywExe = dir + 'pythonw.exe'
    if (fs.existsSync(pywExe)) {
      console.log('[ServiceMonitor] Non-debug mode →', pywExe)
      return pywExe
    }
    const pyExe = dir + 'python.exe'
    console.log('[ServiceMonitor] pythonw.exe not found, fallback →', pyExe)
    return pyExe
  }

  async startService(port?: number): Promise<boolean> {
    if (this.isStarting) return true

    const resolvedPort = port ?? this.config.port

    if (await this.isServiceRunning(resolvedPort)) return true

    this.isStarting = true
    this.childExited = false

    try {
      if (!this.config.autoStart) {
        this.lastError = '自动启动已关闭（请在设置中启用）'
        this.isStarting = false
        return false
      }

      const pythonPath = this.resolveExecutable()
      if (!pythonPath) {
        this.lastError = '未找到 Python（请在设置中配置 Python 路径）'
        this.isStarting = false
        return false
      }

      console.log('[ServiceMonitor] Python:', pythonPath, 'debug:', this.config.debugMode)

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cp: any = require('child_process')

        const args = [
          '-X', 'utf8',
          this.config.serverPath,
          '--port', String(resolvedPort),
        ]
        if (this.config.debugMode) {
          args.push('--debug')
        }

        console.log('[ServiceMonitor] Spawning:', pythonPath, args.join(' '))

        if (this.config.debugMode) {
          // 调试模式：用 cmd /c start 创建独立控制台窗口，用户可看到服务端输出
          const cmdArgs = [
            '/c', 'start', '"Voice Transcribe Server"',
            '/D', this.config.cwd,
            pythonPath,
            ...args
          ]
          const child = cp.spawn('cmd.exe', cmdArgs, {
            cwd: this.config.cwd,
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          })
          child.unref()
          child.on('error', (err: Error) => {
            console.error('[ServiceMonitor] Process error:', err)
            this.lastError = `进程启动失败: ${err.message}`
          })
          // cmd.exe 启动窗口后立即退出，不监听 close 事件设置 childExited
        } else {
          // 非调试模式：pythonw.exe 无窗口运行，输出通过 pipe 捕获
          const child = cp.spawn(pythonPath, args, {
            cwd: this.config.cwd,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          })

          let stderrData = ''
          if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => { stderrData += data.toString() })
            child.stderr.on('end', () => {
              if (stderrData) {
                console.error('[ServiceMonitor] Server stderr:', stderrData.trim())
              }
            })
          }

          child.unref()

          child.on('error', (err: Error) => {
            console.error('[ServiceMonitor] Process error:', err)
            this.lastError = `进程启动失败: ${err.message}`
          })

          child.on('close', (code: number) => {
            console.log('[ServiceMonitor] Process exited with code:', code)
            this.childExited = true
          })
        }

        console.log('[ServiceMonitor] Spawn command issued')
      } catch (e: any) {
        console.error('[ServiceMonitor] Failed to spawn process:', e)
        this.lastError = `无法启动 Python: ${e.message || String(e)}`
        this.isStarting = false
        return false
      }

      if (await this.waitForService(resolvedPort, this.config.startTimeout)) {
        return true
      }

      if (this.childExited) {
        this.lastError = `服务进程异常退出（打开调试模式查看详细日志）`
      } else {
        this.lastError = `服务启动超时（${this.config.startTimeout / 1000}s）`
      }
      return false
    } catch (e: any) {
      console.error('[ServiceMonitor] Failed to start service:', e)
      this.lastError = `未知错误: ${e.message || String(e)}`
      return false
    } finally {
      this.isStarting = false
    }
  }

  async waitForService(port: number, timeout: number = 60000): Promise<boolean> {
    const startTime = Date.now()
    const interval = 500

    while (Date.now() - startTime < timeout) {
      if (this.childExited) return false
      if (await this.isServiceRunning(port)) return true
      await this.sleep(interval)
    }

    return false
  }

  stopService(): void {
    console.log('[ServiceMonitor] Service stop requested (no-op in renderer)')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
