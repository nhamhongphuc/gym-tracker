# SPEC.md — Personal Gym Tracker (React Native + Expo + Supabase)

## 1. Project Summary & Non-Negotiable Constraints

A fast, ultra-lightweight personal cross-platform mobile app (iOS & Android) for managing daily gym splits, viewing verified exercise form instructions/GIFs/videos, and logging daily sets (`weight_kg` × `reps`).

### Core Architectural Constraints

1. **Ultra-Lightweight Binary (Under 15 MB):**
   - **Lightweight Styling (Uniwind + Tailwind CSS v4):** Do NOT install heavy runtime UI component kits (NativeBase, Tamagui, Gluestack, etc.). Use **Uniwind** (`uniwind` + `tailwindcss` v4) for build-time Tailwind CSS utility classes (`className`), paired with `@theme` design tokens in `src/global.css` and raw token constants in `src/constants/theme.ts` (for icon colors, navigation options, and native props that require raw values).
   - **No bundled media assets:** Never bundle local GIFs, MP4s, or large images inside `assets/`. Stream external verified media via `expo-image` with `cachePolicy="disk"` so viewed exercises cache automatically for instant offline playback at the gym.
   - **Built-in native APIs:** Use React Native's built-in `Vibration` API for rest-timer alerts instead of adding extra audio/haptic libraries.
2. **Zero Data Loss Across Reinstalls & Devices:**
   - The app runs on both **iOS** (Xcode iOS Simulator or physical iPhone, including free Apple ID 7-day Release re-signing) and **Android** (Android Studio Emulator or physical device).
   - **Supabase PostgreSQL** is the single source of truth so all splits, custom exercises, saved video links, and set logs stay synced across devices and survive unlimited app reinstalls.
3. **Gym-Floor Offline Resilience:**
   - Cache the weekly split and exercise library in `AsyncStorage` on every successful fetch.
   - Apply optimistic UI updates when logging sets. If a network write fails inside the gym, enqueue the operation in `AsyncStorage` (`@gym_offline_queue`) and flush automatically on app foreground or manual sync tap.
4. **Strict Anti-Hallucination Data Policy (Trusted Sources Only):**
   - **DO NOT** manually write, invent, or generate exercise names, form instructions, GIF URLs, or video URLs in SQL files, JSON fixtures, or TypeScript code.
   - All catalog exercises **MUST** be ingested via `scripts/seedExercises.ts` directly from verified public datasets (**ExerciseDB V1 Free API** primary, **Free Exercise DB** fallback, and optional **Wger API** video enrichment).
   - Display required source attribution (`"Exercise data & GIFs provided by AscendAPI (ExerciseDB)"`) in the Exercise Library and Exercise Detail screens.
5. **Cross-Platform Parity (iOS & Android):**
   - Configure both `ios.bundleIdentifier` and `android.package` in `app.json`.
   - Explicitly handle platform differences: `react-native-safe-area-context` for iOS notches/home indicator and Android status/navigation bars, platform-aware `KeyboardAvoidingView`, iOS `shadow*` vs. Android `elevation`, Android hardware/gesture Back navigation, and platform-aware `Vibration` patterns.

---

## 2. Tech Stack & Project Initialization

- **Framework:** Expo SDK 58+ (`expo`, `react`, `react-native`) with **Expo Router**
- **Language:** TypeScript (`strict: true`)
- **Styling:** `uniwind` + `tailwindcss` (v4) — build-time Tailwind CSS `className` utilities via Metro (`withUniwindConfig`), zero Babel plugins, compatible with Expo Go & React 19
- **Database:** `@supabase/supabase-js` (Supabase Free Tier PostgreSQL)
- **Media Caching:** `expo-image` (native animated GIF playback + automatic disk caching)
- **Vector Graphics:** `react-native-svg` (interactive Front & Back anatomical muscle heatmap)
- **Localization (i18n):** `expo-localization` + typed `src/i18n/` (`en` / `vi` UI, `EN | VI` header toggle, Vietnamese YouTube search & cached instruction translation while keeping exercise names in English)
- **Local Storage / Offline Queue:** `@react-native-async-storage/async-storage`
- **Icons:** `@expo/vector-icons` (`Ionicons`)
- **Seeding Tooling (devDependencies only — excluded from app bundle):** `tsx`, `dotenv`

### Initialization Commands

```bash
npx create-expo-app@latest gym-tracker
cd gym-tracker
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage expo-image @expo/vector-icons react-native-svg expo-localization
npm install uniwind tailwindcss
npm install -D tsx dotenv
```

### Environment Variables (`.env` & `.env.example`)

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

---

## 3. Target Repository Structure

