# Su-Rec 状态管理重构方案 PRD

## 1. 背景与目标

### 现状问题

- 客户端维护过多状态（`offline | connecting | recording | stopped`）
- 状态硬编码，无法动态扩展
- 服务端状态变化无法及时同步到客户端
- TCP Socket 缺乏心跳机制，连接稳定性不足

### 目标

- **客户端极简状态**：仅保留 `disconnected` | `connecting` 两个基础状态
- **服务端驱动状态**：所有业务状态（`connected`、`recognizing`、`downloading_model`、`no_audio` 等）由服务端回传
- **双向状态同步**：支持服务端主动推送和客户端主动查询
- **标准化交互协议**：统一的消息格式和状态编码

---

## 2. 架构设计

### 2.1 模块划分

```
┌─────────────────────────────────────────────────────────┐
│                      客户端 (Client)                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ 连接管理模块  │  │ 状态控制模块 │  │ 服务监测模块 │      │
│  │ Connection  │  │   State     │  │  Monitor    │      │
│  │  Manager    │  │  Controller │  │             │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│         │                │                │              │
│         └────────────────┼────────────────┘              │
│                          ▼                              │
│              ┌─────────────────────┐                    │
│              │   消息通信模块       │                    │
│              │   MessageBridge    │                    │
│              └──────────┬──────────┘                    │
├─────────────────────────┼──────────────────────────────┤
│                      服务端 (Server)                     │
│              ┌──────────▼──────────┐                   │
│              │   状态推送模块       │                    │
│              │   StatePublisher    │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 核心技术选型

#### Socket vs WebSocket 对比

| 维度               | Socket (TCP)    | WebSocket              |
| ---------------- | --------------- | ---------------------- |
| **协议层**          | TCP 传输层         | HTTP 握手 + TCP 双工通信     |
| **心跳机制**         | 需手动实现           | 内置 ping/pong           |
| **断线检测**         | 需要 keepalive    | 自动检测                   |
| **跨平台**          | 需要处理编码/分包       | 浏览器原生支持                |
| **实现复杂度**        | 较高（分包、粘包）       | 低（帧机制透明）               |
| **二进制支持**        | 原生              | 需 Base64 或 ArrayBuffer |
| **Obsidian 兼容性** | `import_net` 可用 | 需 `WebSocket` API      |

**推荐**：WebSocket

**理由**：

1. 内置心跳/断线检测，减少手动维护成本
2. 消息边界清晰（帧），无需处理分包/粘包
3. Obsidian Desktop mode 支持 WebSocket API
4. 标准化程度高，易于调试和扩展

**注意事项**：

- 需处理 `ws://` vs `wss://` 配置
- 二进制数据需用 ArrayBuffer/Blob

---

## 3. 模块详细设计

### 3.1 连接管理模块 (ConnectionManager)

**职责**：

- 维护 WebSocket 长连接
- 自动重连策略（指数退避）
- 心跳保活
- 连接状态上报

**接口设计**：

```typescript
interface ConnectionManager {
  // 连接生命周期的状态回调
  onStateChange: (state: ConnectionState) => void

  // 收到消息时的回调
  onMessage: (message: ServerMessage) => void

  // 连接错误时的回调
  onError: (error: Error) => void

  // 建立连接
  connect(url: string): Promise<void>

  // 断开连接
  disconnect(): void

  // 发送消息
  send(message: ClientMessage): void

  // 获取当前连接状态
  getState(): ConnectionState
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
```

**重连策略**：

```
首次重连: 1s
二次重连: 2s
三次重连: 4s
... 最高 30s
达到最大次数后: 通知用户
```

### 3.2 消息通信模块 (MessageBridge)

**职责**：

- 消息的序列化/反序列化
- 消息类型路由
- 标准化交互协议

**消息格式**：

