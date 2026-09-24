// Document de test (jsdom) installé AVANT React et le routeur : à importer
// en premier dans chaque fichier de test.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html lang=\"fr\"><body></body></html>", { url: "http://localhost/" });
const w = dom.window;
for (const cle of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent",
  "KeyboardEvent", "PopStateEvent", "getComputedStyle", "sessionStorage", "localStorage"]) {
  Object.defineProperty(globalThis, cle, { value: cle === "window" ? w : w[cle], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
