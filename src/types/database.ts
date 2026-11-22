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
