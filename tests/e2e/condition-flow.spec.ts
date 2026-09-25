import { test, expect, Page } from "@playwright/test";
import {
  TEST_USER,
  ACTIVE_CONDITION,
  CART_PREFERENCES,
  DRUG_SELECTION_PREFERENCES,
  SHIPPING_ADDRESS_PREFERENCES,
  THANK_YOU_PREFERENCES, PHARMACY_PREFERENCES,
  getActiveConditionName,
} from "../fixtures/test-data";
import { ConditionsPage } from "../page-objects/ConditionsPage";
import { ConditionDetailPage } from "../page-objects/ConditionDetailPage";
import { GuestContinuePage } from "../page-objects/GuestContinuePage";
import { QuestionnairePage } from "../page-objects/QuestionnairePage";
import { SignupPage } from "../page-objects/SignupPage";
import { ProductSignupPage } from "../page-objects/ProductSignupPage";
import { DrugSelectionPage } from "../page-objects/DrugSelectionPage";
import { CartPage } from "../page-objects/CartPage";
import { ShippingAddressPage } from "../page-objects/ShippingAddressPage";
import { ThankYouPage } from "../page-objects/ThankYouPage";
import { BookingPage } from "../page-objects/BookingPage";

// ─── Journey step types ───────────────────────────────────────────────────────
type JourneyStep =
  | "guest_continue"
  | "product_signup"
  | "questionnaire_submit"
  | "sign_up"
  | "appointment_booking"
  | "drug_selection"
  | "cart"
  | "shipping_address"
  | "thank_you"
  | "success"
  | "unknown";

let shippingHandled = false;

/**
 * Detect the current journey step by inspecting the DOM.
 */
