// Webhook → deposit-completed chain. Tests the deterministic part of
// the auto-execute flow:
//
//   1. User adds a stock to their wishlist.
//   2. User initiates a deposit (real Alpaca transfer).
//   3. We sign + POST the COMPLETE webhook the way Alpaca would.
//   4. Our backend receives, verifies, and flips the deposit to
//      `completed`.
//
// What this does NOT verify: the wishlist row actually flipping to
// `filled`. That step requires Alpaca to have credited the cash on
// their side first (their settlement clock is non-deterministic in
// sandbox — 1 to 5+ minutes). Manual smoke tests in BrokerFunding
// cover the post-credit path; running it inside an E2E would just be
// flaky. Once we deploy to a staging with real Alpaca-driven webhooks,
// this gap closes.

import { expect } from 'chai';
import { type WebDriver } from 'selenium-webdriver';
import { newDriver } from '../helpers/driver';
import {
  addToWishlistViaUi,
  completeKyc,
  freshCreds,
  getAuthToken,
  signupAndLandOnKyc,
  submitDepositViaUi,
} from '../helpers/flows';
import { fireSignedWebhook, listDeposits } from '../helpers/api';

describe('webhook → deposit completed', function () {
  this.timeout(360_000);
  let driver: WebDriver;
  let token: string;

  before(async () => {
    driver = await newDriver();
    await signupAndLandOnKyc(driver, freshCreds());
    await completeKyc(driver);
    token = await getAuthToken(driver);
  });

  after(async () => {
    if (driver) await driver.quit();
  });

  it('ingests a signed Alpaca webhook and flips the deposit to completed', async () => {
    // Set up the pre-state: wishlist row + a real Alpaca deposit.
    await addToWishlistViaUi(driver, 'SCHB');
    await submitDepositViaUi(driver, '40');

    // Pull Alpaca's transfer UUID off the deposit row — it's the
    // resource id our webhook will target.
    let deposit: Awaited<ReturnType<typeof listDeposits>>[number] | undefined;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const deposits = await listDeposits(token);
      deposit = deposits[0];
      if (
        deposit &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          deposit.reference,
        )
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(deposit, 'expected a deposit with an Alpaca transfer id').to.exist;
    expect(deposit!.status, 'starts as pending').to.equal('pending');

    // Sign + fire the COMPLETE webhook against the running Phoenix.
    // The receiver verifies the HMAC and runs the same handler chain
    // Alpaca's production webhooks hit.
    await fireSignedWebhook('transfer.status_updated', deposit!.reference, 'COMPLETE');

    // The receiver's handler is synchronous — by the time the POST
    // returns, broker_deposits has been patched. Re-fetch to confirm.
    const updated = (await listDeposits(token)).find((d) => d.id === deposit!.id);
    expect(updated, 'deposit row should still be present').to.exist;
    expect(updated!.status, 'webhook should flip pending → completed').to.equal('completed');
  });
});
