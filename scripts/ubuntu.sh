#!/usr/bin/env bash
set -euo pipefail

# Run from Ubuntu WSL. Source stays in the shared checkout; native dependencies
# and build output stay on Linux to avoid Windows executable locks and slow I/O.
source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_root="${NESLOS_UBUNTU_WORKDIR:-$HOME/.cache/neslos-ubuntu}"
node_root="$HOME/.local/share/neslos/node-v24.22.2-linux-x64/bin"
if [[ -x "$node_root/node" ]]; then export PATH="$node_root:$PATH"; fi
# Non-login WSL shells otherwise select Ubuntu's older /usr/bin/cargo.
if [[ -x "$HOME/.cargo/bin/cargo" ]]; then export PATH="$HOME/.cargo/bin:$PATH"; fi
# This WSL network has no IPv6 route. Let the IPv4 connection complete without
# Node's family-selection timer abandoning it while trying unreachable IPv6.
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first --no-network-family-autoselection"
if ! command -v node >/dev/null || [[ "$(node -p 'process.platform')" != linux ]]; then
  echo 'Install Linux Node 24.22.2 in Ubuntu before running this script.' >&2
  exit 1
fi
mkdir -p "$work_root"
work_root="$(cd "$work_root" && pwd)"
if [[ "$work_root" == / || "$work_root" == "$HOME" || "$work_root" == /mnt/* || "$work_root" == "$source_root" ]]; then
  echo 'NESLOS_UBUNTU_WORKDIR must be a separate directory on the Linux filesystem.' >&2
  exit 1
fi
# Source sync, builds and evidence copying share one workspace. Do not race them.
exec 9>"$work_root/.neslos-run.lock"
if ! flock -n 9; then
  echo 'Another Neslos WSL task is using this workspace. Wait for it to finish.' >&2
  exit 1
fi
rsync -a --exclude=node_modules --exclude=.git --exclude=.tools --exclude=.private --exclude=.local \
  --exclude='.env*' --exclude=dist --exclude=target --exclude=artifacts --exclude=test-results \
  "$source_root/" "$work_root/"
mkdir -p "$work_root/.tools"
if [[ -x "$source_root/.tools/cargo-near-x86_64-unknown-linux-gnu/cargo-near" ]]; then
  ln -sfn "$source_root/.tools/cargo-near-x86_64-unknown-linux-gnu" "$work_root/.tools/cargo-near-x86_64-unknown-linux-gnu"
fi
cd "$work_root"
lock_hash="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [[ ! -f node_modules/.neslos-lock-sha256 ]] || [[ "$(cat node_modules/.neslos-lock-sha256)" != "$lock_hash" ]]; then
  npm ci
  printf '%s' "$lock_hash" > node_modules/.neslos-lock-sha256
fi
export NESLOS_SOURCE_ROOT="$source_root"
if [[ $# == 0 ]]; then set -- verify; fi
mkdir -p .private
snapshot="$(mktemp "$work_root/.private/evidence-XXXXXX.json")"
trap 'rm -f -- "$snapshot"' EXIT
node scripts/evidence.mjs snapshot "$1" "$snapshot"
result=0
npm run "$@" || result=$?
node scripts/evidence.mjs publish "$1" "$snapshot" "$source_root" "$result"
exit "$result"
