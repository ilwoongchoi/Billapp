import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const baseUrl = process.env.BILLPILOT_BASE_URL ?? "http://127.0.0.1:3000";
const parsedBaseUrl = new URL(baseUrl);
const host = parsedBaseUrl.hostname;
const port = Number(parsedBaseUrl.port || 3000);
const cwd = process.cwd();
const isWindows = process.platform === "win32";

function spawnNpm(args, options = {}) {
  if (isWindows) {
    return spawn("cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`], {
      cwd,
      stdio: "inherit",
      shell: false,
      ...options,
    });
  }

  return spawn("npm", args, {
    cwd,
    stdio: "inherit",
    shell: false,
    ...options,
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = command === "npm" ? spawnNpm(args, options) : spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
      }
    });
  });
}

function stopProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
      return;
    }

    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 500);
  });
}

async function waitForServer(url, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // continue polling
    }
    await delay(1000);
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms (${url})`);
}

async function main() {
  console.log("BillPilot dev+smoke");
  console.log("-------------------");
  console.log(`Base URL: ${baseUrl}`);

  const dev = spawnNpm(["run", "dev", "--", "--hostname", host, "--port", String(port)], {
    env: process.env,
  });

  try {
    await waitForServer(baseUrl);
    await runCommand("npm", ["run", "smoke"], {
      env: {
        ...process.env,
        BILLPILOT_BASE_URL: baseUrl,
      },
    });
    console.log("Dev+smoke completed.");
  } finally {
    await stopProcessTree(dev);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown_error";
  console.error(`Dev+smoke failed: ${message}`);
  process.exit(1);
});
