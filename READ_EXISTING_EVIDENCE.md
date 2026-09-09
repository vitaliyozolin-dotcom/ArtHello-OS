# Read the existing D092 failure receipt

Local proposal only. No workflow, fixture or browser has been started by this
proposal; no artifact JSON or PNG has been read successfully in this session.

The existing artifact is `10096640452`, named
`arthello-synthetic-content-tasks-34333105787-1`, from failed run `34333105787`,
job `102406140419`. Its ZIP is exactly `389416` bytes with SHA256
`dd600c987b34a1d92a1270a63926815b2a1715c9efb01400a7d1434748e7de5a`.
The official materialized file reference was resolved through the supported
materialization route, but the official transfer helper returned HTTP502.
The earlier direct signed transfer returned HTTP403/error1010. Neither failure
was bypassed or retried with altered headers, endpoints or credentials.

Safe existing logs establish browser assembly READY, sandbox fixture PASS at
`2026-09-09T09:11:12.017Z`, empty fixture READY, then scoped BLOCKED and an upload
of six files. They do not identify the failing UI assertion. The scoped adapter
already writes `stage`, `result`, `completedCaptures` and `taskNumberAssertion`
to `scoped-result.json`; its terminal log intentionally omits arbitrary errors.
Capture records and PNGs can be persisted before their assertions pass.

`scripts/read-content-tasks-evidence.py` reads only the pinned existing ZIP. It
does not extract files, execute artifact contents, open images, launch Docker or
call the application. It validates the receipt's exact known shape and emits a
small allowlisted summary. `pngEntries` counts archive filenames, not visually
reviewed screenshots. It emits no manifest content, raw exception or server text.
Validation uses explicit checks that remain active under Python optimization.

The concrete local workflow is
`.github/workflows/inspect-d092-visual-evidence.yml`. Pull requests and ordinary
main pushes run only source tests. After those tests pass, an owner push to main
with the exact commit-message prefix `D092: inspect existing visual evidence`
can inspect the old artifact on attempt 1. Both actor and triggering actor must
be `vitaliyozolin-dotcom`, in `vitaliyozolin-dotcom/ArtHello-OS`. There is no
manual-dispatch or retry route. GitHub's job expression ignores case; the Python
guard additionally requires exact case for these identities and the prefix.
The workflow's path filter requires a changed inspection workflow, script, test
or this document. A later qualifying push is a distinct request, not a retry.

Both jobs use GitHub-hosted Ubuntu with `contents: read` and `actions: read`.
Only the inspection step receives the ordinary workflow token as `GH_TOKEN`.
No production environment, production secret, Docker, fixture or browser is used.
The existing D089 workflow, visual adapter and runtime pins remain unchanged.
This is D092 evidence recovery, with no new product decision or future PR pin.

`scripts/inspect-d092-visual-evidence.py` checks the actual push event, exact
checkout SHA, frozen reader digest and current main ref. Before downloading it
checks the original run is attempt 1, completed with failure, from the owner main
push of `b4c39d5af8ab348882759c48c0f82dbe810a8065`, using the expected visual
workflow. Both repository IDs must be `1311964413`. The single artifact must have
the fixed ID, name, size and digest above, link to that run and source, and be
unexpired. Official metadata observed expiry `2026-09-23T09:11:30Z`; the guard
compares expiry with the actual execution time. It then makes an ordinary
`gh api --method GET` ZIP request to GitHub and invokes the frozen reader.

The first bounded output, `d092-existing-artifact-metadata`, reports metadata
validation, including main matching checkout, the producer's failure conclusion,
matching digest and unexpired status. It does not claim ZIP-byte validation.
The frozen reader then checks actual ZIP size and SHA256 before reading the
receipt. Its successful inspection still reports the historical visual result
as `blocked`; workflow success means the receipt was read, not visual acceptance.
Refusals identify only a fixed stage such as `metadata_validation` or
`archive_download`; raw GitHub responses and arbitrary errors are not logged.
The temporary ZIP is deleted after inspection. No artifact is extracted or
republished.

Local validation: five frozen-reader tests and six trigger/metadata/refusal
tests passed under Python optimization; four tests evaluate the actual workflow
condition and source-job boundary. These used synthetic inputs only. Actual
receipt and screenshot inspection remain outstanding. Read that actual summary
before choosing a UI fix or another diagnostic run.
