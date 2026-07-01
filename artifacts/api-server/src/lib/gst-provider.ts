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

const cache = new Map<string, { data: GstDetails; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000;

const CITY_FIELDS = ["city", "district", "dst", "location", "loc", "locality", "ctj", "cityName", "city_name", "districtName", "district_name"];
const DISTRICT_FIELDS = ["district", "dst", "districtName", "district_name"];
const CONSTITUTION_FIELDS = ["businessConstitution", "constitution", "business_type", "businessType", "entityType", "entity_type"];

const INDIAN_STATES = new Set([
  "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh",
  "goa", "gujarat", "haryana", "himachal pradesh", "jharkhand",
  "karnataka", "kerala", "madhya pradesh", "maharashtra", "manipur",
  "meghalaya", "mizoram", "nagaland", "odisha", "orissa",
  "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana",
  "tripura", "uttar pradesh", "uttarakhand", "west bengal",
  "andaman and nicobar", "chandigarh", "dadra and nagar haveli",
  "daman and diu", "delhi", "jammu and kashmir", "ladakh",
  "lakshadweep", "puducherry",
]);

function extractField(data: any, fields: string[]): string {
  for (const key of fields) {
    const val = data[key];
    if (val && typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return "";
}

function parseGstAddress(rawAddress: string): {
  addressLine1: string; addressLine2: string; addressLine3: string;
  city: string; district: string; state: string; pincode: string;
} {
  const result = { addressLine1: "", addressLine2: "", addressLine3: "", city: "", district: "", state: "", pincode: "" };

  let addr = rawAddress.trim();
  if (!addr) return result;

  const pinMatch = addr.match(/(?:-|\s)?(\d{6})\s*$/);
  if (pinMatch) {
    result.pincode = pinMatch[1];
    addr = addr.substring(0, pinMatch.index).trim();
  }

  const segments = addr.split(",").map((s) => s.trim()).filter(Boolean);
  let remainingSegments = [...segments];

  for (let i = remainingSegments.length - 1; i >= 0; i--) {
    const seg = remainingSegments[i].toLowerCase().trim();
    if (INDIAN_STATES.has(seg)) {
      result.state = remainingSegments[i].trim();
      remainingSegments = remainingSegments.slice(0, i);
      break;
    }
  }

  if (remainingSegments.length > 0) {
    const last = remainingSegments[remainingSegments.length - 1].trim();
    if (last.length < 40 && /^[A-Za-z\s]+$/.test(last)) {
      result.city = last;
      result.district = last;
      remainingSegments = remainingSegments.slice(0, -1);
    }
  }

  if (remainingSegments.length === 1) {
    result.addressLine1 = remainingSegments[0];
  } else if (remainingSegments.length === 2) {
    result.addressLine1 = remainingSegments[0];
    result.addressLine2 = remainingSegments[1];
  } else if (remainingSegments.length >= 3) {
    const mid = Math.ceil(remainingSegments.length / 3);
    result.addressLine1 = remainingSegments.slice(0, mid).join(", ");
    result.addressLine2 = remainingSegments.slice(mid, mid * 2).join(", ");
    result.addressLine3 = remainingSegments.slice(mid * 2).join(", ");
  }

  return result;
}

class ApiGstProvider implements GstProvider {
  async lookup(gstin: string): Promise<GstDetails> {
    const cached = cache.get(gstin);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    const apiUrl = process.env.GST_API_URL || "https://api.gstzen.in/api/v1/gst/";
    const apiKey = process.env.GST_API_KEY;

    if (!apiKey) {
      throw new Error(
        "GST provider is not configured. Set GST_API_URL and GST_API_KEY environment variables. " +
        "Supported providers include ClearTax, Masters India, AppyFlow, GSTZen, or any custom API."
      );
    }

    const url = `${apiUrl.replace(/\/+$/, "")}/${gstin}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    } catch {
      throw new Error("Unable to verify GST. Please enter customer manually or try again later.");
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

    console.log("[GST Provider] Raw API response for", gstin, ":", JSON.stringify(data, null, 2));

    const resolvedAddress = data.address || data.partyAddress || data.businessAddress || data.addr || "";
    const parsed = parseGstAddress(resolvedAddress);

    const city = extractField(data, CITY_FIELDS) || parsed.city;
    const district = extractField(data, DISTRICT_FIELDS) || parsed.district;

    const details: GstDetails = {
      legalName: data.legalName || data.tradeNam || data.businessName || data.legal_business_name || "",
      tradeName: data.tradeName || data.trade_nam || data.trade_name || data.business_name || "",
      gstin: data.gstin || data.gstNo || data.gst_no || gstin,
      address: resolvedAddress,
      addressLine1: parsed.addressLine1,
      addressLine2: parsed.addressLine2,
      addressLine3: parsed.addressLine3,
      city,
      district,
      state: data.state || data.partyState || data.stateName || data.state_name || parsed.state,
      stateCode: data.stateCode || data.state_code || data.partyStateCode || gstin.substring(0, 2),
      pincode: data.pincode || data.pinCode || data.pin_code || parsed.pincode,
      status: data.status || data.registrationStatus || data.registration_status || data.gstStatus || "",
      businessConstitution: extractField(data, CONSTITUTION_FIELDS) || "",
      registrationStatus: data.registrationStatus || data.registration_status || data.gstStatus || data.status || "",
    };

    cache.set(gstin, { data: details, timestamp: Date.now() });
    return details;
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
  cache.clear();
}
