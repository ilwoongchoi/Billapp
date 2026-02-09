const baseUrl = process.env.BILLPILOT_BASE_URL ?? "http://127.0.0.1:3000";
const iterations = Number(process.env.BILLPILOT_PERF_ITERATIONS ?? 20);
const concurrency = Number(process.env.BILLPILOT_PERF_CONCURRENCY ?? 4);
const p95BudgetMs = Number(process.env.BILLPILOT_PARSE_P95_BUDGET_MS ?? 2000);

const samplePayload = {
  rawText:
    "Provider: North Utility\nBilling Period: 01/01/2026 - 01/31/2026\nTotal Amount Due: $182.44\nUsage: 648 kWh\nDelivery: 42.12\nTax: 11.21",
  priorBills: [
    { totalCost: 150.1, usageValue: 590, periodEnd: "2025-12-31" },
    { totalCost: 161.8, usageValue: 605, periodEnd: "2025-11-30" },
    { totalCost: 155, usageValue: 598, periodEnd: "2025-10-31" },
  ],
};

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

async function singleRun(runId) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/bills/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(samplePayload),
  });
  const elapsed = performance.now() - started;
  const text = await response.text();

  if (!response.ok) {
    return {
      runId,
      ok: false,
      elapsed,
      status: response.status,
      error: text.slice(0, 250),
    };
  }

  return {
    runId,
    ok: true,
    elapsed,
    status: response.status,
    error: null,
  };
}

async function worker(workerId, queue, results) {
  while (queue.length > 0) {
    const runId = queue.shift();
    if (typeof runId !== "number") {
      return;
    }

    try {
      const result = await singleRun(runId);
      results.push(result);
      if (!result.ok) {
        console.error(
          `[worker-${workerId}] run ${runId} failed status=${result.status}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      results.push({
        runId,
        ok: false,
        elapsed: 0,
        status: 0,
        error: message,
      });
      console.error(`[worker-${workerId}] run ${runId} exception: ${message}`);
    }
  }
}

async function run() {
  console.log("BillPilot parse perf");
  console.log("--------------------");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Iterations: ${iterations}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`P95 budget: ${p95BudgetMs}ms`);

  if (!Number.isFinite(iterations) || iterations < 1) {
    throw new Error("BILLPILOT_PERF_ITERATIONS must be >= 1");
  }
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error("BILLPILOT_PERF_CONCURRENCY must be >= 1");
  }

  const queue = Array.from({ length: iterations }, (_, index) => index + 1);
  const results = [];

  const workers = Array.from(
    { length: Math.min(concurrency, iterations) },
    (_, index) => worker(index + 1, queue, results),
  );
  await Promise.all(workers);

  const failures = results.filter((result) => !result.ok);
  const latencies = results
    .filter((result) => result.ok)
    .map((result) => result.elapsed)
    .sort((a, b) => a - b);

  if (latencies.length === 0) {
    throw new Error("No successful parse runs.");
  }

  const total = latencies.reduce((sum, value) => sum + value, 0);
  const avg = total / latencies.length;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const min = latencies[0];
  const max = latencies[latencies.length - 1];

  console.log("\nResults");
  console.log(`- success: ${latencies.length}/${iterations}`);
  console.log(`- failed: ${failures.length}`);
  console.log(`- min: ${Math.round(min)}ms`);
  console.log(`- p50: ${Math.round(p50)}ms`);
  console.log(`- p95: ${Math.round(p95)}ms`);
  console.log(`- p99: ${Math.round(p99)}ms`);
  console.log(`- max: ${Math.round(max)}ms`);
  console.log(`- avg: ${Math.round(avg)}ms`);

  if (failures.length > 0) {
    console.error("\nFailure samples:");
    for (const failure of failures.slice(0, 3)) {
      console.error(
        `run=${failure.runId} status=${failure.status} error=${failure.error ?? "-"}`,
      );
    }
    process.exit(1);
  }

  if (p95 > p95BudgetMs) {
    console.error(
      `\nP95 budget exceeded: ${Math.round(p95)}ms > ${p95BudgetMs}ms`,
    );
    process.exit(1);
  }

  console.log("\nPerf budget passed.");
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown_error";
  console.error(`Perf test failed: ${message}`);
  process.exit(1);
});
