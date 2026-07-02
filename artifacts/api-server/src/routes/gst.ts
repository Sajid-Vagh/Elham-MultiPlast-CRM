import { Router, type IRouter } from "express";
import { db, gstVerificationLogTable, customerMasterTable } from "@workspace/db";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { getGstProvider } from "../lib/gst-provider";
import axios from "axios";

const router: IRouter = Router();

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

function normalize(src: any, gstin: string): any {
  const pradr = (s: any) => s?.pradr?.addr || s?.pradr || {};
  return {
    legalName: src.legalName || src.legal_name || src.lgnm || src.companyName || src.businessName || "",
    tradeName: src.tradeName || src.trade_name || src.tradeNam || "",
    gstin: src.gstin || gstin,
    address:
      src.address ||
      [pradr(src).bno, pradr(src).bnm, pradr(src).flno, pradr(src).st, pradr(src).loc]
        .filter(Boolean)
        .join(", ") ||
      "",
    addressLine1: src.addressLine1 || src.address_line1 || src.addr1 || pradr(src).bno || pradr(src).bnm || "",
    addressLine2: src.addressLine2 || src.address_line2 || src.street || src.locality || pradr(src).st || pradr(src).loc || "",
    addressLine3: src.addressLine3 || src.address_line3 || src.landmark || pradr(src).flno || "",
    city: src.city || src.cityName || src.city_name || pradr(src).city || "",
    district: src.district || src.districtName || src.district_name || pradr(src).dst || "",
    state: (src.state || src.stateName || src.parts?.stateName || pradr(src).stcd || "").replace(/^\d+\s*-\s*/, ""),
    stateCode: src.stateCode || src.state_code || src.parts?.stateCode || "",
    pincode: src.pincode || src.pinCode || src.pinc || pradr(src).pncd || "",
    status: src.status || src.sts || src.company_status || "Active",
    registrationStatus: src.registrationStatus || src.sts || src.registration_status || src.status || "Active",
    businessConstitution: src.businessConstitution || src.constitution || src.ctb || src.business_constitution || src.gstType || src.gst_type || "",
    taxpayerType: src.taxpayerType || src.gstType || src.gst_type || src.ctb || src.businessConstitution || src.constitution || "",
    constitution: src.constitution || src.ctb || src.businessConstitution || src.business_constitution || "",
    registrationDate: src.registrationDate || src.registration_date || src.dtreg || src.dtDReg || "",
    lastUpdated: src.lastUpdated || src.last_update || "",
    natureOfBusiness: src.natureOfBusiness || src.nature_of_business || src.businessNature || src.nature_of_business_activity || "",
    principalPlaceOfBusiness: src.principalPlaceOfBusiness || src.principal_place_of_business || src.address || "",
    pradr: src.pradr || {},
  };
}