```typescript
// 基础消息结构
interface BaseMessage {
  id: string        // 消息唯一标识 (UUID)
  type: MessageType // 消息类型
  timestamp: number // 时间戳 (ms)
}

interface ClientMessage extends BaseMessage {
  action: ClientAction
  payload?: unknown
}

interface ServerMessage extends BaseMessage {
  status: ServerStatus
  payload?: unknown
}

// 消息类型枚举
type MessageType =
  | 'state_update'    // 服务端状态更新（主动推送）
  | 'state_response'  // 状态查询响应
  | 'transcription'   // 识别结果
  | 'error'           // 错误信息
  | 'heartbeat'       // 心跳

// 客户端动作
type ClientAction =
  | 'start_recording'
  | 'stop_recording'
  | 'query_state'
  | 'heartbeat'

// 服务端状态
type ServerStatus =
  | 'idle'                    // 空闲
  | 'connected'               // 已连接
  | 'downloading_model'       // 下载模型中
  | 'model_loaded'            // 模型加载完成
  | 'recognizing'             // 识别中
  | 'no_audio'                // 无音频输入
  | 'audio_detected'          // 检测到音频
  | 'error'                   // 错误状态
```

### 3.3 状态控制模块 (StateController)

**职责**：

- 统一管理所有状态（客户端基础状态 + 服务端业务状态）
- 状态到 UI 的映射
- 状态变化时的回调处理

**接口设计**：

```typescript
interface StateController {
  // 获取当前组合状态
  getCompositeState(): CompositeState

  // 更新基础状态
  updateBaseState(state: BaseState): void

  // 更新服务端状态
  updateServerState(state: ServerState): void

  // 注册状态变化监听器
  onStateChange(listener: StateChangeListener): void

  // 获取状态对应的显示信息
  getDisplayInfo(): DisplayInfo
}

interface CompositeState {
  base: BaseState           // disconnected | connecting
  server: ServerState       // 服务端状态
  lastUpdate: number        // 最后更新时间
}

interface DisplayInfo {
  label: string             // 显示文本
  color: string             // 颜色代码
  icon: string              // 图标名称
  statusBarText: string     // 状态栏文本
}

// 状态 -> 显示信息映射
const STATE_DISPLAY_MAP: Record<ServerState, DisplayInfo> = {
  idle: { label: '空闲', color: '#888888', icon: 'circle', statusBarText: '就绪' },
  connected: { label: '已连接', color: '#4488ff', icon: 'wifi', statusBarText: '已连接' },
  downloading_model: { label: '下载模型', color: '#ff8800', icon: 'download', statusBarText: '下载模型中...' },
  model_loaded: { label: '模型就绪', color: '#44ff44', icon: 'check-circle', statusBarText: '模型就绪' },
  recognizing: { label: '识别中', color: '#44ff44', icon: 'mic', statusBarText: '识别中...' },
  no_audio: { label: '无音频', color: '#ff4444', icon: 'alert-triangle', statusBarText: '无音频输入' },
  audio_detected: { label: '检测到音频', color: '#44ff44', icon: 'mic', statusBarText: '检测到音频' },
  error: { label: '错误', color: '#ff4444', icon: 'alert-circle', statusBarText: '发生错误' }
}
```

### 3.4 远程服务监测模块 (ServiceMonitor)

**职责**：

- 检测远程服务是否运行
- 在服务未运行时自动拉起
- 避免重复拉起
- 提供服务状态查询接口

**设计思路**：

```
┌──────────────────────────────────────────────────────────┐
│                    服务发现流程                           │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. [连接前] TCP Port Check                             │
│     └─> telnet/nc 检测 9876 端口是否开放                │
│     └─> 若开放 → 认为服务已运行                         │
│     └─> 若未开放 → 进入步骤 2                           │
│                                                          │
│  2. [服务未运行] 拉起服务                                │
│     └─> 检测是否已存在相同进程 (防止重复)                │
│     └─> 若无 → spawn 新进程                             │
│     └─> 若有 → 等待服务就绪                             │
│                                                          │
│  3. [等待服务就绪]                                       │
│     └─> 轮询端口检测 (间隔 500ms, 最多 60s)             │
│     └─> 超时 → 通知用户失败                             │
│                                                          │
│  4. [建立连接] WebSocket 连接                            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**防重复拉起策略**：

```typescript
interface ServiceMonitor {
  // 检测服务是否运行
  isServiceRunning(): Promise<boolean>

