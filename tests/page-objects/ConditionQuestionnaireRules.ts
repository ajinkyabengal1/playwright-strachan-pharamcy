export type ConditionQuestionRule = {
  questionPattern: RegExp;
  answerText: string;
  control: "radio" | "checkbox" | "input" | "textarea" | "date";
};

// NOTE: Kepple Lane's "shingles-herpes-zoster-nhs" actually renders TWO
// different questionnaires depending on signup outcome, confirmed live:
//   - PDS-matched signup → the 3-question radio flow (rules further below)
//   - non-PDS/private signup → THIS checkbox-based flow (confirmed: these
//     two checkbox rules' question text matches exactly what renders on
//     that path — "Do you have any of below symptoms. Check all that
//     apply *" with a red-flag checklist, "None of the above" included)
// Both live in the same SHINGLES_RULES array since a rule simply never
// matches on whichever flow it doesn't apply to — harmless no-op either way.
export const SHINGLES_RULES: ConditionQuestionRule[] = [
  {
    questionPattern:
      /Do you have any of below symptoms\. Check all that apply/i,
    answerText: "None of the above",
    control: "checkbox",
  },
  {
    questionPattern: /Please check all that apply to you\./i,
    answerText:
      "Presentation >7 days after rash onset (outside antiviral treatment window)",
    control: "checkbox",
  },
  {
    // ROOT CAUSE FIX (investigation confirmed live on Kepple Lane):
    // "I do not have these symptoms" — the ORIGINAL answer here — is NOT
    // the safe/pass-through path; it's the actual trigger for the
    // "Result: NHS 111" screen ("it may not be shingles"). That screen was
    // always being silently bypassed by handleNHS111Popup() clicking
    // "Book private consultation", which is why every prior run appeared
    // to reach Gateway/booking regardless of this answer. The real
    // Gateway/booking path requires confirming you DO have the symptoms.
    questionPattern: /Do you have these symptoms\?/i,
    answerText: "I do have these symptoms",
    control: "radio",
  },
  {
    // Q2 on Kepple Lane: urgent-care red-flag check (severe pain, vision
    // changes, weakness/numbness, confusion, rapidly spreading rash,
    // pregnancy, etc). No red flags → stays on the Gateway/booking path.
    questionPattern: /signs that you might need more urgent care/i,
    answerText: "I do not have any of these symptoms",
    control: "radio",
  },
  {
    // Q3 on Kepple Lane: confirms symptoms actually match typical shingles
    // progression. Matches → Gateway/booking; doesn't match → uncertain
    // diagnosis (routed elsewhere — see OUTCOME_RULES below).
    questionPattern: /confirm what level of treatment you need/i,
    answerText: "I do have some of these symptoms",
    control: "radio",
  },
];

export const WEIGHT_MANAGEMENT_RULES: ConditionQuestionRule[] = [
  {
    questionPattern:
      /Do you take any medications currently, including over-the-counter, supplements, herbal remedies\?/i,
    answerText: "No",
    control: "radio",
  },
  {
    questionPattern:
      /Do you currently have any of these symptoms\? \(Select all that apply\)/i,
    answerText: "None of the above",
    control: "checkbox",
  },
  {
    questionPattern:
      /Have you experienced any of these since your last dose\? \(Select all that apply\)/i,
    answerText: "Have you had any signs or diagnoses of pancreatitis?",
    control: "checkbox",
  },
  {
    questionPattern:
      /Have you ever made yourself sick because you felt uncomfortably full\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /In the past 6 months, have you lost control over how much you eat\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /lost more than one stone.*6\.3kg.*three-month period/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Do you frequently restrict eating to influence your shape or weight\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Do you feel food dominates your life\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Have friends or family expressed concerns about your eating patterns\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Do you currently engage in binge eating episodes\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Do you have any of these.*conditions.*Tick all that apply/i,
    answerText: "History of pancreatitis",
    control: "checkbox",
  },
  {
    questionPattern: /Date of the last thyroid function test.*applicable/i,
    answerText: "01-01-2026",
    control: "date",
  },
  {
    questionPattern: /Current HbA1c.*if diabetic/i,
    answerText: "5.4",
    control: "input",
  },
  {
    questionPattern: /Blood pressure reading today.*mmHg/i,
    answerText: "120/80",
    control: "input",
  },
  {
    questionPattern:
      /Would you describe your weight gain as gradual over time or sudden\?/i,
    answerText: "Gradual",
    control: "radio",
  },
  {
    questionPattern: /How long have you been trying to manage your weight\?/i,
    answerText: "12",
    control: "input",
  },
  {
    questionPattern:
      /How much does your weight affect your daily life or well-being\?/i,
    answerText: "7",
    control: "input",
  },
  {
    questionPattern:
      /Have you ever taken any medications to help manage your weight\?/i,
    answerText: "No",
    control: "radio",
  },
  {
    questionPattern:
      /Have you attempted any of the following.*select all that apply/i,
    answerText: "Exercise program",
    control: "checkbox",
  },
  {
    questionPattern: /How do you feel about making lifestyle changes\?/i,
    answerText: "Positive and motivated",
    control: "radio",
  },
  {
    questionPattern: /Have friends\/family offered support\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Do you feel lifestyle changes alone could help\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Risk Level assessment:/i,
    answerText: "Low Risk (0-1 red flags, BMI 30-35)",
    control: "radio",
  },
  {
    questionPattern: /Realistic weight loss expectations discussed:/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Timeline for review appointment set:/i,
    answerText: "2 Weeks",
    control: "radio",
  },
];