```text
gym-tracker/
├── .env                          # Local Supabase credentials (gitignored)
├── .env.example                  # Template committed to repo
├── SPEC.md                       # This specification file
├── app.json                      # Expo config (iOS bundleIdentifier, Android package, dark UI style)
├── metro.config.js               # Expo Metro config wrapped with withUniwindConfig
├── eslint.config.js              # Expo flat ESLint configuration
├── package.json
├── tsconfig.json                 # Path alias @/* -> ./src/*
├── supabase/
│   └── schema.sql                # Authoritative Postgres schema & 7-day split skeleton
├── scripts/
│   ├── seedExercises.ts          # Verified dataset ingester (ExerciseDB + FreeExerciseDB + Wger video match)
│   └── translateExercisesVi.ts   # Resumable EN->VI backfill for exercises.instructions_vi in Supabase
└── src/
    ├── global.css                # Tailwind v4 + Uniwind entry & @theme OLED Neon-Lime color tokens
    ├── uniwind-types.d.ts        # Auto-generated Uniwind TypeScript definitions (via Metro)
    ├── constants/
    │   └── theme.ts              # Raw color constants, touch targets, and cross-platform shadows
    ├── i18n/
    │   ├── en.ts                 # Master English translation dictionary & TranslationSchema
    │   ├── vi.ts                 # Vietnamese gym translation dictionary
    │   └── LanguageContext.tsx   # Locale provider (expo-localization + AsyncStorage + tMuscle/tEquipment)
    ├── types/
    │   └── database.ts           # Strict TypeScript interfaces matching Supabase tables
    ├── lib/
    │   ├── supabase.ts           # Supabase client configured with AsyncStorage
    │   ├── offlineQueue.ts       # AsyncStorage cache, client UUIDs & failed-write retry queue
    │   ├── api.ts                # All Supabase CRUD queries + programs/rolling queues + PR stats
    │   ├── programTemplates.ts   # Verified starter split presets & short-label helper
    │   └── smartCoach.ts         # Smart Trainer overload math, 30-day muscle analytics & swap ranker
    ├── components/
    │   ├── LanguageToggle.tsx    # Compact EN | VI pill toggle in top headers
    │   ├── ProgramManagerModal.tsx   # Switch/create Rolling & Weekly programs & starter presets
    │   ├── RestTimerBar.tsx      # Floating countdown capsule (-15s, +15s, Skip, Vibration on 0)
    │   ├── SetRow.tsx            # Circular set badge, previous ghost value, kg/reps inputs, checkmark
    │   ├── MuscleBodyMap.tsx     # Interactive Front & Back SVG anatomical muscle heatmap
    │   ├── ExercisePickerModal.tsx   # Searchable modal with muscle/equipment filters & GIF thumbnails
    │   └── CustomExerciseModal.tsx   # Modal to add a personal custom exercise to Supabase
    └── app/
        ├── _layout.tsx           # Root Stack (imports ../global.css, hosts "(tabs)" and "exercise/[id]")
        ├── (tabs)/
        │   ├── _layout.tsx       # 4-tab OLED bottom navigation bar
        │   ├── index.tsx         # Tab 1: Active Workout Logger + Smart Trainer + Mid-Workout Swap
        │   ├── plan.tsx          # Tab 2: Weekly Split Plan Builder (Mon–Sun)
        │   ├── exercises.tsx     # Tab 3: Verified Exercise Library (Muscle + Equipment filters)
        │   └── history.tsx       # Tab 4: History Overview Bar Chart & Anatomical Muscles/Recovery
        └── exercise/
            └── [id].tsx          # Modal: GIF/Images, Video Link Editor, Instructions, Muscle Chips & PR History
```

---

## 4. Database Schema (`supabase/schema.sql`)

Run this script once in the **Supabase SQL Editor**. It creates all 5 relational tables, performance indexes, single-user RLS policies, and the 7-day weekly split skeleton (without hardcoding any invented exercise instructions).