  // 启动服务（带防重复检查）
  startService(): Promise<boolean>

  // 等待服务就绪
  waitForService(timeout?: number): Promise<boolean>

  // 停止服务
  stopService(): void

  // 获取服务进程信息
  getServiceProcess(): ChildProcess | null
}
```

**连接前状态查询方案**：

| 方案                 | 原理                          | 优点        | 缺点                 |
| ------------------ | --------------------------- | --------- | ------------------ |
| **TCP Port Check** | 检测端口是否开放                    | 简单快速      | 只能知道端口开放，不知道服务是否就绪 |
| **HTTP/WS Health** | 发送 HTTP/WS 请求               | 能知道服务真正就绪 | 需要服务端实现 health 接口  |
| **混合模式**           | 先 Port Check，再 Health Check | 兼顾速度和可靠性  | 实现稍复杂              |

**推荐**：混合模式

1. 先做 Port Check（快速过滤）
2. 再做 WebSocket 握手（真正验证服务可用性）

### 3.5 资源管理模块 (ResourceManager / Settings)

**职责**：

- 管理插件设置
- 提供设置 UI
- 持久化配置

**设置项设计**：

```typescript
interface PluginSettings {
  // 连接配置
  serverHost: string          // 服务器地址 (默认: 127.0.0.1)
  serverPort: number          // 服务器端口 (默认: 9876)
  useSSL: boolean             // 是否使用 SSL (默认: false)

  // 重连配置
  autoReconnect: boolean      // 自动重连 (默认: true)
  maxReconnectAttempts: number // 最大重连次数 (默认: 10)
  reconnectBaseDelay: number  // 基础重连延迟 ms (默认: 1000)

  // 服务拉起配置
  autoStartServer: boolean    // 服务未运行时自动拉起 (默认: true)
  serverStartTimeout: number  // 服务启动超时 ms (默认: 60000)

  // 录音配置
  vadMode: 'manual' | 'auto' // VAD 模式 (默认: 'auto')
  maxSilenceDuration: number // 最大静音时长 s (默认: 3)

  // 输出配置
  outputFolder: string        // 输出文件夹 (默认: 00.raw/01.投资研究/音频转录)

  // 调试配置
  debugMode: boolean          // 调试模式 (默认: false)
  logLevel: 'error' | 'warn' | 'info' | 'debug' // 日志级别
}
```

---

## 4. 消息协议设计

### 4.1 完整消息流

```
客户端 ──────────────────────────────────────────────── 服务端

[建立连接]
  connect(url)
        │
        ▼
  ┌─ connecting ─┐
  │              │
  │         ┌────▼────┐
  │         │  握手   │◄──── Server: state_update {status: "connected"}
  │         └────┬────┘
  │              │
  │         ┌────▼────┐
  │         │connected│
  └────────►│         │
             └─────────┘

[客户端请求]
  ClientMessage {
    id: "uuid",
    type: "state_response",
    action: "query_state",
    timestamp: 1234567890
  }
        │
        ▼
  ServerMessage {
    id: "uuid",
    type: "state_update",
    status: "model_loaded",
    payload: {...},
    timestamp: 1234567890
  }

[识别结果推送]
  ServerMessage {
    type: "transcription",
    payload: {
      text: "识别到的文字",
      timestamp: 1234567890,
      isFinal: true
    }
  }

[服务端主动推送]
  ServerMessage {
    type: "state_update",
    status: "no_audio",
    timestamp: 1234567890
  }
```

### 4.2 状态机定义

```
客户端基础状态:
  disconnected ──┬──► connecting ──► connected
                 │                           │
                 ◄───────────────────────────┘
                 (disconnected when error/disconnect)

