export function withDirtySource(sources: ReadonlySet<string>, source: string, dirty: boolean): ReadonlySet<string> {
  if (sources.has(source) === dirty) return sources;
  const next = new Set(sources);
  if (dirty) next.add(source);
  else next.delete(source);
  return next;
}