```sql
-- ============================================================
-- 1. EXERCISES (Populated strictly via scripts/seedExercises.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,                        -- e.g., 'edb_EIeI8Vf' | 'fedb_Barbell_Bench_Press' | null for custom
  source_name TEXT NOT NULL DEFAULT 'ExerciseDB', -- 'ExerciseDB' | 'FreeExerciseDB' | 'Custom'
  name TEXT NOT NULL,
  muscle_group TEXT NOT NULL,                     -- 'Chest' | 'Back' | 'Shoulders' | 'Legs' | 'Arms' | 'Core' | 'Cardio' | 'Other'
  target_muscles TEXT[] NOT NULL DEFAULT '{}',
  secondary_muscles TEXT[] NOT NULL DEFAULT '{}',
  equipment TEXT NOT NULL DEFAULT 'Bodyweight',
  instructions TEXT[] NOT NULL DEFAULT '{}',
  instructions_vi TEXT[] NOT NULL DEFAULT '{}',
  tips TEXT,                                      -- Optional personal user form cue
  gif_url TEXT,                                   -- Verified looping GIF from ExerciseDB CDN
  image_urls TEXT[] NOT NULL DEFAULT '{}',        -- Verified posture frames from Free Exercise DB
  video_url TEXT,                                 -- Verified Wger video URL or user-saved YouTube coaching link
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. WORKOUT PROGRAMS (Rolling Queue or Fixed Mon-Sun Weekly Splits)
-- ============================================================
CREATE TABLE IF NOT EXISTS workout_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  schedule_mode TEXT NOT NULL DEFAULT 'rolling' CHECK (schedule_mode IN ('rolling', 'weekly')),
  is_active BOOLEAN NOT NULL DEFAULT false,
  next_routine_id UUID,
  schedule_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. PROGRAM ROUTINES (Ordered routines inside a program)
-- ============================================================
CREATE TABLE IF NOT EXISTS program_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
  order_index INT NOT NULL DEFAULT 0,
  day_of_week INT CHECK (day_of_week BETWEEN 1 AND 7),
  short_label TEXT,
  name TEXT NOT NULL,
  is_rest_day BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. ROUTINE EXERCISES (Ordered exercises assigned to each routine)
-- ============================================================
CREATE TABLE IF NOT EXISTS routine_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id UUID NOT NULL REFERENCES program_routines(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  order_index INT NOT NULL DEFAULT 0,
  target_sets INT NOT NULL DEFAULT 3,
  target_reps TEXT NOT NULL DEFAULT '8-12',
  rest_seconds INT NOT NULL DEFAULT 90
);

-- ============================================================
-- 5. WORKOUT SESSIONS (Individual gym visits)
-- ============================================================
CREATE TABLE IF NOT EXISTS workout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID,
  routine_id UUID REFERENCES program_routines(id) ON DELETE SET NULL,
  plan_name_snapshot TEXT NOT NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  notes TEXT
);

-- ============================================================
-- 5. SET LOGS (Every performed set: weight_kg x reps)
-- ============================================================
CREATE TABLE IF NOT EXISTS set_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  set_number INT NOT NULL,
  set_type TEXT NOT NULL DEFAULT 'working' CHECK (set_type IN ('warmup', 'working', 'dropset', 'failure')),
  weight_kg NUMERIC(6,2) NOT NULL DEFAULT 0,
  reps INT NOT NULL DEFAULT 0,
  rpe NUMERIC(3,1),
  is_completed BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises (name);
CREATE INDEX IF NOT EXISTS idx_exercises_muscle_group ON exercises (muscle_group);
CREATE INDEX IF NOT EXISTS idx_plan_exercises_plan_order ON plan_exercises (plan_id, order_index ASC);
CREATE INDEX IF NOT EXISTS idx_set_logs_exercise_created ON set_logs (exercise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_set_logs_session ON set_logs (session_id, exercise_id, set_number ASC);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_date ON workout_sessions (session_date DESC);

-- ============================================================
-- ROW LEVEL SECURITY (Personal Single-User Mode)
-- ============================================================
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE set_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Personal full access exercises" ON exercises;
DROP POLICY IF EXISTS "Personal full access workout_plans" ON workout_plans;
DROP POLICY IF EXISTS "Personal full access plan_exercises" ON plan_exercises;
DROP POLICY IF EXISTS "Personal full access workout_sessions" ON workout_sessions;
DROP POLICY IF EXISTS "Personal full access set_logs" ON set_logs;

CREATE POLICY "Personal full access exercises" ON exercises FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Personal full access workout_plans" ON workout_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Personal full access plan_exercises" ON plan_exercises FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Personal full access workout_sessions" ON workout_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Personal full access set_logs" ON set_logs FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 7-DAY WEEKLY SPLIT SKELETON
-- ============================================================
INSERT INTO workout_plans (day_of_week, name, is_rest_day, notes) VALUES
(1, 'Push (Chest, Shoulders, Triceps)', false, 'Finish with 15-20 min Incline Treadmill Walk (8-12% incline, 4.5-5.5 km/h)'),
(2, 'Pull (Back, Rear Delts, Biceps)', false, 'Finish with 15-20 min Incline Treadmill Walk (8-12% incline, 4.5-5.5 km/h)'),
(3, 'Heavy Legs (Quads & Hamstrings)', false, 'Focus on progressive overload and 2-3 min rest on compound lifts'),
(4, 'Rest & Recovery', true, 'Active recovery, stretching, mobility'),
(5, 'Upper Body Hypertrophy', false, 'Finish with 15-20 min Incline Treadmill Walk (8-12% incline, 4.5-5.5 km/h)'),
(6, 'Light Legs + Core', false, 'Controlled tempo, higher reps, core work'),
(7, 'Rest Day', true, 'Full recovery and weekly prep')
ON CONFLICT (day_of_week) DO NOTHING;
```

---

## 5. Trusted Exercise Data Pipeline (`scripts/seedExercises.ts`)

Run once from your MacBook terminal (`npx tsx scripts/seedExercises.ts`) after executing `supabase/schema.sql`.

### Data Source Hierarchy

1. **Primary — ExerciseDB V1 Free API (AscendAPI):**
   - Endpoint: `https://oss.exercisedb.dev/api/v1/exercises?offset={offset}&limit=100`
   - Provides: ~1,500 verified exercises, step-by-step `instructions[]`, `bodyParts[]`, `targetMuscles[]`, `secondaryMuscles[]`, `equipments[]`, and CDN-hosted 180p looping `gifUrl`.
   - Must handle HTTP `429` rate limits gracefully with exponential/5-second backoff and `600ms` delay between pages.
   - Strip `"Step:1 "` prefixes from instruction strings during normalization.
2. **Fallback / Secondary (`--fallback` or automatic if ExerciseDB is unreachable) — Free Exercise DB:**
   - Endpoint: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`
   - Image URL prefix: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/`
   - Provides: 800+ public-domain exercises with verified instructions and start/finish posture photos (`image_urls`).
3. **Optional Open-Source Video Enrichment (`--enrich-videos`) — Wger ExerciseInfo API:**
   - Endpoint: `https://wger.de/api/v2/exerciseinfo/?language=2&limit=100`
   - Matches normalized lowercase exercise names against existing Supabase `exercises` rows and populates `video_url` whenever a verified Wger video exists (`videos[0].video`).

### Muscle Group Normalization Map

Map incoming API body parts/muscles cleanly into 8 buckets:

