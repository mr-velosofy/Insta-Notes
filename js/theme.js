/**
 * theme.js — applies the studio's UI mode (light/dark) to the whole UI of both
 * pages, plus the scene colors (the note itself) from the selected note theme.
 *
 * UI mode lives in `inote-ui-mode` (localStorage) and only drives neutral
 * light/dark surfaces, text, borders and a fixed brand accent — selecting a
 * note theme no longer recolors the app chrome.
 *
 * The note theme (`inote-theme`, same key the Studio persists) still drives
 * `--scene-*` variables so the landing hero note and the studio canvas share
 * the exact product look. Also exposes `window.InoteTheme` for convenience.
 */
(function () {
  "use strict";

  var THEME_PALETTES = {
    "green-forest": { bg: "#071207", bubble: "#163820", played: "#a8e6cf", remaining: "#2d5a3d", timer: "#a8e6cf" },
    "dark-neon":    { bg: "#0b0712", bubble: "#1c1433", played: "#ff5f8f", remaining: "#4b3a6b", timer: "#ff5f8f" },
    "light-pastel": { bg: "#f6f1fa", bubble: "#e7def2", played: "#7c5cbf", remaining: "#c9bde0", timer: "#7c5cbf" },
    "warm-sunset":  { bg: "#2a0d10", bubble: "#4a1c1e", played: "#ffb16b", remaining: "#8a4a3a", timer: "#ffb16b" }
  };
  var CUSTOM_THEME_KEY = "inote-custom-theme";
  var UI_MODE_KEY = "inote-ui-mode";

  // Fixed brand accent — the UI never changes color with the note theme.
  var ACCENT = "#d62976";

  // Classic Instagram gradient, used for the logo and primary CTAs.
  var INSTA_GRADIENT = "linear-gradient(45deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5)";

  // Neutral light/dark UI palettes.
  var LIGHT = {
    bg: "#f4f5f7",
    surface: "#ffffff",
    text: "#111827",
    textMuted: "#4b5563",
    textLight: "#6b7280",
    border: "#e5e7eb",
    panelBorder: "#d1d5db",
    btn: "#eef0f2",
    btnHover: "#e2e5e9",
    skeleton: "#dde1e7",
    skeletonShine: "#f6f8fa",
  };
  var DARK = {
    bg: "#0f1115",
    surface: "#1a1d24",
    text: "#f3f4f6",
    textMuted: "rgba(255,255,255,0.68)",
    textLight: "rgba(255,255,255,0.45)",
    border: "rgba(255,255,255,0.08)",
    panelBorder: "rgba(255,255,255,0.14)",
    btn: "rgba(255,255,255,0.06)",
    btnHover: "rgba(255,255,255,0.12)",
    skeleton: "rgba(255,255,255,0.10)",
    skeletonShine: "rgba(255,255,255,0.20)",
  };

  function hexRgb(hex) {
    var h = hex.replace("#", "");
    return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
  }
  function rgba(hex, a) {
    var c = hexRgb(hex);
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }
  function mix(hex, target, t) {
    var a = hexRgb(hex), b = hexRgb(target);
    var r = Math.round(a.r + (b.r - a.r) * t);
    var g = Math.round(a.g + (b.g - a.g) * t);
    var bb = Math.round(a.b + (b.b - a.b) * t);
    return "#" + [r, g, bb].map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
  }

  /** Build a palette for the user's custom note theme (stored in localStorage). */
  function readCustom() {
    var c = { bg: "#071207", bubble: "#163820", played: "#a8e6cf" };
    try {
      var raw = JSON.parse(localStorage.getItem(CUSTOM_THEME_KEY) || "null");
      if (raw && raw.bg && raw.bubble && raw.played) c = raw;
    } catch (e) { /* corrupted value — fall back to defaults */ }
    return {
      bg: c.bg,
      bubble: c.bubble,
      played: c.played,
      remaining: mix(c.played, c.bubble, 0.55),
      timer: c.played
    };
  }

  /** The note scene palette from the saved note theme. */
  function scenePalette() {
    var id = localStorage.getItem("inote-theme") || "green-forest";
    return THEME_PALETTES[id] || (id === "custom" ? readCustom() : THEME_PALETTES["green-forest"]);
  }

  /** Re-derive every CSS custom property from the UI mode + note theme. */
  function applyVars() {
    var mode = localStorage.getItem(UI_MODE_KEY) || "light";
    var dark = mode === "dark";
    document.documentElement.dataset.uiMode = mode;
    document.documentElement.style.colorScheme = mode;

    var P = dark ? DARK : LIGHT;
    var WHITE = "#ffffff";
    var btnPrimaryBg = ACCENT;
    var btnPrimaryHover = dark ? mix(ACCENT, "#ffffff", 0.14) : mix(ACCENT, "#000000", 0.14);

    var root = document.documentElement.style;
    function set(k, v) { root.setProperty(k, v); }

    set("--bg-body", P.bg);
    set("--text-main", P.text);
    set("--text-muted", P.textMuted);
    set("--text-light", P.textLight);
    set("--brand-orange", ACCENT);
    set("--brand-orange-light", dark ? rgba(ACCENT, 0.16) : "#fdf2f8");
    set("--border-color", P.border);
    set("--card-bg", P.surface);
    set("--panel-border", P.panelBorder);
    set("--btn-bg-light", P.btn);
    set("--btn-bg-hover", P.btnHover);
    set("--skeleton-base", P.skeleton);
    set("--skeleton-shine", P.skeletonShine);
    set("--input-bg", P.surface);

    set("--insta-gradient", INSTA_GRADIENT);
    set("--accent-soft", dark ? rgba(ACCENT, 0.16) : "#fdf2f8");
    set("--accent-soft-2", dark ? rgba(ACCENT, 0.28) : "#fce7f3");
    set("--btn-primary-bg", btnPrimaryBg);
    set("--btn-primary-fg", WHITE);
    set("--btn-primary-hover", btnPrimaryHover);
    set("--cta-bg", dark ? "#1a1d24" : "#ffffff");
    set("--cta-text", dark ? WHITE : "#111827");
    set("--cta-glow", rgba(ACCENT, 0.25));
    set("--step-line", dark ? "rgba(255,255,255,0.14)" : "#e5e7eb");
    set("--trim-dim", dark ? "rgba(255,255,255,0.15)" : "rgba(17,24,39,0.12)");
    set("--logo-bg", "#111111");
    set("--logo-fg", "#ffffff");

    set("--shadow-sm", dark ? "0 1px 2px rgba(0,0,0,0.5)" : "0 1px 2px 0 rgba(0,0,0,0.05)");
    set("--shadow-md", dark ? "0 4px 14px rgba(0,0,0,0.5)" : "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)");
    set("--shadow-lg", dark ? "0 14px 38px rgba(0,0,0,0.6)" : "0 10px 25px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)");

    // Scene colors (the note itself) come from the selected note theme.
    var th = scenePalette();
    window.InoteTheme = th;
    set("--scene-bg", th.bg);
    set("--scene-bubble", th.bubble);
    set("--scene-played", th.played);
    set("--scene-remaining", th.remaining);
    set("--scene-timer", th.timer);
    set("--note-glow", "0 20px 50px -20px " + rgba(th.played, 0.55));
  }

  /** Apply the current mode + scene colors immediately (no whole-UI cross-fade,
   *  which caused a flicker of intermediate colors on every element). */
  window.applyInoteTheme = function () {
    applyVars();
  };

  // Light/dark mode helpers (shared by both pages' toggle buttons).
  window.getUiMode = function () { return localStorage.getItem(UI_MODE_KEY) || "light"; };
  window.setUiMode = function (mode) {
    localStorage.setItem(UI_MODE_KEY, mode);
    window.applyInoteTheme();
  };
  window.toggleUiMode = function () {
    window.setUiMode(window.getUiMode() === "dark" ? "light" : "dark");
  };

  // Auto-wire any page element with id="ui-mode-btn".
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("ui-mode-btn");
    if (btn) btn.addEventListener("click", window.toggleUiMode);
  });

  applyVars();
})();
