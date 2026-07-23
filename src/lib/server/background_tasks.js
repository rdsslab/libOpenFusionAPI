import { SystemInfoTask } from "./runtime/SystemInfoTask.js";
import { BotLifecycleTask } from "./runtime/BotLifecycleTask.js";
import { TimeSyncTask } from "./runtime/TimeSyncTask.js";

export class BackgroundTaskManager {
  constructor(serverAPI) {
    this.serverAPI = serverAPI;
    this.systemInfoTask = new SystemInfoTask({ serverAPI: this.serverAPI });
    this.botLifecycleTask = new BotLifecycleTask({ serverAPI: this.serverAPI });
    this.timeSyncTask = new TimeSyncTask();
  }

  startAll() {
    this.systemInfoTask.start();
    this.botLifecycleTask.start();
    this.timeSyncTask.start();
  }
}
