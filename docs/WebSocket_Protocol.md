# FunASR Server WebSocket Protocol

> 相关文档：[服务端交互协议](./服务端交互协议.md) — su-rec 与 voice-transcribe 集成约定

## 概述

本文档定义 FunASR 服务端与客户端之间的 WebSocket 通信协议。

**传输层**: WebSocket (TCP)
**默认端口**: 9876
**消息格式**: JSON

---

## 1. 消息结构

### 1.1 基础消息格式

所有消息都遵循以下基础结构：

```json
{
  "id": "uuid-v4",
  "type": "message_type",
  "timestamp": 1234567890000
}
```

### 1.2 客户端 → 服务端

```json
{
  "id": "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
  "type": "state_update | state_response | heartbeat",
  "action": "start_recording | stop_recording | query_state | heartbeat",
  "payload": { ... },
  "timestamp": 1234567890000
}
```

### 1.3 服务端 → 客户端

```json
{
  "id": "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
  "type": "state_update | state_response | transcription | error | heartbeat",
  "status": "idle | connected | downloading_model | model_loaded | recognizing | no_audio | audio_detected | error",
  "payload": { ... },
  "timestamp": 1234567890000
}
```

---

## 2. 消息类型

### 2.1 客户端动作 (ClientAction)

| action            | 说明     | payload                                  |
| ----------------- | ------ | ---------------------------------------- |
| `start_recording` | 开始录音识别 | 可选: `{ "vad_mode": "auto" \| "manual" }` |
| `stop_recording`  | 停止录音识别 | 无                                        |
| `query_state`     | 查询当前状态 | 无                                        |
| `heartbeat`       | 心跳保活   | 无                                        |

### 2.2 服务端状态 (ServerStatus)

| status              | 说明     | 触发条件         |
| ------------------- | ------ | ------------ |
| `idle`              | 空闲     | 服务启动后、识别完成后  |
| `connected`         | 已连接    | 客户端连接成功      |
| `downloading_model` | 下载模型中  | 模型文件不存在，需要下载 |
| `model_loaded`      | 模型加载完成 | 模型加载成功       |
| `recognizing`       | 正在识别   | 检测到音频并正在识别   |
| `no_audio`          | 无音频输入  | 音频设备无输入或音量过低 |
| `audio_detected`    | 检测到音频  | 音频设备有输入      |
| `error`             | 错误状态   | 发生错误         |

### 2.3 消息类型 (MessageType)

| type             | 方向        | 说明               |
| ---------------- | --------- | ---------------- |
| `state_update`   | 双向        | 状态更新（服务端主动推送或响应） |
| `state_response` | 双向        | 状态查询响应           |
| `transcription`  | 服务端 → 客户端 | 识别结果             |
| `error`          | 服务端 → 客户端 | 错误信息             |
| `heartbeat`      | 双向        | 心跳               |

---

## 3. 服务端状态机

```
                                    ┌─────────────┐
                                    │    idle    │
                                    └──────┬──────┘
                                           │
                                           │ client: start_recording
                                           ▼
                              ┌────────────────────────┐
                              │    downloading_model   │ (if model not exists)
                              └───────────┬────────────┘
                                          │ model downloaded
                                          ▼
                              ┌────────────────────────┐
              ┌───────────────│     model_loaded       │───────────────┐
              │               └──────────┬────────────┘               │
              │                          │ model ready                  │
              │                          ▼                              │
              │               ┌────────────────────────┐                │
              │               │    audio_detected     │                │
              │               └──────────┬────────────┘                │
              │                          │ audio level OK               │
              │                          ▼                              │
              │               ┌────────────────────────┐                │
              │               │     recognizing       │                │
              │               └──────────┬────────────┘                │
              │                          │ silence timeout              │
              │                          ▼                              │
              │               ┌────────────────────────┐                │
              └──────────────►│      no_audio         │◄───────────────┘
                              └────────────────────────┘
                                           │ audio detected
                                           ▼
                              ┌────────────────────────┐
                              │   error (optional)    │
                              └────────────────────────┘
```

---

## 4. 通信流程

### 4.1 连接建立

```
客户端                              服务端
  │                                   │
  │  ──── WebSocket 握手 ──────────►  │
  │                                   │
  │  ◄───── onopen ─────────────────  │
  │                                   │
  │       state_update {             │
  │         status: "connected"      │
  │       }                          │
  │  ◄───────────────────────────────│
  │                                   │
```

