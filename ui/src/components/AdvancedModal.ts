//! Advanced mode modal: video scrubber + segment marking + frame capture.
//! Backed by the bridge methods advanced.open/seek/capture/segments.

import { renderModal, showModal } from "./Modal";
import { renderButton } from "./Button";
import { advCapture, advOpen, advSeek, discoverVideos } from "../api/ipc";
import { el } from "./el";
import type { Store } from "../state/store";

export interface AdvancedModal {
  root: HTMLElement;
  open: () => void;
}

export function renderAdvancedModal(store: Store): AdvancedModal {
  // ── State ────────────────────────────────────────────────────
  const videos: string[] = [];
  let current: string | null = null;
  let frameCount = 1;
  let fps = 30;
  let frameIdx = 0;
  let pendingIn: number | null = null;
  let seeking = false;

  // ── DOM ──────────────────────────────────────────────────────
  const videoSelect = el("select", "menu");
  const preview = el("div", "adv-preview");
  preview.append(el("div", "scanlines"));
  const frameLabel = el("span", "adv-frame-label", "—");
  preview.append(frameLabel);

  const timeInfo = el("div", "adv-time", "0.00s / 0.00s");
  const slider = el("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1000";
  slider.value = "0";
  slider.addEventListener("input", () => onSlider(Number(slider.value)));

  const steps = el("div", "adv-steps");
  for (const label of ["-10s", "-1s", "-1f", "+1f", "+1s", "+10s"]) {
    steps.append(
      renderButton({
        label,
        variant: "ghost",
        onClick: () => step(label),
      }),
    );
  }

  const pendingInfo = el("span", "adv-pending", "");
  const segRow = el("div", "adv-segrow");
  segRow.append(
    renderButton({ label: "SET IN", variant: "ghost", onClick: setIn }),
    renderButton({ label: "SET OUT", variant: "ghost", onClick: setOut }),
    pendingInfo,
    renderButton({ label: "CAPTURE", variant: "orange", onClick: capture }),
  );

  const segList = el("div", "adv-list");
  const status = el("div", "validate-status");
  const doneBtn = renderButton({
    label: "DONE",
    variant: "ghost",
    onClick: () => showModal(modal, false),
  });

  const modal = renderModal({
    title: "ADVANCED — SEGMENTS & CAPTURE",
    tag: "RL-SCRUB",
    width: 680,
    body: [videoSelect, preview, timeInfo, slider, steps, segRow, segList, status, doneBtn],
  });

  // ── Video list ───────────────────────────────────────────────
  async function loadVideos(): Promise<void> {
    const path = store.inputPath;
    if (!path) {
      status.textContent = "No input folder set";
      return;
    }
    try {
      const files = await discoverVideos(path);
      videos.length = 0;
      videos.push(...files);
      videoSelect.innerHTML = "";
      for (const f of files) {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f.split(/[\\/]/).pop() ?? f;
        videoSelect.append(opt);
      }
      if (videos.length > 0) {
        videoSelect.value = videos[0];
        await openCurrent();
      }
    } catch (e) {
      status.textContent = `Error: ${String(e)}`;
    }
  }
  videoSelect.addEventListener("change", () => void openCurrent());

  async function openCurrent(): Promise<void> {
    const path = videoSelect.value;
    if (!path) return;
    current = path;
    try {
      const meta = await advOpen(path);
      frameCount = Math.max(1, meta.frame_count);
      fps = meta.fps || 30;
      frameIdx = 0;
      slider.value = "0";
      timeInfo.textContent = `0.00s / ${meta.duration_s.toFixed(2)}s`;
      renderSegList();
      await seek(0);
    } catch (e) {
      status.textContent = `Open error: ${String(e)}`;
    }
  }

  // ── Scrubbing ────────────────────────────────────────────────
  function onSlider(v: number): void {
    frameIdx = Math.round((v / 1000) * (frameCount - 1));
    void seek(frameIdx);
  }

  function step(label: string): void {
    const delta = label.startsWith("+") ? 1 : -1;
    const isFrame = label.endsWith("f");
    const amount = isFrame ? Number(label.slice(0, -1)) : Number(label.slice(0, -1)) * fps;
    let next = frameIdx + (isFrame ? amount : delta * amount);
    next = Math.max(0, Math.min(frameCount - 1, next));
    slider.value = String((next / (frameCount - 1)) * 1000);
    void seek(Math.round(next));
  }

  async function seek(idx: number): Promise<void> {
    if (!current || seeking) return;
    seeking = true;
    try {
      frameIdx = idx;
      const res = await advSeek(current, idx);
      frameLabel.textContent = `FRAME ${idx}/${frameCount - 1}`;
      timeInfo.textContent = `${(idx / fps).toFixed(2)}s / ${(frameCount / fps).toFixed(2)}s`;
      preview.style.backgroundImage = `url(data:image/jpeg;base64,${res.frame_b64})`;
      preview.style.backgroundSize = "contain";
      preview.style.backgroundRepeat = "no-repeat";
      preview.style.backgroundPosition = "center";
    } catch (e) {
      status.textContent = `Seek error: ${String(e)}`;
    } finally {
      seeking = false;
    }
  }

  // ── Segments ─────────────────────────────────────────────────
  function setIn(): void {
    pendingIn = frameIdx / fps;
    pendingInfo.textContent = `IN: ${pendingIn.toFixed(2)}s — scrub, then SET OUT`;
  }

  function setOut(): void {
    if (!current || pendingIn === null) return;
    const out = frameIdx / fps;
    if (out <= pendingIn) {
      status.textContent = "Out must be after In";
      return;
    }
    const name = current.split(/[\\/]/).pop() ?? current;
    store.segments[name] = store.segments[name] ?? [];
    store.segments[name].push({ start: pendingIn, end: out });
    pendingIn = null;
    pendingInfo.textContent = "";
    renderSegList();
  }

  function renderSegList(): void {
    segList.innerHTML = "";
    if (!current) return;
    const name = current.split(/[\\/]/).pop() ?? current;
    const segs = store.segments[name] ?? [];
    if (segs.length === 0) {
      segList.append(el("div", "seg", "— no segments —"));
      return;
    }
    for (const [i, s] of segs.entries()) {
      const row = el("div", "seg");
      row.append(el("span", undefined, `${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s`));
      const remove = renderButton({ label: "✕", variant: "ghost", onClick: () => {
        store.segments[name].splice(i, 1);
        renderSegList();
      } });
      row.append(remove);
      segList.append(row);
    }
  }

  // ── Capture ──────────────────────────────────────────────────
  async function capture(): Promise<void> {
    if (!current) return;
    try {
      const res = await advCapture(current, frameIdx, store.buildConfig() as never);
      status.textContent = `Saved: ${res.out_path}`;
    } catch (e) {
      status.textContent = `Capture error: ${String(e)}`;
    }
  }

  // ── Open / close ─────────────────────────────────────────────
  function open(): void {
    void loadVideos();
    showModal(modal, true);
  }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) showModal(modal, false);
  });

  return { root: modal, open };
}
