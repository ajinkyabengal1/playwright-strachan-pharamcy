# CareFirst Pharmacy Automation Framework

## Project Overview
This project is a tailored Playwright end-to-end automation framework specifically designed for the **CareFirst Pharmacy** application flow. It is based on the robust structure of the `pharmacy-e2e-tests` framework but has been streamlined to fit the exact user journey of CareFirst, which intentionally skips the medical questionnaire step.

## Flow Mapping

*   **Original Pharmacy Flow:** Booking → Questionnaire → Signup → Confirmation
*   **CareFirst Pharmacy Flow:** Booking → Signup → Confirmation

## Migration Summary

### What Was Migrated
1.  **Framework Structure:** The same directory layout, coding standards, and Page Object Model (POM) architecture were migrated.
2.  **Test Cases:** The core `condition-flow.spec.ts` script was ported. It dynamically handles listing, eligibility (if present), signup (with NHS PDS checks), drug selection, cart, shipping, payment, and booking confirmation.
3.  **Dashboard Setup:** The `dashboard.js` and `dashboard-public` directories were retained, providing the same high-quality test execution summary, pass/fail stats, environment info, and reporting.
4.  **Utilities & Helpers:** `run-flow.ts` was ported and adjusted to remove questionnaire assertions and states.

### What Was Intentionally Excluded
1.  **Questionnaire Page Object:** `QuestionnairePage.ts` was completely removed.
2.  **Questionnaire Rules:** `ConditionQuestionnaireRules.ts` was excluded since conditions won't prompt for answers.
3.  **Test Logic:** All test steps, assertions, detection mechanisms, and wait indicators for questionnaires were stripped from `tests/e2e/condition-flow.spec.ts`, `tests/helpers/run-flow.ts`, and `tests/page-objects/ConditionDetailPage.ts`.
4.  **URL Assertions:** Removed `waitForURL("**/questionnaire**")` checks that would cause timeouts in CareFirst tests.

### CareFirst-Specific Customizations
*   **Direct Transitioning:** The flow logic in `condition-flow.spec.ts` now seamlessly transitions straight from "Start Assessment" into the "Signup" or "Booking" phases without stalling or expecting questionnaire elements.
*   **Package Naming:** The project metadata was customized to `carefirst-pharmacy-test`.
