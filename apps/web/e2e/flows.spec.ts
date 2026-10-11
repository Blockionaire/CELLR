import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import {
  api,
  onboardCreate,
  PUBLISHABLE_KEY,
  sessionToken,
  signIn,
  sql,
  STACK,
  uniqueEmail,
} from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

async function newPerson(browser: Browser, label: string) {
  // A second person gets the same device emulation (phone or desktop) as the project under test.
  const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
  const page = await context.newPage();
  const email = uniqueEmail(label);
  return { context, page, email };
}

async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.length}) — ${v.nodes[0]?.target.join(" ")}`,
  );
}

test.describe("first run", () => {
  test("a new person signs up, creates a household, names themselves and lands on Home", async ({
    page,
  }) => {
    const email = uniqueEmail("joost");
    await signIn(page, email);
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.screenshot({ path: shot(`onboarding-household-${project()}`) });

    await onboardCreate(page, "Joost & Merel", "Joost");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Good (morning|afternoon|evening), Joost/,
    );
    await expect(page.getByText("What should we drink tonight?")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your cellar starts here." })).toBeVisible();
    await page.screenshot({ path: shot(`home-${project()}`), fullPage: true });

    // What the database ended up holding (real Postgres, through real PostgREST + RLS):
    const [row] = await sql<{
      name: string;
      role: string;
      display_name: string;
      active: boolean;
      currency: string;
    }>(
      `select h.name, m.role, p.display_name, (p.active_household_id = h.id) as active, h.currency
         from auth.users u join public.profiles p on p.id = u.id
         join public.household_members m on m.user_id = u.id join public.households h on h.id = m.household_id
        where u.email = $1`,
      [email],
    );
    expect(row).toEqual({
      name: "Joost & Merel",
      role: "owner",
      display_name: "Joost",
      active: true,
      currency: "EUR",
    });
  });

  test("signing out ends the session, and protected pages send you back to sign in", async ({
    page,
  }) => {
    await signIn(page, uniqueEmail("out"));
    await onboardCreate(page, "Solo", "Sam");
    await page.getByRole("link", { name: "Profile" }).first().click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fprofile$/);
  });

  test("a signed-in person visiting /sign-in is sent home", async ({ page }) => {
    await signIn(page, uniqueEmail("again"));
    await onboardCreate(page, "Home", "Hana");
    await page.goto("/sign-in");
    await expect(page).toHaveURL((url) => url.pathname === "/");
  });

  test("a wrong sign-in code is explained plainly and the right one still works", async ({
    page,
  }) => {
    const email = uniqueEmail("typo");
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send me a code" }).click();
    await page.getByLabel("6-digit code").fill("000000");
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "That code didn't work. Check it, or ask for a new one.",
    );
    await page.getByLabel("6-digit code").fill("");
    await page.getByLabel("6-digit code").fill(await (await import("./helpers")).codeFor(email));
    await page.waitForURL(/\/onboarding$/);
  });
});

test.describe("households: invite, join, remove", () => {
  test("an owner invites someone, they join with the code, and the owner can remove them", async ({
    browser,
  }) => {
    const alice = await newPerson(browser, "alice");
    const bob = await newPerson(browser, "bob");
    try {
      // Alice creates the household and an invite.
      await signIn(alice.page, alice.email);
      await onboardCreate(alice.page, "The Cellar", "Alice");
      await alice.page.getByRole("link", { name: "Profile" }).first().click();
      await expect(alice.page.getByRole("heading", { name: "The Cellar" })).toBeVisible();
      await alice.page.getByRole("button", { name: "Invite someone" }).click();
      const dialog = alice.page.getByRole("dialog", { name: "Invite to The Cellar" });
      const codeText = dialog.locator("[aria-label='Invite code']");
      await expect(codeText).toHaveText(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
      const code = (await codeText.textContent())!;
      await alice.page.screenshot({ path: shot(`invite-sheet-${project()}`) });
      await alice.page.keyboard.press("Escape");

      // Bob joins with that code (typed in capitals, as someone might read it out).
      await signIn(bob.page, bob.email);
      await bob.page.getByRole("radio", { name: "Join with a code" }).click();
      await bob.page.getByLabel("Invite code").fill(code.toUpperCase());
      await bob.page.getByRole("button", { name: "Join household" }).click();
      await expect(
        bob.page.getByRole("heading", { name: "What should we call you?" }),
      ).toBeVisible();
      await bob.page.getByLabel("Your name").fill("Bob");
      await bob.page.getByRole("button", { name: "Let's go" }).click();
      await bob.page.waitForURL((url) => url.pathname === "/");

      // Alice sees both members; Bob is a plain member and cannot see owner-only controls.
      await alice.page.reload();
      await expect(alice.page.getByText("Bob")).toBeVisible();
      await alice.page.screenshot({ path: shot(`profile-members-${project()}`), fullPage: true });
      await bob.page.getByRole("link", { name: "Profile" }).first().click();
      await expect(bob.page.getByRole("heading", { name: "The Cellar" })).toBeVisible();
      await expect(bob.page.getByText("Alice")).toBeVisible();
      await expect(bob.page.getByRole("button", { name: "Remove" })).toHaveCount(0);

      // Alice removes Bob (with a calm confirmation); Bob is out and is sent back to onboarding.
      await alice.page.getByRole("button", { name: "Remove" }).click();
      await alice.page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
      await expect(alice.page.getByText("Bob")).toHaveCount(0);
      await bob.page.goto("/");
      await expect(bob.page).toHaveURL(/\/onboarding$/);
    } finally {
      await alice.context.close();
      await bob.context.close();
    }
  });

  test("a wrong invite code is refused kindly", async ({ page }) => {
    await signIn(page, uniqueEmail("lost"));
    await page.getByRole("radio", { name: "Join with a code" }).click();
    await page.getByLabel("Invite code").fill("0000-0000-0000");
    await page.getByRole("button", { name: "Join household" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "That invite code didn't work. Check it, or ask for a new one.",
    );
  });

  test("the last owner cannot walk away from a household that still has members", async ({
    browser,
  }) => {
    const alice = await newPerson(browser, "owner");
    const token = await sessionToken(uniqueEmail("pal"));
    try {
      await signIn(alice.page, alice.email);
      await onboardCreate(alice.page, "Shared", "Olive");
      const me = await (await alice.page.request.get("/api/v1/me")).json();
      const invite = await (
        await alice.page.request.post(`/api/v1/households/${me.activeHouseholdId}/invites`, {
          data: {},
          headers: { origin: "http://localhost:3100" },
        })
      ).json();
      const joined = await api(alice.page.request, token, "post", "/households/join", {
        code: invite.code,
      });
      expect(joined.status()).toBe(200);

      await alice.page.getByRole("link", { name: "Profile" }).first().click();
      await alice.page.getByRole("button", { name: "Leave household" }).click();
      await alice.page.getByRole("dialog").getByRole("button", { name: "Leave household" }).click();
      await expect(
        alice.page.getByText(
          "You're the last owner. Delete the household instead, or hand it over first.",
        ),
      ).toBeVisible();
    } finally {
      await alice.context.close();
    }
  });
});

test.describe("the sign-up gate (private beta)", () => {
  test("only listed addresses can create an account; the message is friendly", async ({ page }) => {
    await sql(
      "insert into private.allowed_signups (entry, note) values ('@example.test', 'e2e') on conflict do nothing",
    );
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("stranger@not-on-the-list.test");
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "CELLR is invite-only for now, and this email isn't on the list yet.",
    );

    await page.getByLabel("Email").fill(uniqueEmail("listed"));
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  });

  test("the database refuses a stranger even when the app is bypassed entirely", async () => {
    await sql(
      "insert into private.allowed_signups (entry, note) values ('@example.test', 'e2e') on conflict do nothing",
    );
    // Calling Auth directly with the (public) publishable key — exactly what an attacker would do.
    const res = await fetch(`${STACK}/auth/v1/otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "intruder@evil.test", create_user: true }),
    });
    expect(res.status).toBe(500);
    expect(await sql("select 1 from auth.users where email = 'intruder@evil.test'")).toHaveLength(
      0,
    );
  });
});

