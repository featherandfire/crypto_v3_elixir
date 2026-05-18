// Picks up from critical_path: (1) submitting KYC provisions an Alpaca
// customer account and gates the wishlist-open button on
// kyc_state=active, and (2) an added wishlist entry survives a full
// page reload (DB-backed, not localStorage). Tests share one onboarded
// page via beforeAll + serial mode so the slow signup+KYC is paid once.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { freshCreds, signupAndLandOnKyc } from '../helpers/flows';

test.describe.configure({ mode: 'serial' });

test.describe('post-signup: KYC + wishlist', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signupAndLandOnKyc(page, freshCreds());
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('completes KYC and provisions an active Alpaca account', async () => {
    // Personal info.
    await page.getByTestId('kyc-given-name').fill('Test');
    await page.getByTestId('kyc-family-name').fill('Eee2eee');
    await page.getByTestId('kyc-dob').fill('1990-05-15');
    await page.getByTestId('kyc-ssn').fill('432-19-8765');

    // Contact.
    await page.getByTestId('kyc-phone').fill('+14155551234');
    await page.getByTestId('kyc-street').fill('123 Market Street');
    await page.getByTestId('kyc-city').fill('San Francisco');
    await page.getByTestId('kyc-state').fill('CA');
    await page.getByTestId('kyc-zip').fill('94103');

    // Agreements.
    await page.getByTestId('kyc-agree-customer').check();
    await page.getByTestId('kyc-agree-account').check();
    await page.getByTestId('kyc-agree-margin').check();

    await page.getByTestId('kyc-submit').click();

    // The KYC form disappears once the POST succeeds and submitKyc
    // routes the user to the brokerage page. Wait for that, then for
    // wishlist-open which only renders when alpacaAccount populates
    // (gated on kyc_state=active, which the frontend polls for).
    await expect(page.getByTestId('kyc-submit')).toBeHidden({ timeout: 180_000 });
    await expect(page.getByTestId('wishlist-open')).toBeVisible({ timeout: 180_000 });
  });

  test('adds a stock to the wishlist and persists across reload', async () => {
    // Open the wishlist modal and add AAPL.
    await page.getByTestId('wishlist-open').click();
    await page.getByTestId('wishlist-add-input').fill('AAPL');
    await page.getByTestId('wishlist-add-submit').click();

    // Count badge populates once the server roundtrip lands.
    await expect(page.getByTestId('wishlist-count')).toHaveText('1', { timeout: 10_000 });

    // Full reload — drops in-memory state, forces a re-fetch from
    // /api/wishlist. If the count is still 1 after reload, the item
    // is DB-backed (which is what we shipped in Phase 2b).
    await page.reload();
    await expect(page.getByTestId('wishlist-count')).toHaveText('1', { timeout: 30_000 });
  });
});
