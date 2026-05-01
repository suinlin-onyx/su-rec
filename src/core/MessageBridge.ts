import { uuidv4 } from '../utils/uuid'
import type { ClientMessage, ServerMessage, ClientAction } from '../types'

type MessageHandler = (message: ServerMessage) => void

export class MessageBridge {
  private handlers: Map<string, MessageHandler> = new Map()

  constructor(private sendFn: (msg: ClientMessage) => void) {}

  sendAction(action: ClientAction, payload?: unknown): string {
    const id = uuidv4()
    const message: ClientMessage = {
      id,
      type: this.actionToMessageType(action),
      action,
      payload,
      timestamp: Date.now()
    }
    this.sendFn(message)
    return id
  }

  handleMessage(serverMsg: ServerMessage): void {
    const handler = this.handlers.get(serverMsg.id)
    if (handler) {
      handler(serverMsg)
      this.handlers.delete(serverMsg.id)
    }
  }

  registerHandler(id: string, handler: MessageHandler): void {
    this.handlers.set(id, handler)
    setTimeout(() => {
      if (this.handlers.has(id)) {
        this.handlers.delete(id)
        console.warn(`[MessageBridge] Handler timeout: ${id}`)
      }
    }, 10000)
  }

  private actionToMessageType(action: ClientAction) {
    switch (action) {
      case 'query_state': return 'state_response'
      case 'heartbeat': return 'heartbeat'
      default: return 'state_update'
    }
  }
}

export const Messages = {
  startRecording(): ClientMessage {
    return {
      id: uuidv4(),
      type: 'state_update',
      action: 'start_recording',
      timestamp: Date.now()
    }
  },

  stopRecording(): ClientMessage {
    return {
      id: uuidv4(),
      type: 'state_update',
      action: 'stop_recording',
      timestamp: Date.now()
    }
  },

  queryState(): ClientMessage {
    return {
      id: uuidv4(),
      type: 'state_response',
      action: 'query_state',
      timestamp: Date.now()
    }
  },

  heartbeat(): ClientMessage {
    return {
      id: uuidv4(),
      type: 'heartbeat',
      action: 'heartbeat',
      timestamp: Date.now()
    }
  }
}
