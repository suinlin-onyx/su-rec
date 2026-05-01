declare module 'obsidian' {
  export class Plugin {
    app: App
    ribbonIconEl: HTMLElement | null
    statusBarItem: HTMLElement | null

    addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement
    addStatusBarItem(): HTMLElement
    addSettingTab(tab: SettingTabInstance): void
    loadData(): Promise<Record<string, unknown>>
    saveData(data: Record<string, unknown>): Promise<void>
  }

  export interface App {
    vault: Vault
    workspace: Workspace
  }

  export interface Vault {
    getAbstractFileByPath(path: string): TFile | null
    create(path: string, content: string): Promise<TFile>
    createFolder(path: string): Promise<void>
    modify(file: TFile, content: string): Promise<void>
    read(file: TFile): Promise<string>
  }

  export interface Workspace {
    getActiveViewOfType(viewConstructor: unknown): MarkdownView | null
  }

  export interface MarkdownView {
    file: TFile
    editor: Editor
  }

  export interface Editor {
    setValue(content: string): void
    setCursor(pos: { line: number; ch: number }): void
    lineCount: number
  }

  export interface TFile {
    path: string
  }

  export interface SettingTabInstance {
    display(): void
  }

  export class SettingTab {
    constructor(plugin: Plugin, containerEl: HTMLElement)
    display(): void
  }

  export class Setting {
    constructor(containerEl: HTMLElement)
    setName(name: string): this
    setDesc(desc: string | HTMLElement): this
    addText(callback: (text: TextComponent) => void): this
    addToggle(callback: (toggle: ToggleComponent) => void): this
  }

  export class TextComponent {
    setValue(value: string): this
    onChange(callback: (value: string) => void | Promise<void>): this
  }

  export class ToggleComponent {
    setValue(value: boolean): this
    onChange(callback: (value: boolean) => void | Promise<void>): this
  }

  export class Notice {
    constructor(message: string, timeout?: number)
  }
}

declare const require: {
  (id: 'net'): typeof net
  (id: 'fs'): typeof fs
  (id: 'path'): typeof path
  (id: 'child_process'): typeof child_process
}

declare namespace net {
  function Socket(): Socket
  interface Socket {
    setTimeout(ms: number): void
    connect(port: number, host: string): void
    destroy(): void
    on(event: 'connect' | 'timeout' | 'error', cb: () => void): void
  }
}

declare namespace fs {
  function readFileSync(path: string, encoding: string): string
  function writeFileSync(path: string, content: string, encoding: string): void
}

declare namespace path {
  function join(...paths: string[]): string
}

declare namespace child_process {
  function spawn(cmd: string, args: string[], options: object): ChildProcess
  interface ChildProcess {
    pid?: number
    kill(): void
    on(event: 'close', cb: (code: number) => void): void
  }
}
