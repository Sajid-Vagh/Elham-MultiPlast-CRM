/**
 * India state/city geo mapping utilities.
 *
 * Used to standardize free-text "state" and "city" values coming from lead
 * creation and imports, so report aggregations (e.g. /reports/by-state) group
 * by a single canonical name instead of showing duplicates ("RJ" vs
 * "Rajasthan") or "Unknown" (missing state that can be inferred from city).
 */

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

/** Canonical state name -> accepted abbreviations / common misspellings. */
const STATE_ALIASES: Record<string, string[]> = {
  "Andhra Pradesh": ["andhra pradesh", "andhra", "ap", "andrapradesh", "andhra-pradesh"],
  "Arunachal Pradesh": ["arunachal pradesh", "arunachal", "ar", "arunachal-pradesh"],
  Assam: ["assam", "as", "asam"],
  Bihar: ["bihar", "br", "bihr"],
  Chhattisgarh: ["chhattisgarh", "chhatisgarh", "chattisgarh", "cg", "chattisgar", "chhattisgar"],
  Goa: ["goa", "ga"],
  Gujarat: ["gujarat", "gujrat", "gujarath", "guj", "gj", "gujerath", "gujarati"],
  Haryana: ["haryana", "hr", "hariyana"],
  "Himachal Pradesh": ["himachal pradesh", "himachal", "hp", "himachal-pradesh"],
  Jharkhand: ["jharkhand", "jh", "jharkand"],
  Karnataka: ["karnataka", "karnatka", "karnataka", "ka", "kar", "karnatak", "karnataca"],
  Kerala: ["kerala", "keral", "kl", "kerela", "kerala"],
  "Madhya Pradesh": ["madhya pradesh", "mp", "madhyapradesh", "madhya-pradesh", "m.p.", "madhya pradesh"],
  Maharashtra: ["maharashtra", "maharastra", "maharasta", "mh", "maharashtra", "maharashstra"],
  Manipur: ["manipur", "mn"],
  Meghalaya: ["meghalaya", "ml", "meghalya"],
  Mizoram: ["mizoram", "mz"],
  Nagaland: ["nagaland", "nl"],
  Odisha: ["odisha", "orissa", "or", "od", "odisa"],
  Punjab: ["punjab", "pb", "panjab"],
  Rajasthan: ["rajasthan", "rajasthan", "rajashtan", "rj", "raj", "rajastan", "rajisthan"],
  Sikkim: ["sikkim", "sk"],
  "Tamil Nadu": ["tamil nadu", "tamilnadu", "tn", "tamil-nadu", "tamil nad"],
  Telangana: ["telangana", "telengana", "ts", "tg", "telangana"],
  Tripura: ["tripura", "tr"],
  "Uttar Pradesh": ["uttar pradesh", "up", "uttarpradesh", "uttar-pradesh", "u.p.", "up"],
  Uttarakhand: ["uttarakhand", "uttarkhand", "uk", "ua", "uttaranchal"],
  "West Bengal": ["west bengal", "w bengal", "wb", "west-bengal", "westbengal", "bengal"],
  "Andaman and Nicobar Islands": ["andaman and nicobar islands", "andaman", "andaman & nicobar islands", "a & n islands", "an"],
  Chandigarh: ["chandigarh", "chd", "ch"],
  "Dadra and Nagar Haveli and Daman and Diu": ["dadra and nagar haveli and daman and diu", "dadra & nagar haveli & daman & diu", "dadra and nagar haveli", "daman and diu", "dnh", "dd"],
  Delhi: ["delhi", "new delhi", "delhi ncr", "dl", "del", "nct of delhi", "delhi"],
  "Jammu and Kashmir": ["jammu and kashmir", "jammu & kashmir", "j&k", "jk", "kashmir"],
  Ladakh: ["ladakh", "la"],
  Lakshadweep: ["lakshadweep", "ld"],
  Puducherry: ["puducherry", "pondicherry", "puduchery", "py", "pon"],
};

