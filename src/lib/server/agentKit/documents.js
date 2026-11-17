/**
 * Document reading for the agent kit.
 *
 * The platform has no filesystem: callers hand over a Buffer, ArrayBuffer,
 * base64 string or data URL. Supported formats:
 *
 * - PDF  (text layer via pdfjs-dist; scanned PDFs have no text to extract)
 * - DOCX (unzip `word/document.xml` in memory, no external binary)
 * - TXT, MD, CSV, TSV, JSON, HTML, XML, YAML, LOG, SRT, VTT
 *
 * Unsupported formats fail with a `DocumentExtractionError` whose `userMessage`
 * tells the user exactly what is missing instead of returning an empty answer.
 */

import zlib from "node:zlib";
import path from "node:path";
import { createRequire } from "node:module";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { guessMimeTypeFromName, isTextMimeType, normalizeBinaryDescriptor } from "./buffers.js";

const requireFromHere = createRequire(import.meta.url);

const resolveStandardFontDataUrl = () => {
	try {
		const packageJson = requireFromHere.resolve("pdfjs-dist/package.json");
		// pdfjs reads this with `fs.readFile(baseUrl + fileName)` in Node; a plain
		// filesystem path works, a `file://` URL makes it warn and skip the glyphs.
		// It only requires a trailing slash.
		return `${path.join(path.dirname(packageJson), "standard_fonts")}/`;
	} catch {
		return undefined;
	}
};

const STANDARD_FONT_DATA_URL = resolveStandardFontDataUrl();

export const SUPPORTED_DOCUMENT_TYPES = Object.freeze([
	"pdf",
	"docx",
	"txt",
	"md",
	"csv",
	"tsv",
	"json",
	"html",
	"xml",
	"yaml",
	"yml",
	"log",
	"srt",
	"vtt",
]);

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "log", "srt", "vtt"]);
const DEFAULT_MAX_CHARS = 200000;
const DEFAULT_MAX_PAGES = 60;

export class DocumentExtractionError extends Error {
	constructor(message, { code = "DOCUMENT_UNSUPPORTED", userMessage } = {}) {
		super(message);
		this.name = "DocumentExtractionError";
		this.code = code;
		this.userMessage = userMessage || message;
	}
}

const extensionOf = (fileName) => {
	const name = String(fileName || "").toLowerCase();
	return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
};

/**
 * @param {{mimeType?: string, fileName?: string}} input
 * @returns {"pdf"|"docx"|"html"|"text"|"unsupported"}
 */
export const detectDocumentKind = ({ mimeType, fileName } = {}) => {
	const mime = String(mimeType || "").toLowerCase();
	const ext = extensionOf(fileName);

	if (mime.includes("application/pdf") || ext === "pdf") {
		return "pdf";
	}

	if (
		mime.includes("wordprocessingml.document")
		|| mime === "application/msword"
		|| ext === "docx"
		|| ext === "doc"
	) {
		return "docx";
	}

	if (mime.includes("html") || ext === "html" || ext === "htm") {
		return "html";
	}

	if (TEXT_EXTENSIONS.has(ext) || isTextMimeType(mime)) {
		return "text";
	}

	return "unsupported";
};

const decodeXmlEntities = (value) => String(value || "")
	.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
	.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
	.replace(/&lt;/g, "<")
	.replace(/&gt;/g, ">")
	.replace(/&quot;/g, '"')
	.replace(/&apos;/g, "'")
	.replace(/&nbsp;/g, " ")
	.replace(/&amp;/g, "&");

export const htmlToText = (html) => {
	const withoutNoise = String(html || "")
		.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ");

	const withBreaks = withoutNoise
		.replace(/<\s*(br|hr)\s*\/?>/gi, "\n")
		.replace(/<\/\s*(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre)\s*>/gi, "\n")
		.replace(/<\s*(li)[^>]*>/gi, "\n- ")
		.replace(/<\s*(td|th)[^>]*>/gi, "\t");

	const text = decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, " "));

	return text
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
};

const decodeTextBuffer = (buffer) => {
	if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		return buffer.subarray(3).toString("utf8");
	}
	if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
		return buffer.subarray(2).toString("utf16le");
	}
	if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
		const swapped = Buffer.from(buffer.subarray(2));
		swapped.swap16();
		return swapped.toString("utf16le");
	}

	return buffer.toString("utf8");
};

