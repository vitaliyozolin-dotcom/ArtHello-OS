# School runtime diagnosis — 2026-09-08

Production was inspected read-only by D063 run 34193103822, job 101955030295, after exact main Quality/Proof/Verify succeeded for `68a159dc647f35cdd30ce586fc6d5beb93b89a51`. No image loading, backup installation, clone or cutover step ran. The real-browser acceptance file was absent and the consumer stopped as designed.

Verified observations:

- School source revision: `54242340f2d9b6a9887d69ecc03520ddf9f7982c`; image `sha256:664c2c0c3e628a53ca492953803b420e0c4a44acab35eb250f5f899c10bc93df`; healthy.
- School uses `arthello-os_backend`, Docker bridge with `Internal=true`.
- One callback failure in the bounded window was classified `fetch_failed`, latest `2026-09-08T05:04:58.482488724Z`.
- DNS lookup and HTTPS request to the configured ArtHello origin both failed with `EAI_AGAIN` from inside the actual School runtime.
- Effective School UID/GID1001 can read/write the database directory, database and WAL/SHM. The database has13 users,0 centrally linked users,0 invalid central versions and0 successful reconciliations.

Conclusion: the current callback cannot reach the central ArtHello exchange because the School runtime lacks working DNS/egress on its internal network. This establishes the first live blocker; it does not certify that no later authentication or reconciliation error remains.

Next change must restore only the required School-to-ArtHello communication without changing the shared network globally, weakening origin checks, rebuilding applications on production, injecting sessions, or editing the live database. Preserve the current School image, volumes, runtime user and secrets. Verify the new path, then perform natural browser SSO and inspect any subsequent failure honestly.

PR354 is merged and source verification is green. The ArtHello production image is still unchanged; external bank/Alfa synchronization and the six requested live scenarios remain incomplete.

Source: https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34193103822
