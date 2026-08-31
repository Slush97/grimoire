# App-Wide Local Mod File Drop Plan

## Goal

Allow users to drag supported local mod files anywhere into the Grimoire window, on any page or over any ordinary app surface, and enter the same review and import workflow as the existing **Import Local Mods** button.

Supported source types remain:

- `.vpk`
- `.zip`
- `.7z`
- `.rar`

Dropping files must stage them in the existing import modal. It must not install them immediately without confirmation.

## Current State

The required import machinery already exists:

- `src/App.tsx` prevents stray drops from navigating Electron to a `file://` URL, but otherwise discards them.
- `src/components/Layout.tsx` globally hosts `ImportCustomModsModal`, allowing the modal to survive route and installed-list changes.
- `src/components/ImportCustomModsModal.tsx` already supports multiple VPKs and archives, editable names, thumbnails, NSFW flags, imprint recognition, variant grouping, progress, partial failures, and retries.
- `src/lib/customModImport.ts` already defines supported extensions, filename parsing, and platform-aware path deduplication.
- `electron/preload/index.ts` already exposes `webUtils.getPathForFile(file)` through the context-isolated preload bridge.
- `electron/main/ipc/mods.ts` already implements the complete batch local-import backend.

The feature should therefore be a renderer-level routing and state change. It should not introduce a second import backend or duplicate the existing modal.

## Desired User Experience

### Normal drop

1. The user drags one or more supported files over the app.
2. Grimoire displays a subtle app-wide drop indicator such as **Drop VPKs or archives to import**.
3. The user drops the files anywhere in the window.
4. The existing **Import Local Mods** modal opens with the supported files already listed.
5. The user can review names and options, add thumbnails, group variants, and confirm the import normally.

### Drop while the modal is open

Additional supported files are appended to the existing rows. Existing rows and edits are preserved, and duplicate paths are ignored using the current platform-aware path rules.

### Unsupported or mixed drop

- If the drop contains supported and unsupported files, stage the supported files and report the first unsupported file once.
- If no supported mod file is present, do not open the local-mod importer.
- Specialized MP3, GLB, and image drop zones retain ownership of their file types.
- URL, text, directory, and internal UI drag operations are not treated as local mod imports.

### Drop while the add-variants modal is open

`ImportCustomModsModal` has a second instance, hosted by `Installed.tsx` with `addToGroup`, which is itself a VPK/archive drop target. While that instance is mounted, the global controller must stand down entirely for supported mod files: the drop belongs to the add-variants modal and must become a variant row there, never open the Layout batch importer on top of it. Default-navigation protection still applies.

### Drag indicator precision

During `dragover` only `item.kind`/`item.type` are available, and `.vpk` (and typically `.7z`/`.rar`) report an empty MIME type. The extension is only knowable at `drop`. The app-wide indicator therefore shows for **any** external file drag, including an image headed for a thumbnail zone. This is unavoidable; write the indicator copy so it reads as an offer, not a promise ("Drop VPKs or archives to import"), and keep all claiming logic at `drop` time so specialized zones are unaffected by the indicator being visible.

### Drop during an active import

Do not mutate the batch while it is being submitted. Reject the drop with concise feedback asking the user to wait for the current import to finish. This avoids files being lost when completed rows are reconciled or the modal closes.

### Missing game path

Files may be staged, but the UI must clearly surface that Deadlock setup is required before import can complete. Do not bypass the existing main-process game-path validation.

## Event Ownership and Routing

Use one app-level controller for external mod file drops.

The global `drop` handler should run in the capture phase so it can recognize supported mod files even when the pointer is over:

- A routed page
- The sidebar or app chrome
- A modal backdrop
- Content rendered through a React portal
- A specialized drop zone

Routing rules:

1. Inspect `DataTransfer.files` on `drop`.
2. If at least one file has a supported mod extension, the global importer owns the drop.
3. Prevent the browser/Electron default and stop propagation for that supported mod drop.
4. Resolve supported files to disk paths and enqueue them for the existing modal.
5. If there are no supported mod files, allow the event to continue to specialized drop zones.
6. Continue preventing unclaimed external file drops from navigating the Electron window.

