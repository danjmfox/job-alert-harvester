// Driven adapter: writes slimmed records into the month-sharded cache (DR-0002).
// Write-only by design (D-18) — a component that only reads cannot be handed an
// object with a write method on it.
// Bounded change universe: cacheRoot/**.
//
// RED scaffold — created by DISTILL.

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

export const CacheRefusal = Object.freeze({
  NOT_WRITABLE: 'cache.not-writable',
});

/** @returns {{ put: Function, probe: Function }} */
export function createMessageCache(_cacheRoot) {
  return {
    put: (_record) => notImplemented('messageCache.put'),
    probe: () => notImplemented('messageCache.probe'),
  };
}
