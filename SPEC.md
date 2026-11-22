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
- **Local Storage / Offline Queue:** `@react-native-async-storage/async-storage`
- **Icons:** `@expo/vector-icons` (`Ionicons`)
- **Seeding Tooling (devDependencies only — excluded from app bundle):** `tsx`, `dotenv`

### Initialization Commands

```bash
npx create-expo-app@latest gym-tracker
cd gym-tracker
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage expo-image @expo/vector-icons
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
├── package.json
├── tsconfig.json                 # Path alias @/* -> ./src/*
├── supabase/
│   └── schema.sql                # Authoritative Postgres schema & 7-day split skeleton
├── scripts/
│   └── seedExercises.ts          # Verified dataset ingester (ExerciseDB + FreeExerciseDB + Wger video match)
└── src/
    ├── global.css                # Tailwind v4 + Uniwind entry & @theme dark-mode color tokens
    ├── uniwind-types.d.ts        # Auto-generated Uniwind TypeScript definitions (via Metro)
    ├── constants/
    │   └── theme.ts              # Raw color constants, touch targets, and cross-platform shadows
    ├── types/
    │   └── database.ts           # Strict TypeScript interfaces matching Supabase tables
    ├── lib/
    │   ├── supabase.ts           # Supabase client configured with AsyncStorage
    │   ├── offlineQueue.ts       # AsyncStorage cache & failed-write retry queue
    │   └── api.ts                # All Supabase CRUD queries + previous-session lookup + stats
    ├── components/
    │   ├── RestTimerBar.tsx      # Floating countdown bar (-15s, +15s, Skip, Vibration on 0)
    │   ├── SetRow.tsx            # Set #, type cycler, previous ghost value, kg/reps inputs, checkmark
    │   ├── ExercisePickerModal.tsx   # Searchable modal with muscle/equipment filters & GIF thumbnails
    │   └── CustomExerciseModal.tsx   # Modal to add a personal custom exercise to Supabase
    └── app/
        ├── _layout.tsx           # Root Stack (imports ../global.css, hosts "(tabs)" and "exercise/[id]")
        ├── (tabs)/
        │   ├── _layout.tsx       # 4-tab dark bottom navigation bar
        │   ├── index.tsx         # Tab 1: Today's Active Workout Logger
        │   ├── plan.tsx          # Tab 2: Weekly Split Plan Builder (Mon–Sun)
        │   ├── exercises.tsx     # Tab 3: Verified Exercise Library
        │   └── history.tsx       # Tab 4: Workout History & Weekly Volume Stats
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
  tips TEXT,                                      -- Optional personal user form cue
  gif_url TEXT,                                   -- Verified looping GIF from ExerciseDB CDN
  image_urls TEXT[] NOT NULL DEFAULT '{}',        -- Verified posture frames from Free Exercise DB
  video_url TEXT,                                 -- Verified Wger video URL or user-saved YouTube coaching link
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. WORKOUT PLANS (1 = Monday ... 7 = Sunday)
-- ============================================================
CREATE TABLE IF NOT EXISTS workout_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INT NOT NULL UNIQUE CHECK (day_of_week BETWEEN 1 AND 7),
  name TEXT NOT NULL,
  is_rest_day BOOLEAN DEFAULT false,
  notes TEXT
);

-- ============================================================
-- 3. PLAN EXERCISES (Ordered exercises assigned to each day)
-- ============================================================
CREATE TABLE IF NOT EXISTS plan_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  order_index INT NOT NULL DEFAULT 0,
  target_sets INT NOT NULL DEFAULT 3,
  target_reps TEXT NOT NULL DEFAULT '8-12',
  rest_seconds INT NOT NULL DEFAULT 90
);

-- ============================================================
-- 4. WORKOUT SESSIONS (Individual gym visits)
-- ============================================================
CREATE TABLE IF NOT EXISTS workout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES workout_plans(id) ON DELETE SET NULL,
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
  tips: string | null;
  gif_url: string | null;
  image_urls: string[];
  video_url: string | null;
  created_at?: string;
}

export interface WorkoutPlan {
  id: string;
  day_of_week: number; // 1 (Mon) to 7 (Sun)
  name: string;
  is_rest_day: boolean;
  notes: string | null;
  plan_exercises?: PlanExerciseWithDetails[];
}

export interface PlanExercise {
  id: string;
  plan_id: string;
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

High-contrast gym dark mode designed for one-handed logging between sets:

- `background`: `#0B0F17`
- `surface`: `#161C28`
- `surfaceElevated`: `#1E2638`
- `mediaFrame`: `#F3F4F6` (clean light container for ExerciseDB GIFs)
- `primary`: `#10B981` (Emerald — active buttons, completed sets, PR highlights)
- `primarySubtle`: `rgba(16, 185, 129, 0.14)` (Completed set row tint)
- `accent`: `#3B82F6` (Blue — rest timer, links, info badges)
- `warning`: `#F59E0B` (Amber — warm-up badge, personal cues)
- `purple`: `#A855F7` (Dropset badge)
- `danger`: `#EF4444` (Failure badge, delete actions)
- `textPrimary`: `#F9FAFB`
- `textSecondary`: `#9CA3AF`
- `textMuted`: `#4B5563` (Ghost placeholders for previous weight/reps)
- `border`: `#263042`
- **Minimum Interactive Target:** `44px × 44px` (`min-h-11 min-w-11` in Tailwind) on all checkboxes, timer controls, and icons.

