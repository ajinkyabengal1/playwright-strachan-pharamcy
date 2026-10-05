import { Page, Locator } from "@playwright/test";
import {
  getActiveConditionName,
  TEST_USER,
  QUESTIONNAIRE_FILL_MODE,
} from "../fixtures/test-data";
import {
  ERECTILE_DYSFUNCTION_RULES,
  SHINGLES_RULES,
  WEIGHT_MANAGEMENT_RULES,
  OUTCOME_RULES,
} from "./ConditionQuestionnaireRules";
import { getOutcomeConfig } from "../fixtures/outcome-config";

// Fallback answers for generic questionnaire fields that don't map to a
// specific rule (free-text boxes, occupation, etc.) or to real patient data
// (name/DOB/postcode — those use TEST_USER instead, see fillPatientInfoField
// below). Kept local rather than in test-data.ts, which real patient-info
// fields also read from.
const QUESTIONNAIRE_DEFAULTS = {
  freeTextAnswer:
    "No significant medical history or concerns to report at this time.",
  occupation: "Office worker",
};

/**
 * Handles the dynamic questionnaire wizard.
 * Questions are loaded one at a time; we detect the type and answer accordingly.
 */
export class QuestionnairePage {
  readonly page: Page;
  private readonly MAX_QUESTIONS = 50;
  // See the "gave up on a required field" fix in fillVisibleQuestionsOnce()
  // (ant-select handling) for why this is 5, not 2.
  private readonly MAX_STUCK_SELECT_ATTEMPTS = 5;
  private readonly answeredRuleKeys = new Set<string>();
  private readonly stuckSelectAttempts = new Map<string, number>();
  // ROOT CAUSE FIX ("Personal Information Gathering" burned the entire
  // 300s test timeout stuck re-opening the same range/date picker forever):
  // unlike the ant-select loop above, the range/date-picker loops had no
  // retry cap at all -- if a picker's cells never actually register a value
  // (this specific site's picker component apparently needs different
  // interaction than the "click 1st cell, then 7th" strategy that works on
  // other tenants), fillVisibleQuestionsOnce() just reopens it every single
  // pass, indefinitely, until the whole test times out.
  private readonly stuckPickerAttempts = new Map<string, number>();

  // ROOT CAUSE FIX ("Hepatitis A & B Travel Vaccination" left a required
  // "To Which Country or Countries you are going?" select permanently on
  // "Please Select" with a red validation error, while a separate but
  // structurally-identical "From Where Did You Travel From?" select right
  // above it got auto-filled with "Afghanistan" -- both share the same
  // options list, always default to picking `options.first()`, and this
  // site's own validation rejects the destination matching the origin. The
  // click still "succeeds" and looks answered at the moment we pick it, so
  // this was never revisited -- the error only appears after the fact,
  // once the form tries to validate. Track which option text this generic
  // handler has already picked for some OTHER select on this same page and
  // avoid repeating it, picking the next available option instead).
  private readonly usedGenericSelectValues = new Set<string>();

  /**
   * True once a terminal Result screen with no booking option (e.g.
   * "Self care", "Assessment complete") has been ended via its
   * "End assessment" button. That is a valid, successful end to the
   * journey — a pharmacist reviews the answers instead of a booking being
   * made — so the spec should count it as completed rather than failing
   * the run for never reaching a booking confirmation.
   */
  endedWithoutBooking = false;

  /**
   * Set whenever an outcome-config-recognized terminal screen (NHS 111,
   * etc.) is reached — captured at the moment it's actually visible, since
   * the spec's own final-assertion page re-scan can run after the dialog
   * has already been dismissed for tidiness. The spec prefers this over a
   * live page re-scan when present.
   */
  reachedOutcome: { id: string; label: string } | null = null;

  /**
   * Clears per-pass state so the questionnaire can be answered a second
   * time from scratch -- used when a terminal outcome screen (e.g. Self
   * Care, which only offers "End assessment") ended the first pass and the
   * spec restarts the condition to carry on through the rest of the
   * journey. Recorded answers are kept (latest answer per question wins).
   */
  resetForRestart() {
    this.answeredRuleKeys.clear();
    this.stuckSelectAttempts.clear();
    this.stuckPickerAttempts.clear();
    this.usedGenericSelectValues.clear();
    this.endedWithoutBooking = false;
    this.reachedOutcome = null;
  }

  /**
   * Every question this automation answered, in the order answered — used
   * to compare "what we filled" against "what the submit_questionnaire API
   * call actually sent" (see condition-flow.spec.ts's buildQaComparison()).
   * Keyed by question text since that's all the page-object side knows;
   * the API side only has numeric question_detail_id, matched by title text.
   */
  readonly filledAnswers: { question: string; answer: string }[] = [];

  private recordAnswer(question: string, answer: string) {
    const cleanQuestion = question.replace(/\s+/g, " ").trim();
    const cleanAnswer = answer.replace(/\s+/g, " ").trim();
    if (!cleanQuestion || !cleanAnswer) return;

    // ROOT CAUSE FIX (confirmed live -- Q&A Verification table showing
    // mismatches where the "Filled Answer" column displayed a completely
    // unrelated value, e.g. a generic free-text default for a numeric
    // question that was actually answered correctly): this used to push a
    // NEW entry on every call with no deduplication. A field answered more
    // than once across passes -- an early generic-fallback guess later
    // overwritten by a correct rule-based/retry fill, or the same field
    // re-scanned on a later pass -- accumulated multiple stale entries for
    // the same question text. buildQaComparison() then had multiple
    // candidates to fuzzy-match against a single submitted answer and could
    // pick the wrong (older, stale) one instead of the field's actual final
    // DOM value. Always keep only the LATEST recorded answer per question.
    const existing = this.filledAnswers.find(
      (entry) => entry.question === cleanQuestion,
    );
    if (existing) {
      existing.answer = cleanAnswer;
    } else {
      this.filledAnswers.push({ question: cleanQuestion, answer: cleanAnswer });
    }
  }

  /**
   * "required-only": generic questionnaire-content loops in
   * fillVisibleQuestionsOnce() skip any question without a required marker
   * (site's own "*"/required-question class), leaving it blank. Identity
   * fields (name/DOB/postcode/gender) are always filled regardless — they're
   * excluded from those loops already, not gated by this flag.
   */
  private readonly fillMode = QUESTIONNAIRE_FILL_MODE;

  /**
   * Walks up from a control to its nearest question wrapper and checks for
   * a required marker. Different tenants render this differently
   * (`.required-question` class, `.hq-question__required` class, or a
   * literal "*" in the question title) — checked all three, so unknown/odd
   * markup fails safe to "required" (still filled) rather than silently
   * skipping real required questions.
   */
  private async isControlRequired(control: Locator): Promise<boolean> {
    const wrapper = control
      .locator(
        'xpath=ancestor::*[contains(@class,"hq-question") or contains(@class,"questionnaire-answer-wrapper") or contains(@class,"question-container")][1]',
      )
      .first();
    const hasWrapper = (await wrapper.count().catch(() => 0)) > 0;
    if (!hasWrapper) return true;
    const html = await wrapper.innerHTML().catch(() => null);
    if (html === null) return true;
    return (
      /required-question|hq-question__required|question-required/.test(html) ||
      /class="[^"]*\brequired\b[^"]*"/.test(html) ||
      /[*]\s*(<|$)/.test(html)
    );
  }

  /** true = leave this control blank (fillMode is "required-only" and it isn't marked required) */
  private async shouldSkipOptional(control: Locator): Promise<boolean> {
    if (this.fillMode !== "required-only") return false;
    return !(await this.isControlRequired(control));
  }

