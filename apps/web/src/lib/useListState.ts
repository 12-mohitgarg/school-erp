import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List page state (page, search, filters) mirrored into the URL.
 *
 * Keeping it in the query string means a filtered view is shareable, survives a
 * refresh, and the browser back button behaves the way users expect.
 */
export function useListState(defaults: Record<string, string> = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Debounced search is held locally so typing does not push a history entry
  // per keystroke.
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');

  const params = useMemo(() => {
    const merged: Record<string, string> = { ...defaults };
    searchParams.forEach((value, key) => {
      if (value) merged[key] = value;
    });
    return merged;
  }, [searchParams, defaults]);

  const page = Number(params['page'] ?? 1);

  const setParam = useCallback(
    (key: string, value: string | undefined) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value === undefined || value === '') next.delete(key);
          else next.set(key, value);
          // Any filter change invalidates the current page number.
          if (key !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setPage = useCallback((next: number) => setParam('page', String(next)), [setParam]);

  const commitSearch = useCallback(
    (value: string) => {
      setSearchDraft(value);
      setParam('search', value || undefined);
    },
    [setParam],
  );

  const reset = useCallback(() => {
    setSearchDraft('');
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const activeFilterCount = useMemo(
    () => [...searchParams.keys()].filter((k) => k !== 'page' && k !== 'search').length,
    [searchParams],
  );

  return {
    params,
    page,
    searchDraft,
    setSearchDraft,
    commitSearch,
    setParam,
    setPage,
    reset,
    activeFilterCount,
  };
}
