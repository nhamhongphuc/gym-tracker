import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en, type TranslationSchema } from "@/i18n/en";
import { vi } from "@/i18n/vi";

export type Locale = "en" | "vi";

const LANGUAGE_STORAGE_KEY = "@app_language";

export interface WeekdayItem {
  day: number;
  letter: string;
  med: string;
  full: string;
}

interface LanguageContextValue {
  locale: Locale;
  dict: TranslationSchema;
  setLocale: (next: Locale) => void;
  toggleLocale: () => void;
  tMuscle: (group: string) => string;
  tEquipment: (eq: string) => string;
  weekdayList: WeekdayItem[];
}

function getDeviceLocale(): Locale {
  try {
    const code = getLocales()[0]?.languageCode?.toLowerCase();
    return code === "vi" ? "vi" : "en";
  } catch {
    return "en";
  }
}

export function formatTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  );
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => getDeviceLocale());

  useEffect(() => {
    let active = true;
    AsyncStorage.multiRemove([
      "@cached_instructions_vi_v1",
      "@cached_instructions_vi_v2",
    ]).catch(() => {});
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        if (stored === "en" || stored === "vi") {
          setLocaleState(stored);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function setLocale(next: Locale) {
    setLocaleState(next);
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next).catch(() => {});
  }

  function toggleLocale() {
    setLocaleState((prev) => {
      const next: Locale = prev === "en" ? "vi" : "en";
      AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }

  const value = useMemo<LanguageContextValue>(() => {
    const dict = locale === "vi" ? vi : en;

    const tMuscle = (group: string): string => {
      const map = dict.muscles as Record<string, string>;
      return map[group] ?? group;
    };

    const tEquipment = (eq: string): string => {
      const map = dict.equipment as Record<string, string>;
      return map[eq] ?? eq;
    };

    const weekdayList: WeekdayItem[] = [
      { day: 1, letter: dict.weekdays.mon.short, med: dict.weekdays.mon.med, full: dict.weekdays.mon.full },
      { day: 2, letter: dict.weekdays.tue.short, med: dict.weekdays.tue.med, full: dict.weekdays.tue.full },
      { day: 3, letter: dict.weekdays.wed.short, med: dict.weekdays.wed.med, full: dict.weekdays.wed.full },
      { day: 4, letter: dict.weekdays.thu.short, med: dict.weekdays.thu.med, full: dict.weekdays.thu.full },
      { day: 5, letter: dict.weekdays.fri.short, med: dict.weekdays.fri.med, full: dict.weekdays.fri.full },
      { day: 6, letter: dict.weekdays.sat.short, med: dict.weekdays.sat.med, full: dict.weekdays.sat.full },
      { day: 7, letter: dict.weekdays.sun.short, med: dict.weekdays.sun.med, full: dict.weekdays.sun.full },
    ];

    return {
      locale,
      dict,
      setLocale,
      toggleLocale,
      tMuscle,
      tEquipment,
      weekdayList,
    };
  }, [locale]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside LanguageProvider");
  }
  return ctx;
}