### Uniwind Styling Conventions

- Define all color tokens as Tailwind v4 `@theme` variables inside `src/global.css` (e.g., `--color-background: #0B0F17`, `--color-surface: #161C28`, `--color-primary: #10B981`, `--color-text-primary: #F9FAFB`, etc.) so screens and components use utility classes directly (`className="bg-background text-text-primary"`).
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

### Tab 1: Today's Active Workout Logger (`app/(tabs)/index.tsx`)

- **Top Bar:**
  - Current day label & plan name (e.g., `"Monday • Push (Chest, Shoulders, Triceps)"`).
  - Horizontal 7-day pill selector (`M T W T F S S`) defaulting to today (ISO weekday `1..7`), allowing quick switching if a gym day shifts.
  - Conditional **Offline Sync Pill** showing pending queued sets count (tappable to flush immediately).
  - `"Finish"` primary button (enabled once at least 1 set is completed) that prompts for optional session notes and marks `completed_at`.
- **Rest Day Empty State:**
  - If `is_rest_day` is true, display recovery notes plus a secondary `"Log Another Day's Split"` prompt pointing to the 7-day pill bar.
- **Exercise Cards (`ScrollView` + platform-aware `KeyboardAvoidingView` — `behavior="padding"` on iOS, resize/height handling on Android):**
  - **Header:** Small rounded `expo-image` GIF/thumbnail preview (`44×44`), Exercise Name, Equipment & Muscle subtitle, Target pill (`3 × 8-10 • 120s`), and Info Icon (`information-circle-outline`) opening `/exercise/[id]` modal without resetting active inputs.
  - **Set Rows (`components/SetRow.tsx`):**
    - Columns: `SET` | `PREVIOUS` | `KG` | `REPS` | `✓`
    - `SET`: Tapping cycles set type: Working (`1, 2, 3`) -> Warm-up (`W`, Amber) -> Dropset (`D`, Purple) -> Failure (`F`, Red).
    - `PREVIOUS`: Displays ghost text from last session (e.g., `70kg × 8`). Tapping copies both values into the row's `KG` and `REPS` inputs.
    - `KG` & `REPS`: `decimal-pad` and `number-pad` inputs with previous session numbers shown as muted placeholders.
    - `✓` Button:
      - If `KG` or `REPS` is blank when tapped, auto-fills from `prev_weight_kg` and `prev_reps`.
      - Persists via `upsertSetLog`, highlights row with `primarySubtle`, and triggers `RestTimerBar` using the exercise's `rest_seconds` (if `rest_seconds > 0`).
      - Tapping a completed `✓` again uncompletes/deletes the saved log.
  - **Card Footer:** `"+ Add Set"` and `"- Remove Set"` actions.
- **Floating Rest Timer (`components/RestTimerBar.tsx`):**
  - Pinned above the bottom tab bar whenever active.
  - Displays countdown (`MM:SS`), linear progress bar, `"-15s"`, `"+15s"`, and `"Skip"` buttons.
  - Triggers `Vibration.vibrate(...)` at `00:00` (using `Platform.OS` to handle iOS vs. Android pattern array differences cleanly; note that simulators/emulators do not physically vibrate) and auto-dismisses after 2 seconds.

### Tab 2: Weekly Split Plan Builder (`app/(tabs)/plan.tsx`)

