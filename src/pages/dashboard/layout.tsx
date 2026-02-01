"use client";

import Sidebar from "../../components/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex transition-colors duration-500">
      <Sidebar />
      <main className="flex-1 pl-64 transition-all duration-300">
        <div className="h-full min-h-screen">{children}</div>
      </main>
    </div>
  );
}
