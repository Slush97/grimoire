import { createContext } from 'react';

export interface ListDragBox { left: number; top: number; width: number; height: number }
export const InstalledListDragBoxContext = createContext<ListDragBox | null>(null);