- **Day Tabs:** `Mon`–`Sun` horizontal selector bar.
- **Day Settings Card:**
  - Plan Name `TextInput`, `"Rest Day"` `Switch`, Day Notes `TextInput`, and `"Save Day Settings"` button with saved confirmation feedback.
- **Exercise List (when not a rest day):**
  - Each card shows `expo-image` thumbnail, Exercise Name, Muscle/Equipment subtitle, Up/Down reorder buttons (`↑` / `↓`), Remove Trash icon, and 3 compact inline editors:
    - `Sets` (`number-pad`)
    - `Reps` (`default`, e.g., `"8-10"` or `"15-20 min"`)
    - `Rest (s)` (`number-pad`)
  - Edits persist on blur or save button.
- **Bottom Action:** `"+ Add Exercise to Day"` button opening `ExercisePickerModal` (which filters the 1,500+ verified library by search query and muscle group chips and adds directly to `plan_exercises`).

### Tab 3: Verified Exercise Library (`app/(tabs)/exercises.tsx`)

- **Header:** Search bar (`"Search 1,500+ exercises..."`) + horizontal Muscle Group filter chips (`All`, `Chest`, `Back`, `Shoulders`, `Legs`, `Arms`, `Core`, `Cardio`).
- **Virtualized List (`FlatList`):**
  - Uses `initialNumToRender={15}` and `windowSize={7}` for smooth 60fps scrolling.
  - Each row renders a disk-cached `expo-image` preview (`52×52` inside `mediaFrame`), Exercise Name, Muscle Group & Equipment badges, and a chevron opening `/exercise/[id]`.
  - Footer displays `"Exercise data & GIFs provided by AscendAPI (ExerciseDB)"`.
- **FAB (`+ Custom`):** Opens `CustomExerciseModal` to save custom movements (`name`, `muscle_group`, `equipment`, newline-separated `instructions`, optional `tips`, optional `video_url`).

### Modal: Exercise Detail, Media & PR History (`app/exercise/[id].tsx`)

Presented as a native modal screen (`presentation: 'modal'` in `app/_layout.tsx` — native sheet on iOS, slide-up modal with hardware Back support on Android).

1. **Verified Visual Demo Container (`mediaFrame` background):**
   - **If `gif_url` exists:** Render `<Image source={{ uri: exercise.gif_url }} style={styles.gif} contentFit="contain" cachePolicy="disk" />` (auto-loops natively on both iOS and Android).
   - **Else if `image_urls.length > 0`:** Auto-toggle between `image_urls[0]` and `image_urls[1]` every 1.2s with a manual Start/Finish toggle button.
   - **Else:** Clean minimalist placeholder icon.
2. **HD Form Video Bar:**
   - If `exercise.video_url` exists: Primary button `"Watch Verified Form Video"` (opens via `Linking.openURL`) + small `"Edit Link"` icon.
   - If no `video_url`: Button `"+ Attach Form Video URL"` (opens inline text input to paste & save a trusted YouTube URL to Supabase).
   - Always includes secondary button `"Search Form Tutorial on YouTube"` opening `https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' proper form tutorial')}`.
3. **Muscle Breakdown:** Badges for `muscle_group`, `equipment`, `target_muscles`, and `secondary_muscles`.
4. **Verified Step-by-Step Instructions:** Numbered step cards rendered from `exercise.instructions[]`.
5. **Personal Form Cue (`tips`):** Editable amber callout card so you can save your own bench notch or grip reminder per exercise.
6. **Personal Records & Recent Sets:**
   - Two metric boxes: **Heaviest Weight (`kg`)** and **Est. 1RM (`kg`)**.
   - Last 5 workout dates showing all performed sets for this exercise.
7. **Source Attribution:** Small muted footer (`"Source: ExerciseDB (AscendAPI)"` / `"Source: Free Exercise DB"` / `"Custom Exercise"`).

### Tab 4: Workout History (`app/(tabs)/history.tsx`)

- **Weekly Summary Banner (Current Mon–Sun):** 3 stat cards — **Workouts**, **Sets Logged**, and **Total Volume (`kg`)** (`Σ weight_kg × reps`).
- **Session History List (`FlatList`):**
  - Reverse-chronological completed sessions showing Date, Plan Name, Duration (`started_at` to `completed_at`), Exercise Count, and Total Volume.
  - Tapping a card expands the full exercise-by-exercise set log breakdown.
  - Includes a Delete Session icon with `Alert.alert` confirmation.

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
