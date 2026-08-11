//! Roster view: discovered videos as cards.

import { renderPanel } from "../components/Panel";
import { discoverVideos } from "../api/ipc";
import { el } from "../components/el";
import { t } from "../i18n";
import type { Store } from "../state/store";

export function renderRosterView(store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";

  const roster = el("div", "roster");
  const count = el("div", "validate-status");

  const panel = renderPanel({
    code: "04",
    title: t("v_roster"),
    tag: "0 FILES",
    body: [roster, count],
  });
  root.append(panel);

  async function refresh(): Promise<void> {
    const path = store.inputPath;
    if (!path) {
      count.textContent = t("no_input");
      return;
    }
    try {
      const files = await discoverVideos(path);
      count.textContent = t("videos_found", { n: files.length });
      panel.querySelector(".ptag")!.textContent = `${files.length} FILES`;
      roster.innerHTML = "";
      for (const f of files) {
        const card = el("div", "roster-card");
        const meta = el("div", "meta");
        const name = el("div", "vname", f.split(/[\\/]/).pop() ?? f);
        const sub = el("div", "vsub", f);
        meta.append(name, sub);
        card.append(meta);
        roster.append(card);
      }
    } catch (e) {
      count.textContent = t("path_not_found", { path });
      count.className = "validate-status err";
    }
  }

  void refresh();
  return root;
}
