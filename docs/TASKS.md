# FunASR Transcription Plugin - 任务

## 状态机 v2 实现

- [x] 4 个状态：offline / started / connecting / recording
- [x] 状态转换表
- [x] setState() 核心方法
- [x] 点击处理 onClick()
- [x] 连接流程 _tryConnect()
- [x] 服务启动 _startServer()
- [x] 录音控制 _startRecording() / _stopRecording()
- [x] _pendingStart 标志
- [x] 文档更新

## 待测试

- [ ] offline 点击 → 连接失败 → 自动启动服务 → 重连 → 开始录音
- [ ] started 点击 → 连接 → 开始录音
- [ ] connecting 点击 → 连接成功 → 自动开始录音
- [ ] recording 点击 → 暂停 → started（保持连接）
- [ ] 颜色变化正确

## 验收标准

1. 一次点击完成：启动服务 → 连接 → 录音
2. 暂停后保持连接，第二次点击继续录音
3. 4 种颜色对应 4 种状态
