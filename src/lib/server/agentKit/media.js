/**
 * Media helpers for the agent kit: images, speech-to-text, text-to-speech and
 * video frames.
 *
 * Speech providers are parameterisable registries, not hardcoded services. If a
 * registry is empty, or the caller asks for a provider that is not configured,
 * the helper throws a `MediaProviderError` with a `userMessage` that can be shown
 * verbatim: the user must be told that the capability is missing, not given a
 * silent empty answer.
 *
 * Providers implemented out of the box:
 *
 * STT: `openai` (OpenAI-compatible /v1/audio/transcriptions), `generic`
 *      (a single URL that accepts multipart and returns {text}), `deepgram`.
 * TTS: `openai` (/v1/audio/speech), `supertonic` (/v1/tts JSON), `elevenlabs`.
 *
 * Any of them can be registered with `registerSttProviderType` /
 * `registerTtsProviderType` when a deployment needs a different vendor.
 */

import { spawn } from "node:child_process";
import { guessMimeTypeFromName, normalizeBinaryDescriptor, toDataUrl } from "./buffers.js";

const DEFAULT_TIMEOUT = 300000;
const DEFAULT_VIDEO_FRAMES = 4;
const DEFAULT_VIDEO_WIDTH = 720;
const DEFAULT_FFMPEG_TIMEOUT = 180000;

export class MediaProviderError extends Error {
	constructor(message, { code = "MEDIA_ERROR", userMessage, provider } = {}) {
		super(message);
		this.name = "MediaProviderError";
		this.code = code;
		this.userMessage = userMessage || message;
		this.provider = provider;
	}
}

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const trimSlash = (value) => String(value || "").trim().replace(/\/+$/, "");

const getFetch = (options = {}) => {
	const impl = options.fetchImpl || globalThis.fetch;
	if (typeof impl !== "function") {
		throw new MediaProviderError("No fetch implementation is available.", {
			code: "FETCH_UNAVAILABLE",
			userMessage: "El servidor no tiene disponible la funcion fetch para llamar al proveedor de medios.",
		});
	}
	return impl;
};

const withTimeoutSignal = (timeoutMs, externalSignal) => {
	const signals = [];
	if (externalSignal) {
		signals.push(externalSignal);
	}
	if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
		signals.push(AbortSignal.timeout(timeoutMs));
	}
	if (!signals.length) {
		return undefined;
	}
	if (signals.length === 1) {
		return signals[0];
	}
	return typeof AbortSignal.any === "function" ? AbortSignal.any(signals) : signals[0];
};

const readErrorBody = async (response) => {
	try {
		const text = await response.text();
		return String(text || "").slice(0, 300);
	} catch {
		return String(response?.status ?? "");
	}
};

const normalizeProviderRegistry = (providers) => {
	if (!providers) {
		return new Map();
	}

	if (providers instanceof Map) {
		return new Map(providers);
	}

	if (Array.isArray(providers)) {
		const map = new Map();
		for (const provider of providers) {
			if (isPlainObject(provider) && provider.name) {
				map.set(String(provider.name), provider);
			}
		}
		return map;
	}

	if (isPlainObject(providers)) {
		const map = new Map();
		for (const [name, provider] of Object.entries(providers)) {
			if (provider === false || provider == null) {
				continue;
			}
			map.set(name, isPlainObject(provider) ? { ...provider, name } : { name, type: String(provider) });
		}
		return map;
	}

	return new Map();
};

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const imageToDataUrl = (input, mimeType) => {
	const descriptor = normalizeBinaryDescriptor(input, { mimeType });
	return toDataUrl(descriptor.data, descriptor.mimeType);
};

export const normalizeImageList = (images) => {
	if (images == null) {
		return [];
	}
	const list = Array.isArray(images) ? images : [images];

	return list
		.filter((image) => image != null && image !== "")
		.map((image) => normalizeBinaryDescriptor(image))
		.filter((image) => image.data.length > 0);
};

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

const sttProviderTypes = new Map();

const parseTranscript = (payload) => {
	if (typeof payload === "string") {
		return payload.trim();
	}
	if (!isPlainObject(payload)) {
		return "";
	}
	const text = payload.text ?? payload.transcription ?? payload.transcript ?? payload.result;
	if (typeof text === "string") {
		return text.trim();
	}
	if (isPlainObject(payload.results)) {
		const alternative = payload.results.channels?.[0]?.alternatives?.[0];
		if (alternative && typeof alternative.transcript === "string") {
			return alternative.transcript.trim();
		}
	}
	if (Array.isArray(payload.results)) {
		const first = payload.results[0];
		if (first && typeof first.transcript === "string") {
			return first.transcript.trim();
		}
	}
	return "";
};

