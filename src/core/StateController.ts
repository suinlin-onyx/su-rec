import type {
  BaseState,
  ServerStatus,
  CompositeState,
  DisplayInfo,
  StateChangeListener,
  ServerMessage
} from '../types'

const STATE_DISPLAY_MAP: Record<ServerStatus, DisplayInfo> = {
  idle: { label: '空闲', color: '#888888', icon: 'circle', statusBarText: '就绪' },
  connected: { label: '已连接', color: '#4488ff', icon: 'wifi', statusBarText: '已连接' },
  downloading_model: { label: '下载模型', color: '#ff8800', icon: 'download', statusBarText: '下载模型中...' },
  model_loaded: { label: '模型就绪', color: '#44ff44', icon: 'check-circle', statusBarText: '模型就绪' },
  recognizing: { label: '识别中', color: '#44ff44', icon: 'mic', statusBarText: '识别中...' },
  no_audio: { label: '无音频', color: '#ff4444', icon: 'alert-triangle', statusBarText: '无音频输入' },
  audio_detected: { label: '检测到音频', color: '#44ff44', icon: 'mic', statusBarText: '检测到音频' },
  error: { label: '错误', color: '#ff4444', icon: 'alert-circle', statusBarText: '发生错误' }
}

const BASE_DISPLAY_MAP: Record<BaseState, Omit<DisplayInfo, 'label'>> = {
  disconnected: { color: '#ff4444', icon: 'plug', statusBarText: '点击连接' },
  connecting: { color: '#4488ff', icon: 'loader', statusBarText: '连接中...' },
  connected: { color: '#44ff44', icon: 'wifi', statusBarText: '已连接' }
}

export class StateController {
  private state: CompositeState = {
    base: 'disconnected',
    server: 'idle',
    lastUpdate: Date.now()
  }

  private listeners: Set<StateChangeListener> = new Set()

  updateBaseState(base: BaseState): void {
    const prev = { ...this.state }
    this.state = { ...this.state, base, lastUpdate: Date.now() }
    this.notifyListeners(prev)
  }

  updateServerState(server: ServerStatus): void {
    const prev = { ...this.state }
    this.state = { ...this.state, server, lastUpdate: Date.now() }
    this.notifyListeners(prev)
  }

  getCompositeState(): CompositeState {
    return { ...this.state }
  }

  getDisplayInfo(): DisplayInfo {
    const { base, server } = this.state

    if (base === 'disconnected') {
      return { label: '未连接', ...BASE_DISPLAY_MAP[base] }
    }

    if (base === 'connecting') {
      return { label: '连接中...', ...BASE_DISPLAY_MAP[base] }
    }

    // base === 'connected', use server state for display
    return STATE_DISPLAY_MAP[server]
  }

  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  handleServerMessage(msg: ServerMessage): void {
    if (msg.type === 'state_update' || msg.type === 'state_response') {
      this.updateServerState(msg.status)
    }
  }

  private notifyListeners(prev: CompositeState): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state, prev)
      } catch (e) {
        console.error('[StateController] Listener error:', e)
      }
    }
  }
}
