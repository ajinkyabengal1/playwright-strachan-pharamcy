import { test, expect, Page } from "@playwright/test";
import {
  TEST_USER,
  TEST_USER_PDS,
  TEST_USER_NON_PDS,
  PDS_USER_MODE,
  ACTIVE_CONDITION,
  CART_PREFERENCES,
  DRUG_SELECTION_PREFERENCES,
  SHIPPING_ADDRESS_PREFERENCES,
  THANK_YOU_PREFERENCES, PHARMACY_PREFERENCES,
  getActiveConditionName,
} from "../fixtures/test-data";
import { getOutcome, getOutcomeConfig } from "../fixtures/outcome-config";

// OUTCOME_ID (e.g. "nhs111", "self_care", "gp_referral", "immediate_action",
// or default "gateway") selects which outcome this run is verifying. The
// signup identity (PDS vs non-PDS) is derived automatically from that
// outcome's config entry — not chosen manually — per the requirement that
// picking an outcome shouldn't require also remembering which user it needs.
// For a direct (non-outcome) run, PDS_USER_MODE (dashboard Test Data toggle,
// or PDS_USER_MODE env var override) picks the identity instead.
const activeSlugForOutcome = process.env.CONDITION_SLUG || getActiveConditionName();
const requestedOutcomeId = process.env.OUTCOME_ID;
const requestedOutcome = requestedOutcomeId
  ? getOutcome(activeSlugForOutcome, requestedOutcomeId)
  : undefined;
const resolvedUserType = requestedOutcome?.userType ?? PDS_USER_MODE;
const PDS_LOOKUP_USER =
  resolvedUserType === "pds" ? TEST_USER_PDS : TEST_USER_NON_PDS;
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

/**
 * Matches the final screen's visible text against the active condition's
 * configured outcome patterns (outcome-config.ts) to determine which
 * outcome actually rendered. Returns null if the condition has no outcome
 * config, or if the page doesn't match any known outcome for it.
 */
async function detectOutcomeScreen(
  page: Page,
  slug: string,
): Promise<{ id: string; label: string } | null> {
  const config = getOutcomeConfig(slug);
  if (!config) return null;

  const bodyText = await page.locator("body").innerText().catch(() => "");
  for (const outcome of config.outcomes) {
    if (outcome.detectPatterns.some((p) => p.test(bodyText))) {
      return { id: outcome.id, label: outcome.label };
    }
  }
  return null;
}

/**
 * Most tenants send submit_questionnaire as multipart/form-data:
 * answer_detail[N][question_detail_id] + answer_detail[N][answer] pairs,
 * one N per answered question. Some answers arrive as "Option
 * title®optionId" (a site-specific separator) — strip everything from "®"
 * onward to get just the human answer text. A tenant that sends this as a
 * plain JSON body instead (`{ answer_detail: [{ question_detail_id, answer }] }`)
 * is also supported, so this isn't tied to one pharmacy's API shape.
 */
function parseSubmittedAnswers(body: string | Record<string, unknown>): { id: string; answer: string }[] {
  if (typeof body === "object" && body !== null) {
    const list = (body as any).answer_detail;
    if (!Array.isArray(list)) return [];
    return list
      .filter((a: any) => a && a.question_detail_id != null && a.answer != null)
      .map((a: any) => ({ id: String(a.question_detail_id), answer: String(a.answer).split("®")[0].trim() }));
  }

  const ids: Record<string, string> = {};
  const idRe = /name="answer_detail\[(\d+)\]\[question_detail_id\]"\r?\n\r?\n(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(body))) ids[m[1]] = m[2];

  const answers: Record<string, string> = {};
  const ansRe = /name="answer_detail\[(\d+)\]\[answer\]"\r?\n\r?\n([\s\S]*?)\r?\n------/g;
  while ((m = ansRe.exec(body))) answers[m[1]] = m[2].split("®")[0].trim();

  return Object.keys(ids)
    .filter((idx) => answers[idx] !== undefined)
    .map((idx) => ({ id: ids[idx], answer: answers[idx] }));
}

