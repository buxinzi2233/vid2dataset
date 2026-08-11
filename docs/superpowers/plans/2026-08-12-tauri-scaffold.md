# vid2dataset Tauri 重构脚手架 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 在保留现有 Python 引擎的前提下，产出 Tauri 桌面应用三层架构（原生 TS 前端 → Rust 命令层 → NDJSON sidecar Python 引擎）的架构文档、接口契约文档与精简工程脚手架。

**架构：** 前端 `ui/`（原生 TS + Vite + ES modules，无框架）经 `@tauri-apps/api` 调 Rust `src-tauri/` 命令；Rust 用 BridgeManager 经 stdin/stdout 与 Python sidecar（`bridge/main.py`，复用 vid2dataset 包）NDJSON 通信。命令按领域合并为 4 模块，sidecar 用注册表分发，类型由 Pydantic schema 单源生成。

**技术栈：** Tauri 2.x、Rust 1.97、TypeScript 5、Vite、Node 24/pnpm、Python 3.12 + Pydantic v2（现有）。

**硬性指标：** 模块化设计、清晰三层架构、代码结构优化（无冗余/无碎片模块/无重复类型）。

**执行决策（已确认）：** 不建 worktree、直接在 main 上新增目录；现有未提交改动（app.py/advanced.py/i18n.py/tooltip.py/rhine_theme.py）保持原样不碰。

---

## 文件结构

```
src-tauri/
├─ Cargo.toml · tauri.conf.json · capabilities/default.json
└─ src/
   ├─ main.rs · lib.rs                    # 入口，Builder 装配
   ├─ state.rs                            # AppState(bridge 句柄, cancel 句柄)
   ├─ bridge/{mod,protocol,process}.rs    # NDJSON 编解码 + 进程管理 + BridgeManager
   └─ commands/{mod,config,extract,runtime,system}.rs
ui/
├─ package.json · vite.config.ts · tsconfig.json · index.html
└─ src/
   ├─ main.ts · app.ts                    # 外壳（移植原型布局）
   ├─ api/{ipc,events,types}.ts           # invoke/listen 包装 + schema 类型
   ├─ i18n/{index,en,zh}.ts               # 从原型抽取
   ├─ theme/{tokens,theme}.ts             # 设计 token + 黑/浅头部
   ├─ state/{store,runState}.ts           # prefs 并入 store
   ├─ components/{Panel,Button,Switch,Field,Modal,Toast,Console,Inspector}.ts
   └─ views/{Source,Params,Caption,Roster,Execute}View.ts
bridge/main.py                           # NDJSON 循环 + 注册表
scripts/gen_types.py                     # Pydantic schema → TS 类型生成器
docs/{architecture,api-contract}.md
```

---

### 任务 1：环境准备

**文件：** 无（命令）

- [ ] 安装 cargo-tauri：`cargo install tauri-cli --locked`
- [ ] 初始化 `ui/`：`pnpm create vite . --template vanilla-ts`（在 ui/ 内），安装 `@tauri-apps/api`、`@tauri-apps/cli`
- [ ] 验证：`cargo tauri --version` 输出版本；`pnpm tsc --noEmit` 无错误
- [ ] Commit：`feat(tauri): scaffold toolchain init (task 1)`

### 任务 2：架构文档

**文件：** 创建 `docs/architecture.md`

- [ ] 撰写：三层分层图（ASCII）、模块职责表、数据流（前端→Rust→sidecar→引擎）、NDJSON 协议、错误处理、运行/取消线程模型
- [ ] 验证：文档包含上述全部章节，路径引用与文件结构一致
- [ ] Commit：`docs(tauri): architecture document (task 2)`

### 任务 3：接口契约文档

**文件：** 创建 `docs/api-contract.md`

- [ ] 撰写：全部 bridge 方法（`config.*/presets.*/source.*/extract.*/tagger.*/gpu.*/update.*/advanced.*`）、Tauri commands（`get_version/get_lang/set_lang/get_prefs/set_prefs/browse_folder/list_presets/load_preset/discover_videos/probe_video/start_run/cancel_run/tagger_*/gpu_*/check_update/install_update/adv_*/open_folder`）、events（`extract.progress/log/done/error`、`download.progress/done`）、数据模型（ExtractConfig/VideoMeta/PipelineResult/TagSummary/HardwareProfile/RuntimeStatus/ReleaseInfo）
- [ ] 验证：文档方法与任务 4-6 的实现签名一一对应
- [ ] Commit：`docs(tauri): api contract (task 3)`

### 任务 4：bridge sidecar（真实逻辑 + 冒烟测试）

**文件：**
- 创建：`bridge/main.py`
- 测试：`tests/bridge_smoke.py`

- [ ] 编写 `bridge/main.py`：NDJSON 读 stdin/写 stdout；`METHODS` 注册表；请求/响应/事件编解码；worker 线程跑 `run_pipeline`；cancel 经 stdin 置事件。真接通 `presets.list`、`config.defaults`（用 `ExtractConfig.model_json_schema()`），重命令 stub 返回 `{"error":{"code":"NotImplemented"}}`
- [ ] 编写 `tests/bridge_smoke.py`：模拟 stdin 输入 `{"id":1,"method":"presets.list","params":{}}`，断言 stdout 为合法响应且含 `anima-style`
- [ ] 运行验证：`venv/bin/python -m pytest tests/bridge_smoke.py -v` 通过
- [ ] Commit：`feat(tauri): ndjson sidecar with method registry (task 4)`

### 任务 5：src-tauri 骨架 + BridgeManager

