
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

## Production Module

### Goal
Add a Production Module with role-based access (Sales, Production Manager, Admin) inside the same CRM. Auto-create Production Orders when Sales Orders are confirmed. Read-only Production view for Sales users. Dynamic sidebar based on role.

### Done
- DB schema: `production_orders`, `production_timeline`, `production_notes` tables in `lib/db/src/schema/production_orders.ts`
- Migration `017_add_production_orders.sql` — creates 3 tables + indexes
- Role `production_manager` added to `UserRole`, `UserInputRole`, `UserUpdateRole` types
- Backend `production.ts` routes:
  - `GET /production/dashboard` — KPI cards (pending, material ready, in production, QC, packing, ready for dispatch, completed today, delayed)
  - `GET /production/orders` — list with search, status filter, priority filter, pagination
  - `GET /production/orders/:id` — single order detail with invoice, items, timeline, notes
  - `GET /production/by-invoice/:invoiceId` — lookup by proforma invoice (used by Sales read-only view)
  - `PATCH /production/orders/:id/status` — update status with timeline record + notification
  - `POST /production/orders/:id/notes` — add internal production note
- Auto-create Production Order in `proforma-invoices.ts` when status → "Converted to Order"
- Notification sent to Sales user on Production status change via `createNotification` (type: `production_status`)
- Frontend pages:
  - `production-dashboard.tsx` — 8 KPI cards linking to filtered order list
  - `production-orders.tsx` — full list with search, status/priority filters, pagination
  - `production-order-detail.tsx` — order details, product table, timeline, notes, status update dialog, note dialog
- `production-progress.tsx` — read-only Production Progress card for Sales users in proforma invoice detail
- `App.tsx` — `RoleGuard` component redirects users based on role; production routes guarded
- `layout.tsx` — dynamic sidebar: Sales shows only Sales nav, Production shows only Production nav, Admin shows both
- `login.tsx` — stores `crm_user_role` in localStorage, redirects to correct dashboard based on role
- `settings.tsx` — role dropdown includes Production Manager option
- `seed.ts` — includes `production` user with role `production_manager`
- Backend 403 enforcement: all `/api/production/*` endpoints return 403 for non-production/non-admin users

### In Progress
- Run migration `017_add_production_orders.sql` against Supabase database
- Deploy and test Production module end-to-end

### Blocked
- (none)

## Key Decisions
- `POST /proforma-invoices/gst-lookup` returns HTTP 200 always, with `{ success: true/false }` body.
- GSTVerify is Tier 1 (free, working), GSTZen is Tier 2 (needs paid sub), HTML scrape Tier 3 (unreliable), Customer Master Tier 4 (fallback).
- `normalize()` helper maps snake_case from APIs to camelCase expected by frontend.
- `ApiGstProvider` kept for backward compat (GSTZen).
- No mock provider exists anywhere.

## Relevant Files
- `artifacts/api-server/src/routes/proforma-invoices.ts`: gst-lookup (4-tier), renderInvoiceHtml, soft-delete DELETE.
- `artifacts/api-server/src/lib/gst-provider.ts`: GstProvider interface + ApiGstProvider (GSTZen).
- `artifacts/api-server/src/routes/customer-master.ts`: CRUD + lookup endpoints.
- `artifacts/api-server/src/routes/products.ts`: GET /products/search?q=.
- `artifacts/crm/src/pages/proforma-invoices.tsx`: full frontend with auto-fetch, autocomplete, calculations, delete.
- `lib/db/src/schema/customer_master.ts`: Customer Master table.
- `lib/db/src/schema/proforma_invoices.ts`: proforma_invoices table (with customerMasterId, deletedAt/by).
- `lib/db/migrations/013_add_customer_master.sql`, `014_add_deleted_at_by.sql`.
- `.env`: `GSTVERIFY_API_KEY` (primary), `GST_API_URL` + `GST_API_KEY` (fallback).

## Production Module Relevant Files
- `lib/db/src/schema/production_orders.ts`: production_orders, production_timeline, production_notes table schemas
- `lib/db/migrations/017_add_production_orders.sql`: migration to create production tables
- `artifacts/api-server/src/routes/production.ts`: all production API endpoints (dashboard, orders, status, notes)
- `artifacts/api-server/src/routes/proforma-invoices.ts`: auto-create production order on "Converted to Order"
- `lib/api-zod/src/generated/types/userRole.ts`, `userInputRole.ts`, `userUpdateRole.ts`: role types updated
- `lib/api-zod/src/generated/api.ts`: updated role enums in Zod schemas
- `lib/api-client-react/src/generated/api.schemas.ts`: updated UserRole const
- `artifacts/crm/src/pages/production-dashboard.tsx`: Production Dashboard with 8 KPI cards
- `artifacts/crm/src/pages/production-orders.tsx`: Production Orders list with filters
- `artifacts/crm/src/pages/production-order-detail.tsx`: Production Order detail with timeline, notes, status update
- `artifacts/crm/src/components/production-progress.tsx`: read-only Production Progress for Sales users
- `artifacts/crm/src/App.tsx`: RoleGuard component, production routes
- `artifacts/crm/src/components/layout.tsx`: dynamic role-based sidebar
- `artifacts/crm/src/pages/login.tsx`: login redirect based on role
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
