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
  await page.route("**/api/v1/dashboard/init", (route) =>
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
    synthetic: true,
  };
  await page.route("**/api/v1/dashboard/init", (r) =>
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
    .getByRole("button", { name: "Inspect " + dot.operator_id, exact: true })
    .click();
  await expect(page.getByText("Operator status · banned")).toBeVisible();
  await expect(page.getByText("Synthetic seed session")).toBeVisible();
});
