import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// Production API URL
setBaseUrl("https://elham-multiplast-crm.onrender.com/api");

// Auto-capitalize: first letter of each word in text inputs and textareas
// Respects localStorage crm_autocap === "off" to disable
let _capitalizing = false;

document.addEventListener(
  "input",
  (e) => {
    if (_capitalizing) return;
    if (localStorage.getItem("crm_autocap") === "off") return;

    const el = e.target as HTMLInputElement | HTMLTextAreaElement;

    const skipTypes = [
      "email",
      "password",
      "number",
      "date",
      "datetime-local",
      "month",
      "time",
      "url",
      "search",
      "hidden",
      "color",
      "file",
      "range",
    ];

    if (el instanceof HTMLInputElement && skipTypes.includes(el.type)) {
      return;
    }

    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
      return;
    }

    if (el.getAttribute("data-no-cap") !== null) {
      return;
    }

    const ac = el.getAttribute("autocomplete") ?? "";

    if (/username|email|password/i.test(ac)) {
      return;
    }

    const val = el.value;

    const capitalized = val.replace(
      /(^|[\s\-\/])([a-z])/g,
      (_, sep, char) => sep + char.toUpperCase(),
    );

    if (capitalized === val) return;

    const pos = el.selectionStart;

    _capitalizing = true;

    try {
      const proto =
        el instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;

      const setter = Object.getOwnPropertyDescriptor(
        proto,
        "value",
      )?.set;

      if (setter) {
        setter.call(el, capitalized);

        el.dispatchEvent(
          new Event("input", {
            bubbles: true,
          }),
        );

        if (pos !== null) {
          el.setSelectionRange(pos, pos);
        }
      }
    } finally {
      _capitalizing = false;
    }
  },
  true,
);

createRoot(document.getElementById("root")!).render(<App />);