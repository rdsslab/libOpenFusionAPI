/**
 * Agent kit suite (hermetic).
 *
 * Covers the pieces that used to live inside the ollama-bot harness and are now a
 * platform module:
 *
 *   - deterministic policies (web/recall detection, prompt recaps)
 *   - buffer/data-URL normalisation
 *   - in-memory document extraction (PDF, DOCX, text, unsupported)
 *   - STT/TTS provider registries and video frame extraction
 *   - web search parsers and the `ok:false` contract
 *   - `askAgent` with a fake OpenAI-compatible server (images, tools, pre-search,
 *     documents, one-shot dedup)
 *   - `ia.js` provider message conversions and the functionVars exposure
 *
 * No network, no database, no credentials: every HTTP call has a local fake, and
 * those that cannot be faked (real providers, real web search, real Whisper) are
 * opt-in behind `AGENTKIT_LIVE=1`. ffmpeg tests run only when the binary exists.
 */

import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  askAgent,
  cleanWebQuery,
  describeMediaSupport,
  detectDocumentKind,
  docxToText,
  extractBingResults,
  extractDocumentText,
  extractDuckDuckGoLiteResults,
  extractDuckDuckGoResults,
  extractVideoFrames,
  formatHistoryRecap,
  formatWebRecap,
  guessMimeTypeFromName,
  htmlToText,
  listSttProviderTypes,
  listTtsProviderTypes,
  listWebSearchEngines,
  looksLikeMissingMedia,
  looksLikeRecall,
  looksLikeWebQuery,
  mergeQuoted,
  normalizeBinaryDescriptor,
  normalizeForMatch,
  parseDataUrl,
  pickWebQuery,
  short,
  splitJpegStream,
  toBuffer,
  toDataUrl,
  trimWebResults,
  webSearch,
  createSpeechToText,
  createTextToSpeech,
  MediaProviderError,
} from "../../src/lib/server/agentKit/index.js";
import { __internalIAForTests } from "../../src/lib/server/ia.js";
import { listFunctionsVars } from "../../src/lib/server/functionVars.js";

const checks = {};
const check = (name, fn) => {
  fn();
  checks[name] = true;
};

// ---------------------------------------------------------------------------
// Fixtures (built in memory)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/**
 * Minimal ZIP writer (stored + deflate) used to build a DOCX without the `zip`
 * binary, so the suite is portable.
 */
const buildZip = (files) => {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const compressed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBlock, centralBlock, eocd]);
};

const buildDocx = () => {
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    "<w:p><w:r><w:t>Hola desde DOCX</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>Segunda linea con &amp; entidad</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>Texto</w:t></w:r><w:r><w:tab/><w:t>con tab</w:t></w:r></w:p>",
    "</w:body>",
    "</w:document>",
  ].join("");

  return buildZip([
    { name: "[Content_Types].xml", data: '<?xml version="1.0"?><Types/>' },
    { name: "word/document.xml", data: documentXml },
  ]);
};

const buildPdf = () => {
  const content = "BT /F1 18 Tf 72 720 Td (Hola desde PDF) Tj ET\nBT /F1 12 Tf 72 690 Td (Segunda linea de prueba) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  const chunks = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [];
  let size = chunks[0].length;

  objects.forEach((object, index) => {
    const block = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "latin1");
    offsets.push(size);
    chunks.push(block);
    size += block.length;
  });

  const xrefOffset = size;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));

  return Buffer.concat(chunks);
};

const DDG_HTML = `
<div class="results">
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fclima%3Fq%3Dquito&amp;rut=abc">Clima en <b>Quito</b></a>
    <a class="result__snippet" href="#">Soleado, 22 grados y viento suave.</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://example.org/otra">Otra &amp; fuente</a>
    <a class="result__snippet" href="#">Detalle de la segunda fuente.</a>
  </div>
</div>`;

