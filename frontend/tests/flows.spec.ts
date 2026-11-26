import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { SessionTelemetry } from "../src/sdk";
import type { DashboardEvent } from "../src/types";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL("../../contracts/fixtures/" + name, import.meta.url),
      "utf8",
    ),
  );
const event: DashboardEvent = fixture("normal/dashboard-event.json");
const d = fixture("normal/mobile-decision.json");

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/*/me", (r) =>
    r.fulfill({ json: { alias: null, fixture_access: true } }),
  );
});

async function startPhone(page: Page) {
  await page.goto("/mobile");
  await page
    .getByRole("button", { name: "Включить защиту SANA Shield" })
    .click();
  for (const digit of ["7", "4", "6", "3", "2", "1"])
    await page.getByRole("button", { name: digit, exact: true }).click();
}
test("phone sends bounded contract data and reuses the exact snapshot after a failed response", async ({
  page,
}) => {
  await page.routeWebSocket("**/ws/mobile/*", () => {});
  const sent: SessionTelemetry[] = [];
  await page.route("**/api/v1/sessions/ingest", async (route) => {
    const body = route.request().postDataJSON() as SessionTelemetry;
    sent.push(body);
    await route.fulfill(
      sent.length === 1
        ? { status: 503 }
        : { json: { ...d, session_id: body.session_id } },
    );
  });
  await startPhone(page);
  const slider = page.getByRole("button", { name: "Подтвердить перевод" });
  await slider.press("Enter");
  await page.getByRole("button", { name: "Повторить отправку" }).click();
  await expect(page.getByText(d.reference_code)).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[0].account_id).toBe("acc_student_101");
  expect(sent[0].keystrokes).toHaveLength(6);
  expect(sent[0].contacts!.filter((c) => c.field === "recipient")).toHaveLength(
    6,
  );
  expect(
    sent[0].contacts!.every((c) => c.up_ms >= c.down_ms && c.is_trusted),
  ).toBe(true);
  expect(sent[0].taps.every((t) => t.is_trusted)).toBe(true);
  expect(sent[0].imu_samples).toEqual([]);
  expect(sent[0].device_meta.sample_rate_hz).toBe(0);
  expect(JSON.stringify(sent[0])).not.toContain("746321");
});
test("account changes discard recordings and a targeted demo goes through the collector", async ({
  page,
}) => {
  let command: () => void = () => {};
  await page.routeWebSocket("**/ws/mobile/*", (ws) => {
    command = () => ws.send(JSON.stringify({ cmd: "INJECT_RAT_CLICK" }));
  });
  let received: SessionTelemetry | null = null;
  await page.route("**/api/v1/sessions/ingest", async (route) => {
    const body = route.request().postDataJSON() as SessionTelemetry;
    received = body;
    await route.fulfill({ json: { ...d, session_id: body.session_id } });
  });
  await startPhone(page);
  await page
    .getByRole("combobox", { name: "Demo account" })
    .selectOption("acc_drop_772");
  await page
    .getByRole("button", { name: "Включить защиту SANA Shield" })
    .click();
  for (const digit of ["4", "4", "4", "4"])
    await page.getByRole("button", { name: digit, exact: true }).click();
  command();
  await expect(page.getByText(d.reference_code)).toBeVisible();
  const payload = received as unknown as SessionTelemetry;
  expect(payload.account_id).toBe("acc_drop_772");
  expect(payload.keystrokes).toHaveLength(4);
  expect(payload.taps.at(-1)?.is_trusted).toBe(false);
  expect(payload.imu_samples).toEqual([]);
});
test("dashboard reconciles duplicate events, preserves unavailable evidence and inspects a case", async ({
  page,
}) => {
  const missing = fixture("missing_sensors/dashboard-event.json");
  let pushes: () => void = () => {};
  let events = [event];
  await page.routeWebSocket("**/ws/dashboard", (ws) => {
    pushes = () => ws.send(JSON.stringify(missing));
  });
  await page.route("**/api/v1/dashboard/init*", (route) =>
    route.fulfill({
      json: {
        events,
        ml_mode: "mock",
        active_sessions: [],
        population_map: null,
        kpis: {
          sessions: events.length,
          held_amount_kzt: 0,
          ring_count: 0,
          average_inference_ms: null,
        },
      },
    }),
  );
  await page.goto("/dashboard");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2);
  events = [missing, event];
  pushes();
  pushes();
  await expect(page.getByRole("row")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Inspect " + missing.session_id, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ban operator" }),
  ).toBeDisabled();
});
test("Guardian acknowledges a visible hold and can freeze it under the scoped token", async ({
  page,
}) => {
  await page.routeWebSocket("**/ws/guardian", () => {});
  let frozen = false,
    acked = false;
  const hold = {
    session_id: "sess_test",
    account_id: "acc_student_101",
    amount_kzt: 120000,
    reference_code: "DEMO-G1",
    status: "held",
    timestamp: new Date().toISOString(),
  };
  await page.route("**/api/v1/guardian/holds**", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer demo-test");
    if (route.request().url().endsWith("/ack")) {
      acked = true;
      await route.fulfill({ json: { status: "acknowledged" } });
    } else if (route.request().url().endsWith("/freeze")) {
      frozen = true;
      await route.fulfill({ json: { status: "frozen" } });
    } else
      await route.fulfill({
        json: { holds: [{ ...hold, status: frozen ? "frozen" : "held" }] },
      });
  });
  await page.goto("/guardian");
  await page.getByLabel("Guardian token").fill("demo-test");
  await page.getByRole("button", { name: "Open Guardian" }).click();
  await page.getByRole("button", { name: "Freeze simulated transfer" }).click();
  await expect(page.getByRole("button", { name: "Frozen" })).toBeDisabled();
  expect(acked).toBe(true);
});

