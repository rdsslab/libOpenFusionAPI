/**
 * High-level agent orchestration for the platform.
 *
 * `askAgent` is the entry point most callers want:
 *
 *   const result = await askAgent({
 *     provider: { provider: "ollama", model: "llama3.2", baseUrl: "http://host:11434" },
 *     system: "Eres un asistente breve.",
 *     messages: [{ role: "user", content: "Busca el clima en Quito" }],
 *     tools: { web_search: true },
 *   });
 *
 * It adds the pieces `ia.js` does not decide by itself:
 *
 * - deterministic pre-search for small models that refuse to call tools,
 * - local tools (web search, optional document resolver) through `toolHandlers`,
 * - in-memory document text extraction (PDF/DOCX/text) before the model call,
 * - one `{ text, usedWeb, webQuery, webResults, ... }` envelope for every provider.
 *
 * Media helpers (transcription, TTS, frames) are exposed separately in
 * `media.js`: they are not part of every chat turn and must stay opt-in.
 */

import { askIAWithProviderMCP } from "../ia.js";
import { extractDocumentText } from "./documents.js";
import {
	cleanWebQuery,
	formatWebRecap,
	looksLikeWebQuery,
	short,
	trimWebResults,
} from "./policies.js";
import { webSearch } from "./websearch.js";

const DEFAULT_MAX_TOOL_ROUNDS = 4;
const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

export class AgentError extends Error {
	constructor(message, { code = "AGENT_ERROR", userMessage } = {}) {
		super(message);
		this.name = "AgentError";
		this.code = code;
		this.userMessage = userMessage || message;
	}
}

const normalizeMessageList = (input) => {
	if (input == null) {
		return [];
	}

	const values = Array.isArray(input) ? input : [input];
	const messages = [];

	for (const value of values) {
		if (typeof value === "string") {
			messages.push({ role: "user", content: value });
			continue;
		}
		if (isPlainObject(value) && typeof value.role === "string") {
			messages.push({
				role: value.role,
				content: value.content ?? value.text ?? "",
				...(value.name ? { name: value.name } : {}),
			});
		}
	}

	return messages;
};

const getLastUserText = (messages) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role !== "user") {
			continue;
		}
		const content = messages[index].content;
		if (typeof content === "string") {
			return content;
		}
		if (Array.isArray(content)) {
			return content
				.filter((part) => typeof part === "string" || part?.type === "text")
				.map((part) => (typeof part === "string" ? part : part.text || ""))
				.join("\n");
		}
	}

	return "";
};

const appendTextToLastUserMessage = (messages, text) => {
	if (!text) {
		return messages;
	}

	const output = [...messages];

	for (let index = output.length - 1; index >= 0; index -= 1) {
		if (output[index].role !== "user") {
			continue;
		}
		const content = output[index].content;
		const base = typeof content === "string"
			? content
			: Array.isArray(content)
				? content.filter((part) => part?.type === "text").map((part) => part.text).join("\n")
				: String(content || "");

		output[index] = {
			...output[index],
			content: [base, text].filter(Boolean).join("\n\n"),
		};
		return output;
	}

	output.push({ role: "user", content: text });
	return output;
};

const buildDocumentRecap = (documents) => {
	if (!documents.length) {
		return "";
	}

	const parts = [];

	for (const document of documents) {
		const label = document.fileName || document.mimeType || "documento";
		const pages = document.pages ? `, ${document.pages} pagina(s)` : "";
		parts.push(
			`DOCUMENTO ADJUNTO: ${label} (${document.kind}${pages})`
			+ (document.truncated ? " [texto truncado]" : "")
			+ `\n"""\n${document.text}\n"""`,
		);
	}

	return parts.join("\n\n");
};