async function detectCurrentStep(page: Page): Promise<JourneyStep> {
  const currentUrl = page.url();

  const hasVisibleIndicator = async (selectors: string[]) => {
    for (const sel of selectors) {
      const nodes = page.locator(sel);
      const count = await nodes.count().catch(() => 0);
      const maxToCheck = Math.min(count, 5);

      for (let i = 0; i < maxToCheck; i++) {
        const visible = await nodes
          .nth(i)
          .isVisible({ timeout: 300 })
          .catch(() => false);
        if (visible) return true;
      }
    }
    return false;
  };

  // -1. Patient Information fields, checked even before the dialog-priority
  // check below. Some tenants (e.g. Kepple Lane) render "Patient Information"
  // as one of several steps *inside* the same questionnaire dialog, and its
  // own stepper can put that step before, after, or between the others —
  // the dialog is generic across all of them, so classifying by "a dialog
  // with the word questionnaire is open" would always win and this
  // dedicated, better-tested sign_up handler (real TEST_USER data via
  // SignupPage.fillNHSPDSForm) would never get a turn for this step.
  //
  // IMPORTANT: match only the actual form fields, never the step *label*
  // text ("Patient Information") — that label lives in a persistent
  // stepper breadcrumb shown on every step (Patient Info, Questionnaire,
  // Booking alike), so text-matching it here would misclassify the other
  // two steps as "sign_up" too.
  const patientInfoIndicators = [
    'input[name="first_name"]',
    'input[name="last_name"]',
    'input[name="postcode"]',
    'input[placeholder*="first name" i]',
    'input[placeholder*="last name" i]',
    'input[placeholder*="postcode" i]',
    'input[placeholder*="postal code" i]',
  ];
  if (await hasVisibleIndicator(patientInfoIndicators)) {
    return "sign_up";
  }

  // 0. Questionnaire modal dialog — some tenants (e.g. Kepple Lane) embed the
  // questionnaire as a role="dialog" overlay inside the booking wizard instead
  // of a standalone page, so it must be checked before any background-page
  // indicators below (signup fields etc. can still be visible underneath it).
  const questionnaireDialogIndicators = [
    // Exclude Next.js's own (permanently-mounted, normally hidden) dev-mode
    // error overlay — its stack trace can coincidentally contain the word
    // "Questionnaire" and falsely match here.
    '[role="dialog"][aria-label*="questionnaire" i]:not([data-nextjs-dialog])',
    '[role="dialog"]:has-text("Questionnaire"):not([data-nextjs-dialog])',
  ];
  if (await hasVisibleIndicator(questionnaireDialogIndicators)) {
    return "questionnaire_submit";
  }

  // 1. Cart step
  const cartIndicators = [
    "text=/shopping\\s*cart/i",
    'button:has-text("Proceed To Checkout")',
    'button:has-text("Continue Shopping")',
    'button:has-text("Apply")',
    'input[placeholder*="coupon" i]',
  ];
  if (await hasVisibleIndicator(cartIndicators)) {
    return "cart";
  }

  // 2. Shipping address step (must be before payment)
  const shippingAddressIndicators = [
    "text=/shipping address/i",
    "text=/select delivery address/i",
    "text=/payment method/i",
    'button:has-text("Save Address")',
    'button:has-text("Cancel")',
  ];
  if (await hasVisibleIndicator(shippingAddressIndicators)) {
    return "shipping_address";
  }

  // 3. Thank-you order page (must run before generic success)
  const thankYouIndicators = [
    "text=/thank you for your order!/i",
    "text=/your order has been successfully placed/i",
    'a:has-text("My Orders")',
  ];
  if (await hasVisibleIndicator(thankYouIndicators)) {
    return "thank_you";
  }

  // 4. Success / confirmation state
  const successIndicators = [
    ':has-text("Booking Confirmed")',
    ':has-text("booking confirmed")',
    ':has-text("Appointment Confirmed")',
    ':has-text("appointment confirmed")',
    ':has-text("Thank you for booking")',
    ':has-text("You can safely close")',
    ':has-text("Successfully booked")',
    ':has-text("Booking confirmed")',
    '[class*="BookingAppointmentSuccess"]',
    '[class*="booking-appointment-success"]',
  ];
  if (await hasVisibleIndicator(successIndicators)) {
    return "success";
  }

  // 5. Booking step (Prioritize over payment if "Continue to Payment" button is present)
  const bookingIndicators = [
    ".appointment-type-radio-group",
    ".rota-slot",
    'button:has-text("Book Now")',
    'button:has-text("Continue to Payment")',
    'button:has-text("Continue to payment")',
    'button:has-text("Continue To Payment")',
    'button:has-text("Continue to Payement")',
    ':text("Appointment type")',
    ':text("Book your appointment")',
    ':text("Schedule your appointment")',
    ':text("Select appointment session type")',
  ];
  if (await hasVisibleIndicator(bookingIndicators)) {
    return "appointment_booking";
  }

  // 6. Drug selection step
  const drugSelectionIndicators = [
    "text=/what.?s your preference\\?/i",
    ".drug-selection-section",
    ".product-box-ui",
    'button:has-text("Choose this Option")',
  ];
  if (await hasVisibleIndicator(drugSelectionIndicators)) {
    return "drug_selection";
  }

  // 7. Product checkout signup step (strict detection to avoid early false positives)
  const productSignupHeadingVisible = await hasVisibleIndicator([
    "text=/enter your personal details/i",
    "text=/enter your contact details/i",
  ]);
  const productSignupContextVisible = await hasVisibleIndicator([
    "text=/order summary/i",
    ".summary-box",
    ".checkout-product-box",
    "form[name='signup-form']",
  ]);
  if (
    productSignupHeadingVisible &&
    (productSignupContextVisible || /checkout/i.test(currentUrl))
  ) {
    return "product_signup";
  }



  // 9. Continue-as-guest step (must be before signup detection)
  const guestContinueIndicators = [
    'button:has-text("Continue as Guest")',
    'button:has-text("Continue as guest")',
    'a:has-text("Continue as Guest")',
    'a:has-text("Continue as guest")',
    '[role="button"]:has-text("Continue as Guest")',
    '[role="button"]:has-text("Continue as guest")',
    "text=/continue\\s+as\\s+guest/i",
  ];
  if (await hasVisibleIndicator(guestContinueIndicators)) {
    return "guest_continue";
  }

  // 10. Sign-up / contact-details step
  const signupIndicators = [
    'input[name="first_name"]',
    'input[name="last_name"]',
    'input[name="postcode"]',
    'input[placeholder*="first name" i]',
    'input[placeholder*="last name" i]',
    'input[placeholder*="postcode" i]',
    ':text("Patient information")',
    ':text("Patient Information")',
    'input[name="email"]',
    'input[type="email"]',
    'input[placeholder*="phone number" i]',
    'input[placeholder*="Confirm your phone number" i]',
    'input[placeholder*="Enter your email address" i]',
    'input[placeholder*="Confirm your email address" i]',
    'input[placeholder*="Enter password" i]',
    'input[placeholder*="Confirm password" i]',
    ':text("Enter your contact details")',
    ':text("Patient details")',
    ':text("Personal details")',
    ':text("Contact details")',
    ':text("Enter your details")',
    'button:has-text("Sign Up")',
  ];
  if (await hasVisibleIndicator(signupIndicators)) {
    return "sign_up";
  }

  // 11. Questionnaire step
  const questionnaireIndicators = [
    ':text("Questionnaires")',
    ':text("Important Notice")',
    ':text("Do you have these symptoms?")',
    ':text("I do not have these symptoms")',
    ':text("I do have these symptoms")',
    'button:has-text("Next")',
    // Legacy "hq-kit" questionnaire template (e.g. Kepple Lane's
    // "personal-information-gathering" condition): a single-page form
    // rendered inline, not a modal.
    ".questionnaire-answer-box--kit",
    ".hq-root",
    ".hq-question",
    '[class*="question"]',
    '[class*="questionnaire"]',
    ".ant-picker",
  ];
  if (await hasVisibleIndicator(questionnaireIndicators)) {
    return "questionnaire_submit";
  }

  // Some tenants keep "/questionnaire" in the URL even after moving forward.
  // Avoid URL-only fallback here, otherwise payment can be misrouted as questionnaire.

  return "unknown";
}

