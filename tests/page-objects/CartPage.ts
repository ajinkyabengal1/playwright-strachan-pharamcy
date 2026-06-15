import { Page } from "@playwright/test";
import { CART_PREFERENCES, CartPreferences } from "../fixtures/test-data";

export class CartPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async isVisible(): Promise<boolean> {
    const indicators = [
      "text=/shopping\\s*cart/i",
      "text=/your\\s*basket/i",
      ".cart-page",
      ".order-summary",
      'button:has-text("Proceed To Checkout")',
      'button:has-text("Proceed to Checkout")',
      'button:has-text("Apply")',
      'a:has-text("Proceed To Checkout")',
      'a:has-text("Proceed to Checkout")',
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
    const indicators = [
      "text=/shopping\\s*cart/i",
      "text=/order\\s*summary/i",
      'button:has-text("Proceed To Checkout")',
      'button:has-text("Proceed to Checkout")',
      'button:has-text("Apply")',
    ];

    await Promise.race(
      indicators.map((sel) =>
        this.page
          .locator(sel)
          .first()
          .waitFor({ state: "visible", timeout: 30_000 })
          .catch(() => {}),
      ),
    );
  }

  private async clickQuantity(action: "plus" | "minus", times: number) {
    if (times <= 0) return;

    const buttonText = action === "plus" ? "+" : "-";
    const qtyButton = this.page
      .locator("button")
      .filter({ hasText: new RegExp(`^\\s*\\${buttonText}\\s*$`) })
      .first();

    for (let i = 0; i < times; i++) {
      const visible = await qtyButton.isVisible().catch(() => false);
      if (!visible) break;
      const enabled = await qtyButton.isEnabled().catch(() => false);
      if (!enabled) break;

      await qtyButton.click({ force: true }).catch(async () => {
        await qtyButton.evaluate((el: HTMLElement) => el.click());
      });
      await this.page.waitForTimeout(300);
    }
  }

  private async deleteFirstProductIfNeeded(shouldDelete?: boolean) {
    if (!shouldDelete) return;

    const deleteBtn = this.page
      .locator(
        [
          "button:has(svg)",
          'button[aria-label*="delete" i]',
          'button[title*="delete" i]',
          '[class*="delete"]',
        ].join(", "),
      )
      .first();

    const visible = await deleteBtn.isVisible().catch(() => false);
    if (!visible) return;

    await deleteBtn.click({ force: true }).catch(async () => {
      await deleteBtn.evaluate((el: HTMLElement) => el.click());
    });
    await this.page.waitForTimeout(500);
  }

  private async applyCouponIfProvided(couponCode?: string) {
    const code = (couponCode ?? "").trim();
    if (!code) return;

    const couponInput = this.page
      .locator('input[placeholder*="coupon" i], input[placeholder*="code" i]')
      .first();

    const inputVisible = await couponInput.isVisible().catch(() => false);
    if (!inputVisible) return;

    await couponInput.fill("").catch(() => {});
    await couponInput.fill(code).catch(async () => {
      await couponInput.click({ force: true }).catch(() => {});
      await couponInput.type(code, { delay: 20 }).catch(() => {});
    });

    const applyBtn = this.page
      .locator('button:has-text("Apply"), input[type="button"][value="Apply"]')
      .first();

    const applyVisible = await applyBtn.isVisible().catch(() => false);
    if (!applyVisible) return;

    const enabled = await applyBtn.isEnabled().catch(() => false);
    if (!enabled) return;

    await applyBtn.click({ force: true }).catch(async () => {
      await applyBtn.evaluate((el: HTMLElement) => el.click());
    });
    await this.page.waitForTimeout(700);
  }

  private async clickCta(action: CartPreferences["action"]) {
    if (action === "Continue Shopping") {
      const continueButtons = this.page.locator(
        'button:has-text("Continue Shopping"), a:has-text("Continue Shopping"), text=/continue\\s*shopping/i',
      );
      const count = await continueButtons.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const continueBtn = continueButtons.nth(i);
        const visible = await continueBtn.isVisible().catch(() => false);
        if (!visible) continue;

        await continueBtn.scrollIntoViewIfNeeded().catch(() => {});
        await continueBtn.click({ force: true }).catch(async () => {
          await continueBtn.evaluate((el: HTMLElement) => el.click());
        });
        return;
      }
      return;
    }

    if (action === "Proceed To Checkout") {
      const checkoutButtons = this.page.locator(
        [
          'button:has-text("Proceed To Checkout")',
          'button:has-text("Proceed to Checkout")',
          'a:has-text("Proceed To Checkout")',
          'a:has-text("Proceed to Checkout")',
          "text=/proceed\\s*to\\s*checkout/i",
        ].join(", "),
      );
      const count = await checkoutButtons.count().catch(() => 0);
      const beforeUrl = this.page.url();

      for (let i = 0; i < count; i++) {
        const checkoutBtn = checkoutButtons.nth(i);
        const visible = await checkoutBtn.isVisible().catch(() => false);
        if (!visible) continue;

        await checkoutBtn.scrollIntoViewIfNeeded().catch(() => {});
        await checkoutBtn.click({ force: true }).catch(async () => {
          await checkoutBtn.evaluate((el: HTMLElement) => el.click());
        });
        const movedToCheckout = await this.page
          .waitForURL("**/checkout**", { timeout: 4000 })
          .then(() => true)
          .catch(() => false);
        if (movedToCheckout) return;

        const movedAway = this.page.url() !== beforeUrl;
        if (movedAway) return;
      }

      // Fallback: use href directly when click does not navigate.
      const checkoutHref = await this.page
        .locator('a[href*="/checkout"]')
        .first()
        .getAttribute("href")
        .catch(() => null);

      if (checkoutHref) {
        const target = checkoutHref.startsWith("http")
          ? checkoutHref
          : new URL(checkoutHref, this.page.url()).toString();
        await this.page
          .goto(target, { waitUntil: "domcontentloaded" })
          .catch(() => {});
        await this.page
          .waitForURL("**/checkout**", { timeout: 8000 })
          .catch(() => {});
      }
    }
  }

  async handleCart(
    prefs: CartPreferences = CART_PREFERENCES,
  ): Promise<boolean> {
    if (!(await this.isVisible())) return false;

    if (prefs.quantityAction === "plus") {
      await this.clickQuantity("plus", Math.max(0, prefs.quantityClicks ?? 0));
    } else if (prefs.quantityAction === "minus") {
      await this.clickQuantity("minus", Math.max(0, prefs.quantityClicks ?? 0));
    }

    await this.deleteFirstProductIfNeeded(prefs.deleteProduct);
    await this.applyCouponIfProvided(prefs.couponCode);
    await this.clickCta(prefs.action);

    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    await this.page.waitForTimeout(1000);
    return true;
  }
}