- `Chest` (`chest`, `pectorals`)
- `Back` (`back`, `lats`, `traps`, `middle back`, `lower back`, `neck`)
- `Shoulders` (`shoulders`, `delts`)
- `Legs` (`upper legs`, `lower legs`, `quadriceps`, `hamstrings`, `glutes`, `calves`, `adductors`, `abductors`)
- `Arms` (`upper arms`, `lower arms`, `biceps`, `triceps`, `forearms`)
- `Core` (`waist`, `abdominals`, `abs`, `core`)
- `Cardio` (`cardio`)
- `Other` (fallback)

### Upsert Strategy

- Always upsert using `{ onConflict: 'external_id' }` so re-running the script updates records cleanly without creating duplicates or wiping user-saved `video_url` / `tips`.

### Vietnamese Instruction Backfill (`scripts/translateExercisesVi.ts`)

- Run `npx tsx scripts/translateExercisesVi.ts` (resumable; pass `--force` to overwrite existing rows) to batch-translate `exercises.instructions[]` into `exercises.instructions_vi[]` directly in Supabase.

---

## 6. TypeScript Data Models (`types/database.ts`)

```typescript
export type MuscleGroup =
  | "Chest"
  | "Back"
  | "Shoulders"
  | "Legs"
  | "Arms"
  | "Core"
  | "Cardio"
  | "Other";

export type SetType = "warmup" | "working" | "dropset" | "failure";

export interface Exercise {
  id: string;
  external_id: string | null;
  source_name: "ExerciseDB" | "FreeExerciseDB" | "Custom";
  name: string;
  muscle_group: MuscleGroup;
  target_muscles: string[];
  secondary_muscles: string[];
  equipment: string;
  instructions: string[];
  instructions_vi: string[];
  tips: string | null;
  gif_url: string | null;
  image_urls: string[];
  video_url: string | null;
  created_at?: string;
}

export type ScheduleMode = "rolling" | "weekly";

export interface ProgramScheduleAnchor {
  date: string;
  routineId: string;
}

export type ProgramDateOverride =
  | { kind: "single"; routineId: string | "REST" }
  | { kind: "rest_push" };

export interface ProgramScheduleState {
  anchors?: ProgramScheduleAnchor[];
  overrides?: Record<string, ProgramDateOverride>;
}

export interface WorkoutProgram {
  id: string;
  name: string;
  description: string | null;
  schedule_mode: ScheduleMode;
  is_active: boolean;
  next_routine_id: string | null;
  schedule_state?: ProgramScheduleState | null;
  created_at?: string;
  workout_plans?: WorkoutPlan[];
}

export interface WorkoutPlan {
  id: string;
  program_id: string;
  order_index: number;
  day_of_week: number | null;
  short_label: string | null;
  name: string;
  is_rest_day: boolean;
  notes: string | null;
  plan_exercises?: PlanExerciseWithDetails[];
}

export interface PlanExercise {
  id: string;
  plan_id: string;
  routine_id?: string;
  exercise_id: string;
  order_index: number;
  target_sets: number;
  target_reps: string;
  rest_seconds: number;
}

export interface PlanExerciseWithDetails extends PlanExercise {
  exercise: Exercise;
}

export interface WorkoutSession {
  id: string;
  plan_id: string | null;
  routine_id?: string | null;
  plan_name_snapshot: string;
  session_date: string; // YYYY-MM-DD
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  set_logs?: (SetLog & {
    exercise?: Pick<Exercise, "id" | "name" | "muscle_group">;
  })[];
}

export interface SetLog {
  id?: string;
  session_id: string;
  exercise_id: string;
  set_number: number;
  set_type: SetType;
  weight_kg: number;
  reps: number;
  rpe?: number | null;
  is_completed: boolean;
  created_at?: string;
}

export interface DraftSetRow {
  local_key: string;
  set_number: number;
  set_type: SetType;
  weight_kg: string;
  reps: string;
  prev_weight_kg?: number;
  prev_reps?: number;
  is_completed: boolean;
  saved_log_id?: string;
}

export interface ExercisePRStats {
  maxWeightKg: number;
  bestEstimated1RM: number;
  recentSessions: {
    sessionDate: string;
    sets: {
      set_number: number;
      weight_kg: number;
      reps: number;
      set_type: SetType;
    }[];
  }[];
}
```

---

## 7. Design System & Theme Tokens (`src/global.css` & `src/constants/theme.ts`)

High-contrast OLED pitch-black + Electric Neon Lime gym dark mode inspired by SmartGym, designed for one-handed logging between sets:

- `background`: `#000000` (OLED pitch black)
- `surface`: `#141417` (Elevated dark card)
- `surfaceElevated`: `#1F1F24` (Inputs, secondary pills, floating timer capsule)
- `mediaFrame`: `#F4F4F5` (clean light container for ExerciseDB GIFs)
- `primary`: `#9EFF00` (Electric Neon Lime — active buttons, completed sets, circular day pills, workout bars, PR highlights; pair with `#000000` text on solid fills)
- `primarySubtle`: `rgba(158, 255, 0, 0.14)` (Completed set row tint)
- `accent`: `#0A84FF` (Electric Blue — Smart Trainer progressive overload callouts, rest timer, links)
- `warning`: `#FFD60A` (Amber — warm-up badge, personal cues)
- `purple`: `#BF5AF2` (Dropset badge)
- `danger`: `#FF375F` (Coral-crimson — volume hero card, failure badge, delete actions)
- `textPrimary`: `#FFFFFF`
- `textSecondary`: `#8E8E93`
- `textMuted`: `#48484A` (Ghost placeholders for previous weight/reps)
- `border`: `#26262B`
- **Minimum Interactive Target:** `44px × 44px` (`min-h-11 min-w-11` in Tailwind) on all checkboxes, timer controls, and icons.

