import { test, expect } from "@playwright/test";
import { HomePage } from "../page-objects/HomePage";
import { BookingPage } from "../page-objects/BookingPage";
import { QuestionnairePage } from "../page-objects/QuestionnairePage";
import { TEST_USER } from "../fixtures/test-data";

test.describe("Pharmacy Smoke Tests", () => {
  test("Homepage should load and show key sections", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    // ROOT CAUSE (failing on every non-Strachans pharmacy): this hardcoded
    // /Strachans? Pharmacy/i, which only matches Strachans' own <title> —
    // e.g. Health Check Pharmacy's real title is "Health check pharamcy |
    // HealthCheck Pharmacy", so the regex never matches there. This spec
    // runs against every project in PHARMACY_SITES (playwright.config.ts),
    // so the check needs to be brand-agnostic, not Strachans-specific —
    // every tenant's <title> does contain the word "Pharmacy".
    await expect(page).toHaveTitle(/Pharmacy/i);
    await expect(homePage.nhsServicesSection).toBeVisible();
    await expect(homePage.privateServicesSection).toBeVisible();
  });

});
