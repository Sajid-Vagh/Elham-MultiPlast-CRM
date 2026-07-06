
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
- Phase 3: Customer Comments feature — DB schema, migration, API zod schemas, TypeScript interfaces, backend contacts.ts with comment history tracking, frontend display in lead-detail.tsx, leads.tsx, follow-ups.tsx, deals.tsx. Import Excel comments mapping.
- Phase 4: Customer 360° Profile — `lead-detail.tsx` rewritten with all 10 sections:
  1. Customer Information (inline editable via dialogs)
  2. Customer Comments (existing, enhanced)
  3. Upcoming Follow-up (fetch + Complete/Call quick actions)
  4. Complete Follow-up History (chronological list, newest first)
  5. Deal Information (show/create deal inline)
  6. Activity Timeline (combined timeline from activities, category changes, comment updates, deal events)
  7. Category History (from `category_history` table, with user + timestamp)
  8. Notification History (from notifications table, related to contact)
  9. Attachments (future-ready placeholder)
  10. Quick Actions (Edit Comments, Schedule Follow-up, Move Category, Create Deal, Call, Copy Mobile, Edit Lead)
- Phase 4: Summary Card (sticky header with name, company, mobile, category, deal stage, next follow-up, customer since + Back/Move/Edit/Delete buttons)
- Phase 4: Category history tracking — automatic insert into `category_history` whenever category changes in PATCH /contacts/:id
- Phase 4: New backend endpoints:
  - `GET /contacts/:id/category-history` — returns category changes with user name
  - `GET /contacts/:id/timeline` — combined timeline of all events
  - `GET /contacts/:id/notifications` — notification history for the contact
- Phase 4: Migration `009_add_category_history.sql` (run against Supabase database)
- Phase 4: Live synchronization via React Query invalidation — after any update, all related sections automatically refresh

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

## Next Steps
- Test in dev mode with real data.
- Verify category changes appear in Category History section.
- Verify timeline shows all event types correctly.
- Test follow-up Complete button removes from Upcoming section.
- Confirm all 10 sections render correctly on mobile.

## Relevant Files
- `lib/db/src/schema/category_history.ts`: category_history table schema (pre-existing)
- `lib/db/migrations/009_add_category_history.sql`: migration to create category_history table in DB
- `artifacts/api-server/src/routes/contacts.ts`: category history tracking, GET endpoints for category-history, timeline, notifications
- `artifacts/crm/src/pages/lead-detail.tsx`: Customer 360° Profile with all 10 sections + summary card + quick actions

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
