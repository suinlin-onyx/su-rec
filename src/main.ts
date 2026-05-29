import { Plugin, Notice } from 'obsidian'
import fixWebmDuration from 'fix-webm-duration'
import { ConnectionManager } from './core/ConnectionManager'
import { MessageBridge } from './core/MessageBridge'
import { StateController } from './core/StateController'
import { ServiceMonitor } from './core/ServiceMonitor'
import { ResourceManager } from './core/ResourceManager'
import { AudioRecorder } from './core/AudioRecorder'
import { SuRecPluginSettingTab } from './ui/SettingsTab'
import { DEFAULT_SETTINGS } from './types'
import type { ServerMessage, CompositeState } from './types'
import type { RecorderState } from './core/AudioRecorder'

const MAX_PORT_SCAN = 10  // P0 .. P0+10

export default class SuRecPlugin extends Plugin {
  settings!: ResourceManager
  private connectionManager!: ConnectionManager
  private messageBridge!: MessageBridge
  private stateController!: StateController
  private serviceMonitor!: ServiceMonitor
  private audioRecorder!: AudioRecorder

  private ribbonEl: HTMLElement | null = null
  private statusBarEl: HTMLElement | null = null
  private recordingIndicatorEl: HTMLElement | null = null
  private currentFile = ''
  private currentText = ''
  private autoStartRecording = false
  private writtenTexts = new Set<string>()
  private servicePollTimer: number | null = null
  private recordingVaultPath = ''

  async onload() {
    this.settings = new ResourceManager(this, DEFAULT_SETTINGS)
    await this.settings.load()

    this.stateController = new StateController()

    const pluginSettings = this.settings.getSettings()
    this.serviceMonitor = new ServiceMonitor({
      host: pluginSettings.serverHost,
      port: pluginSettings.serverPort,
      autoStart: pluginSettings.autoStartServer,
      startTimeout: pluginSettings.serverStartTimeout,
      serverPath: 'run.py',
      cwd: 'D:\\arvin\\obsidian_workpace\\su_obs_voice\\voice-transcribe',
      debugMode: pluginSettings.debugMode,
      pythonPath: pluginSettings.pythonPath,
    })

    this.connectionManager = new ConnectionManager(
      {
        useSSL: pluginSettings.useSSL,
        serverHost: pluginSettings.serverHost,
        serverPort: pluginSettings.serverPort,
        autoReconnect: pluginSettings.autoReconnect,
        maxReconnectAttempts: pluginSettings.maxReconnectAttempts,
        reconnectBaseDelay: pluginSettings.reconnectBaseDelay,
        heartbeatInterval: 30000
      },
      {
        onStateChange: (state) => this.onConnectionStateChange(state),
        onMessage: (msg) => this.onServerMessage(msg),
        onError: (err) => this.onConnectionError(err)
      }
    )

    this.messageBridge = new MessageBridge((msg) => this.connectionManager.send(msg))

    this.stateController.onStateChange((newState) => this.updateUI(newState))

    this.initAudioRecorder()
    this.createRecordingUI()

    this.createRibbonIcon()
    this.createStatusBar()
    this.addSettingTab(new SuRecPluginSettingTab(this.app, this))

    console.log('[SuRec] Plugin loaded')
  }

  async onunload() {
    if (this.currentText) {
      this.saveSync()
    }
    this.cleanup()
  }

  private createRibbonIcon(): void {
    this.ribbonEl = this.addRibbonIcon('mic', 'SuRec', () => {
      this.onRibbonClick()
    })
    this.ribbonEl.style.borderRadius = '50%'
    this.ribbonEl.style.padding = '6px'
    this.updateUI(this.stateController.getCompositeState())
  }

  private createStatusBar(): void {
    this.statusBarEl = this.addStatusBarItem()
    this.updateUI(this.stateController.getCompositeState())
  }

  private onRibbonClick(): void {
    const { base } = this.stateController.getCompositeState()

    if (base === 'disconnected') {
      this.tryConnect()
    } else if (base === 'connected') {
      const { server } = this.stateController.getCompositeState()
      if (server === 'recognizing') {
        this.stopRecording()
      } else {
        this.autoStartRecording = false
        this.startRecording()
      }
    }
  }

