# D091 bank error status — preparation

D088 protected run 34330892606/job 102398954685 completed a valid incomplete report with final consumer verification at 2026-09-09T08:46:04.026Z. It observed autosync error, failures 2, released lease, matching generation and next retry 09:01:16.902Z. Latest sync remained pending at 08:11:14.266Z, with four accounts, twelve statement records and no operations.

D091 reads only the existing stored integer HTTP status and its quality state, plus normalized scheduler update time. This status is the callback result; 500 is also the default after a thrown callback and does not identify provider failure. Error text and detailed exception codes are not retained. No writes, bank calls or resync. Original completion and final identity checks remain unchanged.

Preparation only: no D091 protected observation or financial acceptance yet. Record exact head/tree, independent review, hosted CI and actual terminal result in the new PR evidence index. Accepted application remains R12 77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed; D090 source preparation does not itself deploy an application.
