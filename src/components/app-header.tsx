import Link from "next/link";

const links = [
  { href: "/", label: "Обзор" },
  { href: "/doctor", label: "Врач" },
  { href: "/patient", label: "Пациент" },
  { href: "/benchmark", label: "Бенчмарк" },
  { href: "/sources", label: "Источники" },
];

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/25 bg-[#071325]/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 md:px-8">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-[#73e0d6]">Onco Protocol Check</p>
          <p className="text-xs text-[#b8d6f5]">Проверка назначений и LLM-объяснение для пациента</p>
        </div>

        <nav className="flex flex-wrap items-center gap-2">
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full border border-white/15 px-3 py-1 text-xs text-[#e8f4ff] transition hover:border-[#73e0d6] hover:text-[#73e0d6]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
