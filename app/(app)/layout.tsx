import { NavBar } from "@/components/nav-bar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-12 items-center">
        <NavBar />
        <div className="flex-1 w-full flex flex-col gap-8 max-w-5xl p-5">
          {children}
        </div>
      </div>
    </main>
  );
}
