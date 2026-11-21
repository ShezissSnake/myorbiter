/**
 * `run`, kept to one at a time: a call while an earlier one is still going does nothing and
 * resolves to undefined. Once that one ends (or fails), the next call runs.
 */
export function oneAtATime<A extends unknown[], T>(run: (...args: A) => Promise<T>): (...args: A) => Promise<T | undefined> {
  let going = false;
  return async (...args: A) => {
    if (going) return undefined;
    going = true;
    try {
      return await run(...args);
    } finally {
      going = false;
    }
  };
}
