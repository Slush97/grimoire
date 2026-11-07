import { create } from 'zustand';
import type { InstalledIssueGroup } from '../lib/installedIssues';

interface SessionIssues { currentIds: ReadonlySet<string>; unreadIds: ReadonlySet<string>; outdatedIds: ReadonlySet<string> }
interface InstalledIssuesState extends SessionIssues {
  scope: string | null;
  open: boolean;
  busy: boolean;
  hasUnread: boolean;
  hasUnreadOutdated: boolean;
  sessions: Readonly<Record<string, SessionIssues>>;
  activate: (scope: string | null) => void;
  receive: (scope: string | null, groups: InstalledIssueGroup[]) => void;
  setOpen: (open: boolean) => void;
  setBusy: (busy: boolean) => void;
  mountView: () => () => void;
}

const empty = (): SessionIssues => ({ currentIds: new Set(), unreadIds: new Set(), outdatedIds: new Set() });
const hasUnreadOutdated = ({ unreadIds, outdatedIds }: SessionIssues) => [...outdatedIds].some(id => unreadIds.has(id));
let viewOwner: symbol | null = null;

/** App-session acknowledgement only. Resolving a finding lets a recurrence notify again. */
export const useInstalledIssuesStore = create<InstalledIssuesState>((set) => ({
  scope: null, open: false, busy: false, hasUnread: false, hasUnreadOutdated: false, sessions: {}, ...empty(),
  activate: scope => set(state => {
    if (scope === state.scope) return state;
    const session = scope ? state.sessions[scope] ?? empty() : empty();
    return { scope, open: false, ...session, hasUnread: session.unreadIds.size > 0, hasUnreadOutdated: hasUnreadOutdated(session) };
  }),
  receive: (scope, groups) => set(state => {
    const sameScope = scope === state.scope;
    const previous = sameScope ? state : scope ? state.sessions[scope] ?? empty() : empty();
    const currentIds = new Set(groups.flatMap(group => group.issues.map(issue => issue.key)));
    const outdatedIds = new Set(groups.flatMap(group => group.issues.filter(issue => issue.kind === 'data').map(issue => issue.key)));
    const open = sameScope && state.open;
    const unreadIds = open ? new Set<string>() : new Set([...currentIds]
      .filter(id => previous.unreadIds.has(id) || !previous.currentIds.has(id)));
    const session = { currentIds, unreadIds, outdatedIds };
    return { scope, open, ...session, hasUnread: unreadIds.size > 0, hasUnreadOutdated: hasUnreadOutdated(session),
      sessions: scope ? { ...state.sessions, [scope]: session } : state.sessions };
  }),
  setOpen: open => set(state => {
    if ((!open && state.busy) || (open && (state.busy || !state.scope))) return state;
    const unreadIds = open ? new Set<string>() : state.unreadIds;
    const session = { currentIds: state.currentIds, unreadIds, outdatedIds: state.outdatedIds };
    return { open, unreadIds, hasUnread: unreadIds.size > 0, hasUnreadOutdated: hasUnreadOutdated(session),
      sessions: state.scope ? { ...state.sessions, [state.scope]: session } : state.sessions };
  }),
  setBusy: busy => set({ busy }),
  mountView: () => {
    const owner = Symbol();
    viewOwner = owner;
    return () => queueMicrotask(() => {
      // A StrictMode replay or a new view owns the dialog before this runs.
      if (viewOwner !== owner) return;
      viewOwner = null;
      set({ open: false });
    });
  },
}));
