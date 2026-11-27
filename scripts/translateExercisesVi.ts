import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

interface ExerciseInstructionRow {
  id: string;
  name: string;
  instructions: string[] | null;
  instructions_vi: string[] | null;
}

const DELIMITER = "\n[[999]]\n";
const MAX_BATCH_STEPS = 30;
const MAX_BATCH_CHARS = 3500;
const CONCURRENCY = 1;
const BATCH_DELAY_MS = 700;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env"
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSchemaReady(): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { error } = await supabase
      .from("exercises")
      .select("id, instructions_vi")
      .limit(1);

    if (!error) return;

    console.warn(
      `Schema cache check attempt ${attempt}/5 failed (${error.message}). Retrying in 1.5s...`
    );
    if (attempt < 5) {
      await sleep(1500);
    } else {
      throw new Error(`PostgREST schema not ready: ${error.message}`);
    }
  }
}

async function fetchTranslateRaw(text: string, retries = 5): Promise<string> {
  if (!text.trim()) return "";

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(
    text
  )}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        const waitMs = 5000 * attempt;
        console.warn(
          `Translate API HTTP ${res.status}. Waiting ${waitMs}ms before retry ${attempt}/${retries}...`
        );
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Translate API HTTP ${res.status}`);
      }

      const data = (await res.json()) as unknown[];
      const segments = Array.isArray(data[0]) ? (data[0] as [string][]) : [];
      const joined = segments
        .map((seg) => (Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""))
        .join("")
        .trim();

      if (!joined) {
        throw new Error("Empty translation response");
      }

      return joined;
    } catch (err) {
      if (attempt >= retries) {
        throw err;
      }
      const waitMs = 2000 * attempt;
      console.warn(
        `Translate request error (attempt ${attempt}/${retries}): ${
          err instanceof Error ? err.message : String(err)
        }. Retrying in ${waitMs}ms...`
      );
      await sleep(waitMs);
    }
  }

  throw new Error("Exceeded translation retries");
}

async function translateSingleBatch(steps: string[]): Promise<string[]> {
  if (steps.length === 0) return [];
  if (steps.length === 1) {
    const translated = await fetchTranslateRaw(steps[0]);
    return [translated.trim()];
  }

  const joined = steps.join(DELIMITER);
  const full = await fetchTranslateRaw(joined);
  const parts = full.split(/\s*\[\[999\]\]\s*/).map((p) => p.trim());

  const valid =
    parts.length === steps.length &&
    parts.every((p) => p.length > 0 && !p.includes("[[999]]"));

  if (valid) {
    return parts;
  }

  console.warn(
    `  Batch delimiter mismatch (expected ${steps.length}, got ${parts.length}); falling back to individual steps.`
  );
  const fallback: string[] = [];
  for (const step of steps) {
    fallback.push((await fetchTranslateRaw(step)).trim());
    await sleep(80);
  }
  return fallback;
}

/**
 * Translates an array of instruction steps to Vietnamese using bounded batch sizes
 * and automatic individual-step fallback on delimiter mismatch.
 * Preserves empty steps without hitting the translation API.
 */
async function translateBatchToVi(steps: string[]): Promise<string[]> {
  if (steps.length === 0) return [];

  const nonEmptyIndices: number[] = [];
  const nonEmptySteps: string[] = [];
  steps.forEach((rawStep, idx) => {
    const trimmed = rawStep.trim();
    if (trimmed.length > 0) {
      nonEmptyIndices.push(idx);
      nonEmptySteps.push(trimmed);
    }
  });

  if (nonEmptySteps.length === 0) {
    return steps.map(() => "");
  }

  const translatedNonEmpty: string[] = [];
  let chunk: string[] = [];
  let chunkChars = 0;

  for (const step of nonEmptySteps) {
    const stepLen = step.length;
    const wouldExceed =
      chunk.length >= MAX_BATCH_STEPS ||
      (chunk.length > 0 && chunkChars + DELIMITER.length + stepLen > MAX_BATCH_CHARS);

    if (wouldExceed) {
      translatedNonEmpty.push(...(await translateSingleBatch(chunk)));
      chunk = [];
      chunkChars = 0;
    }

    chunk.push(step);
    chunkChars += (chunk.length > 1 ? DELIMITER.length : 0) + stepLen;
  }

  if (chunk.length > 0) {
    translatedNonEmpty.push(...(await translateSingleBatch(chunk)));
  }

  const result = steps.map(() => "");
  nonEmptyIndices.forEach((origIdx, i) => {
    result[origIdx] = translatedNonEmpty[i] ?? "";
  });

  return result;
}

async function fetchAllExercises(): Promise<ExerciseInstructionRow[]> {
  const pageSize = 1000;
  const allRows: ExerciseInstructionRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("exercises")
      .select("id, name, instructions, instructions_vi")
      .order("name", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch exercises: ${error.message}`);
    }

    const chunk = (data ?? []) as ExerciseInstructionRow[];
    allRows.push(...chunk);

    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

