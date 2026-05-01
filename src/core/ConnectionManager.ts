import { uuidv4 } from '../utils/uuid'
import type { ConnectionState, ConnectionConfig, ServerMessage } from '../types'

export interface ConnectionManagerCallbacks {
  onStateChange: (state: ConnectionState) => void
  onMessage: (message: ServerMessage) => void
  onError: (error: Error) => void
  onConnected?: () => void  // WebSocket 连接真正建立后的回调
}

export class ConnectionManager {
  private ws: WebSocket | null = null
  private state: ConnectionState = 'disconnected'
  private reconnectAttempts = 0
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null

  constructor(
    private config: ConnectionConfig,
    private callbacks: ConnectionManagerCallbacks
  ) {}

  async connect(url?: string): Promise<void> {
    const targetUrl = url ?? this.buildUrl()
    this.setState('connecting')

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(targetUrl)

      this.ws.onopen = () => {
        this.setState('connected')
        this.reconnectAttempts = 0
        this.startHeartbeat()
        // 通知外部 WebSocket 已真正建立，等待服务端发送 connected 状态
        this.callbacks.onConnected?.()
        resolve()
      }

      this.ws.onmessage = (event) => {
        try {
          const message: ServerMessage = JSON.parse(event.data)
          this.callbacks.onMessage(message)
        } catch (e) {
          console.warn('[ConnectionManager] Failed to parse message:', e)
        }
      }

      this.ws.onerror = () => {
        this.callbacks.onError(new Error('WebSocket error'))
      }

      this.ws.onclose = () => {
        this.stopHeartbeat()
        if (this.state !== 'disconnected') {
          this.setState('disconnected')
          this.scheduleReconnect()
        }
      }
    })
  }

  disconnect(): void {
    this.setState('disconnected')
    this.stopHeartbeat()
    this.cancelReconnect()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      console.warn('[ConnectionManager] Cannot send, WebSocket not open')
    }
  }

  getState(): ConnectionState {
    return this.state
  }

  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState
      this.callbacks.onStateChange(newState)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      // 按 PROTOCOL.md 6.1.2 格式发送心跳
      this.send({
        id: uuidv4(),
        type: 'heartbeat',
        action: 'heartbeat',
        payload: {},
        timestamp: Date.now()
      })
    }, this.config.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) return
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.warn('[ConnectionManager] Max reconnect attempts reached')
      return
    }

    const delay = this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts)
    this.reconnectAttempts++
    this.setState('reconnecting')

    this.reconnectTimer = window.setTimeout(() => {
      this.connect().catch(() => {})
    }, Math.min(delay, 30000))
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private buildUrl(): string {
    const protocol = this.config.useSSL ? 'wss' : 'ws'
    return `${protocol}://${this.config.serverHost}:${this.config.serverPort}`
  }
}
