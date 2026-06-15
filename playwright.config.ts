import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";
import * as path from "path";
import { PHARMACY_SITES } from "./tests/fixtures/pharmacies";

dotenv.config({ path: path.resolve(__dirname, ".env") });

/**
 * CI / one-off override: set BASE_URL in the environment to run against a
 * single pharmacy without touching pharmacies.ts.
 * When BASE_URL is set it takes precedence and a single "CI Override" project
 * is created instead of the full pharmacy list.
 */
const ciBaseURL = process.env.BASE_URL;
const isCI = !!process.env.CI;

const projects = ciBaseURL
  ? [{ name: "CI Override", use: { ...devices["Desktop Chrome"], baseURL: ciBaseURL, headless: true } }]
  : PHARMACY_SITES.filter((site) => !(isCI && site.ciSkip)).map((site) => ({
      name: site.name,
      use: { ...devices["Desktop Chrome"], baseURL: site.baseURL, headless: true },
    }));

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 300_000, // 5 min — sign-up Confirm can take up to 60 s per attempt
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    headless: true,
    trace: "on",
    screenshot: "only-on-failure",
    video: "on",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects,
});
