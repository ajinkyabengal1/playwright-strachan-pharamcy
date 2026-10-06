export const TEST_USER = {
  gender: "female" as "male" | "female",
  dob: {
    day: "15",
    month: "04",
    year: "1962",
    /** ISO format used by Ant Design DatePicker */
    iso: "1962-04-15",
    /** Display format: DD/MM/YYYY */
    display: "15/04/1962",
  },
  firstName: "laila",
  lastName: "PEENEY",
  postcode: "HD59LT",
  genderValue: "male",
  email: "lloyd.p2@yopmail.com",
  guardianName: "Tonny stark",
  phone: "447467059973",
  password: "Test@1234",
  confirmPassword: "Test@1234",
};

/**
 * The seeded identity that DOES resolve to a real NHS/PDS record on this
 * tenant's mock backend (Kepple Lane confirmed).
 *
 * ponytail: every identity field here is a static literal, not spread from
 * TEST_USER, because the dashboard lets the user edit TEST_USER freely --
 * without pinning, an edit would silently break the PDS match the same way
 * it once did for firstName/dob (see commit 4a61ff7). guardianName/
 * password/confirmPassword aren't part of the PDS match, so those still
 * come from TEST_USER. If the Kepple Lane seed record ever changes, update
 * the literals here.
 */
export const TEST_USER_PDS = {
  ...TEST_USER,
  gender: "male" as "male" | "female",
  dob: {
    day: "15",
    month: "04",
    year: "1962",
    iso: "1962-04-15",
    display: "15/04/1962",
  },
  firstName: "Lloyd",
  lastName: "PEENEY",
  postcode: "HD59LT",
  genderValue: "male",
  email: "lloyd.p2@yopmail.com",
  phone: "447467059973",
};

/**
 * ROOT CAUSE FIX (confirmed live -- an "immediate_action"/"gp_referral" run
 * was rendering the PDS-matched radio-based questionnaire flow instead of
 * the non-PDS checkbox-based flow those outcomes' rules actually target):
 * TEST_USER_NON_PDS used to just be `TEST_USER` as-is, on the assumption
 * that TEST_USER's own firstName/dob.day didn't match the seeded PDS
 * record. At some point TEST_USER's own firstName/dob were edited to
 * "Lloyd"/"15/04/1962" -- the EXACT values TEST_USER_PDS above seeds as the
 * matching record -- so TEST_USER_NON_PDS silently became identical to
 * TEST_USER_PDS, and a "non_pds" run started resolving to a real NHS/PDS
 * record too. dob.day is derived from TEST_USER's own day (shifted by one,
 * wrapping at 28) instead of a hardcoded literal, so it always differs from
 * the PDS seed's day="15" no matter what the dashboard saves into
 * TEST_USER -- no magic number to fall out of sync again. firstName is
 * deliberately NOT overridden here (unlike TEST_USER_PDS, which must pin an
 * exact match), so editing the dashboard's User Info name actually reaches
 * non-PDS outcome runs.
 */
const NON_PDS_DOB_DAY = (() => {
  let n = (parseInt(TEST_USER.dob.day, 10) % 28) + 1;
  // Skip over the PDS seed's own day (see TEST_USER_PDS above) in the rare
  // case the +1 wrap lands exactly on it -- referenced directly, not
  // duplicated as a second "15" literal, so it can't drift out of sync.
  if (String(n).padStart(2, "0") === TEST_USER_PDS.dob.day) {
    n = (n % 28) + 1;
  }
  return String(n).padStart(2, "0");
})();

export const TEST_USER_NON_PDS = {
  ...TEST_USER,
  dob: {
    ...TEST_USER.dob,
    day: NON_PDS_DOB_DAY,
    iso: `${TEST_USER.dob.year}-${TEST_USER.dob.month}-${NON_PDS_DOB_DAY}`,
    display: `${NON_PDS_DOB_DAY}/${TEST_USER.dob.month}/${TEST_USER.dob.year}`,
  },
};

/**
 * "fill-all": fill every question, required or not (existing default behavior).
 * "required-only": skip questions without the "*" required marker, leave them blank.
 */
export type QuestionnaireFillMode = "fill-all" | "required-only";

export const QUESTIONNAIRE_FILL_MODE: QuestionnaireFillMode =
  (process.env.QUESTIONNAIRE_FILL_MODE as QuestionnaireFillMode) ||
  ("fill-all" as QuestionnaireFillMode);

/**
 * Which signup identity a direct (non-outcome-specific) test run uses —
 * "pds" resolves to a real NHS record (TEST_USER_PDS), "non_pds" doesn't
 * (TEST_USER_NON_PDS). An outcome-specific run (OUTCOME_ID set) ignores this
 * and uses whatever userType that outcome's own config requires instead.
 */