### Uniwind Styling Conventions

- Define all color tokens as Tailwind v4 `@theme` variables inside `src/global.css` (e.g., `--color-background: #000000`, `--color-surface: #141417`, `--color-primary: #9EFF00`, `--color-text-primary: #FFFFFF`, etc.) so screens and components use utility classes directly (`className="bg-background text-text-primary"`).
- Keep matching raw constants in `src/constants/theme.ts` (`Colors`, `TouchTarget`, `Shadows`) for native props that do not accept `className` (such as `Ionicons` `color`, Expo Router tab/header options, `placeholderTextColor`, and `Platform.select` shadows).
- Wrap third-party components that only accept `style` (e.g., `SafeAreaView` from `react-native-safe-area-context` or `Image` from `expo-image`) with `withUniwind(...)` from `uniwind` when styling them via `className`.

---

## 8. API & Offline Sync Layer (`lib/`)

### 8.1 `lib/supabase.ts`

Create the Supabase client using `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, configured with `AsyncStorage` and `detectSessionInUrl: false`.

### 8.2 `lib/offlineQueue.ts`

- Cache helpers:
  - `saveCache<T>(key: string, data: T)` / `loadCache<T>(key: string)`
  - Keys: `@cached_weekly_plans`, `@cached_exercises`, `@gym_offline_queue`
- Queue operations:
  - `enqueueOfflineOp(op: { type: 'upsert_set' | 'delete_set' | 'complete_session'; payload: any; queuedAt: string })`
  - `getPendingCount(): Promise<number>`
  - `flushOfflineQueue(): Promise<{ synced: number; remaining: number }>` (called automatically on app foreground via `AppState` listener and on manual badge tap).

### 8.3 `lib/api.ts` Contract

1. `fetchWeeklyPlans(): Promise<WorkoutPlan[]>` — Fetches all 7 days with nested `plan_exercises(*, exercise:exercises(*))` sorted by `day_of_week` and `order_index`. Falls back to `@cached_weekly_plans` if offline.
2. `fetchExercises(filters?: { search?: string; muscleGroup?: string; equipment?: string }): Promise<Exercise[]>` — Fetches exercises ordered alphabetically (supports pagination or full local cache so search feels instant with 0ms lag).
3. `fetchExerciseById(id: string): Promise<Exercise | null>`
4. `createCustomExercise(input: Omit<Exercise, 'id' | 'external_id' | 'source_name'>): Promise<Exercise>` — Inserts with `source_name: 'Custom'`.
5. `updateExerciseMediaAndTips(exerciseId: string, updates: { video_url?: string | null; tips?: string | null }): Promise<Exercise>` — Lets the user attach their favorite trusted YouTube form breakdown URL or personal form cue to any exercise.
6. `getLastPerformedSets(exerciseId: string, excludeSessionId?: string): Promise<SetLog[]>` — Queries the most recent `session_id` in `set_logs` for `exerciseId` (ignoring `excludeSessionId`) and returns all its sets ordered by `set_number ASC`.
7. `getOrCreateTodaySession(plan: WorkoutPlan): Promise<{ session: WorkoutSession; existingLogs: SetLog[] }>` — Resumes today's active uncompleted session if one exists; otherwise creates a new `workout_sessions` row when the user logs their first set.
8. `upsertSetLog(payload: SetLog): Promise<SetLog>` — Upserts to `set_logs`; on network failure, enqueues via `offlineQueue.enqueueOfflineOp` and returns optimistic payload.
9. `deleteSetLog(id: string): Promise<void>`
10. `completeWorkoutSession(sessionId: string, notes?: string): Promise<void>`
11. `updateDayPlanMeta(planId: string, updates: Partial<Pick<WorkoutPlan, 'name' | 'is_rest_day' | 'notes'>>): Promise<void>`
12. `addExerciseToPlan(planId: string, exerciseId: string, orderIndex: number): Promise<PlanExerciseWithDetails>`
13. `updatePlanExercise(id: string, updates: Partial<Pick<PlanExercise, 'target_sets' | 'target_reps' | 'rest_seconds' | 'order_index'>>): Promise<void>`
14. `swapPlanExerciseOrder(a: PlanExercise, b: PlanExercise): Promise<void>`
15. `removePlanExercise(id: string): Promise<void>`
16. `fetchWorkoutHistory(limit = 30): Promise<WorkoutSession[]>`
17. `deleteWorkoutSession(sessionId: string): Promise<void>`
18. `fetchExercisePRStats(exerciseId: string): Promise<ExercisePRStats>` — Computes all-time heaviest `weight_kg`, best estimated 1RM (`weight_kg * (1 + reps / 30)`), and last 5 session dates with sets.

---

## 9. Detailed Screen Specifications

### Tab 1: Today's Active Workout Logger (`src/app/(tabs)/index.tsx`)

- **Editorial Top Bar:**
  - Interactive Active Program pill opening `ProgramManagerModal` (`Rolling Queue` / `Fixed Weekdays` + saved/preset/custom programs).
  - Neon-lime eyebrow (`ROLLING QUEUE • N EXERCISES` or `MONDAY • N EXERCISES`), live elapsed workout timer pill once a session is active, and large bold routine name.
  - **Date-Aware 7-Day Week Strip + 1-Tap Routine Assigner:** Interactive `< Mon..Sun >` calendar showing each date's day number and scheduled routine tag underneath (`PUSH`, `PULL`, `LEGS H`, `UPPER`, `LEGS L`, `Rest`). Tap any date (e.g., tomorrow Friday) and pick any routine chip (`+ Rest`) with **`Shift next days`** (anchors rolling cycle from that date forward so Sat/Sun/Mon shift automatically) or **`This day only`** (single-date override persisted in `workout_programs.schedule_state`).
  - Conditional **Offline Sync Pill** showing pending queued count (tappable to flush immediately).
  - `"Finish"` primary pill (enabled once at least 1 set is completed) opening a cross-platform completion modal for optional session notes and marking `completed_at`.
- **Rest Day Empty State:**
  - If `is_rest_day` is true, display recovery notes plus a `"Log Another Day's Split"` prompt pointing to the `M–S` circle selector.
- **Exercise Cards (`ScrollView` + platform-aware `KeyboardAvoidingView` — `behavior="padding"` on iOS, resize/height handling on Android):**
  - **Header:** Small rounded `expo-image` GIF/thumbnail preview (`48×48`), Exercise index (`1 of N`), Exercise Name, Equipment & Muscle subtitle, Target summary (`3×8-10 • 120s`), **Mid-Workout Swap (`swap-horizontal-outline`)** opening a `"Machine Taken?"` modal ranked by `rankSwapAlternatives`, and **Info Icon (`information-circle-outline`)** opening `/exercise/[id]` without resetting active inputs.
  - **Smart Trainer Progressive Overload Callout:** Powered by `computeSmartSuggestion` in `src/lib/smartCoach.ts` — analyzes previous session sets against `target_reps` to recommend weight bumps (`+2.5kg` / `+2kg`) or rep progression, with a 1-tap **`Apply`** button that pre-fills uncompleted working sets.
  - **Set Rows (`src/components/SetRow.tsx`):**
    - Columns: `SET` | `PREVIOUS` | `KG` | `REPS` | `✓`
    - `SET`: Circular SmartGym badge (`w-9 h-9 rounded-full`). Tapping cycles set type: Working (`1, 2, 3`) -> Warm-up (`W`, Amber) -> Dropset (`D`, Purple) -> Failure (`F`, Coral-Crimson). Completed working circles glow solid neon lime (`#9EFF00`) with black numerals.
    - `PREVIOUS`: Displays ghost text from last session (e.g., `70kg × 8`). Tapping copies both values into the row's `KG` and `REPS` inputs.
    - `KG` & `REPS`: `decimal-pad` (normalizing `,` -> `.`) and `number-pad` inputs with previous session numbers shown as muted placeholders.
    - `✓` Button:
      - If `KG` or `REPS` is blank when tapped, auto-fills from `prev_weight_kg` and `prev_reps`.
      - Persists via `upsertSetLog`, highlights row with `primarySubtle`, and triggers `RestTimerBar` using the exercise's `rest_seconds` (if `rest_seconds > 0`).
      - Tapping a completed `✓` again uncompletes/deletes the saved log.
  - **Card Footer:** `"+ Add Set"` and `"- Remove Set"` actions.
