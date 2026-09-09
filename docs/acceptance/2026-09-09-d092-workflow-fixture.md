# D092 — Workflow fixture compatibility

Status: prepared; hosted browser result pending.

The fixed existing D092 artifact was read successfully in run34337932856 / job102421685466. It reports tasks-empty-390x844, two capture records and four PNG entries. Screenshots and the actual exception were not inspected. The first Tasks capture did not complete; task-number assertion remains unconfirmed.

Exact accepted WorkflowWorkspace blob4a8f839a6f2ab52a504973319d05b44596699487 expects overview.permissions.canManageDocuments and detail.permissions.canManage/canApprove. Frozen overview and detail fixtures omit these objects. The overview mismatch predicts a Documents-tab render failure before the first Tasks screenshot and is consistent with the observed stage; runtime attribution is an inference.

The scoped adapter adds only the accepted API permission shapes for the existing synthetic OWNER, after verifying the unchanged full harness blob and two unique transformation boundaries. All original UI assertions, endpoints, application permissions, R12 runtime artifact and literal task label №801 remain unchanged. Tests must verify actual compiled-fixture wiring and reverse transformation, not merely presence of a new function.

Publication requires exact-head CI and independent source/doc preservation review. The existing technical merge prefix D089: hosted Content Tasks visual triggers the justified hosted rerun. Keep main stable until the run finishes. Record actual stage, artifact inventory and task-number result. Geometry/assertion PASS, screenshot inspection, save persistence and live product acceptance are distinct results. No production access or real user data is involved.
