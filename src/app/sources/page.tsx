import { listGuidelineSources } from "@/lib/guidelines";
import { getGuidelineCounts } from "@/lib/db";
import { SectionCard } from "@/components/section-card";

const externalLinks = [
  { label: "Рубрикатор Минздрава", href: "https://cr.minzdrav.gov.ru/" },
  { label: "API Минздрава", href: "https://apicr.minzdrav.gov.ru/" },
  { label: "ClinicalTrials.gov API v2", href: "https://clinicaltrials.gov/api/v2/studies" },
  { label: "NCCN для пациентов", href: "https://www.nccn.org/patients" },
];

export default function SourcesPage() {
  const counts = getGuidelineCounts();
  const sources = listGuidelineSources(300);

  return (
    <div className="grid gap-6">
      <SectionCard
        title="Реестр источников рекомендаций"
        subtitle="Онко-рекомендации Минздрава (status 0 и 4), версии и ссылки на оригиналы"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <SourceMetric label="Индексировано КР" value={String(counts.guidelines)} />
          <SourceMetric label="Индексировано чанков" value={String(counts.chunks)} />
          <SourceMetric label="Показано строк" value={String(sources.length)} />
        </div>
      </SectionCard>

      <SectionCard title="Внешние ссылки">
        <div className="grid gap-2 md:grid-cols-2">
          {externalLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-[#2d4c6f] bg-[#0c2036] px-3 py-2 text-sm text-[#8ee4f9] transition hover:border-[#54d8c6] hover:text-[#c3f8ff]"
            >
              {link.label}
            </a>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Таблица источников">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2 text-sm text-[#ddf0ff]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.12em] text-[#93b9dc]">
                <th className="px-3">ID</th>
                <th className="px-3">Название</th>
                <th className="px-3">Дата публикации</th>
                <th className="px-3">Статус</th>
                <th className="px-3">Секций</th>
                <th className="px-3">Ссылки</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id} className="rounded-xl bg-[#0d2138]/90">
                  <td className="rounded-l-xl px-3 py-2 align-top text-xs text-[#9bc1e5]">{source.id}</td>
                  <td className="px-3 py-2 align-top">
                    <p>{source.name}</p>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-[#b7d1e9]">{source.publish_date ?? "нет данных"}</td>
                  <td className="px-3 py-2 align-top text-xs text-[#b7d1e9]">{source.status}</td>
                  <td className="px-3 py-2 align-top text-xs text-[#b7d1e9]">{source.section_count}</td>
                  <td className="rounded-r-xl px-3 py-2 align-top text-xs">
                    <div className="flex gap-3">
                      <a href={source.source_url} target="_blank" rel="noreferrer" className="text-[#82dcf4] hover:underline">
                        источник
                      </a>
                      <a href={source.pdf_url} target="_blank" rel="noreferrer" className="text-[#82dcf4] hover:underline">
                        pdf
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function SourceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#2f4d70] bg-[#0d1c30]/90 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">{label}</p>
      <p className="mt-1 text-base font-semibold text-[#e4f7ff]">{value}</p>
    </div>
  );
}
