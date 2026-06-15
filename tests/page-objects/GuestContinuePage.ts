import { Page } from "@playwright/test";

export class GuestContinuePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private async isGuestUiVisible(): Promise<boolean> {
    const indicators = [
      ".continue-guest-box",
      "text=/continue\\s+as\\s+guest/i",
      "text=/proceed\\s+as\\s+a\\s+guest/i",
    ];

    for (const sel of indicators) {
      const items = this.page.locator(sel);
      const count = await items.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 6); i++) {
        const visible = await items
          .nth(i)
          .isVisible({ timeout: 300 })
          .catch(() => false);
        if (visible) return true;
      }
    }

    return false;
  }

  private async robustClick(target: ReturnType<Page["locator"]>) {
    const clicked = await target
      .click({ timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (clicked) return;

    const forced = await target
      .click({ force: true, timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (forced) return;

    const box = await target.boundingBox().catch(() => null);
    if (box) {
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }

    await target.evaluate((el: HTMLElement) => {
      el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async continueAsGuestIfVisible(): Promise<boolean> {
    if (!(await this.isGuestUiVisible())) return false;

    const selectors = [
      ".continue-guest-box button",
      'button:has-text("Continue as Guest")',
      'a:has-text("Continue as Guest")',
      '[role="button"]:has-text("Continue as Guest")',
      "text=/continue\\s+as\\s+guest/i",
    ];

    for (let attempt = 0; attempt < 8; attempt++) {
      const beforeUrl = this.page.url();

      const roleButtons = this.page.getByRole("button", {
        name: /continue\s+as\s+guest/i,
      });
      const roleCount = await roleButtons.count().catch(() => 0);
      for (let i = 0; i < Math.min(roleCount, 5); i++) {
        const candidate = roleButtons.nth(i);
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) continue;
        const enabled = await candidate.isEnabled().catch(() => true);
        if (!enabled) continue;
        await candidate.scrollIntoViewIfNeeded().catch(() => {});
        await this.robustClick(candidate);
        await this.page.waitForLoadState("domcontentloaded").catch(() => {});
        const moved = this.page.url() !== beforeUrl;
        if (moved || !(await this.isGuestUiVisible())) return true;
      }

      for (const sel of selectors) {
        const nodes = this.page.locator(sel);
        const count = await nodes.count().catch(() => 0);
        for (let i = 0; i < Math.min(count, 8); i++) {
          const guestButton = nodes.nth(i);
          const visible = await guestButton.isVisible().catch(() => false);
          if (!visible) continue;
          const enabled = await guestButton.isEnabled().catch(() => true);
          if (!enabled) continue;
          await guestButton.scrollIntoViewIfNeeded().catch(() => {});
          await this.robustClick(guestButton);
          await this.page.waitForLoadState("domcontentloaded").catch(() => {});
          const moved = this.page.url() !== beforeUrl;
          if (moved || !(await this.isGuestUiVisible())) return true;
        }
      }

      await this.page.keyboard.press("Enter").catch(() => {});
      await this.page.waitForTimeout(400);
    }

    return false;
  }
}