sttProviderTypes.set("openai", async ({ provider, data, fileName, mimeType, language, model, signal, fetchImpl }) => {
	const apiKey = provider.apiKey ?? provider.api_key;
	if (!apiKey) {
		throw new MediaProviderError(`STT provider "${provider.name}" requires an apiKey.`, {
			code: "STT_NOT_CONFIGURED",
			userMessage: "La transcripcion de audio no esta configurada: falta la clave del proveedor.",
			provider: provider.name,
		});
	}

	const base = trimSlash(provider.baseUrl ?? provider.base_url ?? provider.url);
	const url = /\/audio\/transcriptions$/i.test(base) ? base : `${base.replace(/\/v1$/i, "")}/v1/audio/transcriptions`;

	const form = new FormData();
	form.append("file", new Blob([data], { type: mimeType || "application/octet-stream" }), fileName || "audio.ogg");
	form.append("model", provider.model || model || "whisper-1");
	if (language || provider.language) {
		form.append("language", language || provider.language);
	}
	form.append("response_format", provider.responseFormat || "json");

	const response = await fetchImpl(url, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body: form,
		signal,
	});

	if (!response.ok) {
		throw new MediaProviderError(`STT HTTP ${response.status}: ${await readErrorBody(response)}`, {
			code: "STT_FAILED",
			userMessage: "No pude transcribir el audio: el servicio de transcripcion respondio con error.",
			provider: provider.name,
		});
	}

	const payload = await response.json().catch(() => null);
	const text = parseTranscript(payload);
	if (!text) {
		throw new MediaProviderError("The STT provider returned an empty transcript.", {
			code: "STT_EMPTY",
			userMessage: "No pude transcribir el audio: el servicio devolvio una transcripcion vacia.",
			provider: provider.name,
		});
	}
	return parseTranscript(payload);
});

sttProviderTypes.set("generic", async ({ provider, data, fileName, mimeType, language, model, signal, fetchImpl }) => {
	const url = provider.url ?? provider.baseUrl ?? provider.base_url;
	if (!url) {
		throw new MediaProviderError(`STT provider "${provider.name}" requires a url.`, {
			code: "STT_NOT_CONFIGURED",
			userMessage: "La transcripcion de audio no esta configurada: falta la URL del servicio.",
			provider: provider.name,
		});
	}

	const form = new FormData();
	form.append("file", new Blob([data], { type: mimeType || "application/octet-stream" }), fileName || "audio.ogg");
	form.append("model", provider.model || model || "whisper-1");
	if (language || provider.language) {
		form.append("language", language || provider.language);
	}
	form.append("response_format", provider.responseFormat || "json");

	const headers = { ...(provider.headers || {}) };
	if (provider.apiKey ?? provider.api_key) {
		headers.Authorization = `Bearer ${provider.apiKey ?? provider.api_key}`;
	}

	const response = await fetchImpl(url, { method: "POST", headers, body: form, signal });
	if (!response.ok) {
		throw new MediaProviderError(`STT HTTP ${response.status}: ${await readErrorBody(response)}`, {
			code: "STT_FAILED",
			userMessage: "No pude transcribir el audio: el servicio de transcripcion respondio con error.",
			provider: provider.name,
		});
	}

	const contentType = String(response.headers?.get?.("content-type") || "");
	const payload = contentType.includes("json") ? await response.json().catch(() => null) : await response.text();
	const text = parseTranscript(payload);
	if (!text) {
		throw new MediaProviderError("The STT provider returned an empty transcript.", {
			code: "STT_EMPTY",
			userMessage: "No pude transcribir el audio: el servicio devolvio una transcripcion vacia.",
			provider: provider.name,
		});
	}
	return text;
});

