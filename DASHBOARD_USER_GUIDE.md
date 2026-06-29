# Pharmacy Test Dashboard — User Guide

**Purpose:** Step-by-step instructions for running automated tests on pharmacy websites using the Playwright Test Dashboard  
**Last updated:** June 2026

---

## What Is This App?

The **Playwright Test Dashboard** is a web-based tool that automatically tests pharmacy websites (such as Strachans Pharmacy and Health Check Pharmacy) to make sure the patient booking journey works correctly — from selecting a condition, through filling in a form, all the way to the confirmation screen.

You do **not** need to write any code. Everything is done through a simple point-and-click interface in your web browser.

---

## Before You Start

### 1. Make sure the server is running

The dashboard runs locally on your computer. Before opening it, someone technical needs to have started the server. You will know it is running when you see this message in the terminal:

```
Dashboard running at http://localhost:7890
```

If you see that, the app is ready.

### 2. Open the dashboard

Open any web browser (Chrome recommended) and go to:

```
http://localhost:7890
```

You should see a dark header bar with the word **Playwright** and a pharmacy dropdown.

---

## The Dashboard at a Glance

```
┌─────────────────────────────────────────────────────────┐
│  🎭 Playwright  [Select pharmacy ▼]      ▶ Run All  🌓   │  ← Header
├─────────────────────────────────────────────────────────┤
│  ● Select a pharmacy to load tests                       │  ← Status bar
├──────────────────┬──────────────────────────────────────┤
│                  │  🖥️  Video player                      │
│  Test list       │                                       │
│  (left sidebar)  ├──────────────────────────────────────┤
│                  │  Output │ API Calls │ Artifacts │ ⚙   │  ← Tabs
│                  │                                       │
└──────────────────┴──────────────────────────────────────┘
```

| Area                  | What it does                                                                        |
| --------------------- | ----------------------------------------------------------------------------------- |
| **Header**            | Choose a pharmacy, run all tests, stop a run, toggle dark/light mode                |
| **Status bar**        | Shows what is happening right now (idle / running / pass / fail counts)             |
| **Left sidebar**      | Lists all tests available for the selected pharmacy                                 |
| **Video player**      | Plays back a recording of the last test that ran                                    |
| **Output tab**        | Shows the live log output as tests run                                              |
| **API Calls tab**     | Shows every network request the test made (useful for debugging)                    |
| **Artifacts tab**     | Stores recordings and trace files after each run                                    |
| **Test Data tab (⚙)** | Where you configure the test user details, booking preferences, and pharmacy branch |

---

## Step-by-Step: Running Your First Test

### Step 1 — Select a Pharmacy

In the top header, click the **pharmacy dropdown** (it says "Loading pharmacies…" when first opened, then shows the available pharmacies once loaded).

Select either:

- **Strachans Pharmacy**
- **Health Check Pharmacy**

Once selected, the left sidebar will fill with a list of tests grouped by condition name (e.g. _Shingles_, _Impetigo_, _Weight Management_).

> **What is happening behind the scenes?**  
> The app fetches the list of active conditions from the pharmacy's content system (Sanity CMS) and matches them to the tests available for that pharmacy.

---

### Step 2 — Configure Test Data (First Time Only)

Before running tests, make sure the test data is set up correctly for your pharmacy. Click the **⚙ Test Data** tab.

You will see four sections:

#### 👤 User Info

This is the fictional patient the test uses to fill in forms. Fill in or verify:

| Field                              | Example value        |
| ---------------------------------- | -------------------- |
| First Name                         | Lloyd                |
| Last Name                          | PEENEY               |
| Email                              | lloyd.p2@yopmail.com |
| Phone                              | 447467059973         |
| Postcode                           | HD59LT               |
| Gender                             | Male                 |
| Date of Birth (Day / Month / Year) | 15 / 04 / 1962       |
| Guardian Name                      | Tonny stark          |

