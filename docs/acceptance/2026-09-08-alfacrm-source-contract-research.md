# AlfaCRM source contract research — 2026-09-08

Status: evidence gap identified; no tenant calls, live import or additional source change performed by this research.

Primary sources:
- https://alfacrm.pro/usefull/integrations/integration/api
- https://alfacrm.pro/usefull/knowledge/rekomendacii-po-rabote-s-sistemoj/v2api-prakticheskaya-skhema-integracii
- https://alfacrm.pro/usefull/knowledge/main-sections/pay

The official model reference explicitly defines customer/index items[].balance as a monetary float, and items[].paid_lesson_count as a lesson remainder. CustomerTariff.balance is an integer balance, but its monetary/lesson unit and scale are not specified. is_separate_balance is a separate-account indicator. Therefore multiplying CustomerTariff.balance by100 and labeling it money is not established by this source.

Pay documents income as the payment amount (example10890.00), and pay_type_id as a reference to the payment-type model. It does not document amount/outcome, a universal sign rule or the numeric type mapping5/12. The staged route already falls back to income when amount is absent; that alone is not a failure for ordinary documented Pay records. The integration guide recommends retrieving reference dictionaries, including pay-type/index. Financial help distinguishes balance adjustments from normal income/expense reports.

Required follow-up before real Alfa deposit acceptance:
1. Use freshly read Customer.balance per customer/branch for the documented monetary deposit snapshot; preserve paid_lesson_count separately.
2. Retain CustomerTariff.balance as raw data with unknown units until the provider contract or authorized tenant evidence establishes its semantics.
3. Use documented payment income and verify payment-type mapping before projecting cash direction; preserve original type and signed value.
4. Verify staged tenant coverage, actual credentials and UI lineage using real authorized data. Do not enable a broad historical import or schedule before the selected initial stages are accepted.

The R5 correctness changes already merged (unknown/invalid balance rejection, incomplete batch failure and preview freshness) do not establish this separate field-semantics question. The six-item release must not be reported complete on CI counts alone.