### 4.2 开始识别

```
客户端                              服务端
  │                                   │
  │  state_update {                  │
  │    action: "start_recording"     │
  │  }                               │
  │  ───────────────────────────────►│
  │                                   │
  │  (服务端检查模型状态)              │
  │                                   │
  │       state_update {             │
  │         status: "model_loaded"   │
  │       }                          │
  │  ◄───────────────────────────────│
  │                                   │
  │       state_update {             │
  │         status: "audio_detected" │
  │       }                          │
  │  ◄───────────────────────────────│
  │                                   │
  │       transcription {            │
  │         text: "识别文字",        │
  │         isFinal: true            │
  │       }                          │
  │  ◄───────────────────────────────│
  │                                   │
```

### 4.3 心跳机制

```
客户端                              服务端
  │                                   │
  │       heartbeat {                 │
  │         type: "heartbeat",        │
  │         timestamp: 1234567890     │
  │       }                           │
  │  ───────────────────────────────►│
  │                                   │
  │       (可选: 响应 heartbeat)      │
  │  ◄───────────────────────────────│
  │                                   │
```

**心跳间隔**: 客户端每 30 秒发送一次

### 4.4 错误处理

```
客户端                              服务端
  │                                   │
  │  (服务端发生错误)                  │
  │                                   │
  │       error {                     │
  │         status: "error",         │
  │         payload: {                │
  │           errorMessage: "描述"    │
  │         }                         │
  │       }                           │
  │  ◄───────────────────────────────│
  │                                   │
```

---

## 5. Payload 格式

### 5.1 transcription payload

```json
{
  "text": "识别到的文字内容",
  "isFinal": true,
  "timestamp": 1234567890000
}
```

### 5.2 error payload

```json
{
  "errorMessage": "错误描述信息",
  "errorCode": "ERROR_CODE",
  "timestamp": 1234567890000
}
```

### 5.3 state_update payload (downloading_model)

```json
{
  "modelName": "paraformer-zh",
  "downloadProgress": 0.45,
  "timestamp": 1234567890000
}
```

---

## 6. 示例消息

### 6.1 客户端发送开始识别

```json
{
  "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "type": "state_update",
  "action": "start_recording",
  "payload": {
    "vad_mode": "auto"
  },
  "timestamp": 1234567890000
}
```

### 6.2 服务端推送识别结果

```json
{
  "id": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  "type": "transcription",
  "status": "recognizing",
  "payload": {
    "text": "这是识别到的文字",
    "isFinal": true
  },
  "timestamp": 1234567890000
}
```

### 6.3 服务端推送状态更新

```json
{
  "id": "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f",
  "type": "state_update",
  "status": "no_audio",
  "payload": {},
  "timestamp": 1234567890000
}
```

### 6.4 客户端心跳

```json
{
  "id": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "type": "heartbeat",
  "action": "heartbeat",
  "timestamp": 1234567890000
}
```

---

## 7. 错误码

| errorCode               | 说明      |
| ----------------------- | ------- |
| `MODEL_NOT_FOUND`       | 模型文件未找到 |
| `MODEL_DOWNLOAD_FAILED` | 模型下载失败  |
| `AUDIO_DEVICE_ERROR`    | 音频设备错误  |
| `RECOGNITION_FAILED`    | 识别失败    |
| `CONNECTION_LOST`       | 连接断开    |
| `UNKNOWN`               | 未知错误    |

---

## 8. 实现注意事项

### 8.1 WebSocket 服务器实现 (Python)

```python
# 使用 websockets 库
import asyncio
import websockets
import json

async def handler(websocket, path):
    # 发送 connected 状态
    await websocket.send(json.dumps({
        "id": "init",
        "type": "state_update",
        "status": "connected",
        "timestamp": int(time.time() * 1000)
    }))

    async for message in websocket:
        data = json.loads(message)
        # 处理消息...

# 启动服务器
async def main():
    async with websockets.serve(handler, "0.0.0.0", 9876):
        await asyncio.Future()  # 运行直到取消

asyncio.run(main())
```

### 8.2 端口选择

- 默认端口: `9876`
- 可通过配置修改

### 8.3 心跳超时

- 如果 60 秒内未收到心跳，服务端可主动断开连接
- 客户端应处理连接意外断开的情况
