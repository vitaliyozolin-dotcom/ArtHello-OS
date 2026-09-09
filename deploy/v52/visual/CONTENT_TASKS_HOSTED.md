# Content and Tasks: hosted synthetic visual check

D089 hosted run `34331175805`, job `102399900660`, failed in the browser smoke
entrypoint with `ERR_MODULE_NOT_FOUND` for `playwright-core`. The accepted image
checks/import and dependency installation passed; the fixture was not reached
and no screenshot artifact was produced. D092 prepares the assembly correction
below. Actual Docker/Chromium execution of that correction remains outstanding.
`accepted-runtime.json` now identifies the actually accepted R12 runtime:
source `77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed`, tree
`ac3fcaac06acf33bf9ee32e438d0c040adb38fd7`, producing v52 run `34326274447`,
portable runtime fingerprint
`a28b64b3a57f96eb8e23c18d888d033f70d90f92b2ef98df5cc7b07c920d153a`.
Protected release run `34326582961` completed successfully: bundle job
`102385622798` and deploy job `102386111240`. Candidate natural SSO passed at
`2026-09-09T08:10:46.386Z`; post-public natural SSO passed at
`2026-09-09T08:11:02.888Z`. The release observed application image was
`sha256:5a39c36001cb79abe6d0bc8d691275b58cdec5456e7d13d95fc717eba6702284`.
These release facts open the runtime pin; Content/Tasks visual acceptance still
requires its own completed hosted run.

Read-only GitHub metadata confirms producer artifact `10093988488`, named
`arthello-v52-verification-34326274447`, with archive digest
`sha256:7ac985a65410cde439bee99378f8301b588578bd457abda100504f2924d86505`,
size `173101551` bytes and expiration `2026-10-09T07:58:07Z`. This is the GitHub
artifact archive digest, distinct from the enclosed application image archive
checksum and portable runtime fingerprint. The workflow rechecks the unique
unexpired artifact and the source/run provenance before downloading it.

The workflow runs only on GitHub-hosted runners, with `contents: read` and
`actions: read`, no production Environment, deployment job, SSH or owner password.
PR events and ordinary main pushes run only source tests. D089 adds a bounded
owner/main push trigger for the reviewed merge because this session has no
callable GitHub workflow-dispatch capability. The existing manual-dispatch path
also remains available. Both paths download the existing v52 verification
artifact; neither rebuilds the application.

## Executable path

The workflow is `.github/workflows/verify-content-tasks-visual.yml`.
Its ordered operations are:

1. Check the accepted run, exact source/tree and successful main v52 workflow via
   GitHub API, then download its one unexpired verification artifact by ID.
2. Validate evidence checksum, archive SHA256, source-file hashes, release
   fingerprint and imported immutable image configuration. Use the resolved full
   image ID for every application/fixture container. Cross-store image ID equality
   is not assumed.
3. Copy the eight fixed public browser inputs into a new context inside this
   invocation's private working directory. Install the frozen
   `playwright-core@1.62.1` lock with pnpm `11.7.0`, scoped umask `022` and copy
   import. Reject missing/unexpected entries, dangling/escaping links and shared
   hardlinks before making only this public context readable/traversable after
   root-owned Docker COPY. Build the unchanged browser Dockerfile and run its
   existing real sandbox smoke test. The launcher's private umask remains `077`.
4. Create a new private volume and internal Docker network. Confirm the volume
   contains only the image's empty `d1` directory. Initialize application schema,
   stop the application, then run the existing `prepare-visual-fixture.mjs` against
   this new volume only. Restart it using the same full application image ID.
5. Run the scoped browser as UID1000 with Chromium sandbox, read-only root,
   no capabilities, no published ports, and the internal network. Save only
   synthetic PNGs, metrics manifest and bounded source/image evidence. Delete only
   this invocation's containers, volume, network and private working directory.

After the workflow has set and verified the environment and downloaded the
artifact, its actual command is:

```sh
bash runner/deploy/v52/visual/run-content-tasks-hosted.sh \
  "$GITHUB_WORKSPACE/source" \
  "$RUNNER_TEMP/visual-image-artifact" \
  "$RUNNER_TEMP/visual-output"
```

The standalone script refuses an ordinary local/server environment. It accepts
no application URL, volume name, production database, password or image tag as an
input. Both passwords and integration keys are generated for this disposable
fixture; they are never taken from GitHub production secrets.

**Never apply `prepare-visual-fixture.mjs` to live data:** it removes every auth
credential/session before inserting its synthetic owner. It does not clear
business data and does not initialize a database itself. The launcher therefore
uses a new empty volume, never a production snapshot or existing volume.

