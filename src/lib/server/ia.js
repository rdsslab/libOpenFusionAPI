import OpenAI, { AzureOpenAI } from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
	createPartFromFunctionCall,
	createPartFromFunctionResponse,
	FunctionCallingConfigMode,
	GoogleGenAI,
} from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_CLIENT_NAME = "openfusion-ia-runtime";
const DEFAULT_CLIENT_VERSION = "1.0.0";
const DEFAULT_TIMEOUT = 60000;
const DEFAULT_MAX_TOOL_ROUNDS = 6;
const DEFAULT_PLACEHOLDER_API_KEY = "openfusion-local";
const DEFAULT_PROVIDER = "openai-compatible";
const DEFAULT_ANTHROPIC_MAX_TOKENS = 1024;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

let legacyRpcRequestId = 1;

const BUILTIN_PROVIDER_PRESETS = {
	openai: {
		provider: "openai",
		clientType: "openai-compatible",
	},
	"openai-compatible": {
		provider: "openai-compatible",
		clientType: "openai-compatible",
	},
	azure: {
		provider: "azure-openai",
		clientType: "azure-openai",
	},
	"azure-openai": {
		provider: "azure-openai",
		clientType: "azure-openai",
	},
	ollama: {
		provider: "ollama",
		clientType: "openai-compatible",
		baseUrl: "http://localhost:11434",
		apiKey: DEFAULT_PLACEHOLDER_API_KEY,
	},
	anthropic: {
		provider: "anthropic",
		clientType: "anthropic",
	},
	claude: {
		provider: "anthropic",
		clientType: "anthropic",
	},
	google: {
		provider: "google-gemini",
		clientType: "google-genai",
	},
	gemini: {
		provider: "google-gemini",
		clientType: "google-genai",
		model: DEFAULT_GEMINI_MODEL,
	},
	"google-gemini": {
		provider: "google-gemini",
		clientType: "google-genai",
		model: DEFAULT_GEMINI_MODEL,
	},
	openrouter: {
		provider: "openrouter",
		clientType: "openai-compatible",
		baseUrl: "https://openrouter.ai/api/v1",
	},
	deepseek: {
		provider: "deepseek",
		clientType: "openai-compatible",
		baseUrl: "https://api.deepseek.com/v1",
	},
	groq: {
		provider: "groq",
		clientType: "openai-compatible",
		baseUrl: "https://api.groq.com/openai/v1",
	},
	mistral: {
		provider: "mistral",
		clientType: "openai-compatible",
		baseUrl: "https://api.mistral.ai/v1",
	},
	xai: {
		provider: "xai",
		clientType: "openai-compatible",
		baseUrl: "https://api.x.ai/v1",
	},
};

export const AI_PROVIDER_PRESETS = Object.freeze({
	...BUILTIN_PROVIDER_PRESETS,
});

const providerAdapterFactories = new Map();

const isPlainObject = (value) => {
	return value != null && typeof value === "object" && !Array.isArray(value);
};

const normalizeArray = (value) => {
	if (value == null) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
};

const normalizeProviderKey = (value) => {
	if (typeof value !== "string") {
		return undefined;
	}

	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return normalized || undefined;
};

const toContentText = (value) => {
	if (typeof value === "string") {
		return value;
	}

	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (typeof item === "string") {
					return item;
				}

				if (typeof item?.text === "string") {
					return item.text;
				}

				if (typeof item?.content === "string") {
					return item.content;
				}

				return JSON.stringify(item);
			})
			.join("\n")
			.trim();
	}

	if (value == null) {
		return "";
	}

	if (typeof value === "object") {
		return JSON.stringify(value);
	}

	return String(value);
};

const safeJsonParse = (value, fallbackValue = {}) => {
	if (typeof value !== "string") {
		return value;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return fallbackValue;
	}

	try {
		return JSON.parse(trimmed);
	} catch (error) {
		return fallbackValue;
	}
};

const splitSseEvents = (text) => {
	if (typeof text !== "string" || text.trim() === "") {
		return [];
	}

	return text
		.split(/\r?\n\r?\n/g)
		.map((chunk) => chunk.trim())
		.filter(Boolean);
};

const parseSsePayloads = (text) => {
	const events = splitSseEvents(text);
	const payloads = [];

	for (const eventText of events) {
		const dataLines = eventText
			.split(/\r?\n/g)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.filter(Boolean);

		if (dataLines.length === 0) {
			continue;
		}

		const payload = safeJsonParse(dataLines.join("\n"), null);
		if (payload) {
			payloads.push(payload);
		}
	}

	return payloads;
};

const normalizeHeadersObject = (headers) => {
	if (!isPlainObject(headers)) {
		return undefined;
	}

	const normalized = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value == null) {
			continue;
		}

		normalized[key] = String(value);
	}

	return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeDefaultQueryObject = (query) => {
	if (!isPlainObject(query)) {
		return undefined;
	}

	const normalized = {};
	for (const [key, value] of Object.entries(query)) {
		if (value == null) {
			continue;
		}

		normalized[key] = String(value);
	}

	return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeToolArguments = (value) => {
	if (isPlainObject(value)) {
		return value;
	}

	const parsed = safeJsonParse(value, {});
	return isPlainObject(parsed) ? parsed : {};
};

const normalizeToolSchema = (schema) => {
	if (isPlainObject(schema)) {
		return schema;
	}

	return {
		type: "object",
		properties: {},
		additionalProperties: true,
	};
};

const stableStringify = (value) => {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}

	if (isPlainObject(value)) {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
	}

	return JSON.stringify(value);
};

const buildToolCallFingerprint = (toolName, toolArguments) => {
	return `${String(toolName || "").trim()}::${stableStringify(toolArguments ?? {})}`;
};

const normalizeOpenAIBaseUrl = (baseUrl, { preservePath = false } = {}) => {
	if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
		return undefined;
	}

	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	if (preservePath) {
		return trimmed;
	}

	return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
};

const resolveResponseTimeoutMs = (providerConfig = {}) => {
	const value = Number(
		providerConfig.responseTimeout
		?? providerConfig.response_timeout
		?? providerConfig.responseTimeoutMs
		?? providerConfig.response_timeout_ms
		?? providerConfig.runTimeout
		?? providerConfig.run_timeout,
	);

	return Number.isFinite(value) && value > 0 ? value : undefined;
};

const createAbortError = (message) => {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
};

const createExecutionSignal = (signal, timeoutMs) => {
	const signals = [];

	if (signal) {
		signals.push(signal);
	}

	if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
		signals.push(AbortSignal.timeout(timeoutMs));
	}

	if (signals.length === 0) {
		return undefined;
	}

	if (signals.length === 1) {
		return signals[0];
	}

	if (typeof AbortSignal.any === "function") {
		return AbortSignal.any(signals);
	}

	const controller = new AbortController();
	const abortWithReason = (reason) => {
		if (!controller.signal.aborted) {
			controller.abort(reason);
		}
	};

	for (const currentSignal of signals) {
		if (currentSignal.aborted) {
			abortWithReason(currentSignal.reason);
			break;
		}

		currentSignal.addEventListener("abort", () => abortWithReason(currentSignal.reason), { once: true });
	}

	return controller.signal;
};

const runWithAbortSignal = async (run, { signal, timeoutMessage } = {}) => {
	if (!signal) {
		return run();
	}

	if (signal.aborted) {
		throw signal.reason instanceof Error
			? signal.reason
			: createAbortError(timeoutMessage || "The AI request was aborted.");
	}

	return await new Promise((resolve, reject) => {
		const handleAbort = () => {
			reject(
				signal.reason instanceof Error
					? signal.reason
					: createAbortError(timeoutMessage || "The AI request was aborted."),
			);
		};

		signal.addEventListener("abort", handleAbort, { once: true });

		Promise.resolve()
			.then(run)
			.then((value) => {
				signal.removeEventListener("abort", handleAbort);
				resolve(value);
			})
			.catch((error) => {
				signal.removeEventListener("abort", handleAbort);
				reject(error);
			});
	});
};

const sanitizeToolNamePart = (value, fallbackValue) => {
	const sanitized = String(value || fallbackValue)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "");

	return sanitized || fallbackValue;
};

const isLikelyMutatingTool = (tool) => {
	const text = [tool?.name, tool?.title, tool?.description]
		.filter((value) => typeof value === "string" && value.trim() !== "")
		.join(" ")
		.toLowerCase();

	return /(create|update|upsert|delete|remove|insert|patch|write|set)/.test(text);
};