export const ERECTILE_DYSFUNCTION_RULES: ConditionQuestionRule[] = [
  {
    questionPattern: /Do you have difficulty getting or keeping an erection\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Have you seen a nurse, doctor or a specialist about your erectile dysfunction\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Has a doctor or medical professional ever advised you to avoid strenuous exercise\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Have you ever had to stop exercise.*felt chest pain.*breathless.*dizzy.*clammy/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Do you ever experience dizziness or lightheadedness immediately after standing up/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Are you currently taking any other medication for erectile dysfunction\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Are your erections sometimes fine.*first thing in the morning.*watching pornography/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Are you currently experiencing any emotional or psychological problems.*stress or anxiety/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /When ordering MUSE or CAVERJECT.*Have you tried tablets already\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Have you ever been shown how to use the medication you are ordering\?/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: /Do you have any physical abnormality of the penis/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Do you have any conditions which make it more likely for you to have prolonged erections/i,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern:
      /Is there anything else that you would like to mention to our doctors/i,
    answerText: "no",
    control: "input",
  },
  {
    questionPattern:
      /Erectile dysfunction treatments can cause a fatal interactions with medicines from the 'Nitrate' family/i,
    answerText: "Please check",
    control: "checkbox",
  },
];

/**
 * Outcome-specific answer sets, keyed by real Sanity conditionSlug then by
 * outcome id (matches tests/fixtures/outcome-config.ts). Only the questions
 * that DIFFER from the default/gateway path need an entry — everything else
 * still falls through to the generic fallback in QuestionnairePage.
 *
 * "gateway" reuses the existing default rules (the pass-through path already
 * authored above, confirmed live on Kepple Lane: Q1 "I do have these
 * symptoms" → Q2 "I do not have any of these symptoms" (no red flags) → Q3
 * "I do have some of these symptoms" (matches typical shingles) → booking).
 *
 * nhs111 / gp_referral / self_care below flip exactly ONE of the three
 * Gateway questions each — CONFIRMED live except where marked TODO.
 */
const SHINGLES_Q1_URGENT_CARE = /signs that you might need more urgent care/i;
const SHINGLES_Q2_TYPICAL_PROGRESSION = /confirm what level of treatment you need/i;

export const SHINGLES_RULES_NHS111: ConditionQuestionRule[] = [
  {
    // Answering "no" to the very first question ("Do you have these
    // symptoms?") is itself the NHS 111 trigger — confirmed live: the
    // "Result: NHS 111" screen appears immediately, before Q2/Q3 are ever
    // shown.
    questionPattern: /Do you have these symptoms\?/i,
    answerText: "I do not have these symptoms",
    control: "radio",
  },
];

/**
 * CONFIRMED live (2 different runs, both converge to the same "Self Care"
 * result screen — "It's unlikely that your rash is Shingles and you
 * shouldn't need antibiotics"):
 *   - a red-flag answer at the urgent-care question, OR
 *   - a "doesn't match typical shingles progression" answer at Q3
 * Either alone is enough; SHINGLES_RULES_SELF_CARE below uses the Q3 route
 * (fewer questions to override). No DISTINCT "GP Referral" screen was found
 * reachable through the PDS-flow's 3 radio questions specifically — both
 * rejection paths there land on Self Care. A real, separate "GP referal"
 * screen DOES exist, but on the checkbox-based non-PDS flow instead — see
 * SHINGLES_RULES_GP_REFERRAL_CHECKBOX below.
 */