/** Recursively maps question_detail_id -> plain-text title (HTML stripped), including conditional child questions. */
/**
 * ROOT CAUSE (0/3 matched despite correct answers): titles were only having
 * HTML tags stripped, not entities — "&nbsp;" survived as literal text and,
 * after normalizeForMatch() strips punctuation, left a stray "nbsp" word
 * wedged into the string wherever the API title had one but our own
 * getNearbyQuestionText()-derived text didn't (or vice versa). That broke
 * full-string containment even though the real wording was identical.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function collectQuestionTitles(details: any[] | undefined, out: Record<string, string> = {}): Record<string, string> {
  for (const q of details || []) {
    if (q?.id != null) {
      out[String(q.id)] = decodeHtmlEntities(String(q.title || "").replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
    }
    if (Array.isArray(q?.children)) collectQuestionTitles(q.children, out);
  }
  return out;
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Compares "what we clicked" (QuestionnairePage.filledAnswers) against
 * "what the submit_questionnaire API actually sent" (questionnaireSubmissions)
 * — the ground truth, since it's exactly what the server received, not a
 * scrape of some UI review screen that may not exist on every condition.
 */
/**
 * The rule engine and the generic fallback can both observe the same
 * already-answered question within the same pass (a brief race between one
 * clicking it and the other re-checking it before the DOM's "checked" class
 * updates), and some controls (range/date pickers) re-record their current
 * value on every pass regardless of whether it changed — dedupe identical
 * (question, answer) pairs so the count reflects real distinct answers.
 * Shared by buildQaComparison() and the no-server-data fallback path in the
 * spec (a run whose questionnaire has a file upload, where the submit
 * request body is unrecoverable).
 */
