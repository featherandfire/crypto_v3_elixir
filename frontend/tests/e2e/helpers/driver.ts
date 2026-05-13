// WebDriver factory + small DSL helpers shared across specs.
//
// Designed for an eventual swap to Playwright: every external surface
// (visit, fill, click, waitForText) maps cleanly to a Playwright
// equivalent. Selectors are `data-testid` attributes so they survive
// CSS/markup refactors and tooling changes.

import { Builder, By, WebDriver, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
// Pin the driver to the version installed via npm so the version we
// pinned in package.json (matching local Chrome) is the one Selenium
// uses — otherwise it falls back to Selenium Manager and may grab an
// older driver from cache.
import chromedriver from 'chromedriver';

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
export const PHX_URL = process.env.PHX_URL ?? 'http://localhost:4000';

const DEFAULT_WAIT_MS = 8000;

export async function newDriver(): Promise<WebDriver> {
  const opts = new chrome.Options();
  // Default is headless; flip with HEADLESS=false for debugging.
  if (process.env.HEADLESS !== 'false') opts.addArguments('--headless=new');
  opts.addArguments('--window-size=1400,900');
  // Useful in CI containers + Docker; harmless locally.
  opts.addArguments('--no-sandbox', '--disable-dev-shm-usage');

  const service = new chrome.ServiceBuilder(chromedriver.path);

  return new Builder()
    .forBrowser('chrome')
    .setChromeOptions(opts)
    .setChromeService(service)
    .build();
}

export const testid = (id: string) => By.css(`[data-testid="${id}"]`);

export async function findByTestId(driver: WebDriver, id: string, timeoutMs = DEFAULT_WAIT_MS) {
  return driver.wait(until.elementLocated(testid(id)), timeoutMs);
}

// Alpine.js re-renders elements when x-show / x-if / x-model toggle,
// which invalidates Selenium's element references mid-action. We retry
// the find-and-act sequence on stale-element + element-not-interactable
// errors instead of bubbling the error up. ElementClickInterceptedError
// happens when an overlay or animation briefly covers the target; the
// retry usually clears it once the layout settles.
const RETRYABLE_ERRORS = new Set([
  'StaleElementReferenceError',
  'ElementNotInteractableError',
  'ElementClickInterceptedError',
]);

async function withRetry<T>(action: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await action();
    } catch (e) {
      const name = (e as Error).name;
      if (!RETRYABLE_ERRORS.has(name)) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr;
}

export async function fillByTestId(driver: WebDriver, id: string, value: string) {
  await withRetry(async () => {
    const el = await findByTestId(driver, id);
    await el.clear();
    await el.sendKeys(value);
  });
}

export async function clickByTestId(driver: WebDriver, id: string) {
  await withRetry(async () => {
    const el = await findByTestId(driver, id);
    await driver.wait(until.elementIsVisible(el), DEFAULT_WAIT_MS);
    // Scroll into view so overlay/header-pinned elements don't intercept
    // the click. Center alignment usually lands clear of any sticky bar.
    await driver.executeScript(
      'arguments[0].scrollIntoView({ block: "center", inline: "center" });',
      el,
    );
    try {
      await el.click();
    } catch (e) {
      // If a hover-tooltip or animation overlay intercepts the native
      // click anyway, dispatch a synthetic click via JS — bypasses
      // hit-testing and reaches the bound handler.
      if ((e as Error).name === 'ElementClickInterceptedError') {
        await driver.executeScript('arguments[0].click();', el);
      } else {
        throw e;
      }
    }
  });
}

export async function waitForTestId(driver: WebDriver, id: string, timeoutMs = DEFAULT_WAIT_MS) {
  return withRetry(async () => {
    const el = await findByTestId(driver, id, timeoutMs);
    await driver.wait(until.elementIsVisible(el), timeoutMs);
    return el;
  });
}

export async function textOfTestId(driver: WebDriver, id: string) {
  return withRetry(async () => (await findByTestId(driver, id)).getText());
}

// `type="date"` inputs are locale-sensitive under Selenium — sendKeys
// of "1990-05-15" can be interpreted as MM/DD/YYYY or rejected outright
// depending on Chrome's session locale. Setting via JS + dispatching
// `input` ensures Alpine's x-model binding picks up the value the same
// way it would for a real user.
export async function setDateByTestId(driver: WebDriver, id: string, isoDate: string) {
  await withRetry(async () => {
    const el = await findByTestId(driver, id);
    await driver.executeScript(
      `arguments[0].value = arguments[1];
       arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
       arguments[0].dispatchEvent(new Event('change', { bubbles: true }));`,
      el,
      isoDate,
    );
  });
}

// Toggle a checkbox to the desired state. Native .click() works for
// most cases but can silently fail to fire the right events when the
// element is offscreen or covered. We assert the final state and use
// JS to flip + dispatch events if .click() didn't take effect.
export async function setCheckboxByTestId(driver: WebDriver, id: string, checked: boolean) {
  await withRetry(async () => {
    const el = await findByTestId(driver, id);
    const isChecked = await el.isSelected();
    if (isChecked === checked) return;

    try {
      await driver.wait(until.elementIsVisible(el), DEFAULT_WAIT_MS);
      await el.click();
    } catch {
      // Fall through to the JS path on visibility / interactability failure.
    }

    const after = await el.isSelected();
    if (after !== checked) {
      await driver.executeScript(
        `arguments[0].checked = arguments[1];
         arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
         arguments[0].dispatchEvent(new Event('change', { bubbles: true }));`,
        el,
        checked,
      );
    }
  });
}