  // ============ 端口扫描 & 连接 ============

  private async tryConnect(): Promise<void> {
    this.clearServicePoll()

    // 从最新设置刷新 ServiceMonitor 配置（debugMode / pythonPath 可能已变化）
    const s = this.settings.getSettings()
    this.serviceMonitor.updateConfig({
      debugMode: s.debugMode,
      pythonPath: s.pythonPath,
      autoStart: s.autoStartServer,
    })

    this.stateController.updateBaseState('connecting')
    this.setStatusBarText('检查服务状态...')
    this.autoStartRecording = true

    const basePort = s.serverPort

    // 阶段 1: 端口扫描 — 找到可用端口或已有服务
    for (let offset = 0; offset <= MAX_PORT_SCAN; offset++) {
      const p = basePort + offset
      const running = await this.serviceMonitor.isServiceRunning(p)

      if (!running) {
        // 端口空闲 → 在此端口启动服务
        console.log(`[SuRec] Port ${p} is free, starting service...`)
        await this.startAndConnect(p)
        return
      }

      // 端口被占用 → 尝试 WebSocket 连接
      const wsOk = await this.tryWsConnect(p)
      if (wsOk) {
        // 是 su-rec 服务端
        console.log(`[SuRec] Found service on port ${p}`)
        return
      }

      // 被其他程序占用 → 递增端口
      console.log(`[SuRec] Port ${p} occupied by non-su-rec process, trying next...`)
    }

    // 阶段 2: 所有端口都被非 su-rec 程序占用
    // 在 basePort 启动（它可能只是被暂用，再试一次）
    console.log('[SuRec] All ports occupied, forcing start on base port')
    await this.startAndConnect(basePort)
  }

  /** 尝试 WebSocket 连接，返回是否成功 */
  private async tryWsConnect(port: number): Promise<boolean> {
    try {
      await this.connectionManager.connect(port)
      return true
    } catch {
      return false
    }
  }

  /** 启动服务并连接 */
  private async startAndConnect(port: number): Promise<void> {
    this.setStatusBarText('启动服务中...')

    try {
      const started = await this.serviceMonitor.startService(port)
      if (!started) {
        new Notice(this.serviceMonitor.lastError || '服务启动失败，请手动启动')
        this.stateController.updateBaseState('disconnected')
        this.autoStartRecording = false
        return
      }

      // 轮询等待端口 open 后连接
      await this.connectionManager.connect(port)

    } catch (e) {
      console.error('[SuRec] Connect failed:', e)
      new Notice('连接失败')
      this.stateController.updateBaseState('disconnected')
      this.autoStartRecording = false

      if (this.settings.getSettings().autoReconnect) {
        this.startServicePoll()
      }
    }
  }

  /** Keep polling the service port until it becomes available, then connect. */
  private startServicePoll(): void {
    this.clearServicePoll()
    const settings = this.settings.getSettings()
    if (!settings.autoReconnect) return

    const poll = async () => {
      const state = this.stateController.getCompositeState().base
      if (state === 'connected') return

      // 刷新配置
      const s = this.settings.getSettings()
      this.serviceMonitor.updateConfig({
        debugMode: s.debugMode,
        autoStart: s.autoStartServer,
      })

      const running = await this.serviceMonitor.isServiceRunning(s.serverPort)
      if (running) {
        console.log('[SuRec] Service detected, connecting...')
        this.setStatusBarText('服务已就绪，正在连接...')
        try {
          await this.connectionManager.connect(s.serverPort)
        } catch {
          // Will retry on next poll
        }
      }
    }

    poll()
    this.servicePollTimer = window.setInterval(poll, 2000)
  }

  private clearServicePoll(): void {
    if (this.servicePollTimer !== null) {
      clearInterval(this.servicePollTimer)
      this.servicePollTimer = null
    }
  }

  // ============ 录音控制 ============

  private async startRecording(): Promise<void> {
    this.messageBridge.sendAction('start_recording')
    this.currentText = ''
    this.writtenTexts.clear()

    if (this.currentFile && !this.isTodayFile(this.currentFile)) {
      this.currentFile = ''
    }

    await this.ensureFile()
    await this.insertSegmentAndPlaceholder()
    this.audioRecorder.start().catch(() => {})
    new Notice('开始录音')
  }

