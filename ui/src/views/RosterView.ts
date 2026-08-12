import type { VideoStatsSummary } from "../api/events";
import { el } from "../components/el";
import { t } from "../i18n";
import { aggregateResult, rejectedCount } from "../state/runState";
import type { Store, VideoEntry } from "../state/store";

export interface RosterViewOptions {
  onSelect?: () => void;
}

export interface RosterView {
  root: HTMLElement;
  refresh: () => Promise<void>;
  destroy: () => void;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

function resultFor(store: Store, entry: VideoEntry): VideoStatsSummary | undefined {
  return store.run.result?.videos.find((video) => video.video === entry.path || basename(video.video) === entry.name);
}

function summaryItem(label: string, unit: string, className = ""): { root: HTMLElement; value: HTMLElement } {
  const root = el("div", "sum-item");
  const value = el("div", `sv ${className}`.trim());
  value.append(document.createTextNode("0"), el("span", "unit", ` ${unit}`));
  root.append(el("div", "sk", label), value);
  return { root, value };
}

export function renderRosterView(store: Store, options: RosterViewOptions = {}): RosterView {
  const root = el("section", "view");
  root.dataset.view = "roster";
  const inner = el("div", "inner");
  const summary = el("div", "summary");
  const written = summaryItem(t("written"), t("images"), "accent");
  const rejected = summaryItem(t("rejected"), t("frames"));
  const watermarks = summaryItem(t("watermarks"), t("detected"), "warn");
  const elapsed = summaryItem(t("elapsed"), "s");
  summary.append(written.root, rejected.root, watermarks.root, elapsed.root);
  const roster = el("div", "roster");
  const status = el("div", "validate-status");
  inner.append(summary, roster, status);
  root.append(inner);

  function setSummaryValue(node: HTMLElement, value: string, unit: string): void {
    node.replaceChildren(document.createTextNode(value), el("span", "unit", ` ${unit}`));
  }

  function render(): void {
    const aggregate = aggregateResult(store.run.result);
    setSummaryValue(written.value, String(aggregate.written), t("images"));
    setSummaryValue(rejected.value, String(aggregate.rejected), t("frames"));
    setSummaryValue(watermarks.value, String(aggregate.watermarks), t("detected"));
    setSummaryValue(elapsed.value, aggregate.elapsed.toFixed(1), "s");

    roster.innerHTML = "";
    for (const entry of store.videos) {
      const result = resultFor(store, entry);
      const card = el("button", `roster-card${store.selectedVideo === entry.path ? " selected" : ""}`);
      card.type = "button";
      const barClass = result
        ? result.watermarks.length ? "warn" : "done"
        : store.run.status === "running" ? "busy" : "";
      const statusBar = el("span", `statusbar ${barClass}`.trim());
      const meta = el("span", "meta");
      const details = entry.meta
        ? `${formatDuration(entry.meta.duration_s)} · ${entry.meta.width}×${entry.meta.height} · ${entry.meta.fps.toFixed(2)} fps`
        : entry.probeError ? `PROBE ERROR · ${entry.probeError}` : entry.path;
      meta.append(el("span", "vname", entry.name), el("span", "vsub", details));
      const stats = el("span", "vstats");
      const kept = el("span");
      kept.append(el("span", "num kept", result ? String(result.written) : "—"), document.createTextNode(t("kept")));
      const rej = el("span");
      rej.append(el("span", "num rej", result ? String(rejectedCount(result)) : "—"), document.createTextNode(t("rej")));
      const watermark = el("span", "warn-tag", result?.watermarks.length ? `WM ×${result.watermarks.length}` : "");
      stats.append(kept, rej, watermark);
      card.append(statusBar, meta, stats);
      card.addEventListener("click", () => {
        store.selectVideo(entry.path);
        options.onSelect?.();
      });
      roster.append(card);
    }

    if (store.rosterLoading) status.textContent = t("discovering_videos");
    else if (store.rosterStatus === "no-input") status.textContent = t("no_input");
    else if (store.rosterStatus === "empty") status.textContent = t("no_videos", { path: store.inputPath });
    else if (store.rosterStatus.startsWith("error:")) status.textContent = store.rosterStatus.slice(6);
    else status.textContent = store.videos.length ? t("videos_found", { n: store.videos.length }) : "";
    status.className = `validate-status${store.rosterStatus.startsWith("error:") ? " err" : ""}`;
  }

  const unsubscribe = store.subscribe(render);
  render();
  return { root, refresh: () => store.refreshVideos(), destroy: unsubscribe };
}
