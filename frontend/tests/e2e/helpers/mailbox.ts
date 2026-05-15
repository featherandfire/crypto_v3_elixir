// Polls Phoenix's Swoosh local mailbox preview for the 6-digit
// verification code emailed during signup. Swoosh exposes the preview
// at /dev/mailbox and an HTML/JSON listing of recent emails.
//
// We hit the HTML list, find the most recent email for `recipient`,
// fetch its body, and pluck the code via regex. This avoids needing a
// test-only backend endpoint and works with the existing dev mailer.

import { PHX_URL } from './env';

const MAILBOX_LIST_URL = `${PHX_URL}/dev/mailbox`;

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 15_000;

/**
 * Wait for an email to land in the dev mailbox addressed to `recipient`
 * and return the 6-digit verification code from its body.
 *
 * The Swoosh mailbox preview renders emails in reverse-chronological
 * order; we scan for the first one whose "to" header matches and which
 * contains a 6-digit code in the body.
 */
export async function waitForVerificationCode(recipient: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    try {
      const code = await fetchLatestCode(recipient);
      if (code) return code;
    } catch (e) {
      lastErr = e;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for verification email to ${recipient} at ${MAILBOX_LIST_URL}` +
      (lastErr ? ` (last error: ${(lastErr as Error).message})` : ''),
  );
}

async function fetchLatestCode(recipient: string): Promise<string | null> {
  // Swoosh's mailbox preview at /dev/mailbox redirects to the latest
  // email's view page. The view's sidebar lists all emails (most-recent
  // first). We pull the id list out, then for each id fetch the rendered
  // text body via /html and check the body itself for the recipient
  // address + a 6-digit code. The body is plain text in the dev mailer
  // so the recipient line ("Hi <username>,") appears verbatim and we
  // don't need a second fetch for headers.
  const listRes = await fetch(MAILBOX_LIST_URL);
  if (!listRes.ok) return null;
  const listHtml = await listRes.text();

  const ids = parseEmailIds(listHtml);
  if (ids.length === 0) return null;

  for (const id of ids) {
    const bodyRes = await fetch(`${MAILBOX_LIST_URL}/${id}/html`);
    if (!bodyRes.ok) continue;
    const body = await bodyRes.text();
    if (!body.toLowerCase().includes(recipient.toLowerCase().split('@')[0])) continue;
    const match = body.match(/\b(\d{6})\b/);
    if (match) return match[1];
  }
  return null;
}

function parseEmailIds(html: string): string[] {
  // Anchor hrefs look like /dev/mailbox/<32-char hex id>.
  const ids: string[] = [];
  const re = /\/dev\/mailbox\/([a-f0-9]{32})/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    ids.push(m[1]);
  }
  return ids;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
