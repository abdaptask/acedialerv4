// Sites the extension reads out of the box. Kept in step with manifest.json
// (host_permissions + the content_scripts entry for content.js), which is
// what actually grants and injects; this list lets the options page show
// them and lets background.ts skip registering them a second time.
//
// Every ApTask recruiter works in JobDiva, and the by-hand "Add site, Allow"
// step was where setup broke (a reinstall restored the list without the
// grant). Anything else still goes through the per-site grant on the
// options page — this is two named hosts, not a step toward <all_urls>.

export const BUILT_IN_HOSTS = ['www1.jobdiva.com', 'www2.jobdiva.com'] as const;

/** "*://www1.jobdiva.com/*" → "www1.jobdiva.com" */
export function hostOf(pattern: string): string {
  return pattern.replace(/^[a-z*]+:\/\//, '').replace(/\/.*$/, '');
}

export function isBuiltIn(pattern: string): boolean {
  return (BUILT_IN_HOSTS as readonly string[]).includes(hostOf(pattern));
}
