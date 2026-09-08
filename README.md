# Regent Supplier Order Collaboration — UI prototype

Interactive Chinese-language prototype using **Frappe UI 0.1.278**, Vue 3 and Vite. It uses the real Frappe UI Button, Badge and Dialog components, with a bespoke procurement workspace.

This is a frontend demonstration, not an installed Frappe Framework / ERPNext backend. All records are fictional. The role selector demonstrates supplier scoping; it is not authentication or a security boundary. State exists only in memory and resets on page refresh. No SAP, Excel, MES or logistics integration is connected.

## Run

```sh
npm ci
npm run dev
npm run test
npm run build
```

## Review flows

Use the 中文 / English control beside the preview badge to switch the entire interface. It covers all seven pages, dialogs, status labels, feedback, sample record descriptions, dates and CSV headers. The language preference is stored locally; switching does not reload or reset orders, filters or drafts. User-entered notes, comments and locations stay in their original language. Select values and status codes remain language-independent. English and Chinese interface text is maintained in `src/translations.mjs` through the shared reactive `src/i18n.mjs` layer.

The first page is now the Overview dashboard; Orders is the second navigation item. The overview includes outstanding PO/line counts, in-transit and unshipped quantities and goods values, fulfillment flow, transport quantity/value toggle, production/after-sales categories, open-order age buckets, shipment ETAs, freight and supplier confirmation summaries. Supplier/category filters apply to overview metrics; chart drilldowns carry the exact selected order IDs into the order workbench and can be cleared there.

All prices and freight charges are fictional AUD values. Goods value is quantity × unit purchase price, excluding freight and tax. In-transit quantity is SAP shipped minus received, allocated only once across linked batches; unlinked quantities remain in an explicit unmatched transport group. Warehouse receipt quantities remain independent of logistics milestones. The fixed demonstration date is 2026-09-08. Historical order creation dates demonstrate ageing rather than delay. Timeliness and on-time delivery rates are not fabricated from incomplete history.

1. Switch to Longtree supplier. Open PO 450051727 / 00090. Confirm 120 units or split them across multiple dates.
2. On a confirmed, unshipped order, propose a new delivery schedule with a reason.
3. Switch to Regent buyer. Review and accept or return the pending proposal in the delivery view. The existing commitment stays effective until accepted.
4. Record an exception update with a resolution rationale; closing a task does not alter source order facts.
5. Add comments, inspect history, update shipment milestones, filter/export orders and view live summary reports.
6. Data Center illustrates post-migration SAP + platform operation. Excel is an initial migration source only.

Scope: orders, split commitments, ETA change requests/review, shipment tracking, exception follow-up, comments/history, basic reports and migration status. Actual production progress updates, attachments, SAP sync, real access control and durable persistence remain future implementation work.

Tailwind 3 is installed under the `tailwindcss3` alias to use Frappe UI's supported preset. The generated Sites scaffold dependencies and component library remain available; the active preview is the Vue application in `src/` and static output in `dist/`.

## Attribution

- [Frappe UI](https://github.com/frappe/frappe-ui) — MIT, Frappe Technologies and contributors; see THIRD_PARTY_NOTICES.md.
- [Lucide](https://github.com/lucide-icons/lucide) — ISC.
- [Vue](https://github.com/vuejs/core) — MIT.

This is an independent prototype and is not an official Frappe product.

## Validation

Domain and analytics tests cover supplier/category scoping, split quantities, invalid inputs, partial receipts, unmatched batches, ageing boundaries and quantity/value reconciliation. Production build validates component and stylesheet compilation. Browser visual/interaction QA was not performed unless separately requested. Optional WebMCP tools are feature-detected; no supported WebMCP execution context was available during creation, so their runtime contract is not claimed as verified.

Localization tests render the actual page templates in Node with third-party UI wrappers stubbed. They check all seven pages, order detail tabs, action dialogs, dynamic labels, preserved select values and user content, business feedback, and preference persistence. These checks do not claim browser layout or third-party dialog interaction coverage.