/**
 * Different tenants order their journey steps differently — e.g. "Patient
 * Information → Questionnaire → Booking" vs "Questionnaire → Signup →
 * Booking" — so the actual sequence must be read from the site's own step
 * progress indicator rather than assumed. Logs a tagged line the dashboard
 * picks up to replace its static "Journey Flow" guess with what this
 * specific condition's page really shows, the moment that page opens.
 * Cheap to call every iteration — no-ops after the first successful read.
 */
async function logJourneyFlowOnce(
  page: Page,
  state: { logged: boolean },
): Promise<void> {
  if (state.logged) return;

  const stepLabels = await page
    .evaluate(() => {
      // A step-progress indicator renders a row of items, each pairing a
      // small numbered circle with a short label (e.g. "1 Patient
      // Information", "2 Questionnaire", "3 Booking"). Find the shallowest
      // container whose direct children all follow that circle+label shape.
      const candidates = Array.from(document.querySelectorAll("div"));
      for (const container of candidates) {
        const children = Array.from(container.children) as HTMLElement[];
        if (children.length < 2 || children.length > 6) continue;

        const labels: string[] = [];
        for (const child of children) {
          const circle = Array.from(child.querySelectorAll("div")).find(
            (d) => /^\d+$/.test((d.textContent ?? "").trim()),
          );
          const label = child.querySelector("span");
          const labelText = (label?.textContent ?? "").trim();
          if (circle && labelText && labelText.length < 40) {
            labels.push(labelText);
          }
        }
        if (labels.length === children.length && labels.length >= 2) {
          return labels;
        }
      }
      return [] as string[];
    })
    .catch(() => [] as string[]);

  if (stepLabels.length >= 2) {
    state.logged = true;
    console.log(`🗺️ JOURNEY_FLOW: ${stepLabels.join(" → ")}`);
  }
}

