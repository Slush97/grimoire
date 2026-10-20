import { describe, expect, it } from 'vitest';
import { browseErrorDetails, browseErrorKind } from './browseError';

describe('Browse error presentation', () => {
  it.each([
    ["Error: Error invoking remote method 'browse-mods': TypeError: fetch failed", 'connection'],
    ['Error: getaddrinfo ENOTFOUND gamebanana.com', 'connection'],
    ['Error: read ECONNRESET', 'connection'],
    ['Error: GameBanana API request timed out after 30 seconds', 'timeout'],
    ['TypeError: fetch failed: UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['Error: GameBanana API error: 429 Too Many Requests', 'rateLimited'],
    ['Error: GameBanana API error: 403 Forbidden', 'blocked'],
    ['Error: GameBanana API error: 503 Service Unavailable', 'unavailable'],
    ['Error: GameBanana API returned invalid JSON: SyntaxError', 'unavailable'],
    ['Error: GameBanana API returned empty response', 'unavailable'],
    ['Error: GameBanana API error: 404 Not Found', 'unexpected'],
    ['TypeError: Cannot read properties of undefined', 'unexpected'],
    ['Error: Failed to parse item 429', 'unexpected'],
  ])('classifies %s as %s', (error, kind) => {
    expect(browseErrorKind(error)).toBe(kind);
  });

  it('removes the Electron wrapper while preserving the diagnostic', () => {
    expect(browseErrorDetails("Error: Error invoking remote method 'browse-mods': TypeError: fetch failed"))
      .toBe('TypeError: fetch failed');
    expect(browseErrorDetails("Error invoking remote method 'get-gamebanana-sections': Error: GameBanana API error: 403 Forbidden"))
      .toBe('Error: GameBanana API error: 403 Forbidden');
    expect(browseErrorDetails('Unexpected error')).toBe('Unexpected error');
  });
});