- **Floating Rest Timer (`src/components/RestTimerBar.tsx`):**
  - Floating capsule pinned above the bottom tab bar whenever active.
  - Displays countdown (`MM:SS`), linear progress bar, `"-15s"`, `"+15s"`, and `"Skip"` buttons.
  - Triggers `Vibration.vibrate(...)` at `00:00` (using `Platform.OS` to handle iOS vs. Android pattern array differences cleanly; note that simulators/emulators do not physically vibrate) and auto-dismisses after 2 seconds.

### Tab 2: Program & Split Plan Builder (`src/app/(tabs)/plan.tsx`)

- **Program Bar & Mode Switcher:** Displays active program name, `"Programs"` button opening `ProgramManagerModal`, and a `Rolling Queue` | `Fixed Weekdays` segmented toggle.
- **Slot / Day Tabs:** Horizontal numbered routine chips (`+ Add` slot supported) in `rolling` mode, or circular neon-lime `M`–`S` selector in `weekly` mode.
- **Routine Details Card:**
  - Routine Name `TextInput`, Short Tag (`short_label`) `TextInput`, `"Rest Day"` `Switch`, Day Notes `TextInput`, `"Save Day Settings"` button, plus `"Set as Up Next in Queue"` & `"Delete Routine"` in `rolling` mode.
- **Exercise List (when not a rest day):**
  - Each card shows `expo-image` thumbnail, Exercise order & Name, Muscle/Equipment subtitle, Up/Down reorder buttons (`↑` / `↓`), Remove Trash icon, and 3 compact inline editors:
    - `Sets` (`number-pad`)
    - `Reps` (`default`, e.g., `"8-10"` or `"15-20 min"`)
    - `Rest (s)` (`number-pad`)
  - Edits persist on blur.
- **Bottom Action:** `"Add Exercise to <Day>"` button opening `ExercisePickerModal` (which filters the verified library by search query, muscle group chips, and equipment chips and adds directly to `plan_exercises`).

### Tab 3: Verified Exercise Library (`src/app/(tabs)/exercises.tsx`)

