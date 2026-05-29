import { Plugin, Notice } from 'obsidian'
import { ConnectionManager } from './core/ConnectionManager'
import { MessageBridge } from './core/MessageBridge'
import { StateController } from './core/StateController'
import { ServiceMonitor } from './core/ServiceMonitor'
import { ResourceManager } from './core/ResourceManager'
import { SuRecPluginSettingTab } from './ui/SettingsTab'
import { DEFAULT_SETTINGS } from './types'
import type { ServerMessage, CompositeState } from './types'

const MAX_PORT_SCAN = 10  // P0 .. P0+10

export default class SuRecPlugin extends Plugin {
  settings!: ResourceManager
  private connectionManager!: ConnectionManager
  private messageBridge!: MessageBridge
  private stateController!: StateController
  private serviceMonitor!: ServiceMonitor

  private ribbonEl: HTMLElement | null = null
  private statusBarEl: HTMLElement | null = null
  private currentFile = ''
  private currentText = ''
  private autoStartRecording = false
  private writtenTexts = new Set<string>()
  private servicePollTimer: number | null = null
  private isRecording = false
  private pendingPlaceholder = ''  // 当前占位符文本

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

    for (let offset = 0; offset <= MAX_PORT_SCAN; offset++) {
      const p = basePort + offset
      const running = await this.serviceMonitor.isServiceRunning(p)

      if (!running) {
        console.log(`[SuRec] Port ${p} is free, starting service...`)
        await this.startAndConnect(p)
        return
      }

      const wsOk = await this.tryWsConnect(p)
      if (wsOk) {
        console.log(`[SuRec] Found service on port ${p}`)
        return
      }

      console.log(`[SuRec] Port ${p} occupied by non-su-rec process, trying next...`)
    }

    console.log('[SuRec] All ports occupied, forcing start on base port')
    await this.startAndConnect(basePort)
  }

  private async tryWsConnect(port: number): Promise<boolean> {
    try {
      await this.connectionManager.connect(port)
      return true
    } catch {
      return false
    }
  }

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

  private startServicePoll(): void {
    this.clearServicePoll()
    const settings = this.settings.getSettings()
    if (!settings.autoReconnect) return

    const poll = async () => {
      const state = this.stateController.getCompositeState().base
      if (state === 'connected') return

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

  // ============ 录音控制（指令发送给服务端） ============

  private async startRecording(): Promise<void> {
    const s = this.settings.getSettings()
    const recordingFolder = s.recordingFolder || 'Recordings'

    // 生成录音文件名
    const now = new Date()
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
    const filename = `录音_${ts}.webm`

    // 发送录音指令给服务端
    this.messageBridge.sendAction('start_recording', {
      save_audio: s.saveAudio,
      audio_source: s.audioSource,
      audio_device: s.audioDevice || '',
      recording_filename: filename,
      recording_dir: this.getVaultRecordingDir(recordingFolder),
    })
    this.currentText = ''
    this.writtenTexts.clear()
    this.pendingPlaceholder = ''

    if (this.currentFile && !this.isTodayFile(this.currentFile)) {
      this.currentFile = ''
    }

    await this.ensureFile()
    await this.insertTimestampAndPlaceholder(filename)

    this.isRecording = true
    this.setStatusBarText('🔴 录音中...')
    new Notice('开始录音')
  }

  private getVaultRecordingDir(folder: string): string {
    try {
      const basePath = (this.app.vault.adapter as any).getBasePath?.()
      if (basePath) return basePath + '/' + folder
    } catch {}
    return folder
  }

  private async insertTimestampAndPlaceholder(filename: string): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(this.currentFile)
    if (!file) {
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
    const placeholder = `🔴 录音中 — ${filename}\n`
    this.pendingPlaceholder = placeholder

    const content = await this.app.vault.read(file)
    await this.app.vault.modify(file, content + segment + placeholder)
  }

  private async stopRecording(): Promise<void> {
    this.clearServicePoll()
    this.autoStartRecording = false
    this.isRecording = false
    this.messageBridge.sendAction('stop_recording')
    this.setStatusBarText('转录已停止')
    new Notice('停止录音')
  }

  private replacePlaceholderWithEmbed(filename: string): void {
    if (!this.currentFile || !this.pendingPlaceholder) return
    const recordingFolder = this.settings.getSettings().recordingFolder || 'Recordings'
    const placeholder = this.pendingPlaceholder.trim()
    const embed = `![[${recordingFolder}/${filename}]]`

    const file = this.app.vault.getAbstractFileByPath(this.currentFile)
    if (!file) return

    this.app.vault.read(file).then((content: string) => {
      const newContent = content.replace(placeholder, embed)
      this.app.vault.modify(file, newContent)
      this.pendingPlaceholder = ''
    })
  }

  private isTodayFile(filename: string): boolean {
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    const todayStr = `${year}-${month}-${day}`
    return filename.includes(todayStr)
  }

  // ============ 事件处理 ============

  private onConnectionStateChange(state: string): void {
    if (state === 'disconnected') {
      this.stateController.updateBaseState('disconnected')
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
          const progressMsg = msg.payload?.message || '加载中...'
          this.setStatusBarText(progressMsg)
          this.stateController.updateServerState('loading')
        } else if (msg.status === 'model_loaded' && this.autoStartRecording) {
          this.autoStartRecording = false
          this.startRecording()
        } else if (msg.status === 'idle' && msg.payload?.audio_files?.length) {
          // 服务端返回录音文件，替换占位符为 embed
          for (const filePath of msg.payload.audio_files) {
            const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath
            this.replacePlaceholderWithEmbed(fileName)
          }
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
