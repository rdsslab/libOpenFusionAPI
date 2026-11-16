import assert from "node:assert/strict";
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

    console.log(JSON.stringify({
      ok: true,
      checks: {
        version: true,
        generate: { code: gen.code, size: stat.size },
        probe: { streams: meta.streams.length, format: meta.format?.format_name || null },
        guards: { rejectsString: true, rejectsShell: true },
        nonZeroReported: { code: bad.code },
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
