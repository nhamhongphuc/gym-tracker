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