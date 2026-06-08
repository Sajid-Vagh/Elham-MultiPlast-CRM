import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Auto-capitalize: first letter of each word in text inputs and textareas
// Respects localStorage crm_autocap === "off" to disable
let _capitalizing = false;
document.addEventListener("input", (e) => {
  if (_capitalizing) return;
  if (localStorage.getItem("crm_autocap") === "off") return;

  const el = e.target as HTMLInputElement | HTMLTextAreaElement;
  const skipTypes = ["email", "password", "number", "date", "datetime-local", "month", "time", "url", "search", "hidden", "color", "file", "range"];
  if (el instanceof HTMLInputElement && skipTypes.includes(el.type)) return;
  if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;

  // Skip any field tagged with data-no-cap (username fields, email fields, paste areas, etc.)
  if (el.getAttribute("data-no-cap") !== null) return;
  // Also skip by autocomplete hint (username, email, current-password, new-password)
  const ac = el.getAttribute("autocomplete") ?? "";
  if (/username|email|password/i.test(ac)) return;

  const val = el.value;
  const capitalized = val.replace(/(^|[\s\-\/])([a-z])/g, (_, sep, char) => sep + char.toUpperCase());
  if (capitalized === val) return;

  const pos = el.selectionStart;
  _capitalizing = true;
  try {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(el, capitalized);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (pos !== null) el.setSelectionRange(pos, pos);
    }
  } finally {
    _capitalizing = false;
  }
}, true);

createRoot(document.getElementById("root")!).render(<App />);