服务端业务状态 (由服务端决定，客户端仅展示):
  idle
    │
    ▼
  downloading_model ─► model_loaded ─┬─► recognizing ─► idle
    │                                │       ▲         │
    │                                └───────┘         │
    ▼                                           no_audio
  error ────────────────────────────────────────────────
```

---

## 5. 实现计划

### Phase 1: 基础设施

- [ ] 迁移 TCP Socket → WebSocket
- [ ] 实现 ConnectionManager
- [ ] 实现 MessageBridge (消息序列化)
- [ ] 设计状态映射表

### Phase 2: 核心功能

- [ ] 实现 StateController
- [ ] 实现 ServiceMonitor (服务检测 + 自动拉起)
- [ ] 实现 ResourceManager (设置持久化)

### Phase 3: 服务端配合

- [ ] 服务端实现状态主动推送
- [ ] 服务端实现 health 接口
- [ ] 服务端消息协议对接

### Phase 4: 集成测试

- [ ] 完整流程测试
- [ ] 异常场景测试 (断网、服务崩溃、重启)
- [ ] UI 状态显示验证

---

## 6. 风险与注意事项

| 风险            | 缓解措施                 |
| ------------- | -------------------- |
| WebSocket 兼容性 | Obsidian Desktop 已支持 |
| 服务拉起权限        | 需用户授权                |
| 防火墙拦截         | 配置说明                 |
| 服务端改造         | 需同步修改 Python 服务端     |

---

## 7. 附录

### A. 完整类型定义

```typescript
// 消息相关
interface BaseMessage {
  id: string
  type: MessageType
  timestamp: number
}

interface ClientMessage extends BaseMessage {
  action: ClientAction
  payload?: unknown
}

interface ServerMessage extends BaseMessage {
  status: ServerStatus
  payload?: ServerPayload
}

type MessageType = 'state_update' | 'state_response' | 'transcription' | 'error' | 'heartbeat'
type ClientAction = 'start_recording' | 'stop_recording' | 'query_state' | 'heartbeat'
type ServerStatus = 'idle' | 'connected' | 'downloading_model' | 'model_loaded' | 'recognizing' | 'no_audio' | 'audio_detected' | 'error'

interface ServerPayload {
  text?: string
  isFinal?: boolean
  errorMessage?: string
  modelName?: string
  downloadProgress?: number
}

// 状态相关
type BaseState = 'disconnected' | 'connecting'
type CompositeState = { base: BaseState; server: ServerStatus; lastUpdate: number }

interface DisplayInfo {
  label: string
  color: string
  icon: string
  statusBarText: string
}

// 设置相关
interface PluginSettings {
  serverHost: string
  serverPort: number
  useSSL: boolean
  autoReconnect: boolean
  maxReconnectAttempts: number
  reconnectBaseDelay: number
  autoStartServer: boolean
  serverStartTimeout: number
  vadMode: 'manual' | 'auto'
  maxSilenceDuration: number
  outputFolder: string
  debugMode: boolean
  logLevel: 'error' | 'warn' | 'info' | 'debug'
}
```

### B. 状态-显示映射表

| CompositeState                | label  | color   | icon           | statusBarText |
| ----------------------------- | ------ | ------- | -------------- | ------------- |
| disconnected + *              | 未连接    | #ff4444 | plug           | 点击连接          |
| connecting + *                | 连接中... | #4488ff | loader         | 连接中...        |
| connected + idle              | 就绪     | #888888 | circle         | 就绪            |
| connected + downloading_model | 下载模型   | #ff8800 | download       | 下载模型中...      |
| connected + model_loaded      | 模型就绪   | #44ff44 | check-circle   | 模型就绪          |
| connected + recognizing       | 识别中    | #44ff44 | mic            | 识别中...        |
| connected + no_audio          | 无音频    | #ff4444 | alert-triangle | 无音频输入         |
| connected + audio_detected    | 检测到音频  | #44ff44 | mic            | 检测到音频         |
| connected + error             | 错误     | #ff4444 | alert-circle   | 发生错误          |