sttProviderTypes.set("deepgram", async ({ provider, data, fileName, mimeType, language, model, signal, fetchImpl }) => {
	const apiKey = provider.apiKey ?? provider.api_key;
	if (!apiKey) {
		throw new MediaProviderError(`STT provider "${provider.name}" requires an apiKey.`, {
			code: "STT_NOT_CONFIGURED",
			userMessage: "La transcripcion de audio no esta configurada: falta la clave de Deepgram.",
			provider: provider.name,
		});
	}

	const base = trimSlash(provider.baseUrl ?? provider.base_url ?? "https://api.deepgram.com");
	const query = new URLSearchParams({
		model: provider.model || model || "nova-2",
		language: language || provider.language || "es",
		smart_format: "true",
	});
	const url = `${base}/v1/listen?${query.toString()}`;

	const response = await fetchImpl(url, {
		method: "POST",
		headers: {
			Authorization: `Token ${apiKey}`,
			"Content-Type": mimeType || "application/octet-stream",
			...(provider.headers || {}),
		},
		body: data,
		signal,
	});

	if (!response.ok) {
		throw new MediaProviderError(`STT HTTP ${response.status}: ${await readErrorBody(response)}`, {
			code: "STT_FAILED",
			userMessage: "No pude transcribir el audio: Deepgram respondio con error.",
			provider: provider.name,
		});
	}

	const payload = await response.json().catch(() => null);
	const text = parseTranscript(payload);
	if (!text) {
		throw new MediaProviderError("The STT provider returned an empty transcript.", {
			code: "STT_EMPTY",
			userMessage: "No pude transcribir el audio: el servicio devolvio una transcripcion vacia.",
			provider: provider.name,
		});
	}
	return text;
});

export const registerSttProviderType = (type, handler) => {
	if (typeof type !== "string" || !type.trim() || typeof handler !== "function") {
		throw new Error("registerSttProviderType requires a name and a handler function.");
	}
	sttProviderTypes.set(type.trim().toLowerCase(), handler);
};

export const listSttProviderTypes = () => Array.from(sttProviderTypes.keys());

export class SpeechToText {
	constructor({
		providers,
		defaultProvider,
		language = "es",
		model = "whisper-1",
		timeoutMs = DEFAULT_TIMEOUT,
		fetchImpl,
	} = {}) {
		this.providers = normalizeProviderRegistry(providers);
		this.defaultProvider = defaultProvider ? String(defaultProvider) : undefined;
		this.language = language;
		this.model = model;
		this.timeoutMs = timeoutMs;
		this.fetchImpl = fetchImpl;
	}

	listProviders() {
		return Array.from(this.providers.keys());
	}

	hasProviders() {
		return this.providers.size > 0;
	}

	/**
	 * @param {Buffer|Uint8Array|ArrayBuffer|string|{data?: any, mimeType?: string, fileName?: string}} input
	 * @param {{provider?: string, language?: string, fileName?: string, mimeType?: string, signal?: AbortSignal}} [options]
	 * @returns {Promise<{text: string, provider: string, mimeType: string, fileName: string}>}
	 */
	async transcribe(input, options = {}) {
		if (!this.providers.size) {
			throw new MediaProviderError("Speech-to-text is not configured.", {
				code: "STT_NOT_CONFIGURED",
				userMessage: "La transcripcion de audio no esta configurada en este servidor. Configura un proveedor STT para procesar notas de voz.",
			});
		}

		const descriptor = normalizeBinaryDescriptor(input, {
			mimeType: options.mimeType,
			fileName: options.fileName,
		});
		const providerName = options.provider || this.defaultProvider || this.providers.keys().next().value;
		const provider = this.providers.get(providerName);

		if (!provider) {
			throw new MediaProviderError(`Unknown STT provider: ${providerName}.`, {
				code: "STT_PROVIDER_UNKNOWN",
				userMessage: `El proveedor de transcripcion "${providerName}" no esta configurado. Disponibles: ${this.listProviders().join(", ") || "ninguno"}.`,
				provider: providerName,
			});
		}

		const type = String(provider.type || "openai").toLowerCase();
		const handler = sttProviderTypes.get(type);
		if (!handler) {
			throw new MediaProviderError(`Unsupported STT provider type: ${type}.`, {
				code: "STT_TYPE_UNSUPPORTED",
				userMessage: `El tipo de proveedor de transcripcion "${type}" no esta soportado. Soportados: ${listSttProviderTypes().join(", ")}.`,
				provider: providerName,
			});
		}

		const fetchImpl = getFetch({ fetchImpl: this.fetchImpl });
		const signal = withTimeoutSignal(Number(provider.timeoutMs ?? this.timeoutMs), options.signal);
		const fileName = descriptor.fileName || `audio.${descriptor.mimeType.startsWith("video/") ? "mp4" : "ogg"}`;

		const text = await handler({
			provider: { ...provider, name: providerName },
			data: descriptor.data,
			mimeType: descriptor.mimeType || guessMimeTypeFromName(fileName),
			fileName,
			language: options.language ?? this.language,
			model: provider.model || this.model,
			signal,
			fetchImpl,
		});

		return {
			text: String(text).trim(),
			provider: providerName,
			mimeType: descriptor.mimeType,
			fileName,
		};
	}
}

