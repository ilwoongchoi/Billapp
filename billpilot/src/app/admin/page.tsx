import Link from "next/link";
import { Suspense } from "react";

import { DashboardWorkspace } from "@/components/dashboard/dashboard-workspace";

export default function AdminPage() {
  const peakguardUrl = process.env.NEXT_PUBLIC_PEAKGUARD_URL?.trim() || "";

  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="space-y-2">
          <Link href="/dashboard" className="text-sm text-blue-600 underline">
            Back to dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">BillPilot Admin</h1>
          <p className="text-zinc-700">
            Internal console for deployment diagnostics, webhook visibility, and workflow
            smoke tests.
          </p>
          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            <Link href="/api/health" className="text-blue-600 underline">
              Open /api/health
            </Link>
            <Link href="/dashboard/reception" className="text-blue-600 underline">
              Reception console
            </Link>
            <Link href="/dashboard/dispatch" className="text-blue-600 underline">
              Dispatch console
            </Link>
            {peakguardUrl ? (
              <a
                href={peakguardUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 underline"
              >
                PeakGuard trial
              </a>
            ) : null}
          </div>
        </div>

        <Suspense fallback={<p className="text-sm text-zinc-600">Loading admin...</p>}>
          <DashboardWorkspace />
        </Suspense>
      </div>
    </main>
  );
}

