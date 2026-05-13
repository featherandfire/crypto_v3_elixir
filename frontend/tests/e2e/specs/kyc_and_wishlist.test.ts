// KYC completion + wishlist persistence. Picks up where critical_path
// leaves off (un-onboarded user landed on the KYC form) and exercises:
//
//   1. Filling and submitting KYC creates an Alpaca customer account
//      and routes the user back to brokerage (proven by the wishlist
//      open button becoming visible — gated on alpacaAccount being
//      loaded, which requires kyc_state=active server-side).
//
//   2. Adding AAPL to the wishlist persists across a full page reload —
//      the wishlist is DB-backed, not localStorage.
//
// Both tests share a single `before()` that does signup+verify so the
// onboarding cost is paid once and each `it()` reports independently.

import { expect } from 'chai';
import { until, type WebDriver } from 'selenium-webdriver';
import {
  clickByTestId,
  fillByTestId,
  newDriver,
  setCheckboxByTestId,
  setDateByTestId,
  testid,
  waitForTestId,
} from '../helpers/driver';
import { freshCreds, signupAndLandOnKyc } from '../helpers/flows';

describe('post-signup: KYC + wishlist', function () {
  this.timeout(300_000);
  let driver: WebDriver;

  before(async () => {
    driver = await newDriver();
    await signupAndLandOnKyc(driver, freshCreds());
  });

  after(async () => {
    if (driver) await driver.quit();
  });

  it('completes KYC and provisions an active Alpaca account', async () => {
    // Personal info.
    await fillByTestId(driver, 'kyc-given-name', 'Test');
    await fillByTestId(driver, 'kyc-family-name', 'Eee2eee');
    // Date inputs are locale-sensitive under Selenium — use the JS path.
    await setDateByTestId(driver, 'kyc-dob', '1990-05-15');
    await fillByTestId(driver, 'kyc-ssn', '432-19-8765');

    // Contact.
    await fillByTestId(driver, 'kyc-phone', '+14155551234');
    await fillByTestId(driver, 'kyc-street', '123 Market Street');
    await fillByTestId(driver, 'kyc-city', 'San Francisco');
    await fillByTestId(driver, 'kyc-state', 'CA');
    await fillByTestId(driver, 'kyc-zip', '94103');

    // Agreements — backed by Alpine x-model so we use the
    // setCheckboxByTestId helper that asserts final state.
    await setCheckboxByTestId(driver, 'kyc-agree-customer', true);
    await setCheckboxByTestId(driver, 'kyc-agree-account', true);
    await setCheckboxByTestId(driver, 'kyc-agree-margin', true);

    await clickByTestId(driver, 'kyc-submit');

    // The KYC form disappears once the POST succeeds and submitKyc
    // routes the user to the brokerage page. Wait for that, then for
    // wishlist-open which only renders when alpacaAccount populates
    // (gated on kyc_state=active, which the frontend polls for).
    await driver.wait(
      until.stalenessOf(await driver.findElement(testid('kyc-submit'))),
      180_000,
      'KYC form should disappear after submit',
    );
    await waitForTestId(driver, 'wishlist-open', 180_000);
  });

  it('adds a stock to the wishlist and persists across reload', async () => {
    // Open the wishlist modal and add AAPL.
    await clickByTestId(driver, 'wishlist-open');
    await fillByTestId(driver, 'wishlist-add-input', 'AAPL');
    await clickByTestId(driver, 'wishlist-add-submit');

    // The count badge appears once the API roundtrip lands.
    await driver.wait(
      async () => {
        const els = await driver.findElements(testid('wishlist-count'));
        if (els.length === 0) return false;
        return (await els[0].getText()).trim() === '1';
      },
      10_000,
      'expected wishlist-count to show "1" after add',
    );

    // Full reload — drops localStorage state, forces a re-fetch from
    // /api/wishlist. If the count is still 1 after reload, the item
    // is DB-backed (which is what we shipped in Phase 2b).
    await driver.navigate().refresh();
    const countEl = await driver.wait(until.elementLocated(testid('wishlist-count')), 30_000);
    await driver.wait(until.elementIsVisible(countEl), 5_000);
    expect((await countEl.getText()).trim()).to.equal('1');
  });
});