export type PdsUserMode = "pds" | "non_pds";

export const PDS_USER_MODE: PdsUserMode =
  (process.env.PDS_USER_MODE as PdsUserMode) || ("non_pds" as PdsUserMode);

export type ConditionJourneyType = "nhs" | "private" | "lifestyle";

export const CONDITION_CATALOG: Record<ConditionJourneyType, string> = {
  nhs: "shingles-herpes-zoster",
  private: "weight management",
  lifestyle: "erectile-dysfunction",
};

/**
 * On-demand condition selection:
 * Keep only one active line uncommented.
 */
export const ACTIVE_CONDITION = {
  journeyType: "nhs" as ConditionJourneyType,
  // journeyType: "private" as ConditionJourneyType,
  // journeyType: "lifestyle" as ConditionJourneyType,
};

export function getActiveConditionName(): string {
  if (process.env.CONDITION_SLUG) {
    return process.env.CONDITION_SLUG;
  }
  return CONDITION_CATALOG[ACTIVE_CONDITION.journeyType];
}

export type AppointmentType = "Video" | "Face to Face" | "Phone call";

export interface BookingPreferences {
  appointmentType: AppointmentType;

  /**
   * If true:
   * - Select "next available slot"
   * - Skip manual month/date selection
   */
  useNextAvailableSlot: boolean;

  /**
   * Example:
   * "May 2026"
   * "June 2026"
   */
  preferredMonth?: string;

  /**
   * Example:
   * "15 Jun"
   * "20 May"
   */
  preferredDate?: string;

  /**
   * Preferred time label.
   * Example:
   * "03:20 PM"
   */
  preferredTime?: string;

  /**
   * Auto move next date using arrows
   * if slots unavailable
   */
  autoMoveToNextDate: boolean;

  /**
   * Max date navigation attempts
   */
  maxDateAttempts: number;
}

export const BOOKING_PREFERENCES: BookingPreferences = {
  appointmentType: "Video",

  useNextAvailableSlot: true,

  preferredMonth: "",

  preferredDate: "9 May",

  preferredTime: "07:00 AM",

  autoMoveToNextDate: true,

  maxDateAttempts: 10,
};

export interface DrugSelectionPreferences {
  /**
   * Example: "25 mg", "50 mg", "100 mg"
   */
  strength?: string;

  /**
   * Example: "4 tablets", "6 tablets", "8 tablets", "30 tablets"
   */
  packSize?: string;
}

export const DRUG_SELECTION_PREFERENCES: DrugSelectionPreferences = {
  strength: "100 mg",
  packSize: "6 tablets",
};

export type CartQuantityAction = "plus" | "minus" | "none";
export type CartPrimaryAction =
  | "Continue Shopping"
  | "Proceed To Checkout"
  | "none";

export interface CartPreferences {
  /**
   * Quantity button action.
   */
  quantityAction: CartQuantityAction;

  /**
   * Number of times to click + or -.
   */
  quantityClicks: number;

  /**
   * Delete first product row when true.
   */
  deleteProduct: boolean;

  /**
   * Coupon code to apply.
   * Apply is clicked only when this value is non-empty.
   */
  couponCode?: string;

  /**
   * Choose final cart CTA.
   */
  action: CartPrimaryAction;
}

export const CART_PREFERENCES: CartPreferences = {
  quantityAction: "none",
  quantityClicks: 0,
  deleteProduct: false,
  couponCode: "",
  action: "Proceed To Checkout",
};

export type ShippingMode = "delivery" | "pharmacy";
export type AddressType = "Home" | "Work" | "Other";
export type AddressAction = "save" | "cancel";
export type ShippingPaymentMethod = "Credit Card" | "Cash on delivery";

export interface ShippingAddressPreferences {
  shippingMode: ShippingMode;
  addressType: AddressType;
  addressLine1: string;
  addressLine2?: string;
  townCity: string;
  postalCode: string;
  addressAction: AddressAction;
  paymentMethod: ShippingPaymentMethod;
}

export const SHIPPING_ADDRESS_PREFERENCES: ShippingAddressPreferences = {
  shippingMode: "delivery",
  addressType: "Home",
  addressLine1: "221B Baker Street",
  addressLine2: "",
  townCity: "London",
  postalCode: "SW1A 1AA",
  addressAction: "save",
  paymentMethod: "Cash on delivery",
};

export type ThankYouAction = "My Orders" | "Continue Shopping";

export interface ThankYouPreferences {
  action: ThankYouAction;
}

export const THANK_YOU_PREFERENCES: ThankYouPreferences = {
  action: "My Orders",
};

export interface PharmacyPreferences {
  preferredBranch?: string;
}

export const PHARMACY_PREFERENCES: PharmacyPreferences = {
  preferredBranch: "",
};