export const SHINGLES_RULES_SELF_CARE: ConditionQuestionRule[] = [
  {
    questionPattern: /Do you have these symptoms\?/i,
    answerText: "I do have these symptoms",
    control: "radio",
  },
  {
    questionPattern: SHINGLES_Q1_URGENT_CARE,
    answerText: "I do not have any of these symptoms",
    control: "radio",
  },
  {
    questionPattern: SHINGLES_Q2_TYPICAL_PROGRESSION,
    answerText: "I do not have these symptoms",
    control: "radio",
  },
];

/**
 * CONFIRMED live (checkbox-based, non-PDS flow, at the time this was
 * written): no red flags at Q1 + "outside antiviral treatment window" at Q2
 * → the site's own "GP referal" result screen (their spelling — one L):
 * "We're sorry, but you do not meet the criteria for this service. Please
 * contact your GP for further advice and support."
 *
 * CURRENTLY UNREACHABLE (confirmed live, this session): every identity
 * tested now renders the RADIO-based flow instead (see SHINGLES_RULES_*'s
 * own comments) -- these checkbox rules are a harmless no-op on it. That
 * flow's Q1/Q2/Q3 are each binary, and exhaustively checking every
 * combination accounts for exactly 4 outcomes (NHS111 / Self Care / Gateway
 * / Emergency ["Emergency Action Needed Now", this flow's Immediate
 * Action]) with nothing left over for a distinct GP Referral screen. This
 * rule set is kept, unmodified, in case the checkbox flow is ever restored
 * for some identity -- but gp_referral is not currently a reachable outcome
 * on Kepple Lane's Shingles condition, and outcome-config.ts's own entry
 * for it is flagged accordingly.
 */
export const SHINGLES_RULES_GP_REFERRAL_CHECKBOX: ConditionQuestionRule[] = [
  {
    questionPattern:
      /Do you have any of below symptoms\. Check all that apply/i,
    answerText: "None of the above",
    control: "checkbox",
  },
  {
    questionPattern: /Please check all that apply to you\./i,
    answerText:
      "Presentation >7 days after rash onset (outside antiviral treatment window)",
    control: "checkbox",
  },
];

export const SHINGLES_RULES_IMMEDIATE_ACTION: ConditionQuestionRule[] = [
  {
    // CONFIRMED live (user-provided screenshots): this specific red-flag
    // item → "Immediate Actions Required" ("You do not meet the criteria
    // for this service. Please contact NHS 111 for further advice and
    // support."), with only "End assessment" — no "Book Private
    // Consultation" option, unlike GP Referral's screen. NOT every red-flag
    // item routes here — "Suspected meningitis or encephalitis" (tried
    // first) routes to GP Referral instead; the two aren't interchangeable.
    questionPattern:
      /Do you have any of below symptoms\. Check all that apply/i,
    answerText:
      "Eye involvement (ophthalmic zoster) - rash on tip of nose or around eye",
    control: "checkbox",
  },
  // CONFIRMED LIVE (radio variant, via the submit_questionnaire API
  // response itself): the site is currently rendering the RADIO-based flow
  // (not the checkbox one above) for every identity tested this session --
  // the checkbox rule above never matches, so it's a harmless no-op on the
  // current flow. Answering "yes" at the urgent-care red-flag question (Q2)
  // reaches this exact template: "id":1032,"name":"3.0 Shingles - A&E -
  // Prod", title "Emergency Action Needed Now", color #C52528 -- the
  // current flow's equivalent of the old checkbox screen above (also
  // confirmed via exhaustive case analysis: Q1/Q2/Q3 are each binary, and
  // Q1=No/Q1+Q2=No+Q3=No/Q1+Q2=No+Q3=Yes/Q1+Q2=Yes are the only 4 reachable
  // buckets -- covering NHS111/Self Care/Gateway/this one respectively,
  // with NO combination left over for a distinct "GP Referral" screen on
  // this flow -- see SHINGLES_RULES_GP_REFERRAL_CHECKBOX's own comment).
  {
    questionPattern: /Do you have these symptoms\?/i,
    answerText: "I do have these symptoms",
    control: "radio",
  },
  {
    questionPattern: SHINGLES_Q1_URGENT_CARE,
    answerText: "I do have one or more of these symptoms",
    control: "radio",
  },
];