test("explicit fixture mode previews step-up and Guardian freeze with services offline", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push(r.url());
  });
  await page.goto("/mobile?mode=fixtures");
  await page.locator(".profile select").last().selectOption("missing_sensors");
  await page
    .getByRole("button", { name: "Включить защиту SANA Shield" })
    .click();
  for (const digit of ["0", "1", "2", "3"])
    await page.getByRole("button", { name: digit, exact: true }).click();
  await page
    .getByRole("button", { name: "Подтвердить перевод" })
    .press("Enter");
  await page.getByRole("button", { name: "Отклонена" }).click();
  await expect(page.getByText("Демо-проверка отклонена")).toBeVisible();
  await page.goto("/guardian?mode=fixtures");
  await page.getByRole("button", { name: "Freeze simulated transfer" }).click();
  await expect(
    page.getByRole("button", { name: "Frozen", exact: true }),
  ).toBeDisabled();
  expect(requests).toEqual([]);
});

test("population view preserves current ban status over the historical session snapshot", async ({
  page,
}) => {
  await page.routeWebSocket("**/ws/dashboard", () => {});
  const dot = {
    ...event.map_point!,
    session_id: event.session_id,
    account_id: event.account_id,
    status: "BANNED",
    position_3d: [0.1, 0.2, -0.4],
    synthetic: true,
  };
  await page.route("**/api/v1/dashboard/init*", (r) =>
    r.fulfill({
      json: {
        ml_mode: "live",
        events: [event],
        active_sessions: [],
        population_map: { points: [dot], clusters: [] },
        kpis: {
          sessions: 1,
          held_amount_kzt: 0,
          ring_count: 0,
          average_inference_ms: null,
        },
      },
    }),
  );
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Population map", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Group " + dot.cluster_id + " 1 session",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Inspect " + dot.operator_id, exact: true })
    .click();
  await expect(page.getByText("Operator status · banned")).toBeVisible();
  await expect(page.getByText("Synthetic seed session")).toBeVisible();
});

