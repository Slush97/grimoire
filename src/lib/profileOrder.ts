/**
 * Put saved profiles in the order the user dragged them into. An id the order
 * does not mention (a profile created in another window meanwhile) keeps its
 * place after the listed ones, and an id that no longer exists is ignored, so
 * a stale drag can never drop or duplicate a profile.
 */
export function applyProfileOrder<T extends { id: string }>(profiles: readonly T[], orderedIds: readonly string[]): T[] {
  const rank = new Map<string, number>();
  for (const id of orderedIds) {
    if (!rank.has(id)) rank.set(id, rank.size);
  }
  return profiles
    .map((profile, index) => ({ profile, index }))
    .sort((a, b) =>
      (rank.get(a.profile.id) ?? rank.size) - (rank.get(b.profile.id) ?? rank.size) || a.index - b.index)
    .map(({ profile }) => profile);
}
