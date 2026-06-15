import { Page } from "@playwright/test";

export type PaymentMethod = "auto" | "new-card" | "saved-card";

export class PaymentPage {
  readonly page: Page;
  private hasClickedPay = false;
  private bookingFlowCompleted = false;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForPage() {
    await this.page.waitForLoadState("domcontentloaded");
    await this.page
      .locator(
        [
          ':text("Complete your payment")',
          ':text("Enter your card details here")',
          ':text("Cardholder name")',
          ':text("Card number")',
          'button:has-text("Pay")',
        ].join(", "),
      )
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  private getPaymentScope() {
    return this.page
      .locator(
        [
          'section:has-text("Complete your payment")',
          'div:has-text("Complete your payment"):has(input)',
          'form:has(:text("Cardholder name"))',
          'form:has(:text("Card number"))',
        ].join(", "),
      )
      .first();
  }

  async isPaymentPage(): Promise<boolean> {
    const indicators = await Promise.all([
      this.page
        .locator('input[placeholder*="Name on card"]')
        .first()
        .isVisible()
        .catch(() => false),

      this.page
        .locator("iframe")
        .first()
        .isVisible()
        .catch(() => false),

      this.page
        .locator(':text("Enter your card details here")')
        .first()
        .isVisible()
        .catch(() => false),

      this.page
        .locator(':text("Cardholder name")')
        .first()
        .isVisible()
        .catch(() => false),
    ]);

    const matched = indicators.filter(Boolean).length;

    console.log(`[PaymentPage] Payment indicators matched: ${matched}`);

    return matched >= 2;
  }

  /**
   * Single fast probe that detects which scenario we are in.
   * Runs all checks in parallel — no serial timeout chains.
   *
   * "saved_card_selected"  — "Select a saved card" text visible, no manual inputs
   * "manual_form"          — card input fields present
   * "unknown"              — page still loading
   */
  private async detectPaymentScenario(): Promise<
    "saved_card_selected" | "manual_form" | "unknown"
  > {
    const [savedCardTextVisible, cardholderVisible, cardNumberVisible] =
      await Promise.all([
        this.page
          .locator(':text("Select a saved card")')
          .first()
          .isVisible({ timeout: 800 })
          .catch(() => false),
        this.page
          .locator(
            'input[name*="cardholder"], input[id*="cardholder"], input[autocomplete="cc-name"]',
          )
          .first()
          .isVisible({ timeout: 800 })
          .catch(() => false),
        this.page
          .locator(
            'input[name*="cardNumber"], input[id*="cardNumber"], input[autocomplete="cc-number"]',
          )
          .first()
          .isVisible({ timeout: 800 })
          .catch(() => false),
      ]);

    const manualFieldsVisible = cardholderVisible || cardNumberVisible;

    if (savedCardTextVisible && !manualFieldsVisible) {
      return "saved_card_selected";
    }
    if (manualFieldsVisible) {
      return "manual_form";
    }
    return "unknown";
  }

  /**
   * Only called in the saved-card scenario.
   * Single fast aria/class check — clicks only if nothing is already selected.
   */
  private async ensureSavedCardSelected(): Promise<void> {
    const alreadySelected = await this.page
      .locator(
        [
          ".ant-radio-wrapper-checked",
          ".ant-radio-button-wrapper-checked",
          '[role="radio"][aria-checked="true"]',
          'input[type="radio"]:checked',
          '[class*="selected"]:has(:text("****"))',
          '[class*="active"]:has(:text("****"))',
        ].join(", "),
      )
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);

    if (alreadySelected) {
      console.log("[PaymentPage] Card already selected — skipping click");
      return;
    }

    const cardOption = this.page
      .locator(
        [
          'label:has(input[type="radio"])',
          ".ant-radio-wrapper",
          '[role="radio"]',
          'input[type="radio"]',
        ].join(", "),
      )
      .first();

    const visible = await cardOption
      .isVisible({ timeout: 1_000 })
      .catch(() => false);

    if (visible) {
      await cardOption.click({ force: true }).catch(async () => {
        await cardOption.evaluate((el: HTMLElement) => el.click());
      });
      await this.page.waitForTimeout(200);
      console.log("[PaymentPage] Clicked card option to select it");
    }
  }

