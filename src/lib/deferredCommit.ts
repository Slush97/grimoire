/** Save the final interaction after idle, or synchronously when leaving. */
export function deferredCommit<T>(commit: (value: T) => void, delay = 250) {
  let pending: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    const next = pending;
    pending = undefined;
    if (next) commit(next.value);
  };
  return {
    update(value: T) { pending = { value }; clearTimeout(timer); timer = setTimeout(flush, delay); },
    flush,
  };
}