export const createSpeechToText = (options = {}) => new SpeechToText(options);

// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

const ttsProviderTypes = new Map();

const audioBufferFromResponse = async (response) => {
	const contentType = String(response.headers?.get?.("content-type") || "");
	const arrayBuffer = await response.arrayBuffer();
	const data = Buffer.from(arrayBuffer);

	if (contentType.includes("json")) {
		const payload = JSON.parse(data.toString("utf8") || "{}");
		const base64 = payload.audio_base64 ?? payload.audio ?? payload.data;
		if (typeof base64 === "string" && base64.length > 0) {
			return { data: Buffer.from(base64, "base64"), mimeType: "audio/mpeg" };
		}
		throw new MediaProviderError("The TTS provider returned JSON without audio.", {
			code: "TTS_EMPTY",
			userMessage: "El servicio de voz devolvio una respuesta sin audio.",
		});
	}

	if (!data.length) {
		throw new MediaProviderError("The TTS provider returned empty audio.", {
			code: "TTS_EMPTY",
			userMessage: "El servicio de voz devolvio un audio vacio.",
		});
	}

	return { data, mimeType: contentType.split(";")[0].trim() || "audio/mpeg" };
};

ttsProviderTypes.set("supertonic", async ({ provider, text, voice, language, format, speed, signal, fetchImpl }) => {
	const base = trimSlash(provider.baseUrl ?? provider.base_url ?? provider.url);
	if (!base) {
		throw new MediaProviderError(`TTS provider "${provider.name}" requires a baseUrl.`, {
			code: "TTS_NOT_CONFIGURED",
			userMessage: "La sintesis de voz no esta configurada: falta la URL del servicio.",
			provider: provider.name,
		});
	}

	const url = /\/tts$/i.test(base) ? base : `${base}/v1/tts`;
	const response = await fetchImpl(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...(provider.headers || {}) },
		body: JSON.stringify({
			text,
			voice: voice || provider.voice,
			lang: language || provider.lang || provider.language || "es",
			response_format: format || provider.format || "mp3",
			speed: Number.isFinite(speed) ? speed : (provider.speed ?? 1),
		}),
		signal,
	});

	if (!response.ok) {
		throw new MediaProviderError(`TTS HTTP ${response.status}: ${await readErrorBody(response)}`, {
			code: "TTS_FAILED",
			userMessage: "No pude generar el audio: el servicio de voz respondio con error.",
			provider: provider.name,
		});
	}

	return audioBufferFromResponse(response);
});

ttsProviderTypes.set("openai", async ({ provider, text, voice, format, speed, signal, fetchImpl }) => {
	const apiKey = provider.apiKey ?? provider.api_key;
	if (!apiKey) {
		throw new MediaProviderError(`TTS provider "${provider.name}" requires an apiKey.`, {
			code: "TTS_NOT_CONFIGURED",
			userMessage: "La sintesis de voz no esta configurada: falta la clave del proveedor.",
			provider: provider.name,
		});
	}

	const base = trimSlash(provider.baseUrl ?? provider.base_url ?? "https://api.openai.com");
	const url = /\/audio\/speech$/i.test(base) ? base : `${base.replace(/\/v1$/i, "")}/v1/audio/speech`;

	const response = await fetchImpl(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...(provider.headers || {}),
		},
		body: JSON.stringify({
			model: provider.model || "gpt-4o-mini-tts",
			input: text,
			voice: voice || provider.voice || "alloy",
			response_format: format || provider.format || "mp3",
			...(Number.isFinite(speed) ? { speed } : {}),
		}),
		signal,
	});

	if (!response.ok) {
		throw new MediaProviderError(`TTS HTTP ${response.status}: ${await readErrorBody(response)}`, {
			code: "TTS_FAILED",
			userMessage: "No pude generar el audio: el proveedor de voz respondio con error.",
			provider: provider.name,
		});
	}

	return audioBufferFromResponse(response);
});