/**
 * CONFIRMED live on Kepple Lane -- these override ONLY the 4 eating-disorder
 * screening radio questions; everything else on this condition (medication,
 * diabetes, pregnancy, height/weight/waist, etc.) is left to the generic
 * fallback, which already reaches the safe/Gateway path correctly on its
 * own (confirmed: a full run answering these 4 "No" via generic fallback
 * reached normal booking success -- see condition-flow.spec.ts's Q&A
 * verification table from that run).
 *
 * NOTE: the old WEIGHT_MANAGEMENT_RULES array above does NOT match this
 * tenant's real question wording at all (e.g. its "Have you ever made
 * yourself sick because you felt uncomfortably full?" vs this tenant's
 * actual "Do you make yourself Sick because you feel uncomfortably full?")
 * -- it was written for a different tenant's version of this condition.
 */
const WEIGHT_MGMT_Q_MAKE_SICK = /make yourself\s+sick because you feel uncomfortably full/i;
const WEIGHT_MGMT_Q_LOST_CONTROL = /lost control over how much you eat/i;
const WEIGHT_MGMT_Q_LOST_WEIGHT_FAST = /lost more than one stone.*3-month period/i;
const WEIGHT_MGMT_Q_BELIEVE_OVERWEIGHT = /believe yourself to be overweight when others say you are too thin/i;
// ROOT CAUSE (confirmed via submit_questionnaire API response): this is the
// gate question for the separate "Eating Disorder Assessment" questionnaire
// template. The make-yourself-sick/lost-control/etc questions above are
// children with conditional_text_values: ["Yes"] on THIS question -- they
// never render at all unless this is answered "Yes" first. The generic
// fallback was defaulting it to "No", which skipped the entire eating
// disorder branch and made the GP Referral rules above unreachable.
const WEIGHT_MGMT_Q_CONTINUE_EATING_ASSESSMENT =
  /would you like to continue with this assessment/i;

export const WEIGHT_MANAGEMENT_RULES_GATEWAY: ConditionQuestionRule[] = [
  { questionPattern: WEIGHT_MGMT_Q_MAKE_SICK, answerText: "No", control: "radio" },
  { questionPattern: WEIGHT_MGMT_Q_LOST_CONTROL, answerText: "No", control: "radio" },
  { questionPattern: WEIGHT_MGMT_Q_LOST_WEIGHT_FAST, answerText: "No", control: "radio" },
  { questionPattern: WEIGHT_MGMT_Q_BELIEVE_OVERWEIGHT, answerText: "No", control: "radio" },
];

/**
 * CONFIRMED directly from the submit_questionnaire API response itself
 * (not just observed behavior) -- the response's own question_validation
 * for this exact question includes:
 *   option_title: "Yes", is_blocker: true,
 *   information_message: "\u26d4 Clinical Alert: Suspected eating disorder
 *   behaviour - do not proceed under PGD and refer for further clinical
 *   assessment."
 * That is the server's own authoritative trigger for GP Referral -- no
 * outcome-screen text scrape needed to trust this one.
 */
export const WEIGHT_MANAGEMENT_RULES_GP_REFERRAL: ConditionQuestionRule[] = [
  {
    questionPattern: WEIGHT_MGMT_Q_CONTINUE_EATING_ASSESSMENT,
    answerText: "Yes",
    control: "radio",
  },
  {
    questionPattern: WEIGHT_MGMT_Q_MAKE_SICK,
    answerText: "Yes",
    control: "radio",
  },
  { questionPattern: WEIGHT_MGMT_Q_LOST_CONTROL, answerText: "No", control: "radio" },
  { questionPattern: WEIGHT_MGMT_Q_LOST_WEIGHT_FAST, answerText: "No", control: "radio" },
  { questionPattern: WEIGHT_MGMT_Q_BELIEVE_OVERWEIGHT, answerText: "No", control: "radio" },
];

/**
 * Cholera Vaccination R (Kepple Lane, slug cholera-vaccination-r-nhs),
 * added per explicit request: "if you select No in Q2 then it will go to
 * immediate action, and normal answer will take you to GP Referral" --
 * confirmed live (DEBUG_QUESTIONS dump) the real Q2 wording and full
 * question set are:
 *   Q1 Are you well today?
 *   Q2 Are you travelling to, living in, or at risk of exposure to cholera?
 *   Q3 Is this vaccination required solely for occupational purposes?
 *   Q4 Have you previously received Dukoral (Cholera vaccine)?
 *   Q5 Do you have any allergies (including vaccine reactions)?
 *   Q6 Are you currently pregnant or breastfeeding? (Pregnant/Breastfeeding/No)
 *   Q7 Do you have any medical conditions affecting your immune system or
 *      overall health? (Yes reveals a conditional "Search and select
 *      conditions" sub-field -- kept "No" here so neither rule set has to
 *      also drive that separate ant-select)
 *   Q9 Do you follow a strict low-sodium diet or have a condition
 *      requiring sodium restriction?
 * Q2 is the only question that differs between the two rule sets below --
 * everything else is pinned to a safe "No" (or "Yes" for Q1) so it can't
 * accidentally trigger some OTHER exclusion and confuse which answer
 * actually produced the outcome screen.
 */
