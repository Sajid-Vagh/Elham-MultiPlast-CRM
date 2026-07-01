// ──────────────────────────────────────────────────────
// GST Provider — real API integration via GSTZen
// Configure GST_API_URL and GST_API_KEY in .env to enable
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

class ApiGstProvider implements GstProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = (process.env.GST_API_URL || "").replace(/\/+$/, "");
    this.apiKey = process.env.GST_API_KEY || "";
  }

  async lookup(gstin: string): Promise<GstDetails> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error("GST API not configured. Set GST_API_URL and GST_API_KEY in .env");
    }

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Token: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ gstin: gstin.trim().toUpperCase() }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GST API returned ${res.status}: ${res.statusText}${text ? ` — ${text}` : ""}`);
    }

    const raw: any = await res.json();

    if (raw.valid === false) {
      throw new Error(`Invalid GSTIN: ${gstin}`);
    }

    const cd = raw.company_details || {};
    const pradr = cd.pradr || {};
    const stateInfo = cd.state_info || {};

    return {
      legalName: cd.legal_name || cd.legalName || "",
      tradeName: cd.trade_name || cd.tradeName || "",
      gstin: raw.gstin || gstin,
      address: pradr.addr || "",
      addressLine1: pradr.addr1 || pradr.building_name || pradr.building_number || "",
      addressLine2: pradr.street || pradr.locality || pradr.loc || "",
      addressLine3: pradr.landmark || "",
      city: pradr.city || "",
      district: pradr.district || "",
      state: stateInfo.name || (cd.state || "").replace(/^\d+\s*-\s*/, "").replace(/\s+[A-Z]{2}$/, "") || "",
      stateCode: stateInfo.code || (cd.state || "").match(/^(\d+)/)?.[1] || "",
      pincode: pradr.pincode || pradr.pinc || "",
      status: cd.company_status || cd.gst_status || "Active",
      businessConstitution: cd.gst_type || cd.business_constitution || "",
      registrationStatus: cd.company_status || "",
    };
  }
}

let provider: GstProvider | null = null;

export function getGstProvider(): GstProvider {
  if (!provider) {
    provider = new ApiGstProvider();
  }
  return provider;
}

export function clearGstCache(): void {
  provider = null;
}
