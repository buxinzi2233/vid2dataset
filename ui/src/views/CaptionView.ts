//! Caption view: auto-tag + trigger + tag quality fields.

import { renderPanel } from "../components/Panel";
import { renderButton } from "../components/Button";
import { renderField } from "../components/Field";
import { runTagger } from "../api/ipc";
import type { Store } from "../state/store";

export function renderCaptionView(store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";

  const folder = renderField({
    label: "OUTPUT FOLDER",
    value: store.outputPath,
    placeholder: "/path/to/dataset",
  });
  const trigger = renderField({ label: "TRIGGER WORD", value: "mychar_v1" });

  const status = document.createElement("div");
  status.className = "validate-status";

  const run = renderButton({
    label: "RUN TAGGER",
    variant: "fill",
    onClick: async () => {
      status.textContent = "TAGGING — running…";
      status.className = "validate-status";
      try {
        const folderInput = folder.querySelector("input");
        const path = folderInput?.value.trim() || store.outputPath;
        await runTagger({ folder: path, triggerWord: "mychar_v1" });
        status.textContent = "TAGGING — started (events stream via tagger.done)";
        status.className = "validate-status ok";
      } catch (e) {
        status.textContent = `TAGGING — error: ${String(e)}`;
        status.className = "validate-status err";
      }
    },
  });

  const body = document.createElement("div");
  body.className = "cap-fields";
  body.append(folder, trigger, run, status);

  root.append(renderPanel({ code: "03", title: "CAPTIONING", tag: "WD-TAGGER", body: [body] }));
  return root;
}