const buildToolUsageGuidance = (toolEntries) => {
	if (!Array.isArray(toolEntries) || toolEntries.length === 0) {
		return null;
	}

	const byServer = new Map();

	for (const toolEntry of toolEntries) {
		const key = `${toolEntry.serverName}::${toolEntry.serverUrl}`;
		if (!byServer.has(key)) {
			byServer.set(key, {
				serverName: toolEntry.serverName,
				serverUrl: toolEntry.serverUrl,
				readOnly: [],
				mutating: [],
			});
		}

		const bucket = byServer.get(key);
		if (isLikelyMutatingTool(toolEntry)) {
			bucket.mutating.push(toolEntry.toolName);
		} else {
			bucket.readOnly.push(toolEntry.toolName);
		}
	}

	const lines = [
		"Rules for tool usage:",
		"- Use tools only when they provide real data or perform an action that is necessary to answer.",
		"- After a tool returns useful data, answer the user with that result instead of calling the same tool again.",
		"- If you can answer correctly with general knowledge and do not need external data, answer directly without using tools.",
		"- If the request is informational or read-only, prefer read-only tools.",
		"- Do not repeat the same tool call with the same arguments unless the previous result was empty, incomplete, or failed.",
		"- Use state-changing tools only when the user explicitly asks to create, update, delete, or change something.",
		"- If a tool fails validation or does not fit the context, try a more appropriate tool before responding.",
		"- Base the decision on each tool's name, description, and input schema.",
		"- Never respond with JSON that merely describes a tool call; either execute the tool for real or provide the final answer to the user.",
		"Available tool sources:",
	];

	for (const server of byServer.values()) {
		lines.push(`- ${server.serverName}:`);
		if (server.serverUrl) {
			lines.push(`  URL: ${server.serverUrl}`);
		}
		lines.push(`  Read-only: ${server.readOnly.join(", ") || "none"}`);
		lines.push(`  Mutating: ${server.mutating.join(", ") || "none"}`);
	}

	return lines.join("\n");
};

const normalizePromptMessages = (prompts) => {
	const values = normalizeArray(prompts);
	const messages = [];

	for (const item of values) {
		if (typeof item === "string") {
			messages.push({ role: "user", content: item });
			continue;
		}

		if (!isPlainObject(item) || typeof item.role !== "string") {
			continue;
		}

		messages.push({
			role: item.role,
			content: item.content ?? "",
			name: item.name,
		});
	}

	return messages;
};

const normalizeMessageContentToString = (value) => {
	return toContentText(value).trim();
};

const DATA_URL_PATTERN = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i;

const isDataUrlValue = (value) => typeof value === "string" && /^data:/i.test(value.trim());

const parseDataUrlValue = (value) => {
	const match = String(value || "").trim().match(DATA_URL_PATTERN);
	if (!match) {
		return null;
	}

	const isBase64 = Boolean(match[2]);
	const payload = match[3] || "";
	let base64 = payload;

	if (!isBase64) {
		try {
			base64 = Buffer.from(decodeURIComponent(payload), "utf8").toString("base64");
		} catch (error) {
			base64 = Buffer.from(payload, "utf8").toString("base64");
		}
	}

	return {
		mimeType: (match[1] || "application/octet-stream").trim(),
		base64: base64.replace(/\s+/g, ""),
	};
};

const isLikelyBase64 = (value) => typeof value === "string"
	&& value.replace(/\s+/g, "").length >= 16
	&& /^[A-Za-z0-9+/=]+$/.test(value.replace(/\s+/g, ""));

/**
 * Normalises one image-ish value into `{ mimeType, base64 }` or `{ mimeType, url }`.
 * Accepts data URLs, http(s) URLs, Buffers, base64 strings and provider-native
 * shapes (OpenAI image_url, Anthropic image+source, Gemini inlineData).
 */
const normalizeImageDescriptor = (value, fallbackMimeType = "image/jpeg") => {
	if (value == null) {
		return null;
	}

	if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
		return { mimeType: fallbackMimeType, base64: value.toString("base64") };
	}

	if (value instanceof Uint8Array) {
		return { mimeType: fallbackMimeType, base64: Buffer.from(value).toString("base64") };
	}

	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}
		if (isDataUrlValue(trimmed)) {
			const parsed = parseDataUrlValue(trimmed);
			return parsed ? { mimeType: parsed.mimeType, base64: parsed.base64 } : null;
		}
		if (/^https?:\/\//i.test(trimmed)) {
			return { mimeType: fallbackMimeType, url: trimmed };
		}
		if (isLikelyBase64(trimmed)) {
			return { mimeType: fallbackMimeType, base64: trimmed.replace(/\s+/g, "") };
		}
		return null;
	}

	if (!isPlainObject(value)) {
		return null;
	}

	const mimeType = String(
		value.mimeType
		?? value.mime_type
		?? value.mediaType
		?? value.media_type
		?? fallbackMimeType,
	).trim() || fallbackMimeType;

	if (isPlainObject(value.source)) {
		if (value.source.type === "base64" && isLikelyBase64(value.source.data)) {
			return {
				mimeType: String(value.source.media_type ?? value.source.mimeType ?? mimeType),
				base64: value.source.data.replace(/\s+/g, ""),
			};
		}
		if (value.source.type === "url" && typeof value.source.url === "string") {
			return normalizeImageDescriptor(value.source.url, mimeType);
		}
	}

	if (isPlainObject(value.inlineData)) {
		const inline = value.inlineData;
		if (isLikelyBase64(inline.data)) {
			return {
				mimeType: String(inline.mimeType ?? inline.mime_type ?? mimeType),
				base64: inline.data.replace(/\s+/g, ""),
			};
		}
	}

	if (isPlainObject(value.image_url)) {
		return normalizeImageDescriptor(value.image_url.url ?? value.image_url, mimeType);
	}

	if (typeof value.image_url === "string") {
		return normalizeImageDescriptor(value.image_url, mimeType);
	}

	if (typeof value.url === "string") {
		return normalizeImageDescriptor(value.url, mimeType);
	}

	if (typeof value.dataUrl === "string") {
		return normalizeImageDescriptor(value.dataUrl, mimeType);
	}

	if (typeof value.base64 === "string") {
		return { mimeType, base64: value.base64.replace(/\s+/g, "") };
	}

	if (typeof value.data === "string") {
		return normalizeImageDescriptor(value.data, mimeType);
	}

	if (typeof Buffer !== "undefined" && Buffer.isBuffer(value.data)) {
		return { mimeType, base64: value.data.toString("base64") };
	}

	if (value.data instanceof Uint8Array) {
		return { mimeType, base64: Buffer.from(value.data).toString("base64") };
	}

	if (typeof value.image === "string") {
		return normalizeImageDescriptor(value.image, mimeType);
	}

	return null;
};

/**
 * Splits a message content into text plus images. Content may be a string, an
 * array of parts or a provider-native object.
 */
const normalizeContentParts = (content) => {
	const textParts = [];
	const images = [];

	const collect = (part) => {
		if (part == null) {
			return;
		}

		if (typeof part === "string") {
			textParts.push(part);
			return;
		}

		if (!isPlainObject(part)) {
			return;
		}

		const type = String(part.type || "").toLowerCase();

		if (type === "text" || type === "input_text" || type === "output_text") {
			if (typeof part.text === "string") {
				textParts.push(part.text);
			} else if (typeof part.content === "string") {
				textParts.push(part.content);
			}
			return;
		}

		if (type === "image" || type === "image_url" || type === "input_image" || type === "image_base64") {
			const image = normalizeImageDescriptor(part);
			if (image) {
				images.push(image);
			}
			return;
		}

		if (isPlainObject(part.source) || isPlainObject(part.image_url) || part.inlineData || part.image || part.dataUrl) {
			const image = normalizeImageDescriptor(part);
			if (image) {
				images.push(image);
				return;
			}
		}

		if (typeof part.text === "string") {
			textParts.push(part.text);
			return;
		}

		if (typeof part.content === "string") {
			textParts.push(part.content);
		}
	};

	if (Array.isArray(content)) {
		content.forEach(collect);
	} else {
		collect(content);
	}

	return {
		text: textParts.join("\n").trim(),
		images,
	};
};

const imageDescriptorToDataUrl = (image) => {
	if (!image) {
		return undefined;
	}
	if (image.url) {
		return image.url;
	}
	return `data:${image.mimeType || "image/jpeg"};base64,${image.base64}`;
};

const normalizeImagesOption = (images) => {
	if (images == null) {
		return [];
	}

	return normalizeArray(images)
		.map((image) => normalizeImageDescriptor(image))
		.filter(Boolean);
};

/**
 * Appends top-level `images` to the last user message (or a new user message).
 * Messages keep their portable shape; each adapter converts it to its own API.
 */
const appendImagesToMessages = (messages, images) => {
	const normalizedImages = normalizeImagesOption(images);
	if (!normalizedImages.length) {
		return messages;
	}

	const output = messages.map((message) => ({ ...message }));
	let targetIndex = -1;

	for (let index = output.length - 1; index >= 0; index -= 1) {
		if (output[index].role === "user") {
			targetIndex = index;
			break;
		}
	}

	if (targetIndex < 0) {
		targetIndex = output.length;
		output.push({ role: "user", content: "" });
	}

	const target = output[targetIndex];
	const parts = normalizeContentParts(target.content);
	const contentParts = [];

	if (parts.text) {
		contentParts.push({ type: "text", text: parts.text });
	}

	for (const image of [...parts.images, ...normalizedImages]) {
		contentParts.push({
			type: "image",
			mimeType: image.mimeType || "image/jpeg",
			...(image.url ? { url: image.url } : { base64: image.base64 }),
		});
	}

	output[targetIndex] = { ...target, content: contentParts };

	return output;
};


const splitSystemMessages = (messages, extraSystemText) => {
	const systemParts = [];
	const nonSystemMessages = [];

	if (typeof extraSystemText === "string" && extraSystemText.trim() !== "") {
		systemParts.push(extraSystemText.trim());
	}

	for (const message of messages) {
		if (message.role === "system") {
			const text = normalizeMessageContentToString(message.content);
			if (text) {
				systemParts.push(text);
			}
			continue;
		}

		nonSystemMessages.push(message);
	}

	return {
		systemText: systemParts.join("\n\n").trim() || undefined,
		messages: nonSystemMessages,
	};
};