> You can change these to any valid details. The email and phone number do not need to be real — they just need to be in the correct format.

#### 📅 Appointment Preferences

Controls how the test books an appointment:

| Field                   | What it means                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Appointment Type        | Choose **Video**, **Face to Face**, or **Phone call**                                                                                |
| Use Next Available Slot | Tick this to automatically pick the first available slot. If unticked, the test will try to find the date and time you specify below |
| Preferred Date          | Only used if "Use Next Available Slot" is **unticked** (e.g. `9 May`)                                                                |
| Preferred Time          | Only used if "Use Next Available Slot" is **unticked** (e.g. `07:00 AM`)                                                             |

> **Tip:** Keep "Use Next Available Slot" ticked unless you specifically need to test a particular date/time.

#### 🏥 Pharmacy Preference (Strachans only)

For Strachans Pharmacy, you can choose which branch the test should book at.

Click the **Preferred Branch** dropdown — it will automatically load the branches available on the Strachans website:

- Strachans Chemist - Bury
- Strachans Chemist - Uppermill
- Strachans Chemist - Widnes

Select your preferred branch. This controls which branch the test visits when navigating to a condition page.

> **Note:** This section only matters for Strachans Pharmacy. Health Check Pharmacy does not have multiple branches.

#### 💾 Saving Your Changes

Once you have filled everything in, scroll down and click **Save Changes**.

A small confirmation message will appear. Your settings are now saved and will be used every time you run a test until you change them again.

---

### Step 3 — Choose a Condition to Test

In the left sidebar, you will see a list of conditions grouped by test file. Each condition is a separate test you can run.

**To run a single test:**  
Click the small **▶** (play) button that appears when you hover over a condition name.

**To run all tests at once:**  
Click the **▶ Run All** button in the top-right of the header.

> **Tip:** If you only want to check one specific condition (e.g. Shingles), run just that one test rather than Run All. It is much faster.

---

### Step 4 — Watch the Test Run

Once a test starts, several things happen simultaneously:

1. **Status bar** turns blue and shows `Running…`
2. **Video player** shows a live or near-live recording of what the browser is doing
3. **Output tab** fills with a step-by-step log of what the test is doing

The URL bar above the video updates as the test navigates between pages — you can follow along exactly where the test is.

**Typical steps you will see in the log:**

```
✔ Navigated to conditions page
✔ Selected condition href: /strachans-chemist-bury/conditions/shingles-nhs
✔ Pharmacy slug: strachans-chemist-bury
→ Handling sign-up step
→ Handling booking step
→ Handling confirm step
✔ Confirmed booking
```

---

### Step 5 — Read the Result

When the test finishes, the status bar updates with the result:

| Status colour | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| 🟢 Green      | Test **passed** — the booking journey completed successfully                 |
| 🔴 Red        | Test **failed** — something went wrong during the journey                    |
| 🟡 Yellow     | Test **skipped** — the condition is not available on this pharmacy's website |

The pass/fail/skip counts are shown at the right end of the status bar.

---

## Understanding Test Results

### When a test passes ✅

The full booking flow completed — the patient was able to select a condition, go through the eligibility form, sign up or log in, book an appointment, and reach the confirmation page.

Nothing further is needed.

---

### When a test fails ❌

Click the failed test in the sidebar (it will be highlighted in red). Then:

1. **Watch the video** — the recording shows exactly where the browser stopped or got an error
2. **Read the Output tab** — the last few lines will describe what went wrong
3. **Check the Artifacts tab** — a screenshot of the failure moment and a trace file are saved here

**Common failure reasons:**

