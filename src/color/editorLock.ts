// Editor lock stubs — the color-region lock has been removed. The editor is
// always editable regardless of whether color regions exist; version history
// is the rollback mechanism. syncLockState is kept as a no-op because it is
// called from many sites; disableRun/enableRun are kept for other read-only
// modes (shared-link preview, voxel-paint session).

/** No-op — retained so call sites don't need to be removed one by one. */
export function syncLockState(): void {
  // intentionally empty
}

export function disableRun(): void {
  const run = document.getElementById('btn-run');
  const auto = document.getElementById('btn-auto-run');
  if (run) {
    (run as HTMLButtonElement).disabled = true;
    run.classList.add('opacity-40', 'pointer-events-none');
  }
  if (auto) {
    (auto as HTMLButtonElement).disabled = true;
    auto.classList.add('opacity-40', 'pointer-events-none');
  }
}

export function enableRun(): void {
  const run = document.getElementById('btn-run');
  const auto = document.getElementById('btn-auto-run');
  if (run) {
    (run as HTMLButtonElement).disabled = false;
    run.classList.remove('opacity-40', 'pointer-events-none');
  }
  if (auto) {
    (auto as HTMLButtonElement).disabled = false;
    auto.classList.remove('opacity-40', 'pointer-events-none');
  }
}
