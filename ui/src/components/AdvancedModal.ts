import { advCapture, advOpen, advSeek, advSegments } from "../api/ipc";
import { t } from "../i18n";
import type { Store } from "../state/store";
import { renderButton } from "./Button";
import { renderModal, showModal } from "./Modal";
import { renderSelectMenu } from "./SelectMenu";
import { el } from "./el";

export interface AdvancedModal {
  root: HTMLElement;
  open: () => void;
  destroy: () => void;
}

export function renderAdvancedModal(store: Store): AdvancedModal {
  let current: string | null = null;
  let frameCount = 1;
  let fps = 30;
  let duration = 0;
  let frameIndex = 0;
  let pendingIn: number | null = null;
  let seekInFlight = false;
  let queuedFrame: number | null = null;

  const select = renderSelectMenu({
    className: "adv-video",
    ariaLabel: t("adv_title"),
    onChange: () => void openCurrent(),
  });
  const preview = el("div", "adv-preview");
  preview.append(el("div", "scanlines"));
  const frameLabel = el("span", "adv-frame-label", "—");
  const frameNo = el("span", "frame-no", "00:00.000");
  preview.append(frameLabel, frameNo);
  const sliderWrap = el("div", "adv-slider");
  const slider = el("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1000";
  slider.value = "0";
  sliderWrap.append(slider);
  const time = el("div", "adv-time", "0.00s / 0.00s");
  const steps = el("div", "adv-steps");
  for (const label of ["-10s", "-1s", "-1f", "+1f", "+1s", "+10s"]) {
    steps.append(renderButton({ label, onClick: () => step(label) }));
  }
  const segmentRow = el("div", "adv-segrow");
  const pending = el("span", "pending");
  segmentRow.append(
    renderButton({ label: t("set_in"), onClick: setIn }),
    renderButton({ label: t("set_out"), onClick: () => void setOut() }),
    pending,
    renderButton({ label: t("capture"), variant: "orange", onClick: () => void capture() }),
  );
  const list = el("div", "adv-list");
  const status = el("div", "validate-status");
  const modalActions = el("div", "modal-actions");
  const modal = renderModal({
    title: t("adv_title"),
    tag: "RL-SCRUB",
    width: 680,
    body: [select.root, preview, sliderWrap, time, steps, segmentRow, list, status, modalActions],
  });
  modalActions.append(renderButton({ label: t("done_button"), onClick: () => showModal(modal, false) }));

  function videoName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  function secondsAt(index = frameIndex): number {
    return fps > 0 ? index / fps : 0;
  }

  function updateReadout(): void {
    const seconds = secondsAt();
    time.textContent = `${seconds.toFixed(2)}s / ${duration.toFixed(2)}s`;
    frameLabel.textContent = current ? `FRAME // ${videoName(current)} @ ${seconds.toFixed(2)}s` : "—";
    frameNo.textContent = `${seconds.toFixed(3)}s`;
    slider.value = frameCount > 1 ? String((frameIndex / (frameCount - 1)) * 1000) : "0";
  }

  async function loadVideos(): Promise<void> {
    if (!store.inputPath) {
      status.className = "validate-status err";
      status.textContent = t("no_input");
      return;
    }
    if (!store.videos.length) await store.refreshVideos();
    select.setOptions(store.videos.map((entry) => ({
      value: entry.path,
      label: `${entry.name}${entry.meta ? `  (${formatDuration(entry.meta.duration_s)})` : ""}`,
    })));
    if (!store.videos.length) {
      status.className = "validate-status err";
      status.textContent = t("no_videos", { path: store.inputPath });
      return;
    }
    select.setValue(store.selectedVideo && store.videos.some((entry) => entry.path === store.selectedVideo)
      ? store.selectedVideo
      : store.videos[0].path);
    await openCurrent();
  }

  function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  }

  async function openCurrent(): Promise<void> {
    if (!select.getValue()) return;
    current = select.getValue();
    store.selectVideo(current);
    pendingIn = null;
    pending.textContent = "";
    status.textContent = t("opening_video");
    try {
      const meta = await advOpen(current);
      frameCount = Math.max(1, meta.frame_count);
      fps = meta.fps > 0 ? meta.fps : 30;
      duration = meta.duration_s;
      frameIndex = 0;
      queuedFrame = null;
      renderSegments();
      updateReadout();
      requestSeek(0);
    } catch (error) {
      status.className = "validate-status err";
      status.textContent = `OPEN — ${String(error)}`;
    }
  }

  function requestSeek(index: number): void {
    const next = Math.max(0, Math.min(frameCount - 1, Math.round(index)));
    frameIndex = next;
    updateReadout();
    if (seekInFlight) {
      queuedFrame = next;
      return;
    }
    void seek(next);
  }

  async function seek(index: number): Promise<void> {
    if (!current) return;
    seekInFlight = true;
    status.className = "validate-status";
    status.textContent = t("seeking_frame", { frame: index });
    try {
      const response = await advSeek(current, index);
      if (index === frameIndex || queuedFrame === null) {
        preview.style.backgroundImage = `url(data:image/jpeg;base64,${response.frame_b64})`;
        status.className = "validate-status ok";
        status.textContent = t("frame_ready", { frame: index });
      }
    } catch (error) {
      status.className = "validate-status err";
      status.textContent = `SEEK — ${String(error)}`;
    } finally {
      seekInFlight = false;
      const queued = queuedFrame;
      queuedFrame = null;
      if (queued !== null && queued !== index) void seek(queued);
    }
  }

  function step(label: string): void {
    const sign = label.startsWith("-") ? -1 : 1;
    const magnitude = Number.parseFloat(label.slice(1, -1));
    const frames = label.endsWith("f") ? magnitude : magnitude * fps;
    requestSeek(frameIndex + sign * frames);
  }

  function setIn(): void {
    pendingIn = secondsAt();
    pending.textContent = `IN: ${pendingIn.toFixed(2)}s — ${t("set_out_hint")}`;
  }

  async function setOut(): Promise<void> {
    if (!current || pendingIn === null) {
      status.className = "validate-status err";
      status.textContent = t("set_in_first");
      return;
    }
    const out = secondsAt();
    if (out <= pendingIn) {
      status.className = "validate-status err";
      status.textContent = t("out_after_in");
      return;
    }
    const name = videoName(current);
    store.segments[name] ??= [];
    store.segments[name].push({ start: pendingIn, end: out });
    pendingIn = null;
    pending.textContent = "";
    renderSegments();
    const payload: Record<string, [number, number][]> = {};
    for (const [key, segments] of Object.entries(store.segments)) {
      payload[key] = segments.map((segment) => [segment.start, segment.end]);
    }
    await advSegments(payload);
  }

  function renderSegments(): void {
    list.innerHTML = "";
    if (!current) return;
    const name = videoName(current);
    const segments = store.segments[name] ?? [];
    if (!segments.length) {
      list.append(el("div", "seg empty", t("no_segments")));
      return;
    }
    for (const [index, segment] of segments.entries()) {
      const row = el("div", "seg");
      row.append(el("span", undefined, `${name} · ${segment.start.toFixed(2)}s → ${segment.end.toFixed(2)}s`));
      row.append(renderButton({ label: "✕", title: t("remove_segment"), onClick: () => {
        store.segments[name].splice(index, 1);
        renderSegments();
      } }));
      list.append(row);
    }
  }

  async function capture(): Promise<void> {
    if (!current) return;
    status.className = "validate-status";
    status.textContent = t("capturing");
    try {
      const result = await advCapture(current, frameIndex, store.buildConfig() as never);
      status.className = "validate-status ok";
      status.textContent = t("capture_saved", { path: result.out_path });
    } catch (error) {
      status.className = "validate-status err";
      status.textContent = `CAPTURE — ${String(error)}`;
    }
  }

  slider.addEventListener("input", () => requestSeek((Number(slider.value) / 1000) * (frameCount - 1)));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) showModal(modal, false);
  });

  return {
    root: modal,
    open: () => {
      showModal(modal, true);
      void loadVideos();
    },
    destroy: select.destroy,
  };
}
