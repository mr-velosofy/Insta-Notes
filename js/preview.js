/**
 * preview.js — scene rendering on a 1080x360 <canvas>.
 *
 * Simple green voice-note layout. No glass effects, shadows, glows,
 * fade-in/out or zoom animations — only the progress + timer advance.
 *
 *   ┌─────── light-green background ─────────────────────────────────────┐
 *   │      ╭─── white voice-note bubble (960 x 170) ────────────────────╮│
 *   │      │  ● Avatar   ▌ ▌ ▌ ▌ ▌│ ▌ · · ▌ ▌ ▌           0:05         ││
 *   │      ╰────────────────────────────────────────────────────────────╯│
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * THE CANVAS IS THE SINGLE SOURCE OF TRUTH. It is shown to the user (CSS
 * scaled) AND is the captureStream() input, so preview == export pixels.
 */

import { Timeline, DURATION, WIDTH, HEIGHT } from "./timeline.js";

export const AVATAR_URL = "/assets/insta-default.jpg";

// Bubble layout (px).
const BUBBLE_W = 960;
const BUBBLE_H = 210;
const BUBBLE_PAD = 40;
const BUBBLE_R = 44;            // bubble corner radius
const AVATAR_R = 50;            // avatar radius (100px circle)
const AVATAR_GAP = 28;          // gap between avatar and waveform
export const WAVE_BARS = 40;    // number of waveform bars (time slices)
const BAR_WIDTH_FRAC = 0.5;     // bar width as a fraction of one slot
const BAR_RADIUS = 4;           // waveform bar corner radius
const TIMER_W = 96;             // reserved width for the time readout
const TIME_FONT = 26;           // time text font size
const PLAYHEAD_W = 8;           // playhead divider thickness
const PLAYHEAD_OVER = 12;       // playhead extension above/below the bars

// "Green Forest" palette.
const GREEN_BG = "#071207";       // background
const BUBBLE_COLOR = "#163820";   // bubble fill (no border)
const PLAYED = "#A8E6CF";         // played bars / divider / timer
const REMAINING = "#2D5A3D";      // unplayed bars

/**
 * Predefined themes. User picks one (see app.js theme picker); selection is
 * persisted to localStorage. Each theme drives the canvas fill colors so the
 * preview and exported video share the exact same look (WYSIWYG).
 */
export const THEMES = [
  {
    id: "green-forest",
    name: "Green Forest",
    bg: GREEN_BG,
    bubble: BUBBLE_COLOR,
    played: PLAYED,
    remaining: REMAINING,
    timer: PLAYED,
  },
  {
    id: "dark-neon",
    name: "Dark Neon",
    bg: "#0b0712",
    bubble: "#1c1433",
    played: "#ff5f8f",
    remaining: "#4b3a6b",
    timer: "#ff5f8f",
  },
  {
    id: "light-pastel",
    name: "Light Pastel",
    bg: "#f6f1fa",
    bubble: "#e7def2",
    played: "#7c5cbf",
    remaining: "#c9bde0",
    timer: "#7c5cbf",
  },
  {
    id: "warm-sunset",
    name: "Warm Sunset",
    bg: "#2a0d10",
    bubble: "#4a1c1e",
    played: "#ffb16b",
    remaining: "#8a4a3a",
    timer: "#ffb16b",
  },
];
const DEFAULT_THEME = THEMES[0];

