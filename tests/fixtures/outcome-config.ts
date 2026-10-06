/**
 * Central catalog driving outcome-specific testing (dashboard sidebar +
 * condition-flow.spec.ts assertions). One condition can have several
 * possible outcome screens depending on questionnaire answers AND on
 * whether the signup identity resolves to a real NHS/PDS record.
 *
 * NOTE ON detectPatterns: these are best-guess phrasing until each outcome
 * is confirmed live against the real site (see condition-flow.spec.ts's
 * PDS_USER_MODE / OUTCOME_ID investigation flags). Tighten/correct them
 * once a real run confirms the actual on-screen text for each outcome.
 */

export type UserType = "pds" | "non_pds";
export type GatewayType = "nhs" | "private";

export interface OutcomeDefinition {
  /** Stable id — passed as OUTCOME_ID env var, matched in ConditionQuestionnaireRules.ts's OUTCOME_RULES. */
  id: string;
  /** Human label — shown in the dashboard sidebar and Output panel. */
  label: string;
  /** Which signup identity this outcome requires to even be reachable. */
  userType: UserType;
  /** Matched against the final screen's visible text to confirm which outcome actually rendered. */
  detectPatterns: RegExp[];
}

export interface ConditionOutcomeConfig {
  /** Real Sanity conditionSlug (or a distinguishing substring of it). */
  slug: string;
  gateway: GatewayType;
  outcomes: OutcomeDefinition[];
}

