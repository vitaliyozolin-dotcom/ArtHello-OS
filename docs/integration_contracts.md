# Integration Contracts

Contracts for every external data source. Each describes:
- What ENV vars are required
- What endpoints are used
- What fields we expect
- Where raw data lands
- How it normalises

---

## 1. Google Sheets Leads

**Source type:** `google_sheet`  
**Status:** Implemented (v0.1)

### ENV
```
GOOGLE_SERVICE_ACCOUNT_JSON   # Full JSON of Google service account key
GOOGLE_SHEET_ID_PROMOTION     # Spreadsheet ID from the sheet URL
```

### Endpoints used
- `GET /spreadsheets/{id}` — list sheets
- `GET /spreadsheets/{id}/values/{range}` — read rows

### Fields (column mapping, configured per import)
| Field | Description |
|-------|-------------|
| date | Lead arrival date |
| clientName | Full name |
| phone | Phone number |
| source | Raw source string (VK, сайт, реклама, …) |
| channel | Marketing channel |
| campaign | Campaign name / ad set |
| status | Lead status |
| manager | Responsible manager |
| comment | Free-form note |
| branch | School branch name |

### Storage
- `raw_events` (source_system = `google_sheets`, event_type = `lead`)
- `lead_events` (linked via `raw_event_id`)
- Deduplication: SHA-256 hash of `sheet_id + sheet_name + row_index + raw_row`

### Connector config (stored in `source_connectors.config`)
```json
{
  "sheetId": "...",
  "sheetName": "Leads 2025",
  "headerRow": 0,
  "mapping": { "date": "Дата", "clientName": "Имя", "phone": "Телефон", ... }
}
```

---

## 2. Bank CSV / XLSX

**Source type:** `bank`  
**Status:** Implemented (v0.1)

### ENV
None — file upload via UI.

### Flow
1. Upload CSV or XLSX file via `POST /api/finance/bank/preview`
2. Preview first 20 rows + detected column mapping
3. Confirm mapping, select bank / account / branch
4. Submit to `POST /api/finance/bank/import`
5. Auto-categorise via `categorization_rules`
6. Unclear transactions flagged for manual review

### Fields (detected from file headers, configurable per bank format)
| Field | Description |
|-------|-------------|
| operationDate | Transaction date |
| counterpartyName | Counterparty / payee name |
| counterpartyInn | Counterparty tax ID |
| purpose | Payment purpose / description |
| amount | Transaction amount |
| direction | income / expense (or two amount columns) |
| accountName | Account alias |
| accountNumber | Account number |

### Storage
- `bank_import_batches` — one row per import with row counts
- `bank_transactions` — one row per transaction, linked to batch via `import_batch_id`
- Deduplication: `external_id` = `bank__account__date__counterparty__amount__rowIndex`

### Supported banks (column auto-detection)
- Сбербанк (Sberbank)
- Тинькофф (Tinkoff)
- ВТБ
- Альфа-Банк
- Россельхозбанк
- Generic CSV

---

## 3. Website Form Webhook

**Source type:** `website`  
**Status:** Implemented for authenticated internal callers only (v0.1)

### ENV
Uses the application session, CSRF token, and route-access policy. The endpoint is
not public. A provider-facing webhook must not be registered until a separate
signed-request or shared-secret contract is implemented and tested.

### Endpoint
```
POST /api/webhooks/website-lead
```

### Expected fields
```json
{
  "name": "string",
  "phone": "string",
  "email": "string",
  "message": "string",
  "source": "string",
  "campaign": "string",
  "branch": "string",
  "form_url": "string",
  "utm_source": "string",
  "utm_medium": "string",
  "utm_campaign": "string",
  "utm_content": "string",
  "utm_term": "string"
}
```

### Storage
- `raw_events` (source_system = `website_webhook`, event_type = `lead`)
- `lead_events` (linked via `raw_event_id`, channel derived from UTM)

### Internal integration example
Call only from an authenticated same-origin backend or administrative session.
Every submission needs a stable idempotency key:
```js
fetch("https://<your-domain>/api/webhooks/website-lead", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken,
    "Idempotency-Key": stableSubmissionId
  },
  body: JSON.stringify({ name, phone, utm_source, utm_campaign, ... })
})
```

---

## 4. VK Leads

**Source type:** `social`  
**Status:** Placeholder (not connected)

### ENV (required when activated)
```
VK_ACCESS_TOKEN          # Group access token with leads scope
VK_GROUP_ID              # VK group ID
VK_API_VERSION           # e.g. 5.199
```

### Endpoints to use
- `GET https://api.vk.com/method/leadForms.getLeads` — fetch new leads
- `GET https://api.vk.com/method/leadForms.getForm` — form schema

