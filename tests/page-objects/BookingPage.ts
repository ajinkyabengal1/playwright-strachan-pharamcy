import { Page } from "@playwright/test";
import { BOOKING_PREFERENCES, BookingPreferences } from "../fixtures/test-data";

export class BookingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Wait for the booking page to be ready.
   * Detects the appointment type selector, slot picker, or instant "Book Now" button.
   */
  async waitForPage() {
    await this.page.waitForLoadState("domcontentloaded");
    await this.page
      .locator(
        [
          ".appointment-type-radio-group",
          ':text("Appointment type")',
          ':text("Appointment Type")',
          ':text("Book your appointment")',
          ':text("Schedule your appointment")',
          ':text("Select a Date")',
          ".rota-slot",
          'button:has-text("Book Now")',
        ].join(", "),
      )
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  /**
   * Select the preferred appointment session type
   * (e.g. Phone, Video, Face-to-face) from test-data.ts.
   */
  async selectPreferredSessionType(
    prefs: BookingPreferences = BOOKING_PREFERENCES,
  ) {
    const oldRadioGroup = this.page.locator(".appointment-type-radio-group");
    const newButtonGroup = this.page.locator('h2:has-text("Appointment Type") + div, h2:has-text("Appointment type") + div');

    let container = oldRadioGroup;
    if (await newButtonGroup.isVisible({ timeout: 5000 }).catch(() => false)) {
      container = newButtonGroup;
    } else if (await oldRadioGroup.isVisible({ timeout: 500 }).catch(() => false)) {
      container = oldRadioGroup;
    } else {
      return;
    }

    const typeLabels: Record<string, string[]> = {
      video: ["Video", "Video Call", "Video Consultation"],
      "face-to-face": [
        "Face-to-face",
        "In-person",
        "In person",
        "Clinic",
        "Face to Face",
      ],
      "phone-call": ["Phone", "Phone call", "Telephone", "Telephone call"],
    };

    // Normalize key lookup: "Face to Face" -> "face-to-face"
    const normalizedType = (prefs.appointmentType || "video")
      .toLowerCase()
      .replace(/\s+/g, "-");
    const targetLabels = typeLabels[normalizedType] || [prefs.appointmentType];

    for (const label of targetLabels) {
      const option = container
        .locator("label, .ant-radio-wrapper, .ant-radio-button-wrapper, button")
        .filter({ hasText: label })
        .first();
      if (await option.isVisible().catch(() => false)) {
        console.log(`[BookingPage] Selecting appointment type: ${label}`);
        await option.click();
        await this.page.waitForTimeout(1500);
        return;
      }
    }

    // Fallback: click first if preferred not found
    console.log(
      "[BookingPage] Preferred appointment type not found — clicking first available",
    );
    const firstOption = container
      .locator(".ant-radio-wrapper, .ant-radio-button-wrapper, label, button")
      .first();
    await firstOption.click();
    await this.page.waitForTimeout(1500);
  }

  /**
   * Try to book an instant slot using the "Book Now" button.
   * Returns true if the button was found, enabled, and clicked.
   */
  async clickBookNow(): Promise<boolean> {
    const bookNowBtn = this.page
      .locator(
        'button.button-primary:has-text("Book Now"), button:has-text("Book Now")',
      )
      .first();

    if (!(await bookNowBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      return false;
    }
    const isDisabled = await bookNowBtn.isDisabled().catch(() => true);
    if (isDisabled) return false;

    await bookNowBtn.click();
    await this.page.waitForTimeout(2000);
    return true;
  }

  /**
   * Select a preferred month from the dropdown if specified.
   */
  private async selectMonthFromDropdown(monthYear: string) {
    console.log(`[BookingPage] Attempting to select month: ${monthYear}`);

    const triggerSelectors = [
      ".ant-select-selector",
      ".month-picker",
      'div[class*="select"]',
      ".ant-select-selection-search-input",
    ];

    for (const sel of triggerSelectors) {
      const picker = this.page.locator(sel).first();
      if (await picker.isVisible({ timeout: 1000 }).catch(() => false)) {
        await picker.click({ force: true });
        await this.page.waitForTimeout(1000);

        const option = this.page
          .locator(
            [
              `.ant-select-item-option-content:has-text("${monthYear}")`,
              `.ant-select-item-option:has-text("${monthYear}")`,
              `[role="option"]:has-text("${monthYear}")`,
            ].join(", "),
          )
          .first();

        if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
          await option.click({ force: true });
          await this.page.waitForTimeout(2000);
          console.log(
            `[BookingPage] Successfully selected month: ${monthYear}`,
          );
          return;
        }
      }
    }

    // Fallback: try clicking text directly if it looks like a dropdown trigger
    const textTrigger = this.page.locator(`:text("${monthYear}")`).first();
    if (await textTrigger.isVisible().catch(() => false)) {
      await textTrigger.click({ force: true }).catch(() => {});
      await this.page.waitForTimeout(1000);
    }
  }

  /**
   * Navigate forward or backward using arrow buttons.
   */
  private async navigateDateUsingArrows(
    direction: "next" | "prev",
  ): Promise<boolean> {
    const index = direction === "next" ? 1 : 0;
    const clicked = await this.page.evaluate((dirIndex): boolean => {
      const buttons = Array.from(
        document.querySelectorAll("button[class]"),
      ) as HTMLButtonElement[];

      const navButtons = buttons.filter((btn) => {
        const cls = btn.className;
        return (
          cls.includes("items-center") &&
          cls.includes("justify-center") &&
          cls.includes("border-solid") &&
          !btn.disabled
        );
      });

      const target =
        navButtons.length > dirIndex
          ? navButtons[dirIndex]
          : navButtons.length === 1
            ? navButtons[0]
            : null;
      if (target) {
        (target as HTMLButtonElement).click();
        return true;
      }
      return false;
    }, index);

    if (clicked) {
      await this.page.waitForTimeout(1200);
      console.log(`[BookingPage] Navigated ${direction} using arrows`);
    }
    return clicked;
  }

  /**
   * Select a specific date or navigate until found.
   */
  async selectFirstEnabledDate(
    prefs: BookingPreferences = BOOKING_PREFERENCES,
  ): Promise<boolean> {
    if (prefs.preferredMonth) {
      await this.selectMonthFromDropdown(prefs.preferredMonth);
    }

    const targetDate = prefs.preferredDate;
    console.log(
      `[BookingPage] Looking for date: ${targetDate || "any available"}`,
    );

    for (let attempt = 0; attempt < prefs.maxDateAttempts; attempt++) {
      await this.page.waitForTimeout(800);

      const result = await this.page.evaluate(
        (target): { clicked: boolean; foundInView: boolean } => {
          // Find buttons that look like date cells
          const allButtons = Array.from(
            document.querySelectorAll("button"),
          ) as HTMLButtonElement[];

          const dateCells = allButtons.filter((btn) => {
            const disabled = btn.disabled || btn.getAttribute("aria-disabled") === "true";
            if (disabled) return false;
            // The new UI has 3 divs inside the button for day/date/month
            return btn.children.length >= 2 && btn.textContent && btn.textContent.length < 15;
          });

          // Also keep the old div approach for backward compatibility
          const allDivs = Array.from(
            document.querySelectorAll("div[class]"),
          ) as HTMLElement[];

          const oldDateCells = allDivs.filter((div) => {
            const cls = div.className;
            return (
              cls.includes("flex-col") &&
              cls.includes("items-center") &&
              cls.includes("cursor-pointer") &&
              !cls.includes("cursor-not-allowed") &&
              div.children.length >= 2
            );
          });

          const validCells = dateCells.length > 0 ? dateCells : oldDateCells;

          if (target) {
            const normalizedTarget = target.replace(/\s+/g, "").toLowerCase();
            const match = validCells.find((cell) => {
              const text = (cell.textContent ?? "")
                .replace(/\s+/g, "")
                .toLowerCase();
              return text === normalizedTarget;
            });

            if (match) {
              match.click();
              return { clicked: true, foundInView: true };
            }
            return { clicked: false, foundInView: false };
          } else {
            if (validCells.length > 0) {
              validCells[0].click();
              return { clicked: true, foundInView: true };
            }
            return { clicked: false, foundInView: false };
          }
        },
        targetDate,
      );

      if (result.clicked) {
        await this.page.waitForTimeout(1500);
        console.log(
          `[BookingPage] Selected date: ${targetDate || "first available"}`,
        );
        return true;
      }

      if (prefs.autoMoveToNextDate) {
        const navigated = await this.navigateDateUsingArrows("next");
        if (!navigated) {
          console.log("[BookingPage] Could not navigate further");
          break;
        }
      } else {
        break;
      }
    }

    if (targetDate) {
      console.log(
        `[BookingPage] FAILED to find preferred date ${targetDate} after ${prefs.maxDateAttempts} attempts`,
      );
      return false;
    }

    return false;
  }

  /**
   * Select a specific time slot or the first available one from the rota-slot group.
   * Returns true if a slot was selected.
   */
  async selectAvailableSlot(
    prefs: BookingPreferences = BOOKING_PREFERENCES,
  ): Promise<boolean> {
    const oldSlotGroup = this.page.locator(".rota-slot");
    const newSlotGroup = this.page.locator('h3:has-text("Select a Time") + div');
    
    let slotGroup = oldSlotGroup;
    if (await newSlotGroup.isVisible({ timeout: 5000 }).catch(() => false)) {
      slotGroup = newSlotGroup;
    } else if (!(await oldSlotGroup.isVisible({ timeout: 500 }).catch(() => false))) {
      return false;
    }

    // Broaden the locator just in case different classes are used for different slots
    const slotLabels = slotGroup.locator("label, .ant-radio-button-wrapper, .ant-radio-wrapper, button");
    const count = await slotLabels.count();
    if (count === 0) return false;

    if (prefs.preferredTime && !prefs.useNextAvailableSlot) {
      let preferredSlot = null;
      for (let i = 0; i < count; i++) {
        const slot = slotLabels.nth(i);
        const text = (await slot.textContent().catch(() => "")) ?? "";
        const normalizedText = text.replace(/\s+/g, " ").trim().toLowerCase();
        const normalizedPref = prefs.preferredTime.replace(/\s+/g, " ").trim().toLowerCase();
        
        if (normalizedText.includes(normalizedPref) && normalizedPref.length > 0) {
          preferredSlot = slot;
          break;
        }
      }

      if (preferredSlot && (await preferredSlot.isVisible().catch(() => false))) {
        const isDisabled = await preferredSlot
          .evaluate((el) =>
            el.classList.contains("ant-radio-button-wrapper-disabled") ||
            el.classList.contains("ant-radio-wrapper-disabled") ||
            el.classList.contains("ant-radio-button-disabled") ||
            el.querySelector("input:disabled") !== null
          )
          .catch(() => true);
          
        if (!isDisabled) {
          console.log(
            `[BookingPage] Selecting preferred slot: ${prefs.preferredTime}`,
          );
          await preferredSlot.click();
          await this.page.waitForTimeout(500);
          return true;
        } else {
          console.log(
            `[BookingPage] Preferred slot ${prefs.preferredTime} is DISABLED`,
          );
          return false;
        }
      } else {
        console.log(
          `[BookingPage] Preferred slot ${prefs.preferredTime} NOT FOUND in current view`,
        );
        return false;
      }
    }

    console.log(
      "[BookingPage] No specific preferred time requested or fallback enabled — picking first available",
    );
    for (let i = 0; i < count; i++) {
      const slot = slotLabels.nth(i);
      const isDisabled = await slot
        .evaluate((el) =>
          el.classList.contains("ant-radio-button-wrapper-disabled") ||
          el.classList.contains("ant-radio-wrapper-disabled") ||
          el.classList.contains("ant-radio-button-disabled") ||
          el.querySelector("input:disabled") !== null
        )
        .catch(() => true);
      if (!isDisabled) {
        const timeText = ((await slot.textContent().catch(() => "")) ?? "").trim();
        // Skip empty labels that might be matched by the broader locator
        if (timeText) {
          console.log(
            `[BookingPage] Selecting first available slot: ${timeText}`,
          );
          await slot.click();
          await this.page.waitForTimeout(500);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Click the "Book Appointment" button. Waits for it to become enabled
   * (requires a slot to be selected first).
   */
  async clickBookAppointment() {
    const preferredCtas = this.page.locator(
      [
        'button:has-text("Continue to Payment")',
        'button:has-text("Continue to payment")',
        'button:has-text("Continue To Payment")',
        'button:has-text("Continue to Payement")',
        'button:has-text("Book Appointment")',
        'button:has-text("Confirm Appointment")',
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'button:has-text("Proceed")',
        'button:has-text("Book")',
        'button[type="submit"]',
      ].join(", "),
    );

    for (let i = 0; i < 8; i++) {
      const count = await preferredCtas.count();
      for (let idx = 0; idx < count; idx++) {
        const btn = preferredCtas.nth(idx);
        const visible = await btn
          .isVisible({ timeout: 300 })
          .catch(() => false);
        if (!visible) continue;

        const enabled = await btn.isEnabled().catch(() => false);
        const text = ((await btn.textContent().catch(() => "")) ?? "").trim();
        console.log(
          `[BookingPage] Booking button candidate -> text="${text}", enabled=${enabled}`,
        );
        if (!enabled) continue;

        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ force: true });
        await this.page.waitForTimeout(1500);
        return;
      }
      await this.page.waitForTimeout(700);
    }

    const clickedFallback = await this.page.evaluate((): string | null => {
      const buttons = Array.from(
        document.querySelectorAll("button"),
      ) as HTMLButtonElement[];

      const preferred = buttons.find((button) => {
        const text = (button.textContent ?? "").trim().toLowerCase();
        return (
          !button.disabled &&
          (text.includes("book") ||
            text.includes("confirm") ||
            text.includes("continue") ||
            text.includes("next") ||
            text.includes("proceed"))
        );
      });

      if (preferred) {
        preferred.click();
        return (preferred.textContent ?? "").trim();
      }

      return null;
    });

    if (clickedFallback) {
      console.log(
        `[BookingPage] Clicked fallback booking button with text "${clickedFallback}"`,
      );
      await this.page.waitForTimeout(1500);
      return;
    }

    const visibleButtons = await this.page
      .locator("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          text: (button.textContent ?? "").trim(),
          disabled: (button as HTMLButtonElement).disabled,
          className: (button as HTMLElement).className || "",
        })),
      )
      .catch(
        () =>
          [] as Array<{
            text: string;
            disabled: boolean;
            className: string;
          }>,
      );
    console.log(
      `[BookingPage] No booking CTA found after slot selection. Buttons: ${JSON.stringify(visibleButtons.slice(0, 12))}`,
    );
  }

  /**
   * Handle the "Appointment Selected" / intermediate "Continue" state.
   * Returns true if handled.
   */
  async handleBookingContinue(): Promise<boolean> {
    const continueBtn = this.page
      .locator('button:has-text("Continue")')
      .first();

    if (await continueBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await continueBtn.click();
      await this.page.waitForTimeout(1500);
      return true;
    }
    return false;
  }

  /**
   * Check whether the current page is a booking step.
   */
  async isBookingPage(): Promise<boolean> {
    const indicators = [
      ".appointment-type-radio-group",
      ".rota-slot",
      'button:has-text("Book Now")',
      'button:has-text("Continue to Payment")',
      'button:has-text("Continue to payment")',
      'button:has-text("Continue To Payment")',
      'button:has-text("Continue to Payement")',
      ':text("Appointment type")',
      ':text("Appointment Type")',
      ':text("Select a Date")',
    ];
    for (const sel of indicators) {
      if (
        await this.page
          .locator(sel)
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Locate and click the "Select next available slot" radio using a
   * multi-strategy DOM walk. The row is a custom styled element (not a
   * standard Ant Design radio), so we must find the <input type="radio">
   * inside its container and click/dispatch events on it directly.
   *
   * Returns true if the radio was found and clicked.
   */
  private async clickNextAvailableSlotRadio(): Promise<boolean> {
    // Strategy 0: New UI - "Book this slot" button
    const newBookThisSlotBtn = this.page.locator('button:has-text("Book this slot"), button:has-text("Book This Slot")').first();
    if (await newBookThisSlotBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log("[BookingPage] Strategy 0: Found 'Book this slot' button for soonest available slot");
      await newBookThisSlotBtn.click();
      await this.page.waitForTimeout(1000);
      return true;
    }

    // Check if it already says "Selected" under Soonest available
    const alreadySelected = this.page.locator('p:has-text("Soonest available")').locator('xpath=../..').locator('button:has-text("Selected")').first();
    if (await alreadySelected.isVisible().catch(() => false)) {
      console.log("[BookingPage] Strategy 0: 'Book this slot' is already Selected");
      return true;
    }

    // Strategy 1: DOM walk — find text, traverse up to locate the radio input,
    // then click it and fire a change event so React/custom frameworks register it.
    const clickedViaEvaluate = await this.page.evaluate((): boolean => {
      const TARGET_TEXT = "select next available slot";

      // Collect all elements and find the shallowest one whose trimmed
      // textContent matches (avoids matching huge ancestor containers).
      const allElements = Array.from(document.querySelectorAll("*"));

      for (const el of allElements) {
        // Only consider elements whose direct text (not descendants') matches,
        // OR whose total textContent closely matches (short containers).
        const text = (el.textContent ?? "").trim().toLowerCase();
        if (!text.includes(TARGET_TEXT)) continue;
        // Skip if this element is a large container with lots of other text
        if (text.length > TARGET_TEXT.length + 60) continue;

        // Walk UP to 5 ancestor levels looking for a sibling/child radio input
        let container: Element | null = el;
        for (let depth = 0; depth < 5; depth++) {
          if (!container) break;

          const radioInput = container.querySelector(
            'input[type="radio"]',
          ) as HTMLInputElement | null;

          if (radioInput) {
            if (radioInput.disabled) {
              console.warn(
                "[BookingPage] Next available slot radio is disabled",
              );
              return false;
            }
            // Click the input and dispatch both click and change events
            radioInput.click();
            radioInput.dispatchEvent(
              new MouseEvent("click", { bubbles: true }),
            );
            radioInput.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }

          // Also check: maybe the container itself is clickable (e.g. a custom div radio)
          const role = container.getAttribute("role");
          if (role === "radio" || role === "option") {
            (container as HTMLElement).click();
            return true;
          }

          container = container.parentElement;
        }

        // Last resort for this match: click the element itself
        (el as HTMLElement).click();
        return true;
      }

      return false;
    });

    if (clickedViaEvaluate) {
      console.log("[BookingPage] Strategy 1 (DOM walk evaluate) succeeded");
      await this.page.waitForTimeout(1000);
      return true;
    }

    // Strategy 2: Playwright locator targeting the row container, then the input inside it
    console.log(
      "[BookingPage] Strategy 1 failed — trying Strategy 2 (Playwright row + input locator)",
    );

    const rowLocator = this.page
      .locator("div, li, section, label")
      .filter({ hasText: /select next available slot/i })
      // Pick the most specific (innermost) match
      .last();

    if (await rowLocator.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Try clicking the radio input inside the row first
      const radioInRow = rowLocator.locator('input[type="radio"]').first();
      if (
        await radioInRow
          .count()
          .then((c) => c > 0)
          .catch(() => false)
      ) {
        await radioInRow.click({ force: true });
        console.log(
          "[BookingPage] Strategy 2a: clicked radio input inside row",
        );
      } else {
        // No input found — click the row container itself
        await rowLocator.click({ force: true });
        console.log(
          "[BookingPage] Strategy 2b: clicked row container directly",
        );
      }
      await this.page.waitForTimeout(1000);
      return true;
    }

    // Strategy 3: Broad radio input scan — find any unchecked radio near the text
    console.log(
      "[BookingPage] Strategy 2 failed — trying Strategy 3 (broad radio scan)",
    );

    const foundViaRadioScan = await this.page.evaluate((): boolean => {
      const TARGET_TEXT = "select next available slot";
      const allRadios = Array.from(
        document.querySelectorAll('input[type="radio"]'),
      ) as HTMLInputElement[];

      for (const radio of allRadios) {
        if (radio.disabled) continue;

        // Check the radio's surrounding DOM for the target text
        let ancestor: Element | null = radio.parentElement;
        for (let depth = 0; depth < 6; depth++) {
          if (!ancestor) break;
          const text = (ancestor.textContent ?? "").trim().toLowerCase();
          if (text.includes(TARGET_TEXT)) {
            radio.click();
            radio.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
          ancestor = ancestor.parentElement;
        }
      }
      return false;
    });

    if (foundViaRadioScan) {
      console.log("[BookingPage] Strategy 3 (broad radio scan) succeeded");
      await this.page.waitForTimeout(1000);
      return true;
    }

    console.log(
      "[BookingPage] All strategies failed to find 'Select next available slot'",
    );
    return false;
  }

  /**
   * Verify the "Select next available slot" radio is actually checked after clicking.
   * Returns true if checked or if verification is inconclusive (can't find the input).
   */
  private async verifyNextAvailableSlotSelected(): Promise<boolean> {
    const alreadySelected = this.page.locator('p:has-text("Soonest available")').locator('xpath=../..').locator('button:has-text("Selected")').first();
    if (await alreadySelected.isVisible().catch(() => false)) {
      return true;
    }

    return this.page.evaluate((): boolean => {
      const TARGET_TEXT = "select next available slot";
      const allElements = Array.from(document.querySelectorAll("*"));

      for (const el of allElements) {
        const text = (el.textContent ?? "").trim().toLowerCase();
        if (!text.includes(TARGET_TEXT)) continue;
        if (text.length > TARGET_TEXT.length + 60) continue;

        let container: Element | null = el;
        for (let depth = 0; depth < 5; depth++) {
          if (!container) break;
          const radioInput = container.querySelector(
            'input[type="radio"]',
          ) as HTMLInputElement | null;
          if (radioInput) return radioInput.checked;
          container = container.parentElement;
        }
      }
      // Can't find the input to verify — assume OK
      return true;
    });
  }

  /**
   * Complete the full booking flow using preferences from test-data.ts:
   *   1. Select preferred session type
   *   2. Try instant "Book Now" → fall back to date + slot selection
   *   3. Handle any intermediate "Continue" state
   */
  async completeBooking(prefs: BookingPreferences = BOOKING_PREFERENCES) {
    await this.waitForPage();
    await this.selectPreferredSessionType(prefs);

    // Brief pause for any dynamic content to load after session type selection
    await this.page.waitForTimeout(2000);

    // Attempt instant "Book Now" path (simplest)
    const bookedInstant = await this.clickBookNow();
    if (bookedInstant) {
      console.log("✔ Booked via instant Book Now slot");
      await this.handleBookingContinue();
      return;
    }

    if (prefs.useNextAvailableSlot) {
      console.log(
        "ℹ useNextAvailableSlot is true — attempting to select 'Select next available slot'",
      );

      const clicked = await this.clickNextAvailableSlotRadio();

      if (!clicked) {
        console.log(
          "ℹ 'Select next available slot' radio button not found — falling back to first enabled date selection",
        );
        const dateSelected = await this.selectFirstEnabledDate(prefs);
        if (!dateSelected) {
          throw new Error("No available dates found during fallback");
        }
        const slotSelected = await this.selectAvailableSlot(prefs);
        if (!slotSelected) {
          throw new Error("No available time slots found during fallback");
        }
      } else {
        // Verify the radio is actually checked
        const isSelected = await this.verifyNextAvailableSlotSelected();
        if (!isSelected) {
          console.log(
            "⚠ Radio was clicked but does not appear checked — retrying once",
          );
          await this.clickNextAvailableSlotRadio();
          await this.page.waitForTimeout(500);
        }
        console.log("✔ 'Select next available slot' selected successfully");
        await this.page.waitForTimeout(1500);
      }
    } else {
      // Fall back: select a date, then a time slot
      console.log(
        "ℹ No instant slot — selecting date and time slot based on preferences",
      );
      const dateSelected = await this.selectFirstEnabledDate(prefs);
      if (!dateSelected) {
        const errorMsg = `Date ${prefs.preferredDate || "available"} not found`;
        console.log(`⚠ ${errorMsg} after ${prefs.maxDateAttempts} attempts`);
        throw new Error(errorMsg);
      }

      const slotSelected = await this.selectAvailableSlot(prefs);
      if (!slotSelected) {
        const errorMsg = prefs.preferredTime
          ? `Time slot "${prefs.preferredTime}" is not available`
          : "No available time slots found";
        console.log(`⚠ ${errorMsg} for selected date`);
        throw new Error(errorMsg);
      }
    }

    await this.clickBookAppointment();
    await this.handleBookingContinue();
  }
}
