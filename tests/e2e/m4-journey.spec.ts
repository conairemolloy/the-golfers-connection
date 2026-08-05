import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = "http://localhost:3000";
const marker = `E2E M4 ${Date.now()}`;
const requesterEmail = `requester-${Date.now()}@e2e-fixture.invalid`;
const hostEmail = `host-${Date.now()}@e2e-fixture.invalid`;

const sql = postgres(DATABASE_URL, { prepare: false, idle_timeout: 5 });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
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

async function signIn(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${APP_URL}/auth/callback` },
  });
  if (error || !data.properties.action_link) throw new Error(`Could not generate a magic link: ${error?.message}`);
  await page.goto(data.properties.action_link);
  await page.waitForURL(`${APP_URL}/`);
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
    values (${`${marker} Requester Club`}, 'Test region', 'IE', 3, 1, 53.0, -6.0, 'Europe/Dublin')
    returning id
  `;
  const [hostClub] = await sql<{ id: string }[]>`
    insert into clubs (name, region, country, tier, access_difficulty, lat, lng, timezone)
    values (${`${marker} Host Club`}, 'Test region', 'IE', 3, 1, 53.1, -6.1, 'Europe/Dublin')
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
  await page.getByLabel(`${marker} Host Club · Tier 3`).check();
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
