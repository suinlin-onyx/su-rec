import { PluginSettingTab, Setting, Modal } from 'obsidian'
import type SuRecPlugin from '../main'
import type { PluginSettings } from '../types'
import { ServiceMonitor } from '../core/ServiceMonitor'

/** Standard Obsidian settings tab — gear icon in Settings → Community plugins. */
export class SuRecPluginSettingTab extends PluginSettingTab {
  id = 'su-rec'
  name = 'SuRec'
  plugin: SuRecPlugin

  constructor(app: import('obsidian').App, plugin: SuRecPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    const settings = this.plugin.settings.getSettings()
    containerEl.empty()
    containerEl.addClass('surec-settings')

    buildSettingsUI(containerEl, settings, this.plugin.settings)
  }
}

// ── Modal (ribbon icon fallback) ──────────────────────────────

export class SuRecSettingsTab {
  private settings: PluginSettings

  constructor(
    private containerEl: HTMLElement,
    private store: {
      getSettings(): PluginSettings
      updateSettings(partial: Partial<PluginSettings>): void
      save(): Promise<void>
    }
  ) {
    this.settings = this.store.getSettings()
  }

  display(): void {
    this.containerEl.empty()
    this.containerEl.addClass('surec-settings')
    buildSettingsUI(this.containerEl, this.settings, this.store)
  }
}

export class SuRecSettingsModal extends Modal {
  constructor(
    app: import('obsidian').App,
    private store: {
      getSettings(): PluginSettings
      updateSettings(partial: Partial<PluginSettings>): void
      save(): Promise<void>
    }
  ) {
    super(app)
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
    buildSettingsUI(settingsContainer, this.store.getSettings(), this.store)
  }

  onClose(): void {
    const { contentEl } = this
    contentEl.empty()
  }
}

// ── Shared settings UI ─────────────────────────────────────────

function buildSettingsUI(
  el: HTMLElement,
  settings: PluginSettings,
  store: {
    updateSettings(partial: Partial<PluginSettings>): void
    save(): Promise<void>
  }
): void {
  new Setting(el)
    .setName('服务器地址')
    .setDesc('FunASR 服务器的主机地址')
    .addText(text => {
      text.setValue(settings.serverHost)
      text.inputEl.addClass('surec-text-input')
      text.onChange(async (value) => {
        store.updateSettings({ serverHost: value })
        await store.save()
      })
    })

  new Setting(el)
    .setName('服务器端口')
    .setDesc('FunASR WebSocket 服务器的端口号')
    .addText(text => {
      text.setValue(String(settings.serverPort))
      text.inputEl.addClass('surec-text-input')
      text.onChange(async (value) => {
        store.updateSettings({ serverPort: parseInt(value) || 9876 })
        await store.save()
      })
    })

  heading(el, '连接设置')

  new Setting(el)
    .setName('自动重连')
    .setDesc('连接断开时自动尝试重连')
    .addToggle(toggle => {
      toggle.setValue(settings.autoReconnect)
      toggle.onChange(async (value) => {
        store.updateSettings({ autoReconnect: value })
        await store.save()
      })
    })

  new Setting(el)
    .setName('自动拉起服务')
    .setDesc('当服务未运行时自动启动 FunASR 服务进程')
    .addToggle(toggle => {
      toggle.setValue(settings.autoStartServer)
      toggle.onChange(async (value) => {
        store.updateSettings({ autoStartServer: value })
        await store.save()
      })
    })

  heading(el, '输出设置')

  new Setting(el)
    .setName('转录文本路径')
    .setDesc('转录文本的输出路径（相对于保险库根目录），默认 Transcriptions')
    .addText(text => {
      text.setValue(settings.outputFolder)
      text.inputEl.setAttribute('placeholder', 'Transcriptions')
      text.inputEl.addClass('surec-text-input')
      text.onChange(async (value) => {
        store.updateSettings({ outputFolder: value || 'Transcriptions' })
        await store.save()
      })
    })

  new Setting(el)
    .setName('录音文件路径')
    .setDesc('录音文件的输出路径（相对于保险库根目录），默认 Recordings')
    .addText(text => {
      text.setValue(settings.recordingFolder)
      text.inputEl.setAttribute('placeholder', 'Recordings')
      text.inputEl.addClass('surec-text-input')
      text.onChange(async (value) => {
        store.updateSettings({ recordingFolder: value || 'Recordings' })
        await store.save()
      })
    })

  heading(el, '调试')

  new Setting(el)
    .setName('调试模式')
    .setDesc('启用后显示服务端控制台窗口和详细日志')
    .addToggle(toggle => {
      toggle.setValue(settings.debugMode)
      toggle.onChange(async (value) => {
        store.updateSettings({ debugMode: value })
        await store.save()
      })
    })

  // 自动检测 Python 路径
  const detected = ServiceMonitor.autoDetectPython()
  const detectedHint = detected ? `检测到: ${detected}` : '未检测到 Python，请手动填写'

  let pythonTextInput: any = null

  const pythonSetting = new Setting(el)
    .setName('Python 路径')
    .setDesc(`${detectedHint}。手动填写后优先生效`)
    .addText(text => {
      text.setValue(settings.pythonPath)
      text.inputEl.setAttribute('placeholder', detected || '例如: C:\\Python311\\python.exe')
      text.inputEl.addClass('surec-text-input')
      pythonTextInput = text
      text.onChange(async (value) => {
        store.updateSettings({ pythonPath: value })
        await store.save()
      })
    })

  pythonSetting.addExtraButton(button => {
    button.setIcon('search')
    button.setTooltip('自动检测 Python 路径')
    button.onClick(async () => {
      const path = ServiceMonitor.autoDetectPython()
      if (path) {
        store.updateSettings({ pythonPath: path })
        await store.save()
        if (pythonTextInput) {
          pythonTextInput.setValue(path)
        }
      }
    })
  })
}

function heading(el: HTMLElement, title: string): void {
  const h = el.createDiv({ cls: 'surec-settings-heading' })
  h.setText(title)
}
