import { createContext, useContext } from 'react';

export interface ContentFilter {
  matches: ReadonlySet<string>;
  visible: ReadonlySet<string>;
}

export const ContentFilterContext = createContext<ContentFilter | null>(null);

export function useContentFilter(id?: string) {
  const filter = useContext(ContentFilterContext);
  return {
    visible: !filter || !id || filter.visible.has(id),
    childrenFilter: id && filter?.matches.has(id) ? null : filter,
  };
}

