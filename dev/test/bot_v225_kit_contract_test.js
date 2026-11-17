// Verifica que las llamadas EXACTAS que hace el bot v225 al agent kit
// funcionan con las firmas reales de src/lib/server/agentKit/.
import assert from "node:assert/strict";
import {
  createSpeechToText,
  createTextToSpeech,
  describeMediaSupport,
  extractDocumentText,
  listWebSearchEngines,
  webSearch,
  askAgent,
} from "../../src/lib/server/agentKit/index.js";

// ---- El codigo del bot, replicado tal cual ----
function safeJson(value, label) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (e) { return null; }
}

function buildSttProviders(WHISPER_URLS, appVars) {
  const custom = safeJson(appVars['$_VAR_STT_PROVIDERS'], '$_VAR_STT_PROVIDERS');
  if (custom && typeof custom === 'object') return custom;
  const out = {};
  WHISPER_URLS.forEach((url, index) => {
    out[index === 0 ? 'whisper' : 'whisper_' + (index + 1)] = {
      type: 'openai',
      baseUrl: url,
      apiKey: appVars['$_VAR_WHISPER_API_KEY'] || 'local'
    };
  });
  return out;
}

function buildTtsProviders(TTS_BASES, appVars, voice, DEFAULT_VOICE) {
  const custom = safeJson(appVars['$_VAR_TTS_PROVIDERS'], '$_VAR_TTS_PROVIDERS');
  if (custom && typeof custom === 'object') return custom;
  const out = {};
  TTS_BASES.forEach((url, index) => {
    out[index === 0 ? 'supertonic' : 'supertonic_' + (index + 1)] = {
      type: 'supertonic',
      baseUrl: url,
      voice: voice || DEFAULT_VOICE
    };
  });
  return out;
}

const WHISPER_URLS = ['http://192.168.100.126:8080/v1/audio/transcriptions'];
const TTS_BASES = ['http://192.168.100.126:8001'];
const appVars = {};

// ---- 1. STT: el bot hace `await stt.transcribe(buffer, {...})` y espera un string ----
{
  const stt = createSpeechToText({ providers: buildSttProviders(WHISPER_URLS, appVars), language: 'es' });
  assert.equal(stt.listProviders().length, 1, 'STT provider registrado');

  // Con un fetch simulado que devuelve la forma real de la API de OpenAI.
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ text: 'hola desde whisper' }),
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const stt2 = createSpeechToText({
    providers: buildSttProviders(WHISPER_URLS, appVars),
    language: 'es',
    fetchImpl: fakeFetch,
  });
  const result = await stt2.transcribe(Buffer.from('audio'), { mimeType: 'audio/ogg', fileName: 'audio.ogg' });
  // El bot hace: String((result && result.text) || '').trim()
  const text = String((result && result.text) || '').trim();
  assert.equal(text, 'hola desde whisper', 'transcribe() devuelve { text }');
  assert.equal(typeof result.provider, 'string');
}

// ---- 2. TTS: el bot hace `await tts.synthesize(text, {...})` y espera un Buffer ----
{
  const tts = createTextToSpeech({
    providers: buildTtsProviders(TTS_BASES, appVars, 'F1', 'F3'),
    language: 'es',
    format: 'mp3',
  });
  assert.equal(tts.listProviders().length, 1, 'TTS provider registrado');

  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'audio/mpeg' },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    json: async () => ({}),
  });
  const tts2 = createTextToSpeech({
    providers: buildTtsProviders(TTS_BASES, appVars, 'F1', 'F3'),
    language: 'es',
    format: 'mp3',
    fetchImpl: fakeFetch,
  });
  const result = await tts2.synthesize('hola', { voice: 'F1', language: 'es', format: 'mp3' });
  // El bot hace: const buffer = result && result.data ? result.data : null;
  const buffer = result && result.data ? result.data : null;
  assert.ok(buffer && buffer.length === 3, 'synthesize() devuelve { data: Buffer }');
  assert.equal(result.provider, 'supertonic');
}

// ---- 3. describeMediaSupport: el bot lee report.transcription/speech ----
{
  const report = describeMediaSupport({
    stt: buildSttProviders(WHISPER_URLS, appVars),
    tts: buildTtsProviders(TTS_BASES, appVars, 'F1', 'F3'),
    ffmpeg: true,
  });
  assert.equal(report.images, true);
  assert.equal(report.videoFrames, true);
  assert.equal(report.transcription.available, true);
  assert.deepEqual(report.transcription.providers, ['whisper']);
  assert.equal(report.speech.available, true);
  assert.deepEqual(report.speech.providers, ['supertonic']);
}

// ---- 4. extractDocumentText: el bot lee .text/.kind/.pages/.truncated ----
{
  const extracted = await extractDocumentText(Buffer.from('Hola mundo\nlinea 2'), {
    fileName: 'notas.txt',
    mimeType: 'text/plain',
    maxChars: 60000,
  });
  assert.equal(extracted.ok, true);
  assert.equal(extracted.kind, 'text');
  assert.ok(extracted.text.includes('Hola mundo'));
  assert.equal(extracted.truncated, false);
}

// ---- 5. webSearch: el bot usa { ok, source, results, note } ----
{
  const fakeFetch = async (url) => {
    const html = '<html><body><div class="result"><a class="result__a" href="https://example.com">Titulo</a><a class="result__snippet">Resumen</a></div></body></html>';
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => html,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
  const found = await webSearch({ query: 'noticias', maxResults: 5, timeoutMs: 5000, fetchImpl: fakeFetch });
  assert.equal(typeof found.ok, 'boolean');
  assert.ok(Array.isArray(found.results), 'webSearch devuelve results[]');
  assert.equal(typeof found.source, 'string');
}

// ---- 6. listWebSearchEngines: el bot lo llama sin argumentos ----
{
  const engines = listWebSearchEngines();
  assert.ok(Array.isArray(engines) && engines.length > 0, 'hay motores de busqueda');
}

// ---- 7. askAgent: la forma que usa externalAgentTurn ----
{
  // Un provider ollama real contra el servidor local, si esta levantado.
  const result = await askAgent({
    provider: { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://127.0.0.1:1', apiKey: 'x' },
    system: 'eres un bot',
    messages: [{ role: 'user', content: 'hola' }],
    tools: { web_search: true },
    preSearch: false,
    maxToolRounds: 1,
  }).catch((e) => e);

  // Con un baseUrl inalcanzable debe fallar con AgentError (no con TypeError),
  // lo que demuestra que la forma de la llamada es correcta.
  assert.ok(
    result instanceof Error,
    'askAgent con provider invalido falla con Error'
  );
  assert.ok(
    !/is not a function|undefined is not|Cannot read/.test(result.message),
    'askAgent no falla por una llamada mal formada: ' + result.message
  );
}

console.log(JSON.stringify({
  ok: true,
  checks: {
    stt: true,
    tts: true,
    mediaReport: true,
    documents: true,
    websearch: true,
    engines: true,
    askAgentShape: true,
  },
}, null, 2));