The app-wide `dragover` protection should only react to file items, using `DataTransfer.items` and `item.kind === 'file'`. Internal reorder operations and dragged links should not be swallowed unnecessarily.

For supported mod files, global ownership takes precedence even when the pointer is over an image, MP3, or GLB drop zone. Non-mod files continue to be handled by those specialized zones.

The one exception is the add-variants instance of `ImportCustomModsModal` (hosted by `Installed.tsx` with `addToGroup`). While it is mounted it registers itself in the store (a `suppressGlobalModDrop` flag set on mount, cleared on unmount), and the global controller lets supported mod drops pass through to the modal's own drop zone. The modal already ignores drops while submitting, so the global busy flag does not need to cover the add-variants submission.

A consequence of capture-phase ownership: in the Layout-hosted batch instance, the modal's inline `handleDrop` classification for supported files becomes unreachable. Supported paths only arrive through the store handoff, and mixed-drop or unresolved-file feedback for those drops comes from the global controller. The inline drop path remains live only for the add-variants instance (where the global controller yields). Both paths must use the shared parser; do not keep two classification implementations.

## State Design

Extend the existing batch-import state in `useAppStore` instead of introducing a custom DOM event or a second modal instance.

`batchImportOpen` and `setBatchImportOpen` already exist (`appStore.ts`). The new actions replace `setBatchImportOpen`; update its call sites: `Layout.tsx` (modal `onClose`) and `Installed.tsx` (`setImportOpen`, the toolbar button).

Renderer state (`batchImportOpen` existing, the rest new):

```ts
batchImportOpen: boolean;
batchImportPendingPaths: string[];
batchImportBusy: boolean;
suppressGlobalModDrop: boolean;
```

Actions:

```ts
openBatchImport(paths?: string[]): void;
consumeBatchImportPaths(paths: string[]): void;
setBatchImportBusy(busy: boolean): void;
closeBatchImport(): void;
setSuppressGlobalModDrop(suppress: boolean): void;
```

Behavior:

- `openBatchImport()` merges incoming paths using `pathDedupeKey()` and opens the modal.
- The modal consumes pending paths into its local editable rows, then acknowledges them through `consumeBatchImportPaths()`.
- Acknowledgement must use a functional store update so a second drop arriving during the first acknowledgement is retained.
- `closeBatchImport()` closes the modal and clears pending paths.
- `batchImportBusy` lets the app-level controller reject drops during submission rather than enqueueing data that may be discarded when the batch completes.
- `suppressGlobalModDrop` is set by the add-variants modal instance on mount and cleared on unmount; while set, the global controller does not claim supported mod drops.
- Existing button call sites should use `openBatchImport()` with no paths.

Editable row state should remain inside `ImportCustomModsModal`. Only the short-lived path handoff belongs in the store.

## Shared Drop Parsing

Move file classification and path resolution out of `ImportCustomModsModal` into `src/lib/customModImport.ts` or a focused adjacent module.

Suggested result shape:

```ts
interface DroppedModFiles {
  paths: string[];
  rejectedNames: string[];
  unresolvedCount: number;
}
```

The helper should:

- Accept a `File[]` or readonly file collection.
- Match extensions with `VPK_IMPORT_RE`.
- Resolve supported files through an injected `getPathForFile` function.
- Preserve input order.
- Separate unsupported and unresolved files.
- Avoid UI state, translations, toasts, and direct store access so it remains easy to unit test.

Both the global controller and the import modal should use this helper to guarantee identical behavior.

An empty path must retain the existing explanation for files dragged from Windows archive viewers: users should drag the archive itself rather than a virtual file from inside it.

## File-by-File Implementation

### `src/App.tsx`

