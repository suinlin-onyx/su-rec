# FunASR Transcription Plugin - 开发文档

## 项目结构

```
su-rec/
├── src/                    # TypeScript 源码
│   ├── main.ts            # 插件入口
│   ├── core/             # 核心模块
│   │   ├── ConnectionManager.ts
│   │   ├── MessageBridge.ts
│   │   ├── StateController.ts
│   │   ├── ServiceMonitor.ts
│   │   └── ResourceManager.ts
│   ├── ui/               # UI 组件
│   │   └── SettingsTab.ts
│   ├── types/            # 类型定义
│   │   └── index.ts
│   └── utils/            # 工具函数
│       └── uuid.ts
├── dist/                  # TypeScript 编译输出（构建中间产物）
├── build.js               # esbuild 打包脚本
├── manifest.json          # Obsidian 插件配置
└── package.json           # npm 依赖配置
```

## 编译与部署

### 构建命令

```bash
# 安装依赖（首次或新增依赖时）
pnpm install

# 构建并部署到 Obsidian
node build.js
```

### 部署流程

`build.js` 会：
1. 使用 esbuild 将 `src/main.ts` 及其所有依赖打包成单个文件
2. 输出到 Obsidian 插件目录：`D:\arvin\obsidian_workpace\arvin-notes\.obsidian\plugins\su-rec\main.js`
3. 复制 `manifest.json`

### 构建产物

部署后 Obsidian 插件目录结构：
```
su-rec/
├── main.js         # 打包后的插件代码（27KB）
├── main.js.map     # SourceMap（调试用）
└── manifest.json   # 插件配置
```

### 开发工作流

```bash
# 1. 编辑 src/ 下的 .ts 源码

# 2. 编译并部署
node build.js

# 3. 在 Obsidian 中：Settings → Community plugins
#    禁用再启用 su-rec（或重启 Obsidian）
```

## 插件生命周期

```typescript
// src/main.ts
export default class SuRecPlugin extends Plugin {
  async onload() {
    // 插件加载时调用（新 Vault 实例 = 每次打开 Vault）
    console.log('[SuRec] Plugin loaded');
  }

  async onunload() {
    // 插件卸载时调用（关闭 Vault / 禁用插件）
    console.log('[SuRec] Plugin unloaded');
  }
}
```

### 检测新实例的场景

| 场景 | 如何感知 |
|------|---------|
| 首次加载插件 | `onload()` 被调用 |
| 重启 Obsidian | 全新 `onload()` |
| 切换 Vault | 先 `onunload()`，再 `onload()` |
| 禁用再启用 | 先 `onunload()`，再 `onload()` |

---

## 状态机架构 v2

```
                    点击
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
    ┌─────────┐ ┌──────────┐ ┌──────────┐
    │ offline │ │started   │ │recording  │
    └────┬────┘ └────┬─────┘ └─────┬────┘
         │           │              │
         │           │              │ 点击
         │           │              ▼
         │           │         ┌─────────┐
         │           │         │ started │ (暂停，保持连接)
         │           │         └─────────┘
         │           │
         │           │
         └───────────┼───────────┘
                     │ 连接成功
                     ▼
              ┌──────────┐
              │connecting│
              └────┬─────┘
                   │
            ┌───────┴───────┐
            │               │
       连接成功          连接失败
            │               │
            │          启动服务
            │          20秒后重试
            │               │
            └───────┬───────┘
                    │
                    ▼
              ┌──────────┐
              │recording │ (自动开始)
              └──────────┘
```

## 4 个状态

| 状态 | 颜色 | 含义 |
|-----|------|------|
| `offline` | 🔴 红 | 未连接 |
| `started` | 🟠 橙 | 已连接，等待录音 |
| `connecting` | 🔵 蓝 | 连接中 |
| `recording` | 🟢 绿 | 转录中 |

## 点击行为

| 当前状态 | 点击 | 结果 |
|---------|------|------|
| `offline` | ✓ | 尝试连接 → 失败则启动服务 → 再连接 → 自动开始录音 |
| `started` | ✓ | 尝试连接 → 开始录音 |
| `connecting` | ✓ | 标记意图 → 连接成功后自动开始录音 |
| `recording` | ✓ | 暂停 → `started`（保持连接）|

## 连接流程

1. 点击 → `_tryConnect()`
2. TCP 连接成功 → `recording`（如果 `_pendingStart = true`）
3. TCP 连接失败 → `_startServer()` → 20秒后重试 `_tryConnect()`

## 待处理意图

`_pendingStart` 标志用于：
- 用户在连接中时点击，连接成功后自动开始录音
- 服务启动期间用户可能多次点击

## TCP 协议

- **地址**: 127.0.0.1:9876
- **命令**: `start\n`, `stop\n`, `quit\n`

## 文件输出

```
00.raw/01.投资研究/音频转录/转录_[YYYY-MM-DD].md
```

---

## 故障排除

### 插件加载失败

1. 检查 Obsidian 控制台错误：`Ctrl+Shift+I` → Console
2. 确认 `manifest.json` 存在且格式正确
3. 确认 `main.js` 存在于插件目录
4. 尝试禁用再启用插件，或重启 Obsidian

### 模块加载错误

如果遇到 `Cannot find module` 错误：
1. 确保使用 `node build.js` 构建
2. 检查 `main.js` 是否是单个打包文件（不是分散的模块）
