import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runAllTests() {
  console.log("=== Starting Full System Validation Packet ===");

  // 1. Start the server
  console.log("Starting server...");
  const server = spawn("node", ["--max-old-space-size=4096", "../../src/server.js"], {
    cwd: __dirname,
    stdio: "inherit",
    env: { ...process.env, PORT: "3000", BUILD_DB: "true" }
  });

  // Wait for server to be ready
  console.log("Waiting for server to be ready (polling http://localhost:3000)...");
  let ready = false;
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch("http://localhost:3000/api/system/system/login/prd", { method: "POST" });
      if (res.status === 200 || res.status === 401 || res.status === 400) {
        console.log("Server is up and responding!");
        ready = true;
        break;
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (i % 5 === 0 && i > 0) console.log(`Still waiting (${i * 2}s)...`);
  }

  if (!ready) {
    console.error("Server failed to start in time. Aborting tests.");
    server.kill();
    process.exit(1);
  }

  let success = true;
  try {
    // 2. Run the integration tests
    const testRuns = [
      {
        label: "integration_test.js",
        command: "node",
        args: ["integration_test.js"],
      },
      {
        label: "fetch_timeout_test.js",
        command: "node",
        args: ["fetch_timeout_test.js"],
      },
      {
        label: "cache_validation.js",
        command: "node",
        args: ["cache_validation.js"],
      },
      {
        label: "endpoint_loader_vm_contract.js",
        command: "node",
        args: ["endpoint_loader_vm_contract.js"],
      },
      {
        label: "ws_cache_events.js",
        command: "node",
        args: ["ws_cache_events.js"],
      },
      {
        label: "owasp_top10.js",
        command: "node",
        args: ["owasp_top10.js"],
      },
      {
        label: "check_mcp_name_uniqueness",
        command: "node",
        args: [
          "../scratch/check_mcp_name_uniqueness.js",
          "--server-key",
          "openfusion_system_remote_prd",
          "--app",
          "system",
          "--environment",
          "prd",
          "--idapp",
          "cfcd2084-95d5-65ef-66e7-dff9f98764da",
        ],
      },
    ];

    for (const testRun of testRuns) {
      console.log(`\n--- Running ${testRun.label} ---`);
      const testProcess = spawn(testRun.command, testRun.args, {
        cwd: __dirname,
        stdio: "inherit"
      });

      const exitCode = await new Promise(resolve => {
        testProcess.on("exit", resolve);
      });

      if (exitCode !== 0) {
        console.error(`${testRun.label} failed with exit code ${exitCode}`);
        success = false;
        break;
      }
    }
  } catch (err) {
    console.error("Test execution error:", err);
    success = false;
  } finally {
    // 3. Close the server
    console.log("\nStopping server...");
    server.kill();
    // In Windows, sometimes kill doesn't work well for child processes of spawn
    // But since it's a direct node process it should be fine.
  }

  if (success) {
    console.log("\n=== VALIDATION COMPLETE: SYSTEM IS READY FOR PRODUCTION ===");
    process.exit(0);
  } else {
    console.log("\n=== VALIDATION FAILED ===");
    process.exit(1);
  }
}

runAllTests();
