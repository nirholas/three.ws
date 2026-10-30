// YAML specs go through js-yaml. js-yaml 5 is ESM with named exports only, so a
// default import made this module (and every api/ route that reaches it) throw
// at load time, before any spec was parsed. Importing the module is the test.

import { describe, it, expect } from 'vitest';

import { parseOpenApiDocument, OpenApiParseError } from '../src/openapi.js';

const YAML_SPEC = `
openapi: 3.0.3
info:
  title: Widgets
  version: 1.0.0
paths:
  /widgets:
    get:
      operationId: listWidgets
      responses:
        '200':
          description: ok
`;

describe('parseOpenApiDocument (YAML)', () => {
	it('parses a YAML OpenAPI 3 document', async () => {
		const { document, convertedFromSwagger2 } = await parseOpenApiDocument(YAML_SPEC);
		expect(convertedFromSwagger2).toBe(false);
		expect(document.info.title).toBe('Widgets');
		expect(document.paths['/widgets'].get.operationId).toBe('listWidgets');
	});

	it('reports malformed YAML as an OpenApiParseError', async () => {
		await expect(parseOpenApiDocument('openapi: 3.0.3\n  info: [unclosed')).rejects.toBeInstanceOf(OpenApiParseError);
	});
});