/**
 * Minimal ZIP reader (central directory + local headers) for DOCX.
 * Supports stored (0) and deflate (8) entries, which is all Office writes.
 */
const readZipEntry = (buffer, wantedName) => {
	const EOCD_SIGNATURE = 0x06054b50;
	const CENTRAL_SIGNATURE = 0x02014b50;
	const LOCAL_SIGNATURE = 0x04034b50;

	let eocd = -1;
	for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
		if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) {
			eocd = index;
			break;
		}
	}
	if (eocd < 0) {
		throw new DocumentExtractionError("Invalid DOCX: ZIP end-of-central-directory not found.", {
			code: "DOCX_INVALID",
		});
	}

	const entryCount = buffer.readUInt16LE(eocd + 10);
	let offset = buffer.readUInt32LE(eocd + 16);

	for (let index = 0; index < entryCount; index += 1) {
		if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
			break;
		}

		const method = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const fileNameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localOffset = buffer.readUInt32LE(offset + 42);
		const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

		if (name === wantedName) {
			if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
				throw new DocumentExtractionError("Invalid DOCX: local ZIP header not found.", {
					code: "DOCX_INVALID",
				});
			}

			const localNameLength = buffer.readUInt16LE(localOffset + 26);
			const localExtraLength = buffer.readUInt16LE(localOffset + 28);
			const dataStart = localOffset + 30 + localNameLength + localExtraLength;
			const dataEnd = dataStart + compressedSize;
			const compressed = buffer.subarray(dataStart, dataEnd);

			if (method === 0) {
				return compressed;
			}
			if (method === 8) {
				return zlib.inflateRawSync(compressed);
			}

			throw new DocumentExtractionError(`Unsupported DOCX compression method: ${method}.`, {
				code: "DOCX_UNSUPPORTED_COMPRESSION",
			});
		}

		offset += 46 + fileNameLength + extraLength + commentLength;
	}

	throw new DocumentExtractionError(`DOCX entry not found: ${wantedName}.`, {
		code: "DOCX_ENTRY_MISSING",
	});
};

export const docxToText = (buffer) => {
	const documentXml = readZipEntry(buffer, "word/document.xml");
	const xml = documentXml.toString("utf8");

	const withBreaks = xml
		.replace(/<w:tab\b[^>]*\/>/g, "\t")
		.replace(/<w:br\b[^>]*\/>/g, "\n")
		.replace(/<\/w:p>/g, "\n")
		.replace(/<\/w:tc>/g, "\t")
		.replace(/<\/w:tr>/g, "\n");

	// `<w:t>` holds the text; every other tag is formatting noise.
	const text = decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, ""));

	return text
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
};

const truncateText = (text, maxChars) => {
	if (text.length <= maxChars) {
		return { text, truncated: false };
	}
	return {
		text: `${text.slice(0, maxChars)}\n\n[... texto truncado: ${text.length - maxChars} caracteres omitidos]`,
		truncated: true,
	};
};

const pdfToText = async (buffer, { maxPages = DEFAULT_MAX_PAGES } = {}) => {
	const loadingTask = pdfjs.getDocument({
		data: new Uint8Array(buffer),
		useSystemFonts: false,
		isEvalSupported: false,
		...(STANDARD_FONT_DATA_URL ? { standardFontDataUrl: STANDARD_FONT_DATA_URL } : {}),
	});

	const doc = await loadingTask.promise;
	const totalPages = doc.numPages;
	const pages = Math.min(totalPages, Math.max(1, maxPages));
	const chunks = [];

	try {
		for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
			const page = await doc.getPage(pageNumber);
			const content = await page.getTextContent();
			const items = Array.isArray(content?.items) ? content.items : [];
			let lastY = null;
			const parts = [];

			for (const item of items) {
				if (typeof item?.str !== "string") {
					continue;
				}
				const y = Array.isArray(item.transform) ? item.transform[5] : null;
				if (lastY != null && y != null && Math.abs(y - lastY) > 2) {
					parts.push("\n");
				} else if (parts.length) {
					parts.push(" ");
				}
				parts.push(item.str);
				if (y != null) {
					lastY = y;
				}
			}

			const text = parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
			chunks.push(`--- pagina ${pageNumber} ---\n${text}`);
			page.cleanup?.();
		}
	} finally {
		await doc.destroy?.();
	}

	return {
		text: chunks.join("\n\n"),
		pages: totalPages,
		extractedPages: pages,
		truncatedPages: totalPages > pages,
	};
};

