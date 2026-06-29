export const TEST_USER = {
  gender: "male" as "male" | "female",
  dob: {
    day: "15",
    month: "04",
    year: "1962",
    /** ISO format used by Ant Design DatePicker */
    iso: "1962-04-15",
    /** Display format: DD/MM/YYYY */
    display: "15/04/1962",
  },
  firstName: "Lloyd",
  lastName: "PEENEY",
  postcode: "HD59LT",
  genderValue: "male",
  email: "lloyd.p2@yopmail.com",
  guardianName: "Tonny stark",
  phone: "447467059973",
  password: "Test@1234",
  confirmPassword: "Test@1234",
};

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
  // journeyType: "nhs" as ConditionJourneyType,
  // journeyType: "private" as ConditionJourneyType,
  journeyType: "lifestyle" as ConditionJourneyType,
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

  preferredMonth: "May 2026",

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
  preferredBranch: "strachans-chemist-bury",
};
