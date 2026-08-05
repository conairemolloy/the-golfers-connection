import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = "http://localhost:3000";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const AUTH_COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;
const marker = `E2E M4 ${Date.now()}`;
const requesterEmail = `requester-${Date.now()}@e2e-fixture.invalid`;
const hostEmail = `host-${Date.now()}@e2e-fixture.invalid`;
// Club names below deliberately don't reuse `marker`: src/lib/clubs.ts's
// excludeFixtureClubs() drops any club matching "E2E M4 %" from every
// member-facing list, so a club named with that prefix would be invisible to
// the very page this test drives. "Glasswater Links"/"Rathmore Point" read as
// plausible club names and don't match that (or the RLS harness's "ZZ...
// Fixture — ") exclusion pattern, while the trailing timestamp still keeps
// them identifiable as this test's own rows. Like the other fixtures noted in
// clubs.ts, these are never deleted — ledger_entries is append-only, so a
// club with settled rounds against it can't be torn down — and accumulate one
// pair per run; that's accepted.
const requesterClubName = `Glasswater Links ${Date.now()}`;
const hostClubName = `Rathmore Point ${Date.now()}`;

const sql = postgres(DATABASE_URL, { prepare: false, idle_timeout: 5 });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const plain = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createMember(email: string, displayName: string, initials: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: "E2E-Test-Passw0rd-1!", email_confirm: true });
  if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
  await sql`
    update profiles
    set status = 'member', display_name = ${displayName}, initials = ${initials}, discretion_mode = false
    where id = ${data.user.id}
  `;
  return data.user.id;
}

// generateLink's action_link redirects through Supabase's own /verify endpoint,
// which returns the session in the URL *fragment* (implicit flow) — a fragment
// never reaches our server, so it can't be handled by src/app/auth/callback,
// which only understands the ?code= PKCE flow that signInWithOtp actually
// issues in the product. Rather than exercise a flow the app doesn't use, we
// redeem the magic link's hashed_token via verifyOtp to get a real session
// directly, then write it into the browser's cookie jar ourselves. This
// deliberately bypasses the callback route: this test is exercising the M4
// request → offer → confirm journey, not the auth flow, which tests/auth
// already covers.
async function signIn(browser: Browser, email: string): Promise<BrowserContext> {
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !linkData.properties.hashed_token) {
    throw new Error(`Could not generate a magic link: ${linkError?.message}`);
  }

  const { data: otpData, error: otpError } = await plain.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (otpError || !otpData.session) {
    throw new Error(`Could not verify the magic link: ${otpError?.message}`);
  }

  const context = await browser.newContext();
  await context.addCookies([
    {
      name: AUTH_COOKIE_NAME,
      value: "base64-" + Buffer.from(JSON.stringify(otpData.session)).toString("base64url"),
      url: APP_URL,
    },
  ]);
  return context;
}

test.afterAll(async () => {
  await sql.end();
});

test("request → offer → accept → confirm settles the ledger", async ({ browser }) => {
  const [requesterId, hostId] = await Promise.all([
    createMember(requesterEmail, `${marker} Requester`, "ER"),
    createMember(hostEmail, `${marker} Host`, "EH"),
  ]);
  const [requesterClub] = await sql<{ id: string }[]>`
    insert into clubs (name, region, country, tier, access_difficulty, lat, lng, timezone)
    values (${requesterClubName}, 'Test region', 'IE', 3, 1, 53.0, -6.0, 'Europe/Dublin')
    returning id
  `;
  const [hostClub] = await sql<{ id: string }[]>`
    insert into clubs (name, region, country, tier, access_difficulty, lat, lng, timezone)
    values (${hostClubName}, 'Test region', 'IE', 3, 1, 53.1, -6.1, 'Europe/Dublin')
    returning id
  `;
  const [hostCourse] = await sql<{ id: string }[]>`
    insert into club_courses (club_id, name, holes, par)
    values (${hostClub.id}, 'Test Course', 18, 72)
    returning id
  `;
  await sql`
    insert into memberships (user_id, club_id, verification_state)
    values (${requesterId}, ${requesterClub.id}, 'club_confirmed'), (${hostId}, ${hostClub.id}, 'club_confirmed')
  `;

  const today = new Date().toISOString().slice(0, 10);

  const requester = await signIn(browser, requesterEmail);
  let page = await requester.newPage();
  await page.goto("/");
  await page.getByText("Request a round", { exact: true }).click();
  await page.getByLabel("Where are you travelling?").fill("Test region");
  await page.getByLabel("From").fill(today);
  await page.getByLabel("To").fill(today);
  await page.getByLabel("Party size").fill("1");
  await page.getByLabel("A note for prospective hosts (optional)").fill(marker);
  await page.getByLabel(`${hostClubName} · Tier 3`).check();
  await page.getByRole("button", { name: "Open request" }).click();
  await expect(page.getByText("Request opened.")).toBeVisible();
  await requester.close();

  const host = await signIn(browser, hostEmail);
  page = await host.newPage();
  await page.goto("/");
  await expect(page.getByText(`${marker} Requester`)).toBeVisible();
  await page.getByText("Offer to host", { exact: true }).click();
  await page.getByLabel("Club & course").selectOption(`${hostClub.id}:${hostCourse.id}`);
  await page.getByLabel("Tee time").fill(`${today}T10:00`);
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByText("Offer sent.")).toBeVisible();
  await host.close();

  const requesterAgain = await signIn(browser, requesterEmail);
  page = await requesterAgain.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Accept offer" }).click();
  await expect(page.getByText("Offer accepted. Your round is ready.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm round played" }).click();
  await expect(page.getByText("Round confirmed.")).toBeVisible();
  await requesterAgain.close();

  const hostAgain = await signIn(browser, hostEmail);
  page = await hostAgain.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Confirm round played" }).click();
  await expect(page.getByText("Both players confirmed. The ledger has been settled.")).toBeVisible();
  await hostAgain.close();

  const [ledger] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from ledger_entries le
    join rounds r on r.id = le.round_id
    join offers o on o.id = r.offer_id
    join requests req on req.id = o.request_id
    where req.note = ${marker}
  `;
  expect(ledger.count).toBe(2);
});
