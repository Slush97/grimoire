import { createContext, useContext } from 'react';
import type { PanelBox, PanelGuides } from '../../lib/floatingPanelGeometry';

export interface FloatingPanelAreaValue {
  bounds: PanelBox | null;
  showGuides: (owner: symbol, guides: PanelGuides) => void;
  clearGuides: (owner: symbol) => void;
}

export const FloatingPanelContext = createContext<FloatingPanelAreaValue | null>(null);

export function useFloatingPanelArea(): FloatingPanelAreaValue {
  const area = useContext(FloatingPanelContext);
  if (!area) throw new Error('Floating panels need a FloatingPanelArea');
  return area;
}