const DDG_LITE_HTML = `
<table>
  <tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Example.com%2Flite">Resultado lite</a></td></tr>
  <tr><td class="result-snippet">Snippet lite de prueba.</td></tr>
</table>`;

const BING_HTML = `
<ol>
  <li class="b_algo">
    <h2><a href="https://example.net/bing">Resultado Bing</a></h2>
    <p>Descripcion de Bing &amp; compania.</p>
  </li>
  <li class="b_algo">
    <h2><a href="https://example.net/bing-2">Segundo Bing</a></h2>
    <p>Otra descripcion.</p>
  </li>
</ol>`;

const jpegBytes = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("fake-jpeg-one", "latin1"),
  Buffer.from([0xff, 0xd9]),
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("fake-jpeg-two", "latin1"),
  Buffer.from([0xff, 0xd9]),
]);

const makeFakeResponse = ({ status = 200, contentType = "application/json", body = "" }) => {
  const asBuffer = () => {
    if (Buffer.isBuffer(body)) {
      return body;
    }
    if (typeof body === "string") {
      return Buffer.from(body);
    }
    return Buffer.from(JSON.stringify(body));
  };

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? contentType : null) },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => (typeof body === "string" ? JSON.parse(body || "{}") : body),
    arrayBuffer: async () => {
      const buffer = asBuffer();
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
};

// ---------------------------------------------------------------------------
// Fake OpenAI-compatible server
// ---------------------------------------------------------------------------