/**
 * When the journey doesn't complete, a bare "Expected true, Received false"
 * leaves no clue why. Check the page for known, common stopping points and
 * return a specific, human-readable reason instead — e.g. reaching a real
 * card-payment step, which requires a real card/3D-Secure and is an
 * expected automation boundary, not a bug to chase.
 */
async function diagnoseIncompleteJourney(page: Page): Promise<string> {
  const paymentIndicators = [
    ':text("Complete your payment")',
    ':text("Enter your card details")',
    'input[autocomplete="cc-number"]',
    ':text("Pass challenge")',
    ':text("3dsecure.io")',
  ];
  for (const sel of paymentIndicators) {
    if (await page.locator(sel).first().isVisible({ timeout: 300 }).catch(() => false)) {
      return (
        "Reached the payment step (\"Complete your payment\") — this requires " +
        "entering a real card and completing 3D-Secure, which automation " +
        "cannot do. This is an expected stopping point for paid conditions, " +
        "not a bug in the automation."
      );
    }
  }

  const alreadyBookedVisible = await page
    .locator(':text("Appointment slot is booked already"), :text("slot is already booked")')
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);
  if (alreadyBookedVisible) {
    return (
      "The selected appointment slot was already booked (likely from an " +
      "earlier test run against this same local backend) and the retry " +
      "to a different slot did not complete in time."
    );
  }

  const heading = await page
    .locator("h1, h2, h3")
    .first()
    .textContent({ timeout: 300 })
    .catch(() => null);
  return (
    `Stopped on an unrecognized page (heading: "${(heading ?? "").trim() || "none visible"}", ` +
    `url: ${page.url()}) — no known reason matched.`
  );
}

