import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

function loadEnv(): void {
  if (process.env.GST_PROVIDER) return;
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
loadEnv();

export interface GstDetails {
  legalName: string;
  tradeName: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  status: string;
}

export interface GstProvider {
  lookup(gstin: string): Promise<GstDetails>;
}

const cache = new Map<string, { data: GstDetails; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000;

const CITY_FIELDS = ["city", "district", "dst", "location", "loc", "locality", "ctj", "cityName", "city_name", "districtName", "district_name"];

const STATE_CITY_MAP: Record<string, string> = {
  "24": "Ahmedabad", "27": "Mumbai", "29": "Bengaluru",
  "33": "Chennai", "36": "Hyderabad", "09": "Lucknow",
  "07": "Delhi", "06": "Gurugram", "08": "Jaipur",
};

function extractCity(data: any, fallbackAddress: string): string {
  for (const key of CITY_FIELDS) {
    const val = data[key];
    if (val && typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  const segments = fallbackAddress.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (/^[A-Za-z\s]{2,}$/.test(s) && s.length < 40) {
      return s;
    }
  }
  return "";
}

class DefaultGstProvider implements GstProvider {
  async lookup(gstin: string): Promise<GstDetails> {
    const cached = cache.get(gstin);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    const apiUrl = process.env.GST_API_URL || "https://api.gstzen.in/api/v1/gst/";
    const apiKey = process.env.GST_API_KEY;

    if (!apiKey) {
      throw new Error("GST_API_KEY not configured. Set GST_API_KEY environment variable.");
    }

    const url = `${apiUrl.replace(/\/+$/, "")}/${gstin}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    } catch {
      throw new Error("GST lookup service is unavailable. Please try again later.");
    }

    if (response.status === 404) {
      throw new Error("GSTIN not found. Please verify the GST number.");
    }
    if (!response.ok) {
      throw new Error("GST lookup service returned an error. Please try again.");
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error("Invalid response from GST lookup service.");
    }

    const resolvedAddress = data.address || data.partyAddress || data.businessAddress || data.addr || "";

    const details: GstDetails = {
      legalName: data.legalName || data.tradeNam || data.businessName || data.legal_business_name || "",
      tradeName: data.tradeName || data.trade_nam || data.trade_name || data.business_name || "",
      gstin: data.gstin || data.gstNo || data.gst_no || gstin,
      address: resolvedAddress,
      city: extractCity(data, resolvedAddress),
      state: data.state || data.partyState || data.stateName || data.state_name || "",
      stateCode: data.stateCode || data.state_code || data.partyStateCode || gstin.substring(0, 2),
      pincode: data.pincode || data.pinCode || data.pin_code || "",
      status: data.status || data.registrationStatus || data.registration_status || data.gstStatus || "Active",
    };

    cache.set(gstin, { data: details, timestamp: Date.now() });
    return details;
  }
}

const MOCK_CITIES: Record<string, string> = {
  "24": "Ahmedabad", "27": "Mumbai", "29": "Bengaluru",
  "33": "Chennai", "36": "Hyderabad", "09": "Lucknow",
  "07": "Delhi", "06": "Gurugram", "08": "Jaipur",
};

const MOCK_STATES: Record<string, string> = {
  "24": "Gujarat", "27": "Maharashtra", "29": "Karnataka",
  "33": "Tamil Nadu", "36": "Telangana", "09": "Uttar Pradesh",
  "07": "Delhi", "06": "Haryana", "08": "Rajasthan",
};

const MOCK_PINCODES: Record<string, string> = {
  "24": "380001", "27": "400001", "29": "560001",
  "33": "600001", "36": "500001", "09": "226001",
  "07": "110001", "06": "122001", "08": "302001",
};

class MockGstProvider implements GstProvider {
  async lookup(gstin: string): Promise<GstDetails> {
    const cached = cache.get(gstin);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    await new Promise((r) => setTimeout(r, 800));

    const stateCode = gstin.substring(0, 2);
    const city = MOCK_CITIES[stateCode] || "Ahmedabad";
    const state = MOCK_STATES[stateCode] || "Gujarat";
    const pincode = MOCK_PINCODES[stateCode] || "380001";

    const details: GstDetails = {
      legalName: "Sample Business Pvt. Ltd.",
      tradeName: "Sample Business",
      gstin,
      address: `123, Business Avenue, Industrial Area, ${city}, ${state} ${pincode}`,
      city,
      state,
      stateCode,
      pincode,
      status: "Active",
    };

    cache.set(gstin, { data: details, timestamp: Date.now() });
    return details;
  }
}

let provider: GstProvider | null = null;

export function getGstProvider(): GstProvider {
  if (!provider) {
    const providerName = process.env.GST_PROVIDER || "default";
    if (providerName === "mock") {
      provider = new MockGstProvider();
    } else {
      provider = new DefaultGstProvider();
    }
  }
  return provider;
}

export function clearGstCache(): void {
  cache.clear();
}
