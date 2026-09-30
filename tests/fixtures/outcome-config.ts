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
        id: "gp_referral",
        label: "GP Referral",
        userType: "non_pds",
        detectPatterns: [/gp\s*referr?al/i],
      },
      {
        // CONFIRMED live (user-provided screenshot): exact heading text is
        // "Immediate Actions Required" — "We're sorry, but you do not meet
        // the criteria for this service. Please contact NHS 111 for
        // further advice and support." Note this screen ALSO mentions
        // "NHS 111" in its body text, same as the true NHS 111 result — the
        // nhs111 pattern's tight "Result within 15 chars of NHS 111"
        // requirement is what keeps the two from colliding (the "Result"
        // tab label here is nowhere near "NHS 111" in this text). The
        // original /seek\s+urgent/i and /call\s*999/i patterns were removed
        // earlier — they matched the site's generic "Safety-netting"
        // boilerplate present on every condition's page.
        id: "immediate_action",
        label: "Immediate Action",
        userType: "non_pds",
        detectPatterns: [/immediate\s+actions?\s+required/i],
      },
    ],
  },
  // Weight Management and Cholera Vaccination outcome-testing entries
  // removed per explicit request -- the outcomes dropdown/icon no longer
  // shows for either condition (only Shingles has it now).
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
