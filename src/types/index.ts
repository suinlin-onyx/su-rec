/**
 * Su-Rec Plugin - Type Definitions
 */

// ============ 消息协议 ============

export interface BaseMessage {
  id: string
  type: MessageType
  timestamp: number
}

export interface ClientMessage extends BaseMessage {
  action: ClientAction
  payload?: unknown
}

export interface ServerMessage extends BaseMessage {
  status: ServerStatus
  payload?: ServerPayload
}

export type MessageType =
  | 'state_update'
  | 'state_response'
  | 'transcription'
  | 'error'
  | 'heartbeat'

export type ClientAction =
  | 'start_recording'
  | 'stop_recording'
  | 'query_state'
  | 'heartbeat'

export type ServerStatus =
  | 'idle'
  | 'connected'
  | 'downloading_model'
  | 'loading'
  | 'model_loaded'
  | 'recognizing'
  | 'no_audio'
  | 'audio_detected'
  | 'error'

export interface ServerPayload {
  text?: string
  isFinal?: boolean
  errorMessage?: string
  modelName?: string
  downloadProgress?: number
  step?: string
  message?: string
  elapsed?: number
}

// ============ 状态管理 ============

export type BaseState = 'disconnected' | 'connecting' | 'connected'

export interface CompositeState {
  base: BaseState
  server: ServerStatus
  lastUpdate: number
}

export interface DisplayInfo {
  label: string
  color: string
  icon: string
  statusBarText: string
}

export type StateChangeListener = (newState: CompositeState, prevState: CompositeState) => void

// ============ 连接管理 ============

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface ConnectionConfig {
  url?: string
  useSSL: boolean
  serverHost: string
  serverPort: number
  autoReconnect: boolean
  maxReconnectAttempts: number
  reconnectBaseDelay: number
  heartbeatInterval: number
}

// ============ 设置 ============

export interface PluginSettings {
  serverHost: string
  serverPort: number
  useSSL: boolean
  autoReconnect: boolean
  maxReconnectAttempts: number
  reconnectBaseDelay: number
  autoStartServer: boolean
  serverStartTimeout: number
  outputFolder: string
  debugMode: boolean
  logLevel: 'error' | 'warn' | 'info' | 'debug'
  pythonPath: string
}

export const DEFAULT_SETTINGS: PluginSettings = {
  serverHost: '127.0.0.1',
  serverPort: 9876,
  useSSL: false,
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectBaseDelay: 1000,
  autoStartServer: true,
  serverStartTimeout: 60000,
  outputFolder: '00.raw/01.投资研究/音频转录',
  debugMode: false,
  logLevel: 'info',
  pythonPath: ''
}