| What you see                                        | What it likely means                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Condition detail page did not reach a ready state` | The condition page loaded but the "Start Assessment" button wasn't found. The page may have changed. |
| `net::ERR_NAME_NOT_RESOLVED`                        | The pharmacy website URL is wrong or the site is down                                                |
| `Timeout 15000ms exceeded`                          | The page took too long to load — could be a slow internet connection or a site issue                 |
| `HTTP 404`                                          | The condition URL doesn't exist on the website                                                       |

> **What to do:** If a test fails consistently on the same condition, report it to the development team with the error message from the Output tab.

---

### When a test is skipped ⏭️

A yellow skip means the condition you selected exists in the content system (Sanity) but has **no live page** on the pharmacy website yet. This is not an error — it means that condition has not been published to the site.

You will see a message like:

```
Condition "hayfever-seasonal-allergic-rhinitis-private" is not listed on this pharmacy's website — skipping.
```

Try selecting a different condition.

---

## The Artifacts Tab — Finding Videos and Traces

After any test run, click the **Artifacts** tab to find:

### 📹 Videos

A full recording of the browser session. Click the filename to play it directly in the dashboard. Use this to replay exactly what happened during the test.

### 🔍 Traces

A detailed trace file (`.zip`) that records every action, network request, and screenshot frame by frame. This is mainly used by developers to debug failures.

To open a trace file, a developer can run:

```
npx playwright show-trace <filename>.zip
```

---

## The API Calls Tab

Click **🔗 API Calls** to see every network request the test made — things like API calls to the booking system, Sanity CMS queries, and page navigations.

This tab is mainly useful for the development team to verify that the right data is being sent and received. As a non-technical user, you can ignore this tab unless asked to share its contents for debugging.

---

## Switching Between Pharmacies

To test a different pharmacy, simply select it from the pharmacy dropdown in the header. The test list and conditions will reload automatically for that pharmacy.

> **Important:** If you switch pharmacies, the **Preferred Branch** dropdown in Test Data will also reload to show only the branches available for the newly selected pharmacy.

---

## Frequently Asked Questions

**Q: The dropdown says "Loading pharmacies…" and never changes. What do I do?**  
A: The server is not running. Ask a developer to start it by running `node dashboard.js` in the project folder.

**Q: I selected a condition and clicked run, but nothing happens.**  
A: Make sure a pharmacy is selected from the header dropdown first. The Run button is disabled until a pharmacy is loaded.

**Q: The test ran but the video is blank / shows a black screen.**  
A: The browser ran in headless mode (no visible window). The recording may not have captured correctly. Check the Artifacts tab for an alternative video file.

**Q: I changed the Preferred Branch and saved, but the test still goes to the old branch.**  
A: Make sure you clicked **Save Changes** after selecting the branch. Then restart the test. If it still uses the wrong branch, restart the dashboard server.

**Q: A condition appears in the list but immediately skips when I run it.**  
A: That condition exists in the CMS but has not been published to the pharmacy website yet. Contact the content or development team to check its status.

**Q: Can I run tests on both pharmacies at the same time?**  
A: Not from the same browser window. Open a second browser tab at `http://localhost:7890`, select the other pharmacy there, and run tests independently.

**Q: How do I switch between light and dark mode?**  
A: Click the **🌓** button in the top-right corner of the header.

---

## Quick Reference Card

| I want to…                      | I should…                                                            |
| ------------------------------- | -------------------------------------------------------------------- |
| Run all tests for a pharmacy    | Select pharmacy → click **▶ Run All**                                |
| Run one specific condition      | Hover over the condition in the sidebar → click **▶**                |
| Stop a running test             | Click **■ Stop** in the header                                       |
| Change the test patient details | Click **⚙ Test Data** tab → edit → **Save Changes**                  |
| Change which branch is tested   | Click **⚙ Test Data** → Preferred Branch dropdown → **Save Changes** |
| Watch what the test did         | Click the **Video** area or the **Artifacts** tab after the run      |
| See why a test failed           | Check **Output** tab or **Artifacts** tab → screenshot/video         |
| Switch to a different pharmacy  | Click the pharmacy dropdown in the header                            |

---

_For technical issues or to report a bug, contact the development team with a screenshot of the Output tab and the pharmacy/condition you were testing._