const startFakeOpenAI = async (handler) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      res.setHeader("content-type", "application/json");
      const reply = handler(parsed, requests.length - 1);
      res.end(JSON.stringify(reply));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

  return {
    baseUrl,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const textReply = (text) => ({
  id: "cmpl",
  object: "chat.completion",
  created: 1,
  model: "fake",
  choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  usage: {},
});

const toolReply = (name, args, id = "call_1") => ({
  id: "cmpl",
  object: "chat.completion",
  created: 1,
  model: "fake",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    finish_reason: "tool_calls",
  }],
  usage: {},
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Policies ------------------------------------------------------------
  check("policies", () => {
    assert.equal(short("abcdef", 4), "abc...");
    assert.equal(short(null, 10), "");
    assert.equal(normalizeForMatch("  Conversación  "), "conversacion");

    assert.equal(looksLikeWebQuery("busca en internet el clima de Quito"), true);
    assert.equal(looksLikeWebQuery("cual es el precio del dolar hoy"), true);
    assert.equal(looksLikeWebQuery("hola, como estas"), false);
    assert.equal(cleanWebQuery("Busca en internet quien es X"), "quien es X");
    assert.equal(cleanWebQuery("investiga en google la capital de Francia"), "Francia capital");

    assert.equal(pickWebQuery({ ownText: "busca en la web el clima", quotedText: "otra cosa" }), "el clima");
    assert.equal(pickWebQuery({ ownText: "responde a este mensaje", quotedText: "busca en internet el dolar" }), "el dolar");
    assert.equal(pickWebQuery({ ownText: "hola", quotedText: "chau" }), "");

    assert.equal(looksLikeRecall("te acuerdas de la foto que te mande"), true);
    assert.equal(looksLikeRecall("cuantas gallinas habia en la imagen"), true);
    assert.equal(looksLikeRecall("hola"), false);

    const recap = formatWebRecap({
      source: "duckduckgo",
      query: "clima quito",
      results: [{ title: "Clima", url: "https://example.com", snippet: "22 grados" }],
    });
    assert.match(recap, /WEB SEARCH RESULTS/);
    assert.match(recap, /22 grados/);

    const trimmed = trimWebResults({ ok: true, source: "ddg", results: [{ title: "T", url: "u", snippet: "s" }] });
    assert.deepEqual(Object.keys(trimmed).sort(), ["note", "ok", "results", "source"]);

    const history = formatHistoryRecap({
      results: [{ created_at: "2026-01-01", role: "user", kind: "photo", content: "foto de la gallina" }],
    });
    assert.match(history, /PREVIOUS MESSAGES/);
    assert.match(history, /gallina/);

    assert.equal(looksLikeMissingMedia("analiza esta imagen"), true);
    assert.equal(looksLikeMissingMedia("recuerdas la imagen anterior"), false);

    assert.equal(mergeQuoted("hola", null), "hola");
    assert.match(mergeQuoted("responde", { text: "pregunta" }, { label: "Citado: " }), /Citado: pregunta/);
  });

  // 2. Buffers -------------------------------------------------------------
  check("buffers", () => {
    const text = Buffer.from("hola mundo");
    assert.deepEqual(toBuffer(text), text);
    assert.deepEqual(toBuffer(new Uint8Array([1, 2, 3])), Buffer.from([1, 2, 3]));
    assert.deepEqual(toBuffer(text.toString("base64")), text);
    assert.deepEqual(toBuffer(`data:text/plain;charset=utf-8,${encodeURIComponent("hola mundo")}`), text);
    assert.deepEqual(toBuffer({ data: text }), text);
    assert.deepEqual(toBuffer({ base64: text.toString("base64") }), text);

    const dataUrl = toDataUrl(text, "text/plain");
    assert.match(dataUrl, /^data:text\/plain;base64,/);
    assert.deepEqual(parseDataUrl(dataUrl).data, text);

    const descriptor = normalizeBinaryDescriptor({ base64: text.toString("base64") }, { mimeType: "text/plain" });
    assert.equal(descriptor.mimeType, "text/plain");
    assert.deepEqual(descriptor.data, text);

    assert.equal(guessMimeTypeFromName("informe.PDF"), "application/pdf");
    assert.equal(guessMimeTypeFromName("nota.unknownext"), "application/octet-stream");
    assert.throws(() => toBuffer(null), /Binary input is required/);
  });

  // 3. Documents -----------------------------------------------------------
  const docx = buildDocx();
  const pdf = buildPdf();

  check("documents-detect", () => {
    assert.equal(detectDocumentKind({ fileName: "a.pdf" }), "pdf");
    assert.equal(detectDocumentKind({ mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "docx");
    assert.equal(detectDocumentKind({ fileName: "a.md" }), "text");
    assert.equal(detectDocumentKind({ fileName: "a.html" }), "html");
    assert.equal(detectDocumentKind({ fileName: "a.xlsx" }), "unsupported");

    assert.equal(htmlToText("<p>Hola&nbsp;<b>mundo</b></p><script>x()</script>"), "Hola mundo");
    assert.match(docxToText(docx), /Hola desde DOCX/);
  });

  await (async () => {
    const docxResult = await extractDocumentText({ data: docx, fileName: "test.docx" });
    assert.equal(docxResult.kind, "docx");
    assert.match(docxResult.text, /Hola desde DOCX/);
    assert.match(docxResult.text, /Segunda linea con & entidad/);
    assert.match(docxResult.text, /Texto\tcon tab/);

    const pdfResult = await extractDocumentText({ data: pdf, fileName: "test.pdf" });
    assert.equal(pdfResult.kind, "pdf");
    assert.equal(pdfResult.pages, 1);
    assert.match(pdfResult.text, /Hola desde PDF/);

    const md = await extractDocumentText({ data: Buffer.from("# Titulo\n\nContenido"), fileName: "nota.md" });
    assert.equal(md.kind, "text");
    assert.match(md.text, /Titulo/);

    const html = await extractDocumentText({ data: Buffer.from("<h1>Hola</h1><p>Mundo</p>"), fileName: "a.html" });
    assert.equal(html.kind, "html");
    assert.match(html.text, /Hola/);
    assert.match(html.text, /Mundo/);

    const truncated = await extractDocumentText(
      { data: Buffer.from("x".repeat(100)), fileName: "a.txt" },
      { maxChars: 20 },
    );
    assert.equal(truncated.truncated, true);
    assert.match(truncated.text, /truncado/);

    await assert.rejects(
      () => extractDocumentText({ data: Buffer.from("PK"), fileName: "hoja.xlsx" }),
      (error) => error.code === "DOCUMENT_UNSUPPORTED" && /no esta soportado/.test(error.userMessage),
    );

    await assert.rejects(
      () => extractDocumentText({ data: Buffer.alloc(0), fileName: "vacio.txt" }),
      (error) => error.code === "DOCUMENT_EMPTY",
    );

    await assert.rejects(
      () => extractDocumentText({ data: Buffer.from("no es un zip"), fileName: "roto.docx" }),
      (error) => error.code === "DOCX_INVALID" || error.code === "DOCX_ENTRY_MISSING",
    );

    checks.documents = true;
  })();

  // 4. Media ---------------------------------------------------------------
  check("media-registries", () => {
    assert.deepEqual(listSttProviderTypes().sort(), ["deepgram", "generic", "openai"]);
    assert.deepEqual(listTtsProviderTypes().sort(), ["elevenlabs", "openai", "supertonic"]);
    assert.deepEqual(listWebSearchEngines().sort(), ["bing", "duckduckgo", "http-json"]);

    assert.deepEqual(
      describeMediaSupport({ stt: { local: { type: "openai" } }, tts: { supertonic: {} } }),
      {
        images: true,
        videoFrames: true,
        video: {
          frames: true,
          native: false,
          strategies: ["frames+stt", "frames", "stt"],
        },
        transcription: { available: true, providers: ["local"] },
        speech: { available: true, providers: ["supertonic"] },
      },
    );

    assert.equal(describeMediaSupport({ stt: {}, tts: {}, ffmpeg: false }).transcription.available, false);

    assert.deepEqual(splitJpegStream(jpegBytes).length, 2);
    assert.equal(splitJpegStream(jpegBytes, 1).length, 1);
  });

  await (async () => {
    // STT: OpenAI-compatible multipart, as the local Whisper server expects.
    let captured = null;
    const stt = createSpeechToText({
      providers: { local: { type: "openai", baseUrl: "http://whisper.local:8080", apiKey: "k" } },
      defaultProvider: "local",
      language: "es",
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return makeFakeResponse({ body: { text: "hola desde el audio" } });
      },
    });

    const transcript = await stt.transcribe(
      { data: Buffer.from("ogg-bytes"), mimeType: "audio/ogg", fileName: "nota.ogg" },
      { language: "es" },
    );
    assert.equal(transcript.text, "hola desde el audio");
    assert.equal(transcript.provider, "local");
    assert.match(captured.url, /\/v1\/audio\/transcriptions$/);
    assert.equal(captured.init.headers.Authorization, "Bearer k");
    assert.ok(captured.init.body instanceof FormData);

    // Deepgram JSON shape.
    const deepgram = createSpeechToText({
      providers: { dg: { type: "deepgram", apiKey: "dg" } },
      fetchImpl: async () => makeFakeResponse({
        body: { results: { channels: [{ alternatives: [{ transcript: "texto deepgram" }] }] } },
      }),
    });
    assert.equal((await deepgram.transcribe(Buffer.from("x"))).text, "texto deepgram");

    // No providers -> explicit userMessage, never silence.
    await assert.rejects(
      () => createSpeechToText({}).transcribe(Buffer.from("x")),
      (error) => error instanceof MediaProviderError
        && error.code === "STT_NOT_CONFIGURED"
        && /no esta configurada/.test(error.userMessage),
    );

    // Unknown provider and unknown type.
    await assert.rejects(
      () => createSpeechToText({ providers: { a: { type: "openai", apiKey: "k" } } }).transcribe(Buffer.from("x"), { provider: "b" }),
      (error) => error.code === "STT_PROVIDER_UNKNOWN",
    );
    await assert.rejects(
      () => createSpeechToText({ providers: { a: { type: "nope" } } }).transcribe(Buffer.from("x")),
      (error) => error.code === "STT_TYPE_UNSUPPORTED",
    );

    // TTS: Supertonic raw audio.
    const tts = createTextToSpeech({
      providers: { supertonic: { type: "supertonic", baseUrl: "http://tts.local:8001", voice: "F1" } },
      defaultProvider: "supertonic",
      language: "es",
      fetchImpl: async () => makeFakeResponse({ contentType: "audio/mpeg", body: Buffer.from("mp3-bytes") }),
    });

    const audio = await tts.synthesize("hola", { voice: "F1" });
    assert.equal(audio.provider, "supertonic");
    assert.equal(audio.mimeType, "audio/mpeg");
    assert.deepEqual(audio.data, Buffer.from("mp3-bytes"));

    // TTS: JSON envelope with base64 audio (some servers answer this way).
    const jsonTts = createTextToSpeech({
      providers: { s: { type: "supertonic", baseUrl: "http://x" } },
      fetchImpl: async () => makeFakeResponse({
        body: { audio_base64: Buffer.from("json-audio").toString("base64") },
      }),
    });
    assert.deepEqual((await jsonTts.synthesize("hola")).data, Buffer.from("json-audio"));

    await assert.rejects(
      () => createTextToSpeech({}).synthesize("hola"),
      (error) => error.code === "TTS_NOT_CONFIGURED" && /no esta configurada/.test(error.userMessage),
    );

    checks.media = true;
  })();

  // 5. Web search ----------------------------------------------------------
  check("websearch-parsers", () => {
    const ddg = extractDuckDuckGoResults(DDG_HTML, 5);
    assert.equal(ddg.length, 2);
    assert.equal(ddg[0].title, "Clima en Quito");
    assert.equal(ddg[0].url, "https://example.com/clima?q=quito");
    assert.match(ddg[0].snippet, /22 grados/);
    assert.equal(ddg[1].title, "Otra & fuente");

    const lite = extractDuckDuckGoLiteResults(DDG_LITE_HTML, 5);
    assert.equal(lite.length, 1);
    assert.equal(lite[0].title, "Resultado lite");

    const bing = extractBingResults(BING_HTML, 5);
    assert.equal(bing.length, 2);
    assert.equal(bing[0].title, "Resultado Bing");
    assert.match(bing[0].snippet, /Bing & compania/);
  });

  await (async () => {
    const ddg = await webSearch({
      query: "clima quito",
      fetchImpl: async () => makeFakeResponse({ contentType: "text/html", body: DDG_HTML }),
    });
    assert.equal(ddg.ok, true);
    assert.equal(ddg.source, "duckduckgo");
    assert.equal(ddg.results.length, 2);

    // Chain fallback: DuckDuckGo fails, Bing answers.
    let call = 0;
    const chained = await webSearch({
      query: "clima quito",
      providers: { duckduckgo: true, bing: true },
      fetchImpl: async () => {
        call += 1;
        if (call === 1) {
          return makeFakeResponse({ status: 503, contentType: "text/html", body: "busy" });
        }
        return makeFakeResponse({ contentType: "text/html", body: BING_HTML });
      },
    });
    assert.equal(chained.ok, true);
    assert.equal(chained.source, "bing");
    assert.equal(chained.results.length, 2);

    // http-json provider.
    const json = await webSearch({
      query: "clima",
      provider: "mine",
      providers: { mine: { type: "http-json", url: "http://search.local/query", apiKey: "k" } },
      fetchImpl: async (url, init) => {
        assert.equal(url, "http://search.local/query");
        assert.equal(init.headers.Authorization, "Bearer k");
        return makeFakeResponse({ body: { results: [{ title: "T", url: "https://e.com", snippet: "S" }] } });
      },
    });
    assert.equal(json.ok, true);
    assert.equal(json.source, "mine");

    // Total failure is reported, not thrown.
    const failed = await webSearch({
      query: "x",
      providers: { a: { type: "duckduckgo" }, b: { type: "bing" } },
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.results, []);
    // 0.4.0 also tries the built-in engines before giving up, so the list can
    // contain more errors than the explicitly configured providers.
    assert.ok(failed.errors.some((error) => error.startsWith("a: ")));
    assert.ok(failed.errors.some((error) => error.startsWith("b: ")));
    assert.ok(Array.isArray(failed.providersTried));

    await assert.rejects(() => webSearch(""), /A search query is required/);

    checks.websearch = true;
  })();

  // 6. ia.js conversions ---------------------------------------------------
  check("ia-conversions", () => {
    const { normalizeContentParts, toOpenAIMessages, convertToAnthropicMessages, convertToGeminiContents } = __internalIAForTests;

    // Base64 payloads must look like base64 (>=16 chars): the normaliser rejects
    // short strings, which is the guard that keeps a plain text part from being
    // mistaken for an image.
    const pngBase64 = Buffer.from("fake-image-png-bytes").toString("base64");
    const jpegBase64 = Buffer.from("fake-image-jpeg-bytes").toString("base64");
    const webpBase64 = Buffer.from("fake-image-webp-bytes").toString("base64");

    const contentParts = [
      { type: "text", text: "hola" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64}` } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
      { type: "image", inlineData: { mimeType: "image/webp", data: webpBase64 } },
    ];

    const parts = normalizeContentParts(contentParts);
    assert.equal(parts.text, "hola");
    assert.equal(parts.images.length, 3);
    assert.deepEqual(parts.images.map((image) => image.mimeType), ["image/png", "image/jpeg", "image/webp"]);

    const openai = toOpenAIMessages([{ role: "user", content: contentParts }]);
    assert.equal(openai[0].content[0].type, "text");
    assert.equal(openai[0].content[1].type, "image_url");
    assert.equal(openai[0].content[1].image_url.url, `data:image/png;base64,${pngBase64}`);

    const anthropic = convertToAnthropicMessages([{ role: "user", content: contentParts }], null);
    assert.equal(anthropic.messages[0].content[2].source.media_type, "image/jpeg");

    const gemini = convertToGeminiContents([{ role: "user", content: contentParts }]);
    assert.equal(gemini[0].role, "user");
    assert.deepEqual(gemini[0].parts[1].inlineData, { mimeType: "image/png", data: pngBase64 });

    // Top-level images are appended to the last user message.
    const merged = __internalIAForTests.appendImagesToMessages(
      [{ role: "system", content: "s" }, { role: "user", content: "mira" }],
      [{ mimeType: "image/png", data: Buffer.from("x") }],
    );
    assert.equal(merged.at(-1).content[1].type, "image");
  });

  // 7. askAgent with a fake OpenAI-compatible server -----------------------
  const openai = await startFakeOpenAI((body) => textReply("respuesta simple"));
  try {
    const provider = {
      provider: "openai-compatible",
      baseUrl: openai.baseUrl,
      apiKey: "test-key",
      model: "fake-model",
    };

    const plain = await askAgent({
      provider,
      messages: [{ role: "user", content: "hola" }],
      preSearch: false,
    });
    assert.equal(plain.text, "respuesta simple");
    assert.equal(plain.usedWeb, false);
    assert.equal(plain.hasTools, false);
    assert.equal(openai.requests.at(-1).body.messages.length, 1);
    checks.agentPlain = true;

    // Images reach the provider as image_url parts.
    const withImage = await askAgent({
      provider,
      messages: [{ role: "user", content: "describe esto" }],
      images: [{ mimeType: "image/png", data: Buffer.from("fake-png") }],
      preSearch: false,
    });
    assert.equal(withImage.text, "respuesta simple");
    assert.equal(withImage.hasTools, false);
    const lastUser = openai.requests.at(-1).body.messages.at(-1);
    assert.ok(Array.isArray(lastUser.content));
    assert.equal(lastUser.content[0].type, "text");
    assert.equal(lastUser.content[1].type, "image_url");
    assert.match(lastUser.content[1].image_url.url, /^data:image\/png;base64,/);
    checks.agentImages = true;

    // Documents are extracted and injected before the model call.
    const withDoc = await askAgent({
      provider,
      messages: [{ role: "user", content: "resume este documento" }],
      documents: [{ data: docx, fileName: "test.docx" }],
      preSearch: false,
    });
    assert.equal(withDoc.text, "respuesta simple");
    const docPrompt = JSON.stringify(openai.requests.at(-1).body.messages);
    assert.match(docPrompt, /DOCUMENTO ADJUNTO/);
    assert.match(docPrompt, /Hola desde DOCX/);
    checks.agentDocuments = true;

    // Unsupported document fails loudly instead of answering empty.
    await assert.rejects(
      () => askAgent({
        provider,
        messages: [{ role: "user", content: "lee esto" }],
        documents: [{ data: Buffer.from("PK"), fileName: "hoja.xlsx" }],
      }),
      (error) => error.code === "DOCUMENT_UNSUPPORTED",
    );

    // Deterministic pre-search injects the recap.
    const fakeWeb = async () => makeFakeResponse({ contentType: "text/html", body: DDG_HTML });
    const preSearched = await askAgent({
      provider,
      messages: [{ role: "user", content: "Busca en internet el clima en quito para manana" }],
      preSearch: "auto",
      webSearch: { fetchImpl: fakeWeb },
      includeDiagnostics: true,
    });
    assert.equal(preSearched.usedWeb, true);
    assert.equal(preSearched.webSource, "duckduckgo");
    assert.equal(preSearched.webQuery, "el clima en quito para manana");
    assert.equal(preSearched.webResults.length, 2);
    assert.match(JSON.stringify(openai.requests.at(-1).body.messages), /WEB SEARCH RESULTS/);
    assert.match(JSON.stringify(openai.requests.at(-1).body.messages), /22 grados/);
    checks.agentPreSearch = true;
  } finally {
    await openai.close();
  }

  // Tool loop: the model asks for web_search, the harness runs it, then answers.
  const toolServer = await startFakeOpenAI((body) => {
    const hasToolResult = Array.isArray(body.messages) && body.messages.some((message) => message.role === "tool");
    if (!hasToolResult) {
      return toolReply("web_search", { query: "clima quito" });
    }
    return textReply("El clima en Quito es soleado (segun la busqueda).");
  });
  try {
    const result = await askAgent({
      provider: { provider: "openai-compatible", baseUrl: toolServer.baseUrl, apiKey: "k", model: "fake" },
      messages: [{ role: "user", content: "que clima hace en quito" }],
      tools: { web_search: true },
      preSearch: false,
      webSearch: { fetchImpl: async () => makeFakeResponse({ contentType: "text/html", body: DDG_HTML }) },
      includeDiagnostics: true,
    });

    assert.equal(result.text, "El clima en Quito es soleado (segun la busqueda).");
    assert.equal(result.hasTools, true);
    // 0.4.0 only exposes the detailed execution log under diagnostics.
    const executions = result.diagnostics?.toolExecutions || [];
    assert.equal(executions.length, 1);
    assert.equal(executions[0].toolName, "web_search");
    assert.equal(executions[0].isError, false);

    const toolMessage = toolServer.requests.at(-1).body.messages.find((message) => message.role === "tool");
    assert.ok(toolMessage, "the tool result must be sent back to the model");
    assert.match(toolMessage.content, /Clima en Quito/);
    checks.agentTool = true;
  } finally {
    await toolServer.close();
  }

  // One-shot tool: a second identical call is served from the first result.
  const oneShotServer = await startFakeOpenAI((body) => {
    const toolMessages = (body.messages || []).filter((message) => message.role === "tool");
    if (toolMessages.length < 2) {
      return toolReply("web_search", { query: "clima quito" }, `call_${toolMessages.length + 1}`);
    }
    return textReply("fin");
  });
  try {
    const result = await askAgent({
      provider: { provider: "openai-compatible", baseUrl: oneShotServer.baseUrl, apiKey: "k", model: "fake" },
      messages: [{ role: "user", content: "clima quito" }],
      tools: { web_search: true },
      preSearch: false,
      webSearch: { fetchImpl: async () => makeFakeResponse({ contentType: "text/html", body: DDG_HTML }) },
      includeDiagnostics: true,
    });

    assert.equal(result.text, "fin");
    const oneShotExecutions = result.diagnostics?.toolExecutions || [];
    assert.equal(oneShotExecutions.length, 2);
    assert.equal(oneShotExecutions[1].deduplicated, true);
    const secondToolMessage = oneShotServer.requests.at(-1).body.messages
      .filter((message) => message.role === "tool")
      .at(-1);
    assert.match(secondToolMessage.content, /only be used once per turn/);
    checks.agentOneShot = true;
  } finally {
    await oneShotServer.close();
  }

  // 8. Video frames (only when ffmpeg exists) ------------------------------
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
  if (hasFfmpeg) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentkit-video-"));
    try {
      const videoPath = path.join(tmpDir, "clip.mp4");
      const generated = spawnSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10",
        "-t", "1.5", "-pix_fmt", "yuv420p", videoPath,
      ], { encoding: "utf8" });
      assert.equal(generated.status, 0, `ffmpeg generate failed: ${generated.stderr}`);

      const frames = await extractVideoFrames(
        { data: await fs.readFile(videoPath), mimeType: "video/mp4" },
        { maxFrames: 2, width: 160 },
      );
      assert.ok(frames.length >= 1, "at least one frame is required");
      assert.equal(Buffer.from(frames[0], "base64").subarray(0, 2).toString("hex"), "ffd8");
      checks.videoFrames = { frames: frames.length };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  } else {
    checks.videoFrames = "skipped (no ffmpeg)";
  }

  // 9. functionVars exposure ----------------------------------------------
  check("functionvars", () => {
    const listed = listFunctionsVars({ headers: {} }, { openfusionapi: {} }, "dev");
    for (const name of [
      "askAgent",
      "AgentSession",
      "webSearch",
      "readDocument",
      "transcribeAudio",
      "synthesizeSpeech",
      "extractVideoFrames",
      "describeMediaSupport",
    ]) {
      assert.equal(typeof listed[name].fn, "function", `${name} must be exposed`);
      assert.ok(listed[name].description, `${name} must document itself`);
    }

    assert.equal(typeof listed.agentKit.fn, "object", "agentKit must be exposed as a namespace");
    assert.ok(listed.agentKit.description, "agentKit must document itself");
    assert.equal(typeof listed.agentKit.fn.askAgent, "function");
    assert.equal(typeof listed.agentKit.fn.AgentSession, "function");
    assert.equal(typeof listed.AgentSession.fn.prototype.ask, "function");

    const media = listed.describeMediaSupport.fn({ stt: { local: { type: "openai" } }, tts: {} });
    assert.equal(media.transcription.available, true);
    assert.equal(media.speech.available, false);
  });

  // 10. Opt-in live checks -------------------------------------------------
  if (process.env.AGENTKIT_LIVE === "1") {
    const live = await webSearch({ query: "quien es edwinspire", maxResults: 3, timeoutMs: 30000 });
    assert.equal(live.ok, true, `live search failed: ${live.errors?.join(" | ")}`);
    assert.ok(live.results.length > 0);
    checks.liveSearch = live.results.length;
  } else {
    checks.liveSearch = "skipped (AGENTKIT_LIVE!=1)";
  }

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
