/**
 * Binary helpers shared by the agent kit.
 *
 * The platform runs JS handlers as web services: there is no filesystem, so every
 * document, image, audio or video arrives as a Buffer, an ArrayBuffer, a base64
 * string or a data URL. These helpers normalise all four shapes into a Buffer and
 * back into the data URL that vision APIs expect.
 */

const DATA_URL_RE = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i;

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;

export const guessMimeTypeFromName = (fileName) => {
	const name = String(fileName || "").toLowerCase();
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

	const map = {
		pdf: "application/pdf",
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		txt: "text/plain",
		md: "text/markdown",
		markdown: "text/markdown",
		csv: "text/csv",
		tsv: "text/tab-separated-values",
		json: "application/json",
		html: "text/html",
		htm: "text/html",
		xml: "application/xml",
		yaml: "application/yaml",
		yml: "application/yaml",
		log: "text/plain",
		srt: "text/plain",
		vtt: "text/vtt",
		ogg: "audio/ogg",
		oga: "audio/ogg",
		opus: "audio/ogg",
		mp3: "audio/mpeg",
		m4a: "audio/mp4",
		wav: "audio/wav",
		flac: "audio/flac",
		webm: "audio/webm",
		mp4: "video/mp4",
		mov: "video/quicktime",
		mkv: "video/x-matroska",
		avi: "video/x-msvideo",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		webp: "image/webp",
		gif: "image/gif",
		bmp: "image/bmp",
		heic: "image/heic",
	};

	return map[ext] || "application/octet-stream";
};

export const isDataUrl = (value) => typeof value === "string" && /^data:/i.test(value.trim());

export const parseDataUrl = (value) => {
	const match = String(value || "").trim().match(DATA_URL_RE);
	if (!match) {
		return null;
	}

	const isBase64 = Boolean(match[2]);
	const payload = match[3] || "";

	return {
		mimeType: match[1] || "application/octet-stream",
		base64: isBase64,
		data: isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8"),
	};
};

/**
 * Accepts every shape the platform can hand over and returns a Buffer.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|string|{data?: any, buffer?: any, base64?: string, dataUrl?: string, content?: any}} input
 * @param {{encoding?: string, allowBase64String?: boolean}} [options]
 * @returns {Buffer}
 */
export const toBuffer = (input, options = {}) => {
	const { encoding, allowBase64String = true } = options;

	if (input == null) {
		throw new TypeError("Binary input is required.");
	}

	if (Buffer.isBuffer(input)) {
		return input;
	}

	if (input instanceof Uint8Array) {
		return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	}

	if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) {
		return Buffer.from(input);
	}

	if (typeof input === "string") {
		if (isDataUrl(input)) {
			const parsed = parseDataUrl(input);
			if (!parsed) {
				throw new TypeError("The data URL could not be parsed.");
			}
			return parsed.data;
		}

		if (encoding) {
			return Buffer.from(input, encoding);
		}

		if (allowBase64String) {
			const compact = input.replace(/\s+/g, "");
			if (compact.length >= 16 && compact.length % 4 === 0 && BASE64_RE.test(compact)) {
				return Buffer.from(compact, "base64");
			}
		}

		return Buffer.from(input, "utf8");
	}

	if (isPlainObject(input)) {
		if (input.dataUrl != null) {
			return toBuffer(input.dataUrl, options);
		}
		if (input.base64 != null) {
			return Buffer.from(String(input.base64).replace(/\s+/g, ""), "base64");
		}
		if (input.buffer != null) {
			return toBuffer(input.buffer, options);
		}
		if (input.data != null) {
			return toBuffer(input.data, options);
		}
		if (input.content != null) {
			return toBuffer(input.content, options);
		}
	}

	throw new TypeError("Unsupported binary input. Use a Buffer, ArrayBuffer, base64 string or data URL.");
};

export const toDataUrl = (input, mimeType = "application/octet-stream") => {
	if (isDataUrl(input)) {
		return String(input).trim();
	}

	const buffer = toBuffer(input);
	const type = String(mimeType || "application/octet-stream").trim() || "application/octet-stream";

	return `data:${type};base64,${buffer.toString("base64")}`;
};

/**
 * Resolves `{ data, mimeType, fileName }` from a loose media descriptor.
 * Accepted shapes: Buffer, data URL, base64 string, or an object with those fields.
 */
export const normalizeBinaryDescriptor = (input, defaults = {}) => {
	const objectInput = isPlainObject(input) ? input : { data: input };
	const mimeType = String(
		objectInput.mimeType
		?? objectInput.mime_type
		?? objectInput.contentType
		?? objectInput.content_type
		?? defaults.mimeType
		?? (isDataUrl(objectInput.data) ? parseDataUrl(objectInput.data)?.mimeType : undefined)
		?? (objectInput.dataUrl ? parseDataUrl(objectInput.dataUrl)?.mimeType : undefined)
		?? (objectInput.fileName ?? objectInput.file_name ?? defaults.fileName
			? guessMimeTypeFromName(objectInput.fileName ?? objectInput.file_name ?? defaults.fileName)
			: "application/octet-stream"),
	).trim() || "application/octet-stream";

	const fileName = String(objectInput.fileName ?? objectInput.file_name ?? objectInput.name ?? defaults.fileName ?? "").trim();
	const data = toBuffer(objectInput.dataUrl ?? objectInput.base64 ?? objectInput.data ?? objectInput, {
		encoding: typeof (objectInput.data ?? objectInput) === "string" ? defaults.encoding : undefined,
	});

	return { data, mimeType, fileName };
};

export const isTextMimeType = (mimeType) => {
	const type = String(mimeType || "").toLowerCase();
	return type.startsWith("text/")
		|| type.includes("json")
		|| type.includes("xml")
		|| type.includes("yaml")
		|| type.includes("javascript")
		|| type.includes("x-www-form-urlencoded");
};

export const isImageMimeType = (mimeType) => /^image\//i.test(String(mimeType || ""));
export const isAudioMimeType = (mimeType) => /^audio\//i.test(String(mimeType || ""));
export const isVideoMimeType = (mimeType) => /^video\//i.test(String(mimeType || ""));
