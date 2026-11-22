import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

type MuscleGroup =
  | "Chest"
  | "Back"
  | "Shoulders"
  | "Legs"
  | "Arms"
  | "Core"
  | "Cardio"
  | "Other";

interface SeedExerciseRow {
  external_id: string;
  source_name: "ExerciseDB" | "FreeExerciseDB";
  name: string;
  muscle_group: MuscleGroup;
  target_muscles: string[];
  secondary_muscles: string[];
  equipment: string;
  instructions: string[];
  gif_url: string | null;
  image_urls: string[];
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toTitleCase = (str: string) =>
  str.trim().replace(/\b\w/g, (c) => c.toUpperCase());

function normalizeMuscleGroup(candidates: string[]): MuscleGroup {
  const joined = candidates.join(" ").toLowerCase();

  if (/\b(chest|pectorals|pectoralis)\b/.test(joined)) return "Chest";
  if (
    /\b(back|lats|latissimus|traps|trapezius|middle back|lower back|neck|erector spinae|rhomboids)\b/.test(
      joined,
    )
  )
    return "Back";
  if (/\b(shoulders|delts|deltoids)\b/.test(joined)) return "Shoulders";
  if (
    /\b(upper legs|lower legs|quadriceps|quads|hamstrings|glutes|calves|adductors|abductors|thighs)\b/.test(
      joined,
    )
  )
    return "Legs";
  if (/\b(upper arms|lower arms|biceps|triceps|forearms)\b/.test(joined))
    return "Arms";
  if (/\b(waist|abdominals|abs|core|obliques)\b/.test(joined)) return "Core";
  if (/\b(cardio|cardiovascular)\b/.test(joined)) return "Cardio";
  return "Other";
}

async function fetchWithRetry(url: string, retries = 4): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      const waitMs = 5000 * attempt;
      console.warn(
        `Rate limited (429). Waiting ${waitMs / 1000}s before retry ${attempt}/${retries}...`,
      );
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res;
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

async function fetchFromExerciseDB(): Promise<SeedExerciseRow[]> {
  const rows: SeedExerciseRow[] = [];
  const seenIds = new Set<string>();
  let cursor: string | null = null;
  let hasNext = true;

  console.log("Fetching exercises from ExerciseDB V1...");

  while (hasNext) {
    const url = cursor
      ? `https://oss.exercisedb.dev/api/v1/exercises?after=${encodeURIComponent(cursor)}&limit=25`
      : `https://oss.exercisedb.dev/api/v1/exercises?limit=25`;
    const res = await fetchWithRetry(url);
    const json = (await res.json()) as {
      success: boolean;
      meta?: { total?: number; hasNextPage?: boolean; nextCursor?: string };
      data?: {
        exerciseId: string;
        name: string;
        gifUrl?: string;
        bodyParts?: string[];
        equipments?: string[];
        targetMuscles?: string[];
        secondaryMuscles?: string[];
        instructions?: string[];
      }[];
    };

    const items = json.data ?? [];
    let addedThisPage = 0;

    for (const item of items) {
      if (seenIds.has(item.exerciseId)) continue;
      seenIds.add(item.exerciseId);
      addedThisPage++;

      const bodyParts = item.bodyParts ?? [];
      const targetMuscles = item.targetMuscles ?? [];
      rows.push({
        external_id: `edb_${item.exerciseId}`,
        source_name: "ExerciseDB",
        name: toTitleCase(item.name),
        muscle_group: normalizeMuscleGroup([...bodyParts, ...targetMuscles]),
        target_muscles: targetMuscles.map(toTitleCase),
        secondary_muscles: (item.secondaryMuscles ?? []).map(toTitleCase),
        equipment: item.equipments?.[0]
          ? toTitleCase(item.equipments[0])
          : "Bodyweight",
        instructions: (item.instructions ?? []).map((step) =>
          step.replace(/^Step:\s*\d+\s*/i, "").trim(),
        ),
        gif_url: item.gifUrl ?? null,
        image_urls: [],
      });
    }

    console.log(
      `  Fetched ${rows.length}${json.meta?.total ? ` / ${json.meta.total}` : ""} exercises...`,
    );

    const nextCursor = json.meta?.nextCursor ?? null;
    hasNext = Boolean(json.meta?.hasNextPage) && Boolean(nextCursor) && addedThisPage > 0;
    cursor = nextCursor;

    if (hasNext) await sleep(600);
  }

  return rows;
}

async function fetchFromFreeExerciseDB(): Promise<SeedExerciseRow[]> {
  console.log("Fetching fallback exercises from Free Exercise DB...");
  const url =
    "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
  const imagePrefix =
    "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

  const res = await fetchWithRetry(url);
  const items = (await res.json()) as {
    id: string;
    name: string;
    equipment?: string | null;
    category?: string | null;
    primaryMuscles?: string[];
    secondaryMuscles?: string[];
    instructions?: string[];
    images?: string[];
  }[];

  return items.map((item) => {
    const primary = item.primaryMuscles ?? [];
    const category = item.category ? [item.category] : [];
    return {
      external_id: `fedb_${item.id}`,
      source_name: "FreeExerciseDB",
      name: item.name.trim(),
      muscle_group: normalizeMuscleGroup([...primary, ...category]),
      target_muscles: primary.map(toTitleCase),
      secondary_muscles: (item.secondaryMuscles ?? []).map(toTitleCase),
      equipment: item.equipment ? toTitleCase(item.equipment) : "Bodyweight",
      instructions: item.instructions ?? [],
      gif_url: null,
      image_urls: (item.images ?? []).map((img) => `${imagePrefix}${img}`),
    };
  });
}

async function upsertInBatches(rows: SeedExerciseRow[]) {
  const batchSize = 200;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from("exercises")
      .upsert(batch, { onConflict: "external_id" });

    if (error) {
      throw new Error(`Supabase upsert error at batch ${i}: ${error.message}`);
    }
    console.log(
      `  Upserted ${Math.min(i + batchSize, rows.length)} / ${rows.length}`,
    );
  }
}