export const CONDITION_OUTCOMES: ConditionOutcomeConfig[] = [
  {
    slug: "shingles-herpes-zoster-nhs",
    gateway: "nhs",
    outcomes: [
      {
        id: "gateway",
        label: "Booking (Gateway)",
        userType: "pds",
        detectPatterns: [
          /select.*(slot|date|time)/i,
          /book\s+(your\s+)?appointment/i,
          /booking\s+confirmed/i,
          /thank\s*you/i,
        ],
      },
      {
        // CONFIRMED live on Kepple Lane. NOTE: the original /call\s*111/i
        // pattern was removed — it's the site's generic safety-net "Call
        // 111" button, present on unrelated screens too, and caused a false
        // match against the Self Care screen below.
        id: "nhs111",
        label: "NHS 111",
        userType: "pds",
        detectPatterns: [/result[\s\S]{0,15}nhs\s*111/i],
      },
      {
        // CONFIRMED live on Kepple Lane (exact text: "It's unlikely that
        // your rash is Shingles and you shouldn't need antibiotics" / "A
        // pharmacist will review your answers and advise on the next
        // step."). The original /end\s+assessment/i pattern was removed —
        // that button is present on every result screen (NHS 111 included),
        // so it matched everything.
        id: "self_care",
        label: "Self Care",
        userType: "pds",
        detectPatterns: [
          /unlikely that your rash is shingles/i,
          /shouldn'?t need antibiotics/i,
        ],
      },
      {
        // CONFIRMED live — but only on the checkbox-based NON-PDS flow, not
        // the 3-question PDS/radio flow (see SHINGLES_RULES_SELF_CARE's
        // comment in ConditionQuestionnaireRules.ts). Site's own exact
        // spelling is "GP referal" (one L) — text: "We're sorry, but you do
        // not meet the criteria for this service. Please contact your GP
        // for further advice and support."
        //
        // ROOT CAUSE FIX: the generic /do not meet the criteria for this
        // service/i line was removed — it's shared boilerplate that ALSO
        // appears on the Immediate Action screen below ("...contact NHS 111
        // for further advice and support"), and since this outcome is
        // checked first in the array, it always won that ambiguous match —
        // a real Immediate Action run was being misreported as GP Referral.
        // Keep only the heading text, which is unique to this screen.
        //
        // CURRENTLY UNREACHABLE (confirmed live -- see
        // SHINGLES_RULES_GP_REFERRAL_CHECKBOX's own comment in
        // ConditionQuestionnaireRules.ts): every identity renders the
        // radio-based flow now, not the checkbox one this screen needs,
        // and that flow's 3 binary questions are exhaustively accounted
        // for by NHS111/Self Care/Gateway/Immediate Action with nothing
        // left for this one. Kept (not deleted) in case the checkbox flow
        // is ever restored. Running OUTCOME_ID=gp_referral right now will
        // fail -- that's expected and accurate, not a bug to chase.
        id: "gp_referral",
        label: "GP Referral",
        userType: "non_pds",
        detectPatterns: [/gp\s*referr?al/i],
      },
      {
        // Two CONFIRMED-live variants, kept together since the site
        // appears to have switched flows at some point (see ROOT CAUSE
        // comment on SHINGLES_RULES_IMMEDIATE_ACTION in
        // ConditionQuestionnaireRules.ts for the radio-flow trigger):
        // - OLDER checkbox-flow screenshot: heading "Immediate Actions
        //   Required" — "...do not meet the criteria for this service.
        //   Please contact NHS 111 for further advice and support."
        // - CURRENT radio-flow (confirmed live via the submit_questionnaire
        //   API response, template "3.0 Shingles - A&E - Prod", color
        //   #C52528): title "Emergency Action Needed Now" — "...seek urgent
        //   medical attention...go to the nearest Accident and Emergency
        //   (A&E) department as soon as possible."
        // Note the old screen ALSO mentions "NHS 111" in its body text,
        // same as the true NHS 111 result — the nhs111 pattern's tight
        // "Result within 15 chars of NHS 111" requirement is what keeps
        // the two from colliding there. The original /seek\s+urgent/i and
        // /call\s*999/i patterns were removed earlier — they matched the
        // site's generic "Safety-netting" boilerplate present on every
        // condition's page; /emergency action needed now/i is specific to
        // this one screen instead.
        id: "immediate_action",
        label: "Immediate Action",
        userType: "non_pds",
        detectPatterns: [
          /immediate\s+actions?\s+required/i,
          /emergency action needed now/i,
        ],
      },
    ],
  },
  // Weight Management outcome-testing entry removed per earlier explicit
  // request -- only Shingles and (re-added below) Cholera Vaccination have
  // one now.
  {
    // Condition ID-478 per request. Q2 ("Are you travelling to, living in,
    // or at risk of exposure to cholera?") is the deciding question -- see
    // CHOLERA_RULES_GP_REFERRAL/IMMEDIATE_ACTION in
    // ConditionQuestionnaireRules.ts for the full answer set and why.
    // detectPatterns below are placeholders pending live confirmation
    // (matching this file's own convention elsewhere) -- update once each
    // outcome's real on-screen text is confirmed.
    slug: "cholera-vaccination-r-nhs",
    gateway: "nhs",
    // CONFIRMED LIVE via the submit_questionnaire API response (this
    // template's entire outcome is one "Q3+Q4" formula -- see
    // ConditionQuestionnaireRules.ts's CHOLERA_RULES doc comment) AND via
    // the actual rendered screen text: travel-risk=No and
    // occupational-only=Yes both land on the exact same single rejection
    // screen ("Result / Paitnet doesn't qualified [site's own typo] / A
    // pharmacist will review your answers and advise on the next step.").
    // There is no separate "GP Referral" screen distinct from "Immediate
    // Action" for this condition -- only ONE outcome is listed here
    // (kept as "immediate_action" per the original request, since that
    // was the specific No-on-Q2 trigger asked for). A "gp_referral" entry
    // is deliberately NOT added: with an identical detectPattern it would
    // always win the array-order match regardless of which outcome was
    // actually requested, silently breaking assertions for whichever id
    // wasn't listed first -- a real screen for it would need its own
    // distinct on-screen text before it can be added safely.
    outcomes: [
      {
        id: "immediate_action",
        label: "Immediate Action",
        userType: "non_pds",
        detectPatterns: [/doesn'?t\s+qualified/i, /pharmacist will review your answers/i],
      },
    ],
  },
  {
    // Kepple Lane, real slug "weight-management-weight-loss-treatment-
    // private" -- a DIFFERENT condition from "weight-management-private"
    // (see ConditionQuestionnaireRules.ts's own comment on
    // WEIGHT_MANAGEMENT_WLT_RULES_SELF_CARE). Q1 ("Do you take any
    // medications currently...") is the deciding question -- "No" is
    // CONFIRMED LIVE via the submit_questionnaire API response to score
    // this template's entire formula to {title:"Not qualified",
    // pre_consult_outcome:"SelfCare"}.
    //
    // ROOT CAUSE (confirmed live, checked directly in the API response):
    // this formula bucket's own "block_appointment_booking" field is null,
    // not true -- the backend tags the submission "SelfCare" for clinician
    // review but does NOT instruct the frontend to block the booking flow,
    // which is exactly why the journey continues straight through to
    // patient-info/NHS-check/booking regardless of this answer, with no
    // distinct on-screen block to detect. detectPatterns below are a
    // best-guess placeholder (API title text) pending a real screen to
    // match -- but per this field, there currently ISN'T one: re-verify
    // "block_appointment_booking":true appears on this bucket in a fresh
    // API response before trusting that a Self Care screen will actually
    // show.
    slug: "weight-management-weight-loss-treatment-private",
    gateway: "private",
    outcomes: [
      {
        id: "self_care",
        label: "Self Care",
        userType: "non_pds",
        detectPatterns: [/not\s+qualified/i],
      },
      // Disabled per explicit request (kept for reference — CONFIRMED LIVE
      // via the submit_questionnaire API response, 2nd questionnaire,
      // template id 1255: Q2 "None of the above" scores this template's
      // "Q1+Q2" formula to {title:"Sorry, see your usual GP",
      // pre_consult_outcome:"GP Referral"} — see
      // ConditionQuestionnaireRules.ts's own disabled
      // WEIGHT_MANAGEMENT_WLT_RULES_GP_REFERRAL comment. Same root cause as
      // self_care above: this bucket's "block_appointment_booking" field is
      // ALSO null, not true.
      // {
      //   id: "gp_referral",
      //   label: "GP Referral",
      //   userType: "non_pds",
      //   detectPatterns: [/sorry,?\s*see your usual gp/i],
      // },
    ],
  },
];

export function getOutcomeConfig(slug: string): ConditionOutcomeConfig | undefined {
  if (!slug) return undefined;
  const lower = slug.toLowerCase();
  return CONDITION_OUTCOMES.find(
    (c) => lower.includes(c.slug) || c.slug.includes(lower),
  );
}

export function getOutcome(
  slug: string,
  outcomeId: string,
): OutcomeDefinition | undefined {
  return getOutcomeConfig(slug)?.outcomes.find((o) => o.id === outcomeId);
}
