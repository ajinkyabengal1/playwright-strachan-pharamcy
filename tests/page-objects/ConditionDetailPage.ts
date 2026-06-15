import { Page } from "@playwright/test";

export class ConditionDetailPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async setPharmacyCookie(pharmacySlug: string, fallbackOrigin?: string) {
    const origin = this.page.url().startsWith("http")
      ? new URL(this.page.url()).origin
      : (fallbackOrigin ?? process.env.BASE_URL ?? "http://localhost:4005");
    await this.page.context().addCookies([
      {
        name: "selected-corporate-id",
        value: pharmacySlug,
        url: origin,
      },
    ]);
  }

  async dismissCookieBanner() {
    const acceptBtn = this.page
      .locator(
        'button:has-text("Accept All"), button:has-text("Accept Cookies"), button:has-text("Accept")',
      )
      .first();
    const visible = await acceptBtn.isVisible().catch(() => false);
    if (visible) {
      await acceptBtn.click();
      await acceptBtn
        .waitFor({ state: "hidden", timeout: 5_000 })
        .catch(() => {});
    }
  }

  async waitForDetailPage(): Promise<boolean> {
    await this.page.waitForLoadState("domcontentloaded");
    await this.dismissCookieBanner();

    const readySelectors = [
      'button:has-text("Check Eligibility")',
      'a:has-text("Start Assessment")',
      'button:has-text("Start Assessment")',
      'a:has-text("Start Assessment")',
      'button:has-text("Start Assesment")',
      ':text("Take Assessment")',
      ':text("Take Assesment")',
      ':text("Am I eligible for our pharmacy services?")',
      ':text("Am I eligible for NHS services?")',
      ':text("Check if your condition is covered")',
      'heading:has-text("Appointment Type")',
      'button:has-text("Face to Face")',
      'button:has-text("Video Call")',
      'button:has-text("Telephone")',
      'button:has-text("Book Appointment")',
      'a:has-text("Book Appointment")',
      'button:has-text("Book Now")',
      'a:has-text("Book Now")'
    ];

    let pageReady = false;
    for (const sel of readySelectors) {
      const found = await this.page
        .locator(sel)
        .first()
        .isVisible()
        .catch(() => false);
      if (found) {
        pageReady = true;
        break;
      }
    }

    if (!pageReady) {
      try {
        await Promise.race(
          readySelectors.map((sel) =>
            this.page
              .locator(sel)
              .first()
              .waitFor({ state: "visible", timeout: 20_000 }),
          ),
        );
      } catch {
        throw new Error(
          `Condition detail page did not reach a ready state within 20s.\n` +
            `URL: ${this.page.url()}\n` +
            `Expected one of: ${readySelectors.join(" | ")}`,
        );
      }
    }

    const hasEligibilityForm = await this.page
      .locator('button:has-text("Check Eligibility")')
      .first()
      .isVisible()
      .catch(() => false);

    return hasEligibilityForm;
  }

  /**
   * Select gender using multiple strategies with verification.
   */
  async selectGender(gender: "male" | "female") {
    console.log(`→ Selecting gender: ${gender}`);

    // Scroll the eligibility section into view
    await this.page
      .locator("#check_condition_inner")
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() =>
        this.page
          .locator(
            'button:has-text("Check Eligibility"), button:has-text("Check eligibility")',
          )
          .first()
          .scrollIntoViewIfNeeded(),
      );

    await this.page.waitForTimeout(500);

    const labelText = gender === "male" ? "Male" : "Female";
    const possibleInputs = [
      `input[type="radio"][id="${gender}"]`,
      `input[type="radio"][value="${gender}"]`,
      `input[type="radio"][name*="gender"][value="${gender}"]`,
    ];

    let radioInput = this.page.locator(possibleInputs.join(", ")).first();
    const hasRadio = await radioInput.count().then((count) => count > 0);

    if (hasRadio) {
      await radioInput.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await radioInput.check({ force: true });
      } catch {
        await radioInput.evaluate((el: HTMLInputElement) => {
          el.checked = true;
          el.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      await this.page.waitForTimeout(300);

      const checked = await radioInput
        .evaluate((el: HTMLInputElement) => el.checked)
        .catch(() => false);
      console.log(`→ Radio checked via input: ${checked}`);
      if (checked) return;
    }

    const labelLocator = this.page
      .locator(`label:has-text("${labelText}")`)
      .first();
    if (await labelLocator.isVisible().catch(() => false)) {
      await labelLocator.click({ force: true });
      await this.page.waitForTimeout(300);
      const chosenRadio = this.page
        .locator(`input[type="radio"][value="${gender}"]`)
        .first();
      const checked = await chosenRadio
        .evaluate((el: HTMLInputElement) => el.checked)
        .catch(() => false);
      console.log(`→ Radio checked via label click: ${checked}`);
      if (checked) return;
    }

    // Final fallback: click any visible gender radio wrapper or button text.
    await this.page
      .locator(
        `.ant-radio-wrapper:has-text("${labelText}"), .ant-radio-button-wrapper:has-text("${labelText}"), label:has-text("${labelText}")`,
      )
      .first()
      .click({ force: true })
      .catch(() => {});
    await this.page.waitForTimeout(300);
  }

  /**
   * Fill DOB using the available date fields.
   */
  async fillDOB(day: string, month: string, year: string) {
    console.log(`→ Filling DOB: ${day}/${month}/${year}`);

    const fieldSets = [
      { selector: 'input[placeholder="DD"]', value: day },
      { selector: 'input[placeholder="MM"]', value: month },
      { selector: 'input[placeholder="YYYY"]', value: year },
      { selector: 'input[name*="day"]', value: day },
      { selector: 'input[name*="month"]', value: month },
      { selector: 'input[name*="year"]', value: year },
      { selector: 'input[id*="day"]', value: day },
      { selector: 'input[id*="month"]', value: month },
      { selector: 'input[id*="year"]', value: year },
      { selector: 'input[data-placeholder="DD"]', value: day },
      { selector: 'input[data-placeholder="MM"]', value: month },
      { selector: 'input[data-placeholder="YYYY"]', value: year },
    ];

    await this.page
      .locator(
        'button:has-text("Check Eligibility"), button:has-text("Check eligibility")',
      )
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await this.page.waitForTimeout(300);

    let filledCount = 0;
    for (const field of fieldSets) {
      const locator = this.page.locator(field.selector).first();
      if (!(await locator.count().then((count) => count > 0))) continue;
      if (!(await locator.isVisible().catch(() => false))) continue;
      await this.fillTextInput(locator, field.value);
      filledCount += 1;
      if (filledCount >= 3) break;
    }

    if (filledCount < 3) {
      const spans = this.page.locator(".date-input-wrapper span.date-span");
      const spanCount = await spans.count().catch(() => 0);
      console.log(`→ Fallback to contenteditable spans, found ${spanCount}`);
      if (spanCount >= 3) {
        await this.fillSpanByIndex(spans.nth(0), day);
        await this.fillSpanByIndex(spans.nth(1), month);
        await this.fillSpanByIndex(spans.nth(2), year);
      } else {
        await this.fillSpanByIndex(
          this.page
            .locator('span[contenteditable="true"][data-placeholder="DD"]')
            .first(),
          day,
        );
        await this.fillSpanByIndex(
          this.page
            .locator('span[contenteditable="true"][data-placeholder="MM"]')
            .first(),
          month,
        );
        await this.fillSpanByIndex(
          this.page
            .locator('span[contenteditable="true"][data-placeholder="YYYY"]')
            .first(),
          year,
        );
      }
    }

    await this.page.waitForTimeout(300);
  }

  private async fillTextInput(
    locator: import("@playwright/test").Locator,
    value: string,
  ) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ force: true }).catch(() => {});
    await locator.fill("");
    await locator.fill(value);
    await this.page.waitForTimeout(100);
    await this.page.keyboard.press("Tab");
    await this.page.waitForTimeout(100);
  }

  private async fillSpanByIndex(
    locator: import("@playwright/test").Locator,
    value: string,
  ) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ force: true }).catch(() => {});
    await locator.focus().catch(() => {});
    await this.page.waitForTimeout(100);

    await locator.evaluate((el: HTMLElement) => {
      el.textContent = "";
    });

    await locator.press("Control+a").catch(() => {});
    await locator.press("Meta+a").catch(() => {});
    await locator.press("Delete").catch(() => {});
    await this.page.waitForTimeout(50);

    for (const char of value) {
      await this.page.keyboard.type(char, { delay: 100 });
    }

    await this.page.waitForTimeout(100);

    await locator.evaluate((el: HTMLElement, text: string) => {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    }, value);

    await locator.press("Tab").catch(() => {});
    await this.page.waitForTimeout(150);
  }

  /**
   * Click Check Eligibility and wait for response.
   */
  async clickCheckEligibility() {
    console.log("→ Clicking Check Eligibility...");

    const btn = this.page
      .locator(
        '#check_condition_inner button:has-text("Check Eligibility"), #check_condition_inner :text("Check Eligibility")',
      )
      .filter({ hasText: /Check Eligibility/i })
      .first();

    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await this.page.waitForTimeout(300);

    // Take screenshot before clicking for debugging
    await this.page
      .screenshot({ path: "test-results/before-check-eligibility.png" })
      .catch(() => {});

    if (await btn.isEnabled().catch(() => false)) {
      await btn.click({ force: true }).catch(async () => {
        await btn.evaluate((el: HTMLElement) => el.click());
      });
    } else {
      await btn.click({ force: true }).catch(async () => {
        await btn.evaluate((el: HTMLElement) => el.click());
      });
    }

    console.log("→ Clicked. Waiting for Start Assessment or error...");

    // Wait for response
    await Promise.race([
      this.page
        .locator(
          'a:has-text("Start Assessment"), button:has-text("Start Assessment")',
        )
        .first()
        .waitFor({ state: "visible", timeout: 15_000 }),
      this.page
        .locator(
          'p.text-red-500:not(:empty), .ant-alert-message, :text("not eligible")',
        )
        .first()
        .waitFor({ state: "visible", timeout: 15_000 }),
    ]).catch(async () => {
      // Log page state for debugging
      await this.page
        .screenshot({
          path: "test-results/after-check-eligibility-unknown.png",
        })
        .catch(() => {});
      const bodySnippet = await this.page
        .locator("body")
        .textContent()
        .catch(() => "");
      console.log(
        `⚠ No expected result after Check Eligibility.\n` +
          `URL: ${this.page.url()}\n` +
          `Body snippet: ${bodySnippet?.slice(0, 800)}`,
      );
    });

    // Take screenshot after
    await this.page
      .screenshot({ path: "test-results/after-check-eligibility.png" })
      .catch(() => {});
  }

  /**
   * Wait for and click Start Assessment.
   * If still not visible after eligibility form was submitted, logs helpful info.
   */
  async clickStartAssessment(): Promise<void> {
    const selector = [
      'a:has-text("Start Assessment"):visible',
      'button:has-text("Start Assessment"):visible',
      'a:has-text("Start Assesment"):visible',
      'button:has-text("Start Assesment"):visible',
      'a:has-text("Take Assessment"):visible',
      'button:has-text("Take Assessment"):visible',
      'a:has-text("Take Assesment"):visible',
      'button:has-text("Take Assesment"):visible',
      'a:has-text("Start Consultation"):visible',
      'button:has-text("Start Consultation"):visible',
      'a:has-text("Continue"):visible',
      'button:has-text("Continue"):visible',
      'a:has-text("Book Appointment"):visible',
      'button:has-text("Book Appointment"):visible',
      'a:has-text("Book Now"):visible',
      'button:has-text("Book Now"):visible',
    ].join(", ");

    console.log("→ Waiting for Start Assessment (or Book Now) button...");

    const startButtons = this.page.locator(selector);
    const regexStartBtn = this.page
      .locator("a,button,[role='button']")
      .filter({
        hasText:
          /start\s*asses+ment|start\s*assessment|take\s*asses+ment|take\s*assessment|start\s*consultation|book\s*appointment|book\s*now/i,
      })
      .first();

    let startBtn: import("@playwright/test").Locator | null = null;
    for (let i = 0; i < 30; i++) {
      const count = await startButtons.count().catch(() => 0);
      if (count > 0) {
        startBtn = startButtons.first();
        break;
      }

      const regexVisible = await regexStartBtn
        .isVisible({ timeout: 300 })
        .catch(() => false);
      if (regexVisible) {
        startBtn = regexStartBtn;
        break;
      }

      await this.page.waitForTimeout(1000);
    }

    if (!startBtn) {
      await this.page
        .screenshot({ path: "test-results/start-assessment-not-found.png" })
        .catch(() => {});
      const url = this.page.url();
      const body = await this.page
        .locator("body")
        .textContent()
        .catch(() => "");
      throw new Error(
        `"Start Assessment" button not visible after 30s.\n` +
          `URL: ${url}\n` +
          `Check screenshot: test-results/start-assessment-not-found.png\n` +
          `Page text: ${body?.slice(0, 600)}`,
      );
    }

    await startBtn.scrollIntoViewIfNeeded().catch(() => {});
    const currentUrl = this.page.url();
    console.log(`→ Start Assessment visible. Clicking...`);

    try {
      await startBtn.click({ timeout: 5_000 });
    } catch {
      try {
        if (
          await regexStartBtn.isVisible({ timeout: 500 }).catch(() => false)
        ) {
          await regexStartBtn.click({ force: true });
        } else {
          await startBtn.click({ force: true });
        }
      } catch {
        if (
          await regexStartBtn.isVisible({ timeout: 500 }).catch(() => false)
        ) {
          await regexStartBtn.evaluate((el: HTMLElement) => el.click());
        } else {
          await startBtn.evaluate((el: HTMLElement) => el.click());
        }
      }
    }

    const movedToNextStep = await Promise.race([
      this.page
        .waitForURL((url) => url.href !== currentUrl, { timeout: 7_000 })
        .then(() => true),
      this.page
        .locator(
          [
            ':text("Questionnaires")',
            'input[name="first_name"]',
            ".appointment-type-radio-group",
            ".rota-slot",
            ':text("Complete your payment")',
            'button:has-text("Pay")',
          ].join(", "),
        )
        .first()
        .waitFor({ state: "visible", timeout: 7_000 })
        .then(() => true),
    ]).catch(() => false);

    if (!movedToNextStep) {
      // Private condition pages may have sticky/overlay CTA; click by text fallback.
      const fallbackCta = this.page
        .locator('a,button,[role="button"],span')
        .filter({
          hasText:
            /Start Assessment|Take Assessment|Start Consultation|Continue|Book Appointment|Book Now/i,
        })
        .first();

      if (await fallbackCta.isVisible().catch(() => false)) {
        await fallbackCta.scrollIntoViewIfNeeded().catch(() => {});
        await fallbackCta.click({ force: true }).catch(async () => {
          await fallbackCta.evaluate((el: HTMLElement) => el.click());
        });
      } else {
        await startBtn.evaluate((el: HTMLElement) => el.click());
      }

      await Promise.race([
        this.page
          .waitForURL((url) => url.href !== currentUrl, { timeout: 10_000 })
          .catch(() => {}),
        this.page
          .locator(
            [
              ':text("Questionnaires")',
              'input[name="first_name"]',
              ".appointment-type-radio-group",
              ".rota-slot",
              ':text("Complete your payment")',
              'button:has-text("Pay")',
            ].join(", "),
          )
          .first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => {}),
      ]);
    }

    console.log(`→ Navigated to: ${this.page.url()}`);
  }

  /**
   * Fills eligibility form if present, skips silently if not.
   */
  async fillEligibilityForm({
    gender,
    day,
    month,
    year,
  }: {
    gender: "male" | "female";
    day: string;
    month: string;
    year: string;
  }): Promise<void> {
    const formVisible = await this.page
      .locator('#check_condition_inner button:has-text("Check Eligibility")')
      .first()
      .isVisible()
      .catch(() => false);

    if (!formVisible) {
      console.log("ℹ Eligibility form not present — skipping");
      return;
    }

    console.log("ℹ Eligibility form found — waiting for inputs...");
    await this.page
      .locator(
        "#check_condition_inner input#male, #check_condition_inner input#female, #check_condition_inner span.date-span",
      )
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {
        console.log(
          "⚠ Eligibility inputs did not become visible within 10s — proceeding anyway",
        );
      });

    console.log("ℹ Filling eligibility form...");
    await this.selectGender(gender);
    await this.fillDOB(day, month, year);

    const selected = await this.page
      .locator(`#check_condition_inner input#${gender}`)
      .first()
      .evaluate((el: HTMLInputElement) => el.checked)
      .catch(() => false);
    console.log(`→ Gender selected after fill: ${selected}`);

    const dobValues = await this.page.$$eval(
      "#check_condition_inner span.date-span",
      (els) => els.map((el) => el.textContent?.trim() || ""),
    );
    console.log(`→ DOB spans after fill: ${JSON.stringify(dobValues)}`);

    // Verify form is populated before clicking
    const genderSelected = await this.page
      .locator(`#check_condition_inner input#${gender}`)
      .first()
      .evaluate((el: HTMLInputElement) => el.checked)
      .catch(() => false);
    const dobFilled = dobValues.every((v) => v && v.trim().length > 0);

    if (!genderSelected || !dobFilled) {
      console.log(
        `⚠ Form not fully populated: gender=${genderSelected}, dob=${dobFilled}`,
      );
      await this.page.waitForTimeout(1000); // Give it one more second
    }

    await this.clickCheckEligibility();
  }

  async handleDetailPageAndStartAssessment(): Promise<void> {
    const hasEligibilityForm = await this.waitForDetailPage();

    if (hasEligibilityForm) {
      await this.selectGender("male");
      await this.fillDOB("01", "01", "1990");
      await this.clickCheckEligibility();
    }

    await this.clickStartAssessment();
  }
}
