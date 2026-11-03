import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLocation } from '../api/tech-events.js';

describe('tech-events normalizeLocation', () => {
  it('places a bare San Jose in California, the tech hub, not Costa Rica', () => {
    assert.equal(normalizeLocation('San Jose').country, 'USA');
    assert.equal(normalizeLocation('San Jose, CA').country, 'USA');
  });

  it('places San Jose in Costa Rica when the location says so', () => {
    const coords = normalizeLocation('San Jose, Costa Rica');
    assert.equal(coords.country, 'Costa Rica');
    assert.equal(coords.lat, 9.9281);
  });

  it('places a bare Cambridge in Massachusetts and Cambridge, UK in England', () => {
    assert.equal(normalizeLocation('Cambridge, MA').country, 'USA');
    assert.equal(normalizeLocation('Cambridge, UK').country, 'UK');
    assert.equal(normalizeLocation('Cambridge, England').country, 'UK');
    assert.equal(normalizeLocation('Cambridge, United Kingdom').lat, 52.2053);
  });

  it('keeps the original string on the result', () => {
    assert.equal(normalizeLocation('Cambridge, UK').original, 'Cambridge, UK');
  });
});