  private async insertSegmentAndPlaceholder(): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(this.currentFile)
    if (!file) {
      // 文件未创建成功，尝试直接创建
      try {
        file = await this.app.vault.create(this.currentFile, '')
      } catch {
        console.error('[SuRec] Cannot create transcription file:', this.currentFile)
        return
      }
    }

    const now = new Date()
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
    const segment = `\n\n---\n### ${timeStr}\n`

    const filename = this.makeRecordingFileName()
    const folder = this.settings.getSettings().recordingFolder || 'Recordings'
    this.recordingVaultPath = `${folder}/${filename}`

    const placeholder = `🔴 录音中 — ${filename}\n`

    const content = await this.app.vault.read(file)
    await this.app.vault.modify(file, content + segment + placeholder)
  }

  private makeRecordingFileName(): string {
    const now = new Date()
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
    return `录音_${ts}.webm`
  }

  private isTodayFile(filename: string): boolean {
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    const todayStr = `${year}-${month}-${day}`
    return filename.includes(todayStr)
  }

  private async stopRecording(): Promise<void> {
    this.clearServicePoll()
    this.autoStartRecording = false
    this.messageBridge.sendAction('stop_recording')

    const durationSecs = this.audioRecorder.getElapsed()

    try {
      const blob = await this.audioRecorder.stop()
      await this.saveRecordingFile(blob, durationSecs)
    } catch {
      this.audioRecorder.cancel()
    }
    new Notice('停止录音')
  }

  private async saveRecordingFile(blob: Blob, durationSecs: number): Promise<void> {
    const vaultPath = this.recordingVaultPath
    if (!vaultPath) return

    // 确保目录存在并写入音频文件
    const folder = vaultPath.substring(0, vaultPath.lastIndexOf('/'))
    await this.ensureFolder(folder)

    // 修补 WebM Duration 元数据（MediaRecorder 不写入此字段）
    const patchedBlob = await fixWebmDuration(blob, durationSecs * 1000)
    const arrayBuf = await patchedBlob.arrayBuffer()
    await this.app.vault.createBinary(vaultPath, arrayBuf)

    // 替换占位符 → 真实 embed
    if (this.currentFile) {
      const note = this.app.vault.getAbstractFileByPath(this.currentFile)
      if (note) {
        const filename = vaultPath.substring(vaultPath.lastIndexOf('/') + 1)
        const placeholder = `🔴 录音中 — ${filename}`
        const embed = `![[${vaultPath}]]`
        const content = await this.app.vault.read(note)
        const newContent = content.replace(placeholder, embed)
        await this.app.vault.modify(note, newContent)
      }
    }

    this.recordingVaultPath = ''
    this.onRecorderStateChange('done')
  }

  // ============ 自定义录音 ============

  private initAudioRecorder(): void {
    this.audioRecorder = new AudioRecorder({
      onStateChange: (state) => this.onRecorderStateChange(state),
      onDurationUpdate: (secs) => this.updateRecordingDuration(secs),
      onSaved: () => {},
      onError: (err) => new Notice(err),
    })
  }

  private createRecordingUI(): void {
    this.recordingIndicatorEl = this.addStatusBarItem()
    this.recordingIndicatorEl.addClass('surec-recording-indicator')
    this.recordingIndicatorEl.style.display = 'none'
  }

  private onRecorderStateChange(state: RecorderState): void {
    if (!this.recordingIndicatorEl) return
    switch (state) {
      case 'idle':
        this.recordingIndicatorEl.style.display = 'none'
        break
      case 'recording':
        this.recordingIndicatorEl.style.display = ''
        this.recordingIndicatorEl.setText('🔴 录音中 00:00')
        break
      case 'saving':
        this.recordingIndicatorEl.setText('⏳ 保存录音...')
        break
      case 'done':
        this.recordingIndicatorEl.setText('✅ 录音已保存')
        setTimeout(() => {
          if (this.recordingIndicatorEl && this.audioRecorder.state === 'done') {
            this.recordingIndicatorEl.style.display = 'none'
          }
        }, 3000)
        break
    }
  }

  private updateRecordingDuration(secs: number): void {
    if (!this.recordingIndicatorEl) return
    const mins = Math.floor(secs / 60).toString().padStart(2, '0')
    const sec = (secs % 60).toString().padStart(2, '0')
    this.recordingIndicatorEl.setText(`🔴 录音中 ${mins}:${sec}`)
  }

  // ============ 事件处理 ============

  private onConnectionStateChange(state: string): void {
    if (state === 'disconnected') {
      this.stateController.updateBaseState('disconnected')
      // ConnectionManager 内部已有 scheduleReconnect，此处不再启动重复的轮询
    }
  }

  private onServerMessage(msg: ServerMessage): void {
    console.log('[SuRec] Server message:', msg)

    switch (msg.type) {
      case 'state_update':
      case 'state_response':
        if (msg.status === 'connected') {
          this.stateController.updateBaseState('connected')
          new Notice('已连接到服务器')
        } else if (msg.status === 'loading') {
          // 显示加载进度
          const progressMsg = msg.payload?.message || '加载中...'
          this.setStatusBarText(progressMsg)
          this.stateController.updateServerState('loading')
        } else if (msg.status === 'model_loaded' && this.autoStartRecording) {
          this.autoStartRecording = false
          this.startRecording()
        }
        this.stateController.handleServerMessage(msg)
        break

      case 'transcription':
        if (msg.payload?.text) {
          this.currentText += msg.payload.text
          this.appendToNote(msg.payload.text)
          const preview = msg.payload.text.replace(/\n/g, '').slice(-20) || '...'
          this.setStatusBarText(preview)
        }
        break

      case 'error':
        if (msg.payload?.errorMessage) {
          new Notice(`错误: ${msg.payload.errorMessage}`)
        }
        break
    }
  }

  private onConnectionError(err: Error): void {
    console.error('[SuRec] Connection error:', err)
    new Notice('连接错误')
  }

  // ============ UI 更新 ============

  private updateUI(state: CompositeState): void {
    const displayInfo = this.stateController.getDisplayInfo()

    if (this.ribbonEl) {
      this.ribbonEl.style.backgroundColor = displayInfo.color
      this.ribbonEl.setAttribute('aria-label', displayInfo.label)
    }

    this.setStatusBarText(displayInfo.statusBarText)
  }

  private setStatusBarText(text: string): void {
    if (this.statusBarEl) {
      this.statusBarEl.textContent = text
    }
  }

  // ============ 文件写入 ============

  private async ensureFolder(folderPath: string): Promise<void> {
    const parts = folderPath.split('/')
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      try {
        if (!this.app.vault.getAbstractFileByPath(current)) {
          await this.app.vault.createFolder(current)
        }
      } catch { /* 已存在或无法创建，继续 */ }
    }
  }

  private async ensureFile(): Promise<void> {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    const folderPath = this.settings.getSettings().outputFolder
    const filename = `${folderPath}/转录_${dateStr}.md`
    this.currentFile = filename

    await this.ensureFolder(folderPath)

    try {
      if (!this.app.vault.getAbstractFileByPath(filename)) {
        await this.app.vault.create(filename, `# Transcription (${dateStr})\n\n`)
      }
    } catch {
      console.warn('[SuRec] Failed to create file:', filename)
    }
  }

  private appendToNote(newText: string): void {
    if (!newText || !this.currentFile) return

    if (this.writtenTexts.has(newText)) {
      console.log('[SuRec] Duplicate text skipped:', newText.slice(0, 30))
      return
    }

    let textToWrite = newText
    if (newText.startsWith('[')) {
      textToWrite = '\n' + newText
    }

    const file = this.app.vault.getAbstractFileByPath(this.currentFile)
    if (!file) return

    this.app.vault.read(file).then((content: string) => {
      const newContent = content + textToWrite
      this.app.vault.modify(file, newContent)
      this.writtenTexts.add(newText)
    })
  }

  private saveSync(): void {
    // 文本已在 appendToNote 中增量写入
  }

  private cleanup(): void {
    this.clearServicePoll()
    this.connectionManager?.disconnect()
    this.serviceMonitor?.stopService()
  }
}
