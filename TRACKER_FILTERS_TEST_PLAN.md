# Tracker filters — manual test checklist

Prereqs: backend running on :8080, frontend dev server on :5183, logged in as an Editor/Admin
(Viewer can check read-only behavior separately). Have at least 3-4 PI entries across different
vessels, vendors, currencies, and follow-up statuses — create a couple of test rows via "+ Add New
PI" if the tracker is empty.

## 1. Vessel / Vendor filter dropdowns

1. Open the Tracker page. Confirm two new dropdowns appear in the toolbar: "All vessels" and
   "All vendors", alongside the existing "All statuses".
2. Click "All vessels", select one vessel. Confirm the table immediately narrows to only rows for
   that vessel, and the page resets to 1.
3. Select a second vessel in the same dropdown (multi-select). Confirm rows from both vessels now
   show (OR behavior, not AND).
4. Repeat steps 2-3 for the vendor dropdown. Confirm combining a vessel filter + a vendor filter
   narrows to rows matching both (AND across different filter types).
5. Click "All vessels" checkbox again (or clear all) to reset — confirm the full list returns.

## 2. Quick-filter chips

1. Confirm two pill-shaped buttons appear in the toolbar: "Overdue > 30 days" and
   "No invoice attached".
2. Click "Overdue > 30 days". Confirm: the chip visually highlights (active state), the table
   narrows to entries with `days_since_payment > 30` and status not Received/Not Applicable, and
   the page resets to 1.
3. Open the Dashboard page in another tab and compare its "Needs Attention" table — the same PIs
   should appear in both (same >30-day, not-received/not-applicable definition).
4. Click the chip again to toggle it off — confirm the full list returns.
5. Repeat for "No invoice attached" — confirm only entries with zero uploaded attachment files
   show (check the Attachment column reads empty/0 for all visible rows). Note this is
   independent of the "Final Invoice Received" Yes/No column.
6. Toggle both chips on at once — confirm rows match both conditions (AND).

## 3. Date range pickers

1. Confirm 6 new date inputs appear: "DPR From/To", "Payment From/To", "Invoice From/To".
2. Set "DPR From" to a date before your test data's earliest DPR date, "DPR To" to a date after
   the latest. Confirm all rows still show.
3. Narrow "DPR To" to a date between two known DPR dates. Confirm only entries with `dpr_date` on
   or before that date remain (inclusive of the "To" date itself).
4. Repeat for Payment date range and Invoice date range independently — confirm each filters its
   own date column, not any of the others.
5. Clear all 6 date fields — confirm the full list returns.

## 4. URL persistence (shareable/bookmarkable filtered views)

1. Apply a combination of filters (e.g. one vessel + status + overdue chip). Look at the browser
   address bar — confirm it now contains query params like `?vessel_id=...&status=...&overdue=true`.
2. Copy the full URL. Open a new browser tab, paste it, and load it while already logged in.
   Confirm the tracker loads with the exact same filters already applied and the same rows shown
   — no need to re-select anything.
3. With filters applied, click a column header to sort, then move to page 2 (if enough rows).
   Confirm `sort_by`, `sort_dir`, and `page` all appear in the URL too.
4. Click the browser's Back button. Confirm it does NOT spam through every keystroke/filter
   change (should not require dozens of Back clicks to leave the page — the URL sync uses
   `replace`, not `push`).

## 5. Auto-saved "last used filters"

1. Apply some filters (e.g. a vendor + a date range). Wait about 1 second (the save is debounced
   ~600ms) then refresh the page **without** any query params in the URL (navigate to
   `/tracker` plain).
2. Confirm the filters you set are still applied — restored from your saved preference, not
   reset to defaults.
3. Clear all filters, wait a second, refresh again — confirm it now opens with no filters (the
   saved snapshot updated to the cleared state).
4. Log out and back in as a different user (if you have another test account) — confirm that
   user's filters are independent (each user has their own saved snapshot).

## 6. Currency column header filter

1. Hover over the "Currency" column header. Confirm a small funnel/filter icon fades into view
   (it should be invisible when not hovering).
2. Click the icon. Confirm a small dropdown opens with checkboxes: "All", "INR", "USD", "EUR" —
   and confirm it is NOT clipped/cut off by the table's header row (it should float freely,
   even if the table is scrolled horizontally).
3. Check "USD". Confirm the table narrows to only USD rows, and the funnel icon turns a
   highlighted/active color.
4. Click the Currency column header text itself (not the icon) — confirm this still triggers
   sort (ascending/descending arrow toggles), and does NOT also open/close the filter dropdown.
5. Re-open the filter dropdown and check "All" — confirm it clears back to showing all currencies.
6. Confirm no other column shows a filter icon on hover (only Currency has this control for now).

## 7. Pinned Follow-up Status column

1. Scroll the table horizontally to the right. Confirm "Actions", "DPR No.", and
   "Follow-up Status" all stay pinned/visible on the left while every other column scrolls
   underneath them.
2. Confirm there's a subtle drop-shadow on the right edge of the Status column marking the
   boundary between pinned and scrollable columns.
3. Click "⚙ Edit Layout". Confirm Follow-up Status is NOT draggable to a new position (try
   dragging it — it shouldn't move), but it still shows a resize handle on its right edge and can
   be resized by dragging that handle.
4. Resize the Status column, click "Save Layout". Refresh the page — confirm the resized width
   persists.
5. Click the Status column header (outside layout-edit mode) — confirm it still sorts the table
   by follow-up status (ascending/descending arrow toggles), same as before this change.
6. As a Viewer role (if available) or with `canEdit=false`, confirm Status still appears pinned
   correctly at the leftmost position (shifted left since there's no Actions column for a Viewer).

## 8. Regression checks (make sure nothing existing broke)

1. Search box still filters by DPR No./vessel/vendor/service details as before.
2. Status multi-select dropdown (existing) still works and combines correctly with all the new
   filters (AND across all filter types).
3. Sorting by any other sortable column (DPR No., DPR Date, Vessel, Vendor, Amount, Payment Date,
   Days Since Payment) still works.
4. Add New PI / inline row edit still works, including editing the Currency and Follow-up Status
   fields inline.
5. Pagination (Previous/Next, rows-per-page, custom page size) still works and resets to page 1
   whenever any filter changes.
6. Deep link from the Activity Feed ("View" button, `?entryId=...`) still clears all filters,
   jumps to the correct page, and flashes the target row — confirm this still works after adding
   the new filter-restore logic.
7. `npm run build` passes with no type errors.