ttsProviderTypes.set("elevenlabs", async ({ provider, text, voice, format, signal, fetchImpl }) => {
	const apiKey = provider.apiKey ?? provider.api_key;
	const voiceId = voice || provider.voiceId || provider.voice_id;
	if (!apiKey || !voiceId) {
		throw new MediaProviderError(`TTS provider "${provider.name}" requires an apiKey and a voiceId.`, {
			code: "TTS_NOT_CONFIGURED",
			userMessage: "La sintesis de voz no esta configurada: falta la clave o la voz de ElevenLabs.",
			provider: provider.name,
		});
	}

	const base = trimSlash(provider.baseUrl ?? provider.base_url ?? "https://api.elevenlabs.io");
	const outputFormat = format === "wav" ? "pcm_16000" : "mp3_44100_128";
	const response = await fetchImpl(`${base}/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`, {
		method: "POST",
		headers: {
			"xi-api-key": apiKey,
			"Content-Type": "application/json",
			...(provider.headers || {}),
		},
		body: JSON.stringify({
			text,
			model_id: provider.model || "eleven_multilingual_v2",
			voice_settings: provider.voiceSettings || { stability: 0.5, similarity_boost: 0.75 },
		}),
		signal,
	});

	if (!response.ok) {
		throw new MediaProviderError(`TTS HTTP ${response.status}: ${await readErrorBody(response)}`, {
			code: "TTS_FAILED",
			userMessage: "No pude generar el audio: ElevenLabs respondio con error.",
			provider: provider.name,
		});
	}

	return audioBufferFromResponse(response);
});

export const registerTtsProviderType = (type, handler) => {
	if (typeof type !== "string" || !type.trim() || typeof handler !== "function") {
		throw new Error("registerTtsProviderType requires a name and a handler function.");
	}
	ttsProviderTypes.set(type.trim().toLowerCase(), handler);
};

export const listTtsProviderTypes = () => Array.from(ttsProviderTypes.keys());

export class TextToSpeech {
	constructor({
		providers,
		defaultProvider,
		language = "es",
		voice,
		format = "mp3",
		timeoutMs = DEFAULT_TIMEOUT,
		fetchImpl,
	} = {}) {
		this.providers = normalizeProviderRegistry(providers);
		this.defaultProvider = defaultProvider ? String(defaultProvider) : undefined;
		this.language = language;
		this.voice = voice;
		this.format = format;
		this.timeoutMs = timeoutMs;
		this.fetchImpl = fetchImpl;
	}

	listProviders() {
		return Array.from(this.providers.keys());
	}

	hasProviders() {
		return this.providers.size > 0;
	}

	/**
	 * @param {string} text
	 * @param {{provider?: string, voice?: string, language?: string, format?: string, speed?: number, signal?: AbortSignal}} [options]
	 * @returns {Promise<{data: Buffer, mimeType: string, provider: string}>}
	 */
	async synthesize(text, options = {}) {
		const input = String(text || "").trim();
		if (!input) {
			throw new MediaProviderError("Text is required to synthesize speech.", {
				code: "TTS_EMPTY_INPUT",
				userMessage: "No hay texto para convertir en audio.",
			});
		}

		if (!this.providers.size) {
			throw new MediaProviderError("Text-to-speech is not configured.", {
				code: "TTS_NOT_CONFIGURED",
				userMessage: "La sintesis de voz no esta configurada en este servidor. Configura un proveedor TTS para responder con audio.",
			});
		}

		const providerName = options.provider || this.defaultProvider || this.providers.keys().next().value;
		const provider = this.providers.get(providerName);

		if (!provider) {
			throw new MediaProviderError(`Unknown TTS provider: ${providerName}.`, {
				code: "TTS_PROVIDER_UNKNOWN",
				userMessage: `El proveedor de voz "${providerName}" no esta configurado. Disponibles: ${this.listProviders().join(", ") || "ninguno"}.`,
				provider: providerName,
			});
		}

		const type = String(provider.type || "openai").toLowerCase();
		const handler = ttsProviderTypes.get(type);
		if (!handler) {
			throw new MediaProviderError(`Unsupported TTS provider type: ${type}.`, {
				code: "TTS_TYPE_UNSUPPORTED",
				userMessage: `El tipo de proveedor de voz "${type}" no esta soportado. Soportados: ${listTtsProviderTypes().join(", ")}.`,
				provider: providerName,
			});
		}

		const fetchImpl = getFetch({ fetchImpl: this.fetchImpl });
		const signal = withTimeoutSignal(Number(provider.timeoutMs ?? this.timeoutMs), options.signal);

		const result = await handler({
			provider: { ...provider, name: providerName },
			text: input,
			voice: options.voice ?? this.voice ?? provider.voice,
			language: options.language ?? this.language,
			format: options.format ?? this.format,
			speed: options.speed,
			signal,
			fetchImpl,
		});

		return { ...result, provider: providerName };
	}
}

