/**
 * OpenFusionAPI agent kit.
 *
 * Provider-agnostic agent building blocks on top of `ia.js`:
 *
 * - policies: deterministic decisions (web/recall detection, prompt recaps)
 * - websearch: DuckDuckGo/Bing/HTTP-JSON search with a browser User-Agent
 * - documents: in-memory PDF/DOCX/text extraction (no filesystem)
 * - media: images, STT/TTS provider registries, video frames via ffmpeg
 * - agent: `askAgent()` orchestration returning a single envelope
 *
 * Nothing here touches Telegram or the database, so the same code works from a
 * JS endpoint, a bot worker or an interval task.
 */

export {
	short,
	normalizeForMatch,
	looksLikeRecall,
	formatHistoryRecap,
	looksLikeWebQuery,
	cleanWebQuery,
	pickWebQuery,
	formatWebRecap,
	trimWebResults,
	looksLikeMissingMedia,
	mergeQuoted,
	URL_RE,
} from "./policies.js";

export {
	guessMimeTypeFromName,
	isDataUrl,
	parseDataUrl,
	toBuffer,
	toDataUrl,
	normalizeBinaryDescriptor,
	isTextMimeType,
	isImageMimeType,
	isAudioMimeType,
	isVideoMimeType,
} from "./buffers.js";

export {
	webSearch,
	createWebSearch,
	listWebSearchEngines,
	extractDuckDuckGoResults,
	extractDuckDuckGoLiteResults,
	extractBingResults,
	WebSearchError,
} from "./websearch.js";

export {
	extractDocumentText,
	createDocumentReader,
	DocumentReader,
	detectDocumentKind,
	docxToText,
	htmlToText,
	DocumentExtractionError,
	SUPPORTED_DOCUMENT_TYPES,
} from "./documents.js";

export {
	MediaProviderError,
	imageToDataUrl,
	normalizeImageList,
	createSpeechToText,
	SpeechToText,
	registerSttProviderType,
	listSttProviderTypes,
	createTextToSpeech,
	TextToSpeech,
	registerTtsProviderType,
	listTtsProviderTypes,
	extractVideoFrames,
	mediaDuration,
	mp4Faststart,
	mp4Duration,
	splitJpegStream,
	runProcess,
	describeMediaSupport,
} from "./media.js";

export {
	askAgent,
	askAgentText,
	AgentError,
} from "./agent.js";