const normalizeToolConfig = (tools) => {
	if (!isPlainObject(tools)) {
		return {};
	}

	const normalized = {};

	for (const [name, value] of Object.entries(tools)) {
		if (value === false || value == null) {
			continue;
		}

		if (value === true) {
			normalized[name] = {};
			continue;
		}

		if (typeof value === "function") {
			normalized[name] = { handler: value };
			continue;
		}

		if (isPlainObject(value)) {
			normalized[name] = { ...value };
		}
	}

	return normalized;
};

const trimDocumentForTool = (document, maxChars = 20000) => ({
	ok: true,
	kind: document.kind,
	fileName: document.fileName,
	chars: document.chars,
	truncated: document.truncated || document.text.length > maxChars,
	text: document.text.length > maxChars ? `${document.text.slice(0, maxChars)}\n[...truncado]` : document.text,
});

/**
 * @param {object} options
 * @param {object|string} options.provider Provider config accepted by ia.js (or preset name).
 * @param {Array<{role: string, content: any}>|string} [options.messages]
 * @param {string} [options.prompt] Shorthand for one user message.
 * @param {string} [options.system]
 * @param {Array<{role: string, content: any}>} [options.history] Prior conversation, oldest first.
 * @param {Array<any>} [options.images] Buffers, base64 strings, data URLs or `{mimeType,data}`.
 * @param {Array<any>} [options.documents] In-memory documents; their text is injected into the prompt.
 * @param {object} [options.tools] `{ web_search: true, read_document: true, [custom]: {...} }`.
 * @param {object} [options.toolHandlers] Extra local tool handlers (same shape as ia.js).
 * @param {Function} [options.documentResolver] Optional `async ({name,id}) => document` for `read_document`.
 * @param {Array<object>} [options.mcpServers]
 * @param {boolean|"auto"|"always"} [options.preSearch] Deterministic web search before the model.
 * @param {object} [options.webSearch] Options forwarded to `webSearch()` (providers, maxResults...).
 * @param {number} [options.maxToolRounds]
 * @param {boolean} [options.includeDiagnostics]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{text: string, usedWeb: boolean, webQuery: string, webResults: Array, webSource: string|null, documents: Array, toolExecutions: Array, diagnostics: object}>}
 */
