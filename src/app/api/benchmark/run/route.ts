import { NextResponse } from "next/server";
import { runBenchmark } from "@/lib/benchmark";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let datasetVersion = "v1";

    try {
      const payload = (await request.json()) as { dataset_version?: string };
      if (payload?.dataset_version) {
        datasetVersion = payload.dataset_version;
      }
    } catch {
      // keep default dataset version
    }

    const report = runBenchmark(datasetVersion);

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Не удалось запустить бенчмарк",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 500 },
    );
  }
}