const unsupportedError = (mimeType, fileName) => {
	const label = fileName || mimeType || "ese archivo";
	return new DocumentExtractionError(
		`Unsupported document type for ${label}. Supported: PDF, DOCX and plain-text formats.`,
		{
			code: "DOCUMENT_UNSUPPORTED",
			userMessage: `No puedo leer "${label}": ese formato no esta soportado. Envia PDF, DOCX o texto (TXT, MD, CSV, JSON, HTML, XML).`,
		},
	);
};

/**
 * Extracts plain text from an in-memory document.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|string|{data?: any, base64?: string, dataUrl?: string, mimeType?: string, fileName?: string}} input
 * @param {{mimeType?: string, fileName?: string, maxChars?: number, maxPages?: number}} [options]
 * @returns {Promise<{ok: boolean, kind: string, text: string, truncated: boolean, pages?: number, extractedPages?: number, chars: number, mimeType: string, fileName: string}>}
 */
export const extractDocumentText = async (input, options = {}) => {
	const descriptor = normalizeBinaryDescriptor(input, {
		mimeType: options.mimeType,
		fileName: options.fileName,
	});
	const mimeType = descriptor.mimeType || guessMimeTypeFromName(descriptor.fileName);
	const fileName = descriptor.fileName || "";
	const kind = detectDocumentKind({ mimeType, fileName });
	const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : DEFAULT_MAX_CHARS;

	if (!descriptor.data.length) {
		throw new DocumentExtractionError("The document is empty.", {
			code: "DOCUMENT_EMPTY",
			userMessage: "El archivo llego vacio (0 bytes).",
		});
	}

	if (kind === "unsupported") {
		throw unsupportedError(mimeType, fileName);
	}

	let text = "";
	let truncated = false;
	let pages;
	let extractedPages;

	if (kind === "pdf") {
		try {
			const result = await pdfToText(descriptor.data, {
				maxPages: Number.isFinite(options.maxPages) ? options.maxPages : DEFAULT_MAX_PAGES,
			});
			text = result.text;
			pages = result.pages;
			extractedPages = result.extractedPages;

			if (!text.trim()) {
				throw new DocumentExtractionError(
					"The PDF has no extractable text (probably a scanned image).",
					{
						code: "PDF_NO_TEXT",
						userMessage: "El PDF no tiene texto extraible (parece escaneado). Envia las paginas como imagenes para que las lea con vision.",
					},
				);
			}
		} catch (error) {
			if (error instanceof DocumentExtractionError) {
				throw error;
			}
			throw new DocumentExtractionError(`Could not read the PDF: ${error?.message || error}`, {
				code: "PDF_INVALID",
				userMessage: "No pude leer ese PDF: parece danado o protegido.",
			});
		}
	} else if (kind === "docx") {
		try {
			text = docxToText(descriptor.data);
		} catch (error) {
			if (error instanceof DocumentExtractionError) {
				throw error;
			}
			throw new DocumentExtractionError(`Could not read the DOCX: ${error?.message || error}`, {
				code: "DOCX_INVALID",
				userMessage: "No pude leer ese DOCX: parece danado. Si puedes, guardalo de nuevo como PDF.",
			});
		}
	} else if (kind === "html") {
		text = htmlToText(decodeTextBuffer(descriptor.data));
	} else {
		text = decodeTextBuffer(descriptor.data);
	}

	const limited = truncateText(text, maxChars);
	truncated = limited.truncated;

	return {
		ok: true,
		kind,
		text: limited.text,
		truncated,
		pages,
		extractedPages,
		chars: text.length,
		mimeType,
		fileName,
	};
};

export class DocumentReader {
	constructor(defaults = {}) {
		this.defaults = { ...defaults };
	}

	async read(input, options = {}) {
		return extractDocumentText(input, { ...this.defaults, ...options });
	}
}

export const createDocumentReader = (defaults = {}) => new DocumentReader(defaults);