**文件：** `Cargo.toml`、`tauri.conf.json`、`capabilities/default.json`、`src/main.rs`、`src/lib.rs`、`src/state.rs`、`src/bridge/{mod,protocol,process}.rs`

- [ ] 编写 `bridge/protocol.rs`：`Request`/`Response`/`Event` serde 类型
- [ ] 编写 `bridge/process.rs` + `bridge/mod.rs`：spawn sidecar（`venv/bin/python bridge/main.py`）、行读取、id→oneshot 关联、事件转发回调
- [ ] 编写 `state.rs`：`AppState` 持 bridge 句柄
- [ ] 编写 `main.rs`/`lib.rs`：Builder + manage state + 装配命令（命令 stub 注册）
- [ ] 验证：`cargo check` 无错误
- [ ] Commit：`feat(tauri): rust shell + bridge manager (task 5)`

### 任务 6：commands 四模块（类型化签名 + stub）

**文件：** `commands/{mod,config,extract,runtime,system}.rs`

- [ ] `config.rs`：`get_version/get_lang/set_lang/get_prefs/set_prefs/list_presets/load_preset/browse_folder` 签名 + stub
- [ ] `extract.rs`：`discover_videos/probe_video/start_run/cancel_run/adv_open/adv_seek/adv_capture` 签名 + stub
- [ ] `runtime.rs`：`tagger_status/tagger_download/gpu_detect/gpu_status/gpu_download` 签名 + stub
- [ ] `system.rs`：`check_update/install_update/open_folder` 签名 + stub
- [ ] 验证：`cargo check` 无错误
- [ ] Commit：`feat(tauri): typed command modules (task 6)`

### 任务 7：ui 构建配置 + 外壳

**文件：** `package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`、`src/main.ts`、`src/app.ts`、`src/theme/{tokens,theme}.ts`

- [ ] 配置 Vite/TS（strict、moduleResolution bundler）
- [ ] `tokens.ts` 从 `layout-b-v2.html` 抽取色板/字体/间距变量；`theme.ts` 黑/浅头部切换
- [ ] `app.ts` 外壳：左轨导航 + 主视口 + 右解析栏 + 顶栏骨架（DOM 结构，事件留空）
- [ ] 验证：`pnpm tsc --noEmit` + `pnpm build` 通过
- [ ] Commit：`feat(tauri): ui shell + theme tokens (task 7)`

### 任务 8：api 层 + 类型生成脚本

**文件：** `scripts/gen_types.py`、`ui/src/api/{ipc,events,types}.ts`

- [ ] **步骤 1：编写类型生成脚本** `scripts/gen_types.py`：读 `ExtractConfig.model_json_schema()["properties"]`，映射到 TS 类型，输出 `ui/src/api/types.ts` interface
- [ ] **步骤 2：运行脚本确认生成**：`venv/bin/python scripts/gen_types.py`，预期生成含 `resolution: number;` 等 60+ 字段
- [ ] **步骤 3：编写 ipc.ts**：`getVersion/listPresets/loadPreset/discoverVideos/startRun/cancelRun` 类型化 invoke
- [ ] **步骤 4：编写 events.ts**：`onExtractProgress/onExtractLog` 类型化监听
- [ ] **步骤 5：验证**：`venv/bin/python scripts/gen_types.py` 后 `pnpm tsc --noEmit` 无类型错误
- [ ] **步骤 6：Commit**：`feat(tauri): api layer + schema codegen (task 8)`

### 任务 9：i18n + state

**文件：** `ui/src/i18n/{index,en,zh}.ts`、`ui/src/state/{store,runState}.ts`

> 结构优化：prefs 并入 store.ts，删除独立 prefs.ts。

- [ ] **步骤 1：抽取字典**：从原型 `I18N.en/zh` 拷贝到 `en.ts`/`zh.ts`
- [ ] **步骤 2：编写 index.ts**：`setLang/getLang/t` 替换 `{var}` 模板
- [ ] **步骤 3：编写 runState.ts**：`RunStatus` 状态机（idle/running/cancelling/done/error）
- [ ] **步骤 4：编写 store.ts**：配置态 + prefs（调 `listPresets/loadPreset`）
- [ ] **步骤 5：验证**：`pnpm tsc --noEmit` 通过
- [ ] **步骤 6：Commit**：`feat(tauri): i18n + state stores (task 9)`

### 任务 10：components/views 骨架

**文件：** `ui/src/components/{Panel,Button,Switch,Field,Modal,Toast,Console,Inspector}.ts`、`ui/src/views/{Source,Params,Caption,Roster,Execute}View.ts`

- [ ] **步骤 1：Panel 组件**：`renderPanel(props): HTMLElement`，phead + pbody
- [ ] **步骤 2：Button/Switch/Field/Modal/Toast/Console** 六个组件，同样模式
- [ ] **步骤 3：Inspector 组件**：右解析栏骨架
- [ ] **步骤 4：五个视图各一个文件**：组合组件，逻辑留空
- [ ] **步骤 5：验证**：`pnpm tsc --noEmit` + `pnpm build` 通过
- [ ] **步骤 6：Commit**：`feat(tauri): component & view skeletons (task 10)`

### 任务 11：整体验证 + 收尾

**文件：** 修改 `.gitignore`

- [ ] 把 `.superpowers/` 加入 `.gitignore`
- [ ] 全量验证：`cargo check` ✓、`pnpm build` ✓、`venv/bin/python -m pytest tests/bridge_smoke.py -v` ✓、`venv/bin/python scripts/gen_types.py` ✓
- [ ] Commit：`chore(tauri): gitignore research artifacts (task 11)`
