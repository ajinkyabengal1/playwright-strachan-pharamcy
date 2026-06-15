import { Page } from "@playwright/test";
import { getActiveConditionName } from "../fixtures/test-data";
import {
  ERECTILE_DYSFUNCTION_RULES,
  SHINGLES_RULES,
  WEIGHT_MANAGEMENT_RULES,
} from "./ConditionQuestionnaireRules";

/**
 * Handles the dynamic questionnaire wizard.
 * Questions are loaded one at a time; we detect the type and answer accordingly.
 */
export class QuestionnairePage {
  readonly page: Page;
  private readonly MAX_QUESTIONS = 50;
  private readonly answeredRuleKeys = new Set<string>();

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Wait for the questionnaire page to be ready.
   */
  async waitForPage() {
    await this.page.waitForLoadState("domcontentloaded");
    // Wait for at least one question or the first navigation button
    await this.page
      .locator(
        [
          ':text("Questionnaires")',
          ':text("Do you have these symptoms?")',
          ':text("I do not have these symptoms")',
          ".question-container",
          '[class*="question"]',
          'button:has-text("Save")',
          'button:has-text("Next")',
          'button:has-text("Continue")',
          'button:has-text("Submit")',
          // Signup form may appear directly after questionnaire in some flows
          'input[name="first_name"]',
        ].join(", "),
      )
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  /**
   * Walk through all questionnaire steps until the signup/booking page appears.
   * For each question detected:
   *  - Single choice (radio) → select first option
   *  - Checkbox group → check first option
   *  - Text/textarea → type a generic answer
   *  - Number → type "70"
   *  - Date → fill with test DOB
   * Then click Next/Continue/Submit.
   */
  async answerAllQuestions() {
    for (let step = 0; step < this.MAX_QUESTIONS; step++) {
      await this.page.waitForTimeout(200); // brief pause for animations

      // Guard: once thank-you page is visible, stop questionnaire handling immediately.
      if (await this.isOnThankYouPage()) {
        console.log(
          "[QuestionnairePage] Thank-you page detected — exiting questionnaire handler",
        );
        return;
      }

      // Guard: once drug selection is visible, stop questionnaire handling.
      if (await this.isOnDrugSelectionPage()) {
        console.log(
          "[QuestionnairePage] Drug selection UI detected — exiting questionnaire handler",
        );
        return;
      }

      // Guard: once payment is visible, stop questionnaire handling immediately.
      if (await this.isOnPaymentPage()) {
        console.log(
          "[QuestionnairePage] Payment UI detected — exiting questionnaire handler",
        );
        return;
      }

      // If we've reached the signup form, stop
      if (await this.isOnSignupOrBookingPage()) {
        return;
      }

      // If we are no longer on a questionnaire page and no question is visible, we are done
      if (step > 0 && !(await this.isOnQuestionnairePage())) {
        console.log(
          "[QuestionnairePage] No longer on questionnaire page — exiting questionnaire handler",
        );
        return;
      }

      let answered = await this.answerCurrentQuestion();
      const advanced = await this.progressQuestionnaire();

      if (!advanced && !answered) {
        // No question found and no button — might be loading or done
        await this.page.waitForTimeout(1000);
        if (await this.isOnThankYouPage()) return;
        if (await this.isOnDrugSelectionPage()) return;
        if (await this.isOnSignupOrBookingPage()) return;
        if (!(await this.isOnQuestionnairePage())) return;
      }
    }
  }

  private async clickPreferredOption(
    wrappers: ReturnType<Page["locator"]>,
    patterns: RegExp[],
  ): Promise<boolean> {
    const count = await wrappers.count();
    if (count === 0) return false;

    for (const pattern of patterns) {
      const match = wrappers.filter({ hasText: pattern });
      if ((await match.count()) > 0) {
        await match.first().click();
        return true;
      }
    }

    await wrappers.last().click();
    return true;
  }

  /**
   * For single-choice (radio) questions, prefer the safest negative answer if
   * available, including the exact "I do not have these symptoms" wording.
   */
  private async clickBestRadioOption(
    wrappers: ReturnType<Page["locator"]>,
  ): Promise<boolean> {
    const enabledWrappers = wrappers.filter({
      hasNot: this.page.locator(
        ".ant-radio-wrapper-disabled, .ant-radio-button-wrapper-disabled, [aria-disabled='true']",
      ),
    });
    return this.clickPreferredOption(enabledWrappers, [
      /^I do not have these symptoms$/i,
      /do not have these symptoms/i,
      /do not have/i,
      /^No$/i,
      /None of the above/i,
      /None apply/i,
      /^None$/i,
    ]);
  }

  private resolveScope(
    customScope?: ReturnType<Page["locator"]>,
  ): ReturnType<Page["locator"]> {
    if (customScope) {
      return customScope.first();
    }

    // FIX:
    // removed unstable .last()
    // which caused stale DOM references
    // during AntD rerenders
    return this.getActiveQuestionScope();
  }

  private async isRadioSelectionApplied(
    labelText: string,
    customScope?: ReturnType<Page["locator"]>,
  ): Promise<boolean> {
    const scope = this.resolveScope(customScope);
    const selectedInput = scope.locator(
      [
        `label:has-text("${labelText}") input[type="radio"]`,
        `input[type="radio"][value="${labelText}"]`,
        `input[type="radio"][aria-label="${labelText}"]`,
      ].join(", "),
    );
    const inputCount = await selectedInput.count().catch(() => 0);
    for (let i = 0; i < inputCount; i++) {
      const input = selectedInput.nth(i);
      const visible = await input.isVisible().catch(() => false);
      if (!visible) continue;
      const checked = await input
        .evaluate((el: HTMLInputElement) => el.checked)
        .catch(() => false);
      if (checked) return true;
    }

    const ariaRadio = scope
      .locator(`[role="radio"]:has-text("${labelText}")`)
      .first();
    if (await ariaRadio.count()) {
      return await ariaRadio
        .evaluate((el) => el.getAttribute("aria-checked") === "true")
        .catch(() => false);
    }

    const antWrapper = scope
      .locator(
        [
          `.ant-radio-wrapper:has-text("${labelText}")`,
          `.ant-radio-button-wrapper:has-text("${labelText}")`,
        ].join(", "),
      )
      .first();
    if (await antWrapper.count()) {
      return await antWrapper
        .evaluate(
          (el) =>
            el.classList.contains("ant-radio-wrapper-checked") ||
            el.classList.contains("ant-radio-button-wrapper-checked"),
        )
        .catch(() => false);
    }

    return false;
  }

  private async selectRadioByText(
    labelText: string,
    customScope?: ReturnType<Page["locator"]>,
  ): Promise<boolean> {
    const scope = this.resolveScope(customScope);
    const escaped = labelText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactPattern = new RegExp(`^\\s*${escaped}\\s*$`, "i");
    const shortAnswer = /^(yes|no|none|n\/a|true|false)$/i.test(
      labelText.trim(),
    );

    const possibleInputs = [
      `label:has-text("${labelText}") input[type="radio"]`,
      `input[type="radio"][value="${labelText}"]`,
      `input[type="radio"][aria-label="${labelText}"]`,
    ];

    const directInputs = scope.locator(possibleInputs.join(", "));
    const directCount = await directInputs.count().catch(() => 0);
    for (let i = 0; i < directCount; i++) {
      const radioInput = directInputs.nth(i);
      if (!(await radioInput.isVisible().catch(() => false))) continue;
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
      const checked = await this.isRadioSelectionApplied(labelText, scope);
      console.log(`[QuestionnairePage] Radio checked via input: ${checked}`);
      if (checked) return true;
    }

    const clickTargets = [
      `label:has-text("${labelText}")`,
      `[role="radio"]:has-text("${labelText}")`,
      `.ant-radio-wrapper:has-text("${labelText}")`,
      `.ant-radio-button-wrapper:has-text("${labelText}")`,
    ];

    for (const selector of clickTargets) {
      let options = scope.locator(selector);
      if (shortAnswer) {
        options = options.filter({ hasText: exactPattern });
      }
      const count = await options.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const option = options.nth(i);
        if (!(await option.isVisible().catch(() => false))) continue;
        const disabled = await option
          .evaluate((el) => {
            const htmlEl = el as HTMLElement;
            return (
              htmlEl.className.includes("disabled") ||
              htmlEl.getAttribute("aria-disabled") === "true"
            );
          })
          .catch(() => false);
        if (disabled) continue;

        const nestedInput = option.locator('input[type="radio"]').first();
        if (await nestedInput.isVisible().catch(() => false)) {
          await nestedInput.scrollIntoViewIfNeeded().catch(() => {});
          await nestedInput.check({ force: true }).catch(async () => {
            await nestedInput.click({ force: true });
          });
        } else {
          await option.scrollIntoViewIfNeeded().catch(() => {});
          await option.click({ force: true }).catch(async () => {
            await option.evaluate((el: HTMLElement) => el.click());
          });
        }
        await this.page.waitForTimeout(300);

        const selected = await this.isRadioSelectionApplied(labelText, scope);
        console.log(
          `[QuestionnairePage] Radio checked after click on ${selector}[${i}]: ${selected}`,
        );
        if (selected) return true;
      }
    }

    return false;
  }

