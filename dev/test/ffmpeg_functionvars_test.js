import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listFunctionsVars } from "../../src/lib/server/functionVars.js";

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ofapi-ffmpeg-e2e-"));
  const outMp4 = path.join(tmpDir, "sample.mp4");

  try {
    // Simulate JS handler context so request/reply-gated helpers are exposed
    const fns = listFunctionsVars({ headers: {} }, { openfusionapi: {} }, "dev");
    assert.ok(fns.ffmpeg?.fn?.run, "ffmpeg.run must be exposed in handler context");
    assert.ok(fns.ffprobe?.fn?.run, "ffprobe.run must be exposed in handler context");

    const ffmpeg = fns.ffmpeg.fn;
    const ffprobe = fns.ffprobe.fn;

    // 1) Basic binary execution (installed system binary)
    const ver = await ffmpeg.run(["-version"], { timeoutMs: 15000 });
    assert.equal(ver.ok, true, `ffmpeg -version failed: ${ver.stderr || ver.code}`);
    assert.equal(ver.timedOut, false);
    assert.match(String(ver.stdout), /ffmpeg version/i);

    // 2) Generate a tiny media file (real processing, no exec/buffer issues)
    const gen = await ffmpeg.run(
      [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-f", "lavfi", "-i", "testsrc=duration=0.2:size=64x64:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=0.2",
        "-shortest",
        outMp4,
      ],
      { timeoutMs: 30000 },
    );
    assert.equal(gen.ok, true, `ffmpeg generate failed (code=${gen.code}, timedOut=${gen.timedOut}): ${gen.stderr}`);
    const stat = await fs.stat(outMp4);
    assert.ok(stat.size > 0, "generated media file must not be empty");

    // 3) Probe metadata via ffprobe JSON output
    const probe = await ffprobe.run(
      [
        "-v", "error",
        "-show_format",
        "-show_streams",
        "-of", "json",
        outMp4,
      ],
      { timeoutMs: 15000 },
    );
    assert.equal(probe.ok, true, `ffprobe failed (code=${probe.code}): ${probe.stderr}`);
    const meta = JSON.parse(String(probe.stdout));
    assert.ok(meta.format, "ffprobe output must include format");
    assert.ok(Array.isArray(meta.streams) && meta.streams.length >= 1, "ffprobe output must include streams");

    // 4) Argument validation / injection guard at API level
    await assert.rejects(
      () => ffmpeg.run("-version"),
      /args must be an array of strings/,
      "command string must be rejected",
    );
    await assert.rejects(
      () => ffmpeg.run(["-version"], { shell: true }),
      /shell:true is not allowed/,
      "shell:true must be rejected",
    );

    // 5) Non-zero exit is reported (not thrown) with stderr details
    const bad = await ffprobe.run(["-v", "error", path.join(tmpDir, "missing-file.mp4")], { timeoutMs: 15000 });
    assert.equal(bad.ok, false, "missing input must not be ok");
    assert.notEqual(bad.code, 0);

    // 6) EPIPE regression: a child that stops reading stdin early must not crash
    //    the process. ffprobe gives up as soon as it cannot identify the input, so
    //    with a buffer far larger than the pipe it exits while Node is still
    //    writing; without a `child.stdin` error listener that unhandled EPIPE kills
    //    the whole handler/bot worker (it did: "Worker crash: write EPIPE").
    //    A crash would kill this test too, so the scenario runs in a child node.
    const functionVarsUrl = new URL("../../src/lib/server/functionVars.js", import.meta.url).href;
    const junkBytes = 8 * 1024 * 1024;
    const childScript = `
      import { functionsVars } from ${JSON.stringify(functionVarsUrl)};
      const vars = functionsVars({ headers: {} }, {}, "dev");
      const junk = Buffer.alloc(${junkBytes}, 0x41);
      const res = await vars.ffprobe.run(["-v", "error", "pipe:0"], { stdin: junk, timeoutMs: 20000 });
      if (res.ok) {
        console.error("expected ffprobe to reject the junk input");
        process.exit(2);
      }
      console.log("NO_CRASH", res.code);
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
      encoding: "utf8",
      timeout: 120000,
    });
    assert.equal(
      child.status,
      0,
      `process must survive EPIPE on child stdin (status=${child.status}): ${child.stderr}`,
    );
    assert.match(child.stdout, /NO_CRASH/);

    console.log(JSON.stringify({
      ok: true,
      checks: {
        version: true,
        generate: { code: gen.code, size: stat.size },
        probe: { streams: meta.streams.length, format: meta.format?.format_name || null },
        guards: { rejectsString: true, rejectsShell: true },
        nonZeroReported: { code: bad.code },
        epipeResilience: { stdinBytes: junkBytes, childStatus: child.status },
      },
    }, null, 2));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