/** Canonical city name -> accepted abbreviations / common misspellings. */
const CITY_ALIASES: Record<string, string[]> = {
  Ahmedabad: ["ahmedabad", "amdavad", "ahmedbad", "ahm"],
  Surat: ["surat"],
  Rajkot: ["rajkot", "rajcot"],
  Mumbai: ["mumbai", "bombay", "mumbi", "bmb"],
  Pune: ["pune", "puna", "poonam"],
  Delhi: ["delhi", "new delhi", "n delhi"],
  Jaipur: ["jaipur", "jaypur"],
  Bangalore: ["bangalore", "bengaluru", "bengalore", "blore"],
  Kolkata: ["kolkata", "calcutta", "calcuta"],
  Chennai: ["chennai", "madras"],
  Hyderabad: ["hyderabad", "hyd"],
  Vadodara: ["vadodara", "baroda"],
  Nashik: ["nashik", "nasik"],
  Gandhinagar: ["gandhinagar", "gandhi nagar"],
  Nagpur: ["nagpur"],
  Indore: ["indore"],
  Bhopal: ["bhopal"],
  Ludhiana: ["ludhiana"],
  Kanpur: ["kanpur"],
  Lucknow: ["lucknow"],
  Kochi: ["kochi", "cochin", "cocchi"],
  "Thiruvananthapuram": ["thiruvananthapuram", "trivandrum", "tvm"],
  Chandigarh: ["chandigarh", "chd"],
  Bhubaneswar: ["bhubaneswar", "bhubaneshwar", "bbsr"],
  Guwahati: ["guwahati", "gauhati"],
  Patna: ["patna"],
  Ranchi: ["ranchi"],
  Raipur: ["raipur"],
  Amritsar: ["amritsar"],
  Dehradun: ["dehradun", "dehra dun"],
  Srinagar: ["srinagar"],
  Goa: ["goa", "panaji", "panjim", "panaaji"],
  Shillong: ["shillong"],
  Agra: ["agra"],
  Varanasi: ["varanasi", "banaras"],
  Coimbatore: ["coimbatore", "kovai"],
  "Madurai": ["madurai"],
  Jodhpur: ["jodhpur"],
  Udaipur: ["udaipur"],
  Mysore: ["mysore", "mysuru"],
  Tirupur: ["tirupur", "tiruppur"],
  Ahmednagar: ["ahmednagar"],
  Aurangabad: ["aurangabad", "chh sambhajinagar"],
  Solapur: ["solapur", "sholapur"],
  Belgaum: ["belgaum", "belagavi"],
  Vijayawada: ["vijayawada"],
  Visakhapatnam: ["visakhapatnam", "vizag", "vishakhapatnam"],
  Guntur: ["guntur"],
  Warangal: ["warangal"],
  Nellore: ["nellore"],
  Kurnool: ["kurnool"],
  Kozhikode: ["kozhikode", "calicut"],
  Kannur: ["kannur", "cannanore"],
  Kollam: ["kollam", "quilon"],
  Alappuzha: ["alappuzha", "alleppey"],
  Palakkad: ["palakkad", "palghat"],
  Thrissur: ["thrissur", "trichur"],
  Erode: ["erode"],
  Salem: ["salem"],
  Trichy: ["trichy", "tiruchirappalli", "tiruchchirappalli"],
  Vellore: ["vellore"],
  Thanjavur: ["thanjavur", "tanjore"],
  Noida: ["noida", "greater noida"],
  Ghaziabad: ["ghaziabad", "ghazibad"],
  Meerut: ["meerut"],
  Aligarh: ["aligarh"],
  Gorakhpur: ["gorakhpur"],
  Jhansi: ["jhansi"],
  Bareilly: ["bareilly"],
  Moradabad: ["moradabad"],
  Gurgaon: ["gurgaon", "gurugram"],
  Faridabad: ["faridabad"],
  Ambala: ["ambala"],
  Panipat: ["panipat"],
  Kurukshetra: ["kurukshetra"],
  Hisar: ["hisar"],
  Rohtak: ["rohtak"],
  Jammu: ["jammu"],
  Shimla: ["shimla", "simla"],
  "Port Blair": ["port blair"],
  Puducherry: ["puducherry", "pondicherry"],
  Daman: ["daman", "daman and diu"],
  Siliguri: ["siliguri"],
  Asansol: ["asansol"],
  Durgapur: ["durgapur"],
  Dhanbad: ["dhanbad"],
  Jamshedpur: ["jamshedpur", "tata"],
  Bokaro: ["bokaro"],
  Gangtok: ["gangtok"],
  Imphal: ["imphal"],
  Dimapur: ["dimapur"],
  Kohima: ["kohima"],
  Aizawl: ["aizawl"],
  Agartala: ["agartala"],
  Itanagar: ["itanagar"],
  Naharlagun: ["naharlagun"],
  Tezpur: ["tezpur"],
  Silchar: ["silchar"],
  Dibrugarh: ["dibrugarh"],
  Bhavnagar: ["bhavnagar", "bhaunagar"],
  Jamnagar: ["jamnagar"],
  Morbi: ["morbi"],
  Gandhidham: ["gandhidham", "gandhidham"],
  Ankleshwar: ["ankleshwar", "ankaleshwar"],
  Bharuch: ["bharuch", "broach"],
  Vapi: ["vapi"],
  Valsad: ["valsad"],
  Navsari: ["navsari"],
  Mehsana: ["mehsana", "mahesana"],
  Palanpur: ["palanpur"],
  Dahod: ["dahod"],
  Godhra: ["godhra"],
  Anand: ["anand"],
  Nadiad: ["nadiad"],
  Surendranagar: ["surendranagar"],
  Junagadh: ["junagadh"],
  Porbandar: ["porbandar"],
  Veraval: ["veraval"],
  Amreli: ["amreli"],
};

