import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import type { SetLog, WorkoutSession } from "@/types/database";

export const CACHE_KEYS = {
  WEEKLY_PLANS: "@cached_weekly_plans",
  EXERCISES: "@cached_exercises",
  OFFLINE_QUEUE: "@gym_offline_queue",
} as const;

export type OfflineOp =
  | {
      type: "create_session";
      payload: WorkoutSession;
      queuedAt: string;
    }
  | {
      type: "upsert_set";
      payload: SetLog;
      queuedAt: string;
    }
  | {
      type: "delete_set";
      payload: { id: string };
      queuedAt: string;
    }
  | {
      type: "complete_session";
      payload: { sessionId: string; notes?: string; completedAt?: string };
      queuedAt: string;
    };

let isFlushing = false;

/**
 * Generates an RFC4122 v4 UUID without extra native/npm dependencies so
 * offline-created sessions and set logs receive deterministic Postgres PKs.
 */
export function generateUuid(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function saveCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn(`[offlineQueue] Failed to save cache for ${key}:`, err);
  }
}

export async function loadCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[offlineQueue] Failed to load cache for ${key}:`, err);
    return null;
  }
}

async function readQueue(): Promise<OfflineOp[]> {
  const queue = await loadCache<OfflineOp[]>(CACHE_KEYS.OFFLINE_QUEUE);
  return Array.isArray(queue) ? queue : [];
}

export async function enqueueOfflineOp(op: OfflineOp): Promise<void> {
  const queue = await readQueue();
  queue.push(op);
  await saveCache(CACHE_KEYS.OFFLINE_QUEUE, queue);
}

export async function getPendingCount(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

async function executeOfflineOp(op: OfflineOp): Promise<void> {
  switch (op.type) {
    case "create_session": {
      const { error } = await supabase.from("workout_sessions").upsert({
        id: op.payload.id,
        plan_id: op.payload.plan_id,
        plan_name_snapshot: op.payload.plan_name_snapshot,
        session_date: op.payload.session_date,
        started_at: op.payload.started_at,
        completed_at: op.payload.completed_at,
        notes: op.payload.notes,
      });
      if (error) throw error;
      return;
    }
    case "upsert_set": {
      const payload: Partial<SetLog> = { ...op.payload };
      if (!payload.id) {
        delete payload.id;
      }
      const { error } = await supabase.from("set_logs").upsert(payload);
      if (error) throw error;
      return;
    }
    case "delete_set": {
      const { error } = await supabase
        .from("set_logs")
        .delete()
        .eq("id", op.payload.id);
      if (error) throw error;
      return;
    }
    case "complete_session": {
      const { error } = await supabase
        .from("workout_sessions")
        .update({
          completed_at: op.payload.completedAt ?? op.queuedAt,
          notes: op.payload.notes ?? null,
        })
        .eq("id", op.payload.sessionId);
      if (error) throw error;
      return;
    }
  }
}

export async function flushOfflineQueue(): Promise<{
  synced: number;
  remaining: number;
}> {
  if (isFlushing) {
    return { synced: 0, remaining: await getPendingCount() };
  }

  isFlushing = true;
  try {
    const queue = await readQueue();
    if (queue.length === 0) {
      return { synced: 0, remaining: 0 };
    }

    const failed: OfflineOp[] = [];
    let synced = 0;

    for (const op of queue) {
      try {
        await executeOfflineOp(op);
        synced++;
      } catch (err) {
        console.warn(`[offlineQueue] Failed to sync op (${op.type}):`, err);
        failed.push(op);
      }
    }

    await saveCache(CACHE_KEYS.OFFLINE_QUEUE, failed);
    return { synced, remaining: failed.length };
  } finally {
    isFlushing = false;
  }
}
