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

  test("Should be able to navigate to a condition page and start booking", async ({ page }) => {
    const homePage = new HomePage(page);
    const bookingPage = new BookingPage(page);

    await homePage.goto();
    
    // Select an NHS service (e.g., Shingles)
    // We need to know the exact text from the website
    // For now, let's just use the first link in NHS services section
    const firstNhsService = homePage.nhsServicesSection.getByRole("link").first();
    await firstNhsService.click();

    // Now on Condition Page
    await expect(page).toHaveURL(/.*\/conditions\/.*/);
    
    // Step 1: Date & Time
    await bookingPage.selectAppointmentType("Video Call");
    await bookingPage.selectFirstAvailableSlot();
    await bookingPage.clickNextStep();

    // Step 2: Patient Info
    await bookingPage.fillPatientInfo(TEST_USER);
    await bookingPage.clickNextStep();

    // Step 3: Verify Contact
    await bookingPage.performPdsSearch();
    await bookingPage.confirmBooking();

    // Success Page
    await expect(bookingPage.bookingConfirmedHeading).toBeVisible({ timeout: 15000 });
  });
});
