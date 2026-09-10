# Regent Supplier Order Collaboration — UI prototype

Interactive Chinese/English prototype using **Frappe UI 0.1.278**, Vue 3 and Vite. It uses the real Frappe UI Button, Badge and Dialog components, with a bespoke procurement workspace.

This is a frontend demonstration, not an installed Frappe Framework / ERPNext backend. All records are fictional. The role selector demonstrates supplier scoping; it is not authentication or a security boundary. State exists only in memory and resets on page refresh. No SAP, Excel, MES or logistics integration is connected.

## Run

```sh
npm ci
npm run dev
npm run test
npm run build
```

## Review flows

Use the 中文 / English control beside the preview badge to switch the entire interface. It covers all seven pages, dialogs, status labels, feedback, sample record descriptions, dates and CSV headers. The language preference is stored locally; switching does not reload or reset orders, filters or drafts. User-entered notes, comments and locations stay in their original language. Select values and status codes remain language-independent. English and Chinese interface text uses the shared reactive `src/i18n.mjs` layer with translation keys or explicit bilingual message objects.

The first page is a compact Overview, followed by the order workbench. The current preview models source reconciliation using fictional examples inspired by the business workflow. It does not contain the private spreadsheets, SAP extracts, credentials, or real reconciliation findings. Those local analysis files remain under ignored `outputs/`.

The working surfaces in `src/Operations.vue` include:

- Overview: five KPIs, transport quantities grouped by unit, purpose and purchased/in-house categories, ageing, recent shipment/ETA rows and actionable drilldowns.
- Orders: PO/item, material, owner, source, ordered/reported/remaining quantities with units, dispatch commitment, transport and independent fulfillment/review states. Filters and CSV export use the same rows.
- Exceptions: deduplicated rule cases and manually assigned collaboration tasks, with owners, due dates, notes and linked order details.
- Data center: source comparisons, rule results, initial-source dates and a clearly labelled later SAP snapshot simulation.
- Shipments: one batch can allocate quantities to multiple order lines; one line can appear in multiple batches.

`src/RecordFacts.vue` supplies four order-detail areas: order/links, dates/commitments, dispatch/receipts and review/history. Dispatch commitments and China inbound ETA are separate from the existing AU warehouse commitment approval flow. Source values are retained independently.

`src/reconciliation.mjs` is a deterministic, transport-independent rules module. It checks report/PGI gaps, material and unit mapping, missing SO references, unconfirmed prices, overdue/missing dispatch commitments and quantity inconsistencies. Rechecking updates a stable case ID rather than duplicating tasks. Notes cannot close a rule discrepancy; appropriate source facts or scoped business confirmation must satisfy the rule. Mappings are scoped to an exact order/code/unit pair. A changed confirmed price loses confirmed-value coverage. This module currently runs in the browser for demonstration; no scheduled backend or production connector is deployed.

All values are fictional. Confirmed goods value uses approved AUD PO prices divided by the price unit, excluding freight and tax. Unconfirmed prices are excluded and coverage is shown. Different units are never summed in displayed quantity metrics. Verified in-transit batches require both SAP PGI linkage and a logistics milestone; allocation totals are capped by outstanding SAP quantity. Receipt facts remain independent of logistics updates. The fixed demo business date is 2026-09-08.

Suggested review flow:

1. Open Exceptions or Data center. Review the material/unit case, record evidence and confirm the scoped mapping. See the same case close in the order history and overview counts.
2. Confirm the current 1 AUD sample PO price only with an entered rationale; confirmed-value coverage updates without rewriting the SAP price.
3. Use Record dispatch to allocate remaining quantities across one or more lines for the same supplier. Reports update; SAP PGI stays unchanged.
4. Apply the explicitly labelled later SAP snapshot in Data center. It only links the predefined fictional `SHP-DEMO-003` batch. It does not turn arbitrary newly reported shipments into SAP facts, nor mark a batch in transit without a verified logistics milestone.
5. Update dispatch/China dates, AU commitment proposals, comments and logistics through the order details. All views share the same in-memory state.
6. Switch languages or demo roles; real authentication, durable data and internal SAP connectivity remain separate production work.

Fulfillment analysis retains its historical-data requirements instead of inventing performance rates from current snapshots. Excel is an initialization source only in the planned production workflow. Actual imports, original file attachments, scheduled SAP synchronization, production access controls and durable persistence are not implemented in this preview.

Tailwind 3 is installed under the `tailwindcss3` alias to use Frappe UI's supported preset. The generated Sites scaffold dependencies and component library remain available; the active preview is the Vue application in `src/` and static output in `dist/`.

## Attribution

- [Frappe UI](https://github.com/frappe/frappe-ui) — MIT, Frappe Technologies and contributors; see THIRD_PARTY_NOTICES.md.
- [Lucide](https://github.com/lucide-icons/lucide) — ISC.
- [Vue](https://github.com/vuejs/core) — MIT.

This is an independent prototype and is not an official Frappe product.

## Validation

Rule and component tests additionally cover scoped mapping, unit conversions, evidence-required review, shared-state updates, snapshot matching, multi-line dispatch, atomic validation, price coverage and bilingual source details. Domain and analytics tests cover supplier/category scoping, split quantities, invalid inputs, partial receipts, unmatched batches, ageing boundaries and quantity/value reconciliation. Production build validates component and stylesheet compilation. Browser visual/interaction QA was not performed unless separately requested. Optional WebMCP tools are feature-detected; no supported WebMCP execution context was available during creation, so their runtime contract is not claimed as verified.

Localization tests render the actual page templates in Node with third-party UI wrappers stubbed. They check all seven pages, order detail tabs, action dialogs, dynamic labels, preserved select values and user content, business feedback, and preference persistence. These checks do not claim browser layout or third-party dialog interaction coverage.