/** Canonical city name -> state. Includes a broad set of Indian cities. */
const CITY_TO_STATE: Record<string, string> = {
  Ahmedabad: "Gujarat",
  Surat: "Gujarat",
  Rajkot: "Gujarat",
  Vadodara: "Gujarat",
  Bhavnagar: "Gujarat",
  Jamnagar: "Gujarat",
  Morbi: "Gujarat",
  Gandhidham: "Gujarat",
  Ankleshwar: "Gujarat",
  Bharuch: "Gujarat",
  Vapi: "Gujarat",
  Valsad: "Gujarat",
  Navsari: "Gujarat",
  Mehsana: "Gujarat",
  Palanpur: "Gujarat",
  Dahod: "Gujarat",
  Godhra: "Gujarat",
  Anand: "Gujarat",
  Nadiad: "Gujarat",
  Surendranagar: "Gujarat",
  Junagadh: "Gujarat",
  Porbandar: "Gujarat",
  Veraval: "Gujarat",
  Amreli: "Gujarat",
  Gandhinagar: "Gujarat",
  Mumbai: "Maharashtra",
  Pune: "Maharashtra",
  Nashik: "Maharashtra",
  Nagpur: "Maharashtra",
  Ahmednagar: "Maharashtra",
  Aurangabad: "Maharashtra",
  Solapur: "Maharashtra",
  Belgaum: "Karnataka",
  Bangalore: "Karnataka",
  Mysore: "Karnataka",
  Delhi: "Delhi",
  "New Delhi": "Delhi",
  Jaipur: "Rajasthan",
  Jodhpur: "Rajasthan",
  Udaipur: "Rajasthan",
  Kota: "Rajasthan",
  Ajmer: "Rajasthan",
  Alwar: "Rajasthan",
  Bikaner: "Rajasthan",
  Kolkata: "West Bengal",
  Siliguri: "West Bengal",
  Asansol: "West Bengal",
  Durgapur: "West Bengal",
  Chennai: "Tamil Nadu",
  Coimbatore: "Tamil Nadu",
  Madurai: "Tamil Nadu",
  Salem: "Tamil Nadu",
  Trichy: "Tamil Nadu",
  Vellore: "Tamil Nadu",
  Thanjavur: "Tamil Nadu",
  Erode: "Tamil Nadu",
  Tirupur: "Tamil Nadu",
  Hyderabad: "Telangana",
  Warangal: "Telangana",
  Vijayawada: "Andhra Pradesh",
  Visakhapatnam: "Andhra Pradesh",
  Guntur: "Andhra Pradesh",
  Nellore: "Andhra Pradesh",
  Kurnool: "Andhra Pradesh",
  Kochi: "Kerala",
  Thiruvananthapuram: "Kerala",
  Kozhikode: "Kerala",
  Kannur: "Kerala",
  Kollam: "Kerala",
  Alappuzha: "Kerala",
  Palakkad: "Kerala",
  Thrissur: "Kerala",
  Lucknow: "Uttar Pradesh",
  Kanpur: "Uttar Pradesh",
  Varanasi: "Uttar Pradesh",
  Agra: "Uttar Pradesh",
  Noida: "Uttar Pradesh",
  Ghaziabad: "Uttar Pradesh",
  Meerut: "Uttar Pradesh",
  Aligarh: "Uttar Pradesh",
  Gorakhpur: "Uttar Pradesh",
  Jhansi: "Uttar Pradesh",
  Bareilly: "Uttar Pradesh",
  Moradabad: "Uttar Pradesh",
  Indore: "Madhya Pradesh",
  Bhopal: "Madhya Pradesh",
  Gwalior: "Madhya Pradesh",
  Jabalpur: "Madhya Pradesh",
  Ujjain: "Madhya Pradesh",
  Chandigarh: "Chandigarh",
  Ludhiana: "Punjab",
  Amritsar: "Punjab",
  Jalandhar: "Punjab",
  Patiala: "Punjab",
  Patna: "Bihar",
  Gaya: "Bihar",
  Bhagalpur: "Bihar",
  Muzaffarpur: "Bihar",
  Ranchi: "Jharkhand",
  Jamshedpur: "Jharkhand",
  Dhanbad: "Jharkhand",
  Bokaro: "Jharkhand",
  Bhubaneswar: "Odisha",
  Cuttack: "Odisha",
  Rourkela: "Odisha",
  Guwahati: "Assam",
  Silchar: "Assam",
  Dibrugarh: "Assam",
  Tezpur: "Assam",
  Raipur: "Chhattisgarh",
  Bilaspur: "Chhattisgarh",
  Dehradun: "Uttarakhand",
  Haridwar: "Uttarakhand",
  Nainital: "Uttarakhand",
  Srinagar: "Jammu and Kashmir",
  Jammu: "Jammu and Kashmir",
  Gurgaon: "Haryana",
  Faridabad: "Haryana",
  Ambala: "Haryana",
  Panipat: "Haryana",
  Kurukshetra: "Haryana",
  Hisar: "Haryana",
  Rohtak: "Haryana",
  Shimla: "Himachal Pradesh",
  Dharamshala: "Himachal Pradesh",
  Panaji: "Goa",
  Margao: "Goa",
  Gangtok: "Sikkim",
  Imphal: "Manipur",
  Dimapur: "Nagaland",
  Kohima: "Nagaland",
  Aizawl: "Mizoram",
  Agartala: "Tripura",
  Itanagar: "Arunachal Pradesh",
  "Port Blair": "Andaman and Nicobar Islands",
  Puducherry: "Puducherry",
  Daman: "Dadra and Nagar Haveli and Daman and Diu",
  Silvassa: "Dadra and Nagar Haveli and Daman and Diu",
};

