import { test, expect } from "@playwright/test";
import { HomePage } from "../page-objects/HomePage";
import { BookingPage } from "../page-objects/BookingPage";
import { QuestionnairePage } from "../page-objects/QuestionnairePage";
import { TEST_USER } from "../fixtures/test-data";

test.describe("Strachans Pharmacy Smoke Tests", () => {
  test("Homepage should load and show key sections", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await expect(page).toHaveTitle(/Strachans? Pharmacy/i);
    await expect(homePage.nhsServicesSection).toBeVisible();
    await expect(homePage.privateServicesSection).toBeVisible();
  });

});