async function enrichWithWgerVideos() {
  console.log("Enriching matching exercises with Wger videos...");
  const videoMap = new Map<string, string>();
  let nextUrl: string | null =
    "https://wger.de/api/v2/exerciseinfo/?language=2&limit=100";

  while (nextUrl) {
    const res = await fetchWithRetry(nextUrl);
    const json = (await res.json()) as {
      next: string | null;
      results: {
        translations?: { language: number; name: string }[];
        videos?: { video: string }[];
      }[];
    };

    for (const item of json.results) {
      const videoUrl = item.videos?.[0]?.video;
      const enName = item.translations?.find((t) => t.language === 2)?.name;
      if (videoUrl && enName) {
        videoMap.set(enName.trim().toLowerCase(), videoUrl);
      }
    }

    nextUrl = json.next;
    if (nextUrl) await sleep(300);
  }

  const { data: existing, error } = await supabase
    .from("exercises")
    .select("id, name, video_url");
  if (error) throw new Error(error.message);

  let updated = 0;
  for (const row of existing ?? []) {
    if (row.video_url) continue;
    const match = videoMap.get(row.name.trim().toLowerCase());
    if (match) {
      await supabase
        .from("exercises")
        .update({ video_url: match })
        .eq("id", row.id);
      updated++;
    }
  }
  console.log(`  Enriched ${updated} exercises with Wger videos.`);
}

async function main() {
  const useFallbackOnly = process.argv.includes("--fallback");
  const enrichVideos = process.argv.includes("--enrich-videos");

  let rows: SeedExerciseRow[] = [];

  if (!useFallbackOnly) {
    try {
      rows = await fetchFromExerciseDB();
    } catch (err) {
      console.warn(
        "ExerciseDB failed, switching to Free Exercise DB fallback:",
        err,
      );
    }
  }

  if (rows.length === 0) {
    rows = await fetchFromFreeExerciseDB();
  }

  console.log(`Upserting ${rows.length} verified exercises into Supabase...`);
  await upsertInBatches(rows);

  if (enrichVideos) {
    await enrichWithWgerVideos();
  }

  console.log("Done! Your exercises table is seeded.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