  private getChallengeScope() {
    return this.page
      .locator(
        [
          ':text("3dsecure.io")',
          ':text("sandbox stand-in challenge page")',
          ':text("Pass challenge")',
          ':text("Fail challenge")',
        ].join(", "),
      )
      .first();
  }

  private async findChallengeFrameIndex(): Promise<number> {
    const frames = this.page.frames();
    for (let i = 0; i < frames.length; i++) {
      const visible = await frames[i]
        .locator(
          [
            'button:has-text("Pass challenge")',
            ':text("Pass challenge")',
            ':text("3dsecure.io")',
          ].join(", "),
        )
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) return i;
    }
    return -1;
  }

  async isChallengeVisible(): Promise<boolean> {
    const pageChallengeVisible = await this.getChallengeScope()
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
    if (pageChallengeVisible) return true;
    return (await this.findChallengeFrameIndex()) >= 0;
  }

  private async fillField(
    locator: ReturnType<Page["locator"]>,
    value: string,
    fieldName: string,
  ) {
    const visible = await locator
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    if (!visible) {
      console.log(
        `[PaymentPage] ${fieldName} input not visible — skipping manual fill`,
      );
      return;
    }

    await locator.waitFor({ state: "visible", timeout: 5_000 });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click();
    await locator.clear().catch(() => {});
    await locator.fill(value);
    await this.page.waitForTimeout(150);
    const currentValue = await locator.inputValue().catch(() => "");
    console.log(
      `[PaymentPage] ${fieldName} value after fill: "${currentValue}"`,
    );
  }

  private cardholderInput() {
    const scope = this.getPaymentScope();
    return scope
      .locator(
        [
          'label:has-text("Cardholder name")',
          ':text("Cardholder name")',
          'input[name*="cardholder"]',
          'input[id*="cardholder"]',
          'input[autocomplete="cc-name"]',
        ].join(", "),
      )
      .locator("xpath=following::input[1]")
      .first()
      .or(
        scope
          .locator(
            'input[name*="cardholder"], input[id*="cardholder"], input[autocomplete="cc-name"], input[type="text"]',
          )
          .first(),
      );
  }

  private cardNumberInput() {
    const scope = this.getPaymentScope();
    return scope
      .locator(
        [
          'label:has-text("Card number")',
          ':text("Card number")',
          'input[name*="cardNumber"]',
          'input[id*="cardNumber"]',
          'input[autocomplete="cc-number"]',
        ].join(", "),
      )
      .locator("xpath=following::input[1]")
      .first()
      .or(
        scope
          .locator(
            'input[name*="cardNumber"], input[id*="cardNumber"], input[autocomplete="cc-number"]',
          )
          .first(),
      )
      .or(scope.locator("input").nth(1));
  }

  private expiryInput() {
    const scope = this.getPaymentScope();
    return scope
      .locator(
        [
          'label:has-text("Expiry date")',
          ':text("Expiry date")',
          'input[name*="expiry"]',
          'input[id*="expiry"]',
          'input[autocomplete="cc-exp"]',
        ].join(", "),
      )
      .locator("xpath=following::input[1]")
      .first()
      .or(
        scope
          .locator(
            'input[name*="expiry"], input[id*="expiry"], input[autocomplete="cc-exp"]',
          )
          .first(),
      )
      .or(scope.locator("input").nth(2));
  }

  private securityCodeInput() {
    const scope = this.getPaymentScope();
    return scope
      .locator(
        [
          'label:has-text("Security code")',
          ':text("Security code")',
          'input[name*="security"]',
          'input[name*="cvv"]',
          'input[id*="security"]',
          'input[autocomplete="cc-csc"]',
        ].join(", "),
      )
      .locator("xpath=following::input[1]")
      .first()
      .or(
        scope
          .locator(
            'input[name*="security"], input[name*="cvv"], input[id*="security"], input[autocomplete="cc-csc"]',
          )
          .first(),
      )
      .or(scope.locator("input").nth(3));
  }

  async fillPaymentDetails(data: {
    cardholderName: string;
    cardNumber: string;
    expiryDate: string;
    securityCode: string;
  }) {
    console.log("[PaymentPage] Filling manual payment form");

    // ─────────────────────────────────────────────────────
    // Cardholder Name
    // ─────────────────────────────────────────────────────
    const cardholder = this.page
      .locator(
        [
          'input[placeholder*="Name on card"]',
          'input[autocomplete="cc-name"]',
          'input[type="text"]',
        ].join(", "),
      )
      .first();

    if (await cardholder.isVisible().catch(() => false)) {
      await cardholder.click();
      await cardholder.press("Control+a").catch(() => {});
      await cardholder.fill(data.cardholderName);

      console.log("[PaymentPage] Cardholder filled");
    }

    // ─────────────────────────────────────────────────────
    // Find ALL iframes
    // ─────────────────────────────────────────────────────
    const frames = this.page.frames();

    console.log(`[PaymentPage] Total frames: ${frames.length}`);

    for (const frame of frames) {
      try {
        // Debug visible inputs inside frame
        const inputs = await frame.locator("input").count();

        console.log(
          `[PaymentPage] Frame URL: ${frame.url()} | inputs: ${inputs}`,
        );

        // ── Card Number ─────────────────────
        const cardNumberInput = frame
          .locator(
            [
              'input[name="cardnumber"]',
              'input[autocomplete="cc-number"]',
              'input[inputmode="numeric"]',
              'input[placeholder*="1234"]',
              'input[placeholder*="Card number"]',
            ].join(", "),
          )
          .first();

        if (await cardNumberInput.isVisible().catch(() => false)) {
          await cardNumberInput.click();
          await cardNumberInput.fill(data.cardNumber);

          console.log("[PaymentPage] Card number filled");
        }

        // ── Expiry ──────────────────────────
        const expiryInput = frame
          .locator(
            [
              'input[name="exp-date"]',
              'input[autocomplete="cc-exp"]',
              'input[placeholder*="MM"]',
              'input[placeholder*="MM/YY"]',
            ].join(", "),
          )
          .first();

        if (await expiryInput.isVisible().catch(() => false)) {
          await expiryInput.click();
          await expiryInput.fill(data.expiryDate);

          console.log("[PaymentPage] Expiry filled");
        }

        // ── CVV ─────────────────────────────
        const cvvInput = frame
          .locator(
            [
              'input[name="cvc"]',
              'input[autocomplete="cc-csc"]',
              'input[placeholder*="CVV"]',
              'input[placeholder*="CVC"]',
            ].join(", "),
          )
          .first();

        if (await cvvInput.isVisible().catch(() => false)) {
          await cvvInput.click();
          await cvvInput.fill(data.securityCode);

          console.log("[PaymentPage] CVV filled");
        }
      } catch (err) {
        console.log("[PaymentPage] Frame inspection failed");
      }
    }

    // Wait for validation to clear
    await this.page.waitForTimeout(1500);

    // Debug validation errors
    const errors = await this.page
      .locator('[class*="error"], .text-red-500')
      .allTextContents()
      .catch(() => []);

    console.log(`[PaymentPage] Validation errors: ${errors.join(" | ")}`);
  }

  private async hasPreFilledPaymentDetails(): Promise<boolean> {
    const [cardholder, cardNumber, expiry, securityCode] = await Promise.all([
      this.cardholderInput()
        .inputValue()
        .catch(() => ""),
      this.cardNumberInput()
        .inputValue()
        .catch(() => ""),
      this.expiryInput()
        .inputValue()
        .catch(() => ""),
      this.securityCodeInput()
        .inputValue()
        .catch(() => ""),
    ]);

    const hasValues =
      cardholder.trim().length > 0 &&
      cardNumber.trim().length > 0 &&
      expiry.trim().length > 0 &&
      securityCode.trim().length > 0;

    console.log(
      `[PaymentPage] Pre-filled payment details detected: ${hasValues}`,
    );
    return hasValues;
  }

  private async hasManualPaymentFields(): Promise<boolean> {
    const [cardholderVisible, cardNumberVisible, expiryVisible, cvvVisible] =
      await Promise.all([
        this.cardholderInput()
          .isVisible({ timeout: 500 })
          .catch(() => false),
        this.cardNumberInput()
          .isVisible({ timeout: 500 })
          .catch(() => false),
        this.expiryInput()
          .isVisible({ timeout: 500 })
          .catch(() => false),
        this.securityCodeInput()
          .isVisible({ timeout: 500 })
          .catch(() => false),
      ]);

    const hasManual =
      cardholderVisible || cardNumberVisible || expiryVisible || cvvVisible;
    console.log(`[PaymentPage] Manual payment fields visible: ${hasManual}`);
    return hasManual;
  }

  private async isPayButtonVisible(): Promise<boolean> {
    return this.page
      .locator('button:has-text("Pay £"), button:has-text("Pay")')
      .first()
      .isVisible({ timeout: 600 })
      .catch(() => false);
  }

  async clickPay() {
    if (await this.isChallengeVisible()) {
      console.log("[PaymentPage] Challenge already open — skipping Pay click");
      return;
    }
    if (this.hasClickedPay && !(await this.isPayButtonVisible())) {
      console.log(
        "[PaymentPage] Pay previously clicked and button not visible — skipping re-click",
      );
      return;
    }

    const payButton = this.page
      .locator(
        [
          'button:has-text("Pay £")',
          'button:has-text("Pay")',
          'button[type="submit"]',
        ].join(", "),
      )
      .first();

    await payButton.waitFor({ state: "visible", timeout: 15_000 });
    console.log(
      `[PaymentPage] Pay button enabled: ${await payButton.isEnabled().catch(() => false)}`,
    );
    await payButton.click({ force: true }).catch(async () => {
      await payButton.evaluate((el: HTMLElement) => el.click());
    });
    this.hasClickedPay = true;

    // Fast poll for booking confirmation (saved-card path — no 3DS).
    // If it doesn't appear in 3s, fall through to 3DS handler.
    const confirmedFast = await this.page
      .locator(
        [
          ':text("Booking Confirmed")',
          ':text("Thank you for scheduling")',
          'button:has-text("Back to home page")',
        ].join(", "),
      )
      .first()
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);

    if (confirmedFast) {
      console.log("[PaymentPage] Booking confirmed immediately (no 3DS)");
      await this.waitForBookingConfirmedAndGoHome();
      return;
    }

    await this.handle3DSChallenge();
  }

  async handle3DSChallenge() {
    const isPageChallengeVisible = await this.getChallengeScope()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    const challengeFrameIndex = await this.findChallengeFrameIndex();

    if (!isPageChallengeVisible && challengeFrameIndex < 0) {
      console.log(
        "[PaymentPage] No 3DS challenge detected — waiting for booking confirmation",
      );
      const confirmedWithout3DS = await this.page
        .locator(
          [
            ':text("Booking Confirmed")',
            ':text("Thank you for scheduling")',
            'button:has-text("Back to home page")',
          ].join(", "),
        )
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);

      if (confirmedWithout3DS) {
        await this.waitForBookingConfirmedAndGoHome();
      }
      return;
    }

    if (isPageChallengeVisible) {
      const btn = this.page
        .locator('button:has-text("Pass challenge")')
        .first();
      await btn.waitFor({ state: "visible", timeout: 15_000 });
      await btn.click({ force: true });
      console.log("[PaymentPage] Clicked Pass challenge on page");
    } else {
      const frame = this.page.frames()[challengeFrameIndex];
      const btn = frame
        .locator('button:has-text("Pass challenge"), :text("Pass challenge")')
        .first();
      await btn.waitFor({ state: "visible", timeout: 15_000 });
      await btn.click({ force: true });
      console.log("[PaymentPage] Clicked Pass challenge in iframe");
    }

    await this.waitForBookingConfirmedAndGoHome();
  }

  async waitForBookingConfirmedAndGoHome() {
    await this.page
      .locator(
        [
          ':text("Booking Confirmed")',
          ':text("Thank you for scheduling your consultation with us")',
          'button:has-text("Back to home page")',
        ].join(", "),
      )
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    console.log("[PaymentPage] Booking confirmed — clicking Back to home page");

    const backHomeButton = this.page
      .locator('button:has-text("Back to home page")')
      .first();
    await backHomeButton.waitFor({ state: "visible", timeout: 10_000 });
    await backHomeButton.click({ force: true });
    await this.page.waitForTimeout(2_000);
    this.bookingFlowCompleted = true;
  }

  isBookingFlowCompleted(): boolean {
    return this.bookingFlowCompleted;
  }

  private async clickAddNewCard(): Promise<boolean> {
    const btn = this.page
      .locator(
        [
          'button:has-text("Add new card")',
          'button:has-text("Use a different card")',
          'button:has-text("Add card")',
          ':text("Add new card")',
          ':text("Use a different card")',
        ].join(", "),
      )
      .first();
    if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await btn.click();
      await this.page.waitForTimeout(1_000);
      console.log("[PaymentPage] Clicked 'Add new card'");
      return true;
    }
    return false;
  }

  /**
   * Main entry point. Accepts an optional paymentMethod to force a specific path:
   *   "saved-card" — use existing saved card (fallback to manual if not found)
   *   "new-card"   — always fill manual form (click "Add new card" first if needed)
   *   "auto"       — detect automatically (original behaviour)
   */
  async completePayment(
    data: {
      cardholderName: string;
      cardNumber: string;
      expiryDate: string;
      securityCode: string;
    },
    paymentMethod: PaymentMethod = "auto",
  ) {
    await this.waitForPage();

    const savedCardVisible = await this.page
      .locator(':text("saved card"), :text("****")')
      .first()
      .isVisible()
      .catch(() => false);

    // ── Forced: saved card ─────────────────────────────────
    if (paymentMethod === "saved-card") {
      if (savedCardVisible) {
        console.log("[PaymentPage] Using saved card (forced)");
        await this.ensureSavedCardSelected();
        await this.clickPay();
        return;
      }
      console.log("[PaymentPage] saved-card requested but not found — falling back to manual form");
      await this.fillPaymentDetails(data);
      await this.clickPay();
      return;
    }

    // ── Forced: new card ───────────────────────────────────
    if (paymentMethod === "new-card") {
      if (savedCardVisible) {
        const clicked = await this.clickAddNewCard();
        if (!clicked) {
          console.log("[PaymentPage] Could not find 'Add new card' — filling form directly");
        }
      }
      console.log("[PaymentPage] Filling manual card form (forced new-card)");
      await this.fillPaymentDetails(data);
      await this.clickPay();
      return;
    }

    // ── Auto: detect scenario ──────────────────────────────
    if (savedCardVisible) {
      console.log("[PaymentPage] Saved card detected (auto)");
      await this.ensureSavedCardSelected();
      await this.clickPay();
      return;
    }

    const manualCardFormVisible = await this.page
      .locator(':text("Enter your card details here")')
      .first()
      .isVisible()
      .catch(() => false);

    if (manualCardFormVisible) {
      console.log("[PaymentPage] Manual payment form detected (auto)");
      await this.fillPaymentDetails(data);
      await this.clickPay();
      return;
    }

    console.log("[PaymentPage] No payment scenario detected");
  }
}