export const createTextToSpeech = (options = {}) => new TextToSpeech(options);

// ---------------------------------------------------------------------------
// Video: in-memory ffmpeg frames
// ---------------------------------------------------------------------------

class ProcessError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = "ProcessError";
		Object.assign(this, details);
	}
}

/**
 * Runs a binary with an argument array (`shell:false`) and buffer stdin/stdout.
 * stdin errors are swallowed on purpose: ffmpeg/ffprobe exit before consuming the
 * whole pipe, and an unhandled EPIPE used to take the whole worker down.
 */
export const runProcess = (command, args, {
	stdin,
	timeoutMs = DEFAULT_FFMPEG_TIMEOUT,
	maxStdoutBytes = 16 * 1024 * 1024,
} = {}) => new Promise((resolve, reject) => {
	let child;
	try {
		child = spawn(command, Array.isArray(args) ? args : [], { shell: false, stdio: ["pipe", "pipe", "pipe"] });
	} catch (error) {
		reject(new ProcessError(`${command} could not start: ${error?.message || error}`, { code: error?.code }));
		return;
	}

	const stdoutChunks = [];
	let stdoutBytes = 0;
	const stderrChunks = [];
	let stderrBytes = 0;
	let timedOut = false;
	let settled = false;

	const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
		? setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs)
		: null;
	if (timer?.unref) {
		timer.unref();
	}

	child.stdout?.on("data", (chunk) => {
		if (stdoutBytes < maxStdoutBytes) {
			stdoutChunks.push(chunk);
			stdoutBytes += chunk.length;
		}
	});

	child.stderr?.on("data", (chunk) => {
		if (stderrBytes < 1024 * 1024) {
			stderrChunks.push(chunk);
			stderrBytes += chunk.length;
		}
	});

	child.on("error", (error) => {
		if (settled) {
			return;
		}
		settled = true;
		if (timer) {
			clearTimeout(timer);
		}
		const message = error?.code === "ENOENT"
			? `${command} binary not found in PATH. Install ${command} on the server to process video.`
			: `${command} failed: ${error?.message || error}`;
		reject(new ProcessError(message, { code: error?.code }));
	});

	child.on("close", (code) => {
		if (settled) {
			return;
		}
		settled = true;
		if (timer) {
			clearTimeout(timer);
		}
		resolve({
			ok: code === 0 && !timedOut,
			code,
			timedOut,
			stdout: Buffer.concat(stdoutChunks, Math.min(stdoutBytes, maxStdoutBytes)),
			stderr: Buffer.concat(stderrChunks, stderrBytes).toString("utf8").trim(),
		});
	});

	if (stdin != null && child.stdin) {
		child.stdin.on("error", () => {
			// EPIPE when the child exits early; the exit code carries the real error.
		});
		child.stdin.end(Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin));
	} else {
		child.stdin?.end();
	}
});

const MP4_CONTAINERS = ["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex", "moof", "traf"];

const readMp4Atoms = (buffer, start, end) => {
	const atoms = [];
	let pointer = start;

	while (pointer + 8 <= end) {
		let size = buffer.readUInt32BE(pointer);
		const type = buffer.toString("latin1", pointer + 4, pointer + 8);
		let header = 8;

		if (size === 1) {
			if (pointer + 16 > end) {
				break;
			}
			size = Number(buffer.readBigUInt64BE(pointer + 8));
			header = 16;
		} else if (size === 0) {
			size = end - pointer;
		}

		if (size < header || pointer + size > end) {
			break;
		}

		atoms.push({ type, start: pointer, size, header });
		pointer += size;
	}

	return atoms;
};