## What the selected check means

The new adapter pins the exact original harness blob
`eee9647d7f0e4799e293613c01eaa4199d80dc06`. It prevents the original 595-PNG
entrypoint from running and selects existing Content/Tasks fixture functions.
The application JavaScript, CSS, database schema and original harness remain
unchanged. Only the test adapter adds one explicit check for the already defined
task-number text `Задача №801` in its synthetic opened task.

| Selected behavior | Evidence |
| --- | --- |
| Content and Tasks, 390×844 and 1440×900, empty | Existing headings, four KPIs, columns, contained layout, typography; 8 PNGs |
| Both populated views at those sizes | Existing synthetic API responses, contained table/cards, modal opens and cancels; 4 PNGs |
| Mobile tabs | Existing Content 6 / Tasks 4 tab interactions |
| Task 801 dialog, desktop and mobile | Existing viewport/portal/scroll/footer/close checks plus visible literal task number; 2 PNGs |

Expected output is **14 PNGs**, `manifest.json`, `scoped-result.json`, and
`evidence.json`. A partial failure can retain synthetic screenshots and a partial
manifest; only a successful job with complete result/evidence is a passing check.
There is one candidate database and one login/password-change flow. No baseline
comparison or pixel-difference acceptance is claimed.

Content and task data are rendered from the existing Playwright API fixtures.
This checks the real built UI with synthetic inputs. It does **not** prove live
data accuracy, content generation, saved content/task persistence, assignment
delivery, employee permissions or integration behavior. Form saves are not part
of this bounded run. The result identifies the accepted image snapshot; it does
not observe whether a later deployment has changed the running production image.

## Local validation and remaining gate

The hosted visual job requires repository `vitaliyozolin-dotcom/ArtHello-OS`,
ref `refs/heads/main`, both `github.actor` and `github.triggering_actor` equal to
`vitaliyozolin-dotcom`, a passing source job, and one of these event conditions:

| Event | Additional condition | Visual job |
| --- | --- | --- |
| `push` | `github.run_attempt == 1`; head commit message starts with `D089: hosted Content Tasks visual` | Runs after the reviewed owner merge |
| `workflow_dispatch` | No inputs; existing manual path | Runs |
| PR, another event, ordinary push, push retry, wrong owner/repository/ref | Required event or common guard is absent | Skipped |

GitHub's `startsWith` and string comparisons are case-insensitive. The push guard
blocks retries of a push run; a later distinct qualifying D089 push can still
start another first-attempt run. Manual-dispatch behavior, including its retry
behavior, is unchanged. The merge must touch a configured workflow, visual or
browser path to create the push run. D089 changes only this synthetic test
trigger; it grants no production capability.

D092 keeps the existing D089 technical trigger prefix. Review its assembly
helper, regression and launcher/workflow changes together before the owner merge
whose commit message starts with that prefix. A later documentation or diagnostic
merge may change the runner commit; the application checkout and image remain
pinned to the accepted R12 source above. The artifact must still be unexpired
when the visual job starts. This local preparation does not publish files or
start a workflow.

```sh
node --test deploy/v52/visual/content-tasks-trigger.test.cjs
node --test deploy/v52/visual/content-tasks-scoped.test.cjs
node --test deploy/v52/visual/assemble-browser-context.test.cjs
bash -n deploy/v52/visual/run-content-tasks-hosted.sh
```

These checks validate the actual trigger truth table, adapter/source guards and
shell syntax. The separate trigger regression covers PR/fork/non-owner/wrong-ref/
wrong-prefix/push-retry exclusions without changing the twelve adapter tests.
Four D092 assembly regressions use the real locked package, verify import after
relocation, reject inaccessible copied modes, escaping/dangling links and shared
cache hardlinks, and preserve private-file permissions. A local pnpm reproduction
under `077` created directories `0700` and package files `0600`; a later `022`
install reused cached `0600` files. Its dependency links remained inside the
context. This supports the permission cause; the failed job did not retain its
build context for direct inspection. No actual UID1000/Docker execution was
available locally, so the hosted sandbox smoke remains required. Docker and
Chromium execution are still required on the hosted runner before visual PASS or
screenshots can be claimed. The original harness, scoped adapter, test source and
application implementation remain unchanged. If a different release is needed,
update the source/tree pins coherently and review the new source rather than
silently substituting it. The visible task-number assertion retains the existing
literal format `Задача №801`; no numbering or padding behavior is introduced.
