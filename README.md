# Regent Supplier Order Collaboration

Interactive Chinese/English prototype using **Frappe UI 0.1.278**, Vue 3 and Vite. It uses the real Frappe UI Button, Badge and Dialog components, with a bespoke procurement workspace.

Current public-test mode loads 1,253 imported ledger records from Firebase and persists collaboration changes there. It uses Frappe UI components, not an installed Frappe Framework / ERPNext backend. Firebase currently uses the public read/write rules explicitly selected for testing; supplier authentication is not yet enabled.

**Deployment:** [Render website and Windows SAP sync instructions](docs/RENDER-SAP-SETUP.md). Render uses `npm ci && npm run build` and publishes `dist`. On a separate Windows computer, run `setup-sap-sync.bat` once, then schedule `run.bat` twice daily. The Python sync publishes read-only SAP raw snapshots separately; it does not yet project those snapshots into the order workbench. No task is created automatically.

## Run

```sh
npm ci
npm run dev
npm run test
npm run build
```

## Review flows

Use the 中文 / English control beside the preview badge to switch the entire interface. It covers all seven pages, dialogs, status labels, feedback, sample record descriptions, dates and CSV headers. The language preference is stored locally; switching does not reload or reset orders, filters or drafts. User-entered notes, comments and locations stay in their original language. Select values and status codes remain language-independent. English and Chinese interface text uses the shared reactive `src/i18n.mjs` layer with translation keys or explicit bilingual message objects.

The first page is a compact Overview, followed by the order workbench. The current public-test workspace loads real imported records from Firebase. Seed fixtures remain for tests. Spreadsheet and SAP data are not bundled into the static build; local extraction files stay under ignored `outputs/`, and credentials under ignored `secrets/`.

The working surfaces in `src/Operations.vue` include:

- Overview: five KPIs, transport quantities grouped by unit, purpose and purchased/in-house categories, ageing, recent shipment/ETA rows and actionable drilldowns.
- Orders: PO/item, material, owner, source, ordered/reported/remaining quantities with units, dispatch commitment, transport and independent fulfillment/review states. Filters and CSV export use the same rows.
- Exceptions: deduplicated rule cases and manually assigned collaboration tasks, with owners, due dates, notes and linked order details.
- Data center: source comparisons, rule results, initial-source dates and a clearly labelled later SAP snapshot simulation.
- Shipments: one batch can allocate quantities to multiple order lines; one line can appear in multiple batches.

`src/RecordFacts.vue` supplies four order-detail areas: order/links, dates/commitments, dispatch/receipts and review/history. Dispatch commitments and China inbound ETA are separate from the existing AU warehouse commitment approval flow. Source values are retained independently.

The shipment list and order Dispatch/receipts tab both provide **Edit logistics & delay**. Users maintain AU warehouse ETA, container number, B/L or air waybill, courier tracking number, carrier, loading details, milestones, delay reasons and next actions directly in the platform. References are separate fields, and courier is a distinct transport mode. First ETA and previous values remain in shipment history. Manual delay can be recorded without an ETA; known ETA variance is calculated independently, and changing a status label cannot hide it. Changes update all batch-linked orders and transport-delay tasks without changing SAP documents, quantities or PGI. The order Dates/commitments tab also supports dispatch delay status, reasons and remaining-quantity plans.

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

## Firebase integration: public test activated

The user explicitly confirmed public database read/write rules on 2026-09-10. `src/runtime-config.mjs` now enables the public test connector. The app loads 1,253 imported master records from Firebase, defaults to 99 initially open ledger records, and supports all-record and cancelled-record views with pagination. Other source tables attach evidence instead of duplicating orders. Platform edits persist as conditional, appended revisions; actual write/reload/clear/conflict tests passed in an isolated Firebase workspace that was then removed. SAP remains read-only and no scheduled SAP task is active. Public access has no authenticated actors or tamper-resistant guarantees. The private-pilot implementation below is retained as a future option, not the active connection path.

The data-center panel now shows cloud-save status and, when a Web API key is configured, Firebase email/password sign-in for explicitly authorized internal pilot members. Every supported collaboration action uses an explicit save boundary, immutable revisions, server timestamps and a concurrent-edit check. Failed saves restore the previous local records. SAP-owned fields are excluded from collaboration restoration. Unposted dispatch records support deletion with a required reason and restoration from Data center; posted/received batches cannot be deleted.

`scripts/sync-sap.ps1` and the related publisher stage complete, bounded, read-only SAP snapshots into a separate protected Firebase path. `register-sap-sync.ps1` prepares a Windows schedule only when explicitly executed with working local credential paths. No task has been registered and no real data has been uploaded. Real-data projection, supplier isolation, server-side business commands and production date handling remain pending; the cloud client only accepts initialized fictional pilot workspaces.

See [Firebase setup and limitations](docs/firebase-integration.md). When public testing is disabled, builds without `VITE_FIREBASE_API_KEY` remain session-only and say so visibly. The candidate database rules must be reviewed against existing project rules before deployment.

## Attribution

- [Frappe UI](https://github.com/frappe/frappe-ui) — MIT, Frappe Technologies and contributors; see THIRD_PARTY_NOTICES.md.
- [Lucide](https://github.com/lucide-icons/lucide) — ISC.
- [Vue](https://github.com/vuejs/core) — MIT.

This is an independent prototype and is not an official Frappe product.

## Validation

Rule and component tests additionally cover scoped mapping, unit conversions, evidence-required review, shared-state updates, snapshot matching, multi-line dispatch, atomic validation, price coverage and bilingual source details. Domain and analytics tests cover supplier/category scoping, split quantities, invalid inputs, partial receipts, unmatched batches, ageing boundaries and quantity/value reconciliation. Production build validates component and stylesheet compilation. Browser visual/interaction QA was not performed unless separately requested. Optional WebMCP tools are feature-detected; no supported WebMCP execution context was available during creation, so their runtime contract is not claimed as verified.

Localization tests render the actual page templates in Node with third-party UI wrappers stubbed. They check all seven pages, order detail tabs, action dialogs, dynamic labels, preserved select values and user content, business feedback, and preference persistence. These checks do not claim browser layout or third-party dialog interaction coverage.
