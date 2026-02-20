import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function SectionCard({ title, subtitle, children }: SectionCardProps) {
  return (
    <section className="rounded-3xl border border-white/15 bg-gradient-to-br from-[#0f2744]/90 to-[#102038]/80 p-5 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.85)] md:p-7">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-[#f0fbff] md:text-xl">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-[#b2cce8]">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}