const extractAssistantToolParameters = (value) => {
	if (!isPlainObject(value)) {
		return {};
	}

	if (isPlainObject(value.parameters)) {
		return value.parameters;
	}

	if (isPlainObject(value.arguments)) {
		return value.arguments;
	}

	if (isPlainObject(value.args)) {
		return value.args;
	}

	return {};
};

const parseTaggedJsonToolIntent = (content) => {
	if (typeof content !== "string" || content.trim() === "") {
		return null;
	}

	const taggedBlocks = Array.from(
		content.matchAll(/<([a-z0-9_:-]+)>\s*([\s\S]*?)\s*<\/\1>/gi),
	);

	for (let index = taggedBlocks.length - 1; index >= 0; index -= 1) {
		const blockContent = taggedBlocks[index]?.[2]?.trim();
		const blockParsed = safeJsonParse(blockContent, null);

		if (isPlainObject(blockParsed) && typeof blockParsed.name === "string") {
			return {
				name: blockParsed.name,
				parameters: extractAssistantToolParameters(blockParsed),
			};
		}
	}

	return null;
};

const parseAssistantToolIntent = (content) => {
	if (typeof content !== "string") {
		return null;
	}

	const parsed = safeJsonParse(content, null);
	if (!isPlainObject(parsed) || typeof parsed.name !== "string") {
		const taggedIntent = parseTaggedJsonToolIntent(content);
		if (taggedIntent) {
			return taggedIntent;
		}

		const fencedBlocks = Array.from(
			content.matchAll(/```(?:json|javascript|js|python)?\s*([\s\S]*?)```/gi),
		);

		for (let index = fencedBlocks.length - 1; index >= 0; index -= 1) {
			const blockContent = fencedBlocks[index]?.[1]?.trim();
			const blockParsed = safeJsonParse(blockContent, null);

			if (isPlainObject(blockParsed) && typeof blockParsed.name === "string") {
				return {
					name: blockParsed.name,
					parameters: extractAssistantToolParameters(blockParsed),
				};
			}
		}

		return null;
	}

	return {
		name: parsed.name,
		parameters: extractAssistantToolParameters(parsed),
	};
};

const isLikelyToolCatalogDump = (content, availableTools = []) => {
	if (typeof content !== "string" || content.trim() === "") {
		return false;
	}

	const normalizedContent = content.toLowerCase();
	const hasCatalogMarker = normalizedContent.includes("<tools>")
		|| normalizedContent.includes('"type": "function"')
		|| normalizedContent.includes('"type":"function"');

	if (!hasCatalogMarker) {
		return false;
	}

	const availableNames = normalizeArray(availableTools)
		.map((tool) => tool?.function?.name)
		.filter((name) => typeof name === "string" && name.trim() !== "");

	if (availableNames.length === 0) {
		return false;
	}

	return availableNames.some((name) => content.includes(name));
};

const getRequiredToolParameters = (toolEntry) => {
	return Array.isArray(toolEntry?.inputSchema?.required)
		? toolEntry.inputSchema.required.filter((value) => typeof value === "string" && value.trim() !== "")
		: [];
};

const getToolSchemaProperties = (toolEntry) => {
	return isPlainObject(toolEntry?.inputSchema?.properties)
		? toolEntry.inputSchema.properties
		: {};
};

const extractLastUserMessageText = (messages = []) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "user") {
			continue;
		}

		const text = normalizeMessageContentToString(message.content);
		if (text) {
			return text;
		}
	}

	return "";
};

const extractFirstUrl = (text) => {
	if (typeof text !== "string") {
		return undefined;
	}

	const match = text.match(/https?:\/\/[^\s)"']+/i);
	return match?.[0];
};

const inferAutomaticReadOnlyToolCall = ({ toolEntries = [], messages = [], promptText: preferredPromptText, round = 0 } = {}) => {
	const promptText = typeof preferredPromptText === "string" && preferredPromptText.trim() !== ""
		? preferredPromptText.trim()
		: extractLastUserMessageText(messages);
	if (!promptText) {
		return null;
	}

	const normalizedPrompt = promptText.toLowerCase();
	const promptUrl = extractFirstUrl(promptText);
	const candidates = [];

	for (const toolEntry of normalizeArray(toolEntries)) {
		if (!toolEntry || isLikelyMutatingTool(toolEntry)) {
			continue;
		}

		const required = getRequiredToolParameters(toolEntry);
		const properties = getToolSchemaProperties(toolEntry);
		const descriptor = [toolEntry.toolName, toolEntry.title, toolEntry.description]
			.filter((value) => typeof value === "string" && value.trim() !== "")
			.join(" ")
			.toLowerCase();

		let argumentsValue;
		let score = 0;

		const queryOnlyShape = required.every((name) => ["query", "numResults", "maxResults"].includes(name))
			&& Object.prototype.hasOwnProperty.call(properties, "query");
		if (queryOnlyShape) {
			argumentsValue = {
				query: promptText,
			};

			if (Object.prototype.hasOwnProperty.call(properties, "numResults")) {
				argumentsValue.numResults = 5;
			}

			if (Object.prototype.hasOwnProperty.call(properties, "maxResults")) {
				argumentsValue.maxResults = 5;
			}

			score += 3;
			if (/(busca|buscar|search|find|internet|web|who is|quien es|lookup|investiga)/.test(normalizedPrompt)) {
				score += 3;
			}
			if (/(search|find|lookup|web)/.test(descriptor)) {
				score += 2;
			}
		}

		const singleUrlShape = promptUrl
			&& required.every((name) => ["url", "urls", "maxCharacters"].includes(name))
			&& (
				Object.prototype.hasOwnProperty.call(properties, "url")
				|| Object.prototype.hasOwnProperty.call(properties, "urls")
			);
		if (!argumentsValue && singleUrlShape) {
			argumentsValue = Object.prototype.hasOwnProperty.call(properties, "urls")
				? { urls: [promptUrl] }
				: { url: promptUrl };

			if (Object.prototype.hasOwnProperty.call(properties, "maxCharacters")) {
				argumentsValue.maxCharacters = 3000;
			}

			score += 3;
			if (/(fetch|read|url|webpage|page)/.test(descriptor)) {
				score += 2;
			}
		}

		if (!argumentsValue || score <= 0) {
			continue;
		}

		candidates.push({
			toolEntry,
			arguments: argumentsValue,
			score,
		});
	}

	if (candidates.length === 0) {
		return null;
	}

	candidates.sort((left, right) => right.score - left.score);
	if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
		return null;
	}

	return {
		id: `automatic_tool_fallback_${round + 1}`,
		name: candidates[0].toolEntry.alias,
		arguments: candidates[0].arguments,
	};
};

const LOW_CONFIDENCE_WEB_PATTERNS = [
	/website\s+is\s+for\s+sale/i,
	/domain\s+(?:is\s+)?for\s+sale/i,
	/buy\s+this\s+domain/i,
	/search\s+resources\s+and\s+information/i,
	/related\s+searches/i,
	/domain\s+parking/i,
	/this\s+domain\s+may\s+be\s+for\s+sale/i,
	/parkingcrew/i,
	/sedo/i,
	/afternic/i,
];

const looksLikeLowConfidenceWebText = (text) => {
	if (typeof text !== "string" || text.trim() === "") {
		return false;
	}

	return LOW_CONFIDENCE_WEB_PATTERNS.some((pattern) => pattern.test(text));
};

const hasSuccessfulToolExecution = (executionLog = []) => {
	return normalizeArray(executionLog).some((execution) => execution && execution.isError !== true);
};

const inferLowConfidenceReadOnlyRetryToolCall = ({ toolEntries = [], messages = [], promptText: preferredPromptText, round = 0 } = {}) => {
	const promptText = typeof preferredPromptText === "string" && preferredPromptText.trim() !== ""
		? preferredPromptText.trim()
		: extractLastUserMessageText(messages);
	if (!promptText) {
		return null;
	}

	return inferAutomaticReadOnlyToolCall({
		toolEntries,
		messages: [{
			role: "user",
			content: [
				promptText,
				"Prioriza fuentes oficiales o perfiles verificables.",
				"Ignora dominios en venta, paginas de parking, directorios SEO y resultados ambiguos.",
			].join(" "),
		}],
		round,
	});
};

const isAzureOpenAIConfig = (providerConfig = {}) => {
	const providerKey = normalizeProviderKey(
		providerConfig.provider
		?? providerConfig.modelProvider
		?? providerConfig.name
		?? providerConfig.vendor,
	) ?? "";
	const baseUrl = String(providerConfig.baseUrl ?? providerConfig.baseURL ?? "")
		.trim()
		.toLowerCase();

	return providerKey === "azure"
		|| providerKey === "azure-openai"
		|| providerKey === "azure_openai"
		|| baseUrl.includes(".openai.azure.com")
		|| baseUrl.includes(".cognitiveservices.azure.com/openai");
};

