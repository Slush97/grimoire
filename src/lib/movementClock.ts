import { createContext, type RefObject } from 'react';

export const MovementClock = createContext<RefObject<number> | null>(null);