// ─── Main test ────────────────────────────────────────────────────────────────
test.describe("Conditions flow", () => {
  test("complete conditions flow: Booking Page → signup → confirm page", async ({
    page,
    baseURL,
  }) => {
//     page.on("console", (msg) => {
//       console.log(`[browser ${msg.type()}] ${msg.text()}`);
//     });
    page.on("pageerror", (err) => {
      console.log(`[page error] ${err.message}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400) {
        console.log(`[HTTP ${res.status()}] ${res.url()}`);
      }
    });

    // ── API Call Tracking ──────────────────────────────────────────────────
    const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:7890";
    const conditionSlug =
      process.env.CONDITION_SLUG || getActiveConditionName();
    const iterationNumber = parseInt(process.env.ITERATION_NUMBER || "1", 10);
    const conditionLabel =
      process.env.CONDITION_LABEL || conditionSlug;

    // Track API calls by intercepting request/response pairs
    const pendingRequests = new Map<
      string,
      { method: string; url: string; headers: Record<string, string>; body: string | null; startTime: number }
    >();

    page.on("request", (req) => {
      const url = req.url();
      // Only track the specific whitelisted APIs
      const whitelist = [
        "corporate_health_condition_details.json",
        "get_next_available_slots",
        "get_corporate_slots",
        "appointments.json",
        "pds_search_patients",
        "users/sign_up.json",
        "submit_questionnaire",
        "create_preconsult"
      ];
      if (whitelist.some(endpoint => url.includes(endpoint))) {
        pendingRequests.set(req.url() + req.method(), {
          method: req.method(),
          url: req.url(),
          headers: req.headers(),
          body: req.postData() || null,
          startTime: Date.now(),
        });
      }
    });

    page.on("response", async (res) => {
      const req = res.request();
      const key = req.url() + req.method();
      const pending = pendingRequests.get(key);
      if (!pending) return;
      pendingRequests.delete(key);

      const duration = Date.now() - pending.startTime;
      let responseBody: unknown = null;
      let responseHeaders: Record<string, string> = {};

      try {
        responseHeaders = res.headers();
      } catch {}

      try {
        const contentType = responseHeaders["content-type"] || "";
        if (
          contentType.includes("json") ||
          contentType.includes("text")
        ) {
          const text = await res.text().catch(() => "");
          if (text) {
            try {
              responseBody = JSON.parse(text);
            } catch {
              responseBody = text.substring(0, 2000); // Limit size
            }
          }
        }
      } catch {}

      let requestBody: unknown = null;
      if (pending.body) {
        try {
          requestBody = JSON.parse(pending.body);
        } catch {
          requestBody = pending.body;
        }
      }

      // Send to dashboard tracking API (fire-and-forget)
      const apiCallSuccess = res.status() >= 200 && res.status() < 400;
      const trackPayload = {
        conditionId: conditionSlug,
        conditionName: conditionLabel,
        iterationNumber,
        apiCall: {
          method: pending.method,
          url: pending.url,
          status: res.status(),
          duration,
          requestHeaders: pending.headers,
          requestBody,
          responseHeaders,
          responseBody,
          responseTime: new Date().toISOString(),
          success: apiCallSuccess,
        },
      };

      // The generic response listener above only logs a bare
      // "[HTTP status] url" line — surface a clearer, detailed failure for
      // these specifically-tracked automation-critical endpoints directly
      // in the console Output, since the dashboard's separate "API Calls"
      // tab report is sent silently (fire-and-forget) and easy to miss.
      if (!apiCallSuccess) {
        const bodySnippet =
          typeof responseBody === "string"
            ? responseBody.slice(0, 300)
            : responseBody
              ? JSON.stringify(responseBody).slice(0, 300)
              : "<no body>";
        console.log(
          `❌ API FAILED: ${pending.method} ${pending.url} → HTTP ${res.status()} (${duration}ms)\n   Response: ${bodySnippet}`,
        );
      }

      try {
        await fetch(`${DASHBOARD_URL}/api/track-api-call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(trackPayload),
        }).catch(() => {}); // Silently fail — dashboard may not be running
      } catch {}
    });

    const conditionsPage = new ConditionsPage(page);
    const detailPage = new ConditionDetailPage(page);
    const guestContinuePage = new GuestContinuePage(page);
    const questionnaire = new QuestionnairePage(page);
    const signup = new SignupPage(page);
    const productSignup = new ProductSignupPage(page);
    const drugSelection = new DrugSelectionPage(page);
    const cart = new CartPage(page);
    const shippingAddress = new ShippingAddressPage(page);
    const thankYou = new ThankYouPage(page);
    const booking = new BookingPage(page);

    const baseUrl = (
      baseURL ??
      process.env.BASE_URL ??
      "http://localhost:4005"
    ).replace(/\/$/, "");
    const selectedConditionName = getActiveConditionName();

    // ─── Step 1: Resolve condition href + pharmacy slug ─────────────────────
    let conditionHref: string;
    let pharmacySlug: string;

    const conditionDetailPath = process.env.CONDITION_DETAIL_PATH;

    if (conditionDetailPath) {
      conditionHref = conditionDetailPath;
      pharmacySlug = conditionsPage.extractPharmacySlug(conditionDetailPath);
      console.log(`✔ Direct condition path: ${conditionDetailPath}`);
      console.log(`✔ Pharmacy slug: ${pharmacySlug}`);
    } else {
      await test.step(`Navigate to /conditions and select condition`, async () => {
        await conditionsPage.goto();
        await conditionsPage.waitForConditions();
      });

      if (process.env.CONDITION_SLUG) {
        try {
          conditionHref = await conditionsPage.getConditionHrefBySlug(
            process.env.CONDITION_SLUG,
            PHARMACY_PREFERENCES.preferredBranch,
          );
        } catch (e) {
          test.skip(
            true,
            `Condition "${process.env.CONDITION_SLUG}" is not listed on this pharmacy's website — skipping.`,
          );
          return;
        }
      } else {
        conditionHref = await conditionsPage.getConditionHrefByName(
          selectedConditionName,
        );
      }
      pharmacySlug = conditionsPage.extractPharmacySlug(conditionHref);
      console.log(`✔ Selected condition href: ${conditionHref}`);
      console.log(`✔ Pharmacy slug: ${pharmacySlug}`);
    }

    // ─── Step 2: Set cookie then navigate to detail page ───────────────────
    await test.step("Set pharmacy cookie and open condition detail page", async () => {
      const cookieOrigin = page.url().startsWith("http")
        ? new URL(page.url()).origin
        : baseUrl;

      if (pharmacySlug) {
        await page.context().addCookies([
          {
            name: "selected-corporate-id",
            value: pharmacySlug,
            url: cookieOrigin,
          },
        ]);
      }

      await conditionsPage.clickConditionByHref(conditionHref);
      await detailPage.waitForDetailPage();
    });

    // ─── Step 4: Start Assessment ─────────────────────────────────────────
    await test.step("Click Start Assessment", async () => {
      // Check if we are already on a post-detail page step (like appointment booking)
      const currentStep = await detectCurrentStep(page);
      if (
        currentStep !== "unknown" &&
        currentStep !== "sign_up" &&
        currentStep !== "guest_continue"
      ) {
        console.log(
          `ℹ Already on step "${currentStep}" — skipping Click Start Assessment`,
        );
        return;
      }
      try {
        await detailPage.clickStartAssessment();
        await guestContinuePage.continueAsGuestIfVisible();
        await page
          .waitForURL("**/questionnaire**", { timeout: 15_000 })
          .catch(() => {});
        await page.waitForLoadState("domcontentloaded");
      } catch (e) {
        // Double check if we navigated somewhere recognized during wait
        const stepAfterWait = await detectCurrentStep(page);
        if (stepAfterWait !== "unknown") {
          console.log(
            `ℹ Navigated to step "${stepAfterWait}" during Click Start Assessment — continuing`,
          );
          return;
        }
        throw e;
      }
    });

    console.log(`✔ Post-assessment URL: ${page.url()}`);

    // ─── Steps 5–N: Dynamic journey loop ─────────────────────────────────
    let journeyStatus: "incomplete" | "completed" = "incomplete";

    await test.step("Complete dynamic journey (questionnaire / signup / booking)", async () => {
      const MAX_ITERATIONS = 7;
      const stepVisits: Record<string, number> = {};
      const MAX_STEP_VISITS = 6;
      let flowCompleted = false;
      const journeyFlowLogState = { logged: false };

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (flowCompleted) break;
        await page.waitForTimeout(1500);
        await logJourneyFlowOnce(page, journeyFlowLogState);

        let step = await detectCurrentStep(page);
        console.log(`🔍 Iteration ${i + 1}: detected step = "${step}"`);

        // Check for toast/page errors about invalid health conditions
        const bodyText = await page.innerText("body").catch(() => "");
        const toastTexts = await page
          .locator(
            ".ant-message, .ant-notification, [class*='toast'], [class*='message']",
          )
          .allInnerTexts()
          .catch(() => [] as string[]);
        const combinedText = [bodyText, ...toastTexts].join(" ");
        if (/invalid.*condition|condition.*invalid/i.test(combinedText)) {
          throw new Error(
            `Test failed: 'invalid health condition' error detected on the page or toast.`,
          );
        }

        if (step === "success") {
          console.log("✔ Booking success state reached!");
          journeyStatus = "completed";
          break;
        }

        if (step === "unknown") {
          // Short retry first to avoid long stalls when payment UI is still mounting.
          await page.waitForTimeout(500);
          step = await detectCurrentStep(page);
          if (step !== "unknown") {
            console.log(`↻ Fast retry detected step = "${step}"`);
          } else {
            await page.waitForTimeout(1200);
            step = await detectCurrentStep(page);
          }



          if (step === "unknown") {
            console.log(`⚠ Unknown step at URL: ${page.url()} — stopping loop`);
            break;
          }
        }

        const MAX_STEP_VISITS = 15;
        stepVisits[step] = (stepVisits[step] ?? 0) + 1;
        if (stepVisits[step] > MAX_STEP_VISITS) {
          console.log(
            `⚠ Stuck: step "${step}" visited ${stepVisits[step]} times — stopping`,
          );
          break;
        }

        switch (step) {
          case "guest_continue": {
            console.log("→ Handling continue-as-guest step");
            await guestContinuePage.continueAsGuestIfVisible();
            await page.waitForTimeout(800);
            break;
          }

          case "product_signup": {
            console.log("→ Handling product signup step");
            await productSignup.completeProductSignupFlow({
              firstName: TEST_USER.firstName,
              lastName: TEST_USER.lastName,
              postcode: TEST_USER.postcode,
              gender: TEST_USER.gender,
              dobIso: TEST_USER.dob.iso,
              phone: TEST_USER.phone,
              email: TEST_USER.email,
              password: TEST_USER.password,
              confirmPassword: TEST_USER.confirmPassword,
            });
            break;
          }

          case "questionnaire_submit": {
            console.log("→ Handling questionnaire step");
            await questionnaire.waitForPage();
            await questionnaire.answerAllQuestions();
            // A terminal Result screen with no booking option (e.g. "Self
            // care", "Assessment complete") ended via "End assessment" is a
            // valid, successful outcome — a pharmacist reviews the answers
            // instead of a booking being made — so count it as completed
            // rather than failing the run for never reaching a booking.
            if (questionnaire.endedWithoutBooking) {
              console.log(
                "✔ Assessment ended without booking (pharmacist review) — journey completed",
              );
              journeyStatus = "completed";
              flowCompleted = true;
            }
            break;
          }

          case "sign_up": {
            console.log("→ Handling sign-up step");

            const handledDynamicCheckoutSignup =
              await signup.completeDynamicCheckoutSignupIfVisible({
                firstName: TEST_USER.firstName,
                lastName: TEST_USER.lastName,
                postcode: TEST_USER.postcode,
                gender: TEST_USER.gender,
                dobIso: TEST_USER.dob.iso,
                phone: TEST_USER.phone,
                email: TEST_USER.email,
                password: TEST_USER.password,
                confirmPassword: TEST_USER.confirmPassword,
              });
            console.log(
              `[spec] handledDynamicCheckoutSignup=${handledDynamicCheckoutSignup}`,
            );
            if (handledDynamicCheckoutSignup) {
              break;
            }

            const inputsInfo = await page.evaluate(() => {
              const inputs = Array.from(document.querySelectorAll("input"));
              return inputs.map((input) => ({
                name: input.getAttribute("name"),
                placeholder: input.getAttribute("placeholder"),
                type: input.getAttribute("type"),
                visible: input.offsetWidth > 0 && input.offsetHeight > 0,
              }));
            });
            console.log(
              `[spec] Found inputs on page:`,
              JSON.stringify(inputsInfo),
            );

            const hasNHSForm = inputsInfo.some(
              (i) =>
                i.visible &&
                (i.name === "first_name" ||
                  (i.placeholder &&
                    i.placeholder.toLowerCase().includes("first name"))),
            );
            console.log(`[spec] hasNHSForm=${hasNHSForm}`);

            if (hasNHSForm) {
              await signup.waitForPage();
              console.log("[spec] fillNHSPDSForm starting...");
              await signup.fillNHSPDSForm({
                firstName: TEST_USER.firstName,
                lastName: TEST_USER.lastName,
                postcode: TEST_USER.postcode,
                gender: TEST_USER.gender,
                dobIso: TEST_USER.dob.iso,
              });
              const activeSlug =
                process.env.CONDITION_SLUG || getActiveConditionName();
              if (
                activeSlug.includes("shingles") ||
                ACTIVE_CONDITION.journeyType === "nhs"
              ) {
                await signup.submitNHSForm();
              } else {
                await signup.submitPrivatePatientInfoForm();
              }
              await signup.handlePDSResult();
              break;
            }

            const hasEmail = await page
              .locator('input[name="email"], input[type="email"]')
              .first()
              .isVisible()
              .catch(() => false);

            if (hasEmail) {
              await signup.fillContactDetails(TEST_USER.email, TEST_USER.phone);
              await signup.submitAndBook();
              await page.waitForTimeout(3_000);
            }
            break;
          }

          case "appointment_booking": {
            console.log("→ Handling booking step");
            await booking.completeBooking(undefined, PHARMACY_PREFERENCES);
            break;
          }

          case "drug_selection": {
            console.log("→ Handling drug selection step");
            await drugSelection.waitForPage();
            await drugSelection.chooseDrugOption(DRUG_SELECTION_PREFERENCES);
            break;
          }

          case "cart": {
            console.log("→ Handling cart step");
            await cart.waitForPage();
            await cart.handleCart(CART_PREFERENCES);

            // Dynamic transition guard:
            // shipping address can appear immediately after cart submit.
            if (await shippingAddress.isVisible()) {
              console.log("→ Shipping address appeared right after cart");
              await shippingAddress.handleShippingAddress(
                SHIPPING_ADDRESS_PREFERENCES,
              );
            }
            break;
          }

          case "shipping_address": {
            console.log("→ Handling shipping address step");
            await shippingAddress.handleShippingAddress(
              SHIPPING_ADDRESS_PREFERENCES,
            );
            shippingHandled = true;
            break;
          }

          case "thank_you": {
            console.log(
              "✔ Thank-you page detected! Journey completed successfully.",
            );
            await thankYou.handleThankYou(THANK_YOU_PREFERENCES);
            journeyStatus = "completed";
            flowCompleted = true;
            break;
          }


        }
      }
    });

    // ─── Final assertion ──────────────────────────────────────────────────
    await test.step("Verify journey completion", async () => {
      const isConfirmed =
        journeyStatus === "completed" || (await signup.isBookingConfirmed());
      console.log(
        `✔ Final verification: ${isConfirmed ? "COMPLETED SUCCESSFUL" : "INCOMPLETE"}`,
      );
      if (!isConfirmed) {
        const reason = await diagnoseIncompleteJourney(page);
        console.log(`❌ Journey incomplete — reason: ${reason}`);
      }
      expect(isConfirmed).toBe(true);
      if (isConfirmed) {
        console.log(
          "🎉 SUCCESS: The pharmacy journey has been fully automated and verified!",
        );

        // Check if pre-consultation questionnaire button is available on the confirmation page
        const preConsultBtn = page.locator('button:has-text("Complete pre-consultation questionnaire")');
        if (await preConsultBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          console.log("Found 'Complete pre-consultation questionnaire' button. Clicking it to open questionnaire UI...");
          await preConsultBtn.click();
          
          console.log("Answering pre-consultation questionnaire...");
          await questionnaire.waitForPage();
          await questionnaire.answerAllQuestions();
          console.log("✔ Pre-consultation questionnaire completed successfully!");
          
          console.log("Waiting for the Thank-you page to appear...");
          let thankYouVisible = false;
          for (let i = 0; i < 150; i++) {
            if (await thankYou.isVisible()) {
              thankYouVisible = true;
              break;
            }
            await page.waitForTimeout(200);
          }
          
          if (thankYouVisible) {
            console.log("✔ Thank-you page detected! Test completed successfully.");
            await thankYou.handleThankYou(THANK_YOU_PREFERENCES);
          } else {
            console.log("⚠️ Questionnaire submitted but Thank-you page was not detected within timeout.");
          }
        }
      }

      // Explicitly close the page to trigger immediate browser shutdown
      await page.close();
    });
  });
});
