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
-- 3. PROGRAM ROUTINES (Routines inside a program; ordered by order_index or day_of_week)
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workout_programs_next_routine_id_fkey'
  ) THEN
    ALTER TABLE workout_programs
      ADD CONSTRAINT workout_programs_next_routine_id_fkey
      FOREIGN KEY (next_routine_id) REFERENCES program_routines(id) ON DELETE SET NULL;
  END IF;
END $$;

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
-- 6. SET LOGS (Every performed set: weight_kg x reps)
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
CREATE INDEX IF NOT EXISTS idx_workout_programs_next_routine_id ON workout_programs (next_routine_id);
CREATE INDEX IF NOT EXISTS idx_program_routines_program_order ON program_routines (program_id, order_index ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_program_routines_program_day ON program_routines (program_id, day_of_week) WHERE day_of_week IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routine_exercises_routine_order ON routine_exercises (routine_id, order_index ASC);
CREATE INDEX IF NOT EXISTS idx_routine_exercises_exercise_id ON routine_exercises (exercise_id);
CREATE INDEX IF NOT EXISTS idx_set_logs_exercise_created ON set_logs (exercise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_set_logs_session ON set_logs (session_id, exercise_id, set_number ASC);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_date ON workout_sessions (session_date DESC);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_routine_id ON workout_sessions (routine_id);

-- ============================================================
-- ROW LEVEL SECURITY (Personal Single-User Mode)
-- ============================================================
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE set_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Personal full access exercises" ON exercises;
DROP POLICY IF EXISTS "Personal full access workout_programs" ON workout_programs;
DROP POLICY IF EXISTS "Personal full access program_routines" ON program_routines;
DROP POLICY IF EXISTS "Personal full access routine_exercises" ON routine_exercises;
DROP POLICY IF EXISTS "Personal full access workout_sessions" ON workout_sessions;
DROP POLICY IF EXISTS "Personal full access set_logs" ON set_logs;

CREATE POLICY "Personal full access exercises" ON exercises FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Personal full access workout_programs" ON workout_programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Personal full access program_routines" ON program_routines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Personal full access routine_exercises" ON routine_exercises FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Personal full access workout_sessions" ON workout_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Personal full access set_logs" ON set_logs FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- DEFAULT PROGRAM & 7-SLOT WEEKLY/ROLLING SKELETON
-- ============================================================
DO $$
DECLARE
  v_program_id uuid;
  v_first_routine_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workout_programs) THEN
    INSERT INTO workout_programs (name, description, schedule_mode, is_active)
    VALUES ('PPL + Upper/Lower', 'Push • Pull • Legs Heavy • Upper • Legs Light + Core', 'rolling', true)
    RETURNING id INTO v_program_id;

    INSERT INTO program_routines (program_id, order_index, day_of_week, short_label, name, is_rest_day, notes) VALUES
      (v_program_id, 0, 1, 'PUSH', 'Push (Chest, Shoulders, Triceps)', false, 'Finish with 15-20 min Incline Treadmill Walk (8-12% incline, 4.5-5.5 km/h)'),
      (v_program_id, 1, 2, 'PULL', 'Pull (Back, Rear Delts, Biceps)', false, 'Finish with 15-20 min Incline Treadmill Walk (8-12% incline, 4.5-5.5 km/h)'),
      (v_program_id, 2, 3, 'LEGS H', 'Heavy Legs (Quads & Hamstrings)', false, 'Focus on progressive overload and 2-3 min rest on compound lifts'),
      (v_program_id, 3, 4, 'REST', 'Rest & Recovery', true, 'Active recovery, stretching, mobility'),
      (v_program_id, 4, 5, 'UPPER', 'Upper Body Hypertrophy', false, 'Finish with 15-20 min Incline Treadmill Walk (8-12% incline, 4.5-5.5 km/h)'),
      (v_program_id, 5, 6, 'LEGS L', 'Light Legs + Core', false, 'Controlled tempo, higher reps, core work'),
      (v_program_id, 6, 7, 'REST', 'Rest Day', true, 'Full recovery and weekly prep');

    SELECT id INTO v_first_routine_id
    FROM program_routines
    WHERE program_id = v_program_id AND is_rest_day = false
    ORDER BY order_index ASC
    LIMIT 1;

    UPDATE workout_programs SET next_routine_id = v_first_routine_id WHERE id = v_program_id;
  END IF;
END $$;