// ──────────────────────────────────────────────────────
// GST Provider — ready for future third‑party integration
// ──────────────────────────────────────────────────────
// Currently the CRM uses only Customer Master for GST
// lookups.  When a real provider is implemented, add a
// class that implements GstProvider and wire it into
// the lookup pipeline:  Customer Master → GST Provider.
// ──────────────────────────────────────────────────────

export interface GstDetails {
  legalName: string;
  tradeName: string;
  gstin: string;
  address: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  city: string;
  district: string;
  state: string;
  stateCode: string;
  pincode: string;
  status: string;
  businessConstitution: string;
  registrationStatus: string;
}

export interface GstProvider {
  lookup(gstin: string): Promise<GstDetails>;
}
