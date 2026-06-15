# Strachan Pharmacy Playwright Tests

This repository contains Playwright E2E tests for Strachan Pharmacy.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Run tests:
   ```bash
   npm test
   ```

## Project Structure

- `tests/e2e`: Test specifications.
- `tests/page-objects`: Page Object Model implementation.
- `tests/fixtures`: Test data and fixtures.
- `tests/helpers`: Utility functions.