- Replace the swallow-only drop effect with, or delegate it to, an app-wide file-drop hook/controller.
- Register capture-phase handlers for supported mod drops.
- Keep default-navigation protection for all external file drops.
- Ignore internal and non-file drags.
- Resolve and enqueue supported paths through the store.
- Report unsupported, unresolved, setup, and busy states through localized feedback.
- Drive the app-wide drag indicator.

Prefer extracting the event logic to a hook if keeping it in `App.tsx` would obscure the root component.

### `src/stores/appStore.ts`

- Add pending path, busy, and suppression state.
- Add the open, consume, busy, close, and suppress actions described above.
- Remove `setBatchImportOpen`; migrate its call sites (`Layout.tsx` onClose, `Installed.tsx` toolbar `setImportOpen`) to the new actions.
- Preserve Windows case-insensitive and POSIX case-sensitive deduplication.

### `src/components/Layout.tsx`

- Continue hosting the sole global `ImportCustomModsModal` instance.
- Pass pending paths and the consume callback to the modal.
- Use the new close action so pending paths are cleared intentionally.
- Connect modal submission state to the store busy flag.

### `src/components/ImportCustomModsModal.tsx`

- Accept incoming paths after initial mount, not only as constructor-time data.
- Add incoming paths through the existing `addPaths()` logic so current deduplication and row defaults remain authoritative. (The existing peek effect keys off `rows`, so post-mount ingestion gets imprint recognition with no extra wiring.)
- Acknowledge paths after staging them.
- Notify the host when submission begins and ends (Layout instance only; the add-variants instance does not touch the global busy flag).
- Replace inline file classification with the shared drop parser. Note that in the Layout-hosted instance the inline supported-file drop path is unreachable (the global controller claims those drops first); it stays live only for the add-variants instance. One implementation via the shared parser serves both.
- In `addToGroup` mode, set `suppressGlobalModDrop` on mount and clear it on unmount.
- Preserve the dragActive highlight and the unsupported/unresolved error priority for drops the modal still handles.

### `src/lib/customModImport.ts`

- Add pure external-file classification and resolution helpers.
- Reuse `VPK_IMPORT_RE` and `pathDedupeKey()`.

### `src/locales/en/translation.json`

Add only strings that are actually displayed, likely:

- App-wide drop indicator
- Busy import drop rejection
- Setup prerequisite feedback, if the existing wording is not reusable

Follow the repository localization workflow and do not add unwired strings to the translated source catalog.

### Tests

Extend `src/lib/customModImport.test.ts` and add focused store or component tests where appropriate.

No changes should be required in:

- `electron/preload/index.ts`
- `src/types/electron.ts`
- `src/lib/api.ts`
- `electron/main/ipc/mods.ts`

## Test Plan

### Unit tests

Cover the shared drop parser:

- Accept `.vpk`, `.zip`, `.7z`, and `.rar` case-insensitively.
- Reject unsupported files.
- Preserve supported files from a mixed drop.
- Count files whose Electron path cannot be resolved.
- Preserve source order.
- Handle an empty file list.

Cover store handoff behavior:

- A drop opens the modal and queues paths.
- Multiple drops append paths.
- Duplicate Windows paths collapse case-insensitively.
- POSIX paths retain case sensitivity.
- Consuming one group of paths does not erase a newer concurrent group.
- Closing clears pending paths and busy state.
- The suppression flag round-trips (set on add-variants mount, cleared on unmount).

Cover modal ingestion if practical with the existing test setup:

- Incoming paths create rows after mount.
- Additional incoming paths do not erase edits to existing rows.
- Removed rows can be re-added by a later drop after their earlier pending path was consumed.
- Busy submission does not accept new rows.

### Manual cross-platform checks

Test on Windows, Linux, and macOS because native drag payload behavior differs by file manager.

Scenarios:

