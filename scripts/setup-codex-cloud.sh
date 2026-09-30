#!/usr/bin/env bash
# Prepare the same sibling repositories and dependency versions used by CI.
# This script changes only development files and performs read-only GitHub fetches.
set -euo pipefail

task_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
task_repo_dir="$(cd -- "$task_script_dir/.." && pwd -P)"
task_workspace_dir="$(dirname -- "$task_repo_dir")"
task_social_dir="$task_workspace_dir/grimoire-social"
task_social_revision="${GRIMOIRE_CLOUD_SOCIAL_REVISION:-efffe0b92a49d6cc8d82406d6fc163c2fd3662a5}"
task_social_url="https://github.com/Slush97/grimoire-social.git"

if ! command -v node >/dev/null || ! command -v git >/dev/null; then
  printf '%s\n' 'Install Node 20 and Git in the cloud environment, then rerun this script.' >&2
  exit 1
fi
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 20 ]]; then
  printf '%s\n' 'Use Node 20 to match Grimoire CI, then rerun this script.' >&2
  exit 1
fi
if [[ ! "$task_social_revision" =~ ^[0-9a-f]{40}$ ]]; then
  printf '%s\n' 'GRIMOIRE_CLOUD_SOCIAL_REVISION must be a full Git commit SHA.' >&2
  exit 1
fi

if command -v pnpm >/dev/null && [[ "$(pnpm --version)" == 10.* ]]; then
  task_pnpm=(pnpm)
elif command -v corepack >/dev/null; then
  task_pnpm=(corepack pnpm@10)
else
  printf '%s\n' 'Install pnpm 10 or Corepack in the cloud environment, then rerun this script.' >&2
  exit 1
fi

if [[ ! -e "$task_social_dir" ]]; then
  git clone "$task_social_url" "$task_social_dir"
fi
if [[ ! -e "$task_social_dir/.git" ]]; then
  printf '%s\n' 'Expected a Git checkout at the sibling grimoire-social directory; inspect its contents before proceeding.' >&2
  exit 1
fi
if [[ -n "$(git -C "$task_social_dir" status --porcelain)" ]]; then
  printf '%s\n' 'The sibling grimoire-social checkout has local changes. Preserve them before selecting the pinned revision.' >&2
  exit 1
fi
if ! git -C "$task_social_dir" cat-file -e "$task_social_revision^{commit}" 2>/dev/null; then
  git -C "$task_social_dir" fetch --depth 1 "$task_social_url" "$task_social_revision"
fi
if [[ "$(git -C "$task_social_dir" rev-parse HEAD 2>/dev/null || true)" != "$task_social_revision" ]]; then
  git -C "$task_social_dir" checkout --detach "$task_social_revision"
fi

task_workspace_file="$task_repo_dir/pnpm-workspace.yaml"
task_expected_workspace=$'packages:\n  - "."\n  - "../grimoire-social/packages/social-types"'
if [[ -e "$task_workspace_file" ]]; then
  task_existing_workspace="$(tr -d '\r' < "$task_workspace_file")"
  if [[ "$task_existing_workspace" != "$task_expected_workspace" ]]; then
    printf '%s\n' 'An existing pnpm-workspace.yaml differs from the minimal CI layout. Review it instead of overwriting it.' >&2
    exit 1
  fi
else
  printf '%s\n' "$task_expected_workspace" > "$task_workspace_file"
fi

cd -- "$task_social_dir"
"${task_pnpm[@]}" install --frozen-lockfile
cd -- "$task_repo_dir"
"${task_pnpm[@]}" install --frozen-lockfile

export GRIMOIRE_SOCIAL_BASE_URL="${GRIMOIRE_SOCIAL_BASE_URL:-https://grimoire-social.slusheliott.workers.dev}"
"${task_pnpm[@]}" typecheck
"${task_pnpm[@]}" build

printf '%s\n' \
  'Cloud development dependencies, typecheck and build are ready.' \
  'This run does not prove cloud browser, GPU, Electron runtime or in-game rendering.' \
  'Next run the remaining lint, UI/i18n and test gates in docs/codex-cloud-task-prompt.md.' \
  'Set GRIMOIRE_SOCIAL_BASE_URL in environment settings so later commands receive it.' \
  'Supply authorized private fixtures separately; no game assets or credentials were uploaded.'
