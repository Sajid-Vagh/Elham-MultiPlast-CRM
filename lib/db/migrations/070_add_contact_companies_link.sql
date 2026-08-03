-- Many-to-Many link between Contacts (phone numbers) and Company/GST profiles
-- (customer_master). A single customer_master row is the single source of truth
-- for a company's GST details; linking a contact never duplicates the company.
--
-- Use cases:
--   * One contact -> many GST profiles (an agent representing several companies).
--   * Many contacts -> one GST profile (Person A and Person B both work for the
--     same company and share its GST details).

CREATE TABLE IF NOT EXISTS contact_companies_link (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES customer_master(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contact_companies_link_contact_company_unique UNIQUE (contact_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_companies_link_contact_id ON contact_companies_link(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_companies_link_company_id ON contact_companies_link(company_id);
