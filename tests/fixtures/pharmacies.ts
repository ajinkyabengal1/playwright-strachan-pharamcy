export interface PharmacySite {
  name: string;
  baseURL: string;
  /** Set to true for sites only reachable locally (e.g. localhost). Excluded when CI=true. */
  ciSkip?: boolean;
}

/**
 * Add or remove pharmacy sites here.
 * Each entry becomes a separate Playwright project — visible as a checkbox
 * in `playwright test --ui` and selectable via `--project="<name>"` on the CLI.
 */
export const PHARMACY_SITES: PharmacySite[] = [
  {
    name: "Strachans Pharmacy",
    baseURL: "https://strachan-pharmacy.vercel.app/",
    ciSkip: true,
  },
  {
    name: "Health Check Pharmacy",
    baseURL: "https://health-check-pharmacy.vercel.app/",
    ciSkip: true,
  },
  {
    name: "Kepple Lane Pharmacy",
    baseURL: "http://localhost:4012",
    ciSkip: true,
  },
  {
    name: "Central Pharmacy",
    baseURL: "https://central-pharmacy.vercel.app/",
    ciSkip: true,
  },
  {
    name: "Icare Pharmacy",
    baseURL: "https://icare-pharmacy.vercel.app/",
    ciSkip: true,
  },
];
