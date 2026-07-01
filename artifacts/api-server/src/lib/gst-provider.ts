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

  // Extract pincode (6 digits, optionally preceded by "-")
  const pinMatch = addr.match(/(?:-|\s)?(\d{6})\s*$/);
  if (pinMatch) {
    result.pincode = pinMatch[1];
    addr = addr.substring(0, pinMatch.index).trim();
  }

  // Extract state from the tail
  const segments = addr.split(",").map((s) => s.trim()).filter(Boolean);
  let remainingSegments = [...segments];

  // Walk from the end to find a known state name
  for (let i = remainingSegments.length - 1; i >= 0; i--) {
    const seg = remainingSegments[i].toLowerCase().trim();
    if (INDIAN_STATES.has(seg)) {
      result.state = remainingSegments[i].trim();
      remainingSegments = remainingSegments.slice(0, i);
      break;
    }
  }

  // Next segment before state is likely city/district
  if (remainingSegments.length > 0) {
    const last = remainingSegments[remainingSegments.length - 1].trim();
    if (last.length < 40 && /^[A-Za-z\s]+$/.test(last)) {
      result.city = last;
      result.district = last;
      remainingSegments = remainingSegments.slice(0, -1);
    }
  }

  // Distribute remaining segments into address lines
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
      status: data.status || data.registrationStatus || data.registration_status || data.gstStatus || "Active",
      businessConstitution: extractField(data, CONSTITUTION_FIELDS) || "",
      registrationStatus: data.registrationStatus || data.registration_status || data.gstStatus || data.status || "Active",
    };

    cache.set(gstin, { data: details, timestamp: Date.now() });
    return details;
  }
}

// Full state code map covering all 36 Indian state/UT codes
const MOCK_LOCATIONS: Record<string, { city: string; state: string; pincode: string }> = {
  "01": { city: "Port Blair", state: "Andaman and Nicobar", pincode: "744101" },
  "02": { city: "Visakhapatnam", state: "Andhra Pradesh", pincode: "530001" },
  "03": { city: "Itanagar", state: "Arunachal Pradesh", pincode: "791111" },
  "04": { city: "Guwahati", state: "Assam", pincode: "781001" },
  "05": { city: "Patna", state: "Bihar", pincode: "800001" },
  "06": { city: "Chandigarh", state: "Chandigarh", pincode: "160001" },
  "07": { city: "Delhi", state: "Delhi", pincode: "110001" },
  "08": { city: "Jaipur", state: "Rajasthan", pincode: "302001" },
  "09": { city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" },
  "10": { city: "Patna", state: "Bihar", pincode: "800001" },
  "11": { city: "Panaji", state: "Goa", pincode: "403001" },
  "12": { city: "Srinagar", state: "Jammu and Kashmir", pincode: "190001" },
  "13": { city: "Bengaluru", state: "Karnataka", pincode: "560001" },
  "14": { city: "Panaji", state: "Goa", pincode: "403001" },
  "15": { city: "Ahmedabad", state: "Gujarat", pincode: "380001" },
  "16": { city: "Mumbai", state: "Maharashtra", pincode: "400001" },
  "17": { city: "Shillong", state: "Meghalaya", pincode: "793001" },
  "18": { city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
  "19": { city: "Kolkata", state: "West Bengal", pincode: "700001" },
  "20": { city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" },
  "21": { city: "Bhubaneswar", state: "Odisha", pincode: "751001" },
  "22": { city: "Shimla", state: "Himachal Pradesh", pincode: "171001" },
  "23": { city: "Raipur", state: "Chhattisgarh", pincode: "492001" },
  "24": { city: "Ahmedabad", state: "Gujarat", pincode: "380001" },
  "25": { city: "Panaji", state: "Goa", pincode: "403001" },
  "26": { city: "Gandhinagar", state: "Gujarat", pincode: "382010" },
  "27": { city: "Mumbai", state: "Maharashtra", pincode: "400001" },
  "28": { city: "Hyderabad", state: "Telangana", pincode: "500001" },
  "29": { city: "Bengaluru", state: "Karnataka", pincode: "560001" },
  "30": { city: "Panaji", state: "Goa", pincode: "403001" },
  "31": { city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
  "32": { city: "Thiruvananthapuram", state: "Kerala", pincode: "695001" },
  "33": { city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
  "34": { city: "Puducherry", state: "Puducherry", pincode: "605001" },
  "35": { city: "Port Blair", state: "Andaman and Nicobar", pincode: "744101" },
  "36": { city: "Hyderabad", state: "Telangana", pincode: "500001" },
  "37": { city: "Itanagar", state: "Arunachal Pradesh", pincode: "791111" },
  "38": { city: "Dimapur", state: "Nagaland", pincode: "797112" },
  "39": { city: "Gangtok", state: "Sikkim", pincode: "737101" },
};

const MOCK_STREETS = [
  "Main Road", "MG Road", "Station Road", "Park Street", "Church Street",
  "Commercial Street", "Brigade Road", "Residency Road", "Sardar Patel Marg",
  "Jawaharlal Nehru Marg", "Ring Road", "Vip Road", "Eastern Avenue",
  "Western Avenue", "Bannerghatta Road", "Old Madras Road", "Airport Road",
  "Hosur Road", "Tumkur Road", "Mysore Road",
];

const MOCK_BUILDINGS = [
  "Platinum Tower", "Corporate House", "Business Center", "Trade Centre",
  "Commerce Plaza", "Metro Tower", "City Centre", "Galaxy Building",
  "Summit House", "Crystal Tower", "Imperial House", "Heritage Plaza",
  "Regent Tower", "Supreme Court", "Central Point", "Elite House",
];

const MOCK_CONSTITUTIONS = ["Private Limited", "Public Limited", "Partnership", "Proprietorship", "LLP", "Public Sector Undertaking"];

function seededHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

function pick<T>(arr: readonly T[], seed: number, index: number): T {
  return arr[(seed + index) % arr.length];
}

class MockGstProvider implements GstProvider {
  async lookup(gstin: string): Promise<GstDetails> {
    const cached = cache.get(gstin);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    await new Promise((r) => setTimeout(r, 800));

    const seed = seededHash(gstin);
    const stateCode = gstin.substring(0, 2);
    const loc = MOCK_LOCATIONS[stateCode] || { city: "Ahmedabad", state: "Gujarat", pincode: "380001" };

    const building = pick(MOCK_BUILDINGS, seed, 0);
    const street = pick(MOCK_STREETS, seed, 1);
    const constitution = pick(MOCK_CONSTITUTIONS, seed, 2);
    const streetNo = (seed % 999) + 1;

    // Derive a unique company name from the GSTIN
    const namePrefix = String.fromCharCode(65 + (seed % 26)) + String.fromCharCode(65 + ((seed + 3) % 26));
    const legalName = `${namePrefix} ${loc.city} Trading Co. Pvt. Ltd.`;
    const tradeName = `${namePrefix} ${loc.city} Trading`;

    const fullAddress = `${building}, ${streetNo}, ${street}, ${loc.city}, ${loc.state} ${loc.pincode}`;

    const details: GstDetails = {
      legalName,
      tradeName,
      gstin,
      address: fullAddress,
      addressLine1: `${building}, ${streetNo}, ${street}`,
      addressLine2: `${loc.city}`,
      addressLine3: `${loc.state}`,
      city: loc.city,
      district: loc.city,
      state: loc.state,
      stateCode,
      pincode: loc.pincode,
      status: "Active",
      businessConstitution: constitution,
      registrationStatus: "Active",
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
