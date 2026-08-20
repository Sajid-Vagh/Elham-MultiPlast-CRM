/**
 * Shared constants used across the CRM.
 * Kept in one place so every module uses the same options.
 */

/**
 * Full list of industries.
 * Used by Product creation, Lead Form, Lead inline edit and Import preview.
 */
export const INDUSTRIES: string[] = [
  "Liquid Detergents",
  "Lubricants",
  "Agro Chemicals and Pesticides",
  "Veterinary Products",
  "Edible Oil",
  "Chemicals",
  "Cosmetics",
  "Pharmaceutical",
  "Other",
];

/**
 * Canonical list of Indian states & union territories.
 * Used by the Lead Form State dropdown and Import preview.
 */
export const INDIAN_STATES: string[] = [
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
];

/**
 * Cities grouped by state.
 * Used by the Lead Form City autocomplete — dropdown filters to the selected state's cities,
 * or shows all cities when no state is selected.
 */
export const CITIES_BY_STATE: Record<string, string[]> = {
  "Gujarat": [
    "Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar",
    "Junagadh", "Gandhinagar", "Anand", "Navsari", "Morbi", "Mehsana",
    "Bharuch", "Vapi", "Valsad", "Himatnagar", "Palanpur", "Bharuch",
    "Godhra", "Patan", "Porbandar", "Veraval", "Dwarka", "Surendranagar",
    "Amreli", "Gondal", "Jetpur", "Siddhpur", "Unjha", "Visnagar",
  ],
  "Maharashtra": [
    "Mumbai", "Pune", "Nagpur", "Thane", "Navi Mumbai", "Nashik",
    "Aurangabad", "Solapur", "Kolhapur", "Sangli", "Jalna", "Ahmednagar",
    "Latur", "Chandrapur", "Akola", "Yavatmal", "Amravati", "Wardha",
    "Satara", "Ratnagiri",
  ],
  "Rajasthan": [
    "Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner",
    "Alwar", "Bhilwara", "Sikar", "Pali", "Kishangarh", "Mount Abu",
    "Chittorgarh", "Nagpur", "Baran", "Dungarpur",
  ],
  "Madhya Pradesh": [
    "Bhopal", "Indore", "Gwalior", "Jabalpur", "Ujjain", "Sagar",
    "Satna", "Dewas", "Rewa", "Murwara", "Bhind", "Chhindwara",
  ],
  "Delhi": ["New Delhi"],
  "Karnataka": [
    "Bengaluru", "Mysuru", "Hubli-Dharwad", "Mangaluru", "Belgaum",
    "Gulbarga", "Davangere", "Bellary", "Shimoga", "Tumkur",
  ],
  "Tamil Nadu": [
    "Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem",
    "Tirunelveli", "Erode", "Vellore", "Thoothukudi", "Dindigul",
  ],
  "Uttar Pradesh": [
    "Lucknow", "Noida", "Ghaziabad", "Agra", "Varanasi", "Meerut",
    "Kanpur", "Prayagraj", "Bareilly", "Aligarh", "Jhansi", "Agra",
  ],
  "Haryana": [
    "Gurugram", "Faridabad", "Panipat", "Karnal", "Ambala", "Hisar",
    "Sonipat", "Rohtak", "Panchkula",
  ],
  "Punjab": [
    "Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda",
    "Mohali", "Hoshiarpur", "Moga", "Pathankot",
  ],
  "West Bengal": [
    "Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri",
    "Bardhaman", "Kharagpur",
  ],
  "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur"],
  "Andhra Pradesh": [
    "Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Kakinada",
    "Rajahmundry", "Nellore",
  ],
  "Telangana": [
    "Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam",
  ],
  "Goa": ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda"],
  "Kerala": [
    "Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur", "Kottayam",
    "Alappuzha", "Kollam",
  ],
  "Jammu and Kashmir": ["Srinagar", "Jammu"],
  "Chandigarh": ["Chandigarh"],
  "Uttarakhand": ["Dehradun", "Haridwar", "Haldwani", "Roorkee"],
  "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro"],
  "Chhattisgarh": ["Raipur", "Bhilai", "Bilaspur", "Korba"],
  "Assam": ["Guwahati", "Silchar", "Dibrugarh", "Jorhat"],
  "Bihar": ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur"],
  "Himachal Pradesh": ["Shimla", "Manali", "Dharamsala", "Mandi"],
  "Sikkim": ["Gangtok"],
  "Manipur": ["Imphal"],
  "Meghalaya": ["Shillong"],
  "Mizoram": ["Aizawl"],
  "Nagaland": ["Kohima", "Dimapur"],
  "Tripura": ["Agartala"],
  "Arunachal Pradesh": ["Itanagar"],
  "Ladakh": ["Leh", "Kargil"],
  "Andaman and Nicobar Islands": ["Port Blair"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Daman", "Diu", "Silvassa"],
  "Lakshadweep": ["Kavaratti"],
  "Puducherry": ["Puducherry"],
};
