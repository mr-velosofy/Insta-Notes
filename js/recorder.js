/**
 * recorder.js — captures the live scene with captureStream() + MediaRecorder.
 *
 * No screenshots, no frame-by-frame PNG, no backend rendering. It records the
 * actual preview canvas as-is. Audio is mixed in via an audio track prepared by
 * the caller (so a single MediaElementSource can be reused across recordings).
 */

import { FPS } from "./timeline.js";

export class Recorder {
  /**
   * @param {HTMLCanvasElement} scene - the scene canvas (the preview).
   * @param {{filePrefix?: string, mimeType?: string, audioTrack?: MediaStreamTrack}} opts
   */
  constructor(scene, { filePrefix = "sample", mimeType, audioTrack = null } = {}) {
    this.scene = scene;
    this.filePrefix = filePrefix;
    this.mimeType = mimeType || this._pickMime();
    this.audioTrack = audioTrack;
    this.mediaRecorder = null;
    this.stream = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  /** Feature-detect. Returns the best supported WebM mime or null. */
  _pickMime() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const m of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  }

  supports() {
    return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
  }

  async prepare() {
    if (!this.supports()) throw new Error("MediaRecorder / captureStream not supported.");

    const canvas = this.scene;
    const fs = (canvas.captureStream && canvas.captureStream(FPS)) || null;
    if (!fs) throw new Error("captureStream() unavailable on scene element.");
    this.stream = fs;

    if (this.audioTrack && !this.stream.getAudioTracks().length) {
      this.stream.addTrack(this.audioTrack);
    }

    if (!this.stream.getVideoTracks().length) {
      throw new Error("Scene stream produced no video tracks.");
    }

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType || undefined,
      videoBitsPerSecond: 16_000_000,
      audioBitsPerSecond: 128_000,
    });
    this.chunks = [];

    this.mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    });
  }

  start() {
    if (!this.mediaRecorder) throw new Error("prepare() must be called before start().");
    this.chunks = [];
    this.startedAt = performance.now();
    this.mediaRecorder.start(100); // collect in ~100ms slices
  }

  /** Pause capturing (e.g. when the tab is hidden). Safe if not recording. */
  pause() {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.pause();
    }
  }

  /** Resume capturing after pause(). Safe if not paused. */
  resume() {
    if (this.mediaRecorder && this.mediaRecorder.state === "paused") {
      this.mediaRecorder.resume();
    }
  }

  /** @returns {Promise<{blob: Blob, url: string, startupMs: number}>} */
  stop() {
    return new Promise((resolve) => {
      this.mediaRecorder.addEventListener(
        "stop",
        () => {
          const startupMs = this.startedAt;
          const blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType || "video/webm" });
          const url = URL.createObjectURL(blob);
          this.stream.getVideoTracks().forEach((t) => t.stop());
          resolve({ blob, url, startupMs });
        },
        { once: true }
      );
      this.mediaRecorder.stop();
    });
  }

  /** Trigger a browser download of the blob. */
  static download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}