- **Header:** Editorial title + Search bar + horizontal Muscle Group filter chips (`All`, `Chest`, `Back`, `Shoulders`, `Legs`, `Arms`, `Core`, `Cardio`) + horizontal Equipment filter chips (`All`, `Barbell`, `Dumbbell`, `Cable`, `Machine`, `Bodyweight`, `Kettlebell`).
- **Virtualized List (`FlatList`):**
  - Uses `initialNumToRender={15}` and `windowSize={7}` for smooth 60fps scrolling.
  - Each row renders a disk-cached `expo-image` preview (`52×52` inside `mediaFrame`), Exercise Name, Muscle Group & Equipment badges, and a chevron opening `/exercise/[id]`.
  - Footer displays `"Exercise data & GIFs provided by AscendAPI (ExerciseDB)"`.
- **FAB (`+ Custom`):** Opens `CustomExerciseModal` to save custom movements (`name`, `muscle_group`, `equipment`, newline-separated `instructions`, optional `tips`, optional `video_url`).

### Modal: Exercise Detail, Media & PR History (`src/app/exercise/[id].tsx`)

Presented as a native modal screen (`presentation: 'modal'` in `app/_layout.tsx` — native sheet on iOS, slide-up modal with hardware Back support on Android).

1. **Verified Visual Demo Container (`mediaFrame` background):**
   - **If `gif_url` exists:** Render `<Image source={{ uri: exercise.gif_url }} style={styles.gif} contentFit="contain" cachePolicy="disk" />` (auto-loops natively on both iOS and Android).
   - **Else if `image_urls.length > 0`:** Auto-toggle between `image_urls[0]` and `image_urls[1]` every 1.2s with a manual Start/Finish toggle button.
   - **Else:** Clean minimalist placeholder icon.
2. **HD Form Video Bar:**
   - If `exercise.video_url` exists: Primary button `"Watch Verified Form Video"` (opens via `Linking.openURL`) + small `"Edit Link"` icon.
   - If no `video_url`: Button `"+ Attach Form Video URL"` (opens inline text input to paste & save a trusted YouTube URL to Supabase).
   - Always includes secondary button `"Search Form Tutorial on YouTube"` opening `https://www.youtube.com/results?search_query=${encodeURIComponent(locale === 'vi' ? `hướng dẫn tập ${exercise.name} đúng kỹ thuật` : `${exercise.name} proper form tutorial`)}`.
3. **Muscle Breakdown:** Badges for `muscle_group`, `equipment`, `target_muscles`, and `secondary_muscles`.
4. **Verified Step-by-Step Instructions:** Numbered step cards rendered directly from `exercise.instructions_vi[]` in `vi` mode (with an instant `EN`/`VI` toggle) and `exercise.instructions[]` in `en` mode.
5. **Personal Form Cue (`tips`):** Editable amber callout card so you can save your own bench notch or grip reminder per exercise.
6. **Personal Records & Recent Sets:**
   - Two metric boxes: **Heaviest Weight (`kg`)** and **Est. 1RM (`kg`)**.
   - Last 5 workout dates showing all performed sets for this exercise.
7. **Source Attribution:** Small muted footer (`"Source: ExerciseDB (AscendAPI)"` / `"Source: Free Exercise DB"` / `"Custom Exercise"`).

### Tab 4: Workout History & Muscle Analytics (`src/app/(tabs)/history.tsx`)

- **Segmented Switcher (`Overview` | `Muscles & Recovery`):**
  - **Overview View:**
    - **Workouts This Month Hero Card (`#9EFF00`):** Large monthly workout count + **14-Day Vertical Neon-Lime Bar Chart** showing daily volume bars.
    - **Weekly Volume Hero Card (`#FF375F`):** Coral-crimson total `kg` lifted this week + sets count + monthly volume subtitle.
    - **Session History List (`FlatList`):** Reverse-chronological completed sessions showing Date, Plan Name, Duration, Exercise Count, Total Volume, expandable exercise-by-exercise set log breakdown, and Delete Session confirmation (`Alert.alert`).
  - **Muscles & Recovery View:**
    - **Interactive `MuscleBodyMap` (`src/components/MuscleBodyMap.tsx`):** Dual Front & Back anatomical SVG silhouettes glowing in `#9EFF00` proportionally to 30-day set volume; tapping any muscle group filters the breakdown list below.
    - **Muscle Recovery Cards:** Shows 72-hour recovery readiness (`Fresh` / `Recovering` / `Fatigued`), sets & volume, intensity bar, and performed exercise names per muscle group.

---

## 10. Simulators (iOS & Android) & Standalone Device Builds

### 10.1 Local Development (iOS Simulator & Android Emulator)

You can run and test both platforms side-by-side on macOS from a single `npx expo start` session (press `i` for iOS Simulator, `a` for Android Emulator).

- **iOS Simulator (Xcode):**
  1. Point macOS CLI tools to full Xcode:
     ```bash
     sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
     ```
  2. Open Xcode once to accept its license and verify an iOS Simulator runtime is installed (**Xcode -> Settings -> Components**).
  3. Launch the app on Simulator:
     ```bash
     npx expo start --ios
     ```
