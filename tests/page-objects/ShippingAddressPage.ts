import { Page } from "@playwright/test";
import {
  SHIPPING_ADDRESS_PREFERENCES,
  ShippingAddressPreferences,
} from "../fixtures/test-data";

export class ShippingAddressPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async isVisible(): Promise<boolean> {
    const indicators = [
      "text=/shipping address/i",
      "text=/select delivery address/i",
      "text=/payment method/i",
      'button:has-text("Save Address")',
    ];

    for (const sel of indicators) {
      const nodes = this.page.locator(sel);
      const count = await nodes.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 5); i++) {
        const visible = await nodes
          .nth(i)
          .isVisible({ timeout: 300 })
          .catch(() => false);
        if (visible) return true;
      }
    }

    return false;
  }

  private async selectRadioByLabel(
    label: string,
    scope?: ReturnType<Page["locator"]>,
  ): Promise<boolean> {
    const root = scope ?? this.page.locator("body");
    const option = root
      .locator(
        [
          `label:has-text("${label}")`,
          `.ant-radio-wrapper:has-text("${label}")`,
          `[role="radio"]:has-text("${label}")`,
        ].join(", "),
      )
      .first();

    if (!(await option.isVisible().catch(() => false))) return false;
    await option.scrollIntoViewIfNeeded().catch(() => {});
    await option.click({ force: true }).catch(async () => {
      await option.evaluate((el: HTMLElement) => el.click());
    });
    await this.page.waitForTimeout(250);
    return true;
  }

  private async fillTextInputByLabel(
    label: string,
    value: string,
  ): Promise<boolean> {
    if (!value) return true;

    const fieldWrapper = this.page
      .locator(`.form-group:has(label:has-text("${label}"))`)
      .first();

    let input = fieldWrapper.locator("input").first();
    if (!(await input.isVisible().catch(() => false))) {
      // fallback by placeholder keywords
      if (/address line 1/i.test(label)) {
        input = this.page
          .locator('input[placeholder*="Address Line 1" i], input')
          .first();
      } else if (/address line 2/i.test(label)) {
        input = this.page
          .locator('input[placeholder*="Address Line 2" i], input')
          .nth(1);
      } else if (/town|city/i.test(label)) {
        input = this.page
          .locator('input[placeholder*="Town" i], input[placeholder*="City" i]')
          .first();
      } else if (/postal code/i.test(label)) {
        input = this.page
          .locator(
            'input[placeholder*="Postal" i], input[placeholder*="Postcode" i]',
          )
          .first();
      }
    }

    if (!(await input.isVisible().catch(() => false))) return false;

    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.click({ force: true }).catch(() => {});
    await input.fill("").catch(() => {});
    await input.fill(value).catch(async () => {
      await input.type(value, { delay: 20 }).catch(() => {});
    });
    await input.blur().catch(() => {});
    return true;
  }

  async handleShippingAddress(
    prefs: ShippingAddressPreferences = SHIPPING_ADDRESS_PREFERENCES,
  ): Promise<boolean> {
    if (!(await this.isVisible())) return false;

    // SHIPPING MODE
    await this.selectRadioByLabel(
      prefs.shippingMode === "pharmacy"
        ? "Collect from Pharmacy"
        : "Home Delivery",
    );

    // CHECK IF ADDRESS FORM EXISTS
    const addressLine1Input = this.page
      .locator("input")
      .filter({
        has: this.page.locator(
          'xpath=ancestor::*[contains(.,"Address Line 1")]',
        ),
      })
      .first();

    const hasAddressForm = await addressLine1Input
      .isVisible()
      .catch(() => false);

    // ONLY FILL ADDRESS IF FORM IS VISIBLE
    if (hasAddressForm) {
      await this.selectRadioByLabel(prefs.addressType);

      await this.fillTextInputByLabel("Address Line 1", prefs.addressLine1);

      await this.fillTextInputByLabel(
        "Address Line 2",
        prefs.addressLine2 ?? "",
      );

      await this.fillTextInputByLabel("Town / City", prefs.townCity);

      await this.fillTextInputByLabel("Postal Code", prefs.postalCode);

      // SAVE ADDRESS
      if (prefs.addressAction === "save") {
        const saveBtn = this.page.locator('button:has-text("Save Address")');

        if (await saveBtn.isVisible().catch(() => false)) {
          await saveBtn.click({ force: true }).catch(async () => {
            await saveBtn.evaluate((el: HTMLElement) => el.click());
          });

          await this.page.waitForTimeout(1500);
        }
      }
    }

    // PAYMENT METHOD
    await this.selectRadioByLabel(prefs.paymentMethod);

    await this.page.waitForTimeout(1000);

    // PAY NOW BUTTON
    const payNowBtn = this.page
      .locator(
        [
          'button:has-text("Pay Now")',
          'button:has-text("Place Order")',
          'button:has-text("Complete Order")',
        ].join(", "),
      )
      .first();

    if (await payNowBtn.isVisible().catch(() => false)) {
      await payNowBtn.scrollIntoViewIfNeeded().catch(() => {});

      await payNowBtn.click({ force: true }).catch(async () => {
        await payNowBtn.evaluate((el: HTMLElement) => el.click());
      });

      await this.page.waitForTimeout(3000);
    }

    return true;
  }
}
