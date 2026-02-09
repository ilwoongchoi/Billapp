const baseUrl = process.env.BILLPILOT_BASE_URL ?? "http://127.0.0.1:3000";

function ms(value) {
  return `${Math.round(value)}ms`;
}

async function timedFetch(path, init) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, init);
  const elapsed = performance.now() - started;
  return { response, elapsed };
}

async function run() {
  console.log("BillPilot smoke test");
  console.log("--------------------");
  console.log(`Base URL: ${baseUrl}`);

  const health = await timedFetch("/api/health", { method: "GET" });
  const healthJson = await health.response.json();

  if (!health.response.ok && health.response.status !== 503) {
    throw new Error(
      `/api/health returned unexpected status ${health.response.status}`,
    );
  }

  if (
    !healthJson ||
    typeof healthJson !== "object" ||
    !("status" in healthJson)
  ) {
    throw new Error("/api/health returned invalid JSON payload");
  }

  if (!("deployment" in healthJson) || typeof healthJson.deployment !== "object") {
    throw new Error("/api/health payload missing deployment summary");
  }

  console.log(
    `health: ${health.response.status} (${ms(health.elapsed)}) status=${healthJson.status} deployable=${healthJson.deployment?.deployable ?? "unknown"}`,
  );

  const samplePayload = {
    rawText:
      "Provider: North Utility\nBilling Period: 01/01/2026 - 01/31/2026\nTotal Amount Due: $182.44\nUsage: 648 kWh\nDelivery: 42.12\nTax: 11.21",
    priorBills: [
      { totalCost: 150.1, usageValue: 590, periodEnd: "2025-12-31" },
      { totalCost: 161.8, usageValue: 605, periodEnd: "2025-11-30" },
      { totalCost: 155, usageValue: 598, periodEnd: "2025-10-31" },
    ],
  };

  const parse = await timedFetch("/api/bills/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(samplePayload),
  });

  if (!parse.response.ok) {
    const body = await parse.response.text();
    throw new Error(`/api/bills/parse failed (${parse.response.status}): ${body}`);
  }

  const parseJson = await parse.response.json();
  if (
    !parseJson ||
    typeof parseJson !== "object" ||
    !("bill" in parseJson) ||
    !("framework" in parseJson) ||
    !("insights" in parseJson)
  ) {
    throw new Error("/api/bills/parse returned invalid JSON payload");
  }

  console.log(
    `parse: ${parse.response.status} (${ms(parse.elapsed)}) provider=${parseJson.bill?.provider ?? "-"} confidence=${parseJson.parseConfidence ?? "-"} insights=${Array.isArray(parseJson.insights) ? parseJson.insights.length : 0}`,
  );

  const dashboard = await timedFetch("/dashboard", { method: "GET" });
  if (!dashboard.response.ok) {
    throw new Error(`/dashboard returned ${dashboard.response.status}`);
  }

  console.log(`dashboard: ${dashboard.response.status} (${ms(dashboard.elapsed)})`);

  const receptionDashboard = await timedFetch("/dashboard/reception", { method: "GET" });
  if (!receptionDashboard.response.ok) {
    throw new Error(
      `/dashboard/reception returned ${receptionDashboard.response.status}`,
    );
  }

  console.log(
    `reception dashboard: ${receptionDashboard.response.status} (${ms(receptionDashboard.elapsed)})`,
  );

  const dispatchDashboard = await timedFetch("/dashboard/dispatch", { method: "GET" });
  if (!dispatchDashboard.response.ok) {
    throw new Error(`/dashboard/dispatch returned ${dispatchDashboard.response.status}`);
  }

  console.log(
    `dispatch dashboard: ${dispatchDashboard.response.status} (${ms(dispatchDashboard.elapsed)})`,
  );

  const analytics = await timedFetch("/api/analytics/summary", { method: "GET" });
  if (analytics.response.status !== 401) {
    const body = await analytics.response.text();
    throw new Error(
      `/api/analytics/summary expected 401 without auth, got ${analytics.response.status}: ${body}`,
    );
  }

  console.log(
    `analytics auth guard: ${analytics.response.status} (${ms(analytics.elapsed)})`,
  );

  const history = await timedFetch("/api/bills/history", { method: "GET" });
  if (history.response.status !== 401) {
    const body = await history.response.text();
    throw new Error(
      `/api/bills/history expected 401 without auth, got ${history.response.status}: ${body}`,
    );
  }
  console.log(`history auth guard: ${history.response.status} (${ms(history.elapsed)})`);

  const demoSeed = await timedFetch("/api/bills/demo-seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (demoSeed.response.status !== 401) {
    const body = await demoSeed.response.text();
    throw new Error(
      `/api/bills/demo-seed expected 401 without auth, got ${demoSeed.response.status}: ${body}`,
    );
  }
  console.log(`demo seed auth guard: ${demoSeed.response.status} (${ms(demoSeed.elapsed)})`);

  const receptionOverview = await timedFetch("/api/reception/overview", {
    method: "GET",
  });
  if (receptionOverview.response.status !== 401) {
    const body = await receptionOverview.response.text();
    throw new Error(
      `/api/reception/overview expected 401 without auth, got ${receptionOverview.response.status}: ${body}`,
    );
  }

  console.log(
    `reception overview auth guard: ${receptionOverview.response.status} (${ms(receptionOverview.elapsed)})`,
  );

  const receptionReminderStatus = await timedFetch("/api/reception/reminders/status", {
    method: "GET",
  });
  if (receptionReminderStatus.response.status !== 401) {
    const body = await receptionReminderStatus.response.text();
    throw new Error(
      `/api/reception/reminders/status expected 401 without auth, got ${receptionReminderStatus.response.status}: ${body}`,
    );
  }

  console.log(
    `reception reminders auth guard: ${receptionReminderStatus.response.status} (${ms(receptionReminderStatus.elapsed)})`,
  );

  const rescheduleRequests = await timedFetch("/api/reception/reschedule-requests", {
    method: "GET",
  });
  if (rescheduleRequests.response.status !== 401) {
    const body = await rescheduleRequests.response.text();
    throw new Error(
      `/api/reception/reschedule-requests expected 401 without auth, got ${rescheduleRequests.response.status}: ${body}`,
    );
  }
  console.log(
    `reschedule requests auth guard: ${rescheduleRequests.response.status} (${ms(rescheduleRequests.elapsed)})`,
  );

  const dispatchRuns = await timedFetch("/api/dispatch/runs", { method: "GET" });
  if (dispatchRuns.response.status !== 401) {
    const body = await dispatchRuns.response.text();
    throw new Error(
      `/api/dispatch/runs expected 401 without auth, got ${dispatchRuns.response.status}: ${body}`,
    );
  }
  console.log(
    `dispatch runs auth guard: ${dispatchRuns.response.status} (${ms(dispatchRuns.elapsed)})`,
  );

  const dispatchScore = await timedFetch("/api/dispatch/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      route: {
        distanceMiles: 45,
        estimatedFuelGallons: 12,
        estimatedDurationMinutes: 150,
        revenueUsd: 520,
      },
      controls: {
        fuelPricePerGallon: 4.12,
        driverHourlyCost: 34,
        marginTarget: 0.14,
        fuelWeight: 0.6,
        timeWeight: 0.4,
      },
    }),
  });
  if (dispatchScore.response.status !== 401) {
    const body = await dispatchScore.response.text();
    throw new Error(
      `/api/dispatch/score expected 401 without auth, got ${dispatchScore.response.status}: ${body}`,
    );
  }
  console.log(
    `dispatch score auth guard: ${dispatchScore.response.status} (${ms(dispatchScore.elapsed)})`,
  );

  console.log("\nSmoke test completed.");
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown_error";
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
});
