import { syncTime, isTimeSyncEnabled } from "../timeSync.js";

export class TimeSyncTask {
  constructor({ intervalMs = 20 * 60 * 1000 } = {}) {
    this.intervalMs = intervalMs;
    this.timerId = null;
  }

  async runOnce() {
    await syncTime();
  }

  start() {
    if (!isTimeSyncEnabled()) return;
    this.runOnce();
    this.timerId = setInterval(() => this.runOnce(), this.intervalMs);
  }
}