const resolveProviderConfig = (providerConfig = {}) => {
	if (!isPlainObject(providerConfig)) {
		throw new Error("AI provider configuration is required.");
	}

	const providerKey = normalizeProviderKey(
		providerConfig.provider
		?? providerConfig.modelProvider
		?? providerConfig.name
		?? providerConfig.vendor,
	) ?? DEFAULT_PROVIDER;

	const preset = BUILTIN_PROVIDER_PRESETS[providerKey] ?? BUILTIN_PROVIDER_PRESETS[DEFAULT_PROVIDER];
	const merged = {
		...preset,
		...providerConfig,
	};

	if (merged.provider == null) {
		merged.provider = merged.modelProvider ?? providerKey;
	}

	if (merged.modelProvider == null) {
		merged.modelProvider = merged.provider ?? providerKey;
	}

	if (merged.baseUrl == null && merged.baseURL == null && typeof preset?.baseUrl === "string") {
		merged.baseUrl = preset.baseUrl;
	}

	if (merged.apiKey == null && merged.api_key == null && typeof preset?.apiKey === "string") {
		merged.apiKey = preset.apiKey;
	}

	if (merged.model == null && typeof preset?.model === "string") {
		merged.model = preset.model;
	}

	return {
		...merged,
		providerKey,
		clientType: merged.clientType
			?? preset?.clientType
			?? (isAzureOpenAIConfig(merged) ? "azure-openai" : "openai-compatible"),
	};
};

const formatToolResult = (result) => {
	if (typeof result?.content === "string") {
		return result.content;
	}

	if (Array.isArray(result?.content)) {
		return result.content
			.map((item) => {
				if (typeof item?.text === "string") {
					return item.text;
				}

				return JSON.stringify(item);
			})
			.join("\n")
			.trim();
	}

	return JSON.stringify(result);
};

const createLegacySseRpcClient = (server) => {
	const serverUrl = server.url ?? server.serverUrl ?? server.server_url;
	const headers = normalizeHeadersObject(server.headers);
	const timeout = Number(server.timeout ?? DEFAULT_TIMEOUT);

	const rpcCall = async (method, params = {}) => {
		const response = await fetch(serverUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				...(headers || {}),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: legacyRpcRequestId++,
				method,
				params,
			}),
			signal: AbortSignal.timeout(
				Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
			),
		});

		const rawText = await response.text();
		const payloads = parseSsePayloads(rawText);
		const rpcPayload = payloads.find((payload) => isPlainObject(payload) && payload.jsonrpc === "2.0");

		if (!rpcPayload) {
			throw new Error(
				`Legacy MCP SSE fallback did not return a JSON-RPC payload. HTTP ${response.status}. Body=${rawText.slice(0, 500)}`,
			);
		}

		if (rpcPayload.error) {
			throw new Error(`Legacy MCP SSE RPC error: ${JSON.stringify(rpcPayload.error)}`);
		}

		return rpcPayload.result;
	};

	return {
		listTools: async () => rpcCall("tools/list", {}),
		callTool: async ({ name, arguments: args = {} }) => {
			return rpcCall("tools/call", {
				name,
				arguments: args,
			});
		},
		close: async () => {},
	};
};

const createTransport = async (server) => {
	const serverUrl = server.url ?? server.serverUrl ?? server.server_url;

	if (typeof serverUrl !== "string" || serverUrl.trim() === "") {
		throw new Error("Each MCP server requires a non-empty `url`.");
	}

	const baseUrl = new URL(serverUrl);
	const transportPriority = normalizeArray(server.transportPriority ?? ["streamable-http", "legacy-sse-http"]);
	const failures = [];

	for (const transportName of transportPriority) {
		try {
			if (transportName === "streamable-http") {
				return {
					transport: new StreamableHTTPClientTransport(baseUrl, {
						requestInit: {
							headers: isPlainObject(server.headers) ? server.headers : undefined,
						},
					}),
					transportType: "streamable-http",
				};
			}

			if (transportName === "legacy-sse-http") {
				return {
					transport: null,
					transportType: "legacy-sse-http",
					legacyClient: createLegacySseRpcClient({
						...server,
						url: baseUrl.href,
					}),
				};
			}
		} catch (error) {
			failures.push(`${transportName}: ${error.message}`);
		}
	}

	throw new Error(`Unable to create MCP transport for ${serverUrl}. ${failures.join(" | ")}`.trim());
};

const connectMcpServer = async (server, { clientName, clientVersion } = {}) => {
	const { transport, transportType, legacyClient } = await createTransport(server);

	if (legacyClient) {
		return {
			client: legacyClient,
			transport: { close: legacyClient.close },
			transportType,
		};
	}

	const client = new Client({
		name: clientName || DEFAULT_CLIENT_NAME,
		version: clientVersion || DEFAULT_CLIENT_VERSION,
	});

	try {
		await client.connect(transport);
	} catch (primaryError) {
		try {
			await transport.close?.();
		} catch (closeError) {}

		if (transportType === "streamable-http") {
			const fallbackClient = createLegacySseRpcClient(server);
			return {
				client: fallbackClient,
				transport: { close: fallbackClient.close },
				transportType: `legacy-sse-http-fallback (${primaryError.message})`,
			};
		}

		throw primaryError;
	}

	return { client, transport, transportType }; 
};

class MCPToolRuntime {
	constructor({
		mcpServers = [],
		toolHandlers = {},
		clientName = DEFAULT_CLIENT_NAME,
		clientVersion = DEFAULT_CLIENT_VERSION,
	} = {}) {
		this.mcpServers = normalizeArray(mcpServers).filter((item) => isPlainObject(item));
		this.toolHandlers = isPlainObject(toolHandlers) ? toolHandlers : {};
		this.clientName = clientName;
		this.clientVersion = clientVersion;
		this.serverBundles = [];
		this.toolEntries = [];
		this.toolRegistry = new Map();
		this.executionLog = [];
		this.executionCache = new Map();
		this.oneShotUsed = new Set();
		this.connected = false;
	}

	async connect() {
		if (this.connected) {
			return this;
		}

		for (const server of this.mcpServers) {
			const normalizedServer = {
				...server,
				name: server.name || new URL(server.url ?? server.serverUrl ?? server.server_url).hostname,
				url: server.url ?? server.serverUrl ?? server.server_url,
			};

			const connection = await connectMcpServer(normalizedServer, {
				clientName: this.clientName,
				clientVersion: this.clientVersion,
			});

			const listResult = await connection.client.listTools();
			const bundle = {
				...connection,
				server: normalizedServer,
				tools: Array.isArray(listResult?.tools) ? listResult.tools : [],
			};

			this.serverBundles.push(bundle);
		}

		this.toolEntries = [...this.buildLocalToolEntries(), ...this.buildToolEntries()];
		this.toolRegistry = this.buildToolRegistry(this.toolEntries);
		this.connected = true;
		return this;
	}

	/**
	 * Local tools are plain JS handlers supplied by the caller:
	 *
	 *   toolHandlers: {
	 *     web_search: {
	 *       description: "...",
	 *       inputSchema: { type: "object", properties: {...} },
	 *       handler: async (args, context) => ({...}),
	 *       policy: { oneShot: true },
	 *     },
	 *     ping: (args) => "pong",           // shorthand
	 *   }
	 *
	 * They go through the same registry, loop and diagnostics as MCP tools, so a
	 * deployment can expose local capabilities without standing up an MCP server.
	 */
	buildLocalToolEntries() {
		const entries = [];

		for (const [key, definition] of Object.entries(this.toolHandlers)) {
			const normalized = typeof definition === "function" ? { handler: definition } : definition;

			if (!isPlainObject(normalized) || normalized.enabled === false) {
				continue;
			}

			const handler = normalized.handler ?? normalized.run ?? normalized.execute;
			if (typeof handler !== "function") {
				throw new Error(`Local tool "${key}" requires a handler function.`);
			}

			const publicName = sanitizeToolNamePart(normalized.name || key, "tool");

			entries.push({
				alias: publicName,
				shortName: publicName,
				toolName: normalized.name || key,
				title: normalized.title,
				description: normalized.description || `Local tool ${key}.`,
				inputSchema: normalizeToolSchema(normalized.inputSchema ?? normalized.parameters ?? normalized.schema),
				serverName: normalized.serverName || "local",
				serverUrl: null,
				policy: isPlainObject(normalized.policy) ? normalized.policy : {},
				local: true,
				client: {
					callTool: async ({ arguments: toolArguments }) => {
						return handler(toolArguments ?? {}, { toolName: key, runtime: this });
					},
				},
			});
		}

		return entries;
	}

	buildToolEntries() {
		const entries = [];

		for (const bundle of this.serverBundles) {
			const serverKey = sanitizeToolNamePart(bundle.server.name, "mcp");

			for (const tool of bundle.tools) {
				const alias = `${serverKey}__${sanitizeToolNamePart(tool.name, "tool")}`;
				const shortName = sanitizeToolNamePart(tool.name, "tool");

				entries.push({
					alias,
					shortName,
					toolName: tool.name,
					title: tool.title,
					description: tool.description,
					inputSchema: normalizeToolSchema(tool.inputSchema),
					serverName: bundle.server.name,
					serverUrl: bundle.server.url,
					client: bundle.client,
				});
			}
		}

		return entries;
	}

	buildToolRegistry(toolEntries) {
		const registry = new Map();

		for (const toolEntry of toolEntries) {
			registry.set(toolEntry.alias, toolEntry);

			if (!registry.has(toolEntry.toolName)) {
				registry.set(toolEntry.toolName, toolEntry);
			}

			if (!registry.has(toolEntry.shortName)) {
				registry.set(toolEntry.shortName, toolEntry);
			}
		}

		return registry;
	}

	getToolUsageGuidance() {
		return buildToolUsageGuidance(this.toolEntries);
	}