// Custom theme support: the user picks three colors (background, bubble,
// accent) that persist to localStorage and merge into a full palette. The
// "remaining" bar color is derived by blending the accent toward the bubble.
export const CUSTOM_THEME_KEY = "inote-custom-theme";
const CUSTOM_DEFAULTS = { bg: GREEN_BG, bubble: BUBBLE_COLOR, played: PLAYED };

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = pa >> 16, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = pb >> 16, bg2 = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg2 - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return "#" + [r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function rgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`;
}

/** Build a full palette object from the three user-picked colors. */
export function makeCustomTheme(bg, bubble, played) {
  return {
    id: "custom",
    name: "Custom",
    bg,
    bubble,
    played,
    remaining: mixHex(played, bubble, 0.55),
    timer: played,
  };
}

/** Read the user's custom palette from localStorage (or a sensible default). */
export function customTheme() {
  let c = CUSTOM_DEFAULTS;
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_THEME_KEY) || "null");
    if (raw && raw.bg && raw.bubble && raw.played) c = raw;
  } catch (e) { /* corrupted value — fall back to defaults */ }
  return makeCustomTheme(c.bg, c.bubble, c.played);
}

export class Preview {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{audio?: {el: HTMLMediaElement, play: function, stop: function}, metrics?: object}} io
   * @param {{duration?: number}} opts
   */
  constructor(canvas, io, { duration = DURATION, theme = DEFAULT_THEME, onDone = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.audio = io.audio || null;
    this.metrics = io.metrics || null;
    this.onDone = onDone;

    this.avatarImg = new Image();
    this.avatarImg.src = AVATAR_URL;

    this.theme = theme;

    // Volume envelope of the current audio track (0..1 per bar/time slice).
    // Set via setWaveform() once the real audio buffer is decoded; until then
    // a neutral static fallback is shown.
    this._bars = this._buildWaveform(WAVE_BARS);

    this.timeline = new Timeline({
      duration,
      onFrame: (t) => this._apply(t),
      onStart: () => this._onStart(),
      onComplete: () => this._onComplete(),
    });
  }

  /**
   * Set the real volume envelope (one amplitude 0..1 per bar) computed from
   * the decoded audio buffer. quiet audio -> small bars, loud -> tall bars.
   * @param {number[]} amps
   */
  /**
   * Apply a theme by id (see THEMES). Re-renders immediately so the preview
   * updates live (WYSIWYG). Falls back to the default theme if unknown.
   * @param {string} id
   */
  setTheme(id) {
    const t = id === "custom" ? customTheme() : THEMES.find((th) => th.id === id) || DEFAULT_THEME;
    // For custom the id never changes, so compare the actual colors to detect
    // a live color edit; for presets the id is enough.
    const changed =
      id === "custom"
        ? t.bg !== this.theme.bg || t.bubble !== this.theme.bubble || t.played !== this.theme.played
        : t.id !== this.theme.id;
    if (changed) {
      this.theme = t;
      this._apply(this.timeline.passed);
    }
  }

  /**
   * Replace the avatar image (e.g. user-dropped photo). On load error the
   * avatar silently reverts to the default. Returns a Promise<void>.
   * @param {string} url
   */
  setAvatar(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.addEventListener(
        "load",
        () => {
          this.avatarImg = img;
          this._apply(this.timeline.passed);
          resolve();
        },
        { once: true }
      );
      img.addEventListener(
        "error",
        () => {
          this.avatarImg.src = AVATAR_URL;
          this._apply(this.timeline.passed);
          resolve();
        },
        { once: true }
      );
      img.src = url;
    });
  }

  setWaveform(amps) {
    if (Array.isArray(amps) && amps.length === WAVE_BARS) this._bars = amps;
  }

  _buildWaveform(n) {
    const amps = [];
    for (let i = 0; i < n; i++) {
      const v =
        Math.abs(Math.sin(i * 0.62)) * 0.55 +
        Math.abs(Math.sin(i * 1.31 + 1.7)) * 0.3 +
        Math.abs(Math.sin(i * 3.7 + 0.6)) * 0.15;
      amps.push(0.25 + 0.75 * Math.min(v, 1));
    }
    return amps;
  }

  /** Change scene duration (e.g. to match an uploaded audio track). */
  setDuration(seconds) {
    this.timeline.duration = seconds;
  }

  get duration() {
    return this.timeline.duration;
  }

  async loadAssets() {
    const t0 = performance.now();
    await Promise.all([
      this._load(this.avatarImg),
    ]);
    const loadMs = performance.now() - t0;

    if (this.metrics) {
      this.metrics.record("Asset loading time", `${loadMs.toFixed(1)} ms`);
    }

    this._apply(0);
  }

  _load(img) {
    return new Promise((resolve, reject) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => reject(new Error(`Failed to load ${img.src}`)), { once: true });
    });
  }

  play() {
    this.timeline.start();
  }

  /** Pause playback, keeping the current position (resume() continues). */
  pause() {
    this.timeline.pause();
    if (this.audio) this.audio.stop();
  }

  /** Resume playback from the paused/held position. */
  resume() {
    this.timeline.resume();
    if (this.audio) this.audio.resume();
  }

  /** Stop and rewind to the start (next play() begins from 0). */
  reset() {
    this.timeline.reset();
    if (this.audio) this.audio.stop();
  }

  stop() {
    this.timeline.stop();
    if (this.audio) this.audio.stop();
  }

  _onStart() {
    this._apply(0);
    if (this.audio) this.audio.play();
  }

  _apply(t) {
    const p = t / this.timeline.duration; // 0 -> 1

    this._drawBackground();
    this._drawBubble(p, t);

    if (this.metrics) this.metrics.tick(t);
  }

  /* ------------------------------------------------------------------ */
  /* Background (simple flat green)                                      */
  /* ------------------------------------------------------------------ */

  _drawBackground() {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  /* ------------------------------------------------------------------ */
  /* Voice-note bubble (flat white card)                                 */
  /* ------------------------------------------------------------------ */

  _drawBubble(p, t) {
    const ctx = this.ctx;

    const bx = (WIDTH - BUBBLE_W) / 2;
    const by = (HEIGHT - BUBBLE_H) / 2;

    this._drawBubbleSurface(bx, by);

    const rowCx = by + BUBBLE_H / 2;
    const padL = bx + BUBBLE_PAD;
    const padR = bx + BUBBLE_W - BUBBLE_PAD;

    const avatarCx = padL + AVATAR_R;
    const waveEndX = padR - TIMER_W;
    const waveStartX = avatarCx + AVATAR_R + AVATAR_GAP;

    this._drawAvatar(avatarCx, rowCx);
    this._drawWaveform(p, waveStartX, waveEndX, rowCx);

    const secs = Math.max(0, Math.ceil(this.timeline.duration - t));
    const mm = Math.floor(secs / 60).toString().padStart(2, "0");
    const ss = (secs % 60).toString().padStart(2, "0");
    this._drawTime(`${mm}:${ss}`, padR, rowCx);
  }

  _drawBubbleSurface(x, y) {
    const ctx = this.ctx;
    this._roundRect(x, y, BUBBLE_W, BUBBLE_H, BUBBLE_R);
    ctx.fillStyle = this.theme.bubble;
    ctx.fill();
  }

  _drawAvatar(cx, cy) {
    const ctx = this.ctx;
    const r = AVATAR_R;

    // Circular avatar image only (no ring/border).
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const imgA = this.avatarImg.naturalWidth / this.avatarImg.naturalHeight;
    let sw = 2 * r, sh = 2 * r;
    if (imgA > 1) sw = sh * imgA; else sh = sw / imgA;
    ctx.drawImage(this.avatarImg, cx - sw / 2, cy - sh / 2, sw, sh);
    ctx.restore();
  }

  _drawWaveform(p, startX, endX, cy) {
    const ctx = this.ctx;
    const n = this._bars.length;
    const step = (endX - startX) / n;
    const barW = step * BAR_WIDTH_FRAC;
    const maxH = BUBBLE_H - BUBBLE_PAD * 2 - 12;
    const playheadX = startX + (endX - startX) * p;
    const playedFrac = Math.min(1, Math.max(0, p));
    const amps = this._bars;

    for (let i = 0; i < n; i++) {
      // Never let a bar shrink below its full-cap diameter, otherwise the
      // rounded caps collapse and it renders as an oval instead of a pill.
      const h = Math.max(amps[i] * maxH, BAR_RADIUS * 2);
      const x = startX + i * step + (step - barW) / 2;
      const y = cy - h / 2;
      const frac = (i + 0.5) / n;

      this._roundRect(x, y, barW, h, BAR_RADIUS);
      ctx.fillStyle = frac <= playedFrac ? this.theme.played : this.theme.remaining;
      ctx.fill();
    }

    // Vertical playhead divider, thicker and taller than the bars.
    const phy0 = cy - maxH / 2 - PLAYHEAD_OVER;
    const phy1 = cy + maxH / 2 + PLAYHEAD_OVER;
    ctx.beginPath();
    ctx.moveTo(playheadX, phy0);
    ctx.lineTo(playheadX, phy1);
    ctx.strokeStyle = this.theme.played;
    ctx.lineWidth = PLAYHEAD_W;
    ctx.lineCap = "round";
    ctx.shadowColor = rgba(this.theme.played, 0.45);
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _drawTime(text, rightX, cy) {
    const ctx = this.ctx;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${TIME_FONT}px 'Segoe UI', system-ui, sans-serif`;
    ctx.fillStyle = this.theme.timer;
    ctx.fillText(text, rightX, cy);
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _onComplete() {
    if (this.audio) this.audio.stop();
    if (this.onDone) this.onDone();
  }
}