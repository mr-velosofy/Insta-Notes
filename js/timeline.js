/**
 * timeline.js — single master animation timeline.
 *
 * All animations, audio, and recording stop are driven from ONE rAF loop.
 * No multiple timers. Everything derives its time from a single
 * requestAnimationFrame clock so preview and recording are in lockstep.
 */

export const DURATION = 10; // seconds
export const FPS = 60;
export const WIDTH = 1080;
export const HEIGHT = 360;

export class Timeline {
  /**
   * @param {object} opts
   * @param {function(number): void} opts.onFrame   called with elapsed seconds
   * @param {function(): void}      opts.onStart    called at t=0
   * @param {function(): void}      opts.onComplete called at t >= duration
   * @param {number}                [opts.duration] scene duration in seconds
   */
  constructor({ onFrame, onStart, onComplete, duration = DURATION }) {
    this.onFrame = onFrame;
    this.onStart = onStart;
    this.onComplete = onComplete;

    this.duration = duration;
    this.running = false;
    this._rafId = null;
    this._t0 = 0;
    this._t = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._t0 = performance.now();
    this._t = 0;
    if (this.onStart) this.onStart();
    this._loop();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  /** Pause the clock, preserving the current position for later resume. */
  pause() {
    this.stop();
  }

  /** Resume the clock from its current position (does not reset to 0). */
  resume() {
    if (this.running) return;
    this.running = true;
    this._t0 = performance.now() - this._t * 1000;
    this._loop();
  }

  /** Stop and rewind to the very start (0). */
  reset() {
    this.stop();
    this._t = 0;
  }

  _loop = () => {
    if (!this.running) return;

    this._t = Math.min((performance.now() - this._t0) / 1000, this.duration);
    this.onFrame(this._t);

    if (this._t >= this.duration) {
      this.running = false;
      this._rafId = null;
      if (this.onComplete) this.onComplete();
      return;
    }

    this._rafId = requestAnimationFrame(this._loop);
  };

  get elapsed() {
    return this._t;
  }

  get passed() {
    return this._t;
  }
}
