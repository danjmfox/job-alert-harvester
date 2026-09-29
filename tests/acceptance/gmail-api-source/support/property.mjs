import fc from 'fast-check';

const withCause = (error) =>
  error?.cause ? Object.assign(new Error(`${error.message}\nCaused by: ${error.cause.stack ?? error.cause}`), { cause: error.cause }) : error;

/** fc.assert, keeping the counterexample report and surfacing the underlying error it wraps. */
export function holds(property, parameters) {
  try {
    const outcome = fc.assert(property, parameters);
    return outcome && typeof outcome.then === 'function' ? outcome.catch((error) => Promise.reject(withCause(error))) : outcome;
  } catch (error) {
    throw withCause(error);
  }
}