test.describe("native-style API access (bearer token, no cookies)", () => {
  test("two people cannot see or touch each other's households", async ({ request }) => {
    const aliceToken = await sessionToken(uniqueEmail("a"));
    const bobToken = await sessionToken(uniqueEmail("b"));

    const created = await api(request, aliceToken, "post", "/households", {
      name: "Alice only",
      currency: "EUR",
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();

    // Alice sees it; Bob does not, however he asks.
    expect((await api(request, aliceToken, "get", `/households/${id}`)).status()).toBe(200);
    for (const [method, path, body] of [
      ["get", `/households/${id}`],
      ["patch", `/households/${id}`, { name: "pwned" }],
      ["delete", `/households/${id}`],
      ["post", `/households/${id}/invites`, {}],
    ] as const) {
      const res = await api(request, bobToken, method, path, body);
      expect(res.status(), `${method.toUpperCase()} ${path}`).toBe(404);
    }
    const bobHouseholds = await (await api(request, bobToken, "get", "/households")).json();
    expect(bobHouseholds).toEqual([]);
    // …and nothing changed.
    expect(
      await sql<{ name: string }>("select name from public.households where id = $1", [id]),
    ).toEqual([{ name: "Alice only" }]);
  });

  test("an attacker holding their OWN valid session, talking straight to the public REST API, still sees and changes nothing", async ({
    request,
  }) => {
    // The Supabase REST endpoint and publishable key are public by design, so this — not our UI — is the real attack surface.
    const aliceToken = await sessionToken(uniqueEmail("victim"));
    const bobToken = await sessionToken(uniqueEmail("attacker"));
    const { id } = await (
      await api(request, aliceToken, "post", "/households", { name: "Victim House" })
    ).json();
    const aliceId = (
      await sql<{ id: string }>(
        "select user_id as id from public.household_members where household_id = $1",
        [id],
      )
    )[0]!.id;

    const rest = (token: string | null, method: string, path: string, body?: unknown) =>
      fetch(`${STACK}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: PUBLISHABLE_KEY,
          authorization: `Bearer ${token ?? PUBLISHABLE_KEY}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const rows = async (res: Response) => (res.ok ? ((await res.json()) as unknown[]) : null);

    // Positive control: the owner CAN read it, so an empty answer for the attacker means something.
    expect(await rows(await rest(aliceToken, "GET", `households?id=eq.${id}`))).toHaveLength(1);
    expect(
      await rows(await rest(aliceToken, "GET", `household_members?household_id=eq.${id}`)),
    ).toHaveLength(1);

    // Reads: nothing, whichever way it is asked.
    expect(await rows(await rest(bobToken, "GET", "households?select=*"))).toEqual([]);
    expect(await rows(await rest(bobToken, "GET", `households?id=eq.${id}`))).toEqual([]);
    expect(
      await rows(await rest(bobToken, "GET", `household_members?household_id=eq.${id}`)),
    ).toEqual([]);
    expect(await rows(await rest(bobToken, "GET", `profiles?id=eq.${aliceId}`))).toEqual([]);

    // Writes: refused outright (no privilege) or filtered to zero rows — never applied.
    const writes = [
      await rest(bobToken, "PATCH", `households?id=eq.${id}`, { name: "pwned" }),
      await rest(bobToken, "DELETE", `households?id=eq.${id}`),
      await rest(bobToken, "PATCH", `profiles?id=eq.${aliceId}`, { display_name: "pwned" }),
      await rest(bobToken, "POST", "households", { name: "mine now", created_by: aliceId }),
      await rest(bobToken, "POST", "household_members", {
        household_id: id,
        user_id: aliceId,
        role: "member",
      }),
      await rest(bobToken, "PATCH", `household_members?household_id=eq.${id}`, { role: "member" }),
    ];
    for (const res of writes) {
      const body = res.ok ? ((await res.json()) as unknown[]) : null;
      expect(body === null || body.length === 0, `${res.url} → ${res.status}`).toBe(true);
    }
    expect(
      await sql<{ name: string }>("select name from public.households where id = $1", [id]),
    ).toEqual([{ name: "Victim House" }]);
    expect(
      await sql("select 1 from public.household_members where household_id = $1", [id]),
    ).toHaveLength(1);
    expect(await sql("select 1 from public.households where name = 'mine now'")).toHaveLength(0);

    // Anonymous (publishable key only): no table is readable at all.
    for (const table of [
      "households",
      "household_members",
      "profiles",
      "wines",
      "grapes",
      "bottles",
      "cellars",
      "ai_usage",
    ]) {
      const res = await rest(null, "GET", `${table}?select=*&limit=1`);
      expect(res.status, `anon GET ${table}`).toBeGreaterThanOrEqual(400);
    }
    // The sign-up allow-list and rate limiter are not reachable through the REST surface.
    expect(
      (await rest(bobToken, "POST", "rpc/check_signup_allowed", { p_email: "x@y.z" })).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await rest(bobToken, "GET", "rate_events?select=*")).status).toBeGreaterThanOrEqual(
      400,
    );
  });

  test("a garbage or missing token is a clean 401", async ({ request }) => {
    expect(
      (
        await request.get("/api/v1/me", { headers: { authorization: "Bearer not.a.token" } })
      ).status(),
    ).toBe(401);
    expect((await request.get("/api/v1/me")).status()).toBe(401);
  });

  test("guessing invite codes is rate limited after ten tries, and each guess counts", async ({
    request,
  }) => {
    const token = await sessionToken(uniqueEmail("guesser"));
    for (let i = 0; i < 10; i++) {
      const res = await api(request, token, "post", "/households/join", {
        code: `${String(i).padStart(12, "0")}`,
      });
      expect(res.status()).toBe(422);
      expect((await res.json()).error.code).toBe("INVITE_INVALID");
    }
    const blocked = await api(request, token, "post", "/households/join", { code: "ffffffffffff" });
    expect(blocked.status()).toBe(429);
    expect((await blocked.json()).error.code).toBe("RATE_LIMITED");
  });

  test("a member can leave, an owner can delete, and validation errors are human", async ({
    request,
  }) => {
    const token = await sessionToken(uniqueEmail("owner"));
    const { id } = await (
      await api(request, token, "post", "/households", { name: "Temp" })
    ).json();
    expect(
      (await api(request, token, "patch", `/households/${id}`, { name: "   " })).status(),
    ).toBe(422);
    expect((await api(request, token, "patch", `/households/${id}`, {})).status()).toBe(422);
    expect(
      (await api(request, token, "patch", `/households/${id}`, { name: "Renamed" })).status(),
    ).toBe(200);
    expect((await api(request, token, "delete", `/households/${id}`)).status()).toBe(204);
    expect((await api(request, token, "get", `/households/${id}`)).status()).toBe(404);
  });
});

test.describe("signed-in appearance", () => {
  test("Light/Dark choice is remembered by the server (no flash) and the screens pass the accessibility audit", async ({
    page,
  }) => {
    await signIn(page, uniqueEmail("theme"));
    await onboardCreate(page, "Theme House", "Tess");
    await page.getByRole("link", { name: "Profile" }).first().click();

    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light"); // rendered by the server from the cookie
    await expect(page.getByRole("radio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.screenshot({ path: shot(`profile-light-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);

    await page.getByRole("radio", { name: "Dark" }).click();
    await page.screenshot({ path: shot(`profile-dark-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);

    for (const [name, path] of [
      ["home", "/"],
      ["cellar", "/cellar"],
      ["scan", "/scan"],
      ["sommelier", "/sommelier"],
    ] as const) {
      await page.goto(path);
      await page.screenshot({ path: shot(`${name}-dark-${project()}`), fullPage: true });
      expect(await audit(page), name).toEqual([]);
    }
  });

  test("the navigation marks where you are and works from the keyboard", async ({ page }) => {
    await signIn(page, uniqueEmail("nav"));
    await onboardCreate(page, "Nav House", "Nova");
    const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Cellar" }).click();
    await expect(page).toHaveURL(/\/cellar$/);
    await expect(nav.getByRole("link", { name: "Cellar" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