	getOpenAITools() {
		return this.toolEntries.map((toolEntry) => ({
			type: "function",
			function: {
				name: toolEntry.alias,
				description: toolEntry.description || `MCP tool ${toolEntry.toolName} from server ${toolEntry.serverName}.`,
				parameters: toolEntry.inputSchema,
			},
		}));
	}

	getAnthropicTools() {
		return this.toolEntries.map((toolEntry) => ({
			name: toolEntry.alias,
			description: toolEntry.description || `MCP tool ${toolEntry.toolName} from server ${toolEntry.serverName}.`,
			input_schema: toolEntry.inputSchema,
		}));
	}

	getGeminiTools() {
		if (this.toolEntries.length === 0) {
			return [];
		}

		return [{
			functionDeclarations: this.toolEntries.map((toolEntry) => ({
				name: toolEntry.alias,
				description: toolEntry.description || `MCP tool ${toolEntry.toolName} from server ${toolEntry.serverName}.`,
				parametersJsonSchema: toolEntry.inputSchema,
			})),
		}];
	}

	getGeminiAllowedFunctionNames() {
		return this.toolEntries.map((toolEntry) => toolEntry.alias);
	}

	getToolCatalog() {
		return this.serverBundles.map((bundle) => ({
			server: {
				name: bundle.server.name,
				url: bundle.server.url,
				transport: bundle.transportType,
			},
			tools: bundle.tools,
		}));
	}

	getDiagnosticsServers() {
		return this.serverBundles.map((bundle) => ({
			name: bundle.server.name,
			url: bundle.server.url,
			transport: bundle.transportType,
			tools: bundle.tools.map((tool) => tool.name),
		}));
	}

	async executeToolCalls(toolCalls) {
		const normalizedCalls = normalizeArray(toolCalls);
		const executionResults = [];

		for (const toolCall of normalizedCalls) {
			const toolName = toolCall?.name;
			const toolEntry = this.toolRegistry.get(toolName);

			if (!toolEntry) {
				throw new Error(`The AI requested an unknown tool: ${toolName}.`);
			}

			const toolArguments = normalizeToolArguments(toolCall?.arguments);
			const fingerprint = buildToolCallFingerprint(toolEntry.toolName, toolArguments);
			const previousExecution = this.executionCache.get(fingerprint);

			// A one-shot tool (web search, for example) answers once per turn. The
			// second call gets the first result back instead of hitting the network:
			// small models otherwise repeat the same search until the round limit.
			if (toolEntry.policy?.oneShot && this.oneShotUsed.has(toolEntry.alias)) {
				const previousOneShot = [...this.executionLog]
					.reverse()
					.find((item) => item.toolAlias === toolEntry.alias && !item.isError);

				const execution = {
					callId: toolCall.id,
					toolAlias: toolEntry.alias,
					toolName: toolEntry.toolName,
					serverName: toolEntry.serverName,
					serverUrl: toolEntry.serverUrl,
					policy: toolEntry.policy,
					arguments: toolArguments,
					textResult: `This tool can only be used once per turn. Use the previous result to answer the user.\n\n${previousOneShot?.textResult || ""}`,
					rawResult: previousOneShot?.rawResult ?? null,
					isError: false,
					deduplicated: true,
				};

				this.executionLog.push(execution);
				executionResults.push(execution);
				continue;
			}

			if (previousExecution && !previousExecution.isError) {
				const execution = {
					callId: toolCall.id,
					toolAlias: toolEntry.alias,
					toolName: toolEntry.toolName,
					serverName: toolEntry.serverName,
					serverUrl: toolEntry.serverUrl,
					policy: toolEntry.policy,
					arguments: toolArguments,
					textResult: `Duplicate tool call suppressed. Reuse the previous successful result and answer the user unless you need different arguments.\n\n${previousExecution.textResult}`,
					rawResult: previousExecution.rawResult,
					isError: false,
					deduplicated: true,
					duplicateOf: previousExecution.callId,
				};

				this.executionLog.push(execution);
				executionResults.push(execution);
				continue;
			}

			try {
				const rawResult = await toolEntry.client.callTool({
					name: toolEntry.toolName,
					arguments: toolArguments,
				});
				const textResult = formatToolResult(rawResult);

				const execution = {
					callId: toolCall.id,
					toolAlias: toolEntry.alias,
					toolName: toolEntry.toolName,
					serverName: toolEntry.serverName,
					serverUrl: toolEntry.serverUrl,
					policy: toolEntry.policy,
					arguments: toolArguments,
					textResult,
					rawResult,
					isError: false,
					deduplicated: false,
				};

				this.executionLog.push(execution);
				this.executionCache.set(fingerprint, execution);
				if (toolEntry.policy?.oneShot) {
					this.oneShotUsed.add(toolEntry.alias);
				}
				executionResults.push(execution);
			} catch (error) {
				const rawResult = {
					error: error?.message || String(error),
				};
				const execution = {
					callId: toolCall.id,
					toolAlias: toolEntry.alias,
					toolName: toolEntry.toolName,
					serverName: toolEntry.serverName,
					serverUrl: toolEntry.serverUrl,
					policy: toolEntry.policy,
					arguments: toolArguments,
					textResult: `Error: ${rawResult.error}`,
					rawResult,
					isError: true,
					deduplicated: false,
				};

				this.executionLog.push(execution);
				executionResults.push(execution);
			}
		}

		return executionResults;
	}

	/**
	 * True when a successful execution asked the loop to stop (tool policy
	 * `stopAfterToolSuccess: true`). The adapter then returns the tool output as
	 * the final answer instead of asking the model again.
	 */
	shouldStopAfterToolSuccess(executions = []) {
		return normalizeArray(executions).some((execution) => {
			return execution
				&& !execution.isError
				&& !execution.deduplicated
				&& execution.policy?.stopAfterToolSuccess === true;
		});
	}

	async close() {
		for (const bundle of this.serverBundles) {
			try {
				await bundle.transport?.close?.();
			} catch (error) {}
		}

		this.serverBundles = [];
		this.toolEntries = [];
		this.toolRegistry = new Map();
		this.executionCache = new Map();
		this.oneShotUsed = new Set();
		this.connected = false;
	}
}

class BaseProviderAdapter {
	constructor(providerConfig) {
		this.providerConfig = resolveProviderConfig(providerConfig);
		this.responseTimeoutMs = resolveResponseTimeoutMs(this.providerConfig);
	}

	buildDiagnostics(includeDiagnostics, result) {
		if (!includeDiagnostics) {
			return result.text;
		}

		return result;
	}

	createRequestSignal(signal) {
		return createExecutionSignal(signal, this.responseTimeoutMs);
	}

	getTimeoutMessage() {
		if (this.responseTimeoutMs) {
			return `The AI response timed out after ${this.responseTimeoutMs}ms.`;
		}

		return "The AI request was aborted.";
	}

	async runProviderRequest(run, { signal } = {}) {
		const requestSignal = this.createRequestSignal(signal);

		return runWithAbortSignal(run, {
			signal: requestSignal,
			timeoutMessage: this.getTimeoutMessage(),
		});
	}
}

const toOpenAIMessages = (messages) => messages.map((message) => {
	if (message.role === "tool") {
		return message;
	}

	const parts = normalizeContentParts(message.content);

	if (!parts.images.length) {
		return {
			...message,
			content: parts.text,
		};
	}

	const content = [];

	if (parts.text) {
		content.push({ type: "text", text: parts.text });
	}

	for (const image of parts.images) {
		content.push({
			type: "image_url",
			image_url: { url: imageDescriptorToDataUrl(image) },
		});
	}

	return {
		...message,
		content,
	};
});

class OpenAICompatibleAdapter extends BaseProviderAdapter {
	constructor(providerConfig) {
		super(providerConfig);

		if (typeof this.providerConfig.model !== "string" || this.providerConfig.model.trim() === "") {
			throw new Error("AI provider configuration requires a non-empty `model`.");
		}

		const isAzure = this.providerConfig.clientType === "azure-openai" || isAzureOpenAIConfig(this.providerConfig);
		const baseURL = normalizeOpenAIBaseUrl(this.providerConfig.baseUrl ?? this.providerConfig.baseURL, {
			preservePath: isAzure,
		});
		const timeout = Number(this.providerConfig.timeout ?? DEFAULT_TIMEOUT);
		const azureApiKey = this.providerConfig.azureApiKey ?? this.providerConfig.azure_api_key;
		const apiVersion = this.providerConfig.apiVersion
			?? this.providerConfig.api_version
			?? this.providerConfig["api-version"];
		const apiKey = this.providerConfig.apiKey
			?? this.providerConfig.api_key
			?? azureApiKey
			?? (baseURL ? DEFAULT_PLACEHOLDER_API_KEY : undefined);

		if (!apiKey) {
			throw new Error("AI provider configuration requires `apiKey` or `baseUrl`/`baseURL`.");
		}

		const defaultHeaders = normalizeHeadersObject(this.providerConfig.headers);
		const defaultQuery = normalizeDefaultQueryObject(this.providerConfig.defaultQuery ?? this.providerConfig.default_query);

		// The platform installs JSDOM globals (`window`, `document`, `self`) so
		// JS handlers can use browser libraries. The OpenAI SDK then concludes it is
		// running in a browser and refuses to start, which broke `askIAWithMCP` from
		// handlers and bot workers. This code only ever runs server-side, so the
		// browser guard is explicitly disabled.
		const dangerouslyAllowBrowser = true;

		this.client = isAzure
			? new AzureOpenAI({
				apiKey,
				apiVersion,
				baseURL,
				timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
				defaultHeaders,
				defaultQuery,
				organization: this.providerConfig.organization,
				project: this.providerConfig.project,
				dangerouslyAllowBrowser,
			})
			: new OpenAI({
				apiKey,
				baseURL,
				timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
				defaultHeaders,
				defaultQuery,
				organization: this.providerConfig.organization,
				project: this.providerConfig.project,
				dangerouslyAllowBrowser,
			});

		this.model = this.providerConfig.model.trim();
		this.temperature = this.providerConfig.temperature;
		this.maxTokens = this.providerConfig.maxTokens ?? this.providerConfig.max_tokens;
		this.toolChoice = this.providerConfig.toolChoice ?? this.providerConfig.tool_choice;
		this.provider = this.providerConfig.modelProvider ?? this.providerConfig.provider ?? (isAzure ? "azure-openai" : DEFAULT_PROVIDER);
	}

