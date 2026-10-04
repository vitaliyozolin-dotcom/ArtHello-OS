const sections = new Set(['clients', 'hr', 'education', 'access']);
export function centralManagementUrl(origin, section) {
  const url = new URL(origin);
  // Accept fixed module names only; never accept a caller-provided URL or path.
  if (sections.has(section)) url.hash = section;
  return url.href;
}