const shiftChunkOffsets = (buffer, start, end, delta) => {
	let pointer = start;

	while (pointer + 8 <= end) {
		let size = buffer.readUInt32BE(pointer);
		const type = buffer.toString("latin1", pointer + 4, pointer + 8);
		let header = 8;

		if (size === 1) {
			if (pointer + 16 > end) {
				break;
			}
			size = Number(buffer.readBigUInt64BE(pointer + 8));
			header = 16;
		} else if (size === 0) {
			size = end - pointer;
		}

		if (size < header || pointer + size > end) {
			break;
		}

		const body = pointer + header;
		const bodyEnd = pointer + size;

		if (type === "stco" && body + 8 <= bodyEnd) {
			const count = buffer.readUInt32BE(body + 4);
			let cursor = body + 8;
			for (let index = 0; index < count && cursor + 4 <= bodyEnd; index += 1, cursor += 4) {
				buffer.writeUInt32BE((buffer.readUInt32BE(cursor) + delta) >>> 0, cursor);
			}
		} else if (type === "co64" && body + 8 <= bodyEnd) {
			const count = buffer.readUInt32BE(body + 4);
			let cursor = body + 8;
			for (let index = 0; index < count && cursor + 8 <= bodyEnd; index += 1, cursor += 8) {
				buffer.writeBigUInt64BE(buffer.readBigUInt64BE(cursor) + BigInt(delta), cursor);
			}
		} else if (MP4_CONTAINERS.includes(type)) {
			shiftChunkOffsets(buffer, body, bodyEnd, delta);
		}

		pointer += size;
	}
};

/** Moves the `moov` atom before `mdat` so ffmpeg can read from a pipe. */
export const mp4Faststart = (buffer) => {
	if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
		return buffer;
	}
	if (buffer.toString("latin1", 4, 8) !== "ftyp") {
		return buffer;
	}

	const atoms = readMp4Atoms(buffer, 0, buffer.length);
	const firstMdat = atoms.findIndex((atom) => atom.type === "mdat");
	const moovIndex = atoms.findIndex((atom) => atom.type === "moov");

	if (firstMdat < 0 || moovIndex < 0 || moovIndex < firstMdat) {
		return buffer;
	}

	const moov = atoms[moovIndex];
	const order = [];
	for (let index = 0; index < atoms.length; index += 1) {
		if (index === moovIndex) {
			continue;
		}
		if (index === firstMdat) {
			order.push(moov);
		}
		order.push(atoms[index]);
	}

	const output = Buffer.allocUnsafe(buffer.length);
	let pointer = 0;

	for (const atom of order) {
		buffer.copy(output, pointer, atom.start, atom.start + atom.size);
		if (atom === moov) {
			shiftChunkOffsets(output, pointer, pointer + moov.size, moov.size);
		}
		pointer += atom.size;
	}

	return pointer === buffer.length ? output : buffer;
};

/** Exact clip duration from the MP4 `mvhd` atom. */
export const mp4Duration = (buffer) => {
	if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
		return 0;
	}

	const atoms = readMp4Atoms(buffer, 0, buffer.length);
	const moov = atoms.find((atom) => atom.type === "moov");
	if (!moov) {
		return 0;
	}

	const inner = readMp4Atoms(buffer, moov.start + moov.header, moov.start + moov.size);
	const mvhd = inner.find((atom) => atom.type === "mvhd");
	if (!mvhd) {
		return 0;
	}

	const pointer = mvhd.start + mvhd.header;
	const end = mvhd.start + mvhd.size;
	const version = buffer[pointer];

	if (version === 1 && pointer + 32 <= end) {
		const timescale = buffer.readUInt32BE(pointer + 20);
		const duration = Number(buffer.readBigUInt64BE(pointer + 24));
		return timescale > 0 ? duration / timescale : 0;
	}

	if (pointer + 20 <= end) {
		const timescale = buffer.readUInt32BE(pointer + 12);
		const duration = buffer.readUInt32BE(pointer + 16);
		return timescale > 0 ? duration / timescale : 0;
	}

	return 0;
};

export const splitJpegStream = (buffer, maxFrames = DEFAULT_VIDEO_FRAMES) => {
	const frames = [];
	let start = -1;

	// `index + 1 < length`, not `+ 2`: the last frame's EOI can be the final two
	// bytes of the ffmpeg stream, and the old bound silently dropped it.
	for (let index = 0; index + 1 < buffer.length; index += 1) {
		if (buffer[index] !== 0xff) {
			continue;
		}

		const next = buffer[index + 1];

		if (next === 0xd8 && start < 0 && index + 2 < buffer.length && buffer[index + 2] === 0xff) {
			start = index;
			index += 1;
		} else if (next === 0xd9 && start >= 0) {
			frames.push(buffer.subarray(start, index + 2));
			start = -1;
			index += 1;
			if (frames.length >= maxFrames) {
				break;
			}
		}
	}

	return frames;
};

