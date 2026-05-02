import { Plugin, Notice } from 'obsidian'
import { ConnectionManager } from './core/ConnectionManager'
import { MessageBridge } from './core/MessageBridge'
import { StateController } from './core/StateController'
import { ServiceMonitor } from './core/ServiceMonitor'
import { ResourceManager } from './core/ResourceManager'
import { SuRecSettingsModal } from './ui/SettingsTab'
import { DEFAULT_SETTINGS } from './types'
import type { ServerMessage, CompositeState } from './types'

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
  private autoStartRecording = false  // 标记：连接成功后自动开始录音

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
      cwd: 'D:\\arvin\\obsidian_workpace\\su_obs_voice\\voice-transcribe'
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
    this.addSettingIcon()

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

  private addSettingIcon(): void {
    this.addRibbonIcon('settings', 'SuRec Settings', () => {
      // Create a modal for settings
      const modal = new SuRecSettingsModal(this.app, this.settings)
      modal.open()
    })
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
        // 用户主动点击时，关闭自动启动标记，直接开始录音
        this.autoStartRecording = false
        this.startRecording()
      }
    }
  }

  private async tryConnect(): Promise<void> {
    this.stateController.updateBaseState('connecting')
    this.setStatusBarText('检查服务状态...')
    this.autoStartRecording = true  // 标记：连接成功后自动开始录音

    try {
      const serviceRunning = await this.serviceMonitor.ensureServiceRunning()
      if (!serviceRunning) {
        new Notice('服务启动失败，请手动启动 FunASR 服务')
        this.stateController.updateBaseState('disconnected')
        this.autoStartRecording = false
        return
      }

      await this.connectionManager.connect()
      // 不在这里发送 start_recording，等待服务端 connected 状态

    } catch (e) {
      console.error('[SuRec] Connect failed:', e)
      new Notice('连接失败')
      this.stateController.updateBaseState('disconnected')
      this.autoStartRecording = false
    }
  }

  private startRecording(): void {
    this.messageBridge.sendAction('start_recording')
    this.currentText = ''

    // 检查当前文件是否是今天的日期，不是则重置以创建新文件
    if (this.currentFile && !this.isTodayFile(this.currentFile)) {
      this.currentFile = ''
    }

    this.ensureFile()
    this.insertSegment()
    new Notice('开始录音')
  }

  private isTodayFile(filename: string): boolean {
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    const todayStr = `${year}-${month}-${day}`
    return filename.includes(todayStr)
  }

  private stopRecording(): void {
    this.messageBridge.sendAction('stop_recording')
    if (this.currentText) {
      this.updateNote()
    }
    new Notice('停止录音')
  }

  private onConnectionStateChange(state: string): void {
    if (state === 'disconnected') {
      this.stateController.updateBaseState('disconnected')
      this.autoStartRecording = false  // 重置自动开始标记
    }
  }

  private onServerMessage(msg: ServerMessage): void {
    console.log('[SuRec] Server message:', msg)

    switch (msg.type) {
      case 'state_update':
      case 'state_response':
        // 检查是否是服务端返回的 connected 状态
        if (msg.status === 'connected') {
          this.stateController.updateBaseState('connected')
          new Notice('已连接到服务器')
          // 连接成功，等待服务端再次推送 model_loaded 后再开始录音
        } else if (msg.status === 'model_loaded' && this.autoStartRecording) {
          // 服务端模型加载完成，现在可以开始录音
          this.autoStartRecording = false
          this.messageBridge.sendAction('start_recording')
          this.currentText = ''
          this.ensureFile()
          this.insertSegment()
          new Notice('开始录音')
        }
        this.stateController.handleServerMessage(msg)
        break

      case 'transcription':
        if (msg.payload?.text) {
          this.currentText += msg.payload.text
          const preview = msg.payload.text.replace(/\n/g, '').slice(-20) || '...'
          this.setStatusBarText(preview)
          this.updateNote()
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

  private ensureFile(): void {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    const folderPath = this.settings.getSettings().outputFolder
    const filename = `${folderPath}/转录_${dateStr}.md`

    const vault = this.app.vault
    let dir = vault.getAbstractFileByPath(folderPath)
    if (!dir) {
      vault.createFolder(folderPath)
    }

    let file = vault.getAbstractFileByPath(filename)
    if (!file) {
      vault.create(filename, `# Transcription (${dateStr})\n\n`)
    }

    this.currentFile = filename
  }

  private insertSegment(): void {
    const now = new Date()
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })

    this.ensureFile()
    const file = this.app.vault.getAbstractFileByPath(this.currentFile)
    if (!file) return

    this.app.vault.read(file).then((content: string) => {
      const newSegment = `\n---\n### ${timeStr}\n`
      this.app.vault.modify(file, content + newSegment)
    })
  }

  private updateNote(): void {
    const self = this
    if (!this.currentText || !this.currentFile) return

    const file = this.app.vault.getAbstractFileByPath(this.currentFile)
    if (!file) return

    this.app.vault.read(file).then((content: string) => {
      const lastHeaderIdx = content.lastIndexOf('### ')
      if (lastHeaderIdx < 0) return

      const afterHeader = content.indexOf('\n', lastHeaderIdx)
      if (afterHeader < 0) return
      const nextDivider = content.indexOf('\n---', afterHeader)
      const before = content.substring(0, afterHeader + 1)
      const after = nextDivider > 0 ? content.substring(nextDivider) : ''

      const newContent = before + self.currentText + '\n' + after
      self.app.vault.modify(file, newContent)
    })
  }

  private saveSync(): void {
    if (!this.currentText || !this.currentFile) return

    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')

    // Use vault adapter basePath via DataAdapter
    const basePath = (this.app.vault as unknown as { adapter: { basePath: string } }).adapter.basePath
    const filePath = path.join(basePath, this.currentFile)

    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const lastHeaderIdx = content.lastIndexOf('### ')
      if (lastHeaderIdx >= 0) {
        const afterHeader = content.indexOf('\n', lastHeaderIdx)
        if (afterHeader >= 0) {
          const nextDivider = content.indexOf('\n---', afterHeader)
          const before = content.substring(0, afterHeader + 1)
          const after = nextDivider > 0 ? content.substring(nextDivider) : ''
          const newContent = before + this.currentText + '\n' + after
          fs.writeFileSync(filePath, newContent, 'utf-8')
        }
      }
    } catch (e) {
      console.error('[SuRec] Save failed:', e)
    }
  }

  private cleanup(): void {
    this.connectionManager?.disconnect()
    this.serviceMonitor?.stopService()
  }
}
