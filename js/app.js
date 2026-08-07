/**
 * app.js — entry point + orchestration (PROD).
 *
 * User-facing features: theme picker + avatar drop (customize), upload audio +
 * microphone recording (audio source), a trim panel with a 3-minute cap, and
 * WebM/MP4 export. The scene canvas is the single source of truth (preview ==
 * export). Projects (audio blob + trim range) persist to IndexedDB; theme
 * persists to localStorage.
 *
 * Adapted from the debugged sample/ build for the production UI (studio.html):
 * icon-based play/pause button, restart control, reset/remove-project actions,
 * and a debug metrics panel gated behind ?debug=1.
 */

import { Preview, THEMES, WAVE_BARS, AVATAR_URL, customTheme, CUSTOM_THEME_KEY } from "./preview.js";
import { Recorder } from "./recorder.js";
import { createColorPicker } from "./colorpicker.js";
import { DURATION, WIDTH } from "./timeline.js";

const MAX_DURATION = 180; // 3:00 export cap (seconds)
const MAX_SOURCE_DURATION = 600; // 10:00 max load/record (seconds)
const MAX_SOURCE_LABEL = "10 minutes";
const LS_THEME = "inote-theme";
const DEBUG = new URLSearchParams(location.search).has("debug");

const els = {
  scene: document.getElementById("scene"),
  avatarBox: document.getElementById("avatar-box"),
  avatarPreview: document.getElementById("avatar-preview"),
  avatarInput: document.getElementById("avatar-input"),
  avatarReset: document.getElementById("avatar-reset"),
  themePicker: document.getElementById("theme-picker"),
  themeCurrent: null,
  themeName: null,
  themeMenu: null,
  themeCustom: document.getElementById("theme-custom"),
  uploadBtn: document.getElementById("upload-btn"),
  recordBtn: document.getElementById("record-btn"),
  audioInput: document.getElementById("audio-input"),
  audioInfo: document.getElementById("audio-info"),
  audioDuration: document.getElementById("audio-duration"),
  activeFile: document.getElementById("active-file"),
  fileRemove: document.getElementById("file-remove"),
  trimWave: document.getElementById("trim-wave"),
  trimSkeleton: document.getElementById("trim-skeleton"),
  trimSelected: document.getElementById("trim-duration-selected"),
  trimStart: document.getElementById("trim-start"),
  trimEnd: document.getElementById("trim-end"),
  trimReset: document.getElementById("trim-reset"),
  playBtn: document.getElementById("play-btn"),
  playIcon: document.getElementById("play-icon"),
  playLabel: document.getElementById("play-label"),
  generateBtn: document.getElementById("generate-btn"),
  generateFill: document.getElementById("generate-fill"),
  generateLabel: document.getElementById("generate-label"),
  cancelBtn: document.getElementById("cancel-btn"),
  resetBtn: document.getElementById("reset-btn"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  toast: document.getElementById("toast"),
  busyWarning: document.getElementById("busy-warning"),
  stepAudio: document.getElementById("step-audio"),
  stepTrim: document.getElementById("step-trim"),
  metrics: document.getElementById("metrics"),
  metricsList: document.getElementById("metrics-list"),
  metricsToggle: document.getElementById("metrics-toggle"),
  unsupported: document.getElementById("unsupported"),
};

function setStatus(state, text) {
  els.statusDot.className = state ? `recording ${state}` : "";
  els.statusText.textContent = text;
}

let toastTimer = null;

/** Transient error popup that auto-hides after a few seconds. */
function showToast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 4000);
}

/** Toggle the skeleton shimmer over the trim wave while audio loads. The
 *  previous waveform fades out so the swap doesn't flash the old bars. */
function setTrimSkeleton(show) {
  const sk = els.trimSkeleton;
  if (!sk) return;
  if (show && !sk.dataset.ready) {
    sk.dataset.ready = "1";
    sk.innerHTML = "<i></i>".repeat(32);
  }
  sk.hidden = !show;
  els.trimWave.classList.toggle("trim-wave-loading", show);
}

