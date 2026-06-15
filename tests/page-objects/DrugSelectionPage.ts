import { Page } from "@playwright/test";
import {
  DRUG_SELECTION_PREFERENCES,
  DrugSelectionPreferences,
} from "../fixtures/test-data";

export class DrugSelectionPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async isVisible(): Promise<boolean> {
    const indicators = [
      ':text("What\'s your preference?")',
      ".drug-selection-section",
      "button:has-text(\"Choose this Option\")",
      ".product-box-ui",
    ];

    for (const sel of indicators) {
      const visible = await this.page
        .locator(sel)
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (visible) return true;
    }

    return false;
  }

  async waitForPage() {
    await this.page.waitForLoadState("domcontentloaded");
    await this.page
      .locator(
        [
          ':text("What\'s your preference?")',
          ".drug-selection-section",
          "button:has-text(\"Choose this Option\")",
        ].join(", "),
      )
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  private async selectStrength(
    card: ReturnType<Page["locator"]>,
    strengthLabel: string,
  ): Promise<boolean> {
    const strengthGroup = card
      .locator("label")
      .filter({ hasText: /^Strength$/i })
      .first()
      .locator("xpath=following-sibling::*[1]");

    const option = strengthGroup
      .locator("label.ant-radio-wrapper, label")
      .filter({ hasText: new RegExp(`^\\s*${strengthLabel}\\s*$`, "i") })
      .first();

    if (!(await option.isVisible().catch(() => false))) return false;

    await option.scrollIntoViewIfNeeded().catch(() => {});
    await option.click({ force: true }).catch(async () => {
      await option.evaluate((el: HTMLElement) => el.click());
    });
    await this.page.waitForTimeout(400);
    return true;
  }

  private async selectPackSize(
    card: ReturnType<Page["locator"]>,
    packSizeLabel: string,
  ): Promise<boolean> {
    const packGroup = card
      .locator("label")
      .filter({ hasText: /^Pack Size$/i })
      .first()
      .locator("xpath=following-sibling::*[1]");

    const option = packGroup
      .locator("label.ant-radio-wrapper, label")
      .filter({ hasText: new RegExp(`\\b${packSizeLabel}\\b`, "i") })
      .first();

    if (!(await option.isVisible().catch(() => false))) return false;

    await option.scrollIntoViewIfNeeded().catch(() => {});
    await option.click({ force: true }).catch(async () => {
      await option.evaluate((el: HTMLElement) => el.click());
    });
    await this.page.waitForTimeout(400);
    return true;
  }

  async chooseDrugOption(
    prefs: DrugSelectionPreferences = DRUG_SELECTION_PREFERENCES,
  ): Promise<boolean> {
    if (!(await this.isVisible())) return false;

    const card = this.page.locator(".product-box-ui").first();
    if (!(await card.isVisible().catch(() => false))) return false;

    if (prefs.strength) {
      await this.selectStrength(card, prefs.strength);
    }

    if (prefs.packSize) {
      await this.selectPackSize(card, prefs.packSize);
    }

    const chooseButton = card
      .locator('button:has-text("Choose this Option")')
      .first();

    if (!(await chooseButton.isVisible().catch(() => false))) return false;

    await chooseButton.scrollIntoViewIfNeeded().catch(() => {});
    await chooseButton.click({ force: true }).catch(async () => {
      await chooseButton.evaluate((el: HTMLElement) => el.click());
    });

    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    await this.page.waitForTimeout(1200);
    return true;
  }
}