/**
 * Extracts stills spread over the clip and returns them as base64 JPEGs.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|string|{data?: any, mimeType?: string}} input
 * @param {{maxFrames?: number, width?: number, durationSec?: number, timeoutMs?: number, ffmpegPath?: string}} [options]
 * @returns {Promise<Array<string>>} base64 JPEG frames
 */
export const extractVideoFrames = async (input, options = {}) => {
	const descriptor = normalizeBinaryDescriptor(input);
	const maxFrames = Math.max(1, Number(options.maxFrames ?? DEFAULT_VIDEO_FRAMES));
	const width = Math.max(160, Number(options.width ?? DEFAULT_VIDEO_WIDTH));
	const maxFramesOption = maxFrames;

	const prepared = mp4Faststart(descriptor.data);
	let duration = mp4Duration(prepared);
	if (!(duration > 0)) {
		duration = Number(options.durationSec) || 0;
	}
	if (!(duration > 0)) {
		duration = 6;
	}

	const step = Math.max(duration / maxFrames, 0.25);
	const filters = [
		`fps=${(1 / step).toFixed(4)},scale=${width}:-2`,
		`fps=1,select='lt(n,${maxFrames})',scale=${width}:-2`,
	];

	let lastError = null;

	for (const filter of filters) {
		const result = await runProcess(options.ffmpegPath || "ffmpeg", [
			"-hide_banner",
			"-loglevel", "error",
			"-i", "pipe:0",
			"-map", "0:v:0",
			"-an",
			"-sn",
			"-vf", filter,
			"-f", "image2pipe",
			"-vcodec", "mjpeg",
			"-q:v", "4",
			"pipe:1",
		], {
			stdin: prepared,
			timeoutMs: options.timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT,
			maxStdoutBytes: 16 * 1024 * 1024,
		}).catch((error) => {
			lastError = error;
			return null;
		});

		if (!result) {
			continue;
		}

		if (!result.ok) {
			lastError = new MediaProviderError(
				`ffmpeg failed (code=${result.code}${result.timedOut ? ", timeout" : ""}): ${String(result.stderr || "").replace(/\s+/g, " ").slice(0, 200)}`,
				{
					code: "FFMPEG_FAILED",
					userMessage: "No pude extraer fotogramas del video: ffmpeg fallo.",
				},
			);
			continue;
		}

		const frames = splitJpegStream(result.stdout, maxFramesOption);
		if (frames.length) {
			return frames.map((frame) => frame.toString("base64"));
		}

		lastError = new MediaProviderError(`ffmpeg returned no frames (duration ${duration.toFixed(1)}s).`, {
			code: "FFMPEG_NO_FRAMES",
			userMessage: "No pude extraer fotogramas del video: el archivo no contiene video legible.",
		});
	}

	throw lastError || new MediaProviderError("ffmpeg returned no frames.", {
		code: "FFMPEG_NO_FRAMES",
		userMessage: "No pude extraer fotogramas del video.",
	});
};

/**
 * Best-effort duration for audio/video, without ffprobe: MP4 `mvhd` only.
 * Returns 0 when the container is not MP4.
 */
export const mediaDuration = (input) => {
	try {
		return mp4Duration(normalizeBinaryDescriptor(input).data);
	} catch {
		return 0;
	}
};

/**
 * Describes which media capabilities exist in this deployment. Useful for a bot
 * or endpoint that must tell the user what is missing instead of failing silently.
 */
export const describeMediaSupport = ({ stt, tts, ffmpeg = true } = {}) => {
	// `normalizeProviderRegistry(...).keys()` returns a single-use iterator: materialise
	// it once, or the second `Array.from` sees an exhausted iterator.
	const sttProviders = Array.from(
		stt instanceof SpeechToText ? stt.listProviders() : normalizeProviderRegistry(stt).keys(),
	);
	const ttsProviders = Array.from(
		tts instanceof TextToSpeech ? tts.listProviders() : normalizeProviderRegistry(tts).keys(),
	);

	return {
		images: true,
		videoFrames: Boolean(ffmpeg),
		transcription: {
			available: sttProviders.length > 0,
			providers: sttProviders,
		},
		speech: {
			available: ttsProviders.length > 0,
			providers: ttsProviders,
		},
	};
};
