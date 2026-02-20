type MetricChipProps = {
  label: string;
  value: string;
};

export function MetricChip({ label, value }: MetricChipProps) {
  return (
    <div className="rounded-2xl border border-[#2f4d70] bg-[#0d1c30]/90 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">{label}</p>
      <p className="mt-1 text-base font-semibold text-[#e4f7ff]">{value}</p>
    </div>
  );
}