const CHOLERA_Q_WELL_TODAY = /well today/i;
const CHOLERA_Q_TRAVEL_RISK =
  /travelling to, living in, or at risk of exposure to cholera/i;
const CHOLERA_Q_OCCUPATIONAL = /required solely for occupational purposes/i;
const CHOLERA_Q_PRIOR_DUKORAL = /previously received Dukoral/i;
const CHOLERA_Q_ALLERGIES = /any allergies.*vaccine reactions/i;
const CHOLERA_Q_PREGNANT = /pregnant or breastfeeding/i;
const CHOLERA_Q_IMMUNE_CONDITIONS =
  /medical conditions affecting your immune system/i;
const CHOLERA_Q_LOW_SODIUM = /strict low-sodium diet/i;

const CHOLERA_RULES_COMMON: ConditionQuestionRule[] = [
  { questionPattern: CHOLERA_Q_WELL_TODAY, answerText: "Yes", control: "radio" },
  { questionPattern: CHOLERA_Q_OCCUPATIONAL, answerText: "No", control: "radio" },
  { questionPattern: CHOLERA_Q_PRIOR_DUKORAL, answerText: "No", control: "radio" },
  { questionPattern: CHOLERA_Q_ALLERGIES, answerText: "No", control: "radio" },
  { questionPattern: CHOLERA_Q_PREGNANT, answerText: "No", control: "radio" },
  { questionPattern: CHOLERA_Q_IMMUNE_CONDITIONS, answerText: "No", control: "radio" },
  { questionPattern: CHOLERA_Q_LOW_SODIUM, answerText: "No", control: "radio" },
];

/**
 * ROOT CAUSE (confirmed live via the submit_questionnaire API response
 * itself -- not a guess): this template's ENTIRE outcome is one formula,
 * "Q3+Q4" (the site's own fe_id labels for CHOLERA_Q_TRAVEL_RISK and
 * CHOLERA_Q_OCCUPATIONAL respectively) -- No on travel-risk scores 11,
 * Yes on occupational-only scores 11, everything else scores 1; 0-10 =
 * "Patient qualified" (proceeds straight to booking), 11-200 = "Paitnet
 * doesn't qualified" [sic, site's own typo]. No OTHER question (allergies,
 * pregnancy, immune conditions, low-sodium diet) affects this outcome at
 * all, confirmed by testing an allergy=Yes flag on top of a qualifying
 * answer and still reaching booking success.
 *
 * CONFIRMED LIVE: there is only ONE rejection screen ("Result / Paitnet
 * doesn't qualified / A pharmacist will review your answers and advise on
 * the next step. / End assessment"). occupational-only=Yes lands on this
 * same screen too (same formula, same 11+ score), but that's not exposed
 * as its own outcome id here -- see outcome-config.ts's comment on why a
 * "gp_referral" entry with an identical detectPattern isn't safe to add.
 */
export const CHOLERA_RULES_IMMEDIATE_ACTION: ConditionQuestionRule[] = [
  { questionPattern: CHOLERA_Q_TRAVEL_RISK, answerText: "No", control: "radio" },
  ...CHOLERA_RULES_COMMON,
];

export const OUTCOME_RULES: Record<string, Record<string, ConditionQuestionRule[]>> = {
  "shingles-herpes-zoster-nhs": {
    gateway: SHINGLES_RULES,
    nhs111: SHINGLES_RULES_NHS111,
    self_care: SHINGLES_RULES_SELF_CARE,
    gp_referral: SHINGLES_RULES_GP_REFERRAL_CHECKBOX,
    immediate_action: SHINGLES_RULES_IMMEDIATE_ACTION,
  },
  "weight-management-private": {
    gateway: WEIGHT_MANAGEMENT_RULES_GATEWAY,
    gp_referral: WEIGHT_MANAGEMENT_RULES_GP_REFERRAL,
  },
  "cholera-vaccination-r-nhs": {
    immediate_action: CHOLERA_RULES_IMMEDIATE_ACTION,
  },
};
