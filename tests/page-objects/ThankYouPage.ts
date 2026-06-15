import { Page } from "@playwright/test";
import {
  THANK_YOU_PREFERENCES,
  ThankYouPreferences,
} from "../fixtures/test-data";

export class ThankYouPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async isVisible(): Promise<boolean> {
    const textSelectors = [
      'text="Thank you!"',
      'text="thank you!"',
      'text="Thank you for your order!"',
      'text="Your answers have been shared"',
      'text="Back to Home"',
      'text="My Orders"',
      'text="Continue Shopping"',
      'text="Order Summary"',
    ];

    for (const sel of textSelectors) {
      const node = this.page.locator(sel).first();
      if (await node.isVisible().catch(() => false)) {
        return true;
      }
    }

    return false;
  }

  async handleThankYou(
    prefs: ThankYouPreferences = THANK_YOU_PREFERENCES,
  ): Promise<boolean> {
    if (!(await this.isVisible())) return false;

    const target =
      prefs.action === "My Orders"
        ? this.page
            .locator(
              'a:has-text("My Orders"), button:has-text("My Orders"), text=/my\s*orders/i',
            )
            .first()
        : this.page
            .locator(
              'a:has-text("Continue Shopping"), button:has-text("Continue Shopping"), text=/continue\s*shopping/i, button:has-text("Back to Home"), a:has-text("Back to Home"), text=/back\s*to\s*home/i',
            )
            .first();

    if (await target.isVisible().catch(() => false)) {
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await target.click({ force: true }).catch(async () => {
        await target.evaluate((el: HTMLElement) => el.click());
      });
      await this.page.waitForLoadState("domcontentloaded").catch(() => {});
      await this.page.waitForTimeout(1000);
      return true;
    }

    return false;
  }
}
