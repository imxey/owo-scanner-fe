"use client";

import { useEffect, useState } from "react";

interface DashboardStat {
  termin: string;
  total_schools: number;
  scanned: number;
  logs_accepted: number;
  not_scanned?: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const apiUrl = import.meta.env.VITE_SAVE_API_URL;
        if (!apiUrl) {
          throw new Error("API URL configuration missing (VITE_SAVE_API_URL)");
        }

        const res = await fetch(`${apiUrl}/stats`);
        if (!res.ok)
          throw new Error(`Failed to fetch stats: ${res.statusText}`);

        const json = await res.json();
        if (json.success) {
          // Sort explicitly in frontend
          const sortedStats = (json.data as DashboardStat[]).sort((a, b) =>
            a.termin.localeCompare(b.termin, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
          );
          setStats(sortedStats);
        } else {
          setError(json.message || "Unknown error from server");
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Failed to connect to stats server");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  // Calculate Total Row manually
  const totalStat: DashboardStat = stats.reduce(
    (acc, curr) => ({
      termin: "Total",
      total_schools: acc.total_schools + curr.total_schools,
      scanned: acc.scanned + curr.scanned,
      logs_accepted: acc.logs_accepted + curr.logs_accepted,
      not_scanned: (acc.not_scanned || 0) + (curr.total_schools - curr.scanned),
    }),
    {
      termin: "Total",
      total_schools: 0,
      scanned: 0,
      logs_accepted: 0,
      not_scanned: 0,
    },
  );

  // Compute not_scanned for each row for display
  const finalStats = [
    ...stats.map((s) => ({ ...s, not_scanned: s.total_schools - s.scanned })),
    totalStat,
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-4 min-h-[50vh]">
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg shadow-sm max-w-md w-full text-center border border-red-100 dark:border-red-800">
          <h3 className="font-bold mb-2">Error Loading Dashboard</h3>
          <p>{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-100 dark:bg-red-800 hover:bg-red-200 dark:hover:bg-red-700 rounded-md transition-colors text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight">
          Scanner Dashboard
        </h1>
        <p className="text-slate-500 dark:text-slate-400">
          Real-time statistics of school document scanning progress.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden backdrop-blur-sm bg-opacity-90 dark:bg-opacity-90">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr className="bg-slate-50/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 backdrop-blur-sm">
                <th className="px-6 py-5 font-bold text-sm text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Termin
                </th>
                <th className="px-6 py-5 font-bold text-sm text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                  Total Sekolah
                </th>
                <th className="px-6 py-5 font-bold text-sm text-emerald-600 dark:text-emerald-400 uppercase tracking-wider text-right bg-emerald-50/50 dark:bg-emerald-900/10">
                  Pemeriksaan Fisik Sesuai
                </th>
                <th className="px-6 py-5 font-bold text-sm text-blue-600 dark:text-blue-400 uppercase tracking-wider text-right">
                  Sudah Scan
                </th>
                <th className="px-6 py-5 font-bold text-sm text-slate-400 dark:text-slate-500 uppercase tracking-wider text-right">
                  Belum Scan
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {finalStats.map((row) => {
                const isTotal = row.termin === "Total";
                return (
                  <tr
                    key={row.termin}
                    className={`
                                            transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40
                                            ${isTotal ? "bg-slate-50 dark:bg-slate-800/60 font-bold text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300"}
                                        `}
                  >
                    <td className="px-6 py-4">
                      {isTotal ? (
                        "TOTAL KESELURUHAN"
                      ) : (
                        <span className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold">
                          {row.termin}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-lg">
                      {row.total_schools.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right bg-emerald-50/30 dark:bg-emerald-900/5">
                      <div className="flex flex-col items-end">
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium tabular-nums text-lg">
                          {row.logs_accepted.toLocaleString()}
                        </span>
                        <span className="text-xs text-slate-400">
                          {row.total_schools > 0
                            ? (
                                (row.logs_accepted / row.total_schools) *
                                100
                              ).toFixed(1)
                            : 0}
                          %
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-lg tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
                          {row.scanned.toLocaleString()}
                        </span>
                        <span className="text-xs text-slate-400">
                          {row.total_schools > 0
                            ? ((row.scanned / row.total_schools) * 100).toFixed(
                                1,
                              )
                            : 0}
                          %
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right text-slate-400 tabular-nums">
                      {(row.not_scanned || 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
