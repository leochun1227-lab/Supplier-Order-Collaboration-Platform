# Parts workbook

The buyer navigation now has a separate **备品备件表格 / Parts workbook** page. It preserves the supplied `2026 Parts order list发澳洲.xlsx` as Sheet1 (1256 × 27, including three header rows) and Sheet2 (5 × 15, including one header row). Both worksheet names, every cell, blank, cached formula value, date and all three merged regions are retained. No SAP field mapping or deduplication is applied.

`scripts/extract-parts-workbook.py` reads the source file without changing it and creates `public/parts-workbook.json`. The source file SHA-256 is retained. Run with the source path and output JSON path as its two arguments; Python requires openpyxl.

The page supports cell editing, clear, multiline values, rectangular TSV paste, numeric/date values, row and column insertion/deletion, 20-step undo/redo, per-column filters, search, three-state sorting and a single continuously scrolling grid. Every matching row is rendered without pagination. Column filter buttons are always visible; each opens an anchored dropdown with text search, blank/nonblank conditions and an exact-value checklist. The dropdown has no backdrop or blur, follows its column during scrolling, adjusts at viewport edges, and dismisses on outside click, focus leaving the panel, Escape or sheet navigation. Dismissing leaves unapplied draft conditions unchanged. Multiple column conditions combine, and the select-all checkbox selects all matching data rows. Changing filters clears row selection. Header/title cells are editable; structural row deletion preserves the header rows. Filters and sort are view-only. The formula bar displays the complete value or original formula.

The formula parser handles arithmetic, cell references and SUM ranges; date-plus-days and remaining-quantity calculations recalculate. Structural edits shift local formula references. Deleting a referenced row/column exposes `#REF!`; circular references expose `#CYCLE!`. Imported external VLOOKUP formulas retain the original cached result and are labeled in the formula bar. Their external workbooks are not available, so they cannot refresh. A value entered over such a formula becomes an explicit manual replacement.

Firebase uses the application's existing public test Realtime Database, at `supplierCollaboration/workspaces/excel-20260904/partsWorkbook`. The workbook is stored separately from immutable SAP evidence, but all public workspace pages now derive their records from this saved workbook together with collaboration versions. The existing public-test permissions are reused; this change does not broaden rules. The checked-in authenticated pilot rules are a different mode and would need scoped workbook rules and an authenticated transport before disabling public test mode.

The initial seed is created only if the workbook path is empty. The entire workbook is stored as JSON inside a versioned envelope so Firebase preserves nulls, empty arrays and exact row/column positions. Edits save automatically after commit, with ETag conditional writes to reject concurrent overwrites. Polling refreshes idle clients; pending edits survive failures and require an explicit discard before loading a conflicting version. Undo and redo also save. Navigation retains the mounted workbook; closing a tab with pending changes prompts the user. Unsaved edits do not survive a forced browser termination.

Validation: `node --test tests/parts-workbook.test.mjs`; `node scripts/verify-parts-workbook.mjs` tests actual Firebase writes in a temporary workbook and removes it. Append `--initialize` to initialize the real workbook only if absent. No existing SAP records are changed.

## Shared page linkage

`src/parts-workbook-link.mjs` joins the main worksheet to source orders using the original file/sheet/row evidence and immutable row IDs. Column IDs determine business fields even after header edits or structural changes. It never joins on the current material or PO, so changing either cannot update a different record or break shipment associations.

On a successful workbook save, the parent workspace immediately receives the saved snapshot. Other clients poll for workbook revisions alongside collaboration versions (15 seconds). Every workspace load applies the same projection, including when the workbook page was never opened. Failed workbook writes do not update other pages.

Main worksheet edits update order references, material and descriptions, quantities, dates, responsibility/purpose, source details and imported dispatch summaries. New populated rows become orders; blank inserted rows stay drafts. Deleted rows disappear from all active views and related counts. Collaboration history for hidden rows is retained across subsequent saves so workbook undo restores it. Additional columns appear in order details. Sheet2 updates appear as a workbook summary in the data center; dashboard metrics are still calculated from order details. Search, filters and sort remain view-only.

Workbook edits never rewrite SAP material, posted shipments, receipts or source files. The reference supplier column updates the reference supplier, not SAP's contract party. Changes to material/PO/line invalidate comparability and expose a material review item. External lookup formulas continue to use their cached results.

Other-page writes record a workbook field baseline. A later table edit takes precedence for the specific field changed, while unrelated notes, commitments, logistics edits and histories remain effective. An editor opened against an older workbook revision is rejected before saving. The linkage is workbook-to-workspace; other-page edits are not written back into worksheet cells.

