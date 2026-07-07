export const UNITS = ["Himatnagar", "Surat", "Rajkot", "Not Sure"] as const;

export type Unit = typeof UNITS[number];