- **Android Emulator (Android Studio):**
  1. Install **Android Studio** and complete the setup wizard to install the **Android SDK** and **Android SDK Platform-Tools**.
  2. In Android Studio, open **Virtual Device Manager -> Create Device**, pick a phone (e.g., Pixel 8/9), and download a recent system image.
  3. Add the Android SDK paths to `~/.zshrc` and reload your shell (`source ~/.zshrc`):
     ```bash
     export ANDROID_HOME="$HOME/Library/Android/sdk"
     export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"
     ```
  4. Launch the app on Emulator:
     ```bash
     npx expo start --android
     ```

### 10.2 Physical Android Device (Standalone Release Build)

> **IMPORTANT:** For standalone gym use away from your MacBook, always install in **Release** mode so the JS bundle is embedded inside the app binary. A `Debug` build requires Metro running on your MacBook and will fail when disconnected.

1. Enable **Developer Options** and **USB Debugging** on your Android phone and connect via USB.
2. Ensure `android.package` (e.g., `com.personal.gymtracker`) is configured in `app.json`.
3. Build and install standalone Release mode (no 7-day certificate expiry):
   ```bash
   npx expo run:android --device --variant release
   ```

### 10.3 Physical iPhone (USB Release Build & 7-Day Refresh)

> **IMPORTANT:** Always install in **Release** configuration so the JS bundle is embedded inside the app binary. A `Debug` build requires Metro running on your MacBook and will crash at the gym.

#### First-Time Setup (USB Cable)

1. Enable **Developer Mode** on iPhone (_Settings -> Privacy & Security -> Developer Mode_).
2. Run native prebuild and configure signing in Xcode:
   ```bash
   npx expo prebuild --platform ios
   xed ios
   ```
3. In Xcode: select the app target -> **Signing & Capabilities** -> pick your personal Apple ID (**Personal Team**) and set a unique **Bundle Identifier** (e.g., `com.personal.gymtracker`).
4. Build and install standalone Release mode to your plugged-in iPhone:
   ```bash
   npx expo run:ios --device --configuration Release
   ```
5. On iPhone: _Settings -> General -> VPN & Device Management_ -> tap your Apple ID -> **Trust**.

#### 7-Day Free Certificate Refresh (No Cable Needed)

1. In Xcode, open **Window -> Devices and Simulators**, select your iPhone, and check **"Connect via network"**.
2. Every 7 days when the certificate expires, make sure MacBook and iPhone are on the same Wi-Fi and press **Run (`Cmd + R`)** in Xcode (with Run Build Configuration set to `Release`) or run `npx expo run:ios --device --configuration Release`. All workout data stays intact in Supabase.

---

## 11. Phased Implementation Plan & Verification Gates (For AI Agent)

Execute sequentially and verify after each phase:

- **Phase 1 — Project Setup, Schema & Seed Pipeline**
  - Install dependencies (`@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `expo-image`, `@expo/vector-icons`, `uniwind`, `tailwindcss`, and devDeps `tsx`, `dotenv`).
  - Configure `metro.config.js` with `withUniwindConfig` (`cssEntryFile: './src/global.css'`, `dtsFile: './src/uniwind-types.d.ts'`).
  - Create `.env.example`, `supabase/schema.sql`, `scripts/seedExercises.ts`, `src/global.css`, `src/constants/theme.ts`, and `src/types/database.ts`.
  - Verify `scripts/seedExercises.ts` contains **zero** hardcoded/invented exercises and cleanly handles ExerciseDB rate limits (`429`) + Free Exercise DB fallback + Wger video enrichment.
- **Phase 2 — Data & Offline Sync Layer**
  - Implement `src/lib/supabase.ts`, `src/lib/offlineQueue.ts`, and `src/lib/api.ts`.
  - Verify all TypeScript types compile with `npx tsc --noEmit`.
- **Phase 3 — Navigation, Exercise Library & Detail Modal**
  - Implement `src/app/_layout.tsx` (importing `../global.css`), `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/exercises.tsx`, `src/components/CustomExerciseModal.tsx`, and `src/app/exercise/[id].tsx` (including `expo-image` disk-cached GIFs, 2-frame image fallback, inline `video_url` & `tips` editor, YouTube form link, PR stats, and AscendAPI attribution).
- **Phase 4 — Weekly Split Plan Builder**
  - Implement `src/components/ExercisePickerModal.tsx` and `src/app/(tabs)/plan.tsx` with Mon–Sun tabs, rest-day toggle, inline sets/reps/rest editing, and up/down reordering.
- **Phase 5 — Active Workout Logger & History**
  - Implement `src/components/SetRow.tsx`, `src/components/RestTimerBar.tsx`, `src/app/(tabs)/index.tsx` (ghost previous pre-fill, 1-tap complete, vibration timer, offline queue flush), and `src/app/(tabs)/history.tsx`.
- **Phase 6 — Final Audit & Verification**
  - Run `npx tsc --noEmit` -> **must exit with 0 errors**.
  - Run `npx expo-doctor` -> resolve any dependency compatibility warnings.
  - Audit codebase to confirm:
    1. No heavy runtime UI component kits installed (uses lightweight Uniwind + Tailwind CSS v4).
    2. Zero manually fabricated exercise instructions or fake media URLs.
    3. `expo-image` uses `cachePolicy="disk"` on all exercise media.
    4. All Supabase tables match `supabase/schema.sql` column-for-column.
    5. Cross-platform behavior verified on both iOS Simulator and Android Emulator (safe areas, keyboard handling, modals, and `app.json` `ios.bundleIdentifier` + `android.package` configured).