test("population map separates overlapping sessions and supports keyboard exploration", async ({
  page,
}) => {
  await page.goto("/dashboard/map?mode=fixtures");
  const plot = page.getByRole("group", { name: "Behavioral similarity plot" });
  await expect(plot.getByRole("button")).toHaveCount(2);
  const group = plot.getByRole("button", {
    name: "Explore Group 1, 5 sessions",
  });
  const initial = await group.getAttribute("transform");
  await plot.press("ArrowRight");
  await expect(group).not.toHaveAttribute("transform", initial!);
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect(group).toHaveAttribute("transform", initial!);
  await plot.press("w");
  await expect(group).not.toHaveAttribute("transform", initial!);
  await page.getByRole("button", { name: "Reset view" }).click();
  await group.press("Enter");

  const stack = plot.getByRole("button", {
    name: "Inspect 2 overlapping sessions",
  });
  await stack.press("Enter");
  const browser = page.getByRole("complementary", {
    name: "Behavior groups and sessions",
  });
  await expect(
    browser.getByRole("heading", { name: "Overlapping sessions" }),
  ).toBeVisible();
  await expect(browser.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Return to group overview" }).click();
  await browser.getByRole("button", { name: "Group 1 5 sessions" }).click();
  await page.getByRole("button", { name: "Normal 1" }).click();
  await expect(browser.getByRole("listitem")).toHaveCount(1);
  await browser.getByRole("button", { name: /sess_fixture_normal/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("clean live session enrollment requires independent verification and analyst token", async ({
  page,
}) => {
  await page.routeWebSocket("**/ws/dashboard", () => {});
  await page.route("**/api/v1/dashboard/init*", (r) =>
    r.fulfill({
      json: {
        ml_mode: "live",
        session_identity: {
          [event.session_id]: {
            match_confidence: 0.89,
            linked_account_ids: [event.account_id],
            eligible_for_enrollment: true,
          },
        },
        events: [event],
        active_sessions: [],
        population_map: null,
        kpis: {
          sessions: 1,
          held_amount_kzt: 0,
          ring_count: 0,
          average_inference_ms: null,
        },
      },
    }),
  );
  let requests = 0;
  await page.route("**/api/v1/sessions/*/enroll", (r) => {
    expect(r.request().headers().authorization).toBe("Bearer enrollment-demo");
    expect(r.request().postDataJSON()).toEqual({ owner_verified: true });
    requests++;
    return r.fulfill({
      json: {
        session_id: event.session_id,
        account_id: event.account_id,
        baseline_sessions_count: 3,
      },
    });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Analyst access" }).click();
  await page.getByLabel("Analyst token").fill("enrollment-demo");
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("button", { name: "Inspect " + event.session_id, exact: true })
    .click();
  await expect(page.getByText("Operator match · 89%")).toBeVisible();
  const enroll = page.getByRole("button", { name: "Enroll verified session" });
  await expect(enroll).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I independently verified/ })
    .check();
  await enroll.click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "future scoring: 3",
  );
  await expect(enroll).toBeDisabled();
  expect(requests).toBe(1);
});

test("denied motion permission leaves touch capture available and calibration opt-in scoped to one transfer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.DeviceMotionEvent, "requestPermission", {
      value: () => Promise.resolve("denied"),
    });
    Object.defineProperty(window.DeviceOrientationEvent, "requestPermission", {
      value: () => Promise.resolve("denied"),
    });
  });
  await page.routeWebSocket("**/ws/mobile/*", () => {});
  let submitted: SessionTelemetry | null = null,
    saved: SessionTelemetry | null = null;
  await page.route("**/api/v1/sessions/ingest", (r) => {
    const payload = r.request().postDataJSON();
    submitted = payload;
    return r.fulfill({ json: { ...d, session_id: payload.session_id } });
  });
  await page.route("**/api/v1/calibration/sessions", (r) => {
    expect(r.request().headers()["x-calibration-consent"]).toBe("granted");
    saved = r.request().postDataJSON();
    return r.fulfill({ json: { recording: "test" } });
  });
  await startPhone(page);
  await expect(page.getByText("Доступ к датчикам ограничен.")).toBeVisible();
  await page.getByLabel("Сохранить телеметрию для калибровки").check();
  await page
    .getByRole("button", { name: "Подтвердить перевод" })
    .press("Enter");
  await expect(page.getByText("Запись калибровки сохранена.")).toBeVisible();
  expect(saved).toEqual(submitted);
  expect((submitted as unknown as SessionTelemetry).imu_samples).toEqual([]);
  await page.getByRole("button", { name: "Новый перевод" }).click();
  await page
    .getByRole("button", { name: "Включить защиту SANA Shield" })
    .click();
  await expect(
    page.getByLabel("Сохранить телеметрию для калибровки"),
  ).not.toBeChecked();
});

test("browser virtual sensors retain stationary orientation while motion continues sampling", async ({
  page,
}) => {
  const client = await page.context().newCDPSession(page);
  const types = [
    "accelerometer",
    "linear-acceleration",
    "gyroscope",
    "relative-orientation",
  ] as const;
  for (const type of types)
    await client.send("Emulation.setSensorOverrideEnabled", {
      type,
      enabled: true,
    });
  await page.routeWebSocket("**/ws/mobile/*", () => {});
  let received: SessionTelemetry | null = null;
  await page.route("**/api/v1/sessions/ingest", (r) => {
    const body = r.request().postDataJSON();
    received = body;
    return r.fulfill({ json: { ...d, session_id: body.session_id } });
  });
  await page.goto("/mobile");
  await page
    .getByRole("button", { name: "Включить защиту SANA Shield" })
    .click();
  for (const type of types)
    await client.send("Emulation.setSensorOverrideReadings", {
      type,
      reading:
        type === "relative-orientation"
          ? { quaternion: { x: 0, y: 0, z: 0, w: 1 } }
          : { xyz: { x: 0, y: 0, z: 0 } },
    });
  for (const char of ["0", "1", "2", "3"])
    await page.getByRole("button", { name: char, exact: true }).click();
  // Stationary orientation emits on change; use a full observation window.
  await page.waitForTimeout(650);
  await page
    .getByRole("button", { name: "Подтвердить перевод" })
    .press("Enter");
  await expect(page.getByText(d.reference_code)).toBeVisible();
  const payload = received as unknown as SessionTelemetry;
  expect(payload.imu_samples.length).toBeGreaterThan(8);
  expect(
    payload.imu_samples.at(-1)!.t_ms - payload.imu_samples[0].t_ms,
  ).toBeGreaterThan(450);
  const measured =
    ((payload.imu_samples.length - 1) * 1000) /
    (payload.imu_samples.at(-1)!.t_ms - payload.imu_samples[0].t_ms);
  expect(payload.device_meta.sample_rate_hz).toBeCloseTo(measured);
});
