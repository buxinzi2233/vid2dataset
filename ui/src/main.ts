import "./styles.css";
import { renderApp } from "./app";

const root = document.getElementById("app");
if (root) {
  renderApp(root);
} else {
  throw new Error("missing #app mount point");
}