  /**
   * Resolves which TEST_USER.dob part (day/month/year) a single box of a
   * split DOB field should get.
   *
   * ROOT CAUSE (screenshot: DOB boxes filled "15 / 15 / 150"): the previous
   * logic only recognized day/month/year by an exact placeholder match
   * (`/^d+$/i` etc, i.e. literal "DD"/"MM"/"YYYY"). Tenants whose boxes have
   * no placeholder — or a different one ("Day"/empty/etc) — fell through
   * every DOB branch into the generic numeric-field fallback, which filled
   * all three with `resolveNumericValue(...)`'s clamped/default guesses
   * instead of the real date. Each retry pass also re-attempted the same
   * wrong fill (site's DOB validation never clears it), which is what made
   * this field take "too much time".
   *
   * Fix: keep the placeholder check first (cheap, exact), then fall back to
   * this box's position among its own DOB-question sibling inputs — day,
   * month, year, in that DOM order — which holds regardless of placeholder
   * wording.
   */
  private async resolveDobPart(
    input: Locator,
    placeholder: string,
  ): Promise<string> {
    const p = placeholder.trim();
    if (/^d+$/i.test(p) || /\bday\b/i.test(p)) return TEST_USER.dob.day;
    if (/^m+$/i.test(p) || /\bmonth\b/i.test(p)) return TEST_USER.dob.month;
    if (/^y+$/i.test(p) || /\byear\b/i.test(p)) return TEST_USER.dob.year;

    const wrapper = input
      .locator(
        'xpath=ancestor::*[contains(@class,"hq-question") or contains(@class,"questionnaire-answer-wrapper") or contains(@class,"question-container")][1]',
      )
      .first();
    const wrapperHandle = (await wrapper.count().catch(() => 0)) > 0
      ? await wrapper.elementHandle().catch(() => null)
      : null;
    const inputHandle = await input.elementHandle().catch(() => null);

    let index = 0;
    if (wrapperHandle && inputHandle) {
      index = await this.page
        .evaluate(
          ({ wrapperEl, inputEl }) => {
            const inputs = Array.from(
              (wrapperEl as HTMLElement).querySelectorAll("input"),
            ).filter(
              (el) =>
                !["hidden", "checkbox", "radio"].includes(
                  (el as HTMLInputElement).type,
                ),
            );
            return inputs.indexOf(inputEl as HTMLInputElement);
          },
          { wrapperEl: wrapperHandle, inputEl: inputHandle },
        )
        .catch(() => 0);
    }

    return index === 1
      ? TEST_USER.dob.month
      : index === 2
        ? TEST_USER.dob.year
        : TEST_USER.dob.day;
  }

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
          // Next.js dev-mode ships a permanently-mounted (but hidden)
          // error-overlay dialog on every page; its stack trace/message can
          // coincidentally contain the word "Questionnaire" and falsely
          // satisfy the dialog selectors below, so exclude it explicitly.
          '[role="dialog"][aria-label*="questionnaire" i]:not([data-nextjs-dialog])',
          '[role="dialog"]:has-text("Questionnaire"):not([data-nextjs-dialog])',
          ':text("Questionnaires")',
          ':text("Do you have these symptoms?")',
          ':text("I do not have these symptoms")',
          ".question-container",
          // Legacy "hq-kit" questionnaire template (e.g. Kepple Lane's
          // "personal-information-gathering" condition): a single-page form
          // rendered inline, not a modal.
          ".questionnaire-answer-box--kit",
          ".hq-root",
          ".hq-question",
          '[class*="question"]:not([data-nextjs-dialog])',
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
  /**
   * Investigation-only instrumentation (gated by DEBUG_QUESTIONS=1): dumps
   * every visible question's heading + all its clickable option labels, so
   * a real outcome-branch map can be built from live output instead of
   * guessing. Not used by any normal run — safe to delete once the
   * Shingles outcome rules are fully authored and confirmed.
   */
  private async debugDumpVisibleQuestions() {
    const headings = this.page.locator(
      '.hq-question__title, .questions.required-question, .questions, .question-title',
    );
    const count = await headings.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const heading = headings.nth(i);
      if (!(await heading.isVisible().catch(() => false))) continue;
      const text = ((await heading.textContent().catch(() => "")) || "").trim();
      if (!text) continue;

      const wrapper = heading.locator(
        'xpath=ancestor::*[contains(@class,"hq-question") or contains(@class,"questionnaire-answer-wrapper") or contains(@class,"question-container")][1]',
      );
      const options = wrapper.locator(
        'label, .ant-radio-wrapper, .ant-radio-button-wrapper, .ant-checkbox-wrapper',
      );
      const optCount = await options.count().catch(() => 0);
      const optionTexts: string[] = [];
      for (let j = 0; j < Math.min(optCount, 20); j++) {
        const t = ((await options.nth(j).textContent().catch(() => "")) || "").trim();
        if (t) optionTexts.push(t);
      }
      console.log(`[DEBUG_QUESTIONS] "${text}" → options: ${JSON.stringify(optionTexts)}`);
    }
  }

  async answerAllQuestions() {
    // Once nothing changes for a few consecutive steps, further looping is
    // pure waste — each pass re-scans the entire page (selects, dates,
    // radios, checkboxes, etc.) even when there is nothing left to fill,
    // and the loop otherwise only exits early on a handful of specific
    // terminal conditions (thank-you, drug-selection, signup, dialog
    // closed). Without this, a fully-answered form still burns out the
    // full MAX_QUESTIONS budget at ~100-150ms per empty pass.
    let noProgressStreak = 0;
    const MAX_NO_PROGRESS_STREAK = 3;

    for (let step = 0; step < this.MAX_QUESTIONS; step++) {
      await this.page.waitForTimeout(200); // brief pause for animations

      // "Age should be between X and Y" validation error also renders a
      // "Back to Home" button, which isOnThankYouPage() below treats as a
      // generic success indicator — without this check first, that guard
      // would silently return here without ever clicking anything.
      if (await this.handleAgeValidationError()) {
        console.log(
          "[QuestionnairePage] Age validation error detected — clicked Back to Home",
        );
        return;
      }

      // Guard: once thank-you page is visible, stop questionnaire handling immediately.
      if (await this.isOnThankYouPage()) {
        console.log(
          "[QuestionnairePage] Thank-you page detected — exiting questionnaire handler",
        );
        return;
      }

      // A questionnaire modal dialog (e.g. Kepple Lane) sits on top of the
      // booking page, whose own background markup (heading "Book: ...",
      // `[class*="booking"]` wrappers) can false-positive the drug-selection/
      // payment/signup-or-booking checks below. While the dialog is open,
      // skip those bail-out checks so this loop keeps answering its
      // progressively-revealed questions instead of returning to the outer
      // spec loop after every single question.
      const dialogOpen = await this.isQuestionnaireDialogOpen();

      if (!dialogOpen) {
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
      }

      // If we are no longer on a questionnaire page and no question is visible, we are done
      if (step > 0 && !(await this.isOnQuestionnairePage())) {
        console.log(
          "[QuestionnairePage] No longer on questionnaire page — exiting questionnaire handler",
        );
        return;
      }

      if (process.env.DEBUG_QUESTIONS === "1") {
        await this.debugDumpVisibleQuestions();
      }

      let answered = await this.answerCurrentQuestion();
      const advanced = await this.progressQuestionnaire();

      if (!advanced && !answered) {
        // No question found and no button — might be loading or done
        await this.page.waitForTimeout(1000);
        if (await this.isOnThankYouPage()) return;
        if (!(await this.isQuestionnaireDialogOpen())) {
          if (await this.isOnDrugSelectionPage()) return;
          if (await this.isOnSignupOrBookingPage()) return;
        }
        if (!(await this.isOnQuestionnairePage())) return;

        noProgressStreak++;
        if (noProgressStreak >= MAX_NO_PROGRESS_STREAK) {
          console.log(
            `[QuestionnairePage] No progress for ${MAX_NO_PROGRESS_STREAK} consecutive steps — exiting early instead of exhausting all ${this.MAX_QUESTIONS}`,
          );
          return;
        }
      } else {
        noProgressStreak = 0;
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
    // ROOT CAUSE FIX (confirmed live -- a disabled radio hung the full 15s
    // actionTimeout on every retry, up to MAX_QUESTIONS times): `.filter({
    // hasNot: locator(selector) })` only excludes elements that have a
    // DESCENDANT matching selector -- but "ant-radio-wrapper-disabled" etc.
    // are classes on the wrapper element ITSELF, not a child, so this never
    // actually excluded anything. `:scope:not(...)` filters the element
    // against its own classes/attributes instead.
    const enabledWrappers = wrappers.locator(
      ":scope:not(.ant-radio-wrapper-disabled):not(.ant-radio-button-wrapper-disabled):not([aria-disabled='true'])",
    );
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

    // ROOT CAUSE (suspected, not yet reproduced live -- matches an observed
    // Yes-filled/No-submitted mismatch pattern on Weight Management's
    // eating-disorder radios): when Playwright's own `.check({force:true})`
    // throws, this class's fallbacks patch the native input directly
    // (`el.checked = true` + synthetic dispatchEvent calls) rather than
    // going through a real click. For an AntD Radio.Group, the VISIBLE and
    // SUBMITTED state is driven by React comparing the group's own value to
    // each option -- rendered as the "-checked" CSS class below -- not by
    // the native input's own `.checked` DOM property. A manually-patched
    // `.checked` can read back `true` here (satisfying the check that used
    // to run first, below) without AntD's actual React state ever having
    // changed, if the dispatched events didn't reach whatever handler AntD
    // actually listens on. React can then silently reconcile the input's
    // `.checked` back to its real (unchanged) value on its next render --
    // with no event firing -- and that stale value is what gets submitted,
    // even though this function already reported success. Check the AntD/
    // aria signals FIRST: they can only ever reflect the site's own real
    // state (nothing in this file writes to them directly), whereas the
    // native `.checked` property is the one signal our own fallback code
    // can spoof.
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

    const ariaRadio = scope
      .locator(`[role="radio"]:has-text("${labelText}")`)
      .first();
    if (await ariaRadio.count()) {
      return await ariaRadio
        .evaluate((el) => el.getAttribute("aria-checked") === "true")
        .catch(() => false);
    }

    // Plain (non-AntD, non-aria) radio -- the native property is the only
    // signal there is, and nothing above spoofs it for this case.
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
        // Real el.click() (not a manual `.checked = true` + synthetic
        // dispatchEvent patch) -- see isRadioSelectionApplied's comment on
        // why patching `.checked` directly can look successful here yet
        // never actually change a React-controlled AntD radio's real
        // state, which is what silently reverts and gets submitted later.
        await radioInput.evaluate((el: HTMLInputElement) => el.click());
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
            // ROOT CAUSE FIX (confirmed live -- a plain `.includes("disabled")`
            // false-positives on Tailwind's `disabled:opacity-40
            // disabled:cursor-not-allowed` utility classes, which are ALWAYS
            // present in className regardless of actual state -- only their
            // CSS effect is conditional. Match "disabled" only as a whole
            // class token or a "-disabled" suffix (e.g. AntD's
            // "ant-radio-wrapper-disabled"), never as a "disabled:" variant
            // prefix.
            const cls = htmlEl.className || "";
            return (
              /(^|\s)([\w-]*-)?disabled(\s|$)/.test(cls) ||
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

      // ROOT CAUSE FIX (confirmed live -- hung the full 15s actionTimeout
      // on a disabled "No" wrapper, same class of bug fixed in
      // clickBestRadioOption/the standardRadios loop above): check the
      // wrapper's OWN class/attribute before clicking, and cap the actual
      // click attempt short so an unexpectedly-disabled option fails fast
      // instead of burning the full default timeout.
      const isDisabled = await option
        .evaluate((el: HTMLElement) => {
          // Same Tailwind `disabled:` variant false-positive fix as above --
          // match "disabled" only as a whole token or "-disabled" suffix.
          const cls = el.className || "";
          return (
            /(^|\s)([\w-]*-)?disabled(\s|$)/.test(cls) ||
            el.getAttribute("aria-disabled") === "true" ||
            el.querySelector("input")?.hasAttribute("disabled")
          );
        })
        .catch(() => false);
      if (isDisabled) continue;

      await option.scrollIntoViewIfNeeded().catch(() => {});
      await option.click({ force: true, timeout: 3_000 }).catch(async () => {
        await option.evaluate((el: HTMLElement) => el.click()).catch(() => {});
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
      // (Tailwind `disabled:` variant false-positive fix -- see above)
      const disabled = await radioOption
        .evaluate((el) => {
          const htmlEl = el as HTMLElement;
          const cls = htmlEl.className || "";

          return (
            /(^|\s)([\w-]*-)?disabled(\s|$)/.test(cls) ||
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
        // Real el.click() -- same reasoning as the radio fallback above:
        // a manually-patched `.checked` can read back true (Playwright's
        // own isChecked() below reads that same native property) without
        // a React-controlled checkbox's real state ever changing.
        await checkboxInput.check({ force: true }).catch(async () => {
          await checkboxInput.evaluate((el: HTMLInputElement) => el.click());
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
    //
    // ROOT CAUSE (found via live Kepple Lane investigation): this selector
    // never included ".hq-question__title" — the class this same file
    // already relies on elsewhere (getNearbyQuestionText, the ant-select
    // stuck-attempt key) for hq-kit-style tenants. Every rule-based match
    // against a hq-kit condition (Shingles included) silently always
    // returned zero matches and fell straight through to the generic
    // fallback — confirmed by every prior run's "rule=false, generic=true"
    // log line, on every condition, every time.
    return this.page
      .locator(
        [
          ".hq-question__title",
          ".questions.required-question",
          ".questions",
          ".question-title",
        ].join(", "),
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
    let handledByConditionRule = await this.answerByConditionRules();

    // 2. Process all visible questions generically (essential for forms displaying multiple questions at once)
    const handledGenericFields = await this.fillAllVisibleQuestions();

    // ROOT CAUSE FIX (confirmed live -- Weight Management's questionnaire is
    // a CHAIN of separate templates; a newly-revealed question (e.g. the
    // "Would you like to continue with this assessment?" gate that must be
    // "Yes" for the eating-disorder sub-questions to even render) can finish
    // rendering only partway through this pass -- after the rule scan above
    // already ran, but in time for fillAllVisibleQuestions()'s generic
    // fallback to grab it first and answer it wrong. Re-run the rule engine
    // once more so it can override any such default before this pass ends.
    // ROOT CAUSE FIX (confirmed live -- Shingles gateway run answered Q1 via
    // rule, which revealed Q2/Q3 only AFTER that rule pass -- the guard
    // here used to only re-run the rule engine when NOTHING matched on the
    // first pass, so any run where at least one rule fired (nearly every
    // run) skipped this rescan entirely, leaving the newly-revealed Q2/Q3
    // to the generic fallback above, which prefers "No"/"None of the
    // above" answers and wrongly triggered Self Care instead of Gateway.
    // Always rescan, regardless of what the first pass already answered.
    handledByConditionRule =
      (await this.answerByConditionRules()) || handledByConditionRule;

    if (handledByConditionRule || handledGenericFields) {
      console.log(
        `[QuestionnairePage] Handled questions: rule=${handledByConditionRule}, generic=${handledGenericFields}`
      );
      await this.clickConfirmIfVisible();
      return true;
    }

    // For weight-management we keep questionnaire strictly rule-driven to avoid
    // falling into generic shingles-style radio fallbacks on disabled options.
    //
    // ROOT CAUSE FIX (confirmed live -- "Weight Management (Weight Loss
    // Treatment)", real slug "weight-management-weight-loss-treatment-
    // private", hung for the full test timeout stuck inside the Shingles-
    // style "I do not have these symptoms" fallback block below): this
    // exact-string check only ever matched the literal condition name
    // "weight management" -- any other Weight Management variant slug (this
    // one included) never matched it at all, so every such variant fell
    // through into that unrelated fallback block regardless of this guard's
    // intent. Match by substring, same convention used everywhere else in
    // this file for identifying a Weight Management condition.
    if (
      activeCondition.includes("weight management") ||
      activeCondition.includes("weight-management")
    ) {
      return false;
    }

    // ROOT CAUSE FIX (confirmed live -- every Shingles outcome run
    // (self_care/gp_referral/immediate_action) kept landing on NHS 111
    // regardless of which outcome was requested): SHINGLES_RULES already
    // covers every one of these questions (both checkboxes AND all 3
    // radios, including "confirm what level of treatment you need"), so
    // this legacy block below is fully redundant for Shingles now -- and
    // actively harmful. Its own hardcoded
    // `selectRadioByText("I do not have these symptoms")` call matches
    // ANY of the 3 "symptoms"-worded radio groups, not specifically Q1 --
    // so whenever the RULE engine's own click-and-verify for Q2/Q3 merely
    // ran slower than its ~1.4s retry budget (observed: the dev server
    // under sustained load across this session re-rendered AntD's checked
    // state late), this block ran in the SAME pass as the failed
    // verification, found that same still-unanswered radio group, and
    // force-answered it "I do not have these symptoms" -- NHS 111's own
    // trigger answer -- before the rule engine's next pass ever got a
    // chance to retry with the correct one. Skip this whole block for
    // Shingles; the no-progress-streak exit already handles a genuinely
    // stuck page correctly without needing to guess an answer here.
    if (activeCondition.includes("shingles")) {
      return false;
    }

    // ROOT CAUSE FIX (confirmed live -- "All Test Question" hung for the
    // FULL 5-minute test timeout with a required "Please select Drug"
    // remote-search select permanently empty, red "Please select option
    // from drop down" validation showing, while this legacy fallback kept
    // repeatedly force-clicking random unrelated "No" radios elsewhere on
    // the page via its broad `text=/^No$/i` selector, over and over, never
    // addressing the actual blocker): once we've already given up on some
    // required select or date/range picker (its own retry cap reached), NO
    // amount of clicking unrelated radios here is going to un-stick the
    // form -- that field will stay empty and the form can never validate
    // regardless. Skip this whole fallback in that case, for every
    // condition, so the caller's no-progress-streak exit can kick in and
    // fail fast (within a few seconds) instead of burning the rest of the
    // test timeout on a lost cause.
    const hasGivenUpOnARequiredField =
      [...this.stuckSelectAttempts.values()].some(
        (n) => n >= this.MAX_STUCK_SELECT_ATTEMPTS,
      ) || [...this.stuckPickerAttempts.values()].some((n) => n >= 2);
    if (hasGivenUpOnARequiredField) {
      console.log(
        "[QuestionnairePage] Already gave up on a required field elsewhere on this page -- skipping the generic radio fallback instead of retrying a lost cause.",
      );
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

    // ROOT CAUSE FIX (confirmed live -- "All Test Question", a completely
    // generic condition with no Shingles-style wording anywhere on it,
    // burned the ENTIRE test timeout stuck in this block): everything below
    // this point was written specifically for Shingles' "Do you have these
    // symptoms?" question and assumes that exact wording exists on the
    // page, but it ran unconditionally whenever neither the rule engine nor
    // generic fill handled a question -- on ANY condition. With no such
    // question actually present, `selectRadioByText` fails, and the code
    // falls through to a broad `text=/^No$/i` scan that matches many
    // unrelated "No" radios elsewhere on a generic questionnaire. It force-
    // clicks each one (with no "already answered" check) then verifies
    // against the WRONG label ("I do not have these symptoms", not "No"),
    // so the check always fails and it just re-clicks the same unrelated
    // radios again on every single step, 50 times, without ever making
    // real progress. Only enter this Shingles-specific block when the page
    // actually looks like Shingles' own questionnaire.
    const looksLikeShingles = await this.page
      .locator(':text("these symptoms")')
      .first()
      .isVisible()
      .catch(() => false);
    if (!looksLikeShingles) {
      return false;
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
    // Filter to inputs that are actually usable — a matched field can be
    // disabled (e.g. a blood-pressure field this same handler already
    // filled correctly, then the site locks it read-only) or already
    // filled, and blindly `.fill()`-ing a disabled field hangs for the
    // full 15s action timeout instead of failing fast.
    const numberInputAll = this.page.locator(
      'input[type="number"], input[inputmode="numeric"]',
    );
    const numberInputCount = await numberInputAll.count().catch(() => 0);
    const usableNumberInputs: ReturnType<Page["locator"]>[] = [];
    for (let i = 0; i < numberInputCount; i++) {
      const candidate = numberInputAll.nth(i);
      const usable =
        (await candidate.isVisible().catch(() => false)) &&
        (await candidate.isEnabled().catch(() => false)) &&
        (await candidate.evaluate((el: HTMLInputElement) => !el.value).catch(() => true));
      if (usable) usableNumberInputs.push(candidate);
    }
    if (usableNumberInputs.length > 0) {
      if (usableNumberInputs.length >= 2) {
        await usableNumberInputs[0].click();
        await usableNumberInputs[0].fill("170");
        await usableNumberInputs[1].click();
        await usableNumberInputs[1].fill("70");
      } else {
        const pageText = await this.page.textContent("body").catch(() => "");
        if (/height|cm/i.test(pageText ?? "")) {
          await usableNumberInputs[0].fill("170");
        } else if (/weight|kg/i.test(pageText ?? "")) {
          await usableNumberInputs[0].fill("70");
        } else {
          await usableNumberInputs[0].fill("70");
        }
      }
      return true;
    }

    // Text / textarea
    const textInputAll = this.page.locator(
      'input[type="text"]:not([name="first_name"]):not([name="last_name"]):not([name="postcode"]), textarea',
    );
    const textInputCount = await textInputAll.count().catch(() => 0);
    for (let i = 0; i < textInputCount; i++) {
      const candidate = textInputAll.nth(i);
      const usable =
        (await candidate.isVisible().catch(() => false)) &&
        (await candidate.isEnabled().catch(() => false)) &&
        (await candidate.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => !el.value).catch(() => true));
      if (!usable) continue;
      await candidate.click();
      await candidate.clear();
      await candidate.fill(QUESTIONNAIRE_DEFAULTS.freeTextAnswer);
      return true;
    }

    // Date picker
    const datePickerAll = this.page.locator(".ant-picker input");
    const datePickerCount = await datePickerAll.count().catch(() => 0);
    for (let i = 0; i < datePickerCount; i++) {
      const candidate = datePickerAll.nth(i);
      const usable =
        (await candidate.isVisible().catch(() => false)) &&
        (await candidate.isEnabled().catch(() => false)) &&
        (await candidate.evaluate((el: HTMLInputElement) => !el.value).catch(() => true));
      if (!usable) continue;
      const datePicker = candidate;
      await datePicker.click();
      await datePicker.fill("1990-01-01");
      await this.page.keyboard.press("Enter");
      return true;
    }

    return false;
  }

  /**
   * Repeatedly re-scans the page within a single call. Checking a checkbox
   * or radio can reveal brand-new nested required fields (e.g. selecting a
   * "Sport" hobby reveals "Which game do you like?" and a date range) whose
   * section (range pickers, numbers, etc.) already ran earlier in the same
   * linear pass — without this outer loop, those newly-revealed fields
   * never get filled until here catches them on a follow-up pass.
   */
  private async fillAllVisibleQuestions(): Promise<boolean> {
    let answeredOverall = false;
    for (let pass = 0; pass < 4; pass++) {
      const answeredThisPass = await this.fillVisibleQuestionsOnce();
      if (!answeredThisPass) break;
      answeredOverall = true;
      await this.page.waitForTimeout(200); // let newly-revealed fields mount
    }
    return answeredOverall;
  }

  /**
   * Finds the question text nearest to a field, trying this hq-kit
   * template's own wrapper (`.hq-question` / `.hq-question__title`) as well
   * as the older wrapper classes used by other tenants.
   */
  private async getNearbyQuestionText(
    input: ReturnType<Page["locator"]>,
  ): Promise<string> {
    const hqTitle = input
      .locator(
        'xpath=ancestor::*[contains(@class,"hq-question")][1]//*[contains(@class,"hq-question__title")]',
      )
      .first();
    if (await hqTitle.count().catch(() => 0)) {
      const text = (await hqTitle.textContent().catch(() => "")) || "";
      if (text.trim()) return text;
    }

    const legacyWrapper = this.page
      .locator(
        '.questionnaire-answer-wrapper, .numerical-question-wrapper, .text-box-question-wrapper, .textarea-question-wrapper, .health-data-question-wrapper',
      )
      .filter({ has: input })
      .first();
    if (await legacyWrapper.count().catch(() => 0)) {
      const qLabel = legacyWrapper.locator(".questions");
      if (await qLabel.count().catch(() => 0)) {
        return (await qLabel.first().textContent().catch(() => "")) || "";
      }
    }

    return "";
  }

  /**
   * Picks a numeric value that actually satisfies a field's valid range,
   * instead of a hardcoded guess. Reads the field's own `min`/`max`
   * attributes first, then falls back to parsing "between X and/to Y"
   * phrasing from its placeholder or question text (e.g. "Value should be
   * between 100 and 250", "Enter Number between 12 to 20"). The fallback
   * default is used only when no range is found, and is clamped to any
   * range that is found.
   */
  private async resolveNumericValue(
    input: ReturnType<Page["locator"]>,
    questionText: string,
    placeholder: string,
    fallback: number,
  ): Promise<string> {
    const attrMin = await input.getAttribute("min").catch(() => null);
    const attrMax = await input.getAttribute("max").catch(() => null);
    let min = attrMin !== null && attrMin !== "" ? Number(attrMin) : undefined;
    let max = attrMax !== null && attrMax !== "" ? Number(attrMax) : undefined;

    if (min === undefined || max === undefined) {
      const combined = `${questionText} ${placeholder}`;
      const rangeMatch = combined.match(
        /between\s+(\d+(?:\.\d+)?)\s*(?:and|to|-)\s*(\d+(?:\.\d+)?)/i,
      );
      if (rangeMatch) {
        min = min ?? Number(rangeMatch[1]);
        max = max ?? Number(rangeMatch[2]);
      }
    }

    let value = fallback;
    if (min !== undefined && !Number.isNaN(min) && value < min) {
      value = max !== undefined && !Number.isNaN(max) ? Math.round((min + max) / 2) : min;
    }
    if (max !== undefined && !Number.isNaN(max) && value > max) {
      value = min !== undefined && !Number.isNaN(min) ? Math.round((min + max) / 2) : max;
    }
    return String(value);
  }

  /**
   * A field can already hold a value yet still be invalid (e.g. "11" in a
   * min="100" max="250" height field) — that's not "empty" but must still
   * be re-filled, or the site's own validation error blocks submission
   * forever. Returns true when the field has no min/max bounds (nothing to
   * violate) or its current value satisfies them.
   */
  private async isWithinDeclaredBounds(
    input: ReturnType<Page["locator"]>,
  ): Promise<boolean> {
    return input
      .evaluate((el: HTMLInputElement) => {
        const raw = el.value;
        if (!raw) return true; // emptiness is handled separately
        const num = Number(raw);
        if (Number.isNaN(num)) return true; // not a bounds violation we can judge
        const min = el.getAttribute("min");
        const max = el.getAttribute("max");
        if (min !== null && min !== "" && num < Number(min)) return false;
        if (max !== null && max !== "" && num > Number(max)) return false;
        return true;
      })
      .catch(() => true);
  }

  /**
   * Blood-pressure fields (`inputmode="numeric"`, placeholder "___/___")
   * are masked inputs that auto-insert the "/" themselves as digits are
   * typed — `.fill("120/80")` sets the raw value in one shot, bypassing
   * that masking logic entirely, and the component's own onChange handler
   * then rejects/reverts the unexpected literal "/" character, leaving the
   * field empty. Type the digits only via real keystrokes instead, and let
   * the mask insert the separator; fall back to a literal fill only if
   * that doesn't stick.
   */
  private async fillBloodPressure(
    input: ReturnType<Page["locator"]>,
  ): Promise<void> {
    // A complete result looks like "120/80" — a bare digit (e.g. a stray
    // "170/" left by a half-applied mask) is NOT success and must keep
    // retrying, unlike other fields where "contains a digit" is enough.
    const isComplete = (v: string) => /^\d{2,3}\/\d{2,3}$/.test(v.trim());

    for (let attempt = 0; attempt < 3; attempt++) {
      await input.click({ force: true }).catch(() => {});
      // .fill("") alone can fail to clear a masked input; select-all +
      // backspace via real keyboard input is more reliable here, same
      // approach already used for the date pickers elsewhere in this file.
      await this.page.keyboard.press("Meta+A").catch(() => {});
      await this.page.keyboard.press("Control+A").catch(() => {});
      await this.page.keyboard.press("Backspace").catch(() => {});
      await input.fill("").catch(() => {});

      await input.type("12080", { delay: 40 }).catch(() => {});
      await this.page.waitForTimeout(250);
      let value = (await input.inputValue().catch(() => "")) ?? "";
      if (isComplete(value)) return;

      // Mask didn't cooperate — try a literal fill with the separator.
      await input.fill("120/80").catch(() => {});
      value = (await input.inputValue().catch(() => "")) ?? "";
      if (isComplete(value)) return;
    }
  }

  private async fillVisibleQuestionsOnce(): Promise<boolean> {
    let answeredAny = false;

    // 0. Handle split "Date of birth" boxes (3 separate day/month/year inputs).
    //
    // ROOT CAUSE of the "17/70/150" / "15/15/150" garbage and the field
    // taking forever: detection was done PER INPUT, walking up to that
    // input's *own* nearest `.hq-question` ancestor to read a title. On
    // this tenant, only the first (day) box's own wrapper actually carries
    // the "Date of birth" title text — the month/year boxes' wrappers don't
    // repeat it — so only the day box was ever recognized as DOB; month and
    // year silently fell through to the generic numeric-fallback branches
    // (clamped-bounds guess / flat default), which never satisfies the
    // site's date validation, so every one of the (up to 4) re-scan passes
    // retried the same wrong fill — that's the slowness.
    //
    // Fix: detect the group from the HEADING side instead of per-input —
    // walk up from the "Date of birth" text to the nearest ancestor that
    // contains at least 2 real inputs (i.e. the shared group container,
    // however many individual mini-wrappers it has inside), then fill all
    // of them by position in one shot. This also fixes it before the
    // generic loops below ever see these boxes, so isWithinDeclaredBounds
    // is satisfied on the first pass and nothing retries.
    const dobHeading = this.page.locator(':text("Date of birth")').first();
    if (await dobHeading.count().catch(() => 0)) {
      // ROOT CAUSE FIX (confirmed live -- this corrupted an unrelated "Full
      // Name" field with the DOB day value "15" on a tenant whose DOB is a
      // SINGLE AntD calendar picker, not 3 separate day/month/year boxes):
      // that single-picker's own `.hq-question` wrapper contains only 1
      // input, so the old `>= 2` walk-up kept climbing ancestors until it
      // hit the whole question-stack container -- which also holds Full
      // Name, the age spinner, etc. -- and then blindly filled its first 3
      // inputs as if they were day/month/year boxes.
      //
      // Real split-DOB groups (the tenant this was originally written for)
      // are a small, TIGHT wrapper around exactly the 3 plain text boxes and
      // nothing else -- so require the ancestor to contain 2-4 inputs (never
      // an unbounded "whole page" match) AND contain no `.ant-picker`
      // widget (a single calendar picker is never a split-box group).
      const dobGroup = dobHeading
        .locator(
          'xpath=ancestor::*[count(.//input[not(@type="hidden") and not(@type="checkbox") and not(@type="radio")]) >= 2 and count(.//input[not(@type="hidden") and not(@type="checkbox") and not(@type="radio")]) <= 4 and not(.//*[contains(@class,"ant-picker")])][1]',
        )
        .first();
      if (await dobGroup.count().catch(() => 0)) {
        const dobBoxes = dobGroup.locator(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
        );
        const dobBoxCount = await dobBoxes.count().catch(() => 0);
        const dobValues = [
          TEST_USER.dob.day,
          TEST_USER.dob.month,
          TEST_USER.dob.year,
        ];
        for (let i = 0; i < Math.min(dobBoxCount, 3); i++) {
          const box = dobBoxes.nth(i);
          if (!(await box.isVisible().catch(() => false))) continue;
          const current = (await box.inputValue().catch(() => "")).trim();
          if (current === dobValues[i]) continue;
          await box.fill(dobValues[i]).catch(() => {});
          answeredAny = true;
        }
      }
    }

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
        
        if ((isStartEmpty || isEndEmpty) && (await this.shouldSkipOptional(picker))) {
          continue;
        }

        // ROOT CAUSE FIX (confirmed live -- this let the SAME stuck field
        // retry the expensive click/dropdown-wait block many times instead
        // of actually stopping after 2 attempts, burning the whole test
        // timeout): keying by `getNearbyQuestionText(picker)` is unstable
        // across calls -- its result can shift slightly as sibling fields
        // fill in around it, so the retry counter for the "same" field kept
        // resetting to a fresh key and never reached the >=2 cutoff.
        // Position (`i`) is stable across calls within one render pass;
        // question text is still used for the human-readable log message.
        const rangePickerKey = `range-picker-${i}`;
        const rangePickerLabel =
          (await this.getNearbyQuestionText(picker)) || rangePickerKey;
        if ((isStartEmpty || isEndEmpty) && (this.stuckPickerAttempts.get(rangePickerKey) ?? 0) >= 2) {
          continue;
        }

        if (isStartEmpty || isEndEmpty) {
          // Same stale-dropdown race fix as the single date picker below.
          await this.page.keyboard.press("Escape").catch(() => {});
          console.log("[QuestionnairePage] Opening range picker dropdown by clicking start input...");
          // ROOT CAUSE FIX (confirmed live -- this hung for the ENTIRE
          // remaining test timeout, not just this picker's own retry cap):
          // a bare `.click()` with no explicit timeout falls back to
          // Playwright's default actionTimeout, which without an override
          // effectively becomes "wait up to the whole test's remaining
          // budget" -- if the target becomes stale/covered/never-settles, a
          // SINGLE click can silently eat the rest of the 2-5 minute test.
          // Bound it and swallow failure so the retry-cap logic below (which
          // already handles "still empty after N attempts") gets a chance
          // to run instead of the whole test hanging on one click.
          await inputs.nth(0).click({ force: true, timeout: 5_000 }).catch(() => {});
          
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
                // Same fix as the single-date picker's manual-typing
                // fallback below: real per-character keystrokes, not a
                // single bulk `.fill()`, so AntD's own keystroke-driven
                // date parser actually commits the value it needs for
                // the site's real (not just DOM-visible) form validity.
                await start.pressSequentially("01-05-2026", { delay: 20 }).catch(async () => {
                  await start.fill("01-05-2026");
                });
                await start.press("Enter").catch(() => {});
                await this.page.keyboard.press("Enter").catch(() => {});
                answeredAny = true;
              }
              const end = inputs.nth(1);
              if (isEndEmpty) {
                await end.evaluate((el: HTMLInputElement) => el.removeAttribute("readonly"));
                await end.click();
                await end.fill("");
                await end.pressSequentially("15-05-2026", { delay: 20 }).catch(async () => {
                  await end.fill("15-05-2026");
                });
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

        const [startNow, endNow] = await Promise.all([
          inputs.nth(0).inputValue().catch(() => ""),
          inputs.nth(1).inputValue().catch(() => ""),
        ]);
        const stillIncomplete =
          (!startNow || startNow === "DD-MM-YYYY" || startNow === "YYYY-MM-DD" || startNow === "DD/MM/YYYY") ||
          (!endNow || endNow === "DD-MM-YYYY" || endNow === "YYYY-MM-DD" || endNow === "DD/MM/YYYY");
        if (stillIncomplete) {
          const attempts = (this.stuckPickerAttempts.get(rangePickerKey) ?? 0) + 1;
          this.stuckPickerAttempts.set(rangePickerKey, attempts);
          if (attempts >= 2) {
            console.log(`[QuestionnairePage] Range picker "${rangePickerLabel}" still empty after ${attempts} attempts -- giving up to avoid retrying forever`);
          }
        } else {
          this.recordAnswer(rangePickerLabel, `${startNow} - ${endNow}`);
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
      
      if (isEmpty && (await this.shouldSkipOptional(picker))) continue;

      // Same key-instability fix as rangePickerKey above -- keep this
      // purely positional so the retry cap actually accumulates instead of
      // resetting every call.
      const datePickerKey = `date-picker-${i}`;
      const datePickerLabel =
        (await this.getNearbyQuestionText(picker)) || datePickerKey;
      if (isEmpty && (this.stuckPickerAttempts.get(datePickerKey) ?? 0) >= 2) continue;

      if (isEmpty) {
        // ROOT CAUSE FIX (confirmed live -- two structurally-identical
        // single-date questions back to back on the same page; one filled
        // fine, the very next one didn't): opening a SECOND `.ant-picker`
        // dropdown right after a prior one closed can race against that
        // prior dropdown's own closing animation/DOM removal, so
        // `.ant-picker-dropdown:visible.first()` can grab a stale, already-
        // closing panel instead of the freshly-opened one for THIS picker --
        // its cell click then lands on nothing. Press Escape first to force
        // any lingering dropdown fully closed before opening a new one.
        await this.page.keyboard.press("Escape").catch(() => {});
        console.log("[QuestionnairePage] Opening single date picker dropdown...");
        // Same unbounded-click hang fix as the range picker above.
        await picker.click({ force: true, timeout: 5_000 }).catch(() => {});

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
          console.log("[QuestionnairePage] Cell not visible, falling back to manual typing...");
        }

        // ROOT CAUSE FIX (confirmed live -- a required date field left
        // empty after a failed cell click permanently blocks the form's own
        // validation, which meant the outer loop could NEVER converge and
        // burned the full test timeout retrying elsewhere): don't wait for
        // a second outer-loop pass to try the manual-typing fallback --
        // verify the click actually took effect and fall back to typing
        // immediately, within this same attempt, whenever it didn't.
        const valueAfterCellClick = await picker.inputValue().catch(() => "");
        const stillEmptyAfterCellClick =
          !valueAfterCellClick ||
          valueAfterCellClick === "DD-MM-YYYY" ||
          valueAfterCellClick === "YYYY-MM-DD" ||
          valueAfterCellClick === "DD/MM/YYYY";
        if (stillEmptyAfterCellClick) {
          console.log("[QuestionnairePage] Cell click didn't set a value -- falling back to manual typing...");
          await this.page.keyboard.press("Escape").catch(() => {});
          await picker.evaluate((el: HTMLInputElement) => el.removeAttribute("readonly"));
          await picker.click({ timeout: 5_000 }).catch(() => {});
          await picker.fill("");
          const placeholder = (await picker.getAttribute("placeholder")) || "";
          const dateStr = placeholder.includes("YYYY") ? "1990-01-01" : "01-01-1990";
          // ROOT CAUSE FIX (suspected, matches a Meadows Pharmacy
          // "Continue stays disabled forever with every field showing
          // answered" hang): `.fill()` sets the input's value in one shot
          // via a single native `input` event -- AntD's DatePicker parses
          // manually-typed dates through its OWN per-keystroke handler
          // (it needs partial-input tracking for backspace/separators),
          // not a generic input event, so `.fill()` can leave the DOM
          // input showing the typed text (satisfying this file's own
          // "is it empty" checks and the site's `--answered` CSS class)
          // while AntD's real internal date value -- what actually gates
          // the site's own Continue/submit validity -- never gets set.
          // Real per-character keystrokes go through the same handler a
          // human's typing would.
          await picker.pressSequentially(dateStr, { delay: 20 }).catch(async () => {
            await picker.fill(dateStr); // last-resort fallback
          });
          await picker.press("Enter").catch(() => {});
          await this.page.keyboard.press("Enter").catch(() => {});
          answeredAny = true;
        }
        const dateNow = await picker.inputValue().catch(() => "");
        const dateStillEmpty = !dateNow || dateNow === "DD-MM-YYYY" || dateNow === "YYYY-MM-DD" || dateNow === "DD/MM/YYYY";
        if (dateStillEmpty) {
          const attempts = (this.stuckPickerAttempts.get(datePickerKey) ?? 0) + 1;
          this.stuckPickerAttempts.set(datePickerKey, attempts);
          if (attempts >= 2) {
            console.log(`[QuestionnairePage] Date picker "${datePickerLabel}" still empty after ${attempts} attempts -- giving up to avoid retrying forever`);
          }
        } else {
          this.recordAnswer(datePickerLabel, dateNow);
        }
      }
    }

    // 2. Handle Text / Textarea fields
    const textInputs = this.page.locator(
      'input[type="text"]:not([name="first_name"]):not([name="last_name"]):not([name="postcode"]):not([name="email"]):not([name="phone"]), ' +
      // AntD's InputNumber inner input has no `type` attribute but is
      // numeric-only — excluded here so section 3 below handles it instead;
      // filling it with text here gets silently rejected/reverted forever.
      'input:not([type]):not(.ant-input-number-input):not([name="first_name"]):not([name="last_name"]):not([name="postcode"]):not([name="email"]):not([name="phone"]), ' +
      'textarea'
    );
    const textCount = await textInputs.count().catch(() => 0);
    for (let i = 0; i < textCount; i++) {
      const input = textInputs.nth(i);
      // ROOT CAUSE FIX (confirmed live -- a date-range's own "End date"
      // input got overwritten with the generic free-text default,
      // "No significant medical history..."): AntD's date/range picker
      // `<input>` elements carry no `type` attribute, so they were matched
      // by this loop's `input:not([type])` branch whenever the dedicated
      // date-picker handling above gave up on them (still empty after its
      // retry cap) -- this loop then ran right after and "helpfully" filled
      // them with free text instead. Date/range inputs are handled
      // exclusively by section 1 above; skip them here entirely.
      const isPickerInput = await input
        .evaluate((el) => !!el.closest(".ant-picker"))
        .catch(() => false);
      if (isPickerInput) continue;
      const isVisible = await input.isVisible().catch(() => false);
      const isEmpty = await input.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => !el.value).catch(() => true);
      // A field can already hold a value yet still violate its own min/max
      // (e.g. "11" in a min="100" max="250" height field), or be a
      // half-applied blood-pressure mask (e.g. a stray "170/" missing the
      // second number) — neither is "empty" but both must still be
      // corrected, or the site's validation error blocks submission forever.
      const isIncompleteBp = await input.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => {
        const v = el.value.trim();
        return v.includes("/") && !/^\d{2,3}\/\d{2,3}$/.test(v);
      }).catch(() => false);
      const needsFill = isEmpty || isIncompleteBp || !(await this.isWithinDeclaredBounds(input));
      if (isVisible && needsFill && (await this.shouldSkipOptional(input))) continue;
      if (isVisible && needsFill) {
        try {
          const questionText = await this.getNearbyQuestionText(input);
          // Filling one answer can reveal or hide later questions, so the
          // element list counted above goes stale mid-loop: `nth(i)` then
          // points at a node that is no longer in the DOM, and EVERY locator
          // call on it blocks for the full 15s actionTimeout before throwing,
          // which aborts the whole run (seen live on Kepple Lane "Personal
          // Information Gathering", failing on getAttribute("placeholder")).
          // Re-check after the question-text lookup (the slow step this races
          // with) and skip the field instead -- fillAllVisibleQuestions()'s
          // outer pass re-scans and picks up whatever is actually on screen.
          if (!(await input.isVisible().catch(() => false))) continue;
          // ROOT CAUSE FIX (confirmed live -- measured 15-16s lost on a
          // single field): these getAttribute calls have no explicit
          // timeout, so if the element detaches in the gap right after the
          // isVisible recheck above (the same re-render race, just a beat
          // later), whichever one is in flight blocks for the full default
          // 15s actionTimeout before the try/catch below can even fire. A
          // present element resolves these in milliseconds regardless, so
          // a short explicit timeout only speeds up the already-vanishing
          // case.
          const attrTimeout = { timeout: 1_500 };
          const placeholder = (await input.getAttribute("placeholder", attrTimeout).catch(() => "")) || "";
          const name = (await input.getAttribute("name", attrTimeout).catch(() => "")) || "";
          const inputMode = (await input.getAttribute("inputmode", attrTimeout).catch(() => "")) || "";
          const hasNumericBounds =
            (await input.getAttribute("min", attrTimeout).catch(() => null)) !== null ||
            (await input.getAttribute("max", attrTimeout).catch(() => null)) !== null;
          const qTextLower = questionText.toLowerCase();
          const placeholderLower = placeholder.toLowerCase();
          const nameLower = name.toLowerCase();
          // Some tenants render height/weight as a plain `type="text"` field
          // with `inputmode="decimal"` and min/max attributes rather than a
          // real number input — filling those with "None" or an out-of-range
          // guess trips the field's own "Value should be between X and Y"
          // validation, so route them through the same range-aware picker.
          const isNumericTextField = inputMode === "decimal" || inputMode === "numeric" || hasNumericBounds;

          // "Patient Information" fields (First/Last name, DOB, Postcode) can
          // appear as a step inside the same questionnaire dialog — these are
          // real identity fields, not generic questionnaire text, so they
          // must use TEST_USER's real data rather than a placeholder answer.
          const isDobField = qTextLower.includes("date of birth") || qTextLower.includes("dob");

          if (placeholderLower.includes("full name") || qTextLower.includes("full name")) {
            await input.fill(`${TEST_USER.firstName} ${TEST_USER.lastName}`);
          } else if (
            (placeholderLower.includes("first name") || qTextLower.includes("first name")) &&
            !placeholderLower.includes("last") && !qTextLower.includes("last name")
          ) {
            await input.fill(TEST_USER.firstName);
          } else if (placeholderLower.includes("last name") || qTextLower.includes("last name")) {
            await input.fill(TEST_USER.lastName);
          } else if (
            placeholderLower.includes("postal code") ||
            placeholderLower.includes("postcode") ||
            qTextLower.includes("postal code") ||
            qTextLower.includes("postcode")
          ) {
            await input.fill(TEST_USER.postcode);
          } else if (isDobField) {
            await input.fill(await this.resolveDobPart(input, placeholder));
          } else if (/1\s*to\s*10|1-10/i.test(questionText) || /1\s*to\s*10|1-10/i.test(placeholder)) {
            await input.fill(await this.resolveNumericValue(input, questionText, placeholder, 5));
          } else if (placeholder.includes("___/___") || placeholder.includes("mmHg") || /blood\s*pressure/i.test(questionText) || /systolic/i.test(questionText)) {
            await this.fillBloodPressure(input);
          } else if (nameLower.includes("height") || placeholderLower.includes("height") || qTextLower.includes("height")) {
            await input.fill(await this.resolveNumericValue(input, questionText, placeholder, 170));
          } else if (nameLower.includes("weight") || placeholderLower.includes("weight") || qTextLower.includes("weight")) {
            await input.fill(await this.resolveNumericValue(input, questionText, placeholder, 150));
          } else if (placeholderLower.includes("occupation") || qTextLower.includes("occupation")) {
            await input.fill(QUESTIONNAIRE_DEFAULTS.occupation);
          } else if (isNumericTextField) {
            await input.fill(await this.resolveNumericValue(input, questionText, placeholder, 150));
          } else {
            await input.fill(QUESTIONNAIRE_DEFAULTS.freeTextAnswer);
          }
          // Read back the actual value rather than re-deriving which branch
          // fired — correct regardless of which of the many cases above ran.
          const filledValue = await input.inputValue().catch(() => "");
          this.recordAnswer(questionText, filledValue);
          answeredAny = true;
        } catch {
          // Same race, later in the body (the fill itself): the field went
          // away mid-answer. Skip rather than kill the run.
          console.log("[QuestionnairePage] Field disappeared mid-fill -- skipping (outer pass will re-scan)");
        }
      }
    }

    // 3. Handle Numerical inputs
    const numInputs = this.page.locator(
      'input[type="number"], input[inputmode="numeric"], input.ant-input-number-input',
    );
    const numCount = await numInputs.count().catch(() => 0);
    for (let i = 0; i < numCount; i++) {
      const input = numInputs.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      const isEmpty = await input.evaluate((el: HTMLInputElement) => !el.value).catch(() => true);
      const needsFill = isEmpty || !(await this.isWithinDeclaredBounds(input));
      if (isVisible && needsFill && (await this.shouldSkipOptional(input))) continue;
      if (isVisible && needsFill) {
        try {
          const questionText = await this.getNearbyQuestionText(input);
          // Filling one answer can reveal or hide later questions, so the
          // element list counted above goes stale mid-loop: `nth(i)` then
          // points at a node that is no longer in the DOM, and EVERY locator
          // call on it blocks for the full 15s actionTimeout before throwing,
          // which aborts the whole run (seen live on Kepple Lane "Personal
          // Information Gathering", failing on getAttribute("placeholder")).
          // Re-check after the question-text lookup (the slow step this races
          // with) and skip the field instead -- fillAllVisibleQuestions()'s
          // outer pass re-scans and picks up whatever is actually on screen.
          if (!(await input.isVisible().catch(() => false))) continue;
          // Same fast-fail fix as the text-field loop above -- an explicit
          // short timeout so a field that detaches right after the
          // isVisible recheck fails in ~1.5s instead of the full 15s
          // default actionTimeout.
          const attrTimeout = { timeout: 1_500 };
          const placeholder = (await input.getAttribute("placeholder", attrTimeout).catch(() => "")) || "";
          const name = (await input.getAttribute("name", attrTimeout).catch(() => "") || "").toLowerCase();
          const placeholderLower = placeholder.toLowerCase();
          const qTextLower = questionText.toLowerCase();

          // Split DOB boxes rendered as number inputs (e.g. inputmode="numeric")
          // must get the real day/month/year, not a numeric-range guess.
          const isDobField = qTextLower.includes("date of birth") || qTextLower.includes("dob");
          if (isDobField) {
            await input.fill(await this.resolveDobPart(input, placeholder));
            answeredAny = true;
            continue;
          }

          // Range hints (min/max attrs, or "between X and/to Y" phrasing like
          // "Enter Number between 12 to 20") take priority over a fixed
          // fallback guess, which can fall outside the field's own bounds.
          //
          // ROOT CAUSE FIX (confirmed live -- "What's your current age?" was
          // getting filled with 150): there was no dedicated "age" case here,
          // so it silently fell through to the generic default of 150 --
          // which happens to be this same fallback's WEIGHT value. Match
          // "age" (word-boundary, so it doesn't false-positive on "average"/
          // "percentage") before the generic default applies.
          let fallback = 150;
          if (/1\s*to\s*10|1-10/i.test(questionText) || /1\s*to\s*10|1-10/i.test(placeholder)) {
            fallback = 5;
          } else if (name.includes("height") || placeholderLower.includes("height") || qTextLower.includes("height")) {
            fallback = 170;
          } else if (name.includes("weight") || placeholderLower.includes("weight") || qTextLower.includes("weight")) {
            fallback = 150;
          } else if (/\bage\b/.test(name) || /\bage\b/.test(placeholderLower) || /\bage\b/.test(qTextLower)) {
            fallback = 40;
          }
          const value = await this.resolveNumericValue(input, questionText, placeholder, fallback);
          await input.fill(value);
          this.recordAnswer(questionText, value);
          answeredAny = true;
        } catch {
          // Same race, later in the body (the fill itself): the field went
          // away mid-answer. Skip rather than kill the run.
          console.log("[QuestionnairePage] Field disappeared mid-fill -- skipping (outer pass will re-scan)");
        }
      }
    }

    // 3.5 Handle Gender radios (Patient Information step). These are
    // deliberately excluded from the generic radio handlers below (which
    // pick "No"/the last option — wrong for Male/Female), so without this
    // they never get answered at all when this step appears inside the
    // questionnaire dialog. Match TEST_USER.gender specifically.
    //
    // ROOT CAUSE of "not selecting Gender at birth": this narrow selector
    // (name="gender" or id=male/female) matched 0 radios on this tenant —
    // it renders the field as "Gender at birth" with plain Male/Female
    // labeled radios that don't carry that name/id — so `genderCount > 0`
    // was false and the whole block, fallback included, was skipped
    // entirely. Falls back to any visible radio pair labeled Male/Female
    // when the specific selector finds nothing.
    let genderRadios = this.page.locator(
      'input[type="radio"][name="gender"], input[type="radio"]#male, input[type="radio"]#female',
    );
    let genderCount = await genderRadios.count().catch(() => 0);
    if (genderCount === 0) {
      genderRadios = this.page.locator(
        'label:has-text("Male") input[type="radio"], label:has-text("Female") input[type="radio"]',
      );
      genderCount = await genderRadios.count().catch(() => 0);
    }
    if (genderCount > 0) {
      const genderChecked = await genderRadios
        .evaluateAll((els) => els.some((el) => (el as HTMLInputElement).checked))
        .catch(() => false);
      if (!genderChecked) {
        const targetLabel = TEST_USER.gender === "male" ? "Male" : "Female";
        const targetRadio = this.page
          .locator(
            `label:has-text("${targetLabel}") input[type="radio"], input[type="radio"][value="${targetLabel}" i], input[type="radio"]#${TEST_USER.gender}`,
          )
          .first();
        // Some tenants render this as a pre-answered, disabled read-only
        // field (same pattern as other "safety-net" radios elsewhere) —
        // .check() with no explicit timeout inherits the 15s project
        // actionTimeout, and this whole block re-runs on every pass of
        // fillVisibleQuestionsOnce() (up to 4 passes x up to 50 steps), so
        // a stuck disabled radio can burn minutes. Check enabled first and
        // cap the actual click attempt at 2s so it fails fast instead.
        const targetUsable =
          (await targetRadio.isVisible({ timeout: 1_000 }).catch(() => false)) &&
          (await targetRadio.isEnabled().catch(() => false));
        const clicked =
          targetUsable &&
          (await targetRadio
            .check({ force: true, timeout: 2_000 })
            .then(() => true)
            .catch(() => false));
        if (!clicked && targetUsable) {
          await this.page
            .locator(`label:has-text("${targetLabel}")`)
            .first()
            .click({ force: true, timeout: 2_000 })
            .catch(() => {});
        }
        // Only report progress when an actual interaction was attempted —
        // a disabled/unusable radio means nothing happened, and falsely
        // claiming progress every pass masks the real "nothing left to do"
        // state (it's very likely already showing the correct pre-answered
        // value, just not reflected via the native .checked property).
        if (targetUsable) answeredAny = true;
      }
    } else {
      // ROOT CAUSE (2nd variant): some tenants render "Gender at birth" as
      // plain `<button type="button">Male</button>`/`<button>Female</button>`
      // toggles with NO `input[type="radio"]` at all — every check above
      // finds 0 matches, so gender is never touched. Since these buttons
      // carry no visible "selected" class in their markup (both look
      // identical before/after in the raw HTML this was reported from), we
      // mark our own click with a data attribute so a later pass doesn't
      // click it again (this style of button often toggles/deselects on a
      // second click).
      const genderHeading = this.page
        .locator(':text("Gender at birth"), :text("Gender")')
        .first();
      if (await genderHeading.count().catch(() => 0)) {
        const genderGroup = genderHeading
          .locator('xpath=ancestor::*[count(.//button) >= 2][1]')
          .first();
        if (await genderGroup.count().catch(() => 0)) {
          const targetLabel = TEST_USER.gender === "male" ? "Male" : "Female";
          const targetButton = genderGroup
            .locator(`button:has-text("${targetLabel}")`)
            .first();
          const alreadyMarked =
            (await targetButton.getAttribute("data-qa-selected").catch(() => null)) === "true";
          if (
            !alreadyMarked &&
            (await targetButton.isVisible({ timeout: 1_000 }).catch(() => false))
          ) {
            await targetButton.click({ force: true, timeout: 2_000 }).catch(() => {});
            await targetButton
              .evaluate((el) => el.setAttribute("data-qa-selected", "true"))
              .catch(() => {});
            answeredAny = true;
          }
        }
      }
    }

    // 4. Handle Checkboxes
    const checkboxes = this.page.locator('input[type="checkbox"]');
    const cbCount = await checkboxes.count().catch(() => 0);
    for (let i = 0; i < cbCount; i++) {
      const cb = checkboxes.nth(i);
      const isVisible = await cb.isVisible().catch(() => false);
      const isChecked = await cb.isChecked().catch(() => false);
      if (isVisible && !isChecked && (await this.shouldSkipOptional(cb))) continue;
      if (isVisible && !isChecked) {
        // Checkbox groups (`.ant-checkbox-group`, "select at least one")
        // often include a mutually-exclusive "Other"/"None of the above"
        // option that unchecks its siblings via the site's own JS.
        // Checking every option in the group fights that exclusivity —
        // Sport gets checked, then Other gets checked and unchecks Sport,
        // so next pass Sport looks unanswered again — forever. Once one
        // option in a group is checked, leave the rest of that group alone.
        const group = cb.locator(
          'xpath=ancestor::*[contains(@class,"ant-checkbox-group")][1]',
        );
        const hasGroup = (await group.count().catch(() => 0)) > 0;
        if (hasGroup) {
          const alreadyAnsweredInGroup = await group
            .locator('input[type="checkbox"]:checked')
            .count()
            .catch(() => 0);
          if (alreadyAnsweredInGroup > 0) continue;
        }

        // Scope to THIS checkbox's own ancestor label (not a separately
        // indexed label list, which can misalign and click the wrong box).
        const parent = cb.locator("xpath=ancestor::label[1]").first();
        const optionLabel = (await parent.textContent().catch(() => "")) || "";
        if (await parent.count().catch(() => 0) > 0 && await parent.isVisible().catch(() => false)) {
          await parent.click({ force: true }).catch(async () => {
            await cb.check({ force: true }).catch(() => {});
          });
        } else {
          await cb.check({ force: true }).catch(() => {});
        }
        // ROOT CAUSE FIX (confirmed live -- a standalone consent checkbox,
        // "I agree that the information provided is accurate.", showed
        // "(no match)" in the Q&A Verification table even though it WAS
        // actually checked): this checkbox has no separate `.hq-question`
        // heading at all -- its OWN label text is the entire question, e.g.
        // `<div class="hq-question"><label class="ant-checkbox-wrapper">
        // ...<span class="ant-checkbox-label">I agree...</span></label>
        // </div>`. getNearbyQuestionText() only looks for a distinct
        // heading element and correctly returns "" here, but recordAnswer()
        // silently drops any call with an empty question string -- so this
        // checkbox was checked in the DOM yet never entered filledAnswers
        // at all. Fall back to the checkbox's own label text as the
        // question when no separate heading exists.
        const nearbyHeading = await this.getNearbyQuestionText(cb);
        const cbQuestionText = nearbyHeading || optionLabel;
        // When the checkbox's own label IS the question (no separate
        // heading), record "Yes" as the answer rather than repeating the
        // label text as both question and answer -- matches the site's own
        // submitted value style (e.g. "Yes agree with this") better.
        this.recordAnswer(cbQuestionText, nearbyHeading ? optionLabel : "Yes");
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

        if (await this.shouldSkipOptional(group)) continue;

        const wrappers = group.locator(".ant-radio-wrapper, .ant-radio-button-wrapper");
        if ((await wrappers.count().catch(() => 0)) > 0) {
          await this.clickBestRadioOption(wrappers);
          const groupQuestionText = await this.getNearbyQuestionText(group);
          const checkedNow = group.locator(".ant-radio-wrapper-checked, .ant-radio-button-wrapper-checked").first();
          const checkedText = (await checkedNow.textContent().catch(() => "")) || "";
          this.recordAnswer(groupQuestionText, checkedText);
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
      if ((await checkedLoc.count().catch(() => 0)) === 0 && (await this.shouldSkipOptional(groupLoc.first()))) {
        continue;
      }
      if ((await checkedLoc.count().catch(() => 0)) === 0) {
        // Some tenants (e.g. Kepple Lane) render pre-answered safety-net
        // questions as disabled radios — nothing to click, so skip them
        // instead of force-clicking into a hung 15s timeout.
        //
        // ROOT CAUSE FIX (confirmed live -- this silently NEVER found a
        // "No"/"None" option, on ANY condition, ever): `.filter({hasText})`
        // reads an element's own textContent, but a bare `<input>` has none
        // -- the visible label text lives in a sibling/wrapping <label>, not
        // inside the input itself. So `noOpt` was always empty and this
        // always fell through to `groupLoc.last()`, which for this Weight
        // Management blood-pressure question is a disabled radio. Look up
        // each enabled radio's own associated label text instead.
        const enabledRadios = groupLoc.locator(
          ":scope:not([disabled]):not([aria-disabled='true'])",
        );
        const enabledCount = await enabledRadios.count().catch(() => 0);
        let target = enabledCount > 0 ? enabledRadios.last() : null;
        for (let i = 0; i < enabledCount; i++) {
          const candidate = enabledRadios.nth(i);
          const labelText = await candidate
            .evaluate((el: HTMLInputElement) => {
              const label = el.closest("label");
              if (label) return label.textContent || "";
              if (el.id) {
                const forLabel = document.querySelector(
                  `label[for="${el.id}"]`,
                );
                if (forLabel) return forLabel.textContent || "";
              }
              return el.parentElement?.textContent || "";
            })
            .catch(() => "");
          if (/no|none/i.test(labelText)) {
            target = candidate;
            break;
          }
        }
        const clickable =
          target !== null &&
          (await target.isVisible().catch(() => false)) &&
          (await target.isEnabled().catch(() => false));
        if (clickable && target) {
          const targetLabelText = (await target.textContent().catch(() => "")) || "";
          await target.click({ force: true }).catch(() => {});
          const srQuestionText = await this.getNearbyQuestionText(groupLoc.first());
          if (process.env.DEBUG_QUESTIONS === "1") {
            console.log(`[DEBUG_QUESTIONS] standardRadios name="${name}" label="${targetLabelText}" questionText="${srQuestionText}"`);
          }
          this.recordAnswer(srQuestionText, targetLabelText);
          answeredAny = true;
        } else if (process.env.DEBUG_QUESTIONS === "1") {
          console.log(`[DEBUG_QUESTIONS] standardRadios name="${name}" NOT clickable (visible/enabled check failed)`);
        }
      }
    }

    // 5.5 Handle Dropdown Selects (Ant Design & Native select elements)
    const antSelects = this.page.locator(".ant-select");
    const selectCount = await antSelects.count().catch(() => 0);
    for (let i = 0; i < selectCount; i++) {
      const select = antSelects.nth(i);
      if (await select.isVisible().catch(() => false)) {
        // ROOT CAUSE FIX (confirmed live -- a "select all that apply"
        // multi-select ant-select kept getting re-opened and re-picked on
        // EVERY pass, each time adding one more option, until it exhausted
        // every available option: `.ant-select-selection-item` alone
        // detects a SINGLE-select's chosen value, but a multi-select mode
        // wraps its selected tags inside `.ant-select-selection-overflow`,
        // so this check never saw an existing selection as "answered" even
        // after successfully picking one. Checking both selectors together
        // matches the fix already applied to the rule engine's own
        // ant-select detection above.
        // ROOT CAUSE FIX (confirmed live -- "Hepatitis A & B Travel
        // Vaccination"'s required "To Which Country or Countries you are
        // going?" select was permanently skipped, left on "Please Select"
        // with a red validation error, while every other select on the page
        // got filled: this tenant's AntD select renders an EMPTY
        // `.ant-select-selection-item` (whitespace-only text content, e.g.
        // " ") in the DOM even when nothing has been picked yet -- so
        // `.isVisible()` alone was a false positive that made every unset
        // select on this page look "already answered" from the very first
        // scan, before we ever clicked it. Require actual non-whitespace
        // text, not just DOM visibility.
        const selectionItemLocator = select
          .locator(".ant-select-selection-item, .ant-select-selection-overflow-item")
          .first();
        const selectionItemVisible = await selectionItemLocator
          .isVisible()
          .catch(() => false);
        const selectionItemText = selectionItemVisible
          ? ((await selectionItemLocator.textContent().catch(() => "")) || "").trim()
          : "";
        const hasSelection = selectionItemText.length > 0;
        // Identify this select by its nearby question title (stable across
        // re-renders) so repeated failures can be tracked and capped —
        // some selects (e.g. remote-search Pharmacy/GP Surgery lookups on
        // this tenant) never populate any options at all, and without a
        // cap this loop retries them forever until the test times out.
        const selectKey = await select
          .locator(
            'xpath=ancestor::*[contains(@class,"hq-question")][1]//*[contains(@class,"hq-question__title")]',
          )
          .first()
          .innerText()
          .catch(() => `select-${i}`);
        if (process.env.DEBUG_QUESTIONS === "1") {
          console.log(`[DIAG] antSelect i=${i} key="${selectKey}" hasSelection=${hasSelection} priorAttempts=${this.stuckSelectAttempts.get(selectKey) ?? 0}`);
        }
        if (hasSelection) {
          continue;
        }
        if (await this.shouldSkipOptional(select)) {
          if (process.env.DEBUG_QUESTIONS === "1") {
            console.log(`[DIAG] antSelect i=${i} key="${selectKey}" -- shouldSkipOptional=true, skipping`);
          }
          continue;
        }

        const priorAttempts = this.stuckSelectAttempts.get(selectKey) ?? 0;
        // ROOT CAUSE FIX (confirmed live -- Cholera Vaccination's "Search
        // and select conditions:" remote lookup genuinely returned options
        // and got answered on one attempt, then came back EMPTY again on
        // the very next pass -- the endpoint itself is flaky/inconsistent
        // for the exact same search term, not a query-length or event-type
        // problem this file can fix at the interaction level): a 2-attempt
        // cap gave a flaky endpoint almost no chance to land on a working
        // response. Raised to MAX_STUCK_SELECT_ATTEMPTS (5) -- still
        // bounded, just enough headroom for an unreliable search to
        // eventually succeed.
        if (priorAttempts >= this.MAX_STUCK_SELECT_ATTEMPTS) {
          continue;
        }

        console.log(`[QuestionnairePage] Clicking ant-select dropdown ${i + 1}`);
        await select.click({ force: true });
        await this.page.waitForTimeout(500); // Wait for options overlay to mount

        let options = this.page.locator(".ant-select-item-option:visible, .ant-select-item:visible");
        let optionsCount = await options.count().catch(() => 0);

        if (optionsCount === 0) {
          // Some selects (e.g. remote-search Pharmacy/GP Surgery lookups)
          // render no options at all until the user types a search term —
          // clicking alone never mounts the options popup for these.
          const searchInput = select
            .locator('input[role="combobox"], input.ant-select-selection-search-input')
            .first();
          if (await searchInput.isVisible().catch(() => false)) {
            // ROOT CAUSE FIX (confirmed live -- "Please select Drug"'s
            // remote drug_search endpoint returned zero results for a bare
            // single letter "a", permanently blocking this required field
            // and hanging the whole test): a single character is often
            // below a search API's minimum query length, or too generic to
            // return anything useful. Try a few realistic drug-name
            // substrings in turn, stopping as soon as one returns results --
            // but ONLY for an actual drug-search field. This regressed
            // EVERY OTHER remote-search select (Pharmacy/GP Surgery lookups,
            // which already worked fine with a single quick search) into
            // the same up-to-4-terms-times-4s wait chain, and with 2-3 such
            // selects per page x this tenant's own 2-attempt cap, that alone
            // was enough to burn the whole test timeout. Scope the extra
            // terms to selects whose own label actually mentions
            // drug/medication; everything else keeps the original
            // single-term fast path.
            const isDrugSearch = /drug|medication|medicine/i.test(selectKey);
            // ROOT CAUSE FIX (confirmed live -- Cholera Vaccination's
            // required "Search and select conditions:" remote lookup, same
            // failure shape as the drug-search case above: single letter
            // "a" returns zero results, permanently blocking the field and
            // hanging the whole test): same fix, scoped to selects whose
            // own label mentions "condition[s]" -- try a few realistic
            // medical-condition substrings before falling back to "a".
            const isConditionSearch = /condition/i.test(selectKey);
            const searchTerms = isDrugSearch
              ? ["para", "am", "ibu", "a"]
              : isConditionSearch
                ? ["asthma", "diabetes", "hypertension", "a"]
                : ["a"];
            for (const term of searchTerms) {
              // ROOT CAUSE FIX (confirmed live -- a plain "select all that
              // apply" ant-select with NO real search box, e.g. Weight
              // Management's "Have you attempted any of the following?",
              // burned ~35s on THIS field alone): AntD renders a hidden,
              // non-editable combobox `<input>` on every select for
              // keyboard accessibility, even non-searchable ones -- it
              // matches this same selector and can pass `.isVisible()`,
              // but `.fill()` on it is never actionable, so each bare
              // `.catch(() => {})`-wrapped call below silently ate the
              // full default 15s actionTimeout before "succeeding" via the
              // catch (2 calls/term x up to 4 terms = up to 2 minutes).
              // An explicit short timeout fails those fast without
              // affecting a real, actually-fillable search box, which
              // resolves in milliseconds either way.
              await searchInput.fill("", { timeout: 1_500 }).catch(() => {});
              // Real per-character keystrokes, not a bulk `.fill()` -- same
              // reasoning as the date-picker fix elsewhere in this file:
              // an AntD remote-search combobox's onSearch is wired to real
              // typing, and a single bulk `.fill()` firing one synthetic
              // `input` event doesn't reliably trigger it the same way
              // (confirmed live -- Cholera Vaccination's "Search and select
              // conditions:" never returned options via `.fill()` alone,
              // for any of several realistic condition-name terms).
              await searchInput.pressSequentially(term, { delay: 30 }).catch(async () => {
                await searchInput.fill(term, { timeout: 1_500 }).catch(() => {});
              });
              // Remote lookups (e.g. Pharmacy/GP Surgery/drug search) can
              // take a few seconds to respond — poll instead of guessing a
              // fixed delay, resolving as soon as an option actually mounts.
              options = this.page.locator(".ant-select-item-option:visible, .ant-select-item:visible");
              await options
                .first()
                .waitFor({ state: "visible", timeout: 4_000 })
                .catch(() => {});
              optionsCount = await options.count().catch(() => 0);
              if (optionsCount > 0) break;
            }
          }
        }

        if (optionsCount > 0) {
          // Prefer an option whose text hasn't already been picked for some
          // OTHER select on this page (see usedGenericSelectValues comment
          // above) -- fall back to the first option if every candidate is
          // already used (better than answering nothing at all).
          let chosen = options.first();
          let optionText = (await chosen.textContent().catch(() => "")) || "";
          if (this.usedGenericSelectValues.has(optionText.trim())) {
            for (let oi = 1; oi < optionsCount; oi++) {
              const candidate = options.nth(oi);
              const candidateText = (await candidate.textContent().catch(() => "")) || "";
              if (!this.usedGenericSelectValues.has(candidateText.trim())) {
                chosen = candidate;
                optionText = candidateText;
                break;
              }
            }
          }
          await chosen.click({ force: true });
          console.log(`[QuestionnairePage] Selected option for ant-select dropdown`);
          this.usedGenericSelectValues.add(optionText.trim());
          this.recordAnswer(selectKey, optionText);
          answeredAny = true;
        } else {
          console.log(
            `[QuestionnairePage] No options rendered in time for select "${selectKey}" (attempt ${priorAttempts + 1}/${this.MAX_STUCK_SELECT_ATTEMPTS}); giving up once the cap is reached to avoid retrying forever`,
          );
          this.stuckSelectAttempts.set(selectKey, priorAttempts + 1);
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
          const firstOption = sel.locator("option").nth(1);
          const firstVal = await firstOption.getAttribute("value").catch(() => null);
          if (firstVal) {
            const firstOptionText = (await firstOption.textContent().catch(() => "")) || firstVal;
            await sel.selectOption(firstVal);
            const nsQuestionText = await this.getNearbyQuestionText(sel);
            this.recordAnswer(nsQuestionText, firstOptionText);
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
        const fileQuestionText = await this.getNearbyQuestionText(input);
        this.recordAnswer(fileQuestionText || "File upload", "medical_report.txt");
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

    // ROOT CAUSE (found while building outcome-specific testing): this used
    // to be a strict `===` match against old display-style names
    // ("shingles", "weight management", "erectile-dysfunction"). Real runs
    // (dashboard, CI) pass the actual Sanity slug via CONDITION_SLUG (e.g.
    // "shingles-herpes-zoster-nhs"), which never equals "shingles" — so
    // these rule-sets have never actually applied in any real run; every
    // condition, this one included, was always falling straight through to
    // the generic fallback. Fixed to match by substring against the real
    // slug, same convention as outcome-config.ts's getOutcomeConfig().
    const outcomeConfig = getOutcomeConfig(activeCondition);
    const outcomeId = process.env.OUTCOME_ID || "gateway";

    let rules =
      (outcomeConfig && OUTCOME_RULES[outcomeConfig.slug]?.[outcomeId]) || [];

    // Legacy fallback for conditions not yet migrated into OUTCOME_RULES —
    // matched the same substring way (was previously exact-match-only and
    // therefore dead code; kept for Weight Management / Erectile Dysfunction
    // until they get their own outcome-config entries).
    if (rules.length === 0 && !outcomeConfig) {
      rules = activeCondition.includes("weight management") || activeCondition.includes("weight-management")
        ? WEIGHT_MANAGEMENT_RULES
        : activeCondition.includes("shingles")
          ? SHINGLES_RULES
          : activeCondition.includes("erectile-dysfunction") || activeCondition.includes("erectile dysfunction")
            ? ERECTILE_DYSFUNCTION_RULES
            : [];
    }

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

      // ROOT CAUSE FIX (confirmed live -- this exact rule kept re-matching
      // and re-firing on EVERY pass forever, racing against the unrelated
      // generic ant-select handler that was independently picking a
      // DIFFERENT option each time it ran -- the field's actual submitted
      // value could end up different from whatever we last recorded,
      // producing spurious "filled vs submitted" mismatches): a "checkbox"
      // rule whose question renders as an AntD `ant-select` multi-select
      // dropdown instead of real `<input type="checkbox">` elements can
      // never be satisfied by selectCheckboxByTextFlexible() above, which
      // only looks for checkbox wrappers -- so `answered` stayed false
      // forever and this rule was never added to answeredRuleKeys. If the
      // generic fallback (which runs right after this in the same pass) has
      // already populated SOME selection for this question, accept that and
      // stop retrying instead of fighting it every subsequent pass.
      // Record whatever text is ACTUALLY selected when we fall back to
      // accepting the generic handler's own choice below, rather than the
      // rule's intended answerText -- they can legitimately differ, and
      // recording the wrong one would just relocate the same mismatch bug.
      let actualAnswerText = rule.answerText;
      if (!answered && rule.control === "checkbox") {
        await this.page.waitForTimeout(300);
        // Same false-positive fix as the generic ant-select handler above --
        // this tenant's AntD select renders an empty, whitespace-only
        // `.ant-select-selection-item` even when nothing is picked, so a
        // bare element count isn't enough; require actual non-whitespace
        // text before treating the question as answered.
        const selectedItems = scope.locator(
          ".ant-select-selection-item, .ant-select-selection-overflow-item",
        );
        const texts = await selectedItems.allTextContents().catch(() => []);
        const joined = texts.map((t) => t.trim()).filter(Boolean).join(", ");
        if (joined) {
          actualAnswerText = joined;
          answered = true;
        }
      }

      if (answered) {
        console.log(
          `[QuestionnairePage] Rule ${index + 1} completed successfully`,
        );

        this.recordAnswer(headingText, actualAnswerText);
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
      'button:has-text("Confirm"), [role="button"]:has-text("Confirm")',
      'button:has-text("Save"), [role="button"]:has-text("Save")',
      'input[type="submit"][value="Confirm"]',
      'input[type="submit"][value="Save"]',
      'input[type="button"][value="Confirm"]',
      'input[type="button"][value="Save"]',
      'button:has-text("Next"), [role="button"]:has-text("Next")',
      'button:has-text("Continue"), [role="button"]:has-text("Continue")',
      'button:has-text("Submit"), [role="button"]:has-text("Submit")',
      'button:has-text("Finish"), [role="button"]:has-text("Finish")',
      'button[type="submit"]',
    ];

    for (const sel of buttonSelectors) {
      // Some tenants render a hidden duplicate (e.g. an SSR/skeleton
      // placeholder) with identical text before the real, visible button.
      // .first() would lock onto that hidden one and skip the selector
      // entirely, so scan all matches for the first genuinely visible one.
      const matches = this.page.locator(sel);
      const count = await matches.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const btn = matches.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          // ROOT CAUSE FIX (confirmed live -- Weight Management's Health
          // Assessment section, an extreme default-value BMI of 51.9
          // "Severely obese" apparently keeps this button client-side
          // disabled/inert pending some validation): `force: true` bypasses
          // Playwright's actionability checks INCLUDING the disabled-state
          // check, so this used to silently "succeed" clicking a genuinely
          // disabled button -- nothing happens, but progressQuestionnaire()
          // still reports progressed=true, which resets
          // answerAllQuestions()'s no-progress-streak counter every single
          // step and burns the entire test timeout instead of failing fast.
          // Skip a disabled candidate and keep scanning/trying other
          // selectors instead of force-clicking through it.
          // ROOT CAUSE FIX (confirmed live -- this regressed Shingles'
          // Immediate Action/GP Referral runs into an infinite loop):
          // `className.includes("disabled")` false-positives on this site's
          // Tailwind-styled buttons, which carry `disabled:opacity-40
          // disabled:cursor-not-allowed` utility classes in their className
          // string ALWAYS, regardless of actual state -- only their CSS
          // effect is conditional on the real `disabled` DOM property. That
          // made clickPrimaryButton() treat every such button as disabled
          // and refuse to click any of them. Match "disabled" only as a
          // whole class token or a "-disabled" suffix (e.g. AntD's
          // "ant-btn-disabled"), never as a "disabled:" variant prefix.
          const disabled = await btn
            .evaluate((el: HTMLElement) => {
              const cls = el.className || "";
              return (
                (el as HTMLButtonElement).disabled === true ||
                el.getAttribute("aria-disabled") === "true" ||
                /(^|\s)([\w-]*-)?disabled(\s|$)/.test(cls)
              );
            })
            .catch(() => false);
          if (disabled) {
            if (process.env.DEBUG_QUESTIONS === "1") {
              const text = (await btn.textContent().catch(() => "")) || "";
              console.log(
                `[DEBUG_QUESTIONS] clickPrimaryButton: found disabled button "${text.trim()}" (sel="${sel}") — skipping instead of force-clicking`,
              );
            }
            continue;
          }
          await btn.click({ force: true });
          return true;
        }
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
      // When the questionnaire renders as a modal dialog on top of the
      // booking page (e.g. Kepple Lane), the background page's own markup
      // (heading "Book: ...", `[class*="booking"]` wrappers) can falsely
      // satisfy the checks below and make us bail out without ever
      // clicking the dialog's Confirm/Continue button. Give the open
      // dialog priority over those background-page signals.
      const questionnaireDialogOpen = await this.isQuestionnaireDialogOpen();

      // ROOT CAUSE FIX (confirmed live -- Weight Management's GP Referral
      // outcome renders as a plain "Patient doesn't qualified" result banner
      // inside the SAME questionnaire dialog, with neither a "Book Private
      // Consultation" nor an "End assessment" button -- just whatever
      // generic Continue/Close CTA the dialog always has, which
      // clickPrimaryButton() below clicks straight through without either
      // handler below ever getting a chance to record it). Record any
      // outcome-config match unconditionally, every attempt, BEFORE that
      // click navigates away -- this never consumes the click itself, so
      // clickPrimaryButton() still runs exactly as before either handler.
      await this.captureOutcomeScreenIfVisible();

      // NHS 111 / "Book private consultation" can render either as its own
      // popup or as the Result step inside the questionnaire dialog itself
      // (e.g. Kepple Lane), so this must run regardless of dialogOpen state.
      const handledNHS111 = await this.handleNHS111Popup();
      if (handledNHS111) {
        return true;
      }

      // "Self care" Result screen only offers "End assessment" (no private
      // consultation option) — must be checked after handleNHS111Popup so
      // "Book Private Consultation" still wins whenever both are present.
      const handledSelfCare = await this.handleSelfCareResult();
      if (handledSelfCare) {
        return true;
      }

      if (!questionnaireDialogOpen) {
        if (await this.isOnDrugSelectionPage()) {
          return true;
        }

        if (await this.isOnPaymentPage()) {
          return true;
        }

        if (await this.isOnSignupOrBookingPage()) {
          return true;
        }

        if (await this.isOnThankYouPage()) {
          return true;
        }
      } else {
        // Progressive-disclosure dialogs (e.g. Kepple Lane) reveal the next
        // question only after the current one is answered, and their
        // "Continue"/"Confirm" button is inert until then. Re-fill any
        // newly-visible fields on every attempt instead of relying on the
        // single fillAllVisibleQuestions() pass that ran before this loop
        // started — otherwise later questions never get answered and we
        // just click a no-op button five times.
        //
        // ROOT CAUSE FIX (confirmed live -- Weight Management's eating
        // disorder gate question, "Would you like to continue with this
        // assessment?", was ALWAYS being answered "No" by the generic
        // fallback here even with a matching OUTCOME_RULES entry, because
        // this dialog-open branch runs inside progressQuestionnaire()'s own
        // retry loop, one question-reveal-then-click cycle at a time --
        // fully separate from and faster than the outer answerAllQuestions()
        // step loop's own rule scan. By the time control returned to that
        // outer loop, this newly-revealed question had already been
        // generically answered AND submitted. Rule-based answers must win
        // this race, so try them first on every attempt here too.
        if (process.env.DEBUG_QUESTIONS === "1") console.log(`[DIAG] attempt ${attempt}: before answerByConditionRules`);
        await this.answerByConditionRules().catch(() => false);
        if (process.env.DEBUG_QUESTIONS === "1") console.log(`[DIAG] attempt ${attempt}: before fillAllVisibleQuestions`);
        await this.fillAllVisibleQuestions().catch(() => false);
        if (process.env.DEBUG_QUESTIONS === "1") console.log(`[DIAG] attempt ${attempt}: after fillAllVisibleQuestions`);
      }

      if (process.env.DEBUG_QUESTIONS === "1") console.log(`[DIAG] attempt ${attempt}: before clickPrimaryButton`);
      const clicked = await this.clickPrimaryButton();
      if (process.env.DEBUG_QUESTIONS === "1") console.log(`[DIAG] attempt ${attempt}: after clickPrimaryButton clicked=${clicked}`);
      if (!clicked) {
        return progressed;
      }

      progressed = true;
      await this.waitForQuestionnaireTransition();
      if (process.env.DEBUG_QUESTIONS === "1") console.log(`[DIAG] attempt ${attempt}: after waitForQuestionnaireTransition`);
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
   * True when the questionnaire renders as a modal dialog on top of the
   * booking page (e.g. Kepple Lane) rather than as a standalone page.
   */
  private async isQuestionnaireDialogOpen(): Promise<boolean> {
    return this.page
      .locator(
        // Exclude Next.js's own (permanently-mounted, normally hidden)
        // dev-mode error overlay — its stack trace can coincidentally
        // contain the word "Questionnaire" and falsely match here.
        '[role="dialog"][aria-label*="questionnaire" i]:not([data-nextjs-dialog]), [role="dialog"]:has-text("Questionnaire"):not([data-nextjs-dialog])',
      )
      .first()
      .isVisible()
      .catch(() => false);
  }

  /**
   * Returns true if the current page looks like a questionnaire (has question UI elements).
   * Used by the spec to decide whether to run the questionnaire step.
   */
  async isOnQuestionnairePage(): Promise<boolean> {
    const questionnaireIndicators = [
      // Modal-based questionnaire (e.g. Kepple Lane embeds it as a dialog
      // inside the booking wizard rather than a standalone page).
      '[role="dialog"][aria-label*="questionnaire" i]:not([data-nextjs-dialog])',
      '[role="dialog"]:has-text("Questionnaire"):not([data-nextjs-dialog])',
      ".question-container",
      // Legacy "hq-kit" questionnaire template (e.g. Kepple Lane's
      // "personal-information-gathering" condition): a single-page form
      // rendered inline, not a modal.
      ".questionnaire-answer-box--kit",
      ".hq-root",
      ".hq-question",
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

  /**
   * Records reachedOutcome for any outcome-config pattern currently visible
   * on the page, without clicking anything or consuming the caller's
   * "handled" return value -- unlike handleNHS111Popup/handleSelfCareResult,
   * this exists purely so a result screen with no recognizable
   * "Book Private Consultation"/"End assessment" button (e.g. Weight
   * Management's "Patient doesn't qualified" banner) still gets captured
   * before whatever generic Continue button the dialog has clicks past it.
   */
  private async captureOutcomeScreenIfVisible(): Promise<void> {
    if (this.reachedOutcome) return;

    const activeCondition = getActiveConditionName();
    const outcomeConfig = getOutcomeConfig(activeCondition);
    if (!outcomeConfig) return;

    const screenText = await this.page.locator("body").innerText().catch(() => "");
    const matchedOutcome = outcomeConfig.outcomes.find((o) =>
      o.detectPatterns.some((p) => p.test(screenText)),
    );
    if (matchedOutcome) {
      this.reachedOutcome = { id: matchedOutcome.id, label: matchedOutcome.label };
      console.log(
        `[QuestionnairePage] Outcome screen reached: ${this.reachedOutcome.label} — continuing the journey to completion`,
      );
    }
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

    // Some tenants render a hidden duplicate button with identical text
    // (e.g. an SSR/skeleton placeholder) before the real, visible one —
    // .first() would lock onto that hidden one, so scan all matches.
    const popupButtonMatches = this.page.locator(
      'button:has-text("Book Private Consultation"), a:has-text("Book Private Consultation")',
    );
    const popupButtonCount = await popupButtonMatches.count().catch(() => 0);
    let popupButton: ReturnType<Page["locator"]> | null = null;
    for (let i = 0; i < popupButtonCount; i++) {
      const candidate = popupButtonMatches.nth(i);
      if (await candidate.isVisible({ timeout: 300 }).catch(() => false)) {
        popupButton = candidate;
        break;
      }
    }

    if (!popupVisible && !popupButton) {
      return false;
    }

    if (!popupButton) {
      return false;
    }

    // Read the whole body's text rather than just popupRoot — popupRoot's
    // own selector requires literal "NHS 111" text to match, so it's blind
    // to any other outcome-config screen (GP Referral, Self Care) that
    // renders through this same "Book Private Consultation"/"End
    // assessment" dialog shape but with different heading text. Detection
    // patterns are specific enough (e.g. /gp\s+referral/i) that reading the
    // full page is safe here.
    const popupText = await this.page.locator("body").innerText().catch(() => "");
    if (process.env.DEBUG_QUESTIONS === "1") {
      console.log(`[DEBUG_QUESTIONS] NHS111 popup text: ${JSON.stringify(popupText)}`);
      const allButtons = await this.page.locator("button, a").allTextContents().catch(() => []);
      console.log(`[DEBUG_QUESTIONS] Buttons/links visible on popup: ${JSON.stringify(allButtons.filter((t) => t.trim()))}`);
    }

    // ROOT CAUSE FIX (per explicit request): this used to always click
    // "Book Private Consultation" WITHOUT recording that a real NHS 111 (or
    // other outcome-config) result screen had just been shown — so
    // outcome-specific runs targeting nhs111 always "failed" showing
    // Gateway/booking instead, because nothing captured what actually
    // happened before continuing on.
    //
    // Fix keeps the full journey going all the way to completion (per
    // explicit follow-up request — do NOT stop the flow here) but now
    // records which outcome screen was reached at the moment it was
    // visible, so the final assertion can check the reachedOutcome that was
    // actually shown rather than whatever screen the journey ends up on
    // several steps later.
    const activeCondition = getActiveConditionName();
    const outcomeConfig = getOutcomeConfig(activeCondition);
    const matchedOutcome = outcomeConfig?.outcomes.find((o) =>
      o.detectPatterns.some((p) => p.test(popupText)),
    );
    this.reachedOutcome = matchedOutcome
      ? { id: matchedOutcome.id, label: matchedOutcome.label }
      : { id: "unknown", label: "Unknown outcome screen" };

    console.log(
      `[QuestionnairePage] Outcome screen reached: ${this.reachedOutcome.label} — continuing the journey to completion`,
    );

    // Same vanishing-element race as handleSelfCareResult's "End
    // assessment" click -- short timeouts so a stale button fails fast
    // instead of eating the full default actionTimeout.
    await popupButton.scrollIntoViewIfNeeded().catch(() => {});
    await popupButton.click({ force: true, timeout: 2_000 }).catch(async () => {
      await popupButton!.evaluate((el: HTMLElement) => el.click(), { timeout: 2_000 }).catch(() => {});
    });
    await this.page.waitForLoadState("networkidle").catch(() => {});

    return true;
  }

  /**
   * Terminal Result screens with no private-consultation option — e.g.
   * "Self care" ("Your pharmacy cannot deal with this under their NHS
   * contract... take care of the rash at home...") or "Assessment complete"
   * ("A pharmacist will review your answers...") — only offer "End
   * assessment". Rather than hardcoding every heading variant, just check
   * for that button directly. Call this AFTER handleNHS111Popup() so "Book
   * Private Consultation" still wins whenever both buttons are present.
   */
  private async handleSelfCareResult(): Promise<boolean> {
    const bookPrivateVisible = await this.page
      .locator(
        'button:has-text("Book Private Consultation"), a:has-text("Book Private Consultation")',
      )
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (bookPrivateVisible) {
      return false;
    }

    // Some tenants render a hidden duplicate button with identical text
    // before the real, visible one — scan all matches instead of .first().
    const endAssessmentMatches = this.page.locator(
      'button:has-text("End assessment"), [role="button"]:has-text("End assessment")',
    );
    const count = await endAssessmentMatches.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const btn = endAssessmentMatches.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        // ROOT CAUSE FIX (same class of bug as handleNHS111Popup): capture
        // which outcome this screen actually is BEFORE clicking "End
        // assessment" — that click navigates away (e.g. to the site's home
        // page), so a live page re-scan done afterward (in the spec's final
        // assertion) sees the WRONG page and can false-match an unrelated
        // outcome's pattern against home-page content instead.
        const screenText = await this.page.locator("body").innerText().catch(() => "");
        const activeCondition = getActiveConditionName();
        const outcomeConfig = getOutcomeConfig(activeCondition);
        const matchedOutcome = outcomeConfig?.outcomes.find((o) =>
          o.detectPatterns.some((p) => p.test(screenText)),
        );
        this.reachedOutcome = matchedOutcome
          ? { id: matchedOutcome.id, label: matchedOutcome.label }
          : { id: "unknown", label: "Unknown outcome screen" };

        console.log(
          `[QuestionnairePage] Terminal result screen detected (no private-consultation option): ${this.reachedOutcome.label} — clicking End assessment`,
        );
        // ROOT CAUSE FIX (confirmed live -- hung the full default
        // actionTimeout here): this can run right after handleNHS111Popup()
        // just clicked "Book Private Consultation" on an EARLIER pass --
        // that click's own SPA navigation can still be mid-flight, so this
        // "End assessment" button (read as visible a moment ago) can
        // vanish between the isVisible() check above and the click below.
        // A bare `.click()`/`.evaluate()` with no explicit timeout then
        // waits the full 15s default before giving up. Short timeouts so a
        // vanishing button fails fast instead -- the outer loop re-scans
        // and correctly picks up whatever page actually loaded next.
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ force: true, timeout: 2_000 }).catch(async () => {
          await btn.evaluate((el: HTMLElement) => el.click(), { timeout: 2_000 }).catch(() => {});
        });
        await this.page.waitForLoadState("networkidle").catch(() => {});
        this.endedWithoutBooking = true;
        return true;
      }
    }

    return false;
  }

  /**
   * "Age should be between X and Y" validation error (test patient's DOB
   * falls outside the condition's allowed age range) — renders a
   * "Back to Home" button, ending the assessment. Must be checked before
   * isOnThankYouPage(), which also treats "Back to Home" as a generic
   * success indicator and would otherwise silently bail without clicking.
   */
  private async handleAgeValidationError(): Promise<boolean> {
    const errorVisible = await this.page
      .locator('text=/Age should be between/i')
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (!errorVisible) {
      return false;
    }

    // Some tenants render a hidden duplicate button with identical text
    // before the real, visible one — scan all matches instead of .first().
    const backToHomeMatches = this.page.locator(
      'button:has-text("Back to Home"), a:has-text("Back to Home"), [role="button"]:has-text("Back to Home")',
    );
    const count = await backToHomeMatches.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const btn = backToHomeMatches.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ force: true }).catch(async () => {
          await btn.evaluate((el: HTMLElement) => el.click());
        });
        await this.page.waitForLoadState("networkidle").catch(() => {});
        return true;
      }
    }

    return false;
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
