import { AppHeader } from "@/components/app-header";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#061120]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(27,146,164,0.18),transparent_38%),radial-gradient(circle_at_90%_0%,rgba(58,92,190,0.22),transparent_42%),radial-gradient(circle_at_70%_90%,rgba(11,158,128,0.14),transparent_40%)]" />
      <AppHeader />
      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-10">{children}</main>
    </div>
  );
}