function buildWorkBatches(rows: ExerciseInstructionRow[]): ExerciseInstructionRow[][] {
  const batches: ExerciseInstructionRow[][] = [];
  let current: ExerciseInstructionRow[] = [];
  let currentSteps = 0;
  let currentChars = 0;

  for (const row of rows) {
    const steps = row.instructions ?? [];
    const rowSteps = steps.length;
    const rowChars =
      steps.reduce((sum, s) => sum + s.trim().length, 0) +
      Math.max(0, rowSteps - 1) * DELIMITER.length;

    const wouldExceed =
      current.length > 0 &&
      (currentSteps + rowSteps > MAX_BATCH_STEPS ||
        currentChars + DELIMITER.length + rowChars > MAX_BATCH_CHARS);

    if (wouldExceed) {
      batches.push(current);
      current = [];
      currentSteps = 0;
      currentChars = 0;
    }

    current.push(row);
    currentSteps += rowSteps;
    currentChars += (current.length > 1 ? DELIMITER.length : 0) + rowChars;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

async function main() {
  const force = process.argv.includes("--force");

  await waitForSchemaReady();
  const allRows = await fetchAllExercises();

  const pending = allRows.filter((row) => {
    const en = row.instructions ?? [];
    if (en.length === 0) return false;
    if (force) return true;
    const vi = row.instructions_vi ?? [];
    return vi.length !== en.length;
  });

  console.log(
    `Loaded ${allRows.length} exercises. Pending Vietnamese translation: ${pending.length}.`
  );

  if (pending.length === 0) {
    console.log("Nothing to backfill. Exiting.");
    return;
  }

  const batches = buildWorkBatches(pending);
  let nextBatchIdx = 0;
  let completedCount = 0;
  let nextLogAt = 100;

  async function worker() {
    while (true) {
      const idx = nextBatchIdx++;
      if (idx >= batches.length) break;

      const batch = batches[idx];
      const flatSteps: string[] = [];
      for (const row of batch) {
        flatSteps.push(...(row.instructions ?? []));
      }

      const translatedAll = await translateBatchToVi(flatSteps);
      if (translatedAll.length !== flatSteps.length) {
        throw new Error(
          `Translated length mismatch in batch ${idx}: expected ${flatSteps.length}, got ${translatedAll.length}`
        );
      }

      let offset = 0;
      const updates: { id: string; instructions_vi: string[] }[] = [];
      for (const row of batch) {
        const count = (row.instructions ?? []).length;
        updates.push({
          id: row.id,
          instructions_vi: translatedAll.slice(offset, offset + count),
        });
        offset += count;
      }

      for (const item of updates) {
        const { error } = await supabase
          .from("exercises")
          .update({ instructions_vi: item.instructions_vi })
          .eq("id", item.id);

        if (error) {
          throw new Error(
            `Supabase update failed for exercise ${item.id}: ${error.message}`
          );
        }
      }

      completedCount += batch.length;
      if (completedCount >= nextLogAt || completedCount === pending.length) {
        console.log(`  Backfilled ${completedCount} / ${pending.length} exercises...`);
        while (nextLogAt <= completedCount) nextLogAt += 100;
      }

      await sleep(BATCH_DELAY_MS);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker())
  );

  console.log(`Done! Backfilled ${completedCount} exercises with instructions_vi.`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
