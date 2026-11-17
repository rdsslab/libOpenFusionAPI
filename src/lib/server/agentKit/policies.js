/**
 * Deterministic policies for agents backed by small or weak models.
 *
 * These are pure functions: no network, no filesystem, no Telegram. They extract
 * the decisions an agent needs to make before/after calling the model, so the
 * same rules can be reused from a bot, an HTTP endpoint or a task.
 *
 * Ported from the ollama-bot harness; kept dependency-free on purpose.
 */

export const short = (value, max) => {
	const text = String(value == null ? "" : value);
	if (!Number.isFinite(max) || max <= 0) {
		return "";
	}
	return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};

/** Lowercase and strip accents so Spanish/English regexes match either spelling. */
export const normalizeForMatch = (value) => String(value || "")
	.normalize("NFD")
	.replace(/[\u0300-\u036f]/g, "")
	.toLowerCase()
	.trim();

const RECALL_RE = new RegExp(
	"("
	+ "recuerdas|te acuerdas|acuerdas de|"
	+ "te (mande|envie|pase|dije|comente|pregunte)|"
	+ "lo que (hablamos|dijimos|dije|te dije|comentamos)|"
	+ "conversacion(es)? (pasad|anterior|de antes)|"
	+ "(mensajes?|historial) (anterior(es)?|pasad|viej)|"
	+ "(antes|anteriormente|hace (mucho|dias|semanas|meses|anos|un rato|tiempo))|"
	+ "(esa|aquella|la misma) (foto|imagen|video|audio)|"
	+ "hablamos de|habiamos hablado|como te dije|"
	+ "ayer|antier|la ultima vez|otra vez te"
	+ ")",
	"i",
);

const MEDIA_RE = /(foto|imagen|video|audio|nota de voz|voz|grabacion|captura|pantalla)/i;
const COUNT_FOLLOWUP_RE = /(cuant[oa]s?|que (era|fue|dije|te dije|se dijo)|donde (estaba|quedo)|cual (era|fue))/i;

/**
 * True when the message asks about something said/shown earlier. Kept
 * deliberately conservative: a false positive costs one history lookup.
 */
export const looksLikeRecall = (text) => {
	const normalized = normalizeForMatch(text);
	if (normalized.length < 6) {
		return false;
	}
	if (RECALL_RE.test(normalized)) {
		return true;
	}
	// "cuantas gallinas habia?" only makes sense as a recall if it names media.
	return MEDIA_RE.test(normalized) && COUNT_FOLLOWUP_RE.test(normalized);
};

/**
 * Renders the rows returned by a history-search tool into prompt text.
 *
 * @param {{results?: Array<{created_at?: string, role?: string, kind?: string, content?: string, next?: {role?: string, content?: string}}>}} found
 * @param {{title?: string, budget?: number, instructions?: string}} [options]
 */
export const formatHistoryRecap = (found, options = {}) => {
	const rows = found && Array.isArray(found.results) ? found.results : [];
	if (!rows.length) {
		return "";
	}

	const budget = Number.isFinite(options.budget) ? options.budget : 1800;
	const lines = [];
	let remaining = budget;

	for (const row of rows) {
		const when = row?.created_at ? String(row.created_at).slice(0, 10) : "";
		const who = row?.role === "assistant" ? "bot" : "usuario";
		const kind = row?.kind ? ` [${row.kind}]` : "";
		let line = `- ${when ? `${when} ` : ""}${who}${kind}: ${short(String(row?.content || ""), 320)}`;
		if (row?.next && row.next.content) {
			const whoNext = row.next.role === "assistant" ? "bot" : "usuario";
			line += `\n  ${whoNext}: ${short(String(row.next.content), 320)}`;
		}
		if (line.length > remaining) {
			break;
		}
		remaining -= line.length;
		lines.push(line);
	}

	if (!lines.length) {
		return "";
	}

	const title = options.title || "MENSAJES ANTIGUOS RECUPERADOS DEL HISTORIAL DEL USUARIO";
	const instructions = options.instructions
		|| "Usa estos mensajes si responden la pregunta. No digas que no tienes acceso a fotos, audios o conversaciones anteriores: aqui estan los datos. Si no responden la pregunta, dilo y ofrece buscar otra cosa.";

	return `${title}:\n${lines.join("\n")}\n\n${instructions}`;
};

const EXPLICIT_WEB_RE = /\b(busca|buscame|buscar|investiga|averigua|consulta|consultar|googlea|search|dime|dame|muestrame)\b[^.]{0,40}\b(internet|la web|web|google|online|en linea)\b/;
const FRESH_DATA_RE = /\b(precios?|cotizaciones?|clima|pronosticos?|temperatura|noticias?|resultados?|marcador|posiciones|estrenos?|taquilla|tipo de cambio|dolar|criptomoneda|bitcoin)\b/;
const FRESH_WHEN_RE = /\b(hoy|ahora|actual|actualmente|esta semana|este mes|manana|ayer|2025|2026)\b/;
const STANDALONE_WEB_RE = /\b(clima|precios?|pronosticos?|noticias?|tipo de cambio|dolar)\b/;

/**
 * True when the message clearly asks for fresh web data. Small models answer
 * "no tengo acceso a internet" when handed a tool, so the harness searches first
 * and injects the results.
 */