const collapse = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase().replace(/\./g, "");

/**
 * Normalize a raw state value to its canonical full name, or return null when
 * the value cannot be mapped.
 */
export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = collapse(raw);
  if (!key) return null;
  if ((INDIAN_STATES as readonly string[]).includes(raw.trim())) {
    return raw.trim();
  }
  for (const [canonical, aliases] of Object.entries(STATE_ALIASES)) {
    if (aliases.includes(key)) return canonical;
  }
  return null;
}

/** Normalize a raw city value to its canonical name (alias-aware), or the cleaned original. */
export function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = collapse(raw);
  if (!key) return null;
  const canonical = Object.entries(CITY_ALIASES).find(([, aliases]) => aliases.includes(key));
  if (canonical) return canonical[0];
  // Fall back to title-casing the cleaned original (e.g. "new delhi" -> "New Delhi")
  return raw.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Infer the canonical state from a known city. Returns null when the city is
 * not in the mapping.
 */
export function inferStateFromCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const canonicalCity = normalizeCity(city);
  if (canonicalCity) {
    const state = CITY_TO_STATE[canonicalCity];
    if (state) return state;
  }
  return null;
}

/**
 * Standardize a { city, state } pair for persistence:
 * - Normalizes state (alias -> canonical full name).
 * - Normalizes city spelling.
 * - Auto-fills state from a known city when state is empty or unmappable.
 */
export function normalizeStateCity(
  input: { city?: string | null; state?: string | null }
): { city: string | null; state: string | null } {
  const city = normalizeCity(input.city);
  const normalizedState = normalizeState(input.state);
  const inferred = normalizedState ?? inferStateFromCity(city);
  return {
    city,
    state: inferred,
  };
}
