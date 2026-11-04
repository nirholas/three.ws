// JSON Schemas for every gateway tool's input. One definition feeds the MCP
// tools/list entries, GET /api/v1/tools and docs/tool-gateway.md, so the three
// can never disagree about what a tool accepts.

import { SUPPORTED_ASPECT_RATIOS } from '../ai-image-lanes.js';
import { TTS_VOICE_IDS } from '../tts-voices.js';

const obj = (required, properties) => ({ type: 'object', additionalProperties: false, required, properties });

export const GATEWAY_INPUTS = Object.freeze({
	web_search: obj(['query'], {
		query: { type: 'string', minLength: 1, maxLength: 500, description: 'What to search the web for.' },
		max_results: { type: 'integer', minimum: 1, maximum: 10, default: 8, description: 'How many cited sources to return.' },
	}),
	web_fetch: obj(['url'], {
		url: { type: 'string', description: 'A public http(s) URL. Private and internal addresses are refused.' },
		max_chars: { type: 'integer', minimum: 500, maximum: 100000, default: 20000, description: 'Cap on returned text.' },
		include_links: { type: 'boolean', default: true, description: 'Include the page outbound links.' },
	}),
	parse_document: obj([], {
		url: { type: 'string', description: 'A public URL of a PDF, DOCX, XLSX, CSV, HTML or text file.' },
		document: { type: 'string', description: 'The file as base64 (a data: URI is accepted), up to 15 MB. Use instead of url.' },
		filename: { type: 'string', maxLength: 200, description: 'Original file name, used to tell DOCX from XLSX when needed.' },
		max_chars: { type: 'integer', minimum: 500, maximum: 200000, default: 50000, description: 'Cap on returned text.' },
	}),
	tts: obj(['text'], {
		text: { type: 'string', minLength: 1, description: 'The text to speak.' },
		voice: { type: 'string', enum: TTS_VOICE_IDS, description: 'Voice id.' },
		language: { type: 'string', maxLength: 16, default: 'en-US', description: 'BCP-47 language code.' },
	}),
	transcribe: obj([], {
		url: { type: 'string', description: 'A public URL of an audio file (WAV, FLAC, Ogg, MP3, M4A, WebM).' },
		audio: { type: 'string', description: 'The audio as base64 (a data: URI is accepted), up to 15 MB. Use instead of url.' },
		language: { type: 'string', maxLength: 16, default: 'en-US', description: 'Expected BCP-47 language.' },
		words: { type: 'boolean', default: false, description: 'Return word timestamps when the lane supports them.' },
	}),
	image_generate: obj(['prompt'], {
		prompt: { type: 'string', minLength: 3, maxLength: 2000, description: 'What to draw.' },
		aspect_ratio: { type: 'string', enum: SUPPORTED_ASPECT_RATIOS, default: '1:1' },
		seed: { type: 'integer', minimum: 0, maximum: 4294967295, description: 'Deterministic seed on lanes that support one.' },
	}),
});