  private async selectRadioByHeadingGroup(
    heading: ReturnType<Page["locator"]>,
    labelText: string,
  ): Promise<boolean> {
    const anchorRadio = heading
      .locator("xpath=following::input[@type='radio'][1]")
      .first();
    if (!(await anchorRadio.count().catch(() => 0))) return false;

    const groupName = await anchorRadio.getAttribute("name");
    if (!groupName) return false;

    const escaped = labelText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactPattern = new RegExp(`^\\s*${escaped}\\s*$`, "i");

    const wrappers = this.page
      .locator(
        [
          `label.ant-radio-wrapper:has(input[type="radio"][name="${groupName}"])`,
          `.ant-radio-button-wrapper:has(input[type="radio"][name="${groupName}"])`,
          `label:has(input[type="radio"][name="${groupName}"])`,
        ].join(", "),
      )
      .filter({ hasText: exactPattern });

    const count = await wrappers.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const option = wrappers.nth(i);
      if (!(await option.isVisible().catch(() => false))) continue;
      await option.scrollIntoViewIfNeeded().catch(() => {});
      await option.click({ force: true }).catch(async () => {
        await option.evaluate((el: HTMLElement) => el.click());
      });
      await this.page.waitForTimeout(250);

      const checked = await this.page
        .locator(`input[type="radio"][name="${groupName}"]:checked`)
        .count()
        .then((n) => n > 0)
        .catch(() => false);
      if (checked) return true;
    }

