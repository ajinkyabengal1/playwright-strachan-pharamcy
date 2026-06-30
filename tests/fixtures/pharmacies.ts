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
    baseURL: "https://strachans-pharamcy.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Health Check Pharmacy",
    baseURL: "https://health-check-pharmacy.vercel.app/",
    ciSkip: true,
  },
  {
    name: "Imaan Pharmacy Werneth",
    baseURL: "https://werneth.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Hunts Cross Pharmacy",
    baseURL: "https://hunts-cross.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Edgeley Pharmacy",
    baseURL: "https://edgeley.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Liverpool Road Pharmacy",
    baseURL: "https://liverpool-road.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Tupton Pharmacy",
    baseURL: "https://tupton.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Allestree Pharmacy",
    baseURL: "https://allestree.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Holmewood Pharmacy",
    baseURL: "https://holmewood.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Imaan Pharmacy Leeds",
    baseURL: "https://harehills.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Talbot Road Pharmacy",
    baseURL: "https://talbot-road.healthya.co.uk/",
    ciSkip: true,
  },
  {
    name: "Brunshaw Pharmacy",
    baseURL: "https://brunshaw.healthya.co.uk/",
    ciSkip: true,
  },
];
