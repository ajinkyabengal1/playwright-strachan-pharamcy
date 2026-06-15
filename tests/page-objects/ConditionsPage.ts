import { Page, Locator } from "@playwright/test";

/**
 * Slugs or URL fragments that indicate a condition is for children / paediatrics.
 * These conditions have age-based eligibility that rejects adults — skip them.
 */
const CHILD_CONDITION_PATTERNS = [
  "children",
  "child",
  "paediatric",
  "pediatric",
  "infant",
  "baby",
  "toddler",
  "neonatal",
];

export class ConditionsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/", { waitUntil: "domcontentloaded" });
    // Dismiss cookie consent banner if it appears (blocks condition card clicks)
    await this.page
      .locator(
        'button:has-text("Accept All"), button:has-text("Accept Cookies")',
      )
      .first()
      .click()
      .catch(() => {}); // silently skip if banner not present
  }

  /**
   * Wait for at least one condition card link to appear on the page.
   */
  async waitForConditions() {
    await this.page
      .locator('a[href*="/conditions/"]')
      .first()
      .waitFor({ state: "visible" });
  }

  /**
   * Returns all condition card anchor elements.
   */
  getAllConditionLinks(): Locator {
    return this.page.locator('a[href*="/conditions/"]');
  }

  /**
   * Returns the href of the first adult-appropriate condition card.
   * Skips children's/paediatric conditions since the test user is an adult (born 1990)
   * and those conditions reject adults at the eligibility check, preventing questionnaire.
   */
  async getFirstConditionHref(): Promise<string> {
    const links = this.getAllConditionLinks();
    const count = await links.count();

    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      if (!href) continue;

      const slug = href.toLowerCase();
      const isChildCondition = CHILD_CONDITION_PATTERNS.some((pattern) =>
        slug.includes(pattern),
      );

      if (!isChildCondition) {
        return href;
      }
    }

    // Fallback: return the very first if all conditions match child patterns
    const firstHref = await links.first().getAttribute("href");
    if (!firstHref)
      throw new Error("No condition card link found on /conditions");
    return firstHref;
  }

  /**
   * Returns the href of the condition matching the given name (case-insensitive).
   * Searches for conditions containing the name in the href or text.
   */
  async getConditionHrefByName(name: string): Promise<string> {
    const links = this.getAllConditionLinks();
    const count = await links.count();

    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      const text = await links.nth(i).innerText();
      if (!href) continue;

      const slug = href.toLowerCase();
      const conditionText = text.toLowerCase();
      if (
        slug.includes(name.toLowerCase()) ||
        conditionText.includes(name.toLowerCase())
      ) {
        return href;
      }
    }

    throw new Error(`Condition "${name}" not found on /conditions`);
  }

  /**
   * Returns the href of the condition matching the sanity slug.
   * Cleans up -nhs, -private, etc. from the dashboard slug to match frontend URLs.
   */
  async getConditionHrefBySlug(slug: string): Promise<string> {
    const cleanSlug = slug.replace("-nhs", "").replace("-private", "").replace("-clinical", "");
    const links = this.getAllConditionLinks();
    const count = await links.count();

    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      if (href && href.includes(cleanSlug)) {
        return href;
      }
    }

    throw new Error(`Condition matching slug "${slug}" (cleaned to "${cleanSlug}") not found on page`);
  }

  /**
   * Extracts the pharmacy slug from a condition detail href.
   * Href format: /{pharmacySlug}/conditions/{conditionSlug}
   */
  extractPharmacySlug(href: string): string {
    const parts = href.replace(/^\//, "").split("/").filter(Boolean);

    // Handle both legacy /{pharmacySlug}/conditions/{conditionSlug}
    // and the current root /conditions/{conditionSlug} route.
    if (parts.length >= 3 && parts[1] === "conditions") {
      return parts[0];
    }

    if (parts.length === 2 && parts[0] === "conditions") {
      return "";
    }

    throw new Error(
      `Unexpected condition href format: "${href}". Expected /{pharmacySlug}/conditions/{conditionSlug} or /conditions/{conditionSlug}`,
    );
  }

  /**
   * Click the condition card matching the given href.
   */
  async clickConditionByHref(href: string) {
    await this.page.locator(`a[href="${href}"]`).first().click();
  }

  /** @deprecated use getFirstConditionHref + clickConditionByHref */
  async clickFirstCondition() {
    await this.getAllConditionLinks().first().click();
  }

  /**
   * Types a search term into the health conditions search box and clicks Search.
   * Waits for results to appear after submission.
   */
  async searchCondition(term: string) {
    const searchInput = this.page.locator(
      'input[placeholder*="health conditions"], input[placeholder*="stomach ache"]',
    );
    await searchInput.waitFor({ state: "visible" });
    await searchInput.clear();
    await searchInput.fill(term);

    const searchButton = this.page.locator('button:has-text("Search")');
    await searchButton.click();

    // Wait for results to load after search
    await this.page
      .locator('a[href*="/conditions/"]')
      .first()
      .waitFor({ state: "visible" });
  }
}
