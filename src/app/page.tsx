import { AdminDashboard } from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="app">
      <AdminDashboard />
    </main>
  );
}
