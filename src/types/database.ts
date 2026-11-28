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

export type ScheduleMode = "rolling" | "weekly";

export interface ProgramScheduleAnchor {
  date: string; // YYYY-MM-DD
  routineId: string;
}

export type ProgramDateOverride =
  | { kind: "single"; routineId: string | "REST" }
  | { kind: "rest_push" };

export interface ProgramScheduleState {
  anchors?: ProgramScheduleAnchor[];
  overrides?: Record<string, ProgramDateOverride>;
}

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
  day_of_week: number | null; // 1 (Mon) to 7 (Sun) in weekly mode
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
  speed_kmh?: number | null;
  incline_pct?: number | null;
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
  speed_kmh?: string;
  incline_pct?: string;
  prev_weight_kg?: number;
  prev_reps?: number;
  prev_speed_kmh?: number | null;
  prev_incline_pct?: number | null;
  is_completed: boolean;
  saved_log_id?: string;
}

export interface ExercisePRStats {
  maxWeightKg: number;
  maxReps: number;
  bestEstimated1RM: number;
  recentSessions: {
    sessionDate: string;
    sets: {
      set_number: number;
      weight_kg: number;
      reps: number;
      speed_kmh?: number | null;
      incline_pct?: number | null;
      set_type: SetType;
    }[];
  }[];
}
