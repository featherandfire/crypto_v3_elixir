# E2E tests

Selenium WebDriver against a real Chrome — used for now; will migrate to
Playwright (same TypeScript surface, smaller diff) when we outgrow it.

## Run

Both dev servers need to be up:

```bash
# terminal 1
cd brokerage && mix phx.server

# terminal 2
cd frontend && npm run dev

# terminal 3
cd frontend && npm run test:e2e            # headless
cd frontend && npm run test:e2e:headed     # see the browser
```

The runner is mocha + tsx (no compile step). Tests live in
`tests/e2e/specs/`; shared helpers in `tests/e2e/helpers/`.

## Patterns

- **Selectors** are `data-testid` attributes — same value in Selenium and
  Playwright, so the migration is mostly find-and-replace on the driver
  helper, not the specs. Don't select by CSS class or text — those
  change too easily.
- **State isolation**: every spec generates a unique username (`e2e_<ts>`)
  so it can rerun without a DB reset. If we ever need a clean DB,
  `cd brokerage && mix ecto.reset` between runs.
- **Email verification** is read from Phoenix's dev mailbox preview
  (`/dev/mailbox`) via `helpers/mailbox.ts`. No test-only backend
  endpoints needed.

## Environment

| Var | Default | Notes |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | Vite dev server |
| `PHX_URL` | `http://localhost:4000` | Phoenix; mailbox lives at `$PHX_URL/dev/mailbox` |
| `HEADLESS` | `true` | `false` opens a visible Chrome window |

## Migrating to Playwright (future)

When we flip, the per-spec changes are minimal because selectors are
already test-id-based:
- `await fillByTestId(driver, 'x', 'y')` → `await page.getByTestId('x').fill('y')`
- `await clickByTestId(driver, 'x')` → `await page.getByTestId('x').click()`
- `await waitForTestId(driver, 'x')` → `await page.getByTestId('x').waitFor()`

The `helpers/driver.ts` file owns all the Selenium-specific code and
will be replaced wholesale in the migration.