/** Read a CSS custom property set by /js/theme.js, with a fallback. */
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`;

/** Swap the play/pause icon + label on the Preview button. */
function setPlayLabel(playing) {
  els.playIcon.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  els.playLabel.textContent = playing ? "Pause" : "Preview";
  els.playBtn.setAttribute("aria-label", playing ? "Pause preview" : "Play preview");
}

/** Toggle the record action-card title between record / stop and give the
 *  card a distinct "recording" look (red ring + pulsing dot). */
function setRecordLabel(recording) {
  const title = els.recordBtn.querySelector(".action-title");
  if (title) title.textContent = recording ? "Stop Recording" : "Record Voice Note";
  els.recordBtn.classList.toggle("recording", recording);
}

/**
 * Drive the generate progress inside the button itself.
 * @param {number|null} pct 0..100 fills the button with color; -1 for an
 *                          indeterminate (sweeping) state; null resets it.
 */
function setProgress(pct) {
  const fill = els.generateFill;
  if (pct === null || pct === undefined) {
    fill.classList.remove("indeterminate");
    fill.style.width = "0%";
    return;
  }
  if (pct < 0) {
    fill.style.width = "30%";
    fill.classList.add("indeterminate");
    return;
  }
  fill.classList.remove("indeterminate");
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

/** Set the text shown inside the generate button. */
const GEN_ICON_BY_LABEL = {
  "Generate": "generate",
  "Preparing…": "preparing",
  "Recording…": "recording",
  "Converting…": "converting",
  "Download": "download",
};

function setGenerateLabel(text) {
  els.generateLabel.textContent = text;
  els.generateBtn.dataset.icon = GEN_ICON_BY_LABEL[text] || "generate";
}

/** Show/hide the red "don't switch tabs / close the browser" warning. */
function setBusyWarning(show) {
  if (els.busyWarning) els.busyWarning.classList.toggle("busy-warning-visible", show);
}

/** Show/hide the X button next to Generate while rendering. The width and
 *  opacity are transitioned in CSS so the row reflows smoothly. */
function setCancelVisible(show) {
  if (els.cancelBtn) els.cancelBtn.classList.toggle("show", show);
}

/** A change to the scene (trim / theme / avatar) invalidates the last MP4. */
function invalidateGenerated() {
  lastMp4 = null;
  els.generateBtn.classList.remove("ready");
  if (!busy) setGenerateLabel("Generate");
  setProgress(null);
}

const metrics = {
  items: [],
  record(label, value) {
    this.items.push({ label, value });
    this.render();
  },
  tick(_t) {},
  render() {
    // Debug-only panel: only rendered when opened via ?debug=1.
    if (this.items.length === 0 || !DEBUG) return;
    els.metrics.classList.remove("hidden");
    els.metricsList.innerHTML = this.items
      .map((m) => `<li>${m.label}: <b>${m.value}</b></li>`)
      .join("");
  },
};

let preview;
let recorder;
let busy = false;
let cancelRequested = false;
let currentDuration = DURATION;
let lastMp4 = null;
let fileName = "demo.mp3";

// Full decoded audio (up to MAX_SOURCE_DURATION) + the active trim range.
let sourceBuffer = null; // AudioBuffer (full, capped)
let trim = { start: 0, end: 0 };
let sourceBlob = null; // compact original blob (for persistence / restore)
let sourceEnvelope = []; // waveform for the trim display

/* ------------------------------------------------------------------
   AUDIO
   ------------------------------------------------------------------ */
const audio = (() => {
  const el = new Audio("/assets/demo.mp3");
  el.loop = true;
  return {
    el,
    play() { el.currentTime = 0; el.play().catch(() => {}); },
    resume() { el.play().catch(() => {}); },
    stop() { el.pause(); },
  };
})();

// One MediaElementSource per element, reused across recordings so the
// browser does not throw "already connected to a different source node".
let audioCapture = null;
function ensureAudioCapture() {
  if (audioCapture) return audioCapture;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createMediaElementSource(audio.el);
  const gain = ctx.createGain();
  gain.gain.value = 1;
  src.connect(dest); // -> recording track
  src.connect(gain);
  gain.connect(ctx.destination); // -> speakers (silence during render)
  audioCapture = {
    ctx,
    track: dest.stream.getAudioTracks()[0],
    setAudible(on) {
      gain.gain.value = on ? 1 : 0;
    },
  };
  return audioCapture;
}

/** Encode an AudioBuffer to a 16-bit PCM WAV Blob (universal playback). */
function audioBufferToWav(buffer) {
  const numCh = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numCh * 2;
  const dataView = new DataView(new ArrayBuffer(44 + length));

  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) dataView.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  dataView.setUint32(4, 36 + length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dataView.setUint32(16, 16, true);
  dataView.setUint16(20, 1, true);
  dataView.setUint16(22, numCh, true);
  dataView.setUint32(24, sampleRate, true);
  dataView.setUint32(28, sampleRate * numCh * 2, true);
  dataView.setUint16(32, numCh * 2, true);
  dataView.setUint16(34, 16, true);
  writeStr(36, "data");
  dataView.setUint32(40, length, true);

  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      dataView.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([dataView.buffer], { type: "audio/wav" });
}

/**
 * Compute a volume envelope from a decoded AudioBuffer: one RMS amplitude
 * (0..1) per time bucket, normalized so the loudest bucket is ~1. Quiet
 * audio yields a near-"dot" bar; louder audio yields taller bars.
 */
function audioVolumeEnvelope(buffer, buckets) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const per = len / buckets;
  const data = new Array(buckets).fill(0);

  for (let i = 0; i < buckets; i++) {
    const s0 = Math.floor(i * per);
    const s1 = Math.max(s0 + 1, Math.floor((i + 1) * per));
    let sum = 0, count = 0;
    for (let c = 0; c < ch; c++) {
      const arr = buffer.getChannelData(c);
      for (let s = s0; s < s1; s++) {
        const v = arr[s];
        sum += v * v;
        count++;
      }
    }
    data[i] = Math.sqrt(sum / count);
  }

  let peak = 0;
  for (const v of data) if (v > peak) peak = v;
  if (peak <= 0) peak = 1;

  return data.map((v) => 0.06 + 0.94 * Math.min(v / peak, 1));
}

/** Chunked variant of audioVolumeEnvelope: yields to the event loop every few
 *  buckets so the UI (e.g. the skeleton shimmer) stays responsive on long
 *  sources instead of freezing during the full pass. */
async function audioVolumeEnvelopeAsync(buffer, buckets) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const per = len / buckets;
  const data = new Array(buckets).fill(0);

  for (let i = 0; i < buckets; i++) {
    if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    const s0 = Math.floor(i * per);
    const s1 = Math.max(s0 + 1, Math.floor((i + 1) * per));
    let sum = 0, count = 0;
    for (let c = 0; c < ch; c++) {
      const arr = buffer.getChannelData(c);
      for (let s = s0; s < s1; s++) {
        const v = arr[s];
        sum += v * v;
        count++;
      }
    }
    data[i] = Math.sqrt(sum / count);
  }

  let peak = 0;
  for (const v of data) if (v > peak) peak = v;
  if (peak <= 0) peak = 1;

  return data.map((v) => 0.06 + 0.94 * Math.min(v / peak, 1));
}

/** Shared AudioContext for creating AudioBuffers (avoid context limits). */
let sharedCtx = null;
function bufferCtx() {
  if (!sharedCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedCtx = new Ctx();
  }
  return sharedCtx;
}

/** Offline context used only for decoding: decodeAudioData runs off the main
 *  thread here, keeping the UI (skeleton shimmer, etc.) smooth on long files. */
let offlineDecodeCtx = null;
function offlineDecode() {
  if (!offlineDecodeCtx) offlineDecodeCtx = new OfflineAudioContext(1, 1, 44100);
  return offlineDecodeCtx;
}

/** Return a copy of `buffer` covering [startSec, endSec]. */
function sliceBuffer(buffer, startSec, endSec) {
  const sr = buffer.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(buffer.length, Math.floor(endSec * sr));
  const out = bufferCtx().createBuffer(
    buffer.numberOfChannels,
    Math.max(1, s1 - s0),
    sr
  );
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.copyToChannel(buffer.getChannelData(c).subarray(s0, s1), c);
  }
  return out;
}

function fmtTime(secs) {
  secs = Math.max(0, Math.round(secs));
  const mm = Math.floor(secs / 60).toString().padStart(2, "0");
  const ss = (secs % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Format a (possibly fractional) duration to 2 decimal places, e.g. 2.03. */
function fmtDur(secs) {
  return (Number(secs) || 0).toFixed(2);
}

/* ------------------------------------------------------------------
   TRIM
   ------------------------------------------------------------------ */
function clampTrim() {
  if (!sourceBuffer) return;
  const total = sourceBuffer.duration;
  let s = Number(trim.start) || 0;
  let e = Number(trim.end) || total;
  s = Math.max(0, Math.min(s, total - 0.5));
  e = Math.min(total, Math.max(e, s + 0.5));
  // Export length is capped at MAX_DURATION: pull the window back to fit.
  if (e - s > MAX_DURATION) {
    s = Math.max(0, e - MAX_DURATION);
    e = Math.min(total, s + MAX_DURATION);
  }
  trim.start = s;
  trim.end = e;
}

/** Apply the active trim to the preview + playback audio (live apply). */
function applyTrim() {
  if (!sourceBuffer) return;
  clampTrim();
  invalidateGenerated();

  const sliced = sliceBuffer(sourceBuffer, trim.start, trim.end);
  currentDuration = sliced.duration;
  if (preview) {
    preview.setDuration(currentDuration);
    preview.setWaveform(audioVolumeEnvelope(sliced, WAVE_BARS));
    // Any trim change restarts the preview from the beginning.
    preview.reset();
    setPlayLabel(false);
    setSourceLocked(false);
  }
  audio.el.src = URL.createObjectURL(audioBufferToWav(sliced));
  audio.el.currentTime = 0;

  projectStore.save({
    sourceBlob,
    fileName,
    trim: { start: trim.start, end: trim.end },
  }).catch(() => {});

  updateTrimUI();
  els.audioInfo.textContent = fileName;
  els.audioDuration.textContent = fmtTime(sourceBuffer.duration);
}

function resetTrim() {
  if (!sourceBuffer) return;
  trim.start = 0;
  trim.end = Math.min(sourceBuffer.duration, MAX_DURATION);
  applyTrim();
}

function updateTrimUI() {
  const total = sourceBuffer.duration;
  els.trimStart.max = Math.floor(total);
  els.trimEnd.max = Math.floor(total);
  els.trimStart.value = Math.max(0, +fmtDur(trim.start));
  els.trimEnd.value = +fmtDur(trim.end);
  els.trimSelected.textContent = fmtTime(trim.end - trim.start);
  drawTrimWave();
}

/* --- trim waveform + drag handles (pointer events: mouse + touch) --- */
// Envelope is computed at a fixed high resolution; the bar count is derived
// from the canvas width at draw time (see drawTrimWave).
const TRIM_BARS = 256;
const INSTA_GRADIENT_STOPS = ["#feda75", "#fa7e1e", "#d62976", "#962fbf", "#4f5bd5"];

function drawTrimWave() {
  const c = els.trimWave;
  const dpr = window.devicePixelRatio || 1;
  const bw = c.clientWidth || 640;
  const bh = c.clientHeight || 72;
  if (c.width !== Math.round(bw * dpr)) c.width = Math.round(bw * dpr);
  if (c.height !== Math.round(bh * dpr)) c.height = Math.round(bh * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, bw, bh);

  const padL = 6, padR = 6;
  const innerW = bw - padL - padR;
  const center = bh / 2;
  const maxH = bh - 18;

  const total = sourceBuffer ? sourceBuffer.duration : 1;
  const sX = padL + (trim.start / total) * innerW;
  const eX = padL + (trim.end / total) * innerW;

  // Bar count adapts to the available width (~5px per bar) so bars stay slim
  // on wide screens; mobile keeps roughly today's count. Aggregated down from
  // the high-res envelope.
  const envLen = sourceEnvelope.length || TRIM_BARS;
  const n = Math.max(24, Math.min(envLen, Math.floor(innerW / 5)));
  const envPerBar = envLen / n;
  const step = innerW / n;
  const barW = Math.max(1, step * 0.5);
  const ctxBars = ctx;
  const selGrad = ctx.createLinearGradient(padL, 0, padL + innerW, 0);
  INSTA_GRADIENT_STOPS.forEach((c, idx) => {
    selGrad.addColorStop(idx / (INSTA_GRADIENT_STOPS.length - 1), c);
  });
  for (let i = 0; i < n; i++) {
    const frac = (i + 0.5) / n;
    const x = padL + i * step + (step - barW) / 2;
    let ampSum = 0;
    const s0 = Math.floor(i * envPerBar);
    const s1 = Math.max(s0 + 1, Math.floor((i + 1) * envPerBar));
    for (let j = s0; j < s1; j++) ampSum += sourceEnvelope[j] || 0;
    const amp = s1 > s0 ? ampSum / (s1 - s0) : 0.3;
    const h = Math.max(3, amp * maxH);
    const y = center - h / 2;
    const selected = frac >= trim.start / total && frac <= trim.end / total;
    ctxBars.fillStyle = selected
      ? selGrad
      : cssVar("--trim-dim", "rgba(17, 24, 39, 0.12)");
    const r = Math.min(barW / 2, h / 2);
    ctxBars.beginPath();
    ctxBars.roundRect(x, y, barW, h, r);
    ctxBars.fill();
  }

  // Start / end handles — both use the Instagram pink accent.
  drawHandle(ctx, sX, bh, cssVar("--brand-orange", "#d62976"));
  drawHandle(ctx, eX, bh, cssVar("--brand-orange", "#d62976"));
}

function drawHandle(ctx, x, bh, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 4);
  ctx.lineTo(x, bh - 4);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, 8, 6, 0, Math.PI * 2);
  ctx.fill();
}

let dragHandle = null; // "start" | "end" | null

function xToTime(clientX) {
  const rect = els.trimWave.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return (x || 0) * (sourceBuffer ? sourceBuffer.duration : 1);
}

function onTrimPointerDown(e) {
  if (!sourceBuffer) return;
  e.preventDefault();
  const t = xToTime(e.clientX);
  const total = sourceBuffer.duration;
  const ds = Math.abs(t - trim.start);
  const de = Math.abs(t - trim.end);
  dragHandle = ds < de ? "start" : "end";
  els.trimWave.setPointerCapture(e.pointerId);
}

function onTrimPointerMove(e) {
  if (!dragHandle || !sourceBuffer) return;
  const t = xToTime(e.clientX);
  const total = sourceBuffer.duration;
  if (dragHandle === "start") {
    // Keep the selection within the 3-minute export window.
    trim.start = Math.max(
      Math.max(0, trim.end - MAX_DURATION),
      Math.min(trim.end - 0.5, t)
    );
  } else {
    trim.end = Math.min(
      total,
      Math.max(trim.start + 0.5, Math.min(trim.start + MAX_DURATION, t))
    );
  }
  els.trimStart.value = +fmtDur(Math.max(0, trim.start));
  els.trimEnd.value = +fmtDur(trim.end);
  els.trimSelected.textContent = fmtTime(trim.end - trim.start);
  drawTrimWave();
}

function onTrimPointerUp(e) {
  if (!dragHandle) return;
  dragHandle = null;
  try { els.trimWave.releasePointerCapture(e.pointerId); } catch (_) {}
  applyTrim();
}

/* ------------------------------------------------------------------
   THEME
   ------------------------------------------------------------------ */
function themePreviewHtml(t) {
  return `<i style="background:${t.bg}"></i><i style="background:${t.bubble}"></i><i style="background:${t.played}"></i>`;
}

function buildThemePicker() {
  const saved = localStorage.getItem(LS_THEME) || THEMES[0].id;
  const initial = saved === "custom" ? customTheme() : THEMES.find((t) => t.id === saved) || THEMES[0];
  els.themePicker.classList.add("theme-dropdown");
  els.themePicker.innerHTML = `
    <button type="button" class="theme-current" aria-haspopup="listbox">
      <span class="th-preview" id="theme-current-swatches">${themePreviewHtml(initial)}</span>
      <span class="theme-name" id="theme-current-name">${initial.name}</span>
      <span class="theme-caret">▾</span>
    </button>
    <div class="theme-menu hidden" id="theme-menu"></div>`;
  els.themeCurrent = els.themePicker.querySelector(".theme-current");
  els.themeName = els.themePicker.querySelector("#theme-current-name");
  els.themeMenu = els.themePicker.querySelector("#theme-menu");

  const currentSwatches = els.themePicker.querySelector("#theme-current-swatches");

  // Custom-theme slot state (bg / bubble / played) + the swatch buttons.
  const slotKeys = ["bg", "bubble", "played"];
  const customSwatchButtons = {};
  els.themeCustom.querySelectorAll(".color-swatch").forEach((btn) => {
    customSwatchButtons[btn.dataset.slot] = btn;
  });
  let activeSlot = "bg";
  let currentCustom = { bg: customTheme().bg, bubble: customTheme().bubble, played: customTheme().played };

  function renderSwatches() {
    slotKeys.forEach((k) => {
      const btn = customSwatchButtons[k];
      if (!btn) return;
      btn.style.setProperty("--swatch", currentCustom[k]);
      const hexEl = btn.closest(".custom-slot").querySelector(".custom-slot-hex");
      if (hexEl) hexEl.textContent = currentCustom[k].toUpperCase();
    });
  }

  function updateCustomSwatches() {
    const t = customTheme();
    currentSwatches.innerHTML = themePreviewHtml(t);
    els.themeName.textContent = t.name;
    customOption.querySelector(".th-preview").innerHTML = themePreviewHtml(t);
  }

  function select(id) {
    const t = id === "custom" ? customTheme() : THEMES.find((x) => x.id === id) || THEMES[0];
    invalidateGenerated();
    localStorage.setItem(LS_THEME, t.id);
    els.themeName.textContent = t.name;
    currentSwatches.innerHTML = themePreviewHtml(t);
    if (id === "custom") {
      els.themeCustom.classList.add("open");
      currentCustom = { bg: t.bg, bubble: t.bubble, played: t.played };
      renderSwatches();
    } else {
      els.themeCustom.classList.remove("open");
    }
    if (preview) {
      preview.setTheme(t.id);
      drawTrimWave();
    }
    // Refresh the scene CSS vars (--scene-*). UI colors are mode-only, so this
    // never recolors the chrome.
    if (typeof window.applyInoteTheme === "function") window.applyInoteTheme();
    [...els.themeMenu.querySelectorAll(".theme-option")].forEach((o) => {
      const check = o.querySelector(".theme-check");
      check.textContent = o.dataset.id === t.id ? "✓" : "";
    });
  }

  // Live-apply a color-slot change: persist + re-paint the scene.
  function applyCustomColors() {
    invalidateGenerated();
    localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(currentCustom));
    localStorage.setItem(LS_THEME, "custom");
    if (preview) {
      preview.setTheme("custom");
      drawTrimWave();
    }
    if (typeof window.applyInoteTheme === "function") window.applyInoteTheme();
    updateCustomSwatches();
    [...els.themeMenu.querySelectorAll(".theme-option")].forEach((o) => {
      const check = o.querySelector(".theme-check");
      check.textContent = o.dataset.id === "custom" ? "✓" : "";
    });
  }

  THEMES.forEach((t) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "theme-option";
    opt.dataset.id = t.id;
    opt.setAttribute("role", "option");
    opt.innerHTML = `
      <span class="th-preview">${themePreviewHtml(t)}</span>
      <span class="theme-name">${t.name}</span>
      <span class="theme-check">${t.id === saved ? "✓" : ""}</span>`;
    opt.addEventListener("click", () => {
      select(t.id);
      closeThemeMenu();
    });
    els.themeMenu.appendChild(opt);
  });

  // "Custom" option: user picks their own three colors (see the slot editor).
  const customOption = document.createElement("button");
  customOption.type = "button";
  customOption.className = "theme-option";
  customOption.dataset.id = "custom";
  customOption.setAttribute("role", "option");
  customOption.innerHTML = `
    <span class="th-preview">${themePreviewHtml(customTheme())}</span>
    <span class="theme-name">Custom</span>
    <span class="theme-check">${saved === "custom" ? "✓" : ""}</span>`;
  customOption.addEventListener("click", () => {
    select("custom");
    closeThemeMenu();
  });
  els.themeMenu.appendChild(customOption);

  // Custom color picker — clicking a swatch opens it; changes apply live.
  const picker = createColorPicker({
    onChange: (hex) => {
      currentCustom[activeSlot] = hex;
      renderSwatches();
      applyCustomColors();
    },
    onCommit: () => {},
  });

  slotKeys.forEach((k) => {
    customSwatchButtons[k].addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activeSlot = k;
      picker.open(customSwatchButtons[k], currentCustom[k]);
    });
  });

  if (saved === "custom") {
    const t = customTheme();
    els.themeCustom.classList.add("open");
    currentCustom = { bg: t.bg, bubble: t.bubble, played: t.played };
    renderSwatches();
  }

  function closeThemeMenu() {
    els.themeMenu.classList.add("hidden");
    els.themeCurrent.setAttribute("aria-expanded", "false");
  }

  els.themeCurrent.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = els.themeMenu.classList.contains("hidden");
    els.themeMenu.classList.toggle("hidden", !isHidden);
    els.themeCurrent.setAttribute("aria-expanded", String(isHidden));
  });

  document.addEventListener("click", (e) => {
    if (!els.themePicker.contains(e.target)) closeThemeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeThemeMenu();
  });
}

/* ------------------------------------------------------------------
   AVATAR
   ------------------------------------------------------------------ */
async function handleAvatarFile(file) {
  if (!file || (file.type && !file.type.startsWith("image/"))) {
    setStatus("", "Please drop an image file.");
    return;
  }
  try {
    const url = URL.createObjectURL(file);
    await preview.setAvatar(url);
    invalidateGenerated();
    els.avatarPreview.src = url;
    els.avatarPreview.classList.remove("hidden");
    await projectStore.saveAvatar(file);
    setStatus("", "Avatar updated");
  } catch (err) {
    console.error(err);
    resetAvatarUI();
    setStatus("", "Could not load that image.");
  }
}
function resetAvatarUI() {
  els.avatarPreview.src = AVATAR_URL;
  els.avatarPreview.classList.remove("hidden");
  invalidateGenerated();
  if (preview) preview.setAvatar(AVATAR_URL);
  projectStore.clearAvatar().catch(() => {});
}
function wireAvatar() {
  els.avatarBox.addEventListener("click", () => els.avatarInput.click());
  els.avatarInput.addEventListener("change", () => {
    if (els.avatarInput.files && els.avatarInput.files[0]) {
      handleAvatarFile(els.avatarInput.files[0]);
    }
  });
  // Restore the default profile image (removes any custom avatar).
  els.avatarReset.addEventListener("click", () => {
    resetAvatarUI();
    setStatus("", "Default profile image restored");
  });
  // Drag-and-drop (works on desktop; picker is the mobile fallback).
  els.avatarBox.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.avatarBox.style.boxShadow = `0 0 0 2px ${cssVar("--brand-orange", "#f97316")}`;
  });
  els.avatarBox.addEventListener("dragleave", () => {
    els.avatarBox.style.boxShadow = "";
  });
  els.avatarBox.addEventListener("drop", (e) => {
    e.preventDefault();
    els.avatarBox.style.boxShadow = "";
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleAvatarFile(f);
  });
  // Also allow dropping an avatar anywhere on the stage.
  const wrap = document.getElementById("stage-wrap");
  wrap.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  });
  wrap.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleAvatarFile(f);
  });
}

/* ------------------------------------------------------------------
   AUDIO SOURCE LOADING (upload / mic / restore)
   ------------------------------------------------------------------ */
async function decodeBlob(blob) {
  const arrayBuf = await blob.arrayBuffer();
  return offlineDecode().decodeAudioData(arrayBuf);
}

/** Cheap duration probe using the file's metadata only (no full decode).
 *  Resolves true if the audio is definitively longer than the source cap,
 *  false when it's within limits or the duration couldn't be determined.
 *  This runs before any heavy decode so huge files fail fast. */
function probeTooLong(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const au = document.createElement("audio");
    au.preload = "metadata";
    const finish = (tooLong) => {
      clearTimeout(timer);
      au.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(tooLong);
    };
    const timer = setTimeout(() => finish(false), 10000);
    au.addEventListener(
      "loadedmetadata",
      () => {
        const d = au.duration;
        finish(isFinite(d) && d > MAX_SOURCE_DURATION + 0.5);
      },
      { once: true }
    );
    au.addEventListener("error", () => finish(false), { once: true });
    au.src = url;
  });
}

async function loadSourceFromBlob(blob, name, restoreTrim = null) {
  setTrimSkeleton(true);
  try {
    if (await probeTooLong(blob)) {
      setStatus("", `Audio is too long — max ${MAX_SOURCE_LABEL}`);
      showToast(`Audio is longer than ${MAX_SOURCE_LABEL}.`);
      return;
    }

    const decoded = await decodeBlob(blob);

    // Backstop: the metadata probe can misreport for some containers.
    if (decoded.duration > MAX_SOURCE_DURATION + 0.5) {
      setStatus("", `Audio is too long — max ${MAX_SOURCE_LABEL}`);
      showToast(`Audio is longer than ${MAX_SOURCE_LABEL}.`);
      return;
    }
    sourceBlob = blob;
    fileName = name;

    // Files up to MAX_SOURCE_DURATION load in full; the trim window caps the
    // export length at MAX_DURATION.
    sourceBuffer = decoded;
    sourceEnvelope = await audioVolumeEnvelopeAsync(sourceBuffer, TRIM_BARS);

    if (restoreTrim && restoreTrim.end > 0) {
      trim = {
        start: Math.max(0, Math.min(restoreTrim.start, restoreTrim.end - 0.5)),
        end: Math.min(decoded.duration, Math.max(restoreTrim.end, restoreTrim.start + 0.5)),
      };
    } else {
      trim = { start: 0, end: Math.min(decoded.duration, MAX_DURATION) };
    }

    // New audio means the previous generated MP4 is stale — reset it.
    lastMp4 = null;
    els.generateBtn.classList.remove("ready");
    setGenerateLabel("Generate");
    setProgress(null);
    els.stepAudio.classList.add("done");
    els.stepTrim.classList.add("done");
    applyTrim();
    setStatus("", `Audio loaded: ${name}`);
  } catch (err) {
    console.error(err);
    setStatus("", `Audio error: ${err.message}`);
  } finally {
    setTrimSkeleton(false);
  }
}

/* --- microphone recording --- */
let micRec = null; // { stream, recorder, chunks, timer, startTime }

async function toggleRecord() {
  if (micRec) {
    stopRecording();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("", "Microphone not available in this browser.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stopMicStream(stream);
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      clearInterval(micRec && micRec.timer);
      micRec = null;
      setRecordLabel(false);
      setStatus("", "Processing recording…");
      loadSourceFromBlob(blob, "Voice note");
    };
    recorder.start();
    const startTime = Date.now();
    const timer = setInterval(() => {
      const el = (Date.now() - startTime) / 1000;
      setStatus("recording", `Recording… ${fmtTime(el)} (max ${MAX_SOURCE_LABEL})`);
      if (el >= MAX_SOURCE_DURATION) {
        showToast(`Recording reached the ${MAX_SOURCE_LABEL} limit.`);
        stopRecording();
      }
    }, 250);
    micRec = { stream, recorder, chunks, timer, startTime };
    setRecordLabel(true);
    setStatus("recording", "Recording…");
  } catch (err) {
    console.error(err);
    setStatus("", "Microphone permission denied or unavailable.");
  }
}

function stopRecording() {
  if (!micRec) return;
  if (micRec.recorder.state !== "inactive") micRec.recorder.stop();
}

function stopMicStream(stream) {
  (stream.getTracks() || []).forEach((t) => t.stop());
}

async function handleAudioUpload(file) {
  if (!file) return;
  setStatus("", "Decoding audio…");
  await loadSourceFromBlob(file, file.name);
}

/* ------------------------------------------------------------------
   PERSISTENCE (IndexedDB) — Option B
   ------------------------------------------------------------------ */
const projectStore = (() => {
  const DB = "insta-notes-studio";
  const STORE = "project";
  const KEY = "current";
  const KEY_AVATAR = "avatar";
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function get(store, key = KEY) {
    return new Promise((resolve, reject) => {
      const tx = store.transaction([STORE], "readonly");
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  async function put(store, val, key = KEY) {
    return new Promise((resolve, reject) => {
      const tx = store.transaction([STORE], "readwrite");
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function remove(store, key = KEY) {
    return new Promise((resolve, reject) => {
      const tx = store.transaction([STORE], "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    async save(payload) {
      try {
        const s = await open();
        await put(s, payload);
      } catch (e) { console.warn("Could not persist project:", e); }
    },
    async load() {
      try {
        const s = await open();
        return await get(s);
      } catch (e) { console.warn("Could not restore project:", e); return null; }
    },
    async clear() {
      try {
        const s = await open();
        await remove(s);
      } catch (e) { console.warn("Could not clear project:", e); }
    },
    async saveAvatar(blob) {
      try {
        const s = await open();
        await put(s, blob, KEY_AVATAR);
      } catch (e) { console.warn("Could not persist avatar:", e); }
    },
    async loadAvatar() {
      try {
        const s = await open();
        return await get(s, KEY_AVATAR);
      } catch (e) { console.warn("Could not restore avatar:", e); return null; }
    },
    async clearAvatar() {
      try {
        const s = await open();
        await remove(s, KEY_AVATAR);
      } catch (e) { console.warn("Could not clear avatar:", e); }
    },
  };
})();

/* ------------------------------------------------------------------
   MP4 CONVERSION
   ------------------------------------------------------------------ */
async function convertToMp4(webmBlob) {
  setStatus("", "Loading FFmpeg.wasm…");
  setProgress(-1);

  const mods = await Promise.all([
    import("/vendor/ffmpeg-mod/index.js"),
    import("/vendor/util/index.js"),
  ]);
  const { FFmpeg } = mods[0];
  const { fetchFile } = mods[1];

  const ffmpeg = new FFmpeg();
  const checkCancel = () => {
    if (cancelRequested) {
      try { ffmpeg.terminate(); } catch (_) {}
      throw new Error("Cancelled");
    }
  };
  checkCancel();

  ffmpeg.on("log", ({ message }) => {
    if (cancelRequested) {
      // Terminating the worker makes the in-flight exec() reject right away.
      try { ffmpeg.terminate(); } catch (_) {}
      return;
    }
    console.log("[ffmpeg]", message);
    const m = String(message).match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m && currentDuration) {
      const secs = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
      const pct = Math.max(0, Math.min(100, (secs / currentDuration) * 100));
      setStatus("", `Converting… ${pct.toFixed(0)}%`);
      setProgress(pct);
    }
  });
  ffmpeg.on("progress", () => {});

  await ffmpeg.load({
    classWorkerURL: "./worker.js",
    coreURL: "/vendor/ffmpeg-core.js",
    wasmURL: "/vendor/ffmpeg-core.wasm",
  });
  checkCancel();

  await ffmpeg.writeFile("input.webm", await fetchFile(webmBlob));
  checkCancel();
  setStatus("", "Converting WebM → MP4…");

  await ffmpeg.exec([
    "-i", "input.webm",
    "-filter:v", "fps=60",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "output.mp4",
  ]);
  checkCancel();

  const data = await ffmpeg.readFile("output.mp4");
  const mp4Blob = new Blob([data], { type: "video/mp4" });

  await ffmpeg.deleteFile("input.webm");
  await ffmpeg.deleteFile("output.mp4");
  ffmpeg.terminate();

  return mp4Blob;
}

/* ------------------------------------------------------------------
   MAIN FLOW
   ------------------------------------------------------------------ */
async function fillScene() {
  const savedTheme = localStorage.getItem(LS_THEME) || THEMES[0].id;
  const theme =
    savedTheme === "custom"
      ? customTheme()
      : THEMES.find((t) => t.id === savedTheme) || THEMES[0];
  preview = new Preview(els.scene, { audio, metrics }, {
    duration: currentDuration,
    theme,
    onDone: () => {
      setPlayLabel(false);
      // Don't release the audio/trim controls mid-generate: the timeline
      // finishing is what stops recording, but conversion is still running.
      if (!busy) setSourceLocked(false);
    },
  });
  await preview.loadAssets();
}

async function loadInitialAudio() {
  const restored = await projectStore.load();
  if (restored && restored.sourceBlob) {
    await loadSourceFromBlob(restored.sourceBlob, restored.fileName || "Restored audio", restored.trim);
  } else {
    try {
      const res = await fetch("/assets/demo.mp3");
      await loadSourceFromBlob(await res.blob(), "demo.mp3");
    } catch (err) {
      console.warn("Could not load default audio:", err);
    }
  }
}

/** Restore a cached custom avatar (persisted like the audio source). */
async function restoreAvatar() {
  const blob = await projectStore.loadAvatar();
  if (!blob || !preview) return;
  const url = URL.createObjectURL(blob);
  els.avatarPreview.src = url;
  els.avatarPreview.classList.remove("hidden");
  await preview.setAvatar(url);
}

const LOCKABLE = [
  els.playBtn,
  els.uploadBtn,
  els.recordBtn,
  els.trimStart,
  els.trimEnd,
  els.trimReset,
  els.fileRemove,
];

/** Disable user-facing controls (avatar, theme, audio, trim) while busy. */
function setControlsLocked(locked) {
  LOCKABLE.forEach((el) => {
    if (el) el.disabled = locked;
  });
  els.avatarBox.classList.toggle("locked", locked);
  els.themePicker.classList.toggle("locked", locked);
  els.trimWave.classList.toggle("locked", locked);
  if (els.activeFile) els.activeFile.classList.toggle("locked", locked);
}

const SOURCE_LOCKABLE = [
  els.uploadBtn,
  els.recordBtn,
  els.trimStart,
  els.trimEnd,
  els.trimReset,
  els.fileRemove,
];

/** Lock audio-source + trim controls while previewing, keeping avatar and
 *  theme editable (visual-only changes are safe mid-preview). */
function setSourceLocked(locked) {
  SOURCE_LOCKABLE.forEach((el) => {
    if (el) el.disabled = locked;
  });
  els.trimWave.classList.toggle("locked", locked);
  if (els.activeFile) els.activeFile.classList.toggle("locked", locked);
}

async function runGenerate() {
  if (busy) return;
  busy = true;
  cancelRequested = false;
  // Lock everything (avatar, theme, audio source, trim) while recording and
  // converting so the scene cannot change mid-render (WYSIWYG).
  setControlsLocked(true);
  els.generateBtn.disabled = true;
  els.playBtn.disabled = true;
  els.generateBtn.classList.remove("ready");
  setBusyWarning(true);
  setCancelVisible(true);
  // A new generate invalidates any previously produced MP4.
  lastMp4 = null;
  setGenerateLabel("Preparing…");
  setStatus("", "Preparing recorder…");

  const wasCancelled = () => cancelRequested;

  try {
    const capture = ensureAudioCapture();
    if (capture && capture.ctx.state === "suspended") capture.ctx.resume().catch(() => {});
    if (capture) capture.setAudible(false);

    recorder = new Recorder(els.scene, {
      filePrefix: "insta-notes",
      audioTrack: capture ? capture.track : null,
    });
    if (!recorder.supports()) {
      els.unsupported.classList.remove("hidden");
      return;
    }
    await recorder.prepare();
    if (wasCancelled()) throw new Error("Cancelled");

    const startupT0 = performance.now();
    recorder.start();
    const startRec = performance.now();
    setGenerateLabel("Recording…");
    setStatus("recording", "Recording…");
    // Always record from the very start, even if the preview was mid-play.
    preview.reset();
    preview.play();

    const startupMs = startRec - startupT0;

    // Auto-stop when the timeline completes (elapsed-based, so an auto-pause
    // from a hidden tab does not falsely finish the recording). Progress
    // fills the generate button with color while recording.
    const result = await new Promise((resolve) => {
      const check = setInterval(() => {
        const dur = preview.timeline.duration;
        if (wasCancelled()) {
          clearInterval(check);
          resolve("cancelled");
        } else if (preview.timeline.elapsed >= dur) {
          clearInterval(check);
          resolve("done");
        } else {
          setProgress((preview.timeline.elapsed / dur) * 100);
        }
      }, 100);
    });

    const exportT0 = performance.now();
    const { blob } = await recorder.stop();
    const exportMs = performance.now() - exportT0;
    preview.reset();

    if (result === "cancelled") throw new Error("Cancelled");

    metricRecordAll(blob, startupMs, exportMs);
    if (audioCapture) audioCapture.setAudible(true);

    // Convert WebM → MP4 as part of the Generate step.
    setGenerateLabel("Converting…");
    const convT0 = performance.now();
    const mp4Blob = await convertToMp4(blob);
    const convMs = performance.now() - convT0;
    metrics.record("Conversion (WebM→MP4) duration", `${convMs.toFixed(0)} ms`);
    metrics.record("MP4 file size", `${(mp4Blob.size / 1024 / 1024).toFixed(2)} MB`);
    lastMp4 = mp4Blob;

    setProgress(100);
    els.generateBtn.classList.add("ready");
    setGenerateLabel("Download");
    setStatus("", "MP4 ready — press Download");
    setTimeout(() => setProgress(null), 800);
  } catch (err) {
    console.error(err);
    if (wasCancelled()) {
      setStatus("", "Generation cancelled");
    } else {
      setStatus("", `Error: ${err.message}`);
    }
    if (audioCapture) audioCapture.setAudible(true);
  } finally {
    busy = false;
    cancelRequested = false;
    setBusyWarning(false);
    setProgress(null);
    setCancelVisible(false);
    setControlsLocked(false);
    els.generateBtn.disabled = false;
    els.playBtn.disabled = false;
    if (!lastMp4) setGenerateLabel("Generate");
    setPlayLabel(false);
  }
}

async function runConvert() {
  if (!lastMp4) return;
  Recorder.download(lastMp4, "insta-notes.mp4");
  setStatus("exported", "Downloaded insta-notes.mp4");
}

function metricRecordAll(blob, startupMs, exportMs) {
  const previewScale = els.scene.scrollWidth ? els.scene.getBoundingClientRect().width / WIDTH : 0;
  metrics.record("Scene resolution", "1080 × 360");
  metrics.record("Target FPS", "60");
  metrics.record("Duration", `${fmtDur(currentDuration)} s`);
  metrics.record("Recording startup delay", `${startupMs.toFixed(0)} ms`);
  metrics.record("Export (stop) duration", `${exportMs.toFixed(0)} ms`);
  metrics.record("WebM file size", `${(blob.size / 1024 / 1024).toFixed(2)} MB`);
  metrics.record("Preview scale", `${(previewScale * 100).toFixed(0)}%`);
}

async function playPreview() {
  if (busy) return;
  const capture = ensureAudioCapture();
  if (capture) {
    if (capture.ctx.state === "suspended") capture.ctx.resume().catch(() => {});
    capture.setAudible(true);
  }

  if (preview.timeline.running) {
    preview.pause();
    setSourceLocked(false);
    setPlayLabel(false);
    setStatus("", "Preview paused");
  } else if (preview.timeline.elapsed >= preview.timeline.duration) {
    // Finished previously — restart from the beginning.
    preview.play();
    setSourceLocked(true);
    setPlayLabel(true);
    setStatus("", "Preview playing");
  } else {
    preview.resume();
    setSourceLocked(true);
    setPlayLabel(true);
    setStatus("", "Preview playing");
  }
}

async function resetProject() {
  await projectStore.clear().catch(() => {});
  await projectStore.clearAvatar().catch(() => {});
  localStorage.removeItem(LS_THEME);
  location.reload();
}

async function removeAudio() {
  await projectStore.clear().catch(() => {});
  location.reload();
}

function wire() {
  els.generateBtn.addEventListener("click", () => {
    if (lastMp4) {
      void runConvert();
    } else {
      void runGenerate();
    }
  });
  els.cancelBtn.addEventListener("click", () => {
    cancelRequested = true;
  });
  els.uploadBtn.addEventListener("click", () => els.audioInput.click());
  els.audioInput.addEventListener("change", async () => {
    const file = els.audioInput.files && els.audioInput.files[0];
    if (file) await handleAudioUpload(file);
    els.audioInput.value = "";
  });
  els.recordBtn.addEventListener("click", toggleRecord);
  els.playBtn.addEventListener("click", () => {
    void playPreview();
  });
  els.resetBtn.addEventListener("click", () => {
    void resetProject();
  });
  els.fileRemove.addEventListener("click", () => {
    void removeAudio();
  });

  // Trim controls.
  els.trimStart.addEventListener("change", () => {
    trim.start = Number(els.trimStart.value) || 0;
    applyTrim();
  });
  els.trimEnd.addEventListener("change", () => {
    trim.end = Number(els.trimEnd.value) || (sourceBuffer ? Math.min(sourceBuffer.duration, trim.start + MAX_DURATION) : MAX_DURATION);
    applyTrim();
  });
  els.trimReset.addEventListener("click", resetTrim);

  // Trim waveform pointer handling.
  els.trimWave.addEventListener("pointerdown", onTrimPointerDown);
  els.trimWave.addEventListener("pointermove", onTrimPointerMove);
  els.trimWave.addEventListener("pointerup", onTrimPointerUp);
  els.trimWave.addEventListener("pointercancel", onTrimPointerUp);

  // Redraw at the new bar count when the window resizes.
  window.addEventListener("resize", () => {
    if (sourceBuffer) drawTrimWave();
  });

  wireAvatar();
  buildThemePicker();

  // Auto-pause/resume when the tab is hidden/visible. Browsers throttle
  // requestAnimationFrame in background tabs, which would freeze the canvas
  // while audio + the timeline clock keep advancing (playhead jumps). Pausing
  // timeline, audio and MediaRecorder keeps preview and export in lockstep.
  let hiddenPaused = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (preview && preview.timeline.running && !hiddenPaused) {
        hiddenPaused = true;
        preview.pause();
        if (recorder) recorder.pause();
        if (!busy) setSourceLocked(false); // release source controls when preview auto-paused
        setPlayLabel(false);
        setStatus("", "Paused (tab hidden)");
      }
    } else if (hiddenPaused) {
      hiddenPaused = false;
      if (preview) {
        preview.resume();
        if (recorder) recorder.resume();
        if (!busy) setSourceLocked(true);
        setPlayLabel(true);
        setStatus(busy ? "recording" : "", busy ? "Recording…" : "Preview playing");
      }
    }
  });

  // Debug metrics panel — collapsible (only visible with ?debug=1).
  els.metricsToggle.addEventListener("click", () => {
    const collapsed = els.metrics.getAttribute("data-collapsed") === "true";
    els.metrics.setAttribute("data-collapsed", String(!collapsed));
    els.metricsToggle.setAttribute("aria-expanded", String(!collapsed));
  });

  window.addEventListener("resize", drawTrimWave);
}

async function init() {
  wire();

  const ok =
    typeof window.MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function";
  if (!ok) {
    els.unsupported.classList.remove("hidden");
    els.generateBtn.disabled = true;
    els.playBtn.disabled = true;
    els.uploadBtn.disabled = true;
    els.recordBtn.disabled = true;
    return;
  }

  await fillScene();
  await restoreAvatar();
  await loadInitialAudio();

  setStatus("", "Ready");
  els.playBtn.disabled = false;
  els.generateBtn.disabled = false;
}

init();

// Expose for potential debugging from the console.
export const __WIDTH = WIDTH;
