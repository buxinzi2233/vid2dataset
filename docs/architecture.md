# vid2dataset Tauri 架构

> 文档日期：2026-08-12。对应 `docs/superpowers/plans/2026-08-12-tauri-scaffold.md`。
> 本文描述三层架构、模块职责、数据流与运行模型。接口字段级契约见 `docs/api-contract.md`。

## 1. 分层总览

```
┌─────────────────────────── 前端 UI（ui/，原生 TS + Vite）──────────────────────────┐
│  views/（Source/Params/Caption/Roster/Execute）· components/ · inspector · i18n   │
│  state/store.ts（配置 + 视图态）· state/runState.ts（运行状态机）                    │
│  api/ipc.ts（类型化 invoke）· api/events.ts（类型化事件监听）                       │
└──────────────┬──────────────────────────────────────────────────────────────────┘
               │ @tauri-apps/api invoke / listen
┌──────────────▼─────────────────────── Tauri Rust（src-tauri/）────────────────────┐
│  commands/ 四个业务域模块：config / extract / runtime / system                     │
│             —— 类型化签名，转发 bridge 或直接调用插件/本地逻辑                        │
│  bridge/   NDJSON 协议类型 + sidecar 进程管理 + BridgeManager（请求/响应/事件）       │
│  state.rs  AppState（bridge 句柄、运行中 cancel 句柄）                              │
└──────────────┬──────────────────────────────────────────────────────────────────┘
               │ NDJSON over stdin/stdout（sidecar 子进程）
┌──────────────▼──────────────── Python sidecar（bridge/main.py，复用 vid2dataset）──┐
│  NDJSON 循环 + METHOD 注册表 → 调 config/extractor/tagger/gpu_runtime/updater      │
│  run_pipeline 在 worker 线程执行，事件经 stdout 流式推送；stdin 接收 cancel          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 2. 模块职责

### 2.1 `ui/` — 前端（原生 TS，无框架）

| 路径 | 职责 |
|---|---|
| `src/main.ts` | 应用入口：初始化 store、挂载 app 外壳 |
| `src/app.ts` | 外壳组合：左轨导航 + 主视口 + 右解析栏 + 顶栏 |
| `src/api/ipc.ts` | 所有 Tauri command 的类型化封装（单一出口） |
| `src/api/events.ts` | 所有 Tauri 事件的类型化订阅 |
| `src/api/types.ts` | 由 `scripts/gen_types.py` 生成的 Pydantic 镜像类型 |
| `src/i18n/{en,zh,index}.ts` | 文案字典与 `t()` 切换 |
| `src/theme/{tokens,theme}.ts` | 设计 token（色板/字体/间距）+ 黑/浅头部切换 |
| `src/state/store.ts` | 配置态、presets、prefs 持久化 |
| `src/state/runState.ts` | 提取运行状态机（idle/running/cancelling/done/error） |
| `src/components/*.ts` | 原子 UI 组件（Panel/Button/Switch/Field/Modal/Toast/Console/Inspector） |
| `src/views/*View.ts` | 五个标签视图的组件组合 |

### 2.2 `src-tauri/` — Rust 壳

| 路径 | 职责 |
|---|---|
| `src/main.rs` / `lib.rs` | 入口，`Builder` 装配 state、命令、事件 |
| `src/state.rs` | `AppState`：bridge 句柄、运行中 cancel 句柄 |
| `src/bridge/protocol.rs` | `Request`/`Response`/`Event` serde 类型（NDJSON 帧） |
| `src/bridge/process.rs` | sidecar 进程 spawn、stdin/stdout 行读写 |
| `src/bridge/mod.rs` | `BridgeManager`：id→oneshot 关联、事件回调转发 |
| `src/commands/*.rs` | Tauri command 类型化签名；转发 bridge 或本地实现 |

### 2.3 `bridge/` — Python sidecar

| 路径 | 职责 |
|---|---|
| `bridge/main.py` | NDJSON 循环 + `METHODS` 注册表；worker 线程跑 `run_pipeline`；cancel 处理 |

复用现有 `src/vid2dataset/`（config/extractor/tagger/gpu_runtime/updater/io_utils/presets），sidecar 只是薄薄的胶水层。

## 3. 数据流

### 3.1 请求-响应（同步查询）

```
前端 invoke("list_presets")
  → Rust commands/config.rs
  → BridgeManager.request("presets.list", {})
  → stdout: {"id":1,"method":"presets.list","params":{}}
  → Python 注册表执行 → stdout: {"id":1,"ok":true,"result":[{...}]}
  → BridgeManager 用 id 关联到 pending oneshot → 返回 Result
  → Rust command 返回 → 前端 Promise resolve
```

### 3.2 事件流（长任务，如提取）

```
前端 invoke("start_run", config)
  → Rust → BridgeManager.request("extract.run", {...})    // 非阻塞，worker 执行
  → Python run_pipeline(progress=cb) 回调触发：
      stdout: {"event":"extract.progress","data":{"stage":"video","current":3,"total":34}}
      stdout: {"event":"extract.log","data":{"line":"..."}}
  → BridgeManager 收到无 id 行 → 按 event 名 emit 到前端
  → 前端 events.ts 订阅刷新进度条/控制台
  → 完成：{"id":n,"ok":true,"result":PipelineResult}
```

### 3.3 取消

```
前端 invoke("cancel_run") → BridgeManager.request("extract.cancel", {})
  → Python 置 cancel_event → run_pipeline 检查取消 → 收尾 → 返回 ok
```

## 4. NDJSON 协议

单行 JSON，逐行读写。详见 `docs/api-contract.md` §1。

- **请求**：`{"id":u64,"method":"<域.方法>","params":{...}}`
- **响应**：`{"id":u64,"ok":true,"result":{...}}` 或 `{"id":u64,"ok":false,"error":{"code":"...","message":"..."}}`
- **事件**（无 id）：`{"event":"<域.事件>","data":{...}}`

编码：UTF-8 + `\n`。stdout 只写协议帧（Python 日志走 stderr，Rust 侧单独读取）。

## 5. 错误处理

- **sidecar 层**：方法内异常 → `{"ok":false,"error":{"code":"<ExceptionType>","message":"..."}}`，不崩溃循环。
- **Rust 层**：bridge 不可用 → 返回 `Err("bridge unavailable")`；sidecar 非零退出 → 记录并标记 bridge 失效。
- **前端层**：`invoke` 拒绝 → toast 展示 `error.message`。
- 取消不是错误：`extract.run` 正常返回，前端以 `result.cancelled`（或事件）区分。

## 6. 运行 / 取消线程模型

- **Python**：主线程跑 NDJSON 读循环；`run_pipeline` 在 `threading.Thread(daemon=True)` worker 执行；`threading.Event` 作为 cancel_event。
- **Rust**：每请求一个 `async`（stdin 写入持锁序列化）；stdout 读线程分发到 pending map / 事件回调；Tauri event emit 线程安全。
- **前端**：单线程事件驱动，长任务状态由 runState 状态机推进，无轮询。

## 7. 配置与状态所有权

- **配置**：前端 `store.ts` 持有（用户在表单里编辑），`start_run` 时整体下发。Rust 不缓存业务配置。
- **prefs**：`~/.vid2dataset.json` 兼容路径，经 Rust `get/set_prefs` 读写（文件格式与旧版一致：`lang/input/output/preset/trigger_word/...`）。
- **运行句柄**：`AppState` 持有当前 run 的 cancel_event id，仅此而已。

## 8. 代码结构原则

- 命令按领域合并为 4 模块，杜绝逐方法碎片文件。
- 类型单源：Python `ExtractConfig` 为唯一真源，TS 由脚本生成。
- sidecar 用注册表分发，一个方法一行；请求/响应/事件编解码收敛在单一循环类。
- 不引入框架、状态管理库、宏生成器——原生 TS + Rust std + tauri API。
