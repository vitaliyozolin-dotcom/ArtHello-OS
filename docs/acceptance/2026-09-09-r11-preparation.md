# D085 / R11 preparation after R10 fixture cleanup failure

R10 source 2e57dd22c6ff1cec1fcad0bd11af479e465c00bb (tree 445762d319e5c792d97617e8a4515045bc3b4126), run 34322039891, deploy job 102371510204, passed all 134 installed-Caddy HTTP/redaction checks and the gateway binary identity check, then failed deleting its owned read-only nested fixture directory. School secret resolution, clone/cutover and after-cutover browser steps were skipped. This is a pre-authentication abort, not live acceptance.

R11 is being prepared as a narrow reviewed continuation: correct only the owned fixture cleanup, preserve the frozen R10 runtime/acceptance protocol, and attest the exact R10 abort before proceeding. No R11 production execution is authorized by this inert preparation commit. Standing user release authorization is preserved; exact reviewed source, CI and protected Environment remain required.

The implemented candidate preserves the full parsed R10 workflow after normalizing only PR380/D085 identity, predecessor, inline abort guard, installed-Caddy cleanup helper, exact Quality job list and summary title. Frozen R10/R9/V52 files remain unchanged. The new contract is pinned in appended Quality job d085-candidate-tests under the existing V52 watched directory.

Validation before publication: 51 replay tests PASS; 14 cleanup tests PASS (old helper reproduces permission failure). Local cleanup execution uses capability-free UID0/NoNewPrivs with a behavioral permission-denial proof; hosted execution must run with a nonzero UID. YAML and full controller normalization PASS. Independent source review is being finalized; actual hosted Ruby/nonroot CI and protected deployment remain required. Bank and the remaining business scenarios are not accepted by these tests.
