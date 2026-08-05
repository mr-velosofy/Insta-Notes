/**
 * theme.js — applies the studio's saved theme to the whole UI of both pages.
 *
 * Reads `inote-theme` from localStorage (the same key the Studio persists when
 * the user picks a theme) and derives a full set of CSS custom properties for
 * light/dark surfaces, text, borders and accent colors. The existing CSS uses
 * these variables, so both the landing page and the studio recolor live.
 *
 * Also exposes the resolved palette as `window.InoteTheme` and sets `--scene-*`
 * variables so the landing hero note uses the exact theme colors.
 */
(function () {
  "use strict";

  var THEME_PALETTES = {
    "green-forest": { bg: "#071207", bubble: "#163820", played: "#a8e6cf", remaining: "#2d5a3d", timer: "#a8e6cf" },
    "dark-neon":    { bg: "#0b0712", bubble: "#1c1433", played: "#ff5f8f", remaining: "#4b3a6b", timer: "#ff5f8f" },
    "light-pastel": { bg: "#f6f1fa", bubble: "#e7def2", played: "#7c5cbf", remaining: "#c9bde0", timer: "#7c5cbf" },
    "warm-sunset":  { bg: "#2a0d10", bubble: "#4a1c1e", played: "#ffb16b", remaining: "#8a4a3a", timer: "#ffb16b" }
  };

  function hexRgb(hex) {
    var h = hex.replace("#", "");
    return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
  }
  function rgba(hex, a) {
    var c = hexRgb(hex);
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }
  function lum(hex) {
    var c = hexRgb(hex);
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }
  function mix(hex, target, t) {
    var a = hexRgb(hex), b = hexRgb(target);
    var r = Math.round(a.r + (b.r - a.r) * t);
    var g = Math.round(a.g + (b.g - a.g) * t);
    var bb = Math.round(a.b + (b.b - a.b) * t);
    return "#" + [r, g, bb].map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
  }

  /** Re-derive every CSS custom property from the saved theme. Exposed via
   *  window.applyInoteTheme() with a smooth transition; the initial load calls
   *  applyVars() directly so the page paints with the theme on first render. */
  function applyVars() {
    var id = localStorage.getItem("inote-theme") || "green-forest";
    var theme = THEME_PALETTES[id] || THEME_PALETTES["green-forest"];
    window.InoteTheme = theme;

    var dark = lum(theme.bg) < 0.4;
    var WHITE = "#ffffff", INK = "#111827", BLACK = "#000000";

    var accent = theme.played;
    var accentContrast = lum(accent) < 0.5 ? WHITE : INK;
    var text = dark ? "#f3f4f6" : INK;
    var textMuted = dark ? rgba(WHITE, 0.68) : rgba(INK, 0.65);
    var textLight = dark ? rgba(WHITE, 0.45) : rgba(INK, 0.45);
    var bg = dark ? theme.bg : "#f8f6fb";
    var surface = dark ? theme.bubble : WHITE;
    var border = dark ? rgba(WHITE, 0.12) : rgba(INK, 0.1);
    var panelBorder = dark ? rgba(WHITE, 0.16) : rgba(INK, 0.12);
    var btnLight = dark ? rgba(WHITE, 0.06) : "#f9fafb";
    var btnHover = dark ? rgba(WHITE, 0.12) : "#f3f4f6";
    var accentSoft = rgba(accent, dark ? 0.16 : 0.12);
    var accentSoft2 = rgba(accent, dark ? 0.28 : 0.22);
    var btnPrimaryHover = mix(accent, dark ? WHITE : BLACK, 0.14);

    var root = document.documentElement.style;
    function set(k, v) { root.setProperty(k, v); }

    set("--bg-body", bg);
    set("--text-main", text);
    set("--text-muted", textMuted);
    set("--text-light", textLight);
    set("--brand-orange", accent);
    set("--brand-orange-light", accentSoft);
    set("--border-color", border);
    set("--card-bg", surface);
    set("--panel-border", panelBorder);
    set("--btn-bg-light", btnLight);
    set("--btn-bg-hover", btnHover);
    set("--input-bg", surface);

    set("--accent-soft", accentSoft);
    set("--accent-soft-2", accentSoft2);
    set("--btn-primary-bg", accent);
    set("--btn-primary-fg", accentContrast);
    set("--btn-primary-hover", btnPrimaryHover);
    set("--cta-bg", dark ? mix(theme.bg, BLACK, 0.35) : INK);
    set("--cta-text", WHITE);
    set("--cta-glow", rgba(accent, 0.25));
    set("--step-line", dark ? rgba(WHITE, 0.16) : "#e5e7eb");
    set("--trim-dim", dark ? rgba(WHITE, 0.15) : rgba(INK, 0.12));
    set("--logo-bg", accent);
    set("--logo-fg", accentContrast);

    set("--shadow-sm", dark ? "0 1px 2px rgba(0,0,0,0.4)" : "0 1px 2px 0 rgba(0,0,0,0.05)");
    set("--shadow-md", dark ? "0 4px 12px rgba(0,0,0,0.45)" : "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)");
    set("--shadow-lg", dark ? "0 14px 34px rgba(0,0,0,0.55)" : "0 10px 25px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)");

    set("--scene-bg", theme.bg);
    set("--scene-bubble", theme.bubble);
    set("--scene-played", theme.played);
    set("--scene-remaining", theme.remaining);
    set("--scene-timer", theme.timer);
    set("--note-glow", "0 20px 50px -20px " + rgba(accent, 0.55));
  }

  /** Apply the theme with a short whole-UI transition (used on live changes
   *  from the theme dropdown). The CSS rule for `html.theme-animating *`
   *  animates colors/backgrounds/borders/shadows for ~0.45s. */
  window.applyInoteTheme = function () {
    var root = document.documentElement;
    root.classList.add("theme-animating");
    applyVars();
    clearTimeout(window.__inoteThemeTimer);
    window.__inoteThemeTimer = setTimeout(function () {
      root.classList.remove("theme-animating");
    }, 500);
  };

  applyVars();
})();