async function lookupGstinFromProviders(gstin: string, req: any): Promise<any> {
  const cleanGstin = gstin.toUpperCase().trim();

  const gstVerifyKey = process.env.GSTVERIFY_API_KEY;
  if (gstVerifyKey) {
    try {
      const gstBaseUrl = (process.env.GSTVERIFY_BASE_URL || "https://gstverify.co.in/api").replace(/\/+$/, "");
      const gvRes = await axios.get(`${gstBaseUrl}/v1/verify/${cleanGstin}`, {
        headers: { "X-API-Key": gstVerifyKey, Accept: "application/json" },
        timeout: 8000,
      });
      const gvBody = gvRes.data;
      if (gvBody?.success && gvBody?.data) {
        return normalize(gvBody.data, cleanGstin);
      }
    } catch (gvErr: any) {
      req.log.warn({ err: gvErr.message, gstin: cleanGstin }, "GSTVerify failed, trying next tier");
    }
  }

  const rapidApiKey = process.env.RAPIDAPI_GST_KEY;
  const rapidApiHost = process.env.RAPIDAPI_GST_HOST;
  if (rapidApiKey && rapidApiHost) {
    try {
      const raRes = await axios.get(`https://${rapidApiHost}/gst.php?gst_no=${encodeURIComponent(cleanGstin)}`, {
        headers: {
          "x-rapidapi-host": rapidApiHost,
          "x-rapidapi-key": rapidApiKey,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      });
      const raBody = raRes.data;
      const source = raBody?.data || raBody?.result || raBody;
      if (source?.lgnm) {
        let cityFromAddr = "";
        let stateFromAddr = "";
        if (source.adr) {
          const addrParts = source.adr.split(",").map((s: string) => s.trim()).filter(Boolean);
          stateFromAddr = addrParts.length >= 2 ? addrParts[addrParts.length - 2] : "";
          cityFromAddr = addrParts.length >= 3 ? addrParts[addrParts.length - 3] : "";
        }
        return normalize({
          legalName: source.lgnm || "",
          tradeName: source.tradeName || "",
          address: source.adr || "",
          city: cityFromAddr,
          state: stateFromAddr,
          pincode: source.pincode || "",
          gstin: cleanGstin,
          status: "Active",
          registrationStatus: source.sts || "Active",
          businessConstitution: source.ctb || "",
          registrationDate: source.dtreg || "",
          taxpayerType: source.ctb || "",
          constitution: source.ctb || "",
        }, cleanGstin);
      }
    } catch (raErr: any) {
      req.log.warn({ err: raErr.message, gstin: cleanGstin }, "RapidAPI GST failed, trying next tier");
    }
  }

  if (process.env.GST_API_URL && process.env.GST_API_KEY) {
    try {
      const provider = getGstProvider();
      const details = await provider.lookup(cleanGstin);
      return normalize(details, cleanGstin);
    } catch (apiErr: any) {
      req.log.warn({ err: apiErr.message, gstin: cleanGstin }, "GSTZen API failed");
    }
  }

  try {
    const response = await axios.get(`https://app.gstzen.in/p/gstin-validator/${cleanGstin}/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      },
      timeout: 8000,
    });
    const html = response.data;
    const nameMatch = html.match(/(?:Legal Name|Trade Name).*?<td[^>]*>([\s\S]*?)<\/td>/i);
    const addressMatch = html.match(/(?:Principal Place of Business|Address).*?<td[^>]*>([\s\S]*?)<\/td>/i);
    if (nameMatch && nameMatch[1]) {
      const companyName = nameMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const address = addressMatch
        ? addressMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
        : "";
      return normalize({
        legalName: companyName,
        tradeName: "",
        address,
        gstin: cleanGstin,
        status: "Active",
        registrationStatus: "Active",
      }, cleanGstin);
    }
  } catch {
    // silent
  }

  try {
    const [customer] = await db
      .select()
      .from(customerMasterTable)
      .where(eq(customerMasterTable.gstin, cleanGstin))
      .limit(1);
    if (customer) {
      return normalize({
        legalName: customer.companyName || "",
        tradeName: customer.tradeName || "",
        address: [customer.addressLine1, customer.addressLine2, customer.addressLine3].filter(Boolean).join(", "),
        addressLine1: customer.addressLine1 || "",
        addressLine2: customer.addressLine2 || "",
        addressLine3: customer.addressLine3 || "",
        city: customer.city || "",
        district: customer.district || "",
        state: customer.state || "",
        pincode: customer.pincode || "",
        gstin: cleanGstin,
        status: customer.gstStatus || "Active",
        businessConstitution: customer.businessConstitution || "",
        registrationStatus: customer.gstStatus || "Active",
      }, cleanGstin);
    }
  } catch {
    // silent
  }

  return null;
}

async function verifyGst(gstin: string, req: any): Promise<{ data: any; cached: boolean }> {
  const cleanGstin = gstin.toUpperCase().trim();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [cached] = await db
    .select()
    .from(gstVerificationLogTable)
    .where(
      and(
        eq(gstVerificationLogTable.gstin, cleanGstin),
        eq(gstVerificationLogTable.success, true),
        lte(gstVerificationLogTable.verifiedAt, new Date()),
        gte(gstVerificationLogTable.verifiedAt, thirtyDaysAgo)
      )
    )
    .orderBy(desc(gstVerificationLogTable.verifiedAt))
    .limit(1);

  if (cached?.responseData) {
    return { data: cached.responseData, cached: true };
  }

  const user = await getUserFromRequest(req).catch(() => null);
  const startTime = Date.now();

  try {
    const result = await lookupGstinFromProviders(cleanGstin, req);
    const responseTime = Date.now() - startTime;

    if (result) {
      await db.insert(gstVerificationLogTable).values({
        gstin: cleanGstin,
        verifiedBy: user?.id || null,
        ipAddress: req.ip || req.socket?.remoteAddress || "",
        responseTimeMs: responseTime,
        success: true,
        responseData: result,
        errorMessage: null,
      }).execute();

      return { data: result, cached: false };
    }

    await db.insert(gstVerificationLogTable).values({
      gstin: cleanGstin,
      verifiedBy: user?.id || null,
      ipAddress: req.ip || req.socket?.remoteAddress || "",
      responseTimeMs: responseTime,
      success: false,
      responseData: null,
      errorMessage: "Could not extract live details for this GSTIN",
    }).execute();

    return { data: null, cached: false };
  } catch (err: any) {
    const responseTime = Date.now() - startTime;

    await db.insert(gstVerificationLogTable).values({
      gstin: cleanGstin,
      verifiedBy: user?.id || null,
      ipAddress: req.ip || req.socket?.remoteAddress || "",
      responseTimeMs: responseTime,
      success: false,
      responseData: null,
      errorMessage: err.message || "Unknown error",
    }).execute();

    return { data: null, cached: false };
  }
}

router.post("/gst/verify", async (req, res) => {
  try {
    const { gstin } = req.body;

    if (!gstin || typeof gstin !== "string") {
      res.status(400).json({ success: false, error: "GSTIN is required" });
      return;
    }

    const cleanGstin = gstin.trim().toUpperCase();

    if (cleanGstin.length !== 15) {
      res.status(400).json({ success: false, error: "GSTIN must be exactly 15 characters" });
      return;
    }

    if (!GSTIN_REGEX.test(cleanGstin)) {
      res.status(400).json({ success: false, error: "Invalid GSTIN format" });
      return;
    }

    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
    const rateLimit = checkRateLimit(clientIp);
    if (!rateLimit.allowed) {
      res.status(429).json({ success: false, error: "Rate limit exceeded. Please try again later.", retryAfter: 60 });
      return;
    }

    const { data, cached } = await verifyGst(cleanGstin, req);

    if (!data) {
      res.json({ success: false, error: "Could not verify this GSTIN. Please enter details manually." });
      return;
    }

    res.json({
      success: true,
      cached,
      verifiedAt: new Date().toISOString(),
      ...data,
    });
  } catch (err: any) {
    req.log.error({ err }, "GST verification error");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/gst/refresh", async (req, res) => {
  try {
    const { gstin } = req.body;

    if (!gstin || typeof gstin !== "string") {
      res.status(400).json({ success: false, error: "GSTIN is required" });
      return;
    }

    const cleanGstin = gstin.trim().toUpperCase();

    if (cleanGstin.length !== 15) {
      res.status(400).json({ success: false, error: "GSTIN must be exactly 15 characters" });
      return;
    }

    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
    const rateLimit = checkRateLimit(clientIp);
    if (!rateLimit.allowed) {
      res.status(429).json({ success: false, error: "Rate limit exceeded. Please try again later.", retryAfter: 60 });
      return;
    }

    const user = await getUserFromRequest(req).catch(() => null);
    const startTime = Date.now();

    try {
      const result = await lookupGstinFromProviders(cleanGstin, req);
      const responseTime = Date.now() - startTime;

      if (result) {
        await db.insert(gstVerificationLogTable).values({
          gstin: cleanGstin,
          verifiedBy: user?.id || null,
          ipAddress: req.ip || req.socket?.remoteAddress || "",
          responseTimeMs: responseTime,
          success: true,
          responseData: result,
          errorMessage: null,
        }).execute();

        res.json({
          success: true,
          cached: false,
          verifiedAt: new Date().toISOString(),
          ...result,
        });
        return;
      }

      await db.insert(gstVerificationLogTable).values({
        gstin: cleanGstin,
        verifiedBy: user?.id || null,
        ipAddress: req.ip || req.socket?.remoteAddress || "",
        responseTimeMs: responseTime,
        success: false,
        responseData: null,
        errorMessage: "Could not extract live details for this GSTIN",
      }).execute();

      res.json({ success: false, error: "Could not verify this GSTIN. Please enter details manually." });
    } catch (err: any) {
      const responseTime = Date.now() - startTime;

      await db.insert(gstVerificationLogTable).values({
        gstin: cleanGstin,
        verifiedBy: user?.id || null,
        ipAddress: req.ip || req.socket?.remoteAddress || "",
        responseTimeMs: responseTime,
        success: false,
        responseData: null,
        errorMessage: err.message || "Unknown error",
      }).execute();

      res.status(500).json({ success: false, error: "GST verification failed" });
    }
  } catch (err: any) {
    req.log.error({ err }, "GST refresh error");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/gst/verify/:gstin", async (req, res) => {
  try {
    const { gstin } = req.params;
    const cleanGstin = gstin.toUpperCase().trim();

    if (cleanGstin.length !== 15) {
      res.status(400).json({ success: false, error: "GSTIN must be exactly 15 characters" });
      return;
    }

    const logs = await db
      .select()
      .from(gstVerificationLogTable)
      .where(eq(gstVerificationLogTable.gstin, cleanGstin))
      .orderBy(desc(gstVerificationLogTable.verifiedAt))
      .limit(20);

    const recentSuccess = logs.find((l) => l.success && l.responseData);

    res.json({
      success: true,
      gstin: cleanGstin,
      logs,
      lastVerified: recentSuccess
        ? {
            verifiedAt: recentSuccess.verifiedAt,
            data: recentSuccess.responseData,
          }
        : null,
    });
  } catch (err: any) {
    req.log.error({ err }, "GST verification history error");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
