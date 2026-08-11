# vid2dataset Tauri 接口契约

> 文档日期：2026-08-12。字段级权威参考：`ExtractConfig`（Pydantic）、`PipelineResult`/`VideoStats`、`TagSummary`、`HardwareProfile`/`RuntimeStatus`、`ReleaseInfo`、`VideoMeta`。
> 命名空间统一：`<域>.<方法>` / `<域>.<事件>`，前端 ↔ Rust ↔ sidecar 三方同名。

---

## 1. NDJSON sidecar 协议

传输：sidecar 子进程 **stdin/stdout**，UTF-8，单行一个 JSON 对象（NDJSON）。

### 1.1 请求（Rust → Python）

```json
{"id": 1, "method": "presets.list", "params": {}}
{"id": 2, "method": "extract.run", "params": {"config": { ... ExtractConfig ... }}}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | u64 | 单调递增，用于关联响应 |
| `method` | string | `<域>.<方法>`，见 §2 |
| `params` | object | 方法参数（可空 `{}`） |

### 1.2 响应（Python → Rust）

成功：
```json
{"id": 1, "ok": true, "result": { ... }}
```
失败：
```json
{"id": 1, "ok": false, "error": {"code": "VALIDATION", "message": "..."}}
```

| `error.code` | 含义 |
|---|---|
| `VALIDATION` | 参数校验失败（Pydantic ValidationError） |
| `NOT_FOUND` | 路径/预设/模型不存在 |
| `UNSUPPORTED` | 当前平台不支持（如 GPU） |
| `RUNTIME` | 运行时错误（异常消息在 `message`） |
| `NotImplemented` | 脚手架阶段未接通 |

### 1.3 事件（Python → Rust，无 id）

```json
{"event": "extract.progress", "data": {"stage": "video", "current": 3, "total": 34}}
{"event": "extract.log", "data": {"line": "[12:01:04] Config resolved."}}
{"event": "download.progress", "data": {"pkg": "torch", "current": 42, "total": 100}}
```

stdout 只写协议帧；Python 日志输出到 **stderr**（Rust 单独线程读取，便于调试）。

---

## 2. Bridge 方法注册表

| method | params | result | 状态 |
|---|---|---|---|
| `config.defaults` | `{}` | `ExtractConfig` JSON schema `properties` | ✅ 真接通 |
| `config.validate` | `{"config": {...}}` | `{"valid": bool, "errors": [{field, message}]}` | ✅ 真接通 |
| `presets.list` | `{}` | `[{"name": str, "description": str}]` | ✅ 真接通 |
| `presets.load` | `{"name": str}` | `{...preset overrides...}`（`Partial<ExtractConfig>`，`description` 已剥离） | ✅ 真接通 |
| `source.discover` | `{"path": str}` | `[video path string]` | ✅ 真接通 |
| `source.probe` | `{"path": str}` | `VideoMeta` | ✅ 真接通 |
| `extract.run` | `{"config": {...}}` | `{"started": true}`（事件流 `extract.progress/log/done/error`） | ✅ 真接通 |
| `extract.cancel` | `{}` | `{"cancelled": bool}` | ✅ 真接通 |
| `tagger.status` | `{"model": str}` | `{"available": bool, "size_mb": int}` | ✅ 真接通 |
| `tagger.download` | `{"model": str}` | `{"started": true}`（事件流 `download.progress` → `download.done`） | ✅ 真接通 |
| `tagger.run` | `{folder, model_name?, trigger_word?, blacklist?, require?, exclude?, always?, trait_prune_threshold?, general_threshold?, character_threshold?, use_gpu?}` | `{"started": true}`（事件流 `extract.progress`(`tag:tagging`) → `tagger.done`） | ✅ 真接通 |
| `gpu.detect` | `{}` | `HardwareProfile` | ✅ 真接通 |
| `gpu.status` | `{}` | `RuntimeStatus` | ✅ 真接通 |
| `gpu.download` | `{}` | `{"started": true}`（事件流 `download.progress` → `download.done`） | ✅ 真接通 |
| `update.check` | `{}` | `{"available": bool, tag?, version?, name?, notes?, exe_url?, exe_size?}` | ✅ 真接通 |
| `update.install` | `{}` | `{"installed": bool, reason?}`（`not-exe`/`up-to-date`/`no-release`） | ✅ 真接通 |
| `advanced.open` | `{"path": str}` | `VideoMeta` | ✅ 真接通 |
| `advanced.seek` | `{"path": str, "frame": int}` | `{"frame_b64": str}`（JPEG base64） | ✅ 真接通 |
| `advanced.capture` | `{"path": str, "frame": int, "config": {...}}` | `{"out_path": str}` | ✅ 真接通 |
| `advanced.segments` | `{"segments": {...}}` | `{"saved": true}`（随下次 extract.run 的 config 应用） | ✅ 真接通 |

---

## 3. Tauri commands（前端 invoke → Rust）

> 命名空间：`camelCase`。参数用 kebab→camel 映射（`load_preset` → `{ name }`）。

| command | 参数 | 返回 | 转发 |
|---|---|---|---|
| `get_version` | – | `string` | 本地（`__version__` 经 bridge `config.defaults` 派生或固定 `1.2.0`） |
| `get_lang` | – | `"en" \| "zh"` | prefs |
| `set_lang` | `{ lang }` | `null` | prefs |
| `get_prefs` | – | `Prefs` | 本地文件 |
| `set_prefs` | `{ prefs }` | `null` | 本地文件 |
| `browse_folder` | – | `string \| null` | tauri dialog 插件 |
| `list_presets` | – | `PresetInfo[]` | bridge `presets.list` |
| `load_preset` | `{ name }` | `Partial<ExtractConfig>` | bridge `presets.load` |
| `discover_videos` | `{ path }` | `string[]` | bridge `source.discover` |
| `probe_video` | `{ path }` | `VideoMeta` | bridge `source.probe` |
| `start_run` | `{ config }` | `null`（异步，事件推进） | bridge `extract.run` |
| `cancel_run` | – | `null` | bridge `extract.cancel` |
| `tagger_status` | `{ model }` | `TaggerStatus` | bridge `tagger.status` |
| `tagger_download` | `{ model }` | `null` | bridge `tagger.download` |
| `gpu_detect` | – | `HardwareProfile` | bridge `gpu.detect` |
| `gpu_status` | – | `RuntimeStatus` | bridge `gpu.status` |
| `gpu_download` | – | `{ started: bool }` | bridge `gpu.download` |
| `check_update` | – | `UpdateInfo` | bridge `update.check` |
| `install_update` | – | `{ installed, reason? }` | bridge `update.install` |
| `adv_open` | `{ path }` | `VideoMeta` | bridge `advanced.open` |
| `adv_seek` | `{ path, frame }` | `{ frame_b64 }`（JPEG base64） | bridge `advanced.seek` |
| `adv_capture` | `{ path, frame, config }` | `{ out_path }` | bridge `advanced.capture` |
| `adv_segments` | `{ segments }` | `{ saved }` | bridge `advanced.segments` |
| `open_folder` | `{ path }` | `null` | opener 插件/OS |

### 前端数据模型（`ui/src/api/types.ts`，由 Pydantic 生成）

```ts
interface PresetInfo { name: string; description: string; }
interface Prefs { lang: "en" | "zh"; input?: string; output?: string; preset?: string; }
interface VideoMeta { path: string; fps: number; frame_count: number; width: number; height: number; duration_s: number; }
interface TaggerStatus { available: boolean; size_mb: number; }
interface ReleaseInfo { tag: string; version: string; name: string; notes: string; exe_url: string | null; exe_size: number; }
interface HardwareProfile { vendor: string; gpu_name: string; arch: string; compute_cap: number; os_name: string; os_arch: string; }
interface RuntimeStatus { available: boolean; cached: boolean; version: string | null; cache_dir: string; size_mb: number; cuda_tag: string | null; }
```

---

## 4. Tauri events（前端 listen）

| 事件名 | payload | 说明 |
|---|---|---|
| `extract.progress` | `{ stage, current, total }` | `stage`: `video` / `decode` / `tag:tagging` / `tag:<pkg>` 下载 |
| `extract.log` | `{ line }` | 控制台一行（来自 Python logging） |
| `extract.done` | `{ result: PipelineResult }` | 提取完成（`PipelineResult.to_summary_dict()`） |
| `extract.error` | `{ message }` | 提取失败 |
| `download.progress` | `{ pkg, current, total }` | GPU/tagger 模型下载（bytes） |
| `download.done` | `{ kind, error? }` | `kind`: `gpu` / `tagger`；失败时带 `error` 字符串 |
| `tagger.done` | `{ tagged, failed, total, cancelled, rejected, pruned_tags, tag_counts, per_image }` 或 `{ error }` | `tagger.run` 完成（TagSummary） |

事件名 = bridge 事件名直接透传（Rust 层不加前缀改写，保持一致）。

---

## 5. PipelineResult（bridge `extract.run` 返回）

```json
{
  "total_written": 321,
  "total_candidates": 502,
  "elapsed_s": 74.2,
  "contact_sheet": "/out/_contact_sheet.png",
  "html_gallery": "/out/_gallery.html",
  "tagging": null,
  "videos": [
    {
      "video": "dance_01.mp4", "duration_s": 192.0, "fps": 60.0,
      "width": 1280, "height": 720, "scenes": 18, "candidates": 64,
      "written": 42, "rejected_blur": 12, "rejected_luma": 0,
      "rejected_too_small": 0, "rejected_dup": 7, "rejected_ssim": 3,
      "rejected_color": 0, "rejected_completeness": 0,
      "auto_blur_threshold": 46.0, "elapsed_s": 4.2,
      "watermarks": [], "records": []
    }
  ]
}
```

（字段与 `extractor.PipelineResult.to_summary_dict()` 对齐；`records` 大数组在 Tauri 阶段默认截断，前端用 `_gallery.html` 查看明细。）

---

## 6. TagSummary（bridge `tagger.run` 返回）

```json
{ "tagged": 200, "failed": 2, "total": 202, "cancelled": false,
  "rejected": [], "pruned_tags": ["1girl"], "tag_counts": {"solo": 180} }
```
