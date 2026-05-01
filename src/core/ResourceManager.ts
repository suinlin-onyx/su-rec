import { Plugin } from 'obsidian'
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
    // This is for non-modal settings display if needed
  }
}
