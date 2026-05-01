import { Plugin, Setting, SettingTab } from 'obsidian'
import type { PluginSettings } from '../types'

export class ResourceManager {
  settings: PluginSettings

  constructor(
    private plugin: Plugin,
    defaultSettings: PluginSettings
  ) {
    this.settings = { ...defaultSettings }
  }

  async load(): Promise<void> {
    const loaded = await this.plugin.loadData()
    this.settings = { ...this.settings, ...(loaded as unknown as PluginSettings) }
  }

  async save(): Promise<void> {
    await this.plugin.saveData(this.settings as unknown as Record<string, unknown>)
  }

  getSettings(): PluginSettings {
    return { ...this.settings }
  }

  updateSettings(partial: Partial<PluginSettings>): void {
    this.settings = { ...this.settings, ...partial }
  }

  createSettingsTab(containerEl: HTMLElement): void {
    const tab = new SuRecSettingTab(containerEl, this)
    tab.display()
  }
}

class SuRecSettingTab {
  private settings: PluginSettings

  constructor(
    private containerEl: HTMLElement,
    private resourceManager: ResourceManager
  ) {
    this.settings = resourceManager.getSettings()
  }

  display(): void {
    this.containerEl.innerHTML = ''

    new Setting(this.containerEl)
      .setName('服务器地址')
      .setDesc('FunASR 服务器的主机地址')
      .addText(text => text
        .setValue(this.settings.serverHost)
        .onChange(async (value) => {
          this.settings.serverHost = value
          this.resourceManager.updateSettings({ serverHost: value })
          await this.resourceManager.save()
        }))

    new Setting(this.containerEl)
      .setName('服务器端口')
      .setDesc('FunASR 服务器的端口号')
      .addText(text => text
        .setValue(String(this.settings.serverPort))
        .onChange(async (value) => {
          this.settings.serverPort = parseInt(value) || 9876
          this.resourceManager.updateSettings({ serverPort: this.settings.serverPort })
          await this.resourceManager.save()
        }))

    new Setting(this.containerEl)
      .setName('自动重连')
      .setDesc('连接断开时自动重连')
      .addToggle(toggle => toggle
        .setValue(this.settings.autoReconnect)
        .onChange(async (value) => {
          this.settings.autoReconnect = value
          this.resourceManager.updateSettings({ autoReconnect: value })
          await this.resourceManager.save()
        }))

    new Setting(this.containerEl)
      .setName('自动拉起服务')
      .setDesc('服务未运行时自动拉起 FunASR 服务')
      .addToggle(toggle => toggle
        .setValue(this.settings.autoStartServer)
        .onChange(async (value) => {
          this.settings.autoStartServer = value
          this.resourceManager.updateSettings({ autoStartServer: value })
          await this.resourceManager.save()
        }))

    new Setting(this.containerEl)
      .setName('输出文件夹')
      .setDesc('转录文本的输出路径')
      .addText(text => text
        .setValue(this.settings.outputFolder)
        .onChange(async (value) => {
          this.settings.outputFolder = value
          this.resourceManager.updateSettings({ outputFolder: value })
          await this.resourceManager.save()
        }))

    new Setting(this.containerEl)
      .setName('调试模式')
      .setDesc('启用详细的调试日志')
      .addToggle(toggle => toggle
        .setValue(this.settings.debugMode)
        .onChange(async (value) => {
          this.settings.debugMode = value
          this.resourceManager.updateSettings({ debugMode: value })
          await this.resourceManager.save()
        }))
  }
}
