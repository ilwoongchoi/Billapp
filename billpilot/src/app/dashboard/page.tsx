import Link from "next/link";
import { Suspense } from "react";

import { DashboardWorkspace } from "@/components/dashboard/dashboard-workspace";

export default function DashboardPage() {
  const peakguardUrl = process.env.NEXT_PUBLIC_PEAKGUARD_URL?.trim() || "";
  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="space-y-2">
          <Link href="/" className="text-sm text-blue-600 underline">
            Back to home
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">BillPilot Dashboard</h1>
          <p className="text-zinc-700">
            MVP console for upload, parsing, framework residual readout, and free-tier
            enforcement.
          </p>
          <Link href="/api/health" className="text-sm text-blue-600 underline">
            Open deployment health JSON
          </Link>
          <div>
            <Link href="/dashboard/reception" className="text-sm text-blue-600 underline">
              Open AI Receptionist Console
            </Link>
          </div>
          <div>
            <Link href="/dashboard/dispatch" className="text-sm text-blue-600 underline">
              Open Dispatch Optimizer Console
            </Link>
          </div>
          {peakguardUrl ? (
            <div>
              <a
                href={peakguardUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-600 underline"
              >
                Open PeakGuard trial (new tab)
              </a>
            </div>
          ) : null}
        </div>

        <Suspense fallback={<p className="text-sm text-zinc-600">Loading dashboard...</p>}>
          <DashboardWorkspace />
        </Suspense>

        <footer className="flex flex-wrap gap-4 border-t border-zinc-200 pt-6 text-xs text-zinc-500">
          <Link href="/terms" className="underline">
            Terms
          </Link>
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
        </footer>
      </div>
    </main>
  );
}