function dedupeFilledAnswers(rawFilledAnswers: { question: string; answer: string }[]) {
  const seen = new Set<string>();
  return rawFilledAnswers.filter((f) => {
    const key = `${normalizeForMatch(f.question)} ${normalizeForMatch(f.answer)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildQaComparison(
  rawFilledAnswers: { question: string; answer: string }[],
  submissions: { requestBody: string | Record<string, unknown>; responseBody: any }[],
) {
  const filledAnswers = dedupeFilledAnswers(rawFilledAnswers);

  const submitted: { question: string; answer: string }[] = [];
  for (const { requestBody, responseBody } of submissions) {
    const titles = collectQuestionTitles(
      responseBody?.data?.questionnaire?.questionnaire_template?.question_details,
    );
    for (const { id, answer } of parseSubmittedAnswers(requestBody)) {
      submitted.push({ question: titles[id] || `Question #${id}`, answer });
    }
  }

  // Token-overlap match rather than substring containment: adjacent DOM
  // elements (e.g. a heading and the paragraph right after it) often
  // concatenate with NO whitespace between them ("NoticeThis consultation"),
  // while the API's HTML-sourced title has a normal space there ("Notice
  // This") — after normalizing, that single missing space shifts every
  // character after it, breaking positional substring matching on an
  // otherwise-identical 400-character question. Comparing as a set of
  // significant words (4+ letters, skips small connector words) sidesteps
  // that entirely.
  const significantWords = (text: string) =>
    new Set(normalizeForMatch(text).split(" ").filter((w) => w.length >= 4));

  // ROOT CAUSE (real data: "Weight" — a 1-word filled question — falsely
  // matched a long, unrelated "This optional questionnaire asks about
  // eating habits... weight..." submitted question, purely because "weight"
  // is incidentally mentioned in that longer text): scoring by
  // `shared / smaller` alone lets a 1-word question score a perfect 1.0
  // against ANY longer question that happens to contain that one word,
  // however unrelated. Also requiring shared words to cover a reasonable
  // fraction of the LARGER side (not just the smaller one) rejects that —
  // 1 shared word out of 1 is fine (small=1.0, large=1.0 for a genuine
  // "Weight"="Weight" match) but 1 shared word out of 15 (large≈0.07) is
  // not, even though the smaller side alone still scores 1.0.
  const usedFilledIdx = new Set<number>();
  const rows = submitted.map((s) => {
    const submittedWords = significantWords(s.question);
    let bestIdx = -1;
    let bestOverlap = 0;
    filledAnswers.forEach((f, idx) => {
      if (usedFilledIdx.has(idx)) return;
      const filledWords = significantWords(f.question);
      const smaller = Math.min(submittedWords.size, filledWords.size) || 1;
      const larger = Math.max(submittedWords.size, filledWords.size) || 1;
      let shared = 0;
      for (const w of submittedWords) if (filledWords.has(w)) shared++;
      if (shared / larger < 0.3) return;
      const overlap = shared / smaller;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = idx;
      }
    });
    const match = bestOverlap >= 0.7 && bestIdx >= 0 ? filledAnswers[bestIdx] : null;
    if (match) usedFilledIdx.add(bestIdx);
    return {
      question: s.question,
      filledAnswer: match?.answer ?? null,
      submittedAnswer: s.answer,
      matched: !!match && normalizeForMatch(match.answer) === normalizeForMatch(s.answer),
    };
  });

  return {
    totalSubmitted: rows.length,
    totalFilled: filledAnswers.length,
    matchedCount: rows.filter((r) => r.matched).length,
    mismatches: rows.filter((r) => !r.matched),
    rows,
  };
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

    // Every submit_questionnaire request/response this run made — the
    // ground truth for "what actually got sent to the server", compared
    // against questionnaire.filledAnswers ("what we clicked") once the
    // journey finishes. Multi-step questionnaires (e.g. Weight Management)
    // submit once per template, so this can have more than one entry.
    const questionnaireSubmissions: { requestBody: string | Record<string, unknown>; responseBody: any }[] = [];

    // ROOT CAUSE (Q&A Verification only ever worked on Kepple Lane): the
    // whitelist below existed for the dashboard's own API-call tracking
    // feature and happened to include the literal string
    // "submit_questionnaire" -- Kepple Lane's actual endpoint name -- so
    // the Q&A comparison silently only ever captured a request on THAT one
    // pharmacy. Every tenant here shares the same component conventions
    // (hq-question classes, identical Tailwind CTA button classes, the same
    // Sanity condition catalog), strongly suggesting one shared backend
    // platform under different tenant frontends -- but each tenant could
    // still name its own endpoint differently. Track EVERY POST request's
    // body here (cheap: just a string reference, not parsed/processed) so
    // the response handler below can recognize a questionnaire submission
    // by its BODY SHAPE (the platform's own "answer_detail[...]" field
    // naming convention) regardless of what URL a given tenant uses for it.
    const pendingPostBodies = new Map<
      string,
      { body: string | null; startTime: number }
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
          // ROOT CAUSE (submit_questionnaire captured as null body on any
          // condition whose questionnaire includes a file upload, e.g. "All
          // Test Question"): req.postData() returns null for a multipart
          // body once it contains binary content — Playwright can't
          // guarantee it decodes as text. postDataBuffer() still returns
          // the raw bytes; decoding as latin1 (byte-for-byte, no charset
          // reinterpretation) keeps the multipart boundary/field lines
          // readable as text even with an opaque binary chunk embedded
          // between them, which is all parseSubmittedAnswers() needs.
          body: req.postData() || req.postDataBuffer()?.toString("latin1") || null,
          startTime: Date.now(),
        });
      } else if (["POST", "PUT", "PATCH"].includes(req.method())) {
        const body = req.postData() || req.postDataBuffer()?.toString("latin1") || null;
        pendingPostBodies.set(req.url() + req.method(), {
          body,
          startTime: Date.now(),
        });
        if (process.env.DEBUG_QUESTIONS === "1") {
          console.log(`[DIAG] non-whitelisted ${req.method()}: ${url} bodyPreview=${(body || "").slice(0, 3000)}`);
        }
      }
    });

    // ROOT CAUSE FIX continued (see pendingPostBodies comment above): any
    // POST not already claimed by the whitelisted handler is checked here
    // by its BODY SHAPE alone -- the platform's "answer_detail[N][...]"
    // multipart field convention (confirmed live on Kepple Lane's own
    // "submit_questionnaire" calls), or the JSON equivalent (an
    // "answer_detail" array/object key) -- so a differently-named endpoint
    // on another tenant still gets recognized as a real questionnaire
    // submission instead of silently producing an empty Q&A table.
    const looksLikeQuestionnaireSubmission = (body: string | null): boolean => {
      if (!body) return false;
      if (body.includes("answer_detail[")) return true; // multipart form-data
      if (/"answer_detail"\s*:/.test(body)) return true; // JSON body
      return false;
    };

    page.on("response", async (res) => {
      const req = res.request();
      const key = req.url() + req.method();
      const pendingPost = pendingPostBodies.get(key);
      if (pendingPost) {
        pendingPostBodies.delete(key);
        if (looksLikeQuestionnaireSubmission(pendingPost.body)) {
          let genericResponseBody: unknown = null;
          try {
            const ct = res.headers()["content-type"] || "";
            if (ct.includes("json") || ct.includes("text")) {
              const text = await res.text().catch(() => "");
              if (text) {
                try {
                  genericResponseBody = JSON.parse(text);
                } catch {
                  genericResponseBody = text.substring(0, 2000);
                }
              }
            }
          } catch {}
          let genericRequestBody: unknown = pendingPost.body;
          try {
            genericRequestBody = JSON.parse(pendingPost.body as string);
          } catch {}
          questionnaireSubmissions.push({
            requestBody: genericRequestBody as string | Record<string, unknown>,
            responseBody: genericResponseBody,
          });
          if (process.env.DEBUG_QUESTIONS === "1") {
            console.log(`[DEBUG_QUESTIONS] dynamically-detected questionnaire submission at ${req.url()}`);
            console.log(`[DEBUG_QUESTIONS] requestBody: ${JSON.stringify(genericRequestBody).slice(0, 4000)}`);
            console.log(`[DEBUG_QUESTIONS] responseBody: ${JSON.stringify(genericResponseBody).slice(0, 6000)}`);
          }
        }
      }

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

      if (
        (pending.url.includes("submit_questionnaire") || looksLikeQuestionnaireSubmission(pending.body)) &&
        (typeof requestBody === "string" || (requestBody && typeof requestBody === "object"))
      ) {
        questionnaireSubmissions.push({ requestBody: requestBody as string | Record<string, unknown>, responseBody });
        if (process.env.DEBUG_QUESTIONS === "1") {
          console.log(`[DEBUG_QUESTIONS] submit_questionnaire requestBody: ${JSON.stringify(requestBody).slice(0, 4000)}`);
          console.log(`[DEBUG_QUESTIONS] submit_questionnaire responseBody: ${JSON.stringify(responseBody).slice(0, 6000)}`);
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
              // The journey still completes successfully either way — only
              // the log message differs: a tracked outcome screen (NHS 111,
              // GP Referral, etc.) isn't a "pharmacist review" case, so say
              // which outcome was actually reached instead of always using
              // that generic phrase.
              console.log(
                questionnaire.reachedOutcome
                  ? `✔ Outcome screen reached: ${questionnaire.reachedOutcome.label} — journey completed`
                  : "✔ Assessment ended without booking (pharmacist review) — journey completed",
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
              console.log(
                `[spec] fillNHSPDSForm starting (userType=${resolvedUserType}, firstName=${PDS_LOOKUP_USER.firstName}, dob=${PDS_LOOKUP_USER.dob.display})...`,
              );
              await signup.fillNHSPDSForm({
                firstName: PDS_LOOKUP_USER.firstName,
                lastName: PDS_LOOKUP_USER.lastName,
                postcode: PDS_LOOKUP_USER.postcode,
                gender: PDS_LOOKUP_USER.gender,
                dobIso: PDS_LOOKUP_USER.dob.iso,
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

    // ─── Questionnaire Q&A verification ──────────────────────────────────
    // For every condition that has a questionnaire: compare what this
    // automation actually clicked/typed against what the submit_questionnaire
    // API call really sent to the server — the ground truth, not a scrape of
    // a review screen (most conditions don't have one).
    if (questionnaireSubmissions.length > 0 || questionnaire.filledAnswers.length > 0) {
      if (process.env.DEBUG_QUESTIONS === "1") {
        console.log(`[DEBUG_QUESTIONS] filledAnswers: ${JSON.stringify(questionnaire.filledAnswers)}`);
      }
      // Some questionnaires (e.g. "All Test Question") include a file
      // upload — when a request body contains a File/Blob, Chromium's
      // DevTools Protocol does not retain the raw POST data for ANY
      // inspection API (request.postData()/postDataBuffer() both return
      // null), so the server's actual submission is unrecoverable. Rather
      // than silently show nothing, still report what we filled — every
      // question type (date, range, checkbox, select, file, etc. — see the
      // recordAnswer() calls throughout QuestionnairePage) — with the
      // "submitted" side marked unverified instead of a false mismatch.
      const comparison =
        questionnaireSubmissions.length > 0
          ? buildQaComparison(questionnaire.filledAnswers, questionnaireSubmissions)
          : (() => {
              const deduped = dedupeFilledAnswers(questionnaire.filledAnswers);
              return {
                totalFilled: deduped.length,
                totalSubmitted: 0,
                matchedCount: 0,
                mismatches: [],
                rows: deduped.map((f) => ({
                  question: f.question,
                  filledAnswer: f.answer,
                  submittedAnswer: null as string | null,
                  matched: false,
                  unverified: true,
                })),
              };
            })();
      // Always emitted — dashboard.js parses this tag into a real HTML
      // table (renderQaTable) and does NOT forward the raw line itself.
      console.log(`📋 QA_COMPARISON: ${JSON.stringify(comparison)}`);

      // The dashboard renders its own table from the line above; this
      // ASCII-art version is redundant there (would show twice) and is only
      // useful for plain `npx playwright test` runs with no dashboard.
      if (!process.env.RUN_VIA_DASHBOARD) {
        const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
        const summaryLine = `Filled       Submitted       Matched`;
        const summaryValues = `  ${comparison.totalFilled}              ${comparison.totalSubmitted}             ${comparison.matchedCount}/${comparison.totalSubmitted}`;

        console.log("");
        console.log("Questionnaire Answer Verification");
        console.log("");
        console.log("┌─────────────────────────────────────────────┐");
        console.log(`│ ${summaryLine}        │`);
        console.log(`│${summaryValues}          │`);
        console.log("└─────────────────────────────────────────────┘");
        console.log("");
        console.log("Question | Filled Answer | Submitted Answer | Status");
        console.log("------------------------------------------------------");
        comparison.rows.forEach((row: any, i) => {
          const status = row.unverified ? "UNVERIFIED" : row.matched ? "MATCH" : "MISMATCH";
          console.log(
            `Q${i + 1}       | ${truncate(row.filledAnswer ?? "(no match)", 30)} | ${truncate(row.submittedAnswer ?? "(unavailable)", 30)} | ${status}`,
          );
        });

        if (comparison.mismatches.length > 0) {
          console.log("");
          console.log("Mismatch Details");
          for (const row of comparison.mismatches) {
            console.log("");
            console.log(`Question: ${truncate(row.question, 200)}`);
            console.log("");
            console.log(`Filled:`);
            console.log(row.filledAnswer ?? "(no matching filled answer found)");
            console.log("");
            console.log(`Submitted:`);
            console.log(row.submittedAnswer);
            console.log("");
            console.log(`Status: ❌ MISMATCH`);
            console.log(
              `Reason: ${row.filledAnswer === null ? "No corresponding filled answer could be matched to this question" : "Answers are different"}`,
            );
          }
        }
      }
    }

    // ─── Final assertion ──────────────────────────────────────────────────
    await test.step("Verify journey completion", async () => {
      if (requestedOutcomeId) {
        // Outcome-specific run: success means landing on the SELECTED
        // outcome screen, not just "did a booking complete" — a rejection
        // outcome (NHS 111 / GP Referral / Immediate Action) never reaches
        // a booking confirmation, so the default isConfirmed check below
        // would always fail these on purpose. Skip it entirely here.
        // Prefer the outcome QuestionnairePage captured live (at the moment
        // the screen was actually visible) over a fresh page re-scan here —
        // by this point the dialog may already be dismissed for tidiness
        // (see handleNHS111Popup), so a live re-scan alone would find the
        // page already moved on and wrongly report "Unknown".
        const detected =
          questionnaire.reachedOutcome ??
          (await detectOutcomeScreen(page, activeSlugForOutcome));
        const expectedLabel = requestedOutcome?.label ?? requestedOutcomeId;
        const actualLabel = detected?.label ?? "Unknown";
        const passed = !!detected && detected.id === requestedOutcomeId;

        console.log(
          `🎯 OUTCOME_RESULT: ${JSON.stringify({
            condition: activeSlugForOutcome,
            userType: resolvedUserType,
            expected: expectedLabel,
            actual: actualLabel,
            passed,
          })}`,
        );
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("Outcome Test");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`Condition: ${activeSlugForOutcome}`);
        console.log(`User: ${resolvedUserType === "pds" ? "PDS" : "Non-PDS"}`);
        console.log(`Expected Outcome: ${expectedLabel}`);
        console.log(`Actual Outcome: ${actualLabel}`);
        console.log(
          passed
            ? "✅ TEST PASSED"
            : `❌ TEST FAILED — Expected ${expectedLabel} but ${actualLabel} was displayed.`,
        );
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");

        expect(
          passed,
          `Expected outcome "${expectedLabel}" but detected "${actualLabel}"`,
        ).toBe(true);
        return;
      }

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

      // ROOT CAUSE (test showed "COMPLETED SUCCESSFUL" / all assertions
      // passed, yet the run still reported "1 failed"): this explicit
      // page.close() raced with Playwright's own trace.zip export, which
      // happens as part of the fixture's normal end-of-test teardown —
      // closing the page early here left trace.zip missing by the time the
      // reporter tried to attach it, and a failed attachment is reported as
      // a failed test regardless of the test's own assertions. Removed —
      // the fixture already closes the page after the test function
      // returns, in the correct order (trace saved first).
    });
  });
});