    return false;
  }

  private async selectRadioInQuestionWrapper(
    questionPattern: RegExp,
    answerText: string,
  ): Promise<boolean> {
    const wrappers = this.page.locator(".questionnaire-answer-wrapper").filter({
      has: this.page
        .locator(".questions.required-question, .questions")
        .filter({ hasText: questionPattern }),
    });

    const wrapperCount = await wrappers.count().catch(() => 0);

    for (let i = 0; i < wrapperCount; i++) {
      const wrapper = wrappers.nth(i);

      if (!(await wrapper.isVisible().catch(() => false))) {
        continue;
      }

      // FIX:
      // Use visible label/wrapper matching instead of input[value]
      // because Ant Design radio groups often do not expose
      // matching input values.
      const radioOption = wrapper
        .locator(
          [
            `label:has-text("${answerText}")`,
            `.ant-radio-wrapper:has-text("${answerText}")`,
            `.ant-radio-button-wrapper:has-text("${answerText}")`,
            `[role="radio"]:has-text("${answerText}")`,
          ].join(", "),
        )
        .first();

      if (!(await radioOption.isVisible().catch(() => false))) {
        continue;
      }

      // FIX:
      // skip disabled radios
      const disabled = await radioOption
        .evaluate((el) => {
          const htmlEl = el as HTMLElement;

          return (
            htmlEl.className.includes("disabled") ||
            htmlEl.getAttribute("aria-disabled") === "true"
          );
        })
        .catch(() => false);

      if (disabled) {
        continue;
      }

      await radioOption.scrollIntoViewIfNeeded().catch(() => {});

      await radioOption.click({ force: true }).catch(async () => {
        await radioOption.evaluate((el: HTMLElement) => el.click());
      });

      // AntD state sync wait
      await this.page.waitForTimeout(600);

      // Verify checked state
      let checked = await this.isRadioSelectionApplied(answerText, wrapper);

      console.log(
        `[QuestionnairePage] Radio "${answerText}" selected: ${checked}`,
      );

      if (checked) {
        return true;
      }

      // IMPORTANT FIX:
      // AntD sometimes updates selection late
      await this.page.waitForTimeout(800);

      checked = await this.isRadioSelectionApplied(answerText, wrapper);

      console.log(
        `[QuestionnairePage] Delayed verification for "${answerText}": ${checked}`,
      );

      if (checked) {
        return true;
      }
    }

    return false;
  }

  private async selectCheckboxByText(
    labelText: string,
    customScope?: ReturnType<Page["locator"]>,
  ): Promise<boolean> {
    const scope = customScope ?? this.getActiveQuestionScope();
    const possibleInputs = [
      `label:has-text("${labelText}") input[type="checkbox"]`,
      `input[type="checkbox"][value="${labelText}"]`,
      `input[type="checkbox"][aria-label="${labelText}"]`,
    ];

    const checkboxInput = scope.locator(possibleInputs.join(", ")).first();
    if (await checkboxInput.count()) {
      await checkboxInput.scrollIntoViewIfNeeded().catch(() => {});
      const checked = await checkboxInput.isChecked().catch(() => false);
      if (!checked) {
        await checkboxInput.check({ force: true }).catch(async () => {
          await checkboxInput.evaluate((el: HTMLInputElement) => {
            el.checked = true;
            el.dispatchEvent(
              new MouseEvent("click", { bubbles: true, cancelable: true }),
            );
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("input", { bubbles: true }));
          });
        });
      }
      const finalChecked = await checkboxInput.isChecked().catch(() => false);
      console.log(
        `[QuestionnairePage] Checkbox "${labelText}" checked via input: ${finalChecked}`,
      );
      if (finalChecked) {
        const visibleUiChecked = await scope
          .locator(
            [
              `.ant-checkbox-wrapper-checked:has-text("${labelText}")`,
              `[role="checkbox"][aria-checked="true"]:has-text("${labelText}")`,
              `label:has-text("${labelText}") .ant-checkbox-input:checked`,
            ].join(", "),
          )
          .first()
          .isVisible({ timeout: 300 })
          .catch(() => false);
        if (visibleUiChecked) return true;
      }
    }

    // FIX 2: Removed generic `div:has-text("${labelText}")` from clickTargets
    // — it was too broad and matched Ant Design radio wrappers, causing both
    // checkbox and radio handlers to fire on the same render (the flicker).
    const clickTargets = [
      `label:has-text("${labelText}")`,
      `[role="checkbox"]:has-text("${labelText}")`,
      `.ant-checkbox-wrapper:has-text("${labelText}")`,
    ];

    for (const selector of clickTargets) {
      const option = scope.locator(selector).first();
      if (!(await option.isVisible().catch(() => false))) continue;

      // Prefer clicking the actual checkbox control in this option row.
      const checkboxControl = option
        .locator(
          ".ant-checkbox-inner, .ant-checkbox-input, input[type='checkbox']",
        )
        .first();
      if (await checkboxControl.isVisible().catch(() => false)) {
        await checkboxControl.scrollIntoViewIfNeeded().catch(() => {});
        await checkboxControl.click({ force: true }).catch(async () => {
          await checkboxControl.evaluate((el: HTMLElement) => el.click());
        });
      } else {
        await option.scrollIntoViewIfNeeded().catch(() => {});
        await option.click({ force: true }).catch(async () => {
          await option.evaluate((el: HTMLElement) => el.click());
        });
      }

      // FIX 1: Increased settle wait from 250ms to 500ms so Ant Design's
      // internal state is committed before we return and the next handler runs.
      await this.page.waitForTimeout(500);
      const visibleUiChecked = await scope
        .locator(
          [
            `.ant-checkbox-wrapper-checked:has-text("${labelText}")`,
            `[role="checkbox"][aria-checked="true"]:has-text("${labelText}")`,
            `label:has-text("${labelText}") .ant-checkbox-input:checked`,
          ].join(", "),
        )
        .first()
        .isVisible({ timeout: 300 })
        .catch(() => false);
      if (!visibleUiChecked) continue;
      console.log(
        `[QuestionnairePage] Clicked checkbox option "${labelText}" via ${selector}`,
      );
      return true;
    }

    const partialTargets = [
      /None of the above/i,
      /Unexplained\s*weight\s*loss/i,
      /Presentation\s*>?\s*7\s*days\s*after\s*rash\s*onset/i,
      /outside antiviral treatment window/i,
    ];

    for (const pattern of partialTargets) {
      if (!pattern.test(labelText)) continue;

      const partialOption = scope
        .locator('label, [role="checkbox"], .ant-checkbox-wrapper')
        .filter({ hasText: pattern })
        .first();

      if (!(await partialOption.isVisible().catch(() => false))) continue;

      const checkboxControl = partialOption
        .locator(
          ".ant-checkbox-inner, .ant-checkbox-input, input[type='checkbox']",
        )
        .first();
      if (await checkboxControl.isVisible().catch(() => false)) {
        await checkboxControl.scrollIntoViewIfNeeded().catch(() => {});
        await checkboxControl.click({ force: true }).catch(async () => {
          await checkboxControl.evaluate((el: HTMLElement) => el.click());
        });
      } else {
        await partialOption.scrollIntoViewIfNeeded().catch(() => {});
        await partialOption.click({ force: true }).catch(async () => {
          await partialOption.evaluate((el: HTMLElement) => el.click());
        });
      }
      // FIX 1: Consistent settle wait here too — and removed generic `div`
      // from the locator above to avoid matching radio wrappers.
      await this.page.waitForTimeout(500);
      const visibleUiChecked = await scope
        .locator(
          [
            `.ant-checkbox-wrapper-checked:has-text("${labelText}")`,
            `[role="checkbox"][aria-checked="true"]:has-text("${labelText}")`,
            `label:has-text("${labelText}") .ant-checkbox-input:checked`,
          ].join(", "),
        )
        .first()
        .isVisible({ timeout: 300 })
        .catch(() => false);
      if (!visibleUiChecked) continue;
      console.log(
        `[QuestionnairePage] Clicked checkbox option "${labelText}" via partial text match`,
      );
      return true;
    }

    return false;
  }

  private async selectCheckboxByTextFlexible(
    labelText: string,
    customScope?: ReturnType<Page["locator"]>,
  ): Promise<boolean> {
    const scope = customScope ?? this.getActiveQuestionScope();

    const escaped = labelText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const exactPattern = new RegExp(`^\\s*${escaped}\\s*$`, "i");

    // IMPORTANT FIX:
    // search ONLY inside current question scope
    const checkboxWrappers = scope
      .locator(
        [
          "label.ant-checkbox-wrapper",
          ".ant-checkbox-wrapper",
          'label:has(input[type="checkbox"])',

          // IMPORTANT:
          // support separated checkbox rows
          ".ant-row label",
          ".ant-col label",

          // fallback generic checkbox labels
          "label:has(.ant-checkbox)",
        ].join(", "),
      )
      .filter({
        hasText: exactPattern,
      });

    const count = await checkboxWrappers.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      const wrapper = checkboxWrappers.nth(i);

      if (!(await wrapper.isVisible().catch(() => false))) {
        continue;
      }

      const checkboxInput = wrapper.locator('input[type="checkbox"]').first();

      // IMPORTANT FIX:
      // custom checkbox square element
      const checkboxVisual = wrapper
        .locator(
          [
            ".ant-checkbox",
            ".ant-checkbox-inner",
            '[role="checkbox"]',
            'span[class*="checkbox"]',
          ].join(", "),
        )
        .first();

      await wrapper.scrollIntoViewIfNeeded().catch(() => {});
      await checkboxVisual.scrollIntoViewIfNeeded().catch(() => {});

      await this.page.waitForTimeout(300);

      if (await checkboxInput.count().catch(() => 0)) {
        const alreadyChecked = await checkboxInput
          .isChecked()
          .catch(() => false);

        if (!alreadyChecked) {
          // IMPORTANT:
          // click visual checkbox instead of hidden input
          if (await checkboxVisual.isVisible().catch(() => false)) {
            await checkboxVisual.click({ force: true }).catch(async () => {
              await checkboxVisual.evaluate((el: HTMLElement) => el.click());
            });
          } else {
            await checkboxInput.check({ force: true }).catch(async () => {
              await checkboxInput.click({ force: true });
            });
          }
        }

        await this.page.waitForTimeout(700);

        const checked = await checkboxInput.isChecked().catch(() => false);

        console.log(
          `[QuestionnairePage] Checkbox "${labelText}" checked via scoped visual click: ${checked}`,
        );

        if (checked) {
          return true;
        }
      }

      // fallback wrapper click
      await wrapper.click({ force: true }).catch(async () => {
        await wrapper.evaluate((el: HTMLElement) => el.click());
      });

      await this.page.waitForTimeout(500);

      const checkedAfterClick = await checkboxInput
        .isChecked()
        .catch(() => false);

      console.log(
        `[QuestionnairePage] Checkbox "${labelText}" checked after wrapper click: ${checkedAfterClick}`,
      );

      if (checkedAfterClick) {
        return true;
      }
    }

    return false;
  }

  private async fillInputByRule(
    value: string,
    customScope?: ReturnType<Page["locator"]>,
  ): Promise<boolean> {
    const scope = customScope ?? this.getActiveQuestionScope();
    const inputs = scope.locator(
      [
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]):not([readonly])',
        "textarea:not([disabled]):not([readonly])",
      ].join(", "),
    );
    const count = await inputs.count().catch(() => 0);
    if (!count) return false;

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      if (!(await input.isVisible().catch(() => false))) continue;
      if (!(await input.isEnabled().catch(() => false))) continue;
      if ((await input.isEditable().catch(() => false)) === false) continue;

      await input.scrollIntoViewIfNeeded().catch(() => {});
      await input.click({ force: true }).catch(() => {});
      await input.fill("").catch(() => {});
      await input.fill(value).catch(() => {});
      const inputType = (
        (await input.getAttribute("type").catch(() => "")) ?? ""
      )
        .toLowerCase()
        .trim();
      if (inputType === "number") {
        // number inputs can reject non-numeric chars during fill; type as fallback
        await input.fill("").catch(() => {});
        await input
          .type(value.replace(/[^\d.]/g, ""), { delay: 20 })
          .catch(() => {});
      }
      await input.blur().catch(() => {});
      await this.page.waitForTimeout(250);

      const filledValue = await input.inputValue().catch(() => "");
      const normalizedActual = (filledValue ?? "").replace(/\s+/g, "").trim();
      const normalizedExpected = value.replace(/\s+/g, "").trim();
      if (!normalizedActual.length) continue;
      if (inputType === "number") {
        if (normalizedActual === normalizedExpected.replace(/[^\d.]/g, ""))
          return true;
      } else if (
        normalizedActual === normalizedExpected ||
        normalizedActual.includes(normalizedExpected)
      ) {
        return true;
      }
    }

    return false;
  }

  private async fillDateByRule(
    value: string,
    customScope?: ReturnType<Page["locator"]>,
  ): Promise<boolean> {
    const scope = customScope ?? this.getActiveQuestionScope();
    const dateInputs = scope.locator(
      [
        ".ant-picker input:not([disabled]):not([readonly])",
        'input[type="date"]:not([disabled]):not([readonly])',
        'input[placeholder*="DD"]:not([disabled]):not([readonly])',
        'input[placeholder*="dd"]:not([disabled]):not([readonly])',
      ].join(", "),
    );
    const dateInputCount = await dateInputs.count().catch(() => 0);

    if (!dateInputCount) return false;

    const candidateValues = [
      value,
      value.replace(/-/g, "/"),
      value.replace(/-/g, ""),
      value.replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$3-$2-$1"),
      value.replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$1/$2/$3"),
      value.replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$1$2$3"),
    ];

    for (let i = 0; i < dateInputCount; i++) {
      const dateInput = dateInputs.nth(i);

      if (!(await dateInput.isVisible().catch(() => false))) continue;
      if (!(await dateInput.isEnabled().catch(() => false))) continue;
      if ((await dateInput.isEditable().catch(() => false)) === false) continue;

      await dateInput.scrollIntoViewIfNeeded().catch(() => {});
      await dateInput.click({ force: true }).catch(() => {});

      for (const candidate of candidateValues) {
        const normalized = candidate.replace(
          /^(\d{2})\/(\d{2})\/(\d{4})$/,
          "$1-$2-$3",
        );

        // AntD date inputs can be masked/controlled and may ignore direct fill().
        // Use keyboard typing after clearing to mimic real user input.
        await dateInput.click({ force: true }).catch(() => {});
        await this.page.keyboard.press("Meta+A").catch(() => {});
        await this.page.keyboard.press("Control+A").catch(() => {});
        await this.page.keyboard.press("Backspace").catch(() => {});

        await dateInput.fill("").catch(() => {});
        await dateInput.type(normalized, { delay: 30 }).catch(() => {});
        await this.page.keyboard.press("Tab").catch(() => {});

        const afterType = await dateInput.inputValue().catch(() => "");
        if (!(afterType ?? "").trim().length) {
          await dateInput.fill(normalized).catch(() => {});
        }

        await this.page.keyboard.press("Enter").catch(() => {});
        await dateInput.blur().catch(() => {});
        await this.page.waitForTimeout(300);
        const filledValue = await dateInput.inputValue().catch(() => "");
        const normalizedFilled = (filledValue ?? "").replace(/\s+/g, "");
        const expectedDigits = value.replace(/[^\d]/g, "");
        const filledDigits = normalizedFilled.replace(/[^\d]/g, "");
        if (normalizedFilled.length > 0 && filledDigits === expectedDigits) {
          return true;
        }
      }
    }

    return false;
  }

  private getActiveQuestionScope() {
    return this.page
      .locator(
        [
          ".question-container:visible",
          '[class*="question"]:visible',
          'form:has(input[type="radio"]):visible',
          'form:has(input[type="checkbox"]):visible',
        ].join(", "),
      )
      .first();
  }

  private getQuestionHeadingForRule(pattern: RegExp) {
    // IMPORTANT:
    // keep heading matching strict to prevent broad container matches that can
    // make multiple input rules target the same field.
    return this.page
      .locator(
        [".questions.required-question", ".questions", ".question-title"].join(
          ", ",
        ),
      )
      .filter({ hasText: pattern })
      .first();
  }

  private async getQuestionScopeForRule(
    pattern: RegExp,
    control: "radio" | "checkbox" | "input" | "textarea" | "date",
  ) {
    const heading = this.getQuestionHeadingForRule(pattern);

    const predicateByControl =
      control === "checkbox"
        ? ".//input[@type='checkbox']"
        : control === "radio"
          ? ".//input[@type='radio']"
          : control === "date"
            ? ".//input[@type='date'] or .//input[contains(@class,'ant-picker-input')] or .//input[contains(@placeholder,'DD')] or .//input[contains(@placeholder,'dd')]"
            : ".//input[not(@type='hidden') and not(@type='checkbox') and not(@type='radio')] or .//textarea";

    // IMPORTANT FIX:
    // Use nearest questionnaire wrapper instead of ancestor
    const wrapper = heading.locator(
      `xpath=ancestor::*[
      contains(@class,"questionnaire-answer-wrapper")
      or contains(@class,"question-container")
      or ${predicateByControl}
    ][1]`,
    );

    if ((await wrapper.count().catch(() => 0)) > 0) {
      return wrapper.first();
    }

    // fallback
    return heading.locator(`xpath=following::*[${predicateByControl}][1]`);
  }

  private fuzzyRuleMatch(questionText: string, pattern: RegExp): boolean {
    if (pattern.test(questionText)) return true;

    const raw = pattern.source
      .replace(/\\\?/g, "?")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\.\*/g, " ")
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .toLowerCase();

    const tokens = raw
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 4)
      .filter(
        (t) =>
          !["select", "apply", "that", "these", "have", "your"].includes(t),
      );

    if (tokens.length === 0) return false;
    const text = questionText.toLowerCase();
    const hits = tokens.filter((t) => text.includes(t)).length;
    return hits >= Math.max(2, Math.floor(tokens.length * 0.5));
  }

  private async answerCurrentQuestion(): Promise<boolean> {
    if (await this.isOnDrugSelectionPage()) {
      return false;
    }

    const activeCondition = getActiveConditionName().toLowerCase();

    // 1. Process rule-based answers
    const handledByConditionRule = await this.answerByConditionRules();

    // 2. Process all visible questions generically (essential for forms displaying multiple questions at once)
    const handledGenericFields = await this.fillAllVisibleQuestions();

    if (handledByConditionRule || handledGenericFields) {
      console.log(
        `[QuestionnairePage] Handled questions: rule=${handledByConditionRule}, generic=${handledGenericFields}`
      );
      await this.clickConfirmIfVisible();
      return true;
    }

    // For weight-management we keep questionnaire strictly rule-driven to avoid
    // falling into generic shingles-style radio fallbacks on disabled options.
    if (activeCondition === "weight management") {
      return false;
    }

    const hasShinglesSymptomsQuestion = await this.page
      .locator(
        ':text("Do you have any of below symptoms. Check all that apply")',
      )
      .first()
      .isVisible()
      .catch(() => false);
    const hasShinglesChecklistQuestion = await this.page
      .locator(':text("Please check all that apply to you.")')
      .first()
      .isVisible()
      .catch(() => false);

    if (hasShinglesSymptomsQuestion || hasShinglesChecklistQuestion) {
      let handled = false;

      if (hasShinglesSymptomsQuestion) {
        const noneOfTheAboveSelected =
          await this.selectCheckboxByText("None of the above");
        handled = noneOfTheAboveSelected || handled;
      }

      if (hasShinglesChecklistQuestion) {
        const presentationSelected = await this.selectCheckboxByText(
          "Presentation >7 days after rash onset (outside antiviral treatment window)",
        );
        handled = presentationSelected || handled;
      }

      console.log(
        `[QuestionnairePage] Shingles block handled=${handled}, returning early`,
      );
      return handled;
    }

    const noSymptomsSelected = await this.selectRadioByText(
      "I do not have these symptoms",
    );
    if (noSymptomsSelected) {
      console.log(
        '[QuestionnairePage] Selected "I do not have these symptoms"',
      );
      return true;
    }

    // Single choice (radio buttons)
    const radios = this.page.locator(
      'input[type="radio"]:not([name="gender"]):not([id="male"]):not([id="female"])',
    );
    if ((await radios.count()) > 0) {
      const optionSelectors = [
        '.ant-radio-wrapper:has-text("I do not have these symptoms")',
        '.ant-radio-button-wrapper:has-text("I do not have these symptoms")',
        'label:has-text("I do not have these symptoms")',
        "text=/I do not have.*these symptoms/i",
        "text=/do not have these symptoms/i",
        "text=/^No$/i",
      ];
      for (const selector of optionSelectors) {
        const option = this.page.locator(selector).first();
        if (await option.isVisible().catch(() => false)) {
          await option.click({ force: true });
          await this.page.waitForTimeout(300);
          const noSymptomsChecked = await this.isRadioSelectionApplied(
            "I do not have these symptoms",
          );
          if (noSymptomsChecked) return true;
        }
      }

      const radioLabels = this.page
        .locator('label:has(input[type="radio"])')
        .filter({
          hasText: /I do not have these symptoms|do not have|^No$/i,
        });

      const radioLabelCount = await radioLabels.count();
      for (let i = 0; i < radioLabelCount; i++) {
        const label = radioLabels.nth(i);
        const input = label.locator('input[type="radio"]').first();

        const visible = await label.isVisible().catch(() => false);
        if (!visible) continue;
        const enabled = await input.isEnabled().catch(() => false);
        if (!enabled) continue;
        const disabledAttr = await input.getAttribute("disabled").catch(() => null);
        if (disabledAttr !== null) continue;

        await label.click({ force: true }).catch(() => {});
        await this.page.waitForTimeout(300);
        const noSymptomsChecked = await this.isRadioSelectionApplied(
          "I do not have these symptoms",
        );
        if (noSymptomsChecked) return true;
      }

      const radioCount = await radios.count();
      if (radioCount > 0) {
        const fallbackRadio = radios.nth(radioCount - 1);
        const isVisible = await fallbackRadio.isVisible().catch(() => false);
        if (isVisible) {
          await fallbackRadio.click({ force: true }).catch(() => {});
          return true;
        }
      }
      return false;
    }

    // Ant Design radio group — prefer "No", fallback to last option
    const antRadioWrappers = this.page.locator(".ant-radio-wrapper");
    if ((await antRadioWrappers.count()) > 0) {
      return await this.clickBestRadioOption(antRadioWrappers);
    }

    // Ant Design radio button style (ant-radio-button-wrapper)
    const antRadioButtons = this.page.locator(".ant-radio-button-wrapper");
    if ((await antRadioButtons.count()) > 0) {
      return await this.clickBestRadioOption(antRadioButtons);
    }

    // check_agree — must check the checkbox to agree/consent
    const agreeCheckbox = this.page.locator('input[type="checkbox"]');
    if ((await agreeCheckbox.count()) > 0) {
      const noneOption = this.page
        .locator('label:has(input[type="checkbox"])')
        .filter({ hasText: /none|n\/a/i });
      if ((await noneOption.count()) > 0) {
        await noneOption.first().click();
      } else {
        await agreeCheckbox.first().check({ force: true });
      }
      return true;
    }

    // Numerical input
    const numberInput = this.page.locator(
      'input[type="number"], input[inputmode="numeric"]',
    );
    if (await numberInput.isVisible().catch(() => false)) {
      const count = await numberInput.count();
      if (count >= 2) {
        await numberInput.nth(0).click();
        await numberInput.nth(0).fill("170");
        await numberInput.nth(1).click();
        await numberInput.nth(1).fill("70");
      } else {
        const pageText = await this.page.textContent("body").catch(() => "");
        if (/height|cm/i.test(pageText ?? "")) {
          await numberInput.first().fill("170");
        } else if (/weight|kg/i.test(pageText ?? "")) {
          await numberInput.first().fill("70");
        } else {
          await numberInput.first().fill("70");
        }
      }
      return true;
    }

    // Text / textarea
    const textInput = this.page.locator(
      'input[type="text"]:not([name="first_name"]):not([name="last_name"]):not([name="postcode"]), textarea',
    );
    if (await textInput.isVisible().catch(() => false)) {
      await textInput.first().click();
      await textInput.first().clear();
      await textInput.first().fill("None");
      return true;
    }

    // Date picker
    const datePicker = this.page.locator(".ant-picker input").first();
    if (await datePicker.isVisible().catch(() => false)) {
      await datePicker.click();
      await datePicker.fill("1990-01-01");
      await this.page.keyboard.press("Enter");
      return true;
    }

    return false;
  }

  private async fillAllVisibleQuestions(): Promise<boolean> {
    let answeredAny = false;

    // 1. Handle Date/Range Pickers
    const rangePickers = this.page.locator(".ant-picker-range");
    const rangePickerCount = await rangePickers.count().catch(() => 0);
    for (let i = 0; i < rangePickerCount; i++) {
      const picker = rangePickers.nth(i);
      if (await picker.isVisible().catch(() => false)) {
        const inputs = picker.locator("input");
        const startVal = (await inputs.nth(0).inputValue().catch(() => "")).trim();
        const endVal = (await inputs.nth(1).inputValue().catch(() => "")).trim();
        const isStartEmpty = startVal === "" || startVal === "DD-MM-YYYY" || startVal === "YYYY-MM-DD" || startVal === "DD/MM/YYYY";
        const isEndEmpty = endVal === "" || endVal === "DD-MM-YYYY" || endVal === "YYYY-MM-DD" || endVal === "DD/MM/YYYY";
        
        if (isStartEmpty || isEndEmpty) {
          console.log("[QuestionnairePage] Opening range picker dropdown by clicking start input...");
          await inputs.nth(0).click({ force: true });
          
          const dropdown = this.page.locator(".ant-picker-dropdown:visible").first();
          await dropdown.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
          
          const cells = dropdown.locator(".ant-picker-cell-in-view:not(.ant-picker-cell-disabled)");
          const cellsCount = await cells.count().catch(() => 0);
          
          if (cellsCount >= 10) {
            console.log("[QuestionnairePage] Clicking cells on range calendar overlay...");
            const startCell = cells.nth(0);
            const startCellInner = startCell.locator(".ant-picker-cell-inner");
            if (await startCellInner.isVisible().catch(() => false)) {
              await startCellInner.click({ force: true }).catch(() => {});
            } else {
              await startCell.click({ force: true }).catch(() => {});
            }
            await this.page.waitForTimeout(300);
            
            // Re-fetch visible cells after first click as selection changes the UI classes
            const endCells = dropdown.locator(".ant-picker-cell-in-view:not(.ant-picker-cell-disabled)");
            const endCellsCount = await endCells.count().catch(() => 0);
            
            // Ensure focus is on the end input before selecting the end cell
            await inputs.nth(1).click({ force: true }).catch(() => {});
            await this.page.waitForTimeout(200);
            
            if (endCellsCount > 7) {
              const endCell = endCells.nth(6);
              const endCellInner = endCell.locator(".ant-picker-cell-inner");
              if (await endCellInner.isVisible().catch(() => false)) {
                await endCellInner.click({ force: true }).catch(() => {});
              } else {
                await endCell.click({ force: true }).catch(() => {});
              }
            } else if (endCellsCount > 0) {
              const endCell = endCells.last();
              const endCellInner = endCell.locator(".ant-picker-cell-inner");
              if (await endCellInner.isVisible().catch(() => false)) {
                await endCellInner.click({ force: true }).catch(() => {});
              } else {
                await endCell.click({ force: true }).catch(() => {});
              }
            }
            await this.page.waitForTimeout(300);
            answeredAny = true;
          } else {
            // Fallback: Type in start and end values manually
            if ((await inputs.count()) >= 2) {
              const start = inputs.nth(0);
              if (isStartEmpty) {
                await start.evaluate((el: HTMLInputElement) => el.removeAttribute("readonly"));
                await start.click();
                await start.fill("");
                await start.fill("01-05-2026");
                await start.press("Enter").catch(() => {});
                await this.page.keyboard.press("Enter").catch(() => {});
                answeredAny = true;
              }
              const end = inputs.nth(1);
              if (isEndEmpty) {
                await end.evaluate((el: HTMLInputElement) => el.removeAttribute("readonly"));
                await end.click();
                await end.fill("");
                await end.fill("15-05-2026");
                await end.press("Enter").catch(() => {});
                await this.page.keyboard.press("Enter").catch(() => {});
                
                const cell = dropdown.locator(".ant-picker-cell-in-view").first();
                const cellInner = cell.locator(".ant-picker-cell-inner");
                if (await cellInner.isVisible({ timeout: 1000 }).catch(() => false)) {
                  await cellInner.click({ force: true }).catch(() => {});
                } else if (await cell.isVisible({ timeout: 500 }).catch(() => false)) {
                  await cell.click({ force: true }).catch(() => {});
                }
                answeredAny = true;
              }
            }
          }
        }
      }
    }

    const datePickers = this.page.locator(".ant-picker input, input[placeholder='DD-MM-YYYY'], input[placeholder='YYYY-MM-DD'], input[placeholder='DD/MM/YYYY']");
    const datePickerCount = await datePickers.count().catch(() => 0);
    for (let i = 0; i < datePickerCount; i++) {
      const picker = datePickers.nth(i);
      const isVisible = await picker.isVisible().catch(() => false);
      if (!isVisible) continue;

      // Filter out range picker inputs using DOM traversal
      const isRangeInput = await picker.evaluate((el) => {
        return !!el.closest(".ant-picker-range") || el.hasAttribute("date-range");
      }).catch(() => false);
      if (isRangeInput) continue;

      const isEmpty = await picker.evaluate((el: HTMLInputElement) => {
        const val = (el.value || "").trim();
        return !val || val === "DD-MM-YYYY" || val === "YYYY-MM-DD" || val === "DD/MM/YYYY";
      }).catch(() => true);
      
      if (isEmpty) {
        console.log("[QuestionnairePage] Opening single date picker dropdown...");
        await picker.click({ force: true });
        
        const dropdown = this.page.locator(".ant-picker-dropdown:visible").first();
        await dropdown.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
        
        const cell = dropdown.locator(".ant-picker-cell-in-view:not(.ant-picker-cell-disabled)").first();
        const cellInner = cell.locator(".ant-picker-cell-inner");
        if (await cellInner.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log("[QuestionnairePage] Clicking active date cell inner...");
          await cellInner.click({ force: true }).catch(() => {});
          answeredAny = true;
        } else if (await cell.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log("[QuestionnairePage] Clicking active date cell...");
          await cell.click({ force: true }).catch(() => {});
          answeredAny = true;
        } else {
          // Fallback: Type in value
          console.log("[QuestionnairePage] Cell not visible, falling back to manual typing...");
          await picker.evaluate((el: HTMLInputElement) => el.removeAttribute("readonly"));
          await picker.click();
          await picker.fill("");
          const placeholder = (await picker.getAttribute("placeholder")) || "";
          const dateStr = placeholder.includes("YYYY") ? "1990-01-01" : "01-01-1990";
          await picker.fill(dateStr);
          await picker.press("Enter").catch(() => {});
          await this.page.keyboard.press("Enter").catch(() => {});
          answeredAny = true;
        }
      }
    }

    // 2. Handle Text / Textarea fields
    const textInputs = this.page.locator(
      'input[type="text"]:not([name="first_name"]):not([name="last_name"]):not([name="postcode"]):not([name="email"]):not([name="phone"]), ' +
      'input:not([type]):not([name="first_name"]):not([name="last_name"]):not([name="postcode"]):not([name="email"]):not([name="phone"]), ' +
      'textarea'
    );
    const textCount = await textInputs.count().catch(() => 0);
    for (let i = 0; i < textCount; i++) {
      const input = textInputs.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      const isEmpty = await input.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => !el.value).catch(() => true);
      if (isVisible && isEmpty) {
        // Find question text context
        const parentWrapper = this.page.locator('.questionnaire-answer-wrapper, .text-box-question-wrapper, .textarea-question-wrapper, .health-data-question-wrapper').filter({ has: input }).first();
        let questionText = "";
        if (await parentWrapper.count() > 0) {
          const qLabel = parentWrapper.locator('.questions');
          if (await qLabel.count() > 0) {
            questionText = (await qLabel.first().textContent().catch(() => "")) || "";
          }
        }
        
        const placeholder = (await input.getAttribute("placeholder")) || "";
        const name = (await input.getAttribute("name")) || "";
        const qTextLower = questionText.toLowerCase();
        const placeholderLower = placeholder.toLowerCase();
        const nameLower = name.toLowerCase();

        if (/1\s*to\s*10|1-10/i.test(questionText) || /1\s*to\s*10|1-10/i.test(placeholder)) {
          await input.fill("5");
        } else if (placeholder.includes("___/___") || placeholder.includes("mmHg") || /blood\s*pressure/i.test(questionText) || /systolic/i.test(questionText)) {
          await input.fill("120/80");
        } else if (nameLower.includes("height") || placeholderLower.includes("height") || qTextLower.includes("height")) {
          await input.fill("170");
        } else if (nameLower.includes("weight") || placeholderLower.includes("weight") || qTextLower.includes("weight")) {
          await input.fill("150");
        } else if (placeholderLower.includes("occupation") || qTextLower.includes("occupation")) {
          await input.fill("Office worker");
        } else {
          await input.fill("None");
        }
        answeredAny = true;
      }
    }

    // 3. Handle Numerical inputs
    const numInputs = this.page.locator('input[type="number"], input[inputmode="numeric"]');
    const numCount = await numInputs.count().catch(() => 0);
    for (let i = 0; i < numCount; i++) {
      const input = numInputs.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      const isEmpty = await input.evaluate((el: HTMLInputElement) => !el.value).catch(() => true);
      if (isVisible && isEmpty) {
        // Find question text context
        const parentWrapper = this.page.locator('.questionnaire-answer-wrapper, .numerical-question-wrapper, .health-data-question-wrapper').filter({ has: input }).first();
        let questionText = "";
        if (await parentWrapper.count() > 0) {
          const qLabel = parentWrapper.locator('.questions');
          if (await qLabel.count() > 0) {
            questionText = (await qLabel.first().textContent().catch(() => "")) || "";
          }
        }

        const name = (await input.getAttribute("name") || "").toLowerCase();
        const placeholder = (await input.getAttribute("placeholder") || "").toLowerCase();
        const qTextLower = questionText.toLowerCase();
        
        let value = "150"; // Fallback to 150 (between 100-250) instead of 1
        if (/1\s*to\s*10|1-10/i.test(questionText) || /1\s*to\s*10|1-10/i.test(placeholder)) {
          value = "5";
        } else if (name.includes("height") || placeholder.includes("height") || qTextLower.includes("height")) {
          value = "170";
        } else if (name.includes("weight") || placeholder.includes("weight") || qTextLower.includes("weight")) {
          value = "150"; // Weight in lbs (between 100-250) or kg (e.g. 75, but let's use 150 to satisfy 100-250)
        }
        await input.fill(value);
        answeredAny = true;
      }
    }

    // 4. Handle Checkboxes
    const checkboxes = this.page.locator('input[type="checkbox"]');
    const cbCount = await checkboxes.count().catch(() => 0);
    for (let i = 0; i < cbCount; i++) {
      const cb = checkboxes.nth(i);
      const isVisible = await cb.isVisible().catch(() => false);
      const isChecked = await cb.isChecked().catch(() => false);
      if (isVisible && !isChecked) {
        const parent = this.page.locator(`label:has(input[type="checkbox"])`).nth(i);
        if (await parent.isVisible().catch(() => false)) {
          await parent.click({ force: true });
        } else {
          await cb.check({ force: true });
        }
        answeredAny = true;
      }
    }

    // 5. Handle Radio Groups
    const antRadioGroups = this.page.locator(".ant-radio-group");
    const argCount = await antRadioGroups.count().catch(() => 0);
    for (let i = 0; i < argCount; i++) {
      const group = antRadioGroups.nth(i);
      if (await group.isVisible().catch(() => false)) {
        const selected = group.locator(".ant-radio-wrapper-checked, .ant-radio-button-wrapper-checked");
        if ((await selected.count().catch(() => 0)) > 0) {
          continue;
        }
        
        const wrappers = group.locator(".ant-radio-wrapper, .ant-radio-button-wrapper");
        if ((await wrappers.count().catch(() => 0)) > 0) {
          await this.clickBestRadioOption(wrappers);
          answeredAny = true;
        }
      }
    }

    const standardRadios = this.page.locator('input[type="radio"]:not([name="gender"]):not([id="male"]):not([id="female"])');
    const srCount = await standardRadios.count().catch(() => 0);
    const radioNames = new Set<string>();
    for (let i = 0; i < srCount; i++) {
      const name = await standardRadios.nth(i).getAttribute("name").catch(() => null);
      if (name) radioNames.add(name);
    }

    for (const name of radioNames) {
      const groupLoc = this.page.locator(`input[name="${name}"]`);
      const checkedLoc = this.page.locator(`input[name="${name}"]:checked`);
      if ((await checkedLoc.count().catch(() => 0)) === 0) {
        const noOpt = groupLoc.filter({ hasText: /No|None/i });
        if ((await noOpt.count().catch(() => 0)) > 0) {
          await noOpt.first().click({ force: true });
        } else {
          await groupLoc.last().click({ force: true });
        }
        answeredAny = true;
      }
    }

    // 5.5 Handle Dropdown Selects (Ant Design & Native select elements)
    const antSelects = this.page.locator(".ant-select");
    const selectCount = await antSelects.count().catch(() => 0);
    for (let i = 0; i < selectCount; i++) {
      const select = antSelects.nth(i);
      if (await select.isVisible().catch(() => false)) {
        const hasSelection = await select.locator(".ant-select-selection-item").isVisible().catch(() => false);
        if (hasSelection) {
          continue;
        }
        
        console.log(`[QuestionnairePage] Clicking ant-select dropdown ${i + 1}`);
        await select.click({ force: true });
        await this.page.waitForTimeout(500); // Wait for options overlay to mount
        
        const options = this.page.locator(".ant-select-item-option:visible, .ant-select-item:visible");
        const optionsCount = await options.count().catch(() => 0);
        if (optionsCount > 0) {
          await options.first().click({ force: true });
          console.log(`[QuestionnairePage] Selected option for ant-select dropdown`);
          answeredAny = true;
        } else {
          await this.page.locator("body").click({ force: true }).catch(() => {});
        }
        await this.page.waitForTimeout(300);
      }
    }

    const nativeSelects = this.page.locator("select");
    const nsCount = await nativeSelects.count().catch(() => 0);
    for (let i = 0; i < nsCount; i++) {
      const sel = nativeSelects.nth(i);
      if (await sel.isVisible().catch(() => false)) {
        const value = await sel.inputValue().catch(() => "");
        if (value === "" || value === "Please Select") {
          const firstVal = await sel.locator("option").nth(1).getAttribute("value").catch(() => null);
          if (firstVal) {
            await sel.selectOption(firstVal);
            answeredAny = true;
          }
        }
      }
    }

    // 6. Handle File uploads
    const fileInputs = this.page.locator('input[type="file"]');
    const fileCount = await fileInputs.count().catch(() => 0);
    for (let i = 0; i < fileCount; i++) {
      const input = fileInputs.nth(i);
      const hasFiles = await input.evaluate((el: HTMLInputElement) => el.files && el.files.length > 0).catch(() => false);
      if (!hasFiles) {
        const buffer = Buffer.from("mock medical report content");
        await input.setInputFiles({
          name: "medical_report.txt",
          mimeType: "text/plain",
          buffer: buffer
        });
        answeredAny = true;
        console.log("[QuestionnairePage] Uploaded dummy file to file input");
      }
    }

    return answeredAny;
  }

  private async clickConfirmIfVisible(): Promise<boolean> {
    const confirmSelectors = [
      'button:has-text("Confirm")',
      'button:has-text("CONFIRM")',
      'button:has-text("Save")',
      'button:has-text("SAVE")',
      'input[type="submit"][value="Confirm"]',
      'input[type="button"][value="Confirm"]',
      'input[type="submit"][value="Save"]',
      'input[type="button"][value="Save"]',
    ];

    for (const sel of confirmSelectors) {
      const btn = this.page.locator(sel).first();
      const visible = await btn.isVisible().catch(() => false);
      if (!visible) continue;

      const enabled = await btn.isEnabled().catch(() => false);
      if (!enabled) continue;

      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ force: true }).catch(async () => {
        await btn.evaluate((el: HTMLElement) => el.click());
      });
      await this.waitForQuestionnaireTransition();
      return true;
    }

    // Fallback: scan visible buttons by text and click matching confirm/save.
    const buttons = this.page.locator("button");
    const count = await buttons.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const visible = await btn.isVisible().catch(() => false);
      if (!visible) continue;
      const enabled = await btn.isEnabled().catch(() => false);
      if (!enabled) continue;
      const text = ((await btn.textContent().catch(() => "")) ?? "").trim();
      if (!/confirm|save/i.test(text)) continue;

      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ force: true }).catch(async () => {
        await btn.evaluate((el: HTMLElement) => el.click());
      });
      await this.waitForQuestionnaireTransition();
      return true;
    }

    return false;
  }

  private async answerByConditionRules(): Promise<boolean> {
    const activeCondition = getActiveConditionName().toLowerCase();

    const rules =
      activeCondition === "weight management"
        ? WEIGHT_MANAGEMENT_RULES
        : activeCondition === "shingles"
          ? SHINGLES_RULES
          : activeCondition === "erectile-dysfunction"
            ? ERECTILE_DYSFUNCTION_RULES
            : [];

    if (rules.length === 0) {
      return false;
    }

    let handledAnyRule = false;

    // IMPORTANT:
    // iterate ALL rules every pass
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index];

      const ruleKey = `${index}__${rule.answerText}`;

      // already answered
      if (this.answeredRuleKeys.has(ruleKey)) {
        continue;
      }

      const heading = this.getQuestionHeadingForRule(rule.questionPattern);

      const visible = await heading.isVisible().catch(() => false);

      if (!visible) {
        continue;
      }

      const headingText = (await heading.textContent().catch(() => "")) ?? "";

      const matched =
        rule.questionPattern.test(headingText) ||
        this.fuzzyRuleMatch(headingText, rule.questionPattern);

      if (!matched) {
        continue;
      }

      const scope = await this.getQuestionScopeForRule(
        rule.questionPattern,
        rule.control,
      );

      if (!(await scope.isVisible().catch(() => false))) {
        continue;
      }

      console.log(
        `[QuestionnairePage] Rule ${
          index + 1
        }/${rules.length} matched: ${rule.questionPattern}`,
      );

      let answered = false;

      // CHECKBOX
      if (rule.control === "checkbox") {
        answered = await this.selectCheckboxByTextFlexible(
          rule.answerText,
          scope,
        );
      }

      // RADIO
      else if (rule.control === "radio") {
        answered =
          (await this.selectRadioInQuestionWrapper(
            rule.questionPattern,
            rule.answerText,
          )) ||
          (await this.selectRadioByHeadingGroup(heading, rule.answerText)) ||
          (await this.selectRadioByText(rule.answerText, scope));
      }

      // INPUT/TEXTAREA
      else if (rule.control === "input" || rule.control === "textarea") {
        answered = await this.fillInputByRule(rule.answerText, scope);
      }

      // DATE
      else if (rule.control === "date") {
        answered = await this.fillDateByRule(rule.answerText, scope);
      }

      // delayed AntD verification
      if (!answered && rule.control === "radio") {
        await this.page.waitForTimeout(800);

        answered = await this.isRadioSelectionApplied(rule.answerText, scope);
      }

      if (answered) {
        console.log(
          `[QuestionnairePage] Rule ${index + 1} completed successfully`,
        );

        this.answeredRuleKeys.add(ruleKey);

        handledAnyRule = true;

        // allow rerender between rules
        await this.page.waitForTimeout(400);
      }
    }

    return handledAnyRule;
  }

  private async clickPrimaryButton(): Promise<boolean> {
    const buttonSelectors = [
      'button:has-text("Confirm")',
      'button:has-text("Save")',
      'input[type="submit"][value="Confirm"]',
      'input[type="submit"][value="Save"]',
      'input[type="button"][value="Confirm"]',
      'input[type="button"][value="Save"]',
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Submit")',
      'button:has-text("Finish")',
      'button[type="submit"]',
    ];

    for (const sel of buttonSelectors) {
      const btn = this.page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true });
        return true;
      }
    }
    return false;
  }

  /**
   * Some questionnaire flows require multiple consecutive actions:
   * Save -> Confirm -> NHS111 popup -> Book Private Consultation.
   * Keep clicking the currently visible primary action until the page moves on
   * or the popup CTA is handled.
   */
  private async progressQuestionnaire(): Promise<boolean> {
    let progressed = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      if (await this.isOnDrugSelectionPage()) {
        return true;
      }

      if (await this.isOnPaymentPage()) {
        return true;
      }

      const handledNHS111 = await this.handleNHS111Popup();
      if (handledNHS111) {
        return true;
      }

      if (await this.isOnSignupOrBookingPage()) {
        return true;
      }

      if (await this.isOnThankYouPage()) {
        return true;
      }

      const clicked = await this.clickPrimaryButton();
      if (!clicked) {
        return progressed;
      }

      progressed = true;
      await this.waitForQuestionnaireTransition();
    }

    return progressed;
  }

  private async waitForQuestionnaireTransition(): Promise<void> {
    await Promise.race([
      this.page.waitForLoadState("domcontentloaded").catch(() => {}),
      this.page
        .locator(
          [
            'input[name="first_name"]',
            ".appointment-type-radio-group",
            ".drug-selection-section",
            ".product-box-ui",
            'button:has-text("Choose this Option")',
            ".rota-slot",
            ':text("Complete your payment")',
            ':text("Booking Confirmed")',
          ].join(", "),
        )
        .first()
        .waitFor({ state: "visible", timeout: 1_500 })
        .catch(() => {}),
      this.page.waitForTimeout(350),
    ]);
  }

  /**
   * Returns true if the current page looks like a questionnaire (has question UI elements).
   * Used by the spec to decide whether to run the questionnaire step.
   */
  async isOnQuestionnairePage(): Promise<boolean> {
    const questionnaireIndicators = [
      ".question-container",
      '[class*="question"]',
      '[class*="questionnaire"]',
      'button:has-text("Next")',
    ];
    for (const sel of questionnaireIndicators) {
      if (
        await this.page
          .locator(sel)
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        return true;
      }
    }
    return false;
  }

  private async isOnSignupOrBookingPage(): Promise<boolean> {
    const signupIndicators = [
      'input[name="first_name"]',
      'input[name="last_name"]',
      'text="Create Account"',
      'text="Sign Up"',
      'text="Book Appointment"',
      'text="Your appointment"',
      '[class*="booking"]',
      '[class*="signup"]',
    ];

    for (const sel of signupIndicators) {
      if (
        await this.page
          .locator(sel)
          .isVisible()
          .catch(() => false)
      ) {
        return true;
      }
    }
    return false;
  }

  private async isOnDrugSelectionPage(): Promise<boolean> {
    const indicators = [
      "text=/what.?s your preference\\?/i",
      ".drug-selection-section",
      ".product-box-ui",
      'button:has-text("Choose this Option")',
    ];

    for (const sel of indicators) {
      const visible = await this.page
        .locator(sel)
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) return true;
    }

    return false;
  }

  private async handleNHS111Popup(): Promise<boolean> {
    if (await this.isOnPaymentPage()) {
      return false;
    }

    const popupRoot = this.page
      .locator(
        [
          '.ant-modal-content:has-text("NHS 111")',
          '[role="dialog"]:has-text("NHS 111")',
          ':text("Need Faster Access to Care?")',
        ].join(", "),
      )
      .first();

    const popupVisible = await popupRoot.isVisible().catch(() => false);
    const popupButton = this.page
      .locator(
        'button:has-text("Book Private Consultation"), a:has-text("Book Private Consultation")',
      )
      .first();

    if (
      !popupVisible &&
      !(await popupButton.isVisible({ timeout: 1_500 }).catch(() => false))
    ) {
      return false;
    }

    console.log(
      "[QuestionnairePage] NHS 111 popup detected — clicking Book Private Consultation",
    );
    await popupButton.scrollIntoViewIfNeeded().catch(() => {});
    await popupButton.waitFor({ state: "visible", timeout: 10_000 });
    await popupButton.click({ force: true }).catch(async () => {
      await popupButton.evaluate((el: HTMLElement) => el.click());
    });

    await this.page.waitForLoadState("networkidle").catch(() => {});
    return true;
  }

  private async isOnPaymentPage(): Promise<boolean> {
    return this.page
      .locator(
        [
          ':text("Complete your payment")',
          ':text("Enter your card details here")',
          ':text("Select a saved card")',
          'input[autocomplete="cc-number"]',
          'button:has-text("Pay £")',
          'button:has-text("Pay")',
          ':text("Pass challenge")',
          ':text("3dsecure.io")',
        ].join(", "),
      )
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
  }

  private async isOnThankYouPage(): Promise<boolean> {
    return this.page
      .locator(
        [
          "text=/thank you for your order!/i",
          "text=/your order has been successfully placed/i",
          "text=/order summary/i",
          "text=/thank you!/i",
          "text=/your answers have been shared/i",
          'button:has-text("Back to Home")',
          'a:has-text("Back to Home")',
        ].join(", "),
      )
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
  }
}