### Expected fields
```
lead_id, first_name, last_name, phone, email, ad_id, campaign_id, created_at, answers[]
```

### Storage plan
- `raw_events` (source_system = `vk_leads`, event_type = `lead`)
- `lead_events` (channel = `vk`, source = `vk_leads`)
- Deduplication: `vk_leads__group_{GROUP_ID}__lead_{lead_id}`

### Normalisation
- `clientName` = `first_name + last_name`
- `channel` = `vk`
- `campaign` = `ad_id` or form name

---

## 5. Telegram Bot

**Source type:** `messenger`  
**Status:** Placeholder (not connected)

### ENV (required when activated)
```
TELEGRAM_BOT_TOKEN       # From BotFather
TELEGRAM_WEBHOOK_SECRET  # To validate incoming updates
```

### Endpoint to register
```
POST https://api.telegram.org/bot{TOKEN}/setWebhook
  url = https://<your-domain>/api/webhooks/telegram
```

### Expected update types
- `message` with contact card → phone-based lead
- `message` with text reply to bot command → inquiry lead
- Inline form bot flow → structured lead

### Storage plan
- `raw_events` (source_system = `telegram_bot`, event_type = `lead` or `message`)
- `lead_events` (channel = `telegram`)
- Deduplication: `telegram__chat_{chat_id}__msg_{message_id}`

### Normalisation
- `phone` = contact.phone_number if shared
- `clientName` = first_name + last_name
- `channel` = `telegram`
- `message` = text content

---

## 6. WhatsApp / WABA

**Source type:** `messenger`  
**Status:** Placeholder (not connected)

### ENV (required when activated)
```
WHATSAPP_TOKEN           # Meta Business / WABA permanent token
WHATSAPP_PHONE_NUMBER_ID # WhatsApp Business phone ID
WHATSAPP_VERIFY_TOKEN    # Webhook verification token
```

### Endpoint to register with Meta
```
GET  /api/webhooks/whatsapp   # Verification handshake
POST /api/webhooks/whatsapp   # Incoming messages
```

### Expected fields
- `entry[].changes[].value.messages[]` — message objects
- Each has: `from` (phone), `timestamp`, `type`, `text.body`

### Storage plan
- `raw_events` (source_system = `whatsapp_waba`, event_type = `message` or `lead`)
- `lead_events` when first contact or intent keyword detected
- Deduplication: `whatsapp__{phone_number_id}__{message_id}`

---

## 7. IP Telephony

**Source type:** `telephony`  
**Status:** Placeholder (not connected)

### ENV (required when activated — provider-dependent)
```
TELEPHONY_PROVIDER       # 'mango' | 'binotel' | 'asterisk' | 'uis'
TELEPHONY_API_KEY        # Provider API key
TELEPHONY_API_SECRET     # Provider API secret
TELEPHONY_WEBHOOK_SECRET # To validate incoming events
```

### Endpoint to register with provider
```
POST /api/webhooks/telephony   # Call events
```

### Expected fields (normalized across providers)
```
call_id, direction (inbound/outbound), caller_phone, called_phone,
start_time, end_time, duration_sec, recording_url, operator_name,
disposition (answered/missed/busy)
```

### Storage plan
- `raw_events` (source_system = `telephony_{provider}`, event_type = `call`)
- `lead_events` for inbound missed/answered calls from unknown numbers
- Deduplication: `telephony__{provider}__call_{call_id}`

### Normalisation
- Missed inbound → `event_type = lead`, `status = missed_call`
- Answered inbound → `event_type = lead`, `status = called`
- `channel` = `telephony`
- `phone` = caller_phone (normalise to E.164)

---

## 8. Manual Lead Entry

**Source type:** `manual`  
**Status:** Planned (UI form in Integrations tab)

### ENV
None.

### Flow
Admin enters lead directly via a form in the Integrations / Leads UI.

### Fields
Same as website form: name, phone, email, source, channel, campaign, branch, status, comment.

### Storage plan
- `raw_events` (source_system = `manual`, event_type = `lead`)
- `lead_events` (channel = `manual`)
- No deduplication hash — each manual entry is intentional.

---

## Raw → Normalised pipeline

All sources funnel into the same pipeline:

```
External source
   └─► raw_events           (verbatim payload, hash-deduped)
          └─► lead_events   (normalised fields, matched to students/payments)
                 └─► duplicate detection
                        └─► CRM match (matched_student_crm_id)
```

Matching runs periodically (or on demand) comparing:
- phone → `crm_students.phone`
- name similarity → `crm_students.full_name`
- amount + date → `crm_payments`
- amount + date → `bank_transactions`