	async run({ prompts, images, runtime, maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS, includeDiagnostics = false, signal } = {}) {
		const messages = appendImagesToMessages(normalizePromptMessages(prompts), images);

		if (messages.length === 0) {
			throw new Error("At least one prompt/message is required.");
		}

		const originalUserPromptText = extractLastUserMessageText(messages);

		const toolGuidance = runtime.getToolUsageGuidance();
		if (toolGuidance) {
			// Some chat templates (MiniCPM) return empty content when they receive two
			// system messages, so merge the guidance into the leading system message.
			const leading = messages[0];
			if (leading?.role === "system" && typeof leading.content === "string") {
				messages[0] = { ...leading, content: `${leading.content}\n\n${toolGuidance}` };
			} else {
				messages.unshift({ role: "system", content: toolGuidance });
			}
		}

		const roundsLimit = Number.isFinite(Number(maxToolRounds))
			? Math.max(1, Number(maxToolRounds))
			: DEFAULT_MAX_TOOL_ROUNDS;
		const tools = runtime.getOpenAITools();
		let toolCatalogRetryUsed = false;
		let automaticToolFallbackUsed = false;
		let lowConfidenceWebRetryUsed = false;

		for (let round = 0; round < roundsLimit; round += 1) {
			const requestSignal = this.createRequestSignal(signal);
			const completionRequest = {
				model: this.model,
				temperature: this.temperature,
				max_tokens: this.maxTokens,
				messages: toOpenAIMessages(messages),
				tools: tools.length > 0 ? tools : undefined,
				tool_choice: tools.length > 0 ? this.toolChoice : undefined,
			};

			const completion = await this.runProviderRequest(
				() => this.client.chat.completions.create(
					completionRequest,
					requestSignal ? { signal: requestSignal } : undefined,
				),
				{ signal },
			);

			const assistantMessage = completion?.choices?.[0]?.message;
			if (!assistantMessage) {
				throw new Error("The AI service returned a completion without message.");
			}

			messages.push({
				role: "assistant",
				content: assistantMessage.content ?? "",
				tool_calls: assistantMessage.tool_calls,
			});

			const explicitToolCalls = Array.isArray(assistantMessage.tool_calls)
				? assistantMessage.tool_calls
				: [];
			const syntheticToolIntent = explicitToolCalls.length === 0
				? parseAssistantToolIntent(normalizeMessageContentToString(assistantMessage.content))
				: null;
			const toolCalls = explicitToolCalls.length > 0
				? explicitToolCalls.map((toolCall) => ({
					id: toolCall.id,
					name: toolCall?.function?.name,
					arguments: toolCall?.function?.arguments,
				}))
				: syntheticToolIntent
					? [{
						id: `synthetic_tool_call_${round + 1}`,
						name: syntheticToolIntent.name,
						arguments: syntheticToolIntent.parameters,
					}]
					: [];

			if (toolCalls.length === 0) {
				const assistantText = normalizeMessageContentToString(assistantMessage.content);
				const assistantLooksLikeToolCatalog = isLikelyToolCatalogDump(assistantText, tools);
				const assistantLooksLowConfidence = hasSuccessfulToolExecution(runtime.executionLog)
					&& looksLikeLowConfidenceWebText(assistantText);

				if (
					tools.length > 0
					&& round < roundsLimit - 1
					&& !toolCatalogRetryUsed
					&& assistantLooksLikeToolCatalog
				) {
					toolCatalogRetryUsed = true;
					messages.push({
						role: "user",
						content: [
							"You described the available tools instead of using one.",
							"Do not enumerate or explain tools.",
							"If external information is needed, call exactly one relevant tool now.",
							"If no tool is needed, answer directly in plain text.",
						].join(" "),
					});
					continue;
				}

				if (
					tools.length > 0
					&& round < roundsLimit - 1
					&& !automaticToolFallbackUsed
					&& (assistantLooksLikeToolCatalog || toolCatalogRetryUsed)
				) {
					const automaticToolCall = inferAutomaticReadOnlyToolCall({
						toolEntries: runtime.toolEntries,
						messages,
						promptText: originalUserPromptText,
						round,
					});

					if (automaticToolCall) {
						automaticToolFallbackUsed = true;
						const executions = await runtime.executeToolCalls([automaticToolCall]);

						for (const execution of executions) {
							messages.push({
								role: "tool",
								tool_call_id: execution.callId,
								content: [
									"Automatic read-only tool fallback executed because the assistant described tools instead of calling one directly.",
									"Use this result to answer the user and do not describe the tool catalog again.",
									execution.textResult || JSON.stringify(execution.rawResult),
								].join("\n\n"),
							});
						}

						continue;
					}
				}

				if (
					tools.length > 0
					&& round < roundsLimit - 1
					&& !lowConfidenceWebRetryUsed
					&& assistantLooksLowConfidence
				) {
					lowConfidenceWebRetryUsed = true;
					const retryToolCall = inferLowConfidenceReadOnlyRetryToolCall({
						toolEntries: runtime.toolEntries,
						messages,
						promptText: originalUserPromptText,
						round,
					});

					if (retryToolCall) {
						const executions = await runtime.executeToolCalls([retryToolCall]);

						for (const execution of executions) {
							messages.push({
								role: "tool",
								tool_call_id: execution.callId,
								content: [
									"Automatic read-only tool retry executed because the previous answer looked grounded on low-confidence web results.",
									"Ignore parked domains, domain-sale pages, SEO placeholders, and ambiguous pages.",
									"Answer only with information supported by clearly relevant sources. If the evidence stays weak, say that you could not verify it reliably.",
									execution.textResult || JSON.stringify(execution.rawResult),
								].join("\n\n"),
							});
						}

						continue;
					}

					messages.push({
						role: "user",
						content: [
							"Your previous answer appears to rely on low-confidence or low-quality web results.",
							"Ignore parked domains, domain-sale pages, SEO placeholders, and unrelated pages.",
							"If you cannot verify the answer from reliable evidence already available, say so clearly.",
						].join(" "),
					});
					continue;
				}

				return this.buildDiagnostics(includeDiagnostics, {
					text: assistantText,
					provider: this.provider,
					model: this.model,
					messages,
					toolExecutions: runtime.executionLog,
					mcpServers: runtime.getDiagnosticsServers(),
					assistantDumpedToolCatalog: toolCatalogRetryUsed && assistantLooksLikeToolCatalog,
					automaticToolFallbackUsed,
					lowConfidenceWebRetryUsed,
				});
			}

			const executions = await runtime.executeToolCalls(toolCalls);

			for (const execution of executions) {
				const toolMessageContent = execution.isError
					? `Tool execution failed. Choose a different tool or fix the arguments before trying again.\n\n${execution.textResult || JSON.stringify(execution.rawResult)}`
					: execution.deduplicated
						? `This tool call was skipped because it repeated a previous successful call with the same arguments. Use the existing result to answer the user unless you need different arguments.\n\n${execution.textResult || JSON.stringify(execution.rawResult)}`
					: `Tool execution succeeded. Use this result to answer the user. Do not repeat the same tool call with the same arguments unless you truly need different data.\n\n${execution.textResult || JSON.stringify(execution.rawResult)}`;

				messages.push({
					role: "tool",
					tool_call_id: execution.callId,
					content: toolMessageContent,
				});
			}

			if (runtime.shouldStopAfterToolSuccess(executions)) {
				return this.buildDiagnostics(includeDiagnostics, {
					text: executions
						.filter((execution) => !execution.isError)
						.map((execution) => execution.textResult)
						.filter(Boolean)
						.join("\n\n"),
					provider: this.provider,
					model: this.model,
					messages,
					toolExecutions: runtime.executionLog,
					mcpServers: runtime.getDiagnosticsServers(),
					stoppedAfterToolSuccess: true,
				});
			}
		}

		throw new Error(`The AI did not finish after ${roundsLimit} tool rounds.`);
	}
}

const normalizeAnthropicToolChoice = (toolChoice) => {
	if (toolChoice == null) {
		return undefined;
	}

	if (isPlainObject(toolChoice)) {
		return toolChoice;
	}

	const normalized = String(toolChoice).trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}

	if (normalized === "required" || normalized === "any") {
		return { type: "any" };
	}

	if (normalized === "none") {
		return { type: "none" };
	}

	if (normalized === "auto") {
		return { type: "auto" };
	}

	return undefined;
};