- Drop one VPK on every primary route.
- Drop several VPKs and archives together.
- Drop onto the sidebar, page content, empty space, modal content, and a modal backdrop.
- Drop more files while the import modal is already open.
- Open the add-variants modal from a local mod card, drop a VPK, and confirm it becomes a variant row in that modal (the batch importer must not open).
- Drag an image across the window and confirm the app-wide indicator appearing does not break thumbnail-zone drops.
- Drop a VPK over the modal's thumbnail image field and confirm it becomes an import row.
- Drop an image, MP3, and GLB onto their specialized zones and confirm they retain existing behavior.
- Perform installed-mod reorder interactions and confirm they do not open the importer.
- Drop a URL or selected text and confirm normal behavior is not intercepted.
- Drop unsupported files alone and in a mixed selection.
- Drag a VPK from inside Windows' built-in ZIP viewer and verify the unresolved-path guidance.
- Drop while a batch is actively importing and verify clear busy feedback with no lost rows.
- Test before a Deadlock path is configured.
- Complete a successful import and verify the installed-mod list refreshes exactly as it does for button-driven import.

### Automated checks

Run:

```bash
pnpm exec vitest run src/lib/customModImport.test.ts
pnpm typecheck
pnpm lint
pnpm i18n:check
```

Run the broader relevant test suite if store or modal tests are added outside the focused file.

## Acceptance Criteria

- A supported VPK or archive dropped anywhere in the normal app window opens the existing local-mod import modal with that file staged.
- The behavior works from every route and over React portal content such as modal backdrops.
- Multiple dropped sources are staged in their original order.
- Dropping more files into an already-open import modal appends them without losing existing edits.
- Button-driven import continues to work unchanged from the user's perspective.
- Supported global mod drops do not conflict with image, MP3, GLB, or internal reorder drag operations.
- While the add-variants modal is open, supported drops land in it as variant rows and never open the batch importer.
- Electron never navigates the app window to a dropped local file.
- Unsupported and unresolvable files produce concise feedback and do not create invalid rows.
- Files dropped during an active batch are not silently lost.
- No new privileged renderer access, IPC channel, or duplicate import backend is introduced.
- Existing partial-failure, retry, variant grouping, imprint recognition, and import-progress behavior remains intact.

## Risks and Mitigations

### Global handler conflicts with specialized drop zones

Mitigation: classify by supported mod extension on `drop`. Capture only supported mod drops; let all other file types continue to their local targets.

### Global handler hijacks the add-variants modal

The `addToGroup` instance of `ImportCustomModsModal` in `Installed.tsx` accepts VPK/archive drops itself. Without a carve-out, capture-phase ownership would route those drops into the Layout batch importer and open it on top of the add-variants modal.

Mitigation: the `suppressGlobalModDrop` store flag, set by that instance for its mounted lifetime. The global controller passes supported drops through while it is set.

### Indicator shows for non-mod file drags

Extensions are unknowable during `dragover` (empty MIME types for `.vpk` and most archives), so the indicator appears for any external file drag.

Mitigation: accepted as a limitation. Indicator copy reads as an offer; claiming happens only at `drop`, so specialized zones behave correctly regardless.

### Modal path handoff loses rapid successive drops

Mitigation: store pending paths separately from modal rows and consume them with functional updates keyed by platform-aware path identity.

### Files are added while submission reconciliation is running

Mitigation: expose a busy flag to the global controller and reject those drops explicitly.

### Drag feedback flickers when crossing child elements

Mitigation: use a drag-depth counter or equivalent window-level state, reset it on `drop`, and keep the indicator `pointer-events: none`.

### Native shell supplies a virtual file with no disk path

Mitigation: continue using Electron's `webUtils.getPathForFile()` and reuse the existing archive-viewer guidance when it returns an empty string.

### Scope expands into backend import changes

Mitigation: keep the feature limited to renderer event routing, transient path handoff, and modal ingestion. The existing batch IPC remains the single import implementation.

## Estimated Scope

This is a small-to-medium renderer feature:

- Approximately 5 to 7 production files
- Focused helper, store, and modal tests
- No database migration
- No new IPC API
- No main-process import changes
- Cross-platform native drag verification required

