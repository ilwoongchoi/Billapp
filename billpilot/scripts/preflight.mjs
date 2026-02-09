import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const envPath = path.join(cwd, ".env.local");

const coreKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
];

const featureKeys = {
  billing: [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_STARTER_PRICE_ID",
    "STRIPE_PRO_PRICE_ID",
    "STRIPE_TEAM_PRICE_ID",
  ],
  reports: ["RESEND_API_KEY", "REPORTS_FROM_EMAIL", "MONTHLY_REPORT_CRON_SECRET"],
  reception: [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "RECEPTION_REMINDER_CRON_SECRET",
  ],
};

const requiredMigrations = [
  "20260207052000_init_billpilot.sql",
  "20260207061000_billing_indexes_and_storage.sql",
  "20260207073000_webhook_events.sql",
  "20260207090000_monthly_reports.sql",
  "20260207095000_hardening_constraints.sql",
  "20260207100000_bills_history_perf.sql",
  "20260207101000_ai_receptionist_mvp.sql",
  "20260207103000_booking_reminders.sql",
  "20260207104500_reschedule_requests.sql",
  "20260207110000_reschedule_queue_ops.sql",
  "20260207113000_reschedule_escalation.sql",
];

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function checkKeys(keys) {
  const missing = keys.filter((key) => !hasValue(process.env[key]));
  return {
    total: keys.length,
    configured: keys.length - missing.length,
    missing,
    ok: missing.length === 0,
  };
}

function printCheck(label, result) {
  const icon = result.ok ? "OK" : "MISSING";
  console.log(`${label}: ${icon} (${result.configured}/${result.total})`);
  if (!result.ok) {
    console.log(`  Missing -> ${result.missing.join(", ")}`);
  }
}

function checkMigrations() {
  const base = path.join(cwd, "supabase", "migrations");
  const missing = requiredMigrations.filter(
    (filename) => !fs.existsSync(path.join(base, filename)),
  );
  return {
    total: requiredMigrations.length,
    configured: requiredMigrations.length - missing.length,
    missing,
    ok: missing.length === 0,
  };
}

console.log("BillPilot preflight");
console.log("-------------------");
console.log(`Working directory: ${cwd}`);
console.log(`.env.local exists: ${fs.existsSync(envPath) ? "yes" : "no"}`);

loadDotEnv(envPath);

const core = checkKeys(coreKeys);
printCheck("Core", core);

for (const [featureName, keys] of Object.entries(featureKeys)) {
  const anyConfigured = keys.some((key) => hasValue(process.env[key]));
  const result = checkKeys(keys);

  if (!anyConfigured) {
    console.log(`${featureName}: optional (not configured yet)`);
    continue;
  }

  printCheck(featureName, result);
}

const migrations = checkMigrations();
printCheck("Migrations", migrations);

if (!core.ok || !migrations.ok) {
  console.log("\nPreflight failed.");
  if (!core.ok) {
    console.log("- Fill required Core keys in .env.local");
  }
  if (!migrations.ok) {
    console.log("- Missing required migration file(s)");
  }
  process.exitCode = 1;
} else {
  console.log("\nPreflight passed for core runtime.");
}
