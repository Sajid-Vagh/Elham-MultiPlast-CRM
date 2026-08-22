
## Static Deal Numbering + Hide Deal From Activity Timeline

### Goal
- Deal numbers on the lead-detail Activity Timeline were index-based over a newest-first list, so creating a new deal renumbered every existing deal card ("Deal 1" became "Deal 2"). Numbering must be chronological and static.
- Users need to declutter the timeline by hiding deal cards from THIS UI only — without deleting deals or affecting pipeline/reports.

### Done
- **Static numbering:** `lead-detail.tsx` dealTimeline memo now builds `dealNumbers` Map from the chronologically-sorted (oldest-first) full deal list BEFORE any hiding filter; group carries its static `num`; label renders `Deal {group.num}` instead of `Deal {gi + 1}`. Hidden deals keep their numbers so unhide never reshuffles.
- **DB:** `deals.is_hidden_from_timeline` BOOLEAN NOT NULL DEFAULT FALSE — schema `lib/db/src/schema/deals.ts` + migration `lib/db/migrations/084_add_deal_hidden_from_timeline.sql` (**must be applied against Supabase before deploy**).
- **Backend PATCH /deals/:id:** reads `isHiddenFromTimeline` straight off `req.body` (generated zod UpdateDealBody strips unknown keys) — same pattern as otherReason/lostNotes. GET /deals list spreads full rows and GET /deals/:id uses enrichDeal spread → flag flows to frontend automatically.
- **Generated types:** `isHiddenFromTimeline?: boolean` added to Deal interface in `lib/api-zod/src/generated/types/deal.ts` AND `lib/api-client-react/src/generated/api.schemas.ts` (Deal + DealUpdate); api-client-react dist rebuilt via `tsc --build` (project references resolve stale dist declarations).
- **Frontend hide/unhide (`lead-detail.tsx`):**
  - EyeOff button absolutely positioned top-right of each deal AccordionItem (hover-reveal, OUTSIDE AccordionTrigger DOM so clicks don't toggle expand) → raw-fetch PATCH `{ isHiddenFromTimeline: true }` → `onDealChange` invalidation + toast.
  - Memo filters hidden deals unless `showHiddenDeals` reveal-toggle is on; revealed groups show an Eye icon to unhide.
  - Dashed footer row "N hidden deals — show" toggles reveal; rendered OUTSIDE the empty-state ternary so hiding ALL deals still leaves an escape hatch (empty state message adapts: "All deals are hidden from this timeline.").
- **Build verified:** CRM typecheck 0 errors; API server = 32 errors total / 12 in deals.ts — IDENTICAL counts with changes stashed (git stash A/B test), 0 new.

### Key Decisions
- Flag read from req.body instead of extending generated zod schemas — minimal generated-file churn, precedented by lostReason/otherReason.
- Numbering map computed over ALL deals including hidden ones — hiding/unhiding never changes any deal's number.
- Hide is purely presentational: no reports/pipeline/export queries filter on it.

---

## Timeline Raw-JSON Fix + Sequential Deal Note Numbering

### Goal
- Timeline / Recent Activity surfaces must never render stringified JSON (`[{"text":...,"userName":...}]`) for "Follow-up Scheduled"/"Note Logged" events — only clean note text.
- Follow-up notes on a deal render sequentially numbered ("Note 1: ...", "Note 2: ..."); a brand-new deal's first note starts from 1.

### Done
- `artifacts/crm/src/lib/parse-notes.ts`:
  - `parseNotesText` hardened for double-stringified JSON (guard extended to leading `"`, recursion when JSON.parse yields a string).
  - New `parseNotesEntries()` — unwraps up to 2 layers of encoded JSON, returns clean `text` entries in stored order.
  - New `formatDealNotes()` — entries parsed from JSON arrays are prefixed `Note ${index + 1}:` and joined with newlines; plain-text notes pass through unchanged.
- Wired `formatDealNotes` into deal-scoped surfaces: `lead-detail.tsx` (deal Activity Timeline follow-up events; removed now-unused local `parseNote`), `deal-detail.tsx` (Activities list, + `whitespace-pre-wrap`), `deal-detail-drawer.tsx` (Activity Timeline + Follow-up History rows).
- Already-safe surfaces verified (use parseNotesText): customer-profile-drawer, customer-profile page timeline tab, follow-ups edit dialog.
- Verified helpers via node strip-types against the exact reported payload: single entry → clean text/"Note 1:", double-encoded → unwrapped, multi-entry → Note 1..N, plain text → untouched.
- Build verified: CRM typecheck = 0 errors.

### Key Decisions
- Numbering is index-based per notes array, so it naturally restarts at 1 for every new deal/activity — no DB counter needed.
- Plain-text notes intentionally get NO prefix (legacy data stays visually unchanged); only JSON-array history gets numbered.

---

## Dispatch Sidebar Badge for Support/Admin

### Goal
- Support/Admin users need a red count badge on the "Dispatch" sidebar item showing orders waiting in the dispatch queue, so newly "Ready To Dispatch" production orders are immediately visible.

### Done
- New hook `artifacts/crm/src/lib/use-pending-dispatch-count.ts`: queries `GET /dashboard/support-kpi` and returns its `pendingDispatch` value (status = "Ready To Dispatch" AND dispatchStatus = "Pending Dispatch"/null — identical filter to the Support Dashboard KPI card).
- Hook shares the `"support-dashboard-kpi"` query-key prefix → auto-refreshes whenever `onProductionChange()` invalidates it after Ready For Dispatch / Load Vehicle / Mark Delivered actions; badge decrements/disappears automatically. 60s polling fallback; no duplicate fetch while the Support Dashboard is open.
- `layout.tsx`: hook enabled only for `admin` / `production_and_support`; red badge (`bg-red-500`, 99+ cap) rendered on the `/dispatch` nav item in both supportNavItems and the admin production-workspace nav, following the existing `/follow-ups` activity-badge pattern. Placed AFTER the role flags declaration (TDZ-safe).

### Key Decisions
- Reused the existing support-kpi endpoint instead of adding a new one (explicitly sanctioned by the request); no backend change, no DB migration.

---


## Proforma Invoices List — Full History via Server-Side Pagination

### Goal
- The Proforma Invoices list page showed only the newest 15 invoices (backend default page size); older invoices vanished as new ones were created and were unsearchable. All history must remain viewable/searchable.

### Done
- Frontend `proforma-invoices.tsx` list mode switched to true server-side pagination: fetch sends `page`, `limit=15`, and debounced `search`; response `{ data, total }` drives the table + `totalPages` + "Page X of Y · N invoices" footer.
- Removed the client-side `filteredInvoices` memo / slice pagination (it was paginating the same 15 server rows) and the now-unused `useMemo` import.
- Search box debounced 300ms; status/orderType/search changes reset to page 1; post-mutation refetches unchanged.
- Backend `GET /proforma-invoices`: search extended with an `EXISTS` on contacts matching contact `name`/`customer_code` (parity with the removed client-side filter fields). Pagination (`page`/`limit`, cap 100) already existed.
- Build verified: CRM typecheck 0 errors; no TS errors in proforma-invoices.ts.

### Key Decisions
- Server-side search/pagination chosen over raising the limit so 500+ invoice datasets stay fast; backend cap of 100/page respected.
- `/proforma-invoices/all` endpoint untouched (used by selection modals, not the list page).

---


## Real-Time "Order Cancelled" Notification for Production/Support

### Goal
- When a Sales Order is cancelled, Production/Support users must receive an immediate real-time notification so they can stop physical production.

### Done
- `cancelOrder` in `order-cancellation-service.ts` notification block updated:
  - Role query widened to `admin, production, production_manager, support, production_and_support` (previously missed `production` + `support`).
  - `title` → `Order Cancelled: ${order.orderNumber}`; `message` → `Order ${order.orderNumber} for ${customerName} has been cancelled.` + reason/cancelled-by lines.
  - `link` → `/production/orders/:id` when a production order is linked to the deal (transaction already returns it), else `/orders/:id`.
  - `type: "order_cancelled"`, `relatedId/relatedType: order` unchanged; `createNotification()` emits over SSE in real time (dedup per user/type/order prevents duplicates).

### Key Decisions
- Reused the existing `createNotification` SSE pipeline — no frontend changes needed.
- No DB migration needed.

---


## Owner Filter Dropdowns Include All Contact Owners

### Goal
- Users with roles like Production / Support who create or own leads must appear in the "All Owners" / "Sales Person" dropdown filters (Leads page + related tables). Previously only admin/sales/production_and_support were listed, so filtering by a Production owner's id showed blank results.

### Done
- New backend endpoint `GET /users/contact-owners` in `routes/users.ts`: returns users where `role IN ("admin","sales","production_and_support") OR EXISTS(SELECT 1 FROM contacts c WHERE c.sales_owner_id = users.id)`. Registered BEFORE `/users/:id`.
- Frontend hook `use-customer-facing-users.ts` now fetches `/api/users/contact-owners`; removed the roles-param filter and unused `CUSTOMER_FACING_ROLES`/`ROLES_PARAM` constants.
- All consumers fixed automatically: leads.tsx, follow-ups.tsx, deals.tsx, reports.tsx, import.tsx, leads-new/leads-edit (LeadForm assigned-to prop), schedule-follow-up-dialog.tsx.
- Build verified: CRM typecheck 0 errors; no TS errors in users.ts (baseline unchanged).

### Key Decisions
- Union approach (role-based + contact-ownership-based) keeps customer-facing roles always present while guaranteeing any contact owner appears even with an unusual role.
- No DB migration needed.

---


## Production Dashboard "Product Line Summary" Partial-Ready Fix

### Goal
- "Ready PCS" on the Production Dashboard Product Line Summary must count partial-ready pieces immediately (e.g., 600 of 1000 marked ready → Ready PCS = 600, In Production PCS = 400), instead of only counting lines whose status is fully "Ready".

### Done
- Backend `getDashboard` piece-KPI loop in `production-service.ts`: `readyPieces` now sums `readyQuantity` across ALL product-line rows unconditionally (partial-ready lines included); `inProductionPieces` / `pendingPieces` count `quantity - readyQuantity` remaining per bucket as before.
- Removed the old `else if (row.productionStatus === "Ready")` branch — fully-ready lines are still covered because their `readyQuantity == orderedQuantity`.
- Build verified: zero TS errors in production-service.ts (baseline unchanged).

### Key Decisions
- No frontend change needed (`productLineStats` renders API values directly).
- Machine Report page summary intentionally untouched (separate KPIs).

---


## Production Dashboard "Active (Manufacturing)" KPI Fix

### Goal
- The "Active (Manufacturing)" stat on the Production Dashboard must STRICTLY count orders where physical production is running right now — status exactly `In Production` / `Production On Going` — never Pending, Accepted, Planning, Packaging/Packing, Ready To/For Dispatch, or In Transport.

### Done
- Backend `getDashboard` in `production-service.ts` now computes a new `activeManufacturing` field: distinct order count where `status IN ("In Production", "Production On Going")`, reusing the same query rows/filters (unit, origin, date, soft-deleted-PI exclusion) as the existing KPIs. `activeOrders` (all non-terminal statuses) is kept unchanged for backward compat.
- Frontend `production-dashboard.tsx` Summary card switched from `dashboard?.activeOrders` to `dashboard?.activeManufacturing`.
- Build verified: CRM typecheck 0 errors; API server errors all in pre-existing baseline files (none in production-service.ts).

### Key Decisions
- Both `"In Production"` and `"Production On Going"` count because migration 048 renamed old statuses but both strings exist in the DB (`PRODUCTION_STATUSES` has "Production On Going"; v2 workflow uses "In Production").
- No DB migration needed.

---


## Goal
- Transform Lead Details page into Customer 360° Profile with all customer data available from one screen.
- Separate permanent Customer Comments from Follow-up Notes with version history, display across all CRM modules, Customer Profile view, search integration, and import support.

## Constraints & Preferences
- Do NOT redesign the UI or change existing workflow.
- Do NOT modify Follow-up, Notifications, Pipeline or Dashboard logic.
- Maintain backward compatibility with existing Leads and database.
- Customer Comments must NEVER be deleted when category, deal stage, or assignment changes.
- Every comment edit saves a history record; never overwrite previous versions.
- Return Customer Comments with existing Lead APIs wherever possible; avoid additional unnecessary API calls.
- Comments truncated to 100 chars with "View More" link; clicking shows full comments.
- Category changes tracked in `category_history` table; never lose history.

## Progress
### Done
- Phase 1: notification dedup, badge/popup behavior, lead filter counts, upcoming follow-ups (Regular Follow up + Pending), deal pipeline filter (Regular Follow up only), auto-assignment for sales, role permissions, notes history as JSON array with audit trail, query invalidation fixes across `follow-ups.tsx`, `leads.tsx`, `lead-detail.tsx`, `leads-new.tsx`, `import.tsx`, dashboard uses React Query for category counts.
- Phase 2: upcoming filter only `callStatus === "Pending"`; `notesToDisplay` returns latest-first; status dropdown (Pending/Completed/Cancelled/No Response) in edit dialog; notes history shown in edit dialog; status badges for all statuses; `pendingCount`, `todayActivities`, `followUpCount` all filter by Pending only; notification dismissal for Cancelled/No Response.
- Phase 3 Task 1: Merged Activity Timeline — Section 4 (Complete Follow-up History), Section 6 (Activity Timeline), and Section 14 (Activity Log) combined into one modern `Activity Timeline` card in `lead-detail.tsx`. Uses merged data from both activities (for action types) and timeline endpoint (for system events), sorted chronologically with date filter. Log Activity dialog moved inside the merged card header.
- Phase 3: Customer Comments feature — DB schema, migration, API zod schemas, TypeScript interfaces, backend contacts.ts with comment history tracking, frontend display in lead-detail.tsx, leads.tsx, follow-ups.tsx, deals.tsx. Import Excel comments mapping.
- Phase 4: Customer 360° Profile — `lead-detail.tsx` rewritten with all 10 sections (now 8 sections after merge):
  1. Customer Information (inline editable via dialogs)
  2. Customer Comments (existing, enhanced)
  3. Upcoming Follow-up (fetch + Complete/Call quick actions)
  4. Activity Timeline (merged from Follow-up History + Timeline + Activity Log)
  5. Deal Information (show/create deal inline)
  6. Category History (from `category_history` table, with user + timestamp)
  7. Notification History (from notifications table, related to contact)
  8. Quick Actions (Edit Comments, Schedule Follow-up, Move Category, Create Deal, Call, Copy Mobile, Edit Lead)
- Phase 4: Summary Card (sticky header with name, company, mobile, category, deal stage, next follow-up, customer since + Back/Move/Edit/Delete buttons)
- Phase 4: Category history tracking — automatic insert into `category_history` whenever category changes in PATCH /contacts/:id
- Phase 4: New backend endpoints:
  - `GET /contacts/:id/category-history` — returns category changes with user name
  - `GET /contacts/:id/timeline` — combined timeline of all events
  - `GET /contacts/:id/notifications` — notification history for the contact
- Phase 4: Migration `009_add_category_history.sql` (run against Supabase database)
- Phase 4: Live synchronization via React Query invalidation — after any update, all related sections automatically refresh
- Phase 4: Attachments section removed (future-ready placeholder no longer needed)

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Category history stored in `category_history` table (already existed in drizzle schema, created in DB via migration 009).
- Timeline endpoint combines 5 data sources: lead creation, activities, category history, comment history, and deal events — all sorted by date DESC.
- Inline editing uses a generic dialog (field name + value input) that calls `updateContact.mutate`.
- Follow-up completion handled via direct fetch PATCH to `/api/activities/:id` to avoid coupling with existing activity update flows.
- Summary Card uses `sticky top-0 z-10` to stay visible while scrolling.
- Pre-existing Drizzle ORM type errors in `deals.ts`, `categories.ts`, `contacts.ts` (insert overload matching) not introduced by Phase 4.
- Merged timeline deduplicates activity events: uses `activities` list (with full activity data) as primary source, skips matching events from timeline endpoint to avoid duplicates.

## Next Steps
- Phase 3 Task 2: Dashboard KPI validation — review Conversion vs Conversion Client metrics, fix duplicates, ensure all KPIs are clickable.
- Phase 3 Task 3: UI Polish — better spacing, cleaner cards, consistent typography, responsive/mobile layout.

## Relevant Files
- `lib/db/src/schema/category_history.ts`: category_history table schema (pre-existing)
- `lib/db/migrations/009_add_category_history.sql`: migration to create category_history table in DB
- `artifacts/api-server/src/routes/contacts.ts`: category history tracking, GET endpoints for category-history, timeline, notifications
- `artifacts/crm/src/pages/lead-detail.tsx`: Customer 360° Profile with all 10 sections + summary card + quick actions

---

# Shared Lead Form + Unit Dropdown + Won Amount Flow

## Goal
- Reuse a single Lead Form component for both Create Lead and Edit Lead, remove Contact Dates / Additional Contact / state / category from the form, fix the 500 error on Edit Lead, fix the Unit dropdown to only show Himatnagar / Surat / Rajkot / Not Sure, and implement a mandatory Won Amount popup with confirmation before moving a deal to WON.

## Constraints & Preferences
- Edit Lead and New Lead must share the same form component; any field added/removed from New Lead automatically reflects in Edit Lead.
- Do not maintain two different forms.
- The Unit dropdown must contain only: Himatnagar, Surat, Rajkot, Not Sure (remove Unit 1, Unit 2, Unit 3).
- Unit list should come from a shared constants file, not hardcoded in forms.
- "Additional Contact", "Contact Dates", "Last Call Date", "Next Call Date" belong to Follow-up/Activity, not Lead editing.
- Category belongs to "Move Category" dialog, not the edit form.
- Won Amount popup must appear automatically when deal status changes to WON (drag & drop or manual).
- Before WON, a confirmation dialog must appear; "No" restores original stage.
- Won Amount must be mandatory (> 0) and used in Dashboard Won Value / Revenue Reports / Analytics.
- Deal must move to "My Client" category only after successful save with valid wonAmount.
- Do not affect Production or Dispatch modules.
- Do not modify generated files when possible; when necessary, keep changes minimal.
- No 500 Internal Server Error, no console errors, no TypeScript errors.

## Progress
### Done
- Created shared `LeadForm` component at `artifacts/crm/src/components/lead-form.tsx` (Basic Information + Location & Classification only; no Contact Dates, no Additional Contact, no state, no category).
- Refactored `leads-new.tsx` to use `LeadForm` (75 lines vs 395).
- Refactored `leads-edit.tsx` to use `LeadForm` with `initialData` from `useGetContact` (92 lines vs 355).
- Fixed root cause of 500 error: `category` column is `notNull()` with default; edit form was sending `category: null`. Removing `category` from the shared form eliminates this.
- Fixed duplicate `state`/`category` identifiers in `api-client-react/src/generated/api.schemas.ts` `ContactUpdate` interface.
- Created shared constant `artifacts/crm/src/lib/units.ts` with `UNITS = ["Himatnagar", "Surat", "Rajkot", "Not Sure"]`.
- Updated `lead-form.tsx` to import `UNITS` from shared constant.
- Updated `ContactUnit` const in `api.schemas.ts` to remove Unit 1/2/3.
- Added "Not Sure" to `ContactUnit` in `api-zod/src/generated/types/contactUnit.ts`.
- Added `wonAmount` column to `dealsTable` in `lib/db/src/schema/deals.ts` (numeric, nullable).
- Created migration `lib/db/migrations/018_add_won_amount.sql`.
- Added `wonAmount` to `CreateDealBody`, `UpdateDealBody`, `CreateDealResponse`, `GetDealResponse`, `UpdateDealResponse` Zod schemas in `api-zod`.
- Added `wonAmount` to `Deal`, `DealInput`, `DealUpdate` TypeScript types in `api-zod` and `api-client-react`.
- Updated backend `PATCH /deals/:id` to require `wonAmount > 0` when stage becomes "Won" (instead of `totalValue`).
- Updated dashboard `totalWonValue` calculation to prefer `wonAmount`, fallback to `totalValue`.
- Updated frontend `deals.tsx` drag & drop flow: intercept WON drops with confirmation dialog → Won Amount popup → API call with `wonAmount`.
- Updated `deal-detail.tsx` manual status change to WON to use `wonAmount` instead of `totalValue`.

### In Progress
- (none)

### Blocked
- (none)

---

# Global Avatar System

## Goal
- Replace all initials/colored-circle avatar placeholders across the entire CRM with the user's uploaded profile photo, using a single reusable component.

## Progress
### Done
- Created `artifacts/crm/src/components/user-avatar.tsx` — reusable `UserAvatar` component wrapping Radix `<Avatar>` + `<AvatarImage>` with fallback initials and cache-busting (`?v=timestamp`).
- Backend `reports.ts:179` — added `profilePhoto` + `username` to GET /reports/by-owner response.
- Backend `categories.ts` — added `profilePhoto` + `username` to GET /categories/report topPerformers response.
- Frontend: replaced all coloured dots/initials with `UserAvatar` across 12 files:
  - `layout.tsx` (sidebar user avatar)
  - `lead-form.tsx` (assigned-to user selection)
  - `schedule-follow-up-dialog.tsx` (assigned-to user selection)
  - `dashboard.tsx` (sales performance)
  - `leads.tsx` (assigned user)
  - `lead-detail.tsx` (assigned user)
  - `deals.tsx` (deal owner)
  - `deal-detail.tsx` (deal owner)
  - `duplicates.tsx` (duplicate contact owners)
  - `reports.tsx` (Performance by Sales Owner table)
  - `settings.tsx` (user list)
  - `import.tsx` (assigned user dropdown)
- Updated `query-invalidation.ts` `onUserChange` — invalidates `dashboard-sales-performance`, `dashboard-recent-activities`, `reports-by-owner`, `category-report` on user update.

### Note
- The Reports "Performance by Sales Owner" table appears to show initials only when the users queried have `profilePhoto = null` in the database. The logged-in user's photo is visible via `useGetMe` (sidebar), but the by-owner endpoint queries *all* sales users. Once a photo is uploaded for each user in **Settings**, it displays correctly.
- **Root cause of "photo works for admin but shows initials for non-admins":** legacy `profilePhoto` rows store a relative `/api/uploads/profile-photos/<file>` URL (uploaded while the local filesystem provider was active). Only `auth.ts` and `users.ts safeUser()` mapped these to working Supabase public URLs via `normalizeProfilePhotoUrl()`; every other endpoint returned the raw relative URL → 404 → initials fallback. Admin's photo worked because it was re-uploaded after the Supabase migration (absolute URL in DB).
- **Fix:** added `normalizeProfilePhotoUrl()` to all remaining avatar-bearing responses: `dashboard.ts` (sales performance KPI), `reports.ts` (by-owner), `categories.ts` (topPerformers + salesOwner/changedByUser maps), `contacts.ts` (`withOwner`, duplicate payloads, list + duplicates userMap), `import.ts` (ownerProfilePhoto), `deals.ts` (list userMap + `enrichDeal` salesOwner), `activities.ts` (userMap). Relative URLs are remapped to `{SUPABASE_URL}/storage/v1/object/public/...`; absolute URLs pass through unchanged.
- Users whose photos predate the Supabase migration and were only on the ephemeral local filesystem must re-upload once in Settings (the old files are unrecoverable); all new uploads persist in Supabase and now render in every module for every role.
- **403 fix (still-failing non-admin avatars):** bucket `public=true` alone is NOT sufficient. Buckets are created at runtime by inserting directly into `storage.buckets` (`createBucketViaDb`), which bypasses the Storage REST API — so Supabase never auto-creates the anonymous `SELECT` policy on `storage.objects`. The browser's `<img src>` (no auth header) then hits `storage.objects` RLS → HTTP 403 → initials fallback for every role. Fix: migration `072_add_storage_public_read_policies.sql` creates `CREATE POLICY "Public read access (all public buckets)" ON storage.objects FOR SELECT TO public USING (bucket_id IN (SELECT id FROM storage.buckets WHERE public = true));` (anon + authenticated read for all public buckets: `profile-photos`, `voice-notes`, `documents`, `builty`). Runtime self-healing added in `storage.ts`: `ensurePublicReadPolicies()` runs the same DROP/CREATE via `db.execute` (once per process) and is invoked from `ensureBucketPublic()` and at the end of `ensureBucketExists()`, so existing deployments repair on next upload/startup even if the migration is applied late.
- **Sleep/wake photo loss fix:** After laptop sleep/resume, browser evicts in-memory image bitmaps → Radix Avatar `<img>` fires `onerror` → shows initials fallback. React Query refetches `useGetMe()` on window focus but returns the same `profilePhoto` URL string → `useMemo(() => Date.now(), [profilePhoto])` returns the same old timestamp → `<img src>` unchanged → browser won't retry a failed URL → photo stuck as initials. Fix: added `visibilitychange` listener in `UserAvatar` (`user-avatar.tsx:27-40`) that bumps a `visibilityBump` counter with a 300ms delay after the tab becomes visible. `cacheBuster` now depends on both `profilePhoto` AND `visibilityBump`, so the `<img src>` URL changes on wake, forcing a fresh image load.

---

# Proforma Invoice Module

## Goal
Deliver a working Proforma Invoice module with Customer Master, real GST auto-fill via a free provider, product auto-population, auto-calculations, printed PDF matching the original Elham Multiplast layout, and soft-delete.

## Constraints
- Printed PDF must keep the original layout almost identical (Party Details :, Order No, Date, S.N. header, outer `border:1.5px solid #000` box). Only improve fonts and print quality, not redesign.
- GSTIN auto-fetch must trigger automatically 500ms after entry without requiring manual button click.
- The form must NEVER show placeholder/sample values after a successful GST lookup; every field overwritten unconditionally.
- Product selection auto-populates product name and rate from the `products` table via autocomplete.
- All invoice calculations (Amount, Freight, Taxable, CGST, SGST, IGST, Grand Total, Amount in Words) automatic.
- Customer Master duplicate check: if GSTIN exists, show "Use Existing" / "Update Existing", never create duplicates.
- On invoice save, auto-save customer to Customer Master if new.
- Every user can delete invoices (not just admins); soft-delete with `deletedAt`/`deletedBy`, hidden from all views.
- **CRM must NEVER generate fake company names or fake addresses. If GST lookup cannot return real data, return an error.** No mock provider in production. No sample data. No fake addresses.
- GST lookup is now live via 4-tier approach: GSTVerify → GSTZen API → HTML scraping → Customer Master fallback. No mock data.
- GST lookup must work with a FREE provider — no premium API key subscriptions.
- The flow should work like cleartax.in: enter GSTIN → auto-fetch → auto-fill all fields.

## Progress
### Done
- Customer Master DB schema, proforma invoices schema extended, migrations (013, 014).
- `POST /proforma-invoices/gst-lookup` endpoint with 4-tier fallback (GSTVerify → GSTZen → HTML scrape → Customer Master).
- Frontend: 500ms debounce auto-fetch, no "Verify GST" button, `gstLoading`/`gstError` states.
- `applyGstDetails` updated with `companyName` fallback on `legalName`/`tradeName`.
- GSTVerify API key configured — **9 demo credits remaining** (₹0.10/call thereafter).
- Product autocomplete backend + frontend.
- Auto-save customer to Customer Master on invoice save.
- Soft-delete for all users.
- PDF layout reverted to original design.
- **Multiple GST profiles per mobile number**: mobile lookup now goes through canonical `GET /customer-master/lookup?mobile=` (returns an ARRAY of all profiles; registered before the `/:id` param route). UI shows a "+ Add New Profile / GST for this number" option in both profile selectors; selecting it clears billing fields (except mobile), drops `customerMasterId`, and saves the new GST as a distinct Customer Master row tied to the same mobile (schema already allows duplicate `mobile` — only `gstin` is unique). `handleSave` now pre-creates/links the Customer Master record BEFORE the PI is saved (409 adopts the existing profile) instead of the old post-save best-effort block.
- **Per-profile delete**: each GST profile card in the PI selection list has a subtle Trash button (top-right, `e.stopPropagation()`, `window.confirm` confirmation) calling `DELETE /api/customer-master/:id`. Deletion is a **soft delete** (`is_deleted`/`deleted_at`/`deleted_by` via migration 065) since profiles are referenced by `proforma_invoices.customer_master_id` and `voice_notes.customer_id` — historical invoices keep their link. All lookup endpoints (`lookup`, `lookup-by-gstin`, `search-by-mobile`, `search-by-name`, `by-contact`, list, single, proforma-history) and GST fallbacks (`gst.ts`, `proforma-invoices.ts` Tier 5) exclude deleted profiles; duplicate check ignores deleted rows so a GSTIN can be re-created. DELETE endpoint is now available to any authenticated user (was admin-only), matching the open POST.
- **PDF page-border + border-leakage fix:** `.page` container now sized at `202mm × 289mm` with `margin:4mm auto` (4mm inset from A4 edges on all sides), `border:1px solid #000` as the outer rectangular frame. Each page gets its own independent border via `page-break-after:always`. Filler row removed (was the source of vertical column-border leakage into the footer). `.table-wrap` and table stretching removed; table takes natural height on all pages. Footer moved from `position:absolute` to normal flex flow as a sibling of `.page-content` — both sit inside `.page` (inside the outer border). `.page-spacer{flex:1}` pushes footer to the bottom. Client-side preview aligned with identical structure. **Product table vertical lines now stop at the table's last row; no leakage into Bank Details, Terms, Disclaimer, or Signature.**

## Production Module

### Goal
Add a Production Module with role-based access (Sales, Production Manager, Admin) inside the same CRM. Auto-create Production Orders when Sales Orders are confirmed. Read-only Production view for Sales users. Dynamic sidebar based on role.

### Done
- DB schema: `production_orders`, `production_timeline`, `production_notes` tables in `lib/db/src/schema/production_orders.ts`
- Migration `017_add_production_orders.sql` — creates 3 tables + indexes
- Role `production_manager` added to `UserRole`, `UserInputRole`, `UserUpdateRole` types
- Backend `production.ts` routes:
  - `GET /production/dashboard` — KPI cards (pending, accepted, planning, in production, packing, ready for dispatch, in transport, completed today, delayed)
  - `GET /production/orders` — list with search, status filter, priority filter, **creator filter**, **origin filter**, pagination
  - `GET /production/orders/:id` — single order detail with invoice, items, timeline, notes, **creator info**, planning/production/packing/transport detail cards
  - `GET /production/pending-summary` — product-wise pending production quantity (SQL GROUP BY)
  - `GET /production/by-invoice/:invoiceId` — lookup by proforma invoice (used by Sales read-only view)
  - `POST /production/orders/:id/start` — start production (In Production), sets productionMachine/operatorName/inProductionNotes
  - `POST /production/orders/:id/packing` — complete packing step with packingType (Bundle/Packet) + packingNotes
  - `POST /production/orders/:id/ready-for-dispatch` — mark as Ready For Dispatch, notifies Support
  - `POST /production/orders/:id/transport` — book transport (Support role), sets transportName/transportDetails, moves to In Transport
  - `POST /production/orders/:id/complete` — complete order (terminal state)
  - `POST /production/orders/:id/notes` — add internal production note
  - `PATCH /production/orders/:id/status` — REMOVED (returns 400, directs to specific endpoints)
- **Production Workflow v2:** New chronological status flow: Pending → Accepted → Planning → In Production → Packing → Ready For Dispatch → In Transport → Completed
- **Status migration:** "Machine Running" → "In Production", "Quality Check" → "Packing", "Ready For Dispatch" with existing transport data → "In Transport"
- **New DB columns:** `productionMachine`, `operatorName`, `inProductionNotes`, `packingType` (Bundle/Packet with CHECK constraint), `packingNotes`, `packingCompletedById`, `packingCompletedAt`, `transportBookedById`, `transportBookedAt`. Orders frozen (`isFrozen: true`) when In Production.
- **Migration `048_production_workflow_v2.sql`** — adds new columns, migrates old statuses, adds indexes + constraints
- Auto-create Production Order in `proforma-invoices.ts` when status → "Converted to Order"
- **Permanent creator info** stored on production_orders: `createdById`, `createdByName`, `createdByRole`
- **Real-time notifications** to all production managers/admins when new production order is created (via existing SSE infrastructure)
- Notification includes: creator name, role, customer, company, product, quantity, order number
- **Admin-only Product Management**: POST/PATCH/DELETE on `/products` restricted to admin role
- Frontend pages:
  - `production-dashboard.tsx` — 8 KPI cards (Pending, Accepted, Planning, In Production, Packing, Ready for Dispatch, In Transport, Delayed) + **Pending Production Summary widget** + **Origin filter**
  - `production-orders.tsx` — full list with search, status/priority/origin/creator filters, **Created By column**, **Origin badge**, status badges matching new color scheme
  - `production-order-detail.tsx` — full rewrite with new workflow dialogs (Planning, Start Production, Packing, Transport Booking, Cancel); detail cards (Planning Details, Production Details, Packing Details, Transport Details); Support-specific "Dispatch Action" card at Ready For Dispatch
  - `products.tsx` — **admin-only Create/Edit/Delete**, **Status column** (Active/Inactive)
- `production-progress.tsx` — read-only Production Progress card for Sales users with v2 workflow steps, detail fields (plannedMachine, productionMachine, packingType, transport details), activity log timeline
- `support-dashboard.tsx` — Ready for Dispatch + In Transport KPI cards added (from production_orders); navigates to filtered production orders
- `App.tsx` — `RoleGuard` component redirects users based on role; production routes guarded
- `layout.tsx` — dynamic sidebar: Sales shows only Sales nav, Production shows only Production nav, Admin shows both
- `login.tsx` — stores `crm_user_role` in localStorage, redirects to correct dashboard based on role
- `settings.tsx` — role dropdown includes Production Manager option
- `seed.ts` — includes `production` user with role `production_manager`
- Backend 403 enforcement: all `/api/production/*` endpoints return 403 for non-production/non-admin users
- **Query invalidation** updated to include `production-pending-summary` key
- **Generated types** updated: `Product`, `ProductInput`, `ProductUpdate` interfaces + Zod schemas now include `status` field
- **Unified Production Order Workflow (Sales + Support):** All production features work identically regardless of origin
  - `requestedUnit` column added to `production_orders` (original unit, never changes on transfer)
  - Migration `047_add_requested_unit.sql` — adds `requested_unit`, `created_by_role` index, backfills existing rows
  - Auto-creation in `proforma-invoices.ts` and `deals.ts` sets `requestedUnit` = `productionUnit` on creation
  - `production-service.ts` `getDashboard`, `listOrders`, `getReports` accept `origin` filter (`createdByRole`)
  - `notifySalesOfProductionEvent` notifies support users when `createdByRole === "production_and_support"`
  - Frontend `production-dashboard.tsx`: Origin filter dropdown (Sales Orders / Support Orders / All)
  - Frontend `production-orders.tsx`: Origin filter + Origin column (SALES/SUPPORT badge)
  - Frontend `production-order-detail.tsx`: Origin badge (SALES/SUPPORT), Requested Unit vs Current Unit display

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- `POST /proforma-invoices/gst-lookup` returns HTTP 200 always, with `{ success: true/false }` body.
- GSTVerify is Tier 1 (free, working), GSTZen is Tier 2 (needs paid sub), HTML scrape Tier 3 (unreliable), Customer Master Tier 4 (fallback).
- `normalize()` helper maps snake_case from APIs to camelCase expected by frontend.
- `ApiGstProvider` kept for backward compat (GSTZen).
- No mock provider exists anywhere.
- `GET /customer-master/lookup?mobile=` is the canonical multi-profile mobile lookup (array). `search-by-mobile/:mobile` kept for backward compat.
- Uniqueness for `customer_master` is `gstin` only — same mobile with different GSTIN/trade name is a distinct profile (no migration needed; `gstin` nullable since migration 051).
- Profile deletion is soft (`is_deleted`/`deleted_at`/`deleted_by`, migration 065) not hard — hard delete would break FK references from `proforma_invoices.customer_master_id` and `voice_notes.customer_id`, losing historical invoice links. Deleted profiles are excluded from every lookup and from the GST duplicate check (so a GSTIN can be re-registered), but their historical invoices remain intact. `proforma_invoices.ts:733` contact filter subquery intentionally does NOT filter `is_deleted` so invoices of deleted profiles stay findable.

## Relevant Files
- `artifacts/api-server/src/routes/proforma-invoices.ts`: gst-lookup (4-tier), renderInvoiceHtml, soft-delete DELETE, **production order auto-creation with requestedUnit + origin**
- `artifacts/api-server/src/lib/gst-provider.ts`: GstProvider interface + ApiGstProvider (GSTZen).
- `artifacts/api-server/src/routes/customer-master.ts`: CRUD + lookup endpoints.
- `artifacts/api-server/src/routes/products.ts`: GET /products/search?q=.
- `artifacts/crm/src/pages/proforma-invoices.tsx`: full frontend with auto-fetch, autocomplete, calculations, delete.
- `lib/db/src/schema/customer_master.ts`: Customer Master table.
- `lib/db/src/schema/proforma_invoices.ts`: proforma_invoices table (with customerMasterId, deletedAt/by).
- `lib/db/migrations/013_add_customer_master.sql`, `014_add_deleted_at_by.sql`.
- `.env`: `GSTVERIFY_API_KEY` (primary), `GST_API_URL` + `GST_API_KEY` (fallback).

## Production Module Relevant Files
- `lib/db/src/schema/production_orders.ts`: production_orders, production_timeline, production_notes table schemas (updated with v2 statuses, PACKING_TYPES, new columns)
- `lib/db/src/schema/products.ts`: products table schema (with `status` field)
- `lib/db/migrations/017_add_production_orders.sql`: migration to create production tables
- `lib/db/migrations/027_production_enhancements.sql`: migration for creator info, product status, indexes
- `lib/db/migrations/047_add_requested_unit.sql`: migration for requested_unit, created_by_role index
- `lib/db/migrations/048_production_workflow_v2.sql`: migration for new v2 columns (productionMachine, operatorName, packingType, transportBookedBy/At, packingCompletedBy/At), status migration (Machine Running→In Production, QC→Packing, RFD w/ transport→In Transport)
- `artifacts/api-server/src/routes/production.ts`: all production API endpoints (dashboard, orders, **pending-summary**, **new v2 endpoints**: start, packing, ready-for-dispatch, transport, complete; **old PATCH status removed**)
- `artifacts/api-server/src/lib/production-service.ts`: full rewrite with v2 workflow functions (startProduction, completePacking, markReadyForDispatch, bookTransport, completeOrder; **completeDispatch removed**)
- `artifacts/api-server/src/routes/proforma-invoices.ts`: auto-create production order on "Converted to Order" with **creator info** + **real-time notifications to production users**
- `artifacts/api-server/src/routes/products.ts`: CRUD + search, **admin-only POST/PATCH/DELETE**, updated isInProduction check
- `artifacts/api-server/src/lib/order-cancellation-service.ts`: updated cancellation rules references from "Machine Running" to "In Production"
- `lib/api-zod/src/generated/types/userRole.ts`, `userInputRole.ts`, `userUpdateRole.ts`: role types updated
- `lib/api-zod/src/generated/api.ts`: updated role enums + **Product status in Zod schemas**
- `lib/api-client-react/src/generated/api.schemas.ts`: updated UserRole const + **Product status in interfaces**
- `artifacts/crm/src/pages/production-dashboard.tsx`: Production Dashboard with 8 KPI cards (Pending, Accepted, Planning, In Production, Packing, Ready for Dispatch, In Transport, Delayed) + **Pending Production Summary widget** + **Origin filter**
- `artifacts/crm/src/pages/production-orders.tsx`: Production Orders list with search, status/priority/origin/creator filters, **Origin column (SALES/SUPPORT badge)**, status badges matching v2 color scheme
- `artifacts/crm/src/pages/production-order-detail.tsx`: Full rewrite — Planning/Start/Packing/Transport/Cancel dialogs; Planning/Production/Packing/Transport detail cards; Support-specific Dispatch Action card; v2 STATUS_COLORS
- `artifacts/crm/src/pages/products.tsx`: Product Management — **admin-only controls**, **Status column**
- `artifacts/crm/src/components/production-progress.tsx`: read-only Production Progress for Sales users (v2 workflow steps: Pending→Accepted→Planning→In Production→Packing→Ready For Dispatch→In Transport→Completed; detail fields: plannedMachine, productionMachine, packingType, transport details; activity log timeline)
- `artifacts/crm/src/pages/support-dashboard.tsx`: Ready for Dispatch + In Transport KPI cards (navigate to filtered production orders); Pending Dispatch + In Production cards retained
- `artifacts/crm/src/App.tsx`: RoleGuard component, production routes
- `artifacts/crm/src/components/layout.tsx`: dynamic role-based sidebar
- `artifacts/crm/src/pages/login.tsx`: login redirect based on role
- `artifacts/crm/src/lib/query-invalidation.ts`: `onProductionChange()` invalidates pending-summary
- `artifacts/crm/src/pages/settings.tsx`: role dropdown includes Production Manager
- `artifacts/api-server/src/seed.ts`: includes production user

---

# Existing Customers Module

## Goal
- Provide a dedicated Existing Customers management interface for Support and Admin roles, showing enriched customer data from the `existing_customers` table with dashboard KPIs, order history, repeat orders, complaints, communications, timeline, and internal notes.

## Progress
### Done
- Renamed migration `019_add_existing_customers.sql` → `020_add_existing_customers.sql` (resolved naming conflict with `019_add_completed_at.sql`).
- DB schema `lib/db/src/schema/existing_customers.ts` — Drizzle ORM table with 25 columns (pre-existing).
- Migration `lib/db/migrations/020_add_existing_customers.sql` — CREATE TABLE with indexes (pre-existing, renamed).
- Backend API routes `artifacts/api-server/src/routes/existing-customers.ts` — 15 endpoints:
  - `GET /existing-customers/dashboard` — 8 KPI counts
  - `GET /existing-customers` — paginated list with search, enriched filters, pagination
  - `GET /existing-customers/:id` — enriched single customer detail
  - `GET /existing-customers/:id/orders` — order history with items + sales owner
  - `GET /existing-customers/:id/complaints` — complaint history with assigned user name
  - `GET /existing-customers/:id/repeat-orders` — filtered repeat orders with items
  - `GET /existing-customers/:id/communications` — communication history
  - `POST /existing-customers/:id/communications` — log communication
  - `GET /existing-customers/:id/notes` — internal notes (pinned first)
  - `POST /existing-customers/:id/notes` — add note
  - `GET /existing-customers/:id/timeline` — combined events (lead, promotion, orders, timeline, complaints, comms, follow-ups)
  - `POST /existing-customers/:id/follow-ups` — create activity + notification for sales owner
  - `POST /existing-customers/:id/repeat-order` — create repeat order from source (copies items, calculates totals, notifies)
  - `PATCH /existing-customers/:id` — update status/supportOwner/repeatOrderDue/isActive
  - `POST /existing-customers/refresh/:contactId` — refresh stats from orders
- Route registration in `routes/index.ts` — already imported and mounted (pre-existing).
- **Auto-promotion:** `promoteToExistingCustomer` wired into `orders.ts` PATCH when status → "Delivered" or "Completed" (not on creation). Quotations conversion unchanged.
- **List endpoint enhanced:** filters: `productionStatus`, `dispatchStatus`, `complaintStatus`, `lastOrderBefore`, `lastOrderAfter`; search includes `email`, `gstNumber`, `supportOwner`, `lastProductName`, `lastOrder.orderNumber`.
- **Backend helper enhanced:** `enrichExistingCustomer` includes `freight`, `paymentTerms`, `deliveryTerms`, `dispatchAddress`, `transportDetails` on lastOrder.
- **"To Call Today" KPI** fixed to use `activitiesTable` (Pending + followUpDate=today) instead of `internalNotesTable`.
- **Frontend:** `existing-customers.tsx` — list page with 8 KPI cards, search, status filter, enriched table, pagination (pre-existing, compatible with new backends).
- **Frontend:** `existing-customer-detail.tsx` — detail page fully rewritten with:
  - Header: Back + Name + Status badge + Action buttons (Edit, Log Comm, Note, Follow-up, Repeat Order)
  - Contact Info row (6 cards): Mobile, Email, Company, City, Customer Since, GST
  - Stats row (5 cards): Total Orders, Total Revenue, Repeat Orders, Notes, Repeat Due date
  - Status cards (3 color-coded): Production, Dispatch, Active Complaint
  - Last Order card with extended details (freight, payment terms, delivery terms, dispatch address, transport) + link to order
  - First Order card
  - Assigned Team row (4 columns): Sales Owner, Support Owner, Last Product, Repeat Orders
  - 6 tabs: Orders (with repeat indicator), Repeat Orders, Complaints, Communications, Timeline (icon + dot visual timeline), Notes (pinned first)
  - 5 dialogs: Log Communication, Add Note, Edit Customer, Schedule Follow-up, Create Repeat Order
- **App.tsx:** Routes for `/existing-customers` (list) and `/existing-customers/:id` (detail) — guarded by SUPPORT_ROLES (admin + support).
- **layout.tsx:** "Customers" nav item added to supportNavItems and admin's combined nav (indigo color, Users icon).

## Key Decisions
- Frontend uses direct `fetch()` calls (not generated hooks) to avoid modifying generated files in `api-client-react` and `api-zod`. Consistent with `customer-profile.tsx` pattern.
- Timeline deduplication not needed (each event source has unique `id` prefix).
- Repeat order copies from last order's items with quantity adjustment support; navigates to new order on success.
- Follow-up endpoint auto-creates a deal if none exists (links activity to deal).
- "To Call Today" KPI counts activities with Pending status + today's date (not internal notes).
- Migration rename to `020_` avoids conflict: `019_add_completed_at.sql` likely already ran.
- DB migration not yet applied; pending user approval.

## Relevant Files
- `lib/db/src/schema/existing_customers.ts`: Drizzle ORM table schema (pre-existing)
- `lib/db/migrations/020_add_existing_customers.sql`: migration to create existing_customers table (renamed from 019)
- `artifacts/api-server/src/routes/existing-customers.ts`: all 15 backend endpoints + helpers
- `artifacts/api-server/src/routes/orders.ts`: promotion trigger on status → Delivered/Completed
- `artifacts/crm/src/pages/existing-customers.tsx`: list page with dashboard KPIs + filters + table
- `artifacts/crm/src/pages/existing-customer-detail.tsx`: detail page (fully rewritten with 6 tabs, 5 dialogs, extended info)
- `artifacts/crm/src/App.tsx`: routes for existing customers
- `artifacts/crm/src/components/layout.tsx`: sidebar navigation item

---

# Dynamic Units System

## Goal
- Replace all hardcoded unit strings across the CRM with a fully dynamic, admin-manageable units system.
- Admin can add new units, activate/deactivate units, and delete units from the Settings page.
- All dropdowns across the CRM automatically reflect the active units from the database.

## Constraints & Preferences
- Admin-only access for unit management (POST, PATCH, DELETE restricted to admin role).
- GET /units returns only active units by default (used for dropdowns).
- GET /units?all=true returns all units (active + inactive) for admin management.
- "Not Sure" unit excluded from production unit dropdowns but available for contact units.
- Default units seeded: Himatnagar, Surat, Rajkot, Not Sure.
- All unit columns in the DB are already `text()` type (no pgEnum conversion needed).

## Progress
### Done
- DB schema: `units` table in `lib/db/src/schema/units.ts` (id, name, isActive, timestamps)
- Migration `035_add_units_table.sql` — creates units table + seeds default 4 units
- Backend `artifacts/api-server/src/routes/units.ts` — CRUD endpoints:
  - `GET /units` — returns active units (default) or all units (`?all=true`)
  - `POST /units` — create unit (admin only, unique name check)
  - `PATCH /units/:id` — update unit name/isActive (admin only)
  - `DELETE /units/:id` — hard delete unit (admin only)
- Route registered in `artifacts/api-server/src/routes/index.ts`
- Frontend hooks:
  - `artifacts/crm/src/lib/use-active-units.ts` — `useActiveUnits()` (active units for dropdowns) + `useAllUnits()` (admin management)
  - `artifacts/crm/src/lib/use-user-units.ts` — updated to use `useActiveUnits()` instead of hardcoded array
- Settings page: "Manage Units" admin section with add/toggle/delete UI + unit dropdown in user form now dynamic
- All 12+ frontend files refactored to use `useActiveUnits()`:
  - `lead-form.tsx`, `dashboard.tsx`, `deals.tsx`, `deal-detail.tsx`, `follow-ups.tsx`, `import.tsx`, `reports.tsx`, `leads.tsx`, `categories.tsx`, `transport-logistics.tsx`, `transport-logistics-readonly.tsx`
  - `use-user-units.ts` (used by production-dashboard, production-orders, machine-report)
- Legacy `UNITS` constant in `@/lib/units` marked as deprecated but kept for backward compat

## Key Decisions
- `useActiveUnits()` hook fetches from `/api/units` with 5-min stale time — minimal network overhead.
- Production unit dropdowns filter out "Not Sure" via `.filter(u => u !== "Not Sure")`.
- User form unit dropdown prepends "All" option: `["All", ...activeUnits]`.
- `useUserUnits()` now derives its list from `useActiveUnits()` instead of a static array.
- Unit names stored as plain `text` in all tables — no enum constraints at DB level.

## Relevant Files
- `lib/db/src/schema/units.ts`: Drizzle ORM table schema
- `lib/db/migrations/035_add_units_table.sql`: migration + seed
- `artifacts/api-server/src/routes/units.ts`: CRUD API
- `artifacts/crm/src/lib/use-active-units.ts`: React Query hooks for units
- `artifacts/crm/src/lib/use-user-units.ts`: updated user units hook
- `artifacts/crm/src/lib/units.ts`: legacy (deprecated)
- `artifacts/crm/src/pages/settings.tsx`: Manage Units admin UI + dynamic user form dropdown
- All frontend pages with unit dropdowns (see Progress section above)

---

# Part 4: Customer Lifecycle & Security

## Goal
- Order Cancellation with mandatory reason, permission matrix, and cascading updates
- Enhanced Complaint Module with permission enforcement, search, audit trail
- Inventory Permissions (inventory role manages, others read-only)
- Unit Security (backend enforcement of unit-level data isolation)
- Report Security (unit-aware dashboard, reports, exports)
- Global Search expansion (8 entity types)
- Automatic Activity Logging and Audit Trail for all business events

## Constraints & Preferences
- Do NOT modify Production Workflow
- Do NOT redesign UI
- Do NOT duplicate business logic — reuse shared services
- Every business event must remain traceable
- Never delete historical customer information
- Never remove complaints or cancelled orders
- Cancellation reason is mandatory

## Progress
### Done
- **DB Schema (migration 041):** Added `cancelled_at`, `cancelled_by`, `cancellation_reason`, `cancellation_other_reason`, `cancellation_note` to orders; added `root_cause`, `resolved_by`, `resolved_at` to complaints; indexes
- **Order Cancellation Service** (`order-cancellation-service.ts`): Full business logic — permission matrix (Sales before production, Production before Machine Running, P&S anytime, Admin anytime, Completed=blocked), mandatory reason validation, cascading updates (order → deal → production → activities → notifications → audit trail → customer category), Scenario A/B for My Client revert
- **Cancel Endpoint** (`POST /orders/:id/cancel`): Route with permission + reason validation
- **Complaint Route Enhanced**: Enhanced search (company, secondary mobile via contacts join), priority filter, production read-only enforcement, inventory blocked from mutations, audit trail on create/update/delete, rootCause/resolvedBy/resolvedAt handling
- **Permission Service Extended**: `canManageInventory()`, `canCancelOrder()`, `canManageComplaints()`, `canAccessUnit()` + `unit` added to `PermissionUser` interface
- **Global Search Expanded**: Now searches 8 entity types (contacts, orders, products, complaints, deals, production orders via PI join, proforma invoices, activities)
- **Activity Logger Extended**: Added `ORDER_ACTIVITY_TYPES` and `COMPLAINT_ACTIVITY_TYPES` constants

### In Progress
- (none)

### Blocked
- Migration 041 must be applied against Supabase database before deployment

## Key Decisions
- Cancellation uses `POST /orders/:id/cancel` (not PATCH) — cancellation is a distinct action, not a simple status update
- Production order cancellation queries via `dealId` link (production_orders.dealId → deals.id)
- Complaint search joins contacts table for company + secondary mobile (not duplicated on complaints)
- Inventory users get read-only access enforced at route level (not just frontend)
- `canAccessUnit()` added to permission service for backend unit isolation enforcement
- "Other" cancellation reason requires free text (validated server-side)

## Relevant Files
- `lib/db/src/schema/orders.ts`: CANCELLATION_REASONS constant + cancellation columns
- `lib/db/src/schema/complaints.ts`: rootCause, resolvedBy, resolvedAt columns
- `lib/db/migrations/041_order_cancellation_and_complaint_enhancements.sql`: migration
- `artifacts/api-server/src/lib/order-cancellation-service.ts`: cancellation business logic
- `artifacts/api-server/src/lib/permission-service.ts`: extended with inventory/unit/complaint permissions
- `artifacts/api-server/src/lib/activity-logger.ts`: ORDER_ACTIVITY_TYPES + COMPLAINT_ACTIVITY_TYPES
- `artifacts/api-server/src/routes/orders.ts`: cancel endpoint
- `artifacts/api-server/src/routes/complaints.ts`: enhanced CRUD with permissions + audit
- `artifacts/api-server/src/routes/search.ts`: expanded 8-entity search

---

# Part 6: Security & Performance Hardening

## Goal
- Apply unit security to all export endpoints (9/10 were missing it)
- Exclude soft-deleted orders from all export queries
- Activate complaints unit filter
- Add Lost Value KPI card to dashboard
- Add role-based filtering to global search (deals, activities)
- Fix notification dedup for notifications without relatedId
- Clean up dead code

## Progress
### Done
- **Export unit security**: Added `getAccessibleUnits()` to all 9 remaining export endpoints (reports, deals, activities, existing-customers, production, dispatch, complaints, orders, leads)
- **Soft-deleted order exclusion**: Added `eq(ordersTable.isDeleted, false)` to contacts and existing-customers export order queries
- **Complaints unit filter**: Activated `getAccessibleUnits()` in complaints list via SQL subquery on contacts table
- **Dashboard Lost Value card**: Added `totalLostValue` to backend KPI + sales performance endpoints; added Lost Value card to dashboard with red styling; grid changed to 5 columns
- **Search role filtering**: Added `salesOwnerId` filter for sales users + `getAccessibleUnits()` unit filter to deals and activities search
- **Notification dedup**: Extended `createNotification()` to deduplicate by `userId + type + title` when `relatedId`/`relatedType` not provided
- **Dead code cleanup**: Removed unused `or` import from exports.ts
- **By-Product report rewrite**: `GET /reports/by-product` now runs a single SQL aggregation with `COUNT(DISTINCT deal_id)`, `SUM(quantity)`, `SUM(quantity * COALESCE(unit_price,0))`, `COALESCE` guards, role-based `salesOwnerId` filtering, and unit isolation. **Root cause of empty table**: the `deal_products` table had 0 rows — product data actually lives in `proforma_invoice_items` (linked to deals via `proforma_invoices.deal_id`). The query now aggregates a `UNION ALL` of both sources (`deal_products` + PI items), with `btrim()` name normalization. Response contract unchanged (`productName`, `productCode`, `dealCount`, `totalQuantity`, `totalValue`). Frontend table added an explicit empty state + product-name-based row key (productId can be null for unlinked PI items).
- **Build verification**: 0 new errors (28 pre-existing), CRM clean

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Export unit filtering uses different strategies per entity: contacts/leads/deals use `contactsTable.unit`, orders/dispatch/production use `productionOrdersTable.productionUnit`, complaints use subquery on contacts
- Dashboard Lost Value uses `totalValue` (not `wonAmount`) consistent with reports.ts FIX 2
- Search deals/activities filtering fetches allowed contactIds from contacts table to filter via `inArray`, avoiding additional SQL joins
- Notification dedup fallback uses `title` as secondary key when no `relatedId`/`relatedType`

## Relevant Files
- `artifacts/api-server/src/routes/exports.ts`: 9 endpoints secured with unit filtering + 2 endpoints with soft-delete exclusion
- `artifacts/api-server/src/routes/complaints.ts`: unit filter activated via SQL subquery
- `artifacts/api-server/src/routes/search.ts`: role+unit filtering for deals and activities
- `artifacts/api-server/src/routes/dashboard.ts`: `totalLostValue` added to KPI and sales performance
- `artifacts/api-server/src/routes/notifications.ts`: dedup extended for notifications without relatedId
- `artifacts/crm/src/pages/dashboard.tsx`: Lost Value card + 5-column grid
- `docs/verification/part-6-verification.md`: full verification report

---

# Supabase Cloud Storage Migration

## Goal
- Fix "This voice note is unavailable" error caused by Render.com's ephemeral filesystem losing uploaded files on every deploy/restart.
- Migrate all file storage (voice notes, documents, builty/proof-of-delivery) from local filesystem to Supabase Storage (persistent cloud storage).

## Constraints & Preferences
- Zero frontend changes required — URL format is transparent to the player/viewer.
- Local development must continue working (fallback to local filesystem when Supabase env vars are absent).
- No new npm packages — uses native `fetch` for Supabase Storage REST API.
- Auto-create storage buckets on first use (lazy initialization).

## Progress
### Done
- **Root cause identified**: Render.com ephemeral filesystem — files saved to `uploads/` are lost on every deploy/restart. DB shows voice note with `storagePath` but `fs.existsSync` returns `false`.
- **`SUPABASE_URL` + `SUPABASE_KEY` added to `.env`** (all 3 env files).
- **`storage.ts` rewritten**: Added `SupabaseStorageProvider` class implementing `StorageProvider` interface using Supabase Storage REST API via native `fetch`. Added `exists()` method to interface. Auto-selects provider: Supabase when env vars present, local filesystem otherwise.
- **`voice-notes-service.ts` updated**: All `fs.existsSync(storage.getPhysicalPath(...))` calls replaced with `storage.exists()` (async, provider-agnostic).
- **`voice-notes.ts` routes updated**: Download endpoint redirects to Supabase public URL for cloud storage, serves local file for dev. Replace endpoint uses `storage.delete()` instead of `fs.promises.unlink`.
- **`documents.ts` routes updated**: Download and preview endpoints use `storage.exists()` + redirect to Supabase public URL.
- **`dispatch.ts` updated**: Builty upload URL now uses `storage.getUrl()` instead of hardcoded `/uploads/builty/` path.
- **Bucket auto-creation**: `SupabaseStorageProvider.ensureBucket()` creates storage buckets (public, 10MB limit) on first use.
- **Build verified**: 0 new TypeScript errors (CRM clean, API server pre-existing only).

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- `StorageProvider` interface extended with `exists(storagePath): Promise<boolean>` — replaces synchronous `fs.existsSync` calls.
- Supabase Storage buckets are **public** — URLs are `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}`.
- Download endpoints redirect to Supabase public URL (no proxy needed for public buckets).
- Bucket lazy-creation on first `save()` call — no startup initialization required.
- Old voice notes with `fileAvailable: false` in DB will stay unavailable (files lost on Render). Newly uploaded notes will persist in Supabase.

## Relevant Files
- `artifacts/api-server/src/lib/storage.ts`: `SupabaseStorageProvider` class + `LocalStorageProvider` + auto-selection
- `artifacts/api-server/src/lib/voice-notes-service.ts`: `getVoiceNotes()` uses `storage.exists()` instead of `fs.existsSync`
- `artifacts/api-server/src/routes/voice-notes.ts`: download/replace use provider methods
- `artifacts/api-server/src/routes/documents.ts`: download/preview use provider methods
- `artifacts/api-server/src/routes/dispatch.ts`: builty URL uses `storage.getUrl()`
- `.env`, `artifacts/api-server/.env`, `artifacts/crm/.env`: `SUPABASE_URL` + `SUPABASE_KEY`

---

# Production Daily Excel Sheet Management System

## Goal
- Production manager generates a daily Excel sheet from all production orders (or filtered subset), with one product per row.
- Automatic flag when PI items are modified after sheet generation, requiring a reprint.
- Dashboard widget showing orders needing updated sheets.

## Constraints & Preferences
- Excel generated server-side using ExcelJS via existing `buildWorkbook` + `sendWorkbook` from `lib/exporter.ts`.
- One product = one row (flatten PI items into rows).
- Blank operator section for production manager to fill manually.
- No data modifications — just marking rows with status.
- Download flow similar to existing export pattern: dropdown menu, blob download.
- `needsReprint` auto-set when PI items are modified via `handlePiModification`.
- Reprint flag cleared on each fresh download.

## Progress
### Done
- **DB Migration 056** (`056_add_production_sheet_tracking.sql`): Adds `production_sheet_generated_at`, `production_sheet_generated_by`, `production_sheet_version`, `needs_reprint` columns to `production_orders` table with indexes.
- **Schema** (`production_orders.ts`): Added 4 new columns — `productionSheetGeneratedAt`, `productionSheetGeneratedBy`, `productionSheetVersion` (int, default 0), `needsReprint` (boolean, default false).
- **Backend `GET /production/sheet`** endpoint in `production.ts`: Generates Excel with filter modes (all/pending/today/week/month/reprint/selected/date-range/new). One product = one row with order info + product info + blank operator section. Updates tracking fields after download.
- **Backend `GET /production/sheet/stats`** endpoint: Returns counts for dashboard widget (totalPending, needsReprint, neverGenerated, outdated).
- **Backend `POST /production/orders/:id/mark-reprint`** endpoint: Toggles `needsReprint` flag on an order.
- **Auto-set `needsReprint` + strict PI→production sync**: `handlePiModification` in `production-service.ts` now ALWAYS runs `resyncProductionOrderItems` regardless of the linked production order's status (inserting new PI items into `production_order_items`, updating matched rows, removing leftover Pending-only rows). If new items were added (`syncResult.added > 0`), the order is unconditionally reverted to `Pending` and all workflow progress flags are reset (`isFrozen`, `dispatchStatus`, `readyAt`, started/accepted/packing/transport/dispatch/delivered fields, `isDelayed`), so the production team sees the new work. Previously the sync was gated by status — pre-production (Pending/Accepted/Planning) auto-synced, in-production required approval, Ready For Dispatch / later statuses never inserted new items (the bug).
- **Separate `isUpdated` flag for the amber "Updated Order" dot** (migration `076_add_production_order_is_updated.sql`): the amber dot is driven by `is_updated` (set `true` in `handlePiModification` on every PI modification; cleared `false` by `POST /production/orders/:id/read`), independent of `needs_reprint` — so viewing an order clears the dot without losing the "Updated Production Sheet Required" reminder / reprint filter, and the Blue dot (`status = 'Pending' && !isRead`) and Amber dot (`isUpdated`) follow identical view-clearing behavior.
- **Frontend `production-orders.tsx`**: Added "Production Sheet" dropdown with 7 download options (All Pending, Pre-Production, Created Today, This Week, This Month, Updated/Reprint, Current Filter). Added `needsReprint` badge on each order row. Added sheet stats summary in header.
- **Frontend `production-dashboard.tsx`**: Added "Updated Production Sheet Required" widget card with amber styling, showing needsReprint + neverGenerated counts, with "Reprint Updated" and "Full Sheet" download buttons.
- **Build verified**: CRM clean (0 errors), API server pre-existing Drizzle errors only (zero new errors).

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- `needsReprint` auto-set in `handlePiModification` on every PI modification; the order is reverted to `Pending` (progress flags reset) whenever new items are added — regardless of the order's prior status.
- Filter mode `reprint` queries orders where `needsReprint = true OR productionSheetVersion = 0` (never generated).
- Excel uses `buildWorkbook`/`sendWorkbook` from existing `lib/exporter.ts` for consistency.
- After download, all orders in the result set get `needsReprint = false` and `productionSheetVersion` incremented.
- Dashboard widget only shows when there are orders needing attention (needsReprint > 0 or neverGenerated > 0).

## Relevant Files
- `lib/db/migrations/056_add_production_sheet_tracking.sql`: Migration for production sheet tracking columns
- `lib/db/migrations/076_add_production_order_is_updated.sql`: Migration for the `is_updated` amber-dot column (backfills from `needs_reprint`)
- `lib/db/src/schema/production_orders.ts`: Updated with `productionSheetGeneratedAt`, `productionSheetGeneratedBy`, `productionSheetVersion`, `needsReprint`, `isRead`, `isUpdated`
- `artifacts/api-server/src/routes/production.ts`: New endpoints — `GET /production/sheet`, `GET /production/sheet/stats`, `POST /production/orders/:id/mark-reprint`
- `artifacts/api-server/src/lib/production-service.ts`: `handlePiModification` — auto-sets `needsReprint` on PI modification
- `artifacts/api-server/src/lib/exporter.ts`: `buildWorkbook`, `sendWorkbook` — Excel generation utilities
- `artifacts/crm/src/pages/production-orders.tsx`: Production Sheet dropdown + needsReprint badge
- `artifacts/crm/src/pages/production-dashboard.tsx`: Updated Production Sheet Required widget

---

# Bottle Colour, Builty Optional, Machine Report, Orphan PI Auto-creation

## Goal
- Fix the production pipeline so that bottle colour selected on the Proforma Invoice is stored explicitly and propagated through to the Production Dashboard, preventing random/invalid colours from appearing.
- Make Builty Number optional in Load Vehicle forms (only Transport Name mandatory).
- Refactor Machine-wise Production Report to show only active pipeline items (exclude completed/cancelled).
- Auto-create Contact + Deal (Won) + Sales Order when an orphan PI (no contact/deal) is converted to Order.

## Progress
### Done
- **Bottle Colour field:** Added `bottleColour` column to `proforma_invoice_items` schema + migration `064_add_bottle_colour_to_pi_items.sql`. Frontend PI form updated with Bottle Colour dropdown (populated from product search results + common colours), stored in submit payload and repeat-order copies. Backend POST/PATCH handlers store `bottleColour`. Sync functions `syncProductionOrderItems`/`resyncProductionOrderItems` prefer PI item's `bottleColour` over product fallback. Production sheet query reads from `proformaInvoiceItemsTable.bottleColour` directly.
- **Builty Number optional:** Removed validation from `dispatch.tsx:142-145` and `production-order-detail.tsx:316`. Label changed to "LR / Builty Number (Optional)". Button disabled only checks `transportName`.
- **Machine Report refactor:** Backend adds `notInArray` for Completed/Delivered/Cancelled, expanded status buckets (Pending+Accepted+Planning), dormant bucket items excluded from all calculations. Frontend — 4 summary cards (no "Completed"), updated STATUS_OPTIONS and statusColor map.
- **Orphan PI auto-creation:** When a PI with no `contactId` is converted to Order, the status handler now auto-creates: Contact (find-or-create by mobile), Won Deal (with `wonAmount`), Sales Order (Confirmed, linked to contact+deal, items copied with colour), and updates the PI's `contactId`/`dealId`. Downstream production order creation picks up the deal automatically.
- **Build verified:** 0 new TypeScript errors in API server (35 pre-existing), CRM clean.

### In Progress
- (none)

### Blocked
- (none)

## Relevant Files
- `artifacts/api-server/src/routes/proforma-invoices.ts`: Status change handler (orphan PI auto-creation + production order creation)
- `artifacts/api-server/src/lib/production-service.ts`: Machine report refactor, sync functions with bottle colour priority
- `artifacts/api-server/src/routes/production.ts:804`: Sheet query (uses PI item bottle colour)
- `artifacts/crm/src/pages/proforma-invoices.tsx`: Bottle Colour dropdown in PI form
- `artifacts/crm/src/pages/dispatch.tsx`: Builty optional in Load Vehicle dialog
- `artifacts/crm/src/pages/production-order-detail.tsx`: Builty optional in Load Vehicle dialog
- `artifacts/crm/src/pages/machine-report.tsx`: 4 summary cards, updated status colors

---

# Unread Dots, Repeat Enquiry Priority, Duplicate Modal on /leads/new

## Goal
- Dynamic unread dots in the Leads table + notifications: **Blue** = newly assigned lead, **Yellow** = repeat enquiry; notification text must clearly state "Repeat Enquiry".
- Fix bottom clipping on `/leads/new` (form cut off before "Create Lead" button).
- On `/leads/new`, catch the duplicate-mobile 409 and open the same "Customer Already Exists" modal as the Import page, passing existing-customer data.
- Repeat enquiries behave like new assignments: backend bumps the lead's `updated_at` to NOW(), Leads default sort = `updated_at` DESC so a repeat enquiry jumps to the top row.

## Progress
### Done
- **DB:** Added `updated_at` (`timestamptz`, `defaultNow`, index DESC) + `is_repeat_enquiry` (`boolean`, default false, indexed) columns to `contacts` (schema `lib/db/src/schema/contacts.ts`, migration `lib/db/migrations/067_add_lead_updated_at_and_repeat_flag.sql` — backfills existing rows with `created_at`).
- **Backend `contacts.ts`:**
  - `GET /contacts` sorts by `updatedAt DESC` in ALL branches (default, category, Existing Client, RFU + My-Client-with-active-deal virtual) so the most recently active lead is first.
  - `POST /contacts` now does an explicit duplicate **pre-check** (`findExistingContact`) returning the rich 409 payload via shared `buildDuplicatePayload()` helper — deterministic, independent of DB driver error codes; the `23505` catch is the safety net. Also sets `isRead: true` for self-assigned leads so only cross-owner assignments show the blue dot.
  - `POST /contacts/:id/repeat-enquiry` sets `category: "Regular Follow up"`, `updatedAt: new Date()`, `isRead: false`, `isRepeatEnquiry: true`; notification message now reads "Repeat Enquiry logged by: ...".
  - `POST /contacts/:id/read` clears both `isRead` and `isRepeatEnquiry`.
  - `PATCH /contacts/:id` reassignment clears `isRepeatEnquiry` alongside `isRead = false`.
- **Generated types:** `Contact` interface in `api-client-react` + `api-zod` gained `isRepeatEnquiry?` + `updatedAt?`.
- **Frontend:**
  - `leads.tsx`: unread dot is **yellow** (`isRepeatEnquiry`) or **blue** (new assignment); `markLeadAsRead` optimistically clears both flags.
  - `lead-detail.tsx`: mark-read effect also clears `isRepeatEnquiry`.
  - `layout.tsx` bell dropdown + `notifications.tsx`: unread dot color-coded by type (`repeat_enquiry` = yellow, else blue); `repeat_enquiry: "🔄"` added to `TYPE_ICONS`.
  - `notification-popup.tsx`: repeat-enquiry toasts get yellow accent + "Repeat Enquiry" label/footer.
  - `leads-new.tsx`: broader duplicate detection (`err?.status === 409 || err?.data?.duplicate === true` → opens `DuplicateWarningDialog`); added `min-h-full pb-24` to fix bottom clipping.
  - `lead-form.tsx`: `checkDuplicate` fetch now sends `Authorization: Bearer` header (was silently 401-ing, so on-blur duplicate detection never fired).
  - `duplicate-warning-dialog.tsx`: calls `onContactChange(queryClient)` after a successful repeat enquiry so the Leads list re-sorts + shows the yellow dot immediately.
- **Build verified:** CRM typecheck clean; API server back to 34 pre-existing errors (no new).

## Key Decisions
- `updated_at` bumped ONLY on repeat enquiry (per request) — general edits/comments/category changes do NOT reshuffle the Leads list.
- Duplicate pre-check makes the 409 → modal flow reliable even if the DB driver error code differs from `23505`.
- Migration must be applied (`067_add_lead_updated_at_and_repeat_flag.sql`) against the Supabase DB before deploy, else `updated_at`/`is_repeat_enquiry` columns are missing at runtime.

## Relevant Files
- `lib/db/src/schema/contacts.ts` + `lib/db/migrations/067_add_lead_updated_at_and_repeat_flag.sql`: new columns
- `artifacts/api-server/src/routes/contacts.ts`: sort, pre-check, repeat-enquiry/read/PATCH flags
- `artifacts/crm/src/pages/leads.tsx`, `lead-detail.tsx`, `leads-new.tsx`: dots, sort, duplicate modal + scroll fix
- `artifacts/crm/src/components/lead-form.tsx`, `duplicate-warning-dialog.tsx`, `layout.tsx`, `notification-popup.tsx`: auth header fix, invalidation, notification dots/styling
- `artifacts/crm/src/pages/notifications.tsx`: color-coded unread dots + `repeat_enquiry` icon

---

# Production Order Chat — Conversation Threading & Order Context

## Goal
- Stop production_message notifications from spamming the Notification History with one row per message.
- Group all messages from the same order/conversation into a single thread (with "N messages" count) in both the Notification History page and the bell dropdown "New" section.
- Explicitly prefix the sender's role + name in the notification header/preview (e.g. `[Production] Shakir: ...`).
- Show Company Name + Order Number in every chat surface header (notification modal, sales order page, production order page, lead page) without extra API calls.
- Backend 403-enforcement + input sanitization on the send-message endpoint.

## Progress
### Done
- **Backend `production-service.ts`:**
  - `getMessages(orderId)` now returns an enriched object `{ orderId, orderNumber, companyName, customerName, messages }` (was a bare array). It looks up the production order + its proforma invoice (`tradeName` → companyName) so all chat surfaces get context from ONE call. Consumers updated in all 4 frontend surfaces.
  - `sendMessage` notification body is now role-tagged: `[${senderDept}] ${user.name}: ${message}` (dept = Admin/Production/Support/Sales).
  - `buildContactResponse` (by-contact) now also returns `companyName` (PI tradeName).
- **Frontend chat consumers updated** to read `data.messages` and render `Company Name (Order #)` in headers:
  - `notification-side-panel.tsx` (ChatPanel modal)
  - `order-detail-global.tsx` (Sales order chat card)
  - `production-order-detail.tsx` (Production order chat card)
  - `lead-detail.tsx` (Lead 360 Order Conversation card)
- **UI conversation grouping (`notification-context.tsx`):**
  - `getConversationKey(n)` derives a group key from the notification's role-aware link (`production:<poId>` for production/support, `orders:<salesOrderId>` for sales) — each workspace groups by its own order id; no DB schema change.
  - `groupConversations(list)` collapses `production_message` notifications into one representative per thread (the NEWEST message), keeps all other notification types untouched, and returns newest-first. Exported.
  - `conversationMessageCount(list, representative)` returns how many messages are in a thread.
  - NOTE: Per-message notification ROWS are kept in the DB (needed for per-message toast popups + sounds via the existing `popupShownRef` dedup by id). Grouping is purely presentational.
- **Notification History page (`notifications.tsx`):** filters → groups conversations → paginates; conversation rows show a violet "N messages in this conversation" badge; clicking a row still navigates to the order (pre-existing behavior).
- **Bell dropdown (`layout.tsx`):** "New" section now renders `groupedUnread` (unread + grouped) so a conversation shows one row; empty-state condition updated.
- **Build verified:** CRM typecheck = 0 errors; API server = 32 errors (within the known 34-35 pre-existing baseline, 0 new).

## Key Decisions
- Grouping is UI-side, not DB-side: updating one notification row per conversation would break the existing popup/sound dedup (`popupShownRef` keyed by notification id → subsequent messages in the same thread would never toast). Keeping one row per message preserves per-message toasts while the UI collapses them into a single thread.
- Group key derived from `link` (already role-aware) rather than adding an `orderId` column — works for both sales (`/orders/:salesOrderId`) and production (`/production/orders/:poId`) workspaces with zero migration.
- `getMessages` enrichment keeps a single source of truth for the chat header (company + order number) across all 4 surfaces.
- Message body prefix `[Role] Name:` satisfies the "explicit sender role in notification preview" requirement without touching notification title semantics.

## Relevant Files
- `artifacts/api-server/src/lib/production-service.ts`: `getMessages` enrichment, role-tagged `sendMessage`, `buildContactResponse.companyName`
- `artifacts/api-server/src/routes/production.ts`: GET/POST `/production/orders/:id/messages` (unchanged routes, pass through)
- `artifacts/crm/src/lib/notification-context.tsx`: `getConversationKey`, `groupConversations`, `conversationMessageCount`
- `artifacts/crm/src/pages/notifications.tsx`: history grouping + message count badge
- `artifacts/crm/src/components/layout.tsx`: bell dropdown grouping (`groupedUnread`)
- `artifacts/crm/src/components/notification-side-panel.tsx`: ChatPanel header uses company/orderNumber
- `artifacts/crm/src/pages/order-detail-global.tsx`, `production-order-detail.tsx`, `lead-detail.tsx`: chat cards use enriched messages response + header context

---

# Create Proforma Invoice — URL Param Hydration + Mobile Search Fix

## Goal
- When navigating from an existing Deal (`?contactId=XX&dealId=YY`), the Create Proforma Invoice page must auto-fetch the deal and populate the form (Mobile Number + selected deal) with NO manual mobile search.
- Fix the backend mobile-number search so formatted numbers (`+91 98765 43210`, `98765-43210`, `09876543210`) match reliably instead of returning "No active Deal found."

## Progress
### Done
- **Backend `deals.ts` (`GET /deals/by-mobile/:mobile`):**
  - Added `normalizeMobile(input)` — strips non-digits and keeps the last 10 digits as the canonical form.
  - Phase 1 contact lookup now matches the NORMALIZED number on both `mobile` and `otherPhone` using SQL `right(regexp_replace(col, '[^0-9]', '', 'g'), 10) = ${mobile}` — the same transformation applied to the input — so a match succeeds regardless of stored formatting.
  - Phase 2 deal query rewritten to `LEFT JOIN` contacts (`eq(dealsTable.contactId, contactsTable.id)`) so deal rows carry their contact payload in one query; response shape `{ contacts, deals }` unchanged (full deal rows + `contact`, `salesOwner`, `activeProformaInvoice`).
  - Active-stage filter unchanged (`stage NOT IN ('Won','Lost')`) — covers New, CL Sent, Price Given, Samples Sent, Samples Received, PI Sent.
  - Role isolation + unit accessibility preserved.
- **Frontend `proforma-invoices.tsx`:**
  - New `hydratedFromUrlRef` gates the debounced mobile-search effect.
  - Hydration `useEffect` (runs when URL has `dealId`/`contactId`): fetches `GET /deals/:id`, sets `selectedDeal` + `activeDeals=[deal]`, populates `selectedLead` + the Mobile Number input from `deal.contact.mobile`, and loads GST profiles + previous PIs via `loadCustomerGstProfile`.
  - Deal hydration owns the deal selection (gate ON) so the auto-search can't overwrite it; contact-only hydration (`?contactId=X`, e.g. lead-detail) leaves the gate OFF so the debounced mobile search auto-attaches the active deal after mobile is filled.
  - Gate cleared in `resetForm()`, on manual mobile input edit, and when no URL params present.
- **Frontend `deal-detail.tsx`:** "Create" Proforma Invoice link now includes `dealId` (`?contactId=X&dealId=Y`) so the deal is carried into the page.
- **Build verified:** CRM typecheck = 0 errors; API server = 32 errors (pre-existing baseline, 0 new).

## Key Decisions
- Canonical mobile form = last 10 digits, applied identically in JS (`normalizeMobile`) and SQL (`right(regexp_replace(...), 10)`), so input and DB column always compare like-for-like.
- Response contract preserved — the LEFT JOIN only replaces the two separate deal/contact lookups, the payload `{ contacts, deals: enrichedDeals }` is byte-for-byte compatible.
- Gate is ref-based (not state) to avoid extra re-renders; only `?dealId=` hydration engages it so the existing lead-detail (`?contactId=X`) flow keeps working.

## Relevant Files
- `artifacts/api-server/src/routes/deals.ts`: `normalizeMobile` + rewritten `GET /deals/by-mobile/:mobile` (normalized SQL match + LEFT JOIN)
- `artifacts/crm/src/pages/proforma-invoices.tsx`: `hydratedFromUrlRef`, hydration `useEffect`, debounced-search gate, `resetForm` + mobile-input gate clears
- `artifacts/crm/src/pages/deal-detail.tsx`: Create PI link now passes `dealId`

---

# Global Search by Customer Code + Order Number (Completed Audit)

## Goal
Every search bar in the CRM that filters Contacts/Leads must match by `customerCode`, and every search bar for Orders/Proformas must match by order number (`formattedOrderId`/`orderNumber`/`orderNo`/`invoiceNumber`). Previously the Categories page search by Customer Code (e.g. `EML_20`) silently failed.

## Progress
### Done
- **Categories page (`categories.tsx`):** frontend `filteredContacts` filter now includes `c.customerCode?.toLowerCase().includes(s)`; placeholder → "Search by name, code, company, phone, city...".
- **Follow-ups page (`follow-ups.tsx`):** frontend search filter now also matches `a.contact?.customerCode` / `a.deal?.contact?.customerCode`; placeholder → "Search by name, code, phone, company...".
- **Production Orders (`production-service.ts` `listOrders`):** search now additionally matches the production order's own `formattedOrderId` (PO number) and the linked Sales Order number (`orders.formattedOrderId`/`orderNumber` via `orders.dealId` → `productionOrders.dealId`, `isDeleted=false`). It already matched customer code, invoice number, product name, transport, LR, PO id.
- **Placeholders updated:** `leads.tsx` ("Search by name, code, company, phone..."), `existing-customers.tsx` ("Search by name, code, company, mobile..."), `orders-list.tsx` ("Search by order #, code, customer, company..."), `production-orders.tsx` ("Search by order #, code, company, invoice..."), `proforma-invoices.tsx` ("Search by order #, invoice #, code, customer...").
- **Verified already covered (no change needed):** backend `GET /contacts?search=` includes `ilike(contactsTable.customerCode, s)` (contacts.ts:145); `orders.ts` `/orders` + `/orders/global` search includes `orderNumber` + `formattedOrderId` + customer-code subquery; `proforma-invoices.tsx` frontend filter already matches `inv.orderNo` + `inv.contact.customerCode` + `inv.invoiceNumber`; `existing-customers.ts` backend search includes `customerCode` + `lastOrder.orderNumber`; `search.ts` global search covers customer code, order number, PO number, invoice number. `dashboard.tsx`/`deals.tsx` have no text search bar (date/stage/owner filters only).
- **Build verified:** CRM typecheck = 0 errors; API server = 32 errors (pre-existing baseline, 0 new).

## Relevant Files
- `artifacts/crm/src/pages/categories.tsx`: code filter + placeholder
- `artifacts/crm/src/pages/follow-ups.tsx`: code filter + placeholder
- `artifacts/crm/src/pages/leads.tsx`, `existing-customers.tsx`, `orders-list.tsx`, `production-orders.tsx`, `proforma-invoices.tsx`: placeholders
- `artifacts/api-server/src/lib/production-service.ts`: `listOrders` search — PO number + linked Sales Order number

---

# Freight & Packing Lookup — Delete (Single + Clear All)

## Goal
Add delete functionality to the "Freight & Packing Lookup" page (`transport-logistics-readonly.tsx` — Transport Rates + Packing Quantities tabs): a "Clear All Records" bulk-delete button in the header and per-row single-delete action columns in both tabs. Restricted to `admin` and `support` roles on both frontend and backend.

## Constraints
- Uses a NEW delete role check (`admin` OR `support`) — does NOT reuse `EDIT_ROLES` (admin/production/production_and_support) for add/upload.
- Backend re-verifies the role before executing any SQL delete.

## Progress
### Done
- **Permission helper** (`permission-service.ts`): added `canDeleteTransportLookup(user)` = `admin` || `support`.
- **Backend `transport-masters.ts`:**
  - `DELETE /transport-masters/destinations/:id` role check changed from `admin` only → `canDeleteTransportLookup` (admin/support).
  - `DELETE /transport-masters/bundles/:id` role check changed from `admin` only → `canDeleteTransportLookup` (admin/support).
  - New `DELETE /transport-masters/clear-all` — deletes all rows in both `transportDestinationMasterTable` and `productBundleMasterTable` via `returning({ id })` to count deleted rows; writes audit logs (`transport_master` + `packing_master`, action `clear_all`); returns `{ success, deleted: { destinations, bundles } }`.
- **Frontend `transport-logistics-readonly.tsx`:**
  - Added `DELETE_ROLES = ["admin", "support"]` + `canDelete` flag (computed from `useGetMe`).
  - Header: destructive "Clear All Records" button (only when `canDelete`) with `window.confirm` confirmation; shows "Clearing..." while pending.
  - Transport Rates tab: "Actions" column with per-row trash button (`window.confirm` → `DELETE /transport-masters/destinations/:id`); colSpan adjusted (6→7) for loading/empty states when `canDelete`.
  - Packing Quantities tab: "Actions" column with per-row trash button (`window.confirm` → `DELETE /transport-masters/bundles/:id`); colSpan adjusted (4→5).
  - All three delete mutations invalidate the relevant React Query keys (`transport-lookup`, `product-bundles-lookup`) on success.
- **Build verified:** CRM typecheck = 0 errors; API server = 32 errors (pre-existing baseline, 0 new).

## Key Decisions
- Clear-all returns per-table deleted counts from `db.delete().returning()` (Drizzle returns an array — no `as any[]` cast needed).
- Deletion is a hard delete, matching the pre-existing single-row DELETE endpoints; audit logs record who cleared and how many rows.
- No DB migration required (no schema changes).

## Relevant Files
- `artifacts/crm/src/pages/transport-logistics-readonly.tsx`: Clear All button + per-row delete actions in both tabs
- `artifacts/api-server/src/routes/transport-masters.ts`: `DELETE .../destinations/:id`, `DELETE .../bundles/:id`, `DELETE /transport-masters/clear-all`
- `artifacts/api-server/src/lib/permission-service.ts`: `canDeleteTransportLookup`

---

# Packing Quantities — Merge TCI Bora + Normal Bora into single "Bora"

## Goal
Simplify the "Packing Quantities" data on the Freight & Packing Lookup page (and the `/masters` admin page): replace the two `TCI Bora` / `Normal Bora` columns with one `Bora` column across DB schema, migrations, API routes, Excel import mapping, and frontend UI.

## Scope
- Touches only `product_bundle_master` (packing quantities) — `bundle_size`, `liner_packing_qty`, `bora`.
- Does NOT touch `transport_destination_master.tci_bora` / `normal_bora` (transport RATE columns in ₹, migration 068) — those stay.
- Does NOT touch `order_items.tci_bora_qty` / `normal_bora_qty` (order-line snapshot columns from migration 042) — those stay.

## Progress
### Done
- **Schema** (`lib/db/src/schema/product_bundle_master.ts`): removed `tciBoraQty`/`normalBoraQty`, added `bora: integer("bora").notNull().default(0)`.
- **Migration `073_merge_bora_in_packing_master.sql`**: `ADD COLUMN bora`, backfills `bora = GREATEST(COALESCE(normal_bora_qty,0), COALESCE(tci_bora_qty,0))`, sets NOT NULL, drops the two old columns.
- **Backend `transport-masters.ts`:**
  - POST /bundles + PATCH /bundles/:id now accept/update `bora`.
  - Packing import preview validates `row.bora`; execute inserts `bora`.
  - Liner import upsert insert defaults `bora: 0`.
  - Bora import preview requires a `bora` quantity (single field); execute upserts `bora` only.
  - `/transport-masters/calculate` output now returns `bora` instead of `tciBoraQty`/`normalBoraQty`.
- **Frontend `transport-logistics-readonly.tsx`** (Freight & Packing Lookup):
  - `BundleForm`/`EMPTY_BUNDLE_FORM` → single `bora` string field.
  - `BORA_ALIASES`: `bora: ["bora qty", "bora quantity", "bora", "normal bora qty", "normal bora", "normal"]` (no TCI mapping).
  - Add Record dialog: grid `grid-cols-3`→`grid-cols-2` with `Liner Packing Qty` + `Bora Qty` inputs.
  - Packing Quantities table: single `Bora` `<th>`/`<td>` (`item.bora`); colSpan adjusted (4→3, 5→4 with Actions).
  - Import preview (bora parser): single `Bora` column.
- **Frontend `masters.tsx`** (admin `/masters` Packing tab): same changes — Bundle type, form, table header/cells (colSpan 7→6), import preview.
- **Build verified:** CRM typecheck = 0 errors; API server = 32 errors (pre-existing baseline, 0 new); `typecheck:libs` clean.

## Key Decisions
- Backfill uses `GREATEST(normal, tci)` so a product that historically had only TCI quantities keeps a non-zero value after the merge.
- Excel header "Bora" (or "normal bora") maps straight to the new `bora` column; TCI-only mapping removed.
- `order_items` snapshot columns intentionally kept (historical order records); only the packing master is simplified.

## Relevant Files
- `lib/db/src/schema/product_bundle_master.ts`: `bora` column replaces `tci_bora_qty`/`normal_bora_qty`
- `lib/db/migrations/073_merge_bora_in_packing_master.sql`: add/backfill/drop migration (must be applied before deploy)
- `artifacts/api-server/src/routes/transport-masters.ts`: CRUD + 3 import flows + calculate now use `bora`
- `artifacts/crm/src/pages/transport-logistics-readonly.tsx`: Packing Quantities UI + import mapping
- `artifacts/crm/src/pages/masters.tsx`: admin Packing tab UI + import mapping

---

# Order Cancellation Flow

## Goal
- Full order cancellation flow: mandatory reason + cascading updates (deal → Lost, production order → Cancelled, first-order category reversion), red "Cancelled" badges, "Cancel Order" buttons on the proforma/order detail + sales list, and a production-side acknowledge workflow so cancelled production orders drop off the default list only after being acknowledged.

## Constraints
- Cancellation reason is mandatory; "Other" requires free text (validated server-side).
- Completed orders cannot be cancelled (suggest Return Process).
- Production must acknowledge a cancellation before the cancelled order disappears from the default production list.
- Never delete historical data — everything is tracked via timeline, activity log, and audit trail.

## Progress
### Done
- **DB:** `cancellation_acknowledged` (boolean, default false, partial index on unacknowledged rows) on `production_orders` (schema `lib/db/src/schema/production_orders.ts`, migration `lib/db/migrations/075_add_cancellation_acknowledged.sql`).
- **Backend `order-cancellation-service.ts`:** single source of truth — `validateCancellationPermission` (permission matrix: Sales before production + must own, Production before "In Production", Production & Support anytime, Admin anytime, Completed blocked), `validateCancellationReason` (mandatory + whitelist + "Other" free text), `cancelOrder` cascade (order → Cancelled, timeline entry, linked PO → Cancelled + `cancellationAcknowledged: false`, Won deal → Lost, first-order Scenario A category reversion + `category_history` record + Existing Customers deactivated, audit trail, activity log, notifications). `POST /orders/:id/cancel` in `routes/orders.ts` delegates to it.
- **Backend production acknowledge:** `acknowledgeCancellation()` in `production-service.ts` (idempotent, requires status "Cancelled", writes timeline + activity + audit trail, returns enriched order); `POST /production/orders/:id/acknowledge-cancellation` in `routes/production.ts`. `listOrders` accepts `hideAcknowledgedCancellations` (default-active filter `status <> 'Cancelled' OR cancellation_acknowledged = false`; explicit status filter still shows full history). `production-service.ts` `cancelOrder` also resets the flag on the PO.
- **Frontend production-side:** `production-order-detail.tsx` — "Not Acknowledged" badge + red "OK / Acknowledge Cancellation" button + mutation; `production-orders.tsx` — "Unacknowledged" pill badge. (committed `61e2cb9`)
- **Frontend shared `CancelOrderModal`** (`artifacts/crm/src/components/cancel-order-modal.tsx`): reason dropdown (same `CANCELLATION_REASONS` list as backend), free text when "Other", optional note, amber reversion warning, submit via `POST /orders/:id/cancel` with `{ reason, otherReason, note }`, full React Query invalidation on success.
- **Sales-side Cancel placements:**
  - `order-detail-global.tsx`: destructive "Cancel Order" button in the header (hidden for Cancelled/Completed), inline broken dialog replaced with the shared modal. **Fixed body field bug** — the old dialog sent `cancellationReason`/`cancellationOtherReason` which the route ignores (it expects `reason`/`otherReason`), so cancels silently did nothing.
  - `orders-list.tsx`: "Cancel Order" button in the expanded row (hidden for Cancelled/Completed) wired to the shared modal.
  - `proforma-invoices.tsx`: "Cancel Order" icon in the list Actions column + destructive button in the detail header, both shown only when the PI has a linked sales order (`inv.orderId`). `enrichInvoice` now returns `orderId` alongside `orderNo`.
- **Build verified:** CRM typecheck = 0 errors; API server = 29 errors (pre-existing baseline, 0 new — none in `proforma-invoices.ts`).

## Key Decisions
- Shared `CancelOrderModal` is the single cancel UI across all surfaces; it owns invalidation (orders, order detail, timeline, dashboard, global-search, existing-customers, PI, production, deal, contact).
- Category reversion is handled server-side (Scenario A/B) — the modal only shows an informational warning, it does not take a category input.
- PI→order cancel requires the linked order `id`; added `orderId` to `enrichInvoice` (covers list + detail + `/all`) with the existing `orderNo` lookup, no extra API call.
- Cancel-from-PI is gated on `inv.orderId` existing (i.e., the PI has been converted to a sales order).

## Relevant Files
- `lib/db/src/schema/production_orders.ts` + `lib/db/migrations/075_add_cancellation_acknowledged.sql`: acknowledge column
- `artifacts/api-server/src/lib/order-cancellation-service.ts`: cancel business logic + permission/reason validation
- `artifacts/api-server/src/lib/production-service.ts`: `acknowledgeCancellation`, `cancelOrder` flag reset, `hideAcknowledgedCancellations` list filter
- `artifacts/api-server/src/routes/production.ts`: `POST /production/orders/:id/acknowledge-cancellation`
- `artifacts/api-server/src/routes/orders.ts` (~714): `POST /orders/:id/cancel`
- `artifacts/api-server/src/routes/proforma-invoices.ts`: `enrichInvoice` returns `orderId`
- `artifacts/crm/src/components/cancel-order-modal.tsx`: shared cancel modal
- `artifacts/crm/src/pages/order-detail-global.tsx`, `orders-list.tsx`, `proforma-invoices.tsx`: Cancel buttons
- `artifacts/crm/src/pages/production-order-detail.tsx`, `production-orders.tsx`: acknowledge button/pill + unacknowledged filter

---

# Per-User Read/Unread State (Read Isolation)

## Goal
- Replace the single GLOBAL `isRead` / `isUpdated` booleans with per-user read tracking, so one user (e.g. an Admin) opening a lead, order chat, or production order no longer clears the unread indicator for everyone else (blue dot for leads, blue "new order" dot + amber "updated order" dot for production orders, green chat icon for orders).
- Each user sees their OWN unread dots; User B still sees a dot until User B explicitly opens the item.

## Progress
### Done
- **DB migration `078_add_per_user_read_tracking.sql`:** adds `contacts.read_by`, `production_orders.read_by`, `production_orders.updated_read_by` (`INTEGER[] NOT NULL DEFAULT '{}'`) + indexes. Backfills: rows already globally read (`is_read = true` / `is_updated = false`) get the array filled with all current users (stays hidden); unread rows keep `'{}'` so every user sees the dot until each reads it. Legacy `is_read` / `is_updated` / `is_repeat_enquiry` columns are KEPT for backward compatibility.
- **Schema (`lib/db/src/schema/contacts.ts`, `production_orders.ts`):** `readBy` / `updatedReadBy` array columns added alongside the legacy booleans.
- **Backend `contacts.ts` — per-user read logic:**
  - `appendReadBy(userId)` / `removeReadBy(userId)` SQL helpers (unnest + UNION dedup) mutate ONLY the requesting user's entry.
  - `POST /contacts/:id/read`, `PATCH /contacts/:id/read-status`, `POST /contacts/mark-all-read` now append/remove `req.user.id` instead of flipping the global flag; `mark-all-read` scopes to `NOT ($userId = ANY(read_by))`.
  - `withOwner()` + the `GET /contacts` list compute `isRead = readBy.includes(user.id)` and `isRepeatEnquiry = isRepeatEnquiry && !isRead` per request.
  - Repeat enquiry (`POST /contacts/:id/repeat-enquiry`) clears `readBy = []` (yellow dot for every user until each reads); lead reassignment clears `readBy = []` so only the NEW owner sees the blue dot; self-assigned leads get `readBy = [user.id]`.
- **Backend `production.ts` + `production-service.ts` — per-user read logic:**
  - `appendReadByUser` / `appendUpdatedReadByUser` SQL helpers added to `production.ts`.
  - `POST /production/orders/:id/read` appends the requesting user to `read_by` and `updated_read_by` (clears their blue + amber dots only).
  - `enrichProductionOrder()` computes `isRead = readBy.includes(user.id)` and `isUpdated = is_updated && !updatedReadBy.includes(user.id)` per request (used by list + detail + dashboard + reports).
  - `handlePiModification` resets `updatedReadBy = []` so the amber "updated" dot shows for every production user until each opens the order.
- **Orders green chat icon (`hasUnreadMessages`):** already per-user — derived from the `notifications` table (`userId = user.id AND readAt IS NULL` for `production_message` / `voice_note` links). `getUnreadChatLinks(userId)` in `orders.ts` + `listOrders` in `production-service.ts` filter by the requesting user. Chat panels (`order-detail-global.tsx`, `production-order-detail.tsx`) mark only the current user's notifications read. **No `orders` DB change was needed.**
- **Frontend (no changes required):** `leads.tsx`, `lead-detail.tsx`, `production-orders.tsx`, `production-order-detail.tsx`, `orders-list.tsx` already consume the computed `isRead` / `isUpdated` / `hasUnreadMessages` flags; mark-read actions go through the per-user endpoints.
- **Fixes applied during completion:**
  - `production.ts` was missing the `appendReadByUser` / `appendUpdatedReadByUser` helpers referenced by `POST /production/orders/:id/read` — added.
  - `GET /contacts/:id` referenced an undefined `user` variable — changed to `access.user`.
  - Rebuilt `@workspace/db` libs (`tsc --build`) — the stale `dist` still had `updateReadBy` instead of `updatedReadBy`, producing false type errors.
- **Build verified:** CRM typecheck = 0 errors; API server = 27 errors (pre-existing baseline, 0 new).
- **Persistence bug fix (read dots resurrecting after login):** the per-user commit `71ff343` landed Aug 12, but reads made by the still-running OLD build after migration 078's one-time backfill wrote ONLY `is_read = true` and left `read_by = '{}'`. The new `GET /contacts` / `withOwner` logic computed `isRead = readBy.includes(user.id)` and ignored the legacy flag, so every such lead showed a blue dot again next session. Fixes:
  - `contacts.ts` list + `withOwner()` now compute `isRead = readBy.includes(user.id) || (is_read === true && readBy.length === 0)` — legacy globally-read rows with no per-user data count as read for everyone, while per-user arrays keep winning once present.
  - Migration `079_rebackfill_legacy_read_by.sql` re-runs the idempotent 078 backfill (`read_by = ARRAY(SELECT id FROM users)` where `read_by='{}' AND is_read=true`). Applied directly against the live DB on 2026-08-13 (14 rows fixed).

## Key Decisions
- `read_by` arrays (not dynamic notification derivation) chosen for leads + production orders because those dots are NOT backed by notification rows — they track "has this user opened this item".
- Legacy `is_read` / `is_updated` columns stay for backward compat with exports and any code not yet migrated; the CRM UI only reads the per-user computed values.
- Backfill keeps existing behaviour: globally-read rows stay invisible to everyone, unread rows stay visible to everyone until each user reads.
- Production order creation defaults `readBy = []` so every production user sees the blue "new order" dot until each opens it; the old owner's read state is discarded on reassignment.
- Orders green icon already per-user (notification-based); no schema change.

## Relevant Files
- `lib/db/migrations/078_add_per_user_read_tracking.sql`: migration (must be applied before deploy)
- `lib/db/migrations/079_rebackfill_legacy_read_by.sql`: re-runs 078's backfill (catches legacy is_read=true rows read after 078 ran)
- `lib/db/src/schema/contacts.ts`, `lib/db/src/schema/production_orders.ts`: `readBy` / `updatedReadBy` columns
- `artifacts/api-server/src/routes/contacts.ts`: per-user read/read-status/mark-all-read + list/detail `isRead` computation
- `artifacts/api-server/src/routes/production.ts`: `appendReadByUser`/`appendUpdatedReadByUser` + per-user `POST /read`
- `artifacts/api-server/src/lib/production-service.ts`: `enrichProductionOrder` per-user `isRead`/`isUpdated`; `handlePiModification` resets `updatedReadBy`; `listOrders` per-user chat unread
- `artifacts/api-server/src/routes/orders.ts`: `getUnreadChatLinks` per-user green icon
- `artifacts/crm/src/pages/leads.tsx`, `lead-detail.tsx`, `production-orders.tsx`, `production-order-detail.tsx`, `orders-list.tsx`: consume per-user flags (no changes required)

---

# Sales Order Items Sync (`order_items`) — PI Edit Parity

## Goal
- When a Converted Proforma Invoice is edited (items added/removed/changed), the Sales Order detail page (`order-detail-global.tsx`) must show EXACTLY the same items as the PI — `order_items` was never updated on PI edits, so new products reached the PI and `production_order_items` but stayed missing from the Sales Order.

## Progress
### Done
- **New helper `syncOrderItemsFromPi(piId, dealId, txDb)` in `production-service.ts`:**
  - Finds the linked Sales Order via `ordersTable.dealId` (repeat orders are created with `dealId = null`, so this resolves to the conversion order), excludes soft-deleted orders.
  - **DELETE** all existing `order_items` rows for the order, then **INSERT** the current PI items field-for-field (`productId`, `productName`, `hsnCode`, `bottleType`, `bottleWeight` ← PI `weight`, `colour` ← PI `bottleColour`, `capacity`, `quantity`, `unit`, `rate`, `gstPercent`, `amount`).
  - Runtime state is carried over from the replaced row when a product of the same name + colour is still present (`status`, `readyQuantity`, `dispatchedQuantity`, `dispatchStatus`, `batchNumber`, `gramage`, `remarks`, `linerPackingQty`, `tciBoraQty`, `normalBoraQty`) so an in-flight order keeps its progress.
  - Recomputes order `totalAmount` / `totalGst` / `grandTotal` from the PI items (same convention as the Won-deal conversion in `deals.ts`); order `freight` is left untouched so support-side freight adjustments are preserved.
- **`handlePiModification` now also calls `syncOrderItemsFromPi(order.proformaInvoiceId, order.dealId, txDb)`** — so ANY production-linked PI update (revision or draft edit) refreshes `order_items`, not just `production_order_items`. `approveModification` also syncs order_items on approval.
- **`PATCH /proforma-invoices/:id` (`updateInvoiceHandler`):** when a linked production order does NOT exist, the route now calls `syncOrderItemsFromPi` directly inside the transaction (revision path: `newInvoice.id` + `existing.dealId`; draft path: `piId` + `piDealId`) so a PI linked to a Sales Order is always synced, with or without a production order.
- **Build verified:** API server typecheck — 0 errors in `proforma-invoices.ts` / `production-service.ts` (remaining errors are the documented pre-existing baseline); CRM untouched.

## Key Decisions
- DELETE + INSERT chosen for guaranteed item-set parity (no stale leftovers), with runtime-state carry-over keyed by `productName + colour` to avoid resetting ready/dispatch progress on unchanged products.
- Sales Order lookup is via `dealId` only (orders table has no `proformaInvoiceId` column); repeat orders keep `dealId = null` so they are never clobbered.
- `handlePiModification` is the single place that covers both revision and draft PATCH paths when a production order exists; the route-level call is the fallback for the no-production-order case (avoids double-running the sync).
- No DB migration required (only `order_items` writes, existing table).

## Relevant Files
- `artifacts/api-server/src/lib/production-service.ts`: `syncOrderItemsFromPi` helper; `handlePiModification` + `approveModification` call it
- `artifacts/api-server/src/routes/proforma-invoices.ts`: `updateInvoiceHandler` fallback calls in revision + draft transactions