const convertToAnthropicMessages = (messages, toolGuidance) => {
	const { systemText, messages: nonSystemMessages } = splitSystemMessages(messages, toolGuidance);

	return {
		systemText,
		messages: nonSystemMessages
			.filter((message) => message.role === "user" || message.role === "assistant")
			.map((message) => {
				const parts = normalizeContentParts(message.content);
				const blocks = [];

				if (parts.text) {
					blocks.push({ type: "text", text: parts.text });
				}

				for (const image of parts.images) {
					if (image.base64) {
						blocks.push({
							type: "image",
							source: {
								type: "base64",
								media_type: image.mimeType || "image/jpeg",
								data: image.base64,
							},
						});
					} else if (image.url) {
						blocks.push({
							type: "image",
							source: { type: "url", url: image.url },
						});
					}
				}

				return {
					role: message.role,
					content: blocks.length === 1 && blocks[0].type === "text" ? blocks[0].text : blocks,
				};
			})
			.filter((message) => (Array.isArray(message.content) ? message.content.length > 0 : message.content !== "")),
	};
};

const extractAnthropicText = (contentBlocks) => {
	return normalizeArray(contentBlocks)
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();
};

class AnthropicAdapter extends BaseProviderAdapter {
	constructor(providerConfig) {
		super(providerConfig);

		if (typeof this.providerConfig.model !== "string" || this.providerConfig.model.trim() === "") {
			throw new Error("Anthropic provider configuration requires a non-empty `model`.");
		}

		const apiKey = this.providerConfig.apiKey ?? this.providerConfig.api_key;
		if (!apiKey) {
			throw new Error("Anthropic provider configuration requires `apiKey`.");
		}

		const timeout = Number(this.providerConfig.timeout ?? DEFAULT_TIMEOUT);
		this.client = new Anthropic({
			apiKey,
			baseURL: this.providerConfig.baseUrl ?? this.providerConfig.baseURL,
			timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
			defaultHeaders: normalizeHeadersObject(this.providerConfig.headers),
			// Same reason as the OpenAI adapter: the platform sets JSDOM globals and
			// this only runs server-side.
			dangerouslyAllowBrowser: true,
		});
		this.model = this.providerConfig.model.trim();
		this.temperature = this.providerConfig.temperature;
		this.maxTokens = this.providerConfig.maxTokens
			?? this.providerConfig.max_tokens
			?? DEFAULT_ANTHROPIC_MAX_TOKENS;
		this.toolChoice = normalizeAnthropicToolChoice(
			this.providerConfig.toolChoice ?? this.providerConfig.tool_choice,
		);
		this.provider = this.providerConfig.modelProvider ?? this.providerConfig.provider ?? "anthropic";
	}

	async run({ prompts, images, runtime, maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS, includeDiagnostics = false, signal } = {}) {
		const normalizedMessages = appendImagesToMessages(normalizePromptMessages(prompts), images);

		if (normalizedMessages.length === 0) {
			throw new Error("At least one prompt/message is required.");
		}

		const anthropicInput = convertToAnthropicMessages(normalizedMessages, runtime.getToolUsageGuidance());
		const messages = [...anthropicInput.messages];
		const tools = runtime.getAnthropicTools();
		const roundsLimit = Number.isFinite(Number(maxToolRounds))
			? Math.max(1, Number(maxToolRounds))
			: DEFAULT_MAX_TOOL_ROUNDS;

		for (let round = 0; round < roundsLimit; round += 1) {
			const response = await this.runProviderRequest(() => this.client.messages.create({
				model: this.model,
				max_tokens: this.maxTokens,
				temperature: this.temperature,
				system: anthropicInput.systemText,
				messages,
				tools: tools.length > 0 ? tools : undefined,
				tool_choice: tools.length > 0 ? this.toolChoice : undefined,
			}), { signal });

			const assistantContent = Array.isArray(response?.content) ? response.content : [];
			messages.push({
				role: "assistant",
				content: assistantContent,
			});

			const toolCalls = assistantContent
				.filter((block) => block?.type === "tool_use")
				.map((block) => ({
					id: block.id,
					name: block.name,
					arguments: block.input,
				}));

			if (toolCalls.length === 0) {
				return this.buildDiagnostics(includeDiagnostics, {
					text: extractAnthropicText(assistantContent),
					provider: this.provider,
					model: this.model,
					messages,
					toolExecutions: runtime.executionLog,
					mcpServers: runtime.getDiagnosticsServers(),
				});
			}

			const executions = await runtime.executeToolCalls(toolCalls);
			messages.push({
				role: "user",
				content: executions.map((execution) => ({
					type: "tool_result",
					tool_use_id: execution.callId,
					content: execution.textResult || JSON.stringify(execution.rawResult),
					is_error: execution.isError || undefined,
				})),
			});

			if (runtime.shouldStopAfterToolSuccess(executions)) {
				return this.buildDiagnostics(includeDiagnostics, {
					text: executions
						.filter((execution) => !execution.isError)
						.map((execution) => execution.textResult)
						.filter(Boolean)
						.join("\n\n"),
					provider: this.provider,
					model: this.model,
					messages,
					toolExecutions: runtime.executionLog,
					mcpServers: runtime.getDiagnosticsServers(),
					stoppedAfterToolSuccess: true,
				});
			}
		}

		throw new Error(`The AI did not finish after ${roundsLimit} tool rounds.`);
	}
}

const normalizeGeminiToolConfig = (toolChoice, allowedFunctionNames) => {
	if (!Array.isArray(allowedFunctionNames) || allowedFunctionNames.length === 0) {
		return undefined;
	}

	if (toolChoice == null) {
		return {
			functionCallingConfig: {
				mode: FunctionCallingConfigMode.AUTO,
			},
		};
	}

	if (isPlainObject(toolChoice)) {
		if (typeof toolChoice.name === "string" && toolChoice.name.trim() !== "") {
			return {
				functionCallingConfig: {
					mode: FunctionCallingConfigMode.ANY,
					allowedFunctionNames: [toolChoice.name.trim()],
				},
			};
		}

		return {
			functionCallingConfig: {
				mode: FunctionCallingConfigMode.AUTO,
				...toolChoice,
			},
		};
	}

	const normalized = String(toolChoice).trim().toLowerCase();
	if (normalized === "none") {
		return {
			functionCallingConfig: {
				mode: FunctionCallingConfigMode.NONE,
			},
		};
	}

	if (normalized === "required" || normalized === "any") {
		return {
			functionCallingConfig: {
				mode: FunctionCallingConfigMode.ANY,
				allowedFunctionNames,
			},
		};
	}

	if (normalized === "validated") {
		return {
			functionCallingConfig: {
				mode: FunctionCallingConfigMode.VALIDATED,
				allowedFunctionNames,
			},
		};
	}

	return {
		functionCallingConfig: {
			mode: FunctionCallingConfigMode.AUTO,
		},
	};
};

const convertToGeminiContents = (messages) => {
	const contents = [];

	for (const message of messages) {
		if (message.role === "system") {
			continue;
		}

		const parts = normalizeContentParts(message.content);
		const geminiParts = [];

		if (parts.text) {
			geminiParts.push({ text: parts.text });
		}

		for (const image of parts.images) {
			if (image.base64) {
				geminiParts.push({
					inlineData: {
						mimeType: image.mimeType || "image/jpeg",
						data: image.base64,
					},
				});
			} else if (image.url) {
				geminiParts.push({
					fileData: {
						mimeType: image.mimeType || "image/jpeg",
						fileUri: image.url,
					},
				});
			}
		}

		if (!geminiParts.length) {
			continue;
		}

		contents.push({
			role: message.role === "assistant" ? "model" : "user",
			parts: geminiParts,
		});
	}

	return contents;
};

class GoogleGenAIAdapter extends BaseProviderAdapter {
	constructor(providerConfig) {
		super(providerConfig);

		const apiKey = this.providerConfig.apiKey ?? this.providerConfig.api_key;
		const isVertex = Boolean(this.providerConfig.vertexai ?? this.providerConfig.vertexAI);
		const httpOptions = this.providerConfig.httpOptions ?? this.providerConfig.http_options;

		if (!apiKey && !isVertex) {
			throw new Error("Google GenAI provider configuration requires `apiKey` or Vertex AI settings.");
		}

		this.client = new GoogleGenAI({
			apiKey,
			vertexai: isVertex,
			project: this.providerConfig.project,
			location: this.providerConfig.location,
			// `httpOptions` lets a deployment point the SDK at a proxy or a fake
			// server in tests (baseUrl, headers, timeout). Passing it only when it is
			// an object keeps the SDK defaults untouched otherwise.
			...(isPlainObject(httpOptions) ? { httpOptions } : {}),
		});
		this.model = this.providerConfig.model || DEFAULT_GEMINI_MODEL;
		this.temperature = this.providerConfig.temperature;
		this.maxTokens = this.providerConfig.maxTokens ?? this.providerConfig.max_tokens;
		this.topP = this.providerConfig.topP ?? this.providerConfig.top_p;
		this.toolChoice = this.providerConfig.toolChoice ?? this.providerConfig.tool_choice;
		this.provider = this.providerConfig.modelProvider ?? this.providerConfig.provider ?? "google-gemini";
	}

