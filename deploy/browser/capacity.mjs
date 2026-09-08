// Budget the verified archive before import, retaining 2 GiB free for the host.
// Three expanded copies cover import staging, content storage and extraction.
export const RESERVE_KIB = 2 * 1024 * 1024;
export function capacity(archiveBytes, expandedBytes) {
  for (const value of [archiveBytes, expandedBytes]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 100 * 1024 ** 3) throw Error('archive_size_invalid');
  }
  if (archiveBytes > expandedBytes) throw Error('archive_size_invalid');
  return {
    scratchKiB: Math.ceil(2 * archiveBytes / 1024) + RESERVE_KIB,
    dockerKiB: Math.ceil((3 * expandedBytes + 2 * archiveBytes) / 1024) + RESERVE_KIB,
  };
}
