/** Reason a snapshot was taken. Automatic triggers fire before destructive
 *  operations that overwrite installed mods (update from Browse,
 *  apply-profile swap). `manual` is the "Snapshot now" button. */
export type SnapshotTrigger = 'pre-update' | 'pre-apply-profile' | 'manual';

/** Summary used by the list view. Keeps the wire small when the user has
 *  accumulated many snapshots — the full PortableProfile only crosses the
 *  IPC boundary on restore, not on list. */
export interface SnapshotSummary {
    snapshotId: string;
    createdAt: string;
    trigger: SnapshotTrigger;
    modCount: number;
    profileName: string;
}