export const looksLikeWebQuery = (text) => {
	const normalized = normalizeForMatch(text);
	if (!normalized || normalized.length > 300) {
		return false;
	}

	return EXPLICIT_WEB_RE.test(normalized)
		|| STANDALONE_WEB_RE.test(normalized)
		|| (FRESH_DATA_RE.test(normalized) && FRESH_WHEN_RE.test(normalized));
};

/** "Busca en internet quien es X" -> "quien es X". */
export const cleanWebQuery = (text) => {
	const raw = String(text || "").trim();
	const stripped = raw.replace(
		/^\s*((tu|oye|por favor|please)\s+)?(busca|buscame|buscar|investiga|averigua|consulta|consultar|dime|dame)\b[^.]{0,40}?\b(internet|la web|web|google|online|en linea)\b[:,]?\s*/i,
		"",
	).trim();

	return stripped || raw;
};

/**
 * Chooses what to search: the user's own words first, then the quoted question
 * when the new text is only an instruction ("vuelve a responder a este mensaje").
 */
export const pickWebQuery = ({ ownText = "", quotedText = "" } = {}) => {
	if (looksLikeWebQuery(ownText)) {
		return cleanWebQuery(ownText);
	}
	if (quotedText && looksLikeWebQuery(quotedText)) {
		return cleanWebQuery(quotedText);
	}
	return "";
};

/**
 * Renders web-search results into prompt text.
 *
 * @param {{results?: Array<{title?: string, url?: string, snippet?: string}>, source?: string, query?: string}} found
 * @param {{budget?: number, maxResults?: number, title?: string, instructions?: string}} [options]
 */
export const formatWebRecap = (found, options = {}) => {
	const results = found && Array.isArray(found.results) ? found.results : [];
	if (!results.length) {
		return "";
	}

	const budget = Number.isFinite(options.budget) ? options.budget : 2200;
	const maxResults = Number.isFinite(options.maxResults) ? options.maxResults : 6;
	const lines = [];
	let remaining = budget;

	for (let index = 0; index < results.length && index < maxResults; index += 1) {
		const result = results[index] || {};
		const line = `${index + 1}. ${short(String(result.title || "(sin titulo)"), 160)}`
			+ `\n   ${short(String(result.url || ""), 200)}`
			+ `\n   ${short(String(result.snippet || ""), 320)}`;
		if (line.length > remaining) {
			break;
		}
		remaining -= line.length;
		lines.push(line);
	}

	if (!lines.length) {
		return "";
	}

	const engine = (found && found.source) || "web";
	const queryLabel = found && found.query ? `"${short(String(found.query), 120)}"` : "automatica";
	const title = options.title || `RESULTADOS DE BUSQUEDA WEB (${engine}, ${queryLabel})`;
	const instructions = options.instructions
		|| "Usa estos resultados para responder y cita la fuente (titulo o URL). No digas que no tienes acceso a internet: los datos estan aqui. Si no responden la pregunta, dilo.";

	return `${title}:\n${lines.join("\n")}\n\n${instructions}`;
};

/**
 * Compact tool payload: what an LLM needs, without dumping full pages (every
 * extra token costs prompt-processing time on CPU models).
 */
export const trimWebResults = (found, { maxResults = 4, snippetLength = 300, textLength = 700 } = {}) => {
	const rows = found && Array.isArray(found.results) ? found.results : [];
	return {
		ok: Boolean(found && found.ok),
		source: (found && found.source) || null,
		results: rows.slice(0, maxResults).map((row) => {
			const item = {
				title: short(String(row?.title || ""), 140),
				url: short(String(row?.url || ""), 200),
				snippet: short(String(row?.snippet || ""), snippetLength),
			};
			if (row?.text) {
				item.text = short(String(row.text), textLength);
			}
			return item;
		}),
		note: (found && found.note) || "",
	};
};

/**
 * "Analiza esta imagen" written as plain text (the photo never attached) used to
 * reach the model, which answered "no puedo ver imagenes".
 */
export const looksLikeMissingMedia = (text) => {
	const normalized = normalizeForMatch(text);
	if (!normalized || normalized.length > 140) {
		return false;
	}
	if (/\b(anterior|ultima|ultimo|de antes|pasada|pasado|recuerda|recuerdas|historial|ayer|envie|mande|pase)\b/.test(normalized)) {
		return false;
	}
	return /(analiza|analizar|describe|describir|mira|mirar|revisa|revisar|lee|leer|transcribe|resume|resumir|que (se )?ve|que hay)\b[^.]{0,40}\b(esta|este|esa|ese|la|el|mi)\b[^.]{0,12}\b(imagen|foto|video|captura|pantalla)\b/.test(normalized);
};

/**
 * Merges a Telegram-style quoted message into the prompt.
 *
 * @param {string} text
 * @param {{text?: string}|null|undefined} quoted
 * @param {{label?: string}} [options]
 */
export const mergeQuoted = (text, quoted, options = {}) => {
	const base = String(text || "").trim();
	if (!quoted || !quoted.text) {
		return base;
	}
	const label = options.label || "";

	return base ? `${base}\n\n${label}${quoted.text}` : `${label}${quoted.text}`;
};
