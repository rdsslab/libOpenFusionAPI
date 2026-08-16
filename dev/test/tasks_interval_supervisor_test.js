import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { TasksInterval } from "../../src/lib/timer/tasks.js";

class FakeWorker extends EventEmitter {
  static instances = [];

  constructor(workerPath) {
    super();
    this.workerPath = workerPath;
    this.terminated = false;
    this.messages = [];
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(JSON.parse(message));
    if (this.messages.at(-1).action === "shutdown") {
      this.emit("exit", 0);
    }
  }

  async terminate() {
    this.terminated = true;
    this.emit("exit", 0);
    return 0;
  }
}

async function runTests() {
  const tasks = new TasksInterval({
    WorkerClass: FakeWorker,
    restartDelayMs: 0,
    workerPath: "fake-worker.js",
  });

  const first = tasks.run();
  assert.strictEqual(tasks.run(), first, "run must be idempotent");
  assert.strictEqual(FakeWorker.instances.length, 1);
  tasks.wake();
  assert.strictEqual(first.messages.at(-1).action, "wake");

  first.emit("exit", 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.strictEqual(FakeWorker.instances.length, 2, "crashes must restart the worker");

  const restarted = tasks.worker;
  await tasks.stop();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.strictEqual(restarted.messages.at(-1).action, "shutdown");
  assert.strictEqual(restarted.terminated, false, "graceful exit must avoid termination");
  assert.strictEqual(tasks.worker, null);
  assert.strictEqual(
    FakeWorker.instances.length,
    2,
    "an intentional stop must not restart the worker",
  );

  console.log("TasksInterval supervisor tests passed");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});