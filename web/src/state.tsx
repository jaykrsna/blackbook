import { createContext, useContext } from 'react';
import type { Repo } from './lib/repo';
import type { UserMeta } from './lib/types';

export interface AppState {
  repo: Repo;
  meta: UserMeta;
  cycleId: string;
  today: string;
  day: number;
  refresh: () => Promise<void>;
  lock: () => Promise<void>;
  go: (tab: Tab) => void;
}

export type Tab = 'today' | 'plan' | 'review' | 'history' | 'settings' | 'audit';

export const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('App state missing');
  return v;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