Run `node --test --test-isolation=none tests/*.test.mjs` for domain/render coverage. `node scripts/verify-parts-workbook-link.mjs` copies the current source into a temporary Firebase workspace, exercises two clients, row deletion/undo, dates, notes and conflict rejection, then removes the temporary workspace. It leaves live orders and the live workbook unchanged.
## Default page and Excel export

Opening or refreshing the app now lands on Parts workbook. Vue KeepAlive retains its edit/save state when navigating to another page.

The **导出 Excel / Export Excel** button exports every worksheet and data row in the current workbook snapshot, independent of search, filters and sorting. The active cell is committed first; validation failures stop export. Current local edits are included even if their Firebase save is pending, allowing export to serve as a backup without claiming the cloud write succeeded. The file name includes the original name and export date.

The exporter runs in a Web Worker. It uses the supplied original file at `public/parts-workbook-template.xlsx`, verifies its SHA-256 against the immutable source manifest, and edits the OOXML package. Original styles, themes, rich text for unchanged cells, row heights, column widths, hidden states, borders, fills, fonts, number formats, merged regions, freeze panes, print settings and external-link caches are preserved. Added rows/columns inherit nearby styles; deleted rows/columns are omitted. Shared formulas are expanded to ordinary equivalent cell formulas, with current calculated values cached. The original external lookup formulas and caches remain, and their local lookup columns track structural edits. No external workbook is fetched.

The generated workbook resets the opening selection to the top data row and removes the original saved sort/filter conditions; auto-filter ranges follow current dimensions. Sheet2 stays in its original format, including its source hidden-row settings. Formula and typed-date values remain usable in Excel.

`tests/parts-workbook-export.test.mjs` verifies the template package, values, formulas and structural edits. `node scripts/verify-parts-export.mjs` creates disposable original/edited files in ignored `work/parts-export-qa/`; `python scripts/verify-parts-export.py` independently compares every original value, formula, cached result and cell style with openpyxl and checks the edited workbook. Neither script changes Firebase or the source workbook.
## Workbook workspace layout

The workbook fills the browser viewport. Its navigation is collapsed by default and opens as a drawer from the always-visible Navigation button; closing the drawer, selecting a page, clicking the backdrop or pressing Escape restores the grid area. Other pages keep their standard navigation layout. Compact title, toolbar, formula bar and worksheet tabs leave the remaining height to a flex-sized scrolling grid, with no fixed viewport subtraction or row pagination. The original title/group rows remain visible with tighter spacing; data text remains 14px. On narrow screens the toolbar scrolls horizontally and secondary file/version metadata is hidden.

## Cell color annotations

Select a cell, then choose Fill color in the toolbar. The palette offers eight light colors and a clear action. Color edits use the same undo/redo and Firebase conditional-save flow as cell values. Each row stores optional `fills` keyed by immutable column ID, so sorting, filtering and inserted rows/columns cannot move annotations onto other records. Deleted columns remove their annotations; undo restores the snapshot. Old workbooks without fills remain compatible.

Excel export adds deduplicated solid fills and derives cell styles from their existing font, number format, border and alignment. Unchanged rich text, formulas and blank cells retain their content while receiving the selected fill. Clearing an annotation restores the template style. Color metadata does not change business quantities or shared record identities.

## Row height and column width

Drag the right edge of a letter header to resize that column, or the lower edge of a row number to resize that row, including source headers. Pointer capture supports mouse, pen and touch. The size previews during dragging; release commits one undoable Firebase edit, while Escape, pointer cancellation or leaving the workbook cancels the preview. Double-click resets the dimension, and arrow keys on a focused resize handle adjust by 10 pixels. Columns are bounded to 48–1200 px and rows to 24–546 px.

Optional `widthPx` on each stable column and `heightPx` on each stable row survive sorting, filtering, inserts, saves and undo/redo. Resized rows clip overflow to the chosen height, with full values available through the formula bar/editor. Export converts row pixels to points and column pixels to Excel character-width units; untouched dimensions retain the original template values. Column widths are approximate in Excel because its Normal-font metrics can vary by installation.

## Exception comparison export

Exceptions & tasks (and the shared data reconciliation list) has an Export exceptions to Excel button. It exports every task matching the current search, issue type, owner and open/resolved state, independent of pagination. Each row contains the recorded issue and its current linked PO/SO/material/unit facts, owner, due date, review notes, closure evidence, source file/sheet/row, SAP source timestamp when available and UTC export time. Missing SAP fields remain blank; current material values and historical issue evidence are separate columns.

The generated `.xlsx` uses a frozen header, Excel filters, wrapped text, readable column widths and alternating row fills. All values are explicit text cells to retain identifier zeros and literal formula-like notes. Export reads only the supplied visible records and never changes Firebase or SAP.
