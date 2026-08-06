/**
 * colorpicker.js — a small custom color picker (2D saturation/value area +
 * hue slider + hex input) that replaces the native <input type="color"> in the
 * custom-theme editor. The popover is rendered into <body> and styled with the
 * studio CSS variables, so it matches the current light/dark UI.
 */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  v = clamp(v, 0, 1);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => clamp(v, 0, 255).toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/**
 * Build the picker popover.
 * @param {{onChange?: (hex: string) => void, onCommit?: () => void}} handlers
 * @returns {{open: (anchor: HTMLElement, hex: string) => void, close: () => void, isOpen: () => boolean}}
 */
export function createColorPicker({ onChange = () => {}, onCommit = () => {} } = {}) {
  const el = document.createElement("div");
  el.className = "color-picker";
  el.hidden = true;
  el.innerHTML = `
    <div class="cp-sv">
      <span class="cp-handle"></span>
    </div>
    <div class="cp-hue">
      <span class="cp-handle"></span>
    </div>
    <div class="cp-row">
      <span class="cp-preview"></span>
      <input class="cp-hex" type="text" spellcheck="false" aria-label="Hex color" autocomplete="off" />
    </div>`;
  document.body.appendChild(el);

  const svEl = el.querySelector(".cp-sv");
  const svHandle = svEl.querySelector(".cp-handle");
  const hueEl = el.querySelector(".cp-hue");
  const hueHandle = hueEl.querySelector(".cp-handle");
  const previewEl = el.querySelector(".cp-preview");
  const hexInput = el.querySelector(".cp-hex");

  let h = 0, s = 1, v = 1;
  let dragging = null;

  function currentHex() {
    const [r, g, b] = hsvToRgb(h, s, v);
    return rgbToHex(r, g, b);
  }

  function render() {
    const hex = currentHex();
    const hue = `hsl(${h}, 100%, 50%)`;
    svEl.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})`;
    svHandle.style.left = `${s * 100}%`;
    svHandle.style.top = `${(1 - v) * 100}%`;
    svHandle.style.background = hex;
    hueHandle.style.left = `${(h / 360) * 100}%`;
    previewEl.style.background = hex;
    if (document.activeElement !== hexInput) hexInput.value = hex;
    onChange(hex);
  }

  function setHex(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    let r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    v = max;
    s = max === 0 ? 0 : d / max;
    if (d === 0) h = 0;
    else if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    render();
  }

  function posIn(target, e) {
    const rect = target.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function applyPointer(e, kind) {
    if (kind === "sv") {
      const p = posIn(svEl, e);
      s = p.x;
      v = 1 - p.y;
    } else {
      const p = posIn(hueEl, e);
      h = p.x * 360;
    }
    render();
  }

  function onPointerDown(e, kind) {
    e.preventDefault();
    dragging = kind;
    applyPointer(e, kind);
    const move = (ev) => { if (dragging === kind) applyPointer(ev, kind); };
    const up = () => {
      if (dragging === kind) {
        dragging = null;
        onCommit();
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  svEl.addEventListener("pointerdown", (e) => onPointerDown(e, "sv"));
  hueEl.addEventListener("pointerdown", (e) => onPointerDown(e, "hue"));

  hexInput.addEventListener("input", () => {
    const raw = hexInput.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(raw)) setHex(raw.startsWith("#") ? raw : "#" + raw);
  });
  hexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
      hexInput.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  function open(anchor, hex) {
    setHex(hex);
    const w = 264;
    const hh = 232;
    const rect = anchor.getBoundingClientRect();
    let left = rect.right - w;
    let top = rect.bottom + 8;
    if (top + hh > window.innerHeight - 8) top = rect.top - hh - 8;
    left = clamp(left, 8, Math.max(8, window.innerWidth - w - 8));
    top = Math.max(8, top);
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.hidden = false;
    onCommit();
  }

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    dragging = null;
    onCommit();
  }

  function isOpen() {
    return !el.hidden;
  }

  // Dismiss on outside click or Escape.
  document.addEventListener("pointerdown", (e) => {
    if (!el.hidden && !el.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) close();
  });

  return { open, close, isOpen };
}
