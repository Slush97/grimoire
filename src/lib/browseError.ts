export function browseErrorDetails(error: string): string {
  return error.replace(/^(?:Error: )?Error invoking remote method '[^']+': /, '');
}

export function browseErrorKind(error: string): 'connection' | 'timeout' | 'rateLimited' | 'blocked' | 'unavailable' | 'unexpected' {
  if (/\b(?:timed out|ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT)\b/i.test(error)) return 'timeout';
  const status = /GameBanana API error:\s*(\d{3})\b/i.exec(error)?.[1];
  if (status === '429') return 'rateLimited';
  if (status === '403') return 'blocked';
  if (status?.startsWith('5') || /GameBanana API returned (?:an? )?(?:empty response|invalid JSON)/i.test(error)) return 'unavailable';
  if (/\bfetch failed\b|\bnetwork(?: request)? (?:error|failed)\b|\b(?:ENOTFOUND|EAI_AGAIN|ECONNABORTED|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|UND_ERR_[A-Z_]+)\b/i.test(error)) return 'connection';
  return 'unexpected';
}