export const askAgent = async ({
	provider,
	messages,
	prompt,
	system,
	history,
	images,
	documents = [],
	tools = {},
	toolHandlers = {},
	documentResolver,
	mcpServers = [],
	preSearch = "auto",
	webSearch: webSearchOptions = {},
	maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
	includeDiagnostics = false,
	signal,
} = {}) => {
	if (!provider) {
		throw new AgentError("askAgent requires a provider configuration.", {
			code: "AGENT_PROVIDER_REQUIRED",
			userMessage: "Falta la configuracion del proveedor de IA.",
		});
	}

	const conversation = normalizeMessageList([
		...(Array.isArray(history) ? history : []),
		...(prompt != null ? [{ role: "user", content: prompt }] : []),
		...normalizeMessageList(messages),
	]);

	if (!conversation.length) {
		throw new AgentError("askAgent requires at least one message.", {
			code: "AGENT_MESSAGES_REQUIRED",
			userMessage: "Falta el mensaje del usuario.",
		});
	}

	const promptMessages = [];
	if (system) {
		promptMessages.push({ role: "system", content: String(system) });
	}
	promptMessages.push(...conversation);

	// Documents are read before the model call: the sandbox has no filesystem, so
	// a model-driven "read this file" tool would have nothing to open.
	const documentResults = [];
	if (Array.isArray(documents) && documents.length) {
		for (const document of documents) {
			const extracted = await extractDocumentText(document);
			documentResults.push(extracted);
		}

		const recap = buildDocumentRecap(documentResults);
		if (recap) {
			const merged = appendTextToLastUserMessage(promptMessages, recap);
			promptMessages.length = 0;
			promptMessages.push(...merged);
		}
	}

	const configuredTools = normalizeToolConfig(tools);
	const handlers = { ...toolHandlers };

	// Web search: deterministic pre-search for weak models plus an optional tool.
	const wantsWebTool = Boolean(configuredTools.web_search);
	const webConfig = {
		...webSearchOptions,
		...(isPlainObject(configuredTools.web_search) ? configuredTools.web_search : {}),
	};

	let usedWeb = false;
	let webQuery = "";
	let webResults = [];
	let webSource = null;
	let webErrors = [];

	const lastUserText = getLastUserText(conversation);
	const shouldPreSearch = preSearch === true
		|| preSearch === "always"
		|| (preSearch === "auto" && looksLikeWebQuery(lastUserText))
		|| (isPlainObject(configuredTools.web_search) && configuredTools.web_search.preSearch === true);

	if (shouldPreSearch && lastUserText) {
		webQuery = cleanWebQuery(lastUserText);
		const found = await webSearch({ ...webConfig, query: webQuery, signal });
		webResults = found.results || [];
		webSource = found.source;
		webErrors = found.errors || [];
		usedWeb = Boolean(found.ok && webResults.length);

		const recap = usedWeb ? formatWebRecap(found) : "";
		if (recap) {
			const merged = appendTextToLastUserMessage(promptMessages, recap);
			promptMessages.length = 0;
			promptMessages.push(...merged);
		}
	}

	if (wantsWebTool) {
		handlers.web_search = {
			description: "Search the web and return titles, URLs and snippets. Use it when the answer needs current or external information.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "Search query." },
				},
				required: ["query"],
				additionalProperties: false,
			},
			policy: { oneShot: true },
			handler: async (args) => {
				const query = String(args?.query || "").trim() || lastUserText;
				const found = await webSearch({ ...webConfig, query, signal });
				return trimWebResults(found, { maxResults: Number(webConfig.maxResults ?? 4) });
			},
		};
	}

	if (documentResolver && configuredTools.read_document !== false) {
		handlers.read_document = {
			description: "Read an attached document by name or id and return its plain text.",
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string", description: "Document name or id." },
				},
				required: ["name"],
				additionalProperties: false,
			},
			policy: { oneShot: true },
			handler: async (args) => {
				const source = await documentResolver({ name: args?.name, id: args?.id });
				const extracted = await extractDocumentText(source);
				return trimDocumentForTool(extracted);
			},
		};
	}

	for (const [name, definition] of Object.entries(configuredTools)) {
		if (name === "web_search" || name === "read_document") {
			continue;
		}
		if (isPlainObject(definition) && typeof (definition.handler ?? definition.run ?? definition.execute) === "function") {
			handlers[name] = definition;
		}
	}

	const hasTools = Object.keys(handlers).length > 0;
	const result = await askIAWithProviderMCP({
		provider,
		mcpServers,
		toolHandlers: handlers,
		prompts: promptMessages,
		images,
		maxToolRounds,
		includeDiagnostics: true,
		signal,
	});

	const diagnostics = isPlainObject(result) ? result : { text: String(result ?? "") };
	const text = typeof diagnostics.text === "string" ? diagnostics.text : "";

	if (!includeDiagnostics) {
		return {
			text,
			usedWeb,
			webQuery,
			webResults,
			webSource,
			webErrors,
			documents: documentResults.map((document) => ({
				kind: document.kind,
				fileName: document.fileName,
				chars: document.chars,
				pages: document.pages,
				truncated: document.truncated,
			})),
			toolExecutions: (Array.isArray(diagnostics.toolExecutions) ? diagnostics.toolExecutions : []).map((execution) => ({
				tool: execution.toolName,
				server: execution.serverName,
				ok: !execution.isError,
				deduplicated: Boolean(execution.deduplicated),
			})),
			hasTools,
		};
	}

	return {
		text,
		usedWeb,
		webQuery,
		webResults,
		webSource,
		webErrors,
		documents: documentResults,
		hasTools,
		diagnostics,
	};
};

/** Same as `askAgent` but returns only the assistant text. */
export const askAgentText = async (options = {}) => {
	const result = await askAgent(options);
	return result.text;
};

export default askAgent;
