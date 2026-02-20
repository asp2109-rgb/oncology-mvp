import Link from "next/link";
import { Activity, BookOpenCheck, Microscope, ShieldCheck } from "lucide-react";
import { SectionCard } from "@/components/section-card";

const featureCards = [
  {
    href: "/doctor",
    title: "Проверка для врача",
    description:
      "Проверка протокола на соответствие КР: флаги несоответствий, доказательства и версии рекомендаций.",
    icon: ShieldCheck,
  },
  {
    href: "/patient",
    title: "Объяснение для пациента",
    description:
      "Понятное объяснение результатов проверки, вопросы для врача и прозрачные ссылки на источники.",
    icon: BookOpenCheck,
  },
  {
    href: "/benchmark",
    title: "Панель бенчмарка",
    description:
      "Ретроспектива и синтетика: точность, precision/recall, задержка и охват проверок.",
    icon: Activity,
  },
  {
    href: "/sources",
    title: "Реестр рекомендаций",
    description:
      "Каталог загруженных КР Минздрава: версии, статусы, даты публикации и ссылки на первоисточники.",
    icon: Microscope,
  },
];

export default function HomePage() {
  return (
    <div className="space-y-6 md:space-y-8">
      <section className="grid-pattern relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-[#0b2038] to-[#0a1b30] p-6 md:p-10">
        <div className="absolute -right-24 -top-20 h-72 w-72 rounded-full bg-[#33d7c7]/20 blur-3xl" />
        <div className="absolute -bottom-28 left-8 h-72 w-72 rounded-full bg-[#4f6fff]/20 blur-3xl" />

        <div className="relative z-10 max-w-4xl space-y-5">
          <p className="w-fit rounded-full border border-[#3a597d] bg-[#0a1e35] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#7ce4d9]">
            Готовый каркас MVP
          </p>

          <h1 className="text-3xl font-semibold tracking-tight text-[#f2fbff] md:text-5xl">
            AI-помощник для проверки онкологического лечения
          </h1>

          <p className="max-w-3xl text-sm text-[#c6ddf3] md:text-base">
            Next.js fullstack + SQLite FTS5 + модульные провайдеры поиска. Ретроспективная проверка по правилам
            работает без LLM; при наличии API-ключа подключается LLM-слой для объяснений пациенту.
          </p>

          <div className="flex flex-wrap gap-3 text-xs text-[#d3ebff] md:text-sm">
            <span className="rounded-full border border-[#365674] bg-[#122945] px-3 py-1">Онко-корпус Минздрава</span>
            <span className="rounded-full border border-[#365674] bg-[#122945] px-3 py-1">status=0 + status=4</span>
            <span className="rounded-full border border-[#365674] bg-[#122945] px-3 py-1">проверка “на дату лечения”</span>
            <span className="rounded-full border border-[#365674] bg-[#122945] px-3 py-1">clinicaltrials.gov v2</span>
          </div>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        {featureCards.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="group">
            <SectionCard title={title} subtitle={description}>
              <div className="flex items-center justify-between">
                <Icon className="h-8 w-8 text-[#73e0d6] transition group-hover:scale-110" />
                <span className="text-xs uppercase tracking-[0.15em] text-[#9ac2e8] group-hover:text-[#73e0d6]">
                  Открыть
                </span>
              </div>
            </SectionCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
