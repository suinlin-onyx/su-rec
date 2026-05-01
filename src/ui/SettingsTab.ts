import { Setting, Modal } from 'obsidian'
import type { PluginSettings } from '../types'

export class SuRecSettingsTab {
  private settings: PluginSettings

  constructor(
    private containerEl: HTMLElement,
    private settingsManager: {
      getSettings(): PluginSettings
      updateSettings(partial: Partial<PluginSettings>): void
      save(): Promise<void>
    }
  ) {
    this.settings = this.settingsManager.getSettings()
  }

  display(): void {
    this.containerEl.empty()
    this.containerEl.addClass('surec-settings')

    // 标题
    const header = this.containerEl.createDiv({ cls: 'surec-settings-header' })
    header.createEl('h2', { text: 'SuRec 设置' })
    const descDiv = this.containerEl.createDiv({ cls: 'surec-settings-desc' })
    descDiv.setText('FunASR 实时语音转录插件配置')

    // 服务器设置
    new Setting(this.containerEl)
      .setName('服务器地址')
      .setDesc('FunASR 服务器的主机地址')
      .addText(text => {
        text.setValue(this.settings.serverHost)
        text.inputEl.addClass('surec-text-input')
        text.onChange(async (value) => {
          this.settings.serverHost = value
          this.settingsManager.updateSettings({ serverHost: value })
          await this.settingsManager.save()
        })
      })

    new Setting(this.containerEl)
      .setName('服务器端口')
      .setDesc('FunASR WebSocket 服务器的端口号')
      .addText(text => {
        text.setValue(String(this.settings.serverPort))
        text.inputEl.addClass('surec-text-input')
        text.onChange(async (value) => {
          this.settings.serverPort = parseInt(value) || 9876
          this.settingsManager.updateSettings({ serverPort: this.settings.serverPort })
          await this.settingsManager.save()
        })
      })

    // 连接设置
    this.createSectionHeading('连接设置')

    new Setting(this.containerEl)
      .setName('自动重连')
      .setDesc('连接断开时自动尝试重连')
      .addToggle(toggle => {
        toggle.setValue(this.settings.autoReconnect)
        toggle.onChange(async (value) => {
          this.settings.autoReconnect = value
          this.settingsManager.updateSettings({ autoReconnect: value })
          await this.settingsManager.save()
        })
      })

    new Setting(this.containerEl)
      .setName('自动拉起服务')
      .setDesc('当服务未运行时自动启动 FunASR 服务进程')
      .addToggle(toggle => {
        toggle.setValue(this.settings.autoStartServer)
        toggle.onChange(async (value) => {
          this.settings.autoStartServer = value
          this.settingsManager.updateSettings({ autoStartServer: value })
          await this.settingsManager.save()
        })
      })

    // 录音设置
    this.createSectionHeading('录音设置')

    new Setting(this.containerEl)
      .setName('VAD 模式')
      .setDesc('语音活动检测模式')
      .addDropdown(dropdown => {
        dropdown.addOption('auto', '自动')
        dropdown.addOption('manual', '手动')
        dropdown.setValue(this.settings.vadMode)
        dropdown.onChange(async (value) => {
          this.settings.vadMode = value as 'auto' | 'manual'
          this.settingsManager.updateSettings({ vadMode: value as 'auto' | 'manual' })
          await this.settingsManager.save()
        })
      })

    new Setting(this.containerEl)
      .setName('最大静音时长')
      .setDesc('检测为静音后自动输出的等待时间（秒）')
      .addText(text => {
        text.setValue(String(this.settings.maxSilenceDuration))
        text.inputEl.addClass('surec-text-input')
        text.onChange(async (value) => {
          this.settings.maxSilenceDuration = parseInt(value) || 3
          this.settingsManager.updateSettings({ maxSilenceDuration: this.settings.maxSilenceDuration })
          await this.settingsManager.save()
        })
      })

    // 输出设置
    this.createSectionHeading('输出设置')

    new Setting(this.containerEl)
      .setName('输出文件夹')
      .setDesc('转录文本的输出路径（相对于保险库根目录）')
      .addText(text => {
        text.setValue(this.settings.outputFolder)
        text.inputEl.addClass('surec-text-input')
        text.onChange(async (value) => {
          this.settings.outputFolder = value
          this.settingsManager.updateSettings({ outputFolder: value })
          await this.settingsManager.save()
        })
      })

    // 调试设置
    this.createSectionHeading('调试')

    new Setting(this.containerEl)
      .setName('调试模式')
      .setDesc('启用详细的控制台日志输出')
      .addToggle(toggle => {
        toggle.setValue(this.settings.debugMode)
        toggle.onChange(async (value) => {
          this.settings.debugMode = value
          this.settingsManager.updateSettings({ debugMode: value })
          await this.settingsManager.save()
        })
      })

    // 状态信息
    this.createSectionHeading('状态')
    this.createStatusInfo()
  }

  private createSectionHeading(title: string): void {
    const heading = this.containerEl.createDiv({ cls: 'surec-settings-heading' })
    heading.setText(title)
  }

  private createStatusInfo(): void {
    const statusDiv = this.containerEl.createDiv({ cls: 'surec-settings-status' })

    const item1 = statusDiv.createDiv({ cls: 'surec-status-item' })
    item1.setText('插件版本: 1.0.0')

    const item2 = statusDiv.createDiv({ cls: 'surec-status-item' })
    item2.setText('协议版本: WebSocket v1')
  }
}

export class SuRecSettingsModal extends Modal {
  private settingsManager: {
    getSettings(): PluginSettings
    updateSettings(partial: Partial<PluginSettings>): void
    save(): Promise<void>
  }

  constructor(
    app: import('obsidian').App,
    settingsManager: {
      getSettings(): PluginSettings
      updateSettings(partial: Partial<PluginSettings>): void
      save(): Promise<void>
    }
  ) {
    super(app)
    this.settingsManager = settingsManager
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.addClass('surec-settings-modal')

    const header = contentEl.createDiv({ cls: 'surec-modal-header' })
    header.createEl('h2', { text: 'SuRec 设置' })

    const closeBtn = header.createEl('button', { text: '×' })
    closeBtn.addClass('surec-modal-close')
    closeBtn.onclick = () => this.close()

    const settingsContainer = contentEl.createDiv({ cls: 'surec-settings-container' })
    const tab = new SuRecSettingsTab(settingsContainer, this.settingsManager)
    tab.display()
  }

  onClose(): void {
    const { contentEl } = this
    contentEl.empty()
  }
}
