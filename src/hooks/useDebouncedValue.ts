import { useEffect, useState } from 'react';

/** Debounce a display search term before starting a new database query.
 * The input remains responsive while intermediate keystrokes do not trigger HTTP requests.
 * Search scope, authorization and server-side filtering remain with the calling page.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