	async run({ prompts, images, runtime, maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS, includeDiagnostics = false, signal } = {}) {
		const normalizedMessages = appendImagesToMessages(normalizePromptMessages(prompts), images);

		if (normalizedMessages.length === 0) {
			throw new Error("At least one prompt/message is required.");
		}

		const { systemText, messages } = splitSystemMessages(
			normalizedMessages,
			runtime.getToolUsageGuidance(),
		);
		const contents = convertToGeminiContents(messages);
		const tools = runtime.getGeminiTools();
		const toolConfig = normalizeGeminiToolConfig(
			this.toolChoice,
			runtime.getGeminiAllowedFunctionNames(),
		);
		const roundsLimit = Number.isFinite(Number(maxToolRounds))
			? Math.max(1, Number(maxToolRounds))
			: DEFAULT_MAX_TOOL_ROUNDS;

		for (let round = 0; round < roundsLimit; round += 1) {
			const response = await this.runProviderRequest(() => this.client.models.generateContent({
				model: this.model,
				contents,
				config: {
					systemInstruction: systemText,
					temperature: this.temperature,
					maxOutputTokens: this.maxTokens,
					topP: this.topP,
					tools: tools.length > 0 ? tools : undefined,
					toolConfig: tools.length > 0 ? toolConfig : undefined,
				},
			}), { signal });

			const functionCalls = Array.isArray(response?.functionCalls) ? response.functionCalls : [];
			const modelParts = [];

			if (typeof response?.text === "string" && response.text.trim() !== "") {
				modelParts.push({ text: response.text.trim() });
			}

			for (const functionCall of functionCalls) {
				modelParts.push(createPartFromFunctionCall(functionCall.name, functionCall.args ?? {}));
			}

			if (modelParts.length > 0) {
				contents.push({
					role: "model",
					parts: modelParts,
				});
			}

			if (functionCalls.length === 0) {
				return this.buildDiagnostics(includeDiagnostics, {
					text: response?.text ?? "",
					provider: this.provider,
					model: this.model,
					contents,
					toolExecutions: runtime.executionLog,
					mcpServers: runtime.getDiagnosticsServers(),
				});
			}

			const executions = await runtime.executeToolCalls(
				functionCalls.map((functionCall, index) => ({
					id: functionCall.id ?? `gemini_tool_call_${round + 1}_${index + 1}`,
					name: functionCall.name,
					arguments: functionCall.args ?? {},
				})),
			);

			contents.push({
				role: "user",
				parts: executions.map((execution) => createPartFromFunctionResponse(
					execution.callId,
					execution.toolAlias,
					{
						result: execution.rawResult,
						text: execution.textResult,
						is_error: execution.isError,
					},
				)),
			});

			if (runtime.shouldStopAfterToolSuccess(executions)) {
				return this.buildDiagnostics(includeDiagnostics, {
					text: executions
						.filter((execution) => !execution.isError)
						.map((execution) => execution.textResult)
						.filter(Boolean)
						.join("\n\n"),
					provider: this.provider,
					model: this.model,
					contents,
					toolExecutions: runtime.executionLog,
					mcpServers: runtime.getDiagnosticsServers(),
					stoppedAfterToolSuccess: true,
				});
			}
		}

		throw new Error(`The AI did not finish after ${roundsLimit} tool rounds.`);
	}
}

const registerBuiltinAdapter = (providerKey, factory) => {
	providerAdapterFactories.set(providerKey, factory);
};

registerBuiltinAdapter("openai", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("openai-compatible", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("azure", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("azure-openai", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("ollama", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("openrouter", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("deepseek", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("groq", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("mistral", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("xai", (providerConfig) => new OpenAICompatibleAdapter(providerConfig));
registerBuiltinAdapter("anthropic", (providerConfig) => new AnthropicAdapter(providerConfig));
registerBuiltinAdapter("claude", (providerConfig) => new AnthropicAdapter(providerConfig));
registerBuiltinAdapter("google", (providerConfig) => new GoogleGenAIAdapter(providerConfig));
registerBuiltinAdapter("gemini", (providerConfig) => new GoogleGenAIAdapter(providerConfig));
registerBuiltinAdapter("google-gemini", (providerConfig) => new GoogleGenAIAdapter(providerConfig));

export const registerAIProviderAdapter = (providerName, factory) => {
	const providerKey = normalizeProviderKey(providerName);

	if (!providerKey) {
		throw new Error("A non-empty provider name is required.");
	}

	if (typeof factory !== "function") {
		throw new Error("Adapter factory must be a function.");
	}

	providerAdapterFactories.set(providerKey, factory);
};

export const createAIProviderAdapter = (providerConfig = {}) => {
	const resolvedConfig = resolveProviderConfig(providerConfig);
	const providerKey = normalizeProviderKey(
		resolvedConfig.provider
		?? resolvedConfig.modelProvider
		?? resolvedConfig.name
		?? resolvedConfig.vendor,
	) ?? DEFAULT_PROVIDER;

	const factory = providerAdapterFactories.get(providerKey)
		?? providerAdapterFactories.get(resolvedConfig.providerKey)
		?? providerAdapterFactories.get(DEFAULT_PROVIDER);

	if (!factory) {
		throw new Error(`No AI provider adapter is registered for ${providerKey}.`);
	}

	return factory(resolvedConfig);
};

export class AIProviderMCPClient {
	constructor({
		provider,
		mcpServers = [],
		toolHandlers = {},
		clientName = DEFAULT_CLIENT_NAME,
		clientVersion = DEFAULT_CLIENT_VERSION,
		maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
		includeDiagnostics = false,
	} = {}) {
		this.provider = provider;
		this.maxToolRounds = maxToolRounds;
		this.includeDiagnostics = includeDiagnostics;
		this.runtime = new MCPToolRuntime({
			mcpServers,
			toolHandlers,
			clientName: provider?.clientName ?? clientName,
			clientVersion: provider?.clientVersion ?? clientVersion,
		});
		this.adapter = createAIProviderAdapter(provider);
	}

	async connect() {
		await this.runtime.connect();
		return this;
	}

	async listTools() {
		await this.connect();
		return this.runtime.getToolCatalog();
	}

	async run({
		prompts,
		images,
		maxToolRounds = this.maxToolRounds,
		includeDiagnostics = this.includeDiagnostics,
		signal,
	} = {}) {
		await this.connect();

		return this.adapter.run({
			prompts,
			images,
			runtime: this.runtime,
			maxToolRounds,
			includeDiagnostics,
			signal,
		});
	}

	async close() {
		await this.runtime.close();
	}
}

export const createAIProviderMCPClient = (options = {}) => {
	return new AIProviderMCPClient(options);
};

export const listMcpToolsForProvider = async ({
	provider,
	mcpServers = [],
	clientName = DEFAULT_CLIENT_NAME,
	clientVersion = DEFAULT_CLIENT_VERSION,
} = {}) => {
	const client = new AIProviderMCPClient({
		provider,
		mcpServers,
		clientName,
		clientVersion,
	});

	try {
		return await client.listTools();
	} finally {
		await client.close();
	}
};

export const listMcpTools = async ({
	mcpServers = [],
	clientName = DEFAULT_CLIENT_NAME,
	clientVersion = DEFAULT_CLIENT_VERSION,
} = {}) => {
	const runtime = new MCPToolRuntime({
		mcpServers,
		clientName,
		clientVersion,
	});

	try {
		await runtime.connect();
		return runtime.getToolCatalog();
	} finally {
		await runtime.close();
	}
};

export const askIAWithProviderMCP = async ({
	provider,
	mcpServers = [],
	toolHandlers = {},
	prompts,
	images,
	clientName = DEFAULT_CLIENT_NAME,
	clientVersion = DEFAULT_CLIENT_VERSION,
	maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
	includeDiagnostics = false,
	signal,
} = {}) => {
	const client = new AIProviderMCPClient({
		provider,
		mcpServers,
		toolHandlers,
		clientName,
		clientVersion,
		maxToolRounds,
		includeDiagnostics,
	});

	try {
		return await client.run({
			prompts,
			images,
			maxToolRounds,
			includeDiagnostics,
			signal,
		});
	} finally {
		await client.close();
	}
};

export const askAIWithTools = askIAWithProviderMCP;

export const askIAWithMCP = async ({
	ai,
	mcpServers = [],
	toolHandlers = {},
	prompts,
	images,
	clientName = DEFAULT_CLIENT_NAME,
	clientVersion = DEFAULT_CLIENT_VERSION,
	maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
	includeDiagnostics = false,
	signal,
} = {}) => {
	return askIAWithProviderMCP({
		provider: ai,
		mcpServers,
		toolHandlers,
		prompts,
		images,
		clientName,
		clientVersion,
		maxToolRounds,
		includeDiagnostics,
		signal,
	});
};

export const __internalIAForTests = Object.freeze({
	parseAssistantToolIntent,
	isLikelyToolCatalogDump,
	inferAutomaticReadOnlyToolCall,
	buildToolUsageGuidance,
	buildToolCallFingerprint,
	resolveResponseTimeoutMs,
	createExecutionSignal,
	runWithAbortSignal,
	normalizeContentParts,
	normalizeImageDescriptor,
	appendImagesToMessages,
	toOpenAIMessages,
	convertToAnthropicMessages,
	convertToGeminiContents,
	splitSystemMessages,
	OpenAICompatibleAdapter,
	MCPToolRuntime,
});

export default askIAWithProviderMCP;
