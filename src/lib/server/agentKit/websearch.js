/**
 * Web search for the agent kit.
 *
 * Default engine is DuckDuckGo's HTML endpoint; Bing HTML is the fallback. Both
 * are scraped, so parsers are exported for tests and an `http-json` provider is
 * available for deployments that already run a search endpoint.
 *
 * Always sends a browser User-Agent: the platform's own 403s came from requests
 * without one.
 */

const DEFAULT_TIMEOUT = 20000;
const DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const decodeEntities = (value) => String(value || "")
	.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
	.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
	.replace(/&lt;/g, "<")
	.replace(/&gt;/g, ">")
	.replace(/&quot;/g, '"')
	.replace(/&#39;|&apos;/g, "'")
	.replace(/&nbsp;/g, " ")
	.replace(/&amp;/g, "&");

const stripTags = (value) => decodeEntities(String(value || "").replace(/<[^>]+>/g, " "))
	.replace(/\s+/g, " ")
	.trim();

const resolveDuckDuckGoUrl = (href) => {
	const raw = String(href || "").trim();
	if (!raw) {
		return "";
	}

	try {
		const parsed = new URL(raw, "https://duckduckgo.com");
		const target = parsed.searchParams.get("uddg");
		if (target) {
			return decodeURIComponent(target);
		}
		return parsed.toString();
	} catch {
		return raw;
	}
};

/** Parses `html.duckduckgo.com/html/` result markup. */
export const extractDuckDuckGoResults = (html, maxResults = 5) => {
	const source = String(html || "");
	const results = [];
	const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	const snippetPattern = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
	const snippets = [];
	let snippetMatch;

	while ((snippetMatch = snippetPattern.exec(source)) !== null) {
		snippets.push(stripTags(snippetMatch[1]));
	}

	let match;
	let index = 0;

	while ((match = linkPattern.exec(source)) !== null && results.length < maxResults) {
		const url = resolveDuckDuckGoUrl(match[1]);
		const title = stripTags(match[2]);
		if (!url || !title) {
			index += 1;
			continue;
		}
		results.push({
			title,
			url,
			snippet: snippets[index] || "",
		});
		index += 1;
	}

	return results;
};

/** Parses `lite.duckduckgo.com/lite/` result markup (table layout). */
export const extractDuckDuckGoLiteResults = (html, maxResults = 5) => {
	const source = String(html || "");
	const results = [];
	const linkPattern = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	const snippetPattern = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
	const snippets = [];
	let snippetMatch;

	while ((snippetMatch = snippetPattern.exec(source)) !== null) {
		snippets.push(stripTags(snippetMatch[1]));
	}

	let match;
	let index = 0;
	while ((match = linkPattern.exec(source)) !== null && results.length < maxResults) {
		results.push({
			title: stripTags(match[2]),
			url: resolveDuckDuckGoUrl(match[1]),
			snippet: snippets[index] || "",
		});
		index += 1;
	}

	return results.filter((result) => result.title && result.url);
};

/** Parses Bing's `b_algo` result blocks. */
export const extractBingResults = (html, maxResults = 5) => {
	const source = String(html || "");
	const blocks = source.split(/<li[^>]+class="[^"]*b_algo[^"]*"/i).slice(1);
	const results = [];

	for (const block of blocks) {
		if (results.length >= maxResults) {
			break;
		}

		const linkMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
		if (!linkMatch) {
			continue;
		}

		const url = decodeEntities(linkMatch[1]);
		const title = stripTags(linkMatch[2]);
		const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

		if (!url || !title) {
			continue;
		}

		results.push({
			title,
			url,
			snippet: snippetMatch ? stripTags(snippetMatch[1]) : "",
		});
	}

	return results;
};

const getFetch = (fetchImpl) => {
	const impl = fetchImpl || globalThis.fetch;
	if (typeof impl !== "function") {
		throw new Error("No fetch implementation is available for web search.");
	}
	return impl;
};

const buildSignal = (timeoutMs, externalSignal) => {
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

const requestHeaders = (provider) => ({
	"User-Agent": provider.userAgent || DEFAULT_USER_AGENT,
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": provider.language || "es-ES,es;q=0.9,en;q=0.8",
	...(provider.headers || {}),
});

export class WebSearchError extends Error {
	constructor(message, { code = "WEB_SEARCH_FAILED", userMessage } = {}) {
		super(message);
		this.name = "WebSearchError";
		this.code = code;
		this.userMessage = userMessage || message;
	}
}

const duckDuckGoSearch = async ({ query, maxResults, provider, signal, fetchImpl }) => {
	const base = String(provider.baseUrl || "https://html.duckduckgo.com/html/").trim();
	const body = new URLSearchParams({ q: query, kl: provider.region || "wt-wt" });

	const response = await fetchImpl(base, {
		method: "POST",
		headers: {
			...requestHeaders(provider),
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: body.toString(),
		signal,
		redirect: "follow",
	});

	if (!response.ok) {
		throw new WebSearchError(`DuckDuckGo HTTP ${response.status}.`, { code: "WEB_SEARCH_HTTP" });
	}

	const html = await response.text();
	const results = extractDuckDuckGoResults(html, maxResults);

	if (results.length) {
		return { engine: "duckduckgo", results };
	}

	// Some deployments get the lite layout instead.
	const lite = extractDuckDuckGoLiteResults(html, maxResults);
	if (lite.length) {
		return { engine: "duckduckgo-lite", results: lite };
	}

	throw new WebSearchError("DuckDuckGo returned no parsable results.", { code: "WEB_SEARCH_NO_RESULTS" });
};

const bingSearch = async ({ query, maxResults, provider, signal, fetchImpl }) => {
	const url = `${String(provider.baseUrl || "https://www.bing.com").replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&setlang=${encodeURIComponent(provider.language || "es")}`;
	const response = await fetchImpl(url, {
		method: "GET",
		headers: requestHeaders(provider),
		signal,
		redirect: "follow",
	});

	if (!response.ok) {
		throw new WebSearchError(`Bing HTTP ${response.status}.`, { code: "WEB_SEARCH_HTTP" });
	}

	const results = extractBingResults(await response.text(), maxResults);
	if (!results.length) {
		throw new WebSearchError("Bing returned no parsable results.", { code: "WEB_SEARCH_NO_RESULTS" });
	}

	return { engine: "bing", results };
};

const httpJsonSearch = async ({ query, maxResults, provider, signal, fetchImpl }) => {
	const url = provider.url || provider.baseUrl;
	if (!url) {
		throw new WebSearchError(`Search provider "${provider.name}" requires a url.`, {
			code: "WEB_SEARCH_NOT_CONFIGURED",
			userMessage: "La busqueda web no esta configurada: falta la URL del servicio.",
		});
	}

	const method = String(provider.method || "POST").toUpperCase();
	const headers = { "Content-Type": "application/json", ...(provider.headers || {}) };
	let finalUrl = String(url);
	let body;

	if (method === "GET") {
		const target = new URL(finalUrl);
		target.searchParams.set(provider.queryParam || "q", query);
		target.searchParams.set(provider.limitParam || "limit", String(maxResults));
		finalUrl = target.toString();
	} else {
		body = JSON.stringify({ [provider.queryField || "query"]: query, max_results: maxResults });
	}

	if (provider.apiKey) {
		headers.Authorization = `Bearer ${provider.apiKey}`;
	}

	const response = await fetchImpl(finalUrl, { method, headers, body, signal });
	if (!response.ok) {
		throw new WebSearchError(`Search provider HTTP ${response.status}.`, { code: "WEB_SEARCH_HTTP" });
	}

	const payload = await response.json().catch(() => null);
	const rows = Array.isArray(payload) ? payload : (payload?.results || payload?.data || []);
	const results = rows.slice(0, maxResults).map((row) => ({
		title: String(row.title ?? row.name ?? "").trim(),
		url: String(row.url ?? row.link ?? "").trim(),
		snippet: String(row.snippet ?? row.description ?? row.text ?? "").trim(),
	})).filter((row) => row.title || row.url);

	if (!results.length) {
		throw new WebSearchError("The search provider returned no results.", { code: "WEB_SEARCH_NO_RESULTS" });
	}

	return { engine: provider.name || "http-json", results };
};

const engines = {
	duckduckgo: duckDuckGoSearch,
	bing: bingSearch,
	"http-json": httpJsonSearch,
};

export const listWebSearchEngines = () => Object.keys(engines);

/**
 * @param {string|{query?: string}} queryOrOptions
 * @param {{maxResults?: number, provider?: string|object, providers?: object, engine?: string, timeoutMs?: number, fetchImpl?: Function, signal?: AbortSignal}} [options]
 * @returns {Promise<{ok: boolean, query: string, source: string, results: Array<{title: string, url: string, snippet: string}>, note?: string, errors?: string[]}>}
 */
export const webSearch = async (queryOrOptions, options = {}) => {
	const config = isPlainObject(queryOrOptions) ? { ...queryOrOptions, ...options } : { ...options, query: queryOrOptions };
	const query = String(config.query || "").trim();
	const maxResults = Math.max(1, Math.min(10, Number(config.maxResults ?? 5)));
	const timeoutMs = Number(config.timeoutMs ?? DEFAULT_TIMEOUT);

	if (!query) {
		throw new WebSearchError("A search query is required.", {
			code: "WEB_SEARCH_QUERY_REQUIRED",
			userMessage: "Necesito una consulta para buscar en la web.",
		});
	}

	const fetchImpl = getFetch(config.fetchImpl);
	const signal = buildSignal(timeoutMs, config.signal);
	const providers = isPlainObject(config.providers) ? config.providers : {};
	const requested = config.provider ?? config.engine ?? "auto";

	const buildProvider = (name) => {
		const configured = providers[name];
		if (isPlainObject(configured)) {
			return { ...configured, name };
		}
		if (configured === false) {
			return null;
		}
		if (typeof configured === "string") {
			return { name, type: configured };
		}
		return { name, type: name };
	};

	const chain = [];
	if (requested !== "auto") {
		const explicit = buildProvider(String(requested));
		if (!explicit) {
			throw new WebSearchError(`Search provider "${requested}" is disabled.`, {
				code: "WEB_SEARCH_PROVIDER_DISABLED",
				userMessage: `El proveedor de busqueda "${requested}" esta deshabilitado.`,
			});
		}
		chain.push(explicit);
	} else {
		for (const name of Object.keys(providers).length ? Object.keys(providers) : ["duckduckgo", "bing"]) {
			const provider = buildProvider(name);
			if (provider) {
				chain.push(provider);
			}
		}
	}

	if (!chain.length) {
		throw new WebSearchError("Web search is not configured.", {
			code: "WEB_SEARCH_NOT_CONFIGURED",
			userMessage: "La busqueda web no esta configurada en este servidor.",
		});
	}

	const errors = [];

	for (const provider of chain) {
		const type = String(provider.type || provider.name || "duckduckgo").toLowerCase();
		const engine = engines[type];

		if (!engine) {
			errors.push(`${provider.name || type}: unsupported engine "${type}"`);
			continue;
		}

		try {
			const result = await engine({
				query,
				maxResults,
				provider,
				signal,
				fetchImpl,
			});

			return {
				ok: true,
				query,
				source: provider.name || result.engine,
				results: result.results.slice(0, maxResults),
				note: provider.note,
			};
		} catch (error) {
			errors.push(`${provider.name || type}: ${error?.message || error}`);
		}
	}

	// Returning ok:false instead of throwing lets the caller answer "I could not
	// verify this" instead of failing the whole turn.
	return {
		ok: false,
		query,
		source: null,
		results: [],
		note: "La busqueda web no devolvio resultados utilizables.",
		errors,
	};
};

export const createWebSearch = (defaults = {}) => (queryOrOptions, options = {}) => {
	const config = isPlainObject(queryOrOptions)
		? { ...defaults, ...queryOrOptions, ...options }
		: { ...defaults, ...options, query: queryOrOptions };
	return webSearch(config);
};
