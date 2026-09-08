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

Domain tests cover supplier demo scoping, split quantities, invalid inputs and quantity reconciliation. Production build validates component and stylesheet compilation. Browser visual/interaction QA was not performed unless separately requested. Optional WebMCP tools are feature-detected; no supported WebMCP execution context was available during creation, so their runtime contract is not claimed as verified.
