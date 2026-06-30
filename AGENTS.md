
## Goal
- Separate permanent Customer Comments from Follow-up Notes with version history, display across all CRM modules, Customer Profile view, search integration, and import support.

## Constraints & Preferences
- Do NOT redesign the UI or change existing workflow.
- Do NOT modify Follow-up, Notifications, Pipeline or Dashboard logic.
- Maintain backward compatibility with existing Leads and database.
- Customer Comments must NEVER be deleted when category, deal stage, or assignment changes.
- Every comment edit saves a history record; never overwrite previous versions.
- Return Customer Comments with existing Lead APIs wherever possible; avoid additional unnecessary API calls.
- Comments truncated to 100 chars with "View More" link; clicking shows full comments.

## Progress
### Done
- Phase 1: notification dedup, badge/popup behavior, lead filter counts, upcoming follow-ups (Regular Follow up + Pending), deal pipeline filter (Regular Follow up only), auto-assignment for sales, role permissions, notes history as JSON array with audit trail, query invalidation fixes across `follow-ups.tsx`, `leads.tsx`, `lead-detail.tsx`, `leads-new.tsx`, `import.tsx`, dashboard uses React Query for category counts.
- Phase 2: upcoming filter only `callStatus === "Pending"`; `notesToDisplay` returns latest-first; status dropdown (Pending/Completed/Cancelled/No Response) in edit dialog; notes history shown in edit dialog; status badges for all statuses; `pendingCount`, `todayActivities`, `followUpCount` all filter by Pending only; notification dismissal for Cancelled/No Response.
- Phase 3 DB schema: Added `customerComments` (TEXT), `commentUpdatedAt` (TIMESTAMP), `commentUpdatedBy` (INTEGER REFERENCES users) to `contacts` table; created `comment_history` table (contactId, comment, updatedBy, updatedAt).
- Phase 3 migration: `lib/db/migrations/008_add_customer_comments.sql`.
- Phase 3 API zod schemas: Added `customerComments`, `commentUpdatedAt`, `commentUpdatedBy` to all contact response schemas (`ListContactsResponseItem`, `CreateContactResponse`, `GetContactResponse`, `UpdateContactResponse`, `ListDuplicateContactsResponseItem`, `ImportIndiaMartResponse`) and deal embedded contact schemas (`ListDealsResponseItem`, `CreateDealResponse`, `GetDealResponse`, `UpdateDealResponse`). Added `customerComments` to `UpdateContactBody`. Added `comments` to `ImportExcelBody`.
- Phase 3 TypeScript interfaces: Added `customerComments`, `commentUpdatedAt`, `commentUpdatedBy` to `Contact` interface; added `customerComments` to `ContactUpdate` interface.
- Phase 3 backend contacts.ts:
  - `withOwner()` helper returns `commentUpdatedByUser` (sanitized user object).
  - `GET /contacts` search ILIKE includes `customerComments`.
  - `PATCH /contacts/:id` handles `customerComments` separately with history insert into `comment_history`.
  - Added `GET /contacts/:id/comments` endpoint returning history with `updatedByName` from users join, ordered by `updatedAt DESC`.
- Phase 3 backend import.ts: Maps Excel `comments` column to `customerComments` on both create and update.
- Phase 3 frontend lead-detail.tsx: "Customer Comments" card in left sidebar with edit button, textarea dialog, full comment history display.
- Phase 3 frontend leads.tsx: "Comments" column in table with 100-char truncation, tooltip hover for full text.
- Phase 3 frontend follow-ups.tsx: "Comments" column from contact/deal with 100-char truncation, tooltip for full text.
- Phase 3 frontend deals.tsx: Customer Comments line in deal cards (80-char truncation) and drag overlay.

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Comment history stored in `comment_history` table (not in activities/notes) to keep Customer Comments completely separate from Follow-up Notes.
- `commentUpdatedByUser` included in contact response for immediate display of updater name without extra API call.
- Comment edit permissions use existing role system (admin can edit all, sales can edit own contacts).
- When importing, Excel "Comments" column maps to `customerComments`, NOT follow-up notes.
- History returned latest-first by `updatedAt DESC`; all versions preserved, never deleted.

## Next Steps
- Verify frontend works in dev mode with real data.
- Test edit + save to confirm history records created correctly.
- Verify import with "comments" column in Excel.

## Relevant Files
- `lib/db/src/schema/contacts.ts`: contacts table schema with new customer comment columns
- `lib/db/src/schema/comment_history.ts`: new comment_history table schema
- `lib/db/src/schema/index.ts`: added comment_history export
- `lib/db/migrations/008_add_customer_comments.sql`: migration SQL for comments columns + history table
- `lib/api-zod/src/generated/api.ts`: all contact/deal response schemas + UpdateContactBody + ImportExcelBody updated
- `lib/api-client-react/src/generated/api.schemas.ts`: Contact and ContactUpdate interfaces updated
- `artifacts/api-server/src/routes/contacts.ts`: search ILIKE includes customerComments, PATCH with history tracking, GET /contacts/:id/comments endpoint, withOwner() returns commentUpdatedByUser
- `artifacts/api-server/src/routes/import.ts`: Excel comments → customerComments mapping
- `artifacts/crm/src/pages/lead-detail.tsx`: Customer Comments card with edit + history dialog
- `artifacts/crm/src/pages/leads.tsx`: Customer Comments column (truncated + hover tooltip)
- `artifacts/crm/src/pages/follow-ups.tsx`: Customer Comments column (truncated + tooltip)
- `artifacts/crm/src/pages/deals.tsx`: Customer Comments in deal cards (truncated)
