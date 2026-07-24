/**
 * Mask sensitive customer fields for production role users.
 * Production sees only customerCode; all identity fields are hidden.
 * Admin, sales, production_and_support see full customer data.
 */

const PRODUCTION_MASKED_FIELDS = {
  name: "[Protected]",
  companyName: "",
  mobile: "",
  email: "",
  otherPhone: "",
  otherEmail: "",
  address: "",
  city: "",
  state: "",
  customerComments: "",
  industry: "",
  leadSource: "",
  tags: "",
  notes: "",
};

export function maskContactForProduction(contact: any): any {
  if (!contact) return null;
  const code = contact.customerCode || "[No Code]";
  return {
    ...contact,
    name: code,
    companyName: "",
    mobile: "",
    email: "",
    otherPhone: "",
    otherEmail: "",
    address: "",
    city: "",
    state: "",
    customerComments: "",
    industry: "",
    leadSource: "",
    tags: "",
  };
}

export function maskInvoiceForProduction(invoice: any, contactCustomerCode: string | null): any {
  if (!invoice) return null;
  const code = contactCustomerCode || "[No Code]";
  return {
    ...invoice,
    customerName: code,
    companyName: "",
    mobile: "",
    gstNumber: "",
    address: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
  };
}

export function isProductionOnlyRole(role: string): boolean {
  return role === "production";
}
