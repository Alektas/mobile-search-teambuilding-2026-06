import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, TouchEvent, UIEvent } from "react";
import scheduleUrl from "./data/schedule.json?url";

const SETTINGS_KEY = "mobile-search-teambuilding-settings-v1";
const HOUR_MS = 60 * 60 * 1000;
const TIMEZONE = "Europe/Moscow";
const HEADER_SCROLL_DELTA = 16;
const HEADER_EXPAND_SCROLL_TOP = 8;
const PROGRAMMATIC_HEADER_SCROLL_GUARD_MS = 900;
const TELEGRAM_SWIPE_GUARD_KEY = "__scheduleTelegramSwipeGuard";
const TELEGRAM_HORIZONTAL_GESTURE_LOCK_MS = 1400;

const EVENT_TYPES = [
  "conference",
  "talk",
  "hackathon",
  "brainstorm",
  "demo",
  "workshop",
  "activity",
  "meal",
  "transport",
  "break",
  "free_time",
  "other"
] as const;

type EventType = (typeof EVENT_TYPES)[number];
type ViewMode = "full" | "short";
type ThemeMode = "light" | "dark";

type LocalSettings = {
  viewMode: ViewMode;
  showHidden: boolean;
  selectedDayId?: string;
  selectedTypes: EventType[];
  theme: ThemeMode;
};

type ScheduleData = {
  updatedAt: string;
  timezone: typeof TIMEZONE;
  days: ScheduleDay[];
};

type ScheduleDay = {
  id: string;
  date: string;
  title: string;
  events: ScheduleEvent[];
};

type ScheduleEvent = {
  id: string;
  title: string;
  description?: string;
  start?: string;
  end?: string;
  approximateTime?: string;
  type: EventType;
  visibility: Record<ViewMode, boolean>;
  location?: {
    name?: string;
    address?: string;
    mapUrl?: string;
  };
  choiceGroupId?: string;
  important?: boolean;
  warning?: string;
  links?: {
    title: string;
    url: string;
  }[];
};

type EventTypeMeta = {
  label: string;
  shortLabel: string;
  bg: string;
  border: string;
  text: string;
  dot: string;
};

const TYPE_META: Record<EventType, EventTypeMeta> = {
  conference: {
    label: "Конференция",
    shortLabel: "Конфа",
    bg: "#e0f2fe",
    border: "#38bdf8",
    text: "#075985",
    dot: "#0284c7"
  },
  talk: {
    label: "Доклад",
    shortLabel: "Доклад",
    bg: "#ede9fe",
    border: "#8b5cf6",
    text: "#5b21b6",
    dot: "#7c3aed"
  },
  hackathon: {
    label: "AI-хакатон",
    shortLabel: "Хакатон",
    bg: "#dcfce7",
    border: "#22c55e",
    text: "#166534",
    dot: "#16a34a"
  },
  brainstorm: {
    label: "Брейншторм",
    shortLabel: "Брейн",
    bg: "#fef9c3",
    border: "#eab308",
    text: "#854d0e",
    dot: "#ca8a04"
  },
  demo: {
    label: "Демо",
    shortLabel: "Демо",
    bg: "#fae8ff",
    border: "#d946ef",
    text: "#86198f",
    dot: "#c026d3"
  },
  workshop: {
    label: "Воркшоп",
    shortLabel: "Воркшоп",
    bg: "#ffedd5",
    border: "#fb923c",
    text: "#9a3412",
    dot: "#ea580c"
  },
  activity: {
    label: "Активность",
    shortLabel: "Активность",
    bg: "#ccfbf1",
    border: "#14b8a6",
    text: "#115e59",
    dot: "#0d9488"
  },
  meal: {
    label: "Еда",
    shortLabel: "Еда",
    bg: "#fee2e2",
    border: "#f87171",
    text: "#991b1b",
    dot: "#dc2626"
  },
  transport: {
    label: "Дорога",
    shortLabel: "Дорога",
    bg: "#dbeafe",
    border: "#60a5fa",
    text: "#1e40af",
    dot: "#2563eb"
  },
  break: {
    label: "Перерыв",
    shortLabel: "Пауза",
    bg: "#f1f5f9",
    border: "#94a3b8",
    text: "#334155",
    dot: "#64748b"
  },
  free_time: {
    label: "Свободное время",
    shortLabel: "Свободно",
    bg: "#ecfccb",
    border: "#84cc16",
    text: "#3f6212",
    dot: "#65a30d"
  },
  other: {
    label: "Другое",
    shortLabel: "Другое",
    bg: "#f5f5f4",
    border: "#a8a29e",
    text: "#44403c",
    dot: "#78716c"
  }
};

const DEFAULT_SETTINGS: LocalSettings = {
  viewMode: "full",
  showHidden: false,
  selectedTypes: [...EVENT_TYPES],
  theme: "light"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTelegramWebApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

function hasTelegramLaunchParams(): boolean {
  return `${window.location.search} ${window.location.hash}`.includes("tgWebApp");
}

function isLikelyTelegramSurface(webApp = getTelegramWebApp()): boolean {
  const hasInitData = typeof webApp?.initData === "string" && webApp.initData.length > 0;
  const hasUnsafeData = isRecord(webApp?.initDataUnsafe) && Object.keys(webApp.initDataUnsafe).length > 0;
  const hasTelegramReferrer = document.referrer.startsWith("android-app://org.telegram.");

  return hasInitData || hasUnsafeData || hasTelegramLaunchParams() || hasTelegramReferrer || /Telegram/i.test(navigator.userAgent);
}

function prepareTelegramWebApp(): boolean {
  const webApp = getTelegramWebApp();
  const isTelegramSurface = isLikelyTelegramSurface(webApp);

  if (!isTelegramSurface || !webApp) {
    return isTelegramSurface;
  }

  try {
    webApp.ready?.();
    webApp.expand?.();
    webApp.disableVerticalSwipes?.();
  } catch {
    return isTelegramSurface;
  }

  return isTelegramSurface;
}

function hasCoarsePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

function createTelegramSwipeGuardState(baseState: unknown): Record<string, unknown> {
  return {
    ...(isRecord(baseState) ? baseState : {}),
    [TELEGRAM_SWIPE_GUARD_KEY]: true
  };
}

function installTelegramSwipeHistoryGuard(getLastHorizontalGestureAt: () => number): () => void {
  if (!window.history?.pushState) {
    return () => undefined;
  }

  let allowingBackNavigation = false;

  if (!isRecord(window.history.state) || window.history.state[TELEGRAM_SWIPE_GUARD_KEY] !== true) {
    window.history.pushState(createTelegramSwipeGuardState(window.history.state), "", window.location.href);
  }

  const handlePopState = () => {
    if (allowingBackNavigation) {
      return;
    }

    const recentHorizontalGesture =
      window.performance.now() - getLastHorizontalGestureAt() < TELEGRAM_HORIZONTAL_GESTURE_LOCK_MS;

    if (recentHorizontalGesture) {
      window.history.pushState(createTelegramSwipeGuardState(window.history.state), "", window.location.href);
      return;
    }

    allowingBackNavigation = true;
    window.removeEventListener("popstate", handlePopState);
    window.history.back();
  };

  window.addEventListener("popstate", handlePopState);

  return () => {
    window.removeEventListener("popstate", handlePopState);
  };
}

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && EVENT_TYPES.includes(value as EventType);
}

function loadSettings(): LocalSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<LocalSettings>;
    const selectedTypes = Array.isArray(parsed.selectedTypes)
      ? parsed.selectedTypes.filter(isEventType)
      : DEFAULT_SETTINGS.selectedTypes;

    return {
      viewMode: parsed.viewMode === "short" ? "short" : "full",
      showHidden: Boolean(parsed.showHidden),
      selectedDayId: typeof parsed.selectedDayId === "string" ? parsed.selectedDayId : undefined,
      selectedTypes,
      theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : DEFAULT_SETTINGS.theme
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function parseMs(value?: string): number | null {
  if (!value) {
    return null;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function getEventStartMs(event: ScheduleEvent): number | null {
  return parseMs(event.start);
}

function getEventEndMs(event: ScheduleEvent): number | null {
  const end = parseMs(event.end);
  if (end !== null) {
    return end;
  }

  const start = parseMs(event.start);
  return start === null ? null : start + HOUR_MS;
}

function isEventPast(event: ScheduleEvent, now: Date): boolean {
  const end = getEventEndMs(event);
  return end !== null && end <= now.getTime();
}

function isEventCurrent(event: ScheduleEvent, now: Date): boolean {
  const start = getEventStartMs(event);
  const end = getEventEndMs(event);
  return start !== null && end !== null && start <= now.getTime() && end > now.getTime();
}

function isDayPast(day: ScheduleDay, now: Date): boolean {
  const endTimes = day.events
    .map(getEventEndMs)
    .filter((value): value is number => value !== null);

  return endTimes.length > 0 && Math.max(...endTimes) <= now.getTime();
}

function formatClock(ms: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIMEZONE
  }).format(new Date(ms));
}

function formatEventTime(event: ScheduleEvent): string {
  if (event.approximateTime) {
    return event.approximateTime;
  }

  const start = getEventStartMs(event);
  if (start === null) {
    return "TBD";
  }

  const end = getEventEndMs(event) ?? start + HOUR_MS;
  return `${formatClock(start)}–${formatClock(end)}`;
}

function formatDuration(event: ScheduleEvent): string {
  const start = getEventStartMs(event);
  if (start === null) {
    return "";
  }

  const end = getEventEndMs(event) ?? start + HOUR_MS;
  const totalMinutes = Math.max(0, Math.round((end - start) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ч`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} мин`);
  }

  return parts.join(" ") || "0 мин";
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIMEZONE
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

function sortEventsByStart(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => {
    const startA = getEventStartMs(a) ?? Number.POSITIVE_INFINITY;
    const startB = getEventStartMs(b) ?? Number.POSITIVE_INFINITY;
    return startA - startB;
  });
}

function findRelevantEvent(events: ScheduleEvent[], now: Date): ScheduleEvent | undefined {
  const sorted = sortEventsByStart(events);
  const current = sorted.find((event) => isEventCurrent(event, now));
  if (current) {
    return current;
  }

  return sorted.find((event) => {
    const end = getEventEndMs(event);
    return end === null || end > now.getTime();
  }) ?? sorted[0];
}

function IconButton({
  active,
  ariaLabel,
  children,
  onClick,
  title
}: {
  active?: boolean;
  ariaLabel: string;
  children: ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      onClick={onClick}
      className={[
        "grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition",
        active
          ? "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950"
          : "border-slate-200 bg-white text-slate-700 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:active:bg-slate-800"
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function FullViewIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h8M4 12h8M4 17h8M17 9v6M14 12h6" />
    </svg>
  );
}

function ShortViewIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h8M4 12h8M4 17h8M14 12h6" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.07-7.07-1.41 1.41M6.34 17.66l-1.41 1.41m14.14 0-1.41-1.41M6.34 6.34 4.93 4.93" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6M9.9 5.4A9.6 9.6 0 0 1 12 5c6 0 9.5 7 9.5 7a17.8 17.8 0 0 1-2.6 3.5M6.1 6.8A17 17 0 0 0 2.5 12s3.5 7 9.5 7a9.3 9.3 0 0 0 4-.9" />
    </svg>
  );
}

function App() {
  const [settings, setSettings] = useState<LocalSettings>(() => loadSettings());
  const [selectedDayId, setSelectedDayId] = useState(() => loadSettings().selectedDayId ?? "");
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const nowRef = useRef(new Date());
  const horizontalRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<string, HTMLElement | null>>({});
  const eventRefs = useRef<Record<string, HTMLElement | null>>({});
  const didInitialScrollRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const verticalScrollRafRef = useRef<number | null>(null);
  const programmaticScrollTargetRef = useRef<string | null>(null);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const pendingEventScrollRef = useRef<ScrollBehavior | null>(null);
  const pendingVerticalScrollRef = useRef<{ dayId: string; scrollTop: number } | null>(null);
  const dayScrollTopRef = useRef<Record<string, number>>({});
  const headerCollapsedRef = useRef(false);
  const programmaticVerticalScrollUntilRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastHorizontalGestureAtRef = useRef(Number.NEGATIVE_INFINITY);

  const selectedTypesSet = useMemo(() => new Set(settings.selectedTypes), [settings.selectedTypes]);

  const persistableSettings = useMemo(
    () => ({
      ...settings,
      selectedDayId: selectedDayId || undefined
    }),
    [selectedDayId, settings]
  );

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(persistableSettings));
  }, [persistableSettings]);

  useEffect(() => {
    const metaTheme = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
    const dark = settings.theme === "dark";
    document.documentElement.classList.toggle("dark", dark);
    metaTheme?.setAttribute("content", dark ? "#020617" : "#f8fafc");
  }, [settings.theme]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);

    fetch(scheduleUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Schedule request failed: ${response.status}`);
        }
        return response.json() as Promise<ScheduleData>;
      })
      .then((data) => {
        if (!cancelled) {
          setSchedule(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleDays = useMemo(() => {
    if (!schedule) {
      return [];
    }

    return schedule.days.filter((day) => settings.showHidden || !isDayPast(day, nowRef.current));
  }, [schedule, settings.showHidden]);

  const getVisibleEvents = useCallback(
    (day: ScheduleDay) =>
      day.events.filter((event) => {
        if (!event.visibility[settings.viewMode]) {
          return false;
        }
        if (!settings.showHidden && isEventPast(event, nowRef.current)) {
          return false;
        }
        return selectedTypesSet.has(event.type);
      }),
    [selectedTypesSet, settings.showHidden, settings.viewMode]
  );

  const findCurrentDayId = useCallback(() => {
    for (const day of visibleDays) {
      const visibleEvents = getVisibleEvents(day);
      if (visibleEvents.some((event) => {
        const end = getEventEndMs(event);
        return end === null || end > nowRef.current.getTime();
      })) {
        return day.id;
      }
    }

    return visibleDays[0]?.id;
  }, [getVisibleEvents, visibleDays]);

  const scrollToRelevantEvent = useCallback(
    (dayId: string, behavior: ScrollBehavior) => {
      const day = visibleDays.find((candidate) => candidate.id === dayId);
      if (!day) {
        return;
      }

      const event = findRelevantEvent(getVisibleEvents(day), nowRef.current);
      const eventNode = event ? eventRefs.current[event.id] : null;
      const pageNode = pageRefs.current[dayId];

      programmaticVerticalScrollUntilRef.current = window.performance.now() + PROGRAMMATIC_HEADER_SCROLL_GUARD_MS;

      if (eventNode) {
        eventNode.scrollIntoView({ behavior, block: "center", inline: "nearest" });
      } else {
        pageNode?.scrollTo({ top: 0, behavior });
      }
    },
    [getVisibleEvents, visibleDays]
  );

  const clearProgrammaticScroll = useCallback((targetDayId?: string) => {
    if (targetDayId && programmaticScrollTargetRef.current !== targetDayId) {
      return;
    }

    programmaticScrollTargetRef.current = null;
    if (programmaticScrollTimeoutRef.current !== null) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = null;
    }
  }, []);

  const updateHeaderCollapsed = useCallback((collapsed: boolean) => {
    if (headerCollapsedRef.current === collapsed) {
      return;
    }

    headerCollapsedRef.current = collapsed;
    setHeaderCollapsed(collapsed);
  }, []);

  useEffect(() => {
    const isTelegramSurface = prepareTelegramWebApp();
    const cleanupSwipeGuard = isTelegramSurface || hasCoarsePointer()
      ? installTelegramSwipeHistoryGuard(() => lastHorizontalGestureAtRef.current)
      : () => undefined;

    return () => {
      cleanupSwipeGuard();
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      if (verticalScrollRafRef.current !== null) {
        window.cancelAnimationFrame(verticalScrollRafRef.current);
      }
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!schedule || visibleDays.length === 0) {
      return;
    }

    const selectedIsVisible = visibleDays.some((day) => day.id === selectedDayId);
    if (!selectedIsVisible) {
      setSelectedDayId(findCurrentDayId() ?? visibleDays[0].id);
    }
  }, [findCurrentDayId, schedule, selectedDayId, visibleDays]);

  useEffect(() => {
    if (!selectedDayId) {
      return;
    }

    const horizontalNode = horizontalRef.current;
    const dayIndex = visibleDays.findIndex((day) => day.id === selectedDayId);
    if (!horizontalNode || dayIndex < 0) {
      return;
    }

    const targetLeft = dayIndex * horizontalNode.clientWidth;
    const behavior = didInitialScrollRef.current ? "smooth" : "auto";

    if (Math.abs(horizontalNode.scrollLeft - targetLeft) > 1) {
      programmaticScrollTargetRef.current = selectedDayId;
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }

      horizontalNode.scrollTo({
        left: targetLeft,
        behavior,
      });

      if (behavior === "auto") {
        window.requestAnimationFrame(() => clearProgrammaticScroll(selectedDayId));
      } else {
        programmaticScrollTimeoutRef.current = window.setTimeout(
          () => clearProgrammaticScroll(selectedDayId),
          800
        );
      }
    } else {
      clearProgrammaticScroll(selectedDayId);
    }

    if (!didInitialScrollRef.current || pendingEventScrollRef.current) {
      const behavior = pendingEventScrollRef.current ?? "auto";
      pendingEventScrollRef.current = null;
      window.setTimeout(() => scrollToRelevantEvent(selectedDayId, behavior), 120);
      didInitialScrollRef.current = true;
    }
  }, [clearProgrammaticScroll, scrollToRelevantEvent, selectedDayId, visibleDays]);

  useEffect(() => {
    const node = pageRefs.current[selectedDayId];
    if (!node) {
      return;
    }

    dayScrollTopRef.current[selectedDayId] = node.scrollTop;
    if (node.scrollTop <= HEADER_EXPAND_SCROLL_TOP) {
      updateHeaderCollapsed(false);
    }
  }, [selectedDayId, updateHeaderCollapsed]);

  const updateSettings = useCallback((patch: Partial<LocalSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const selectDay = (dayId: string, scrollEvent = false) => {
    if (scrollEvent) {
      pendingEventScrollRef.current = "smooth";
    }
    setSelectedDayId(dayId);
  };

  const goToCurrent = () => {
    const dayId = findCurrentDayId();
    if (!dayId) {
      return;
    }

    pendingEventScrollRef.current = "smooth";
    setSelectedDayId(dayId);
  };

  const toggleType = (type: EventType) => {
    setSettings((current) => {
      const exists = current.selectedTypes.includes(type);
      return {
        ...current,
        selectedTypes: exists
          ? current.selectedTypes.filter((candidate) => candidate !== type)
          : [...current.selectedTypes, type]
      };
    });
  };

  const handleHorizontalScroll = () => {
    if (scrollRafRef.current !== null) {
      return;
    }

    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const node = horizontalRef.current;
      if (!node || node.clientWidth === 0) {
        return;
      }

      const programmaticTarget = programmaticScrollTargetRef.current;
      if (programmaticTarget) {
        const targetIndex = visibleDays.findIndex((day) => day.id === programmaticTarget);
        if (targetIndex < 0) {
          clearProgrammaticScroll(programmaticTarget);
          return;
        }

        const targetLeft = targetIndex * node.clientWidth;
        if (Math.abs(node.scrollLeft - targetLeft) <= 2) {
          clearProgrammaticScroll(programmaticTarget);
        }
        return;
      }

      const index = Math.round(node.scrollLeft / node.clientWidth);
      const day = visibleDays[index];
      if (day && day.id !== selectedDayId) {
        setSelectedDayId(day.id);
      }
    });
  };

  const handleDayScroll = useCallback(
    (dayId: string, event: UIEvent<HTMLElement>) => {
      pendingVerticalScrollRef.current = {
        dayId,
        scrollTop: event.currentTarget.scrollTop
      };

      if (verticalScrollRafRef.current !== null) {
        return;
      }

      verticalScrollRafRef.current = window.requestAnimationFrame(() => {
        verticalScrollRafRef.current = null;
        const pendingScroll = pendingVerticalScrollRef.current;
        if (!pendingScroll) {
          return;
        }

        const previousScrollTop = dayScrollTopRef.current[pendingScroll.dayId] ?? 0;
        dayScrollTopRef.current[pendingScroll.dayId] = pendingScroll.scrollTop;

        if (window.performance.now() < programmaticVerticalScrollUntilRef.current) {
          return;
        }

        if (pendingScroll.scrollTop <= HEADER_EXPAND_SCROLL_TOP) {
          updateHeaderCollapsed(false);
          return;
        }

        const delta = pendingScroll.scrollTop - previousScrollTop;
        if (delta > HEADER_SCROLL_DELTA) {
          updateHeaderCollapsed(true);
        } else if (delta < -HEADER_SCROLL_DELTA) {
          updateHeaderCollapsed(false);
        }
      });
    },
    [updateHeaderCollapsed]
  );

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (!start || !touch) {
      return;
    }

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      lastHorizontalGestureAtRef.current = window.performance.now();
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  if (loadError) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg items-center justify-center bg-slate-50 px-5 text-slate-950 shadow-soft dark:bg-slate-950 dark:text-white">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
          Не удалось загрузить расписание. Проверьте подключение или перезагрузите страницу.
        </div>
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg items-center justify-center bg-slate-50 text-slate-500 shadow-soft dark:bg-slate-950 dark:text-slate-400">
        Загрузка…
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex h-dvh max-w-lg flex-col overflow-hidden bg-slate-50 text-slate-950 shadow-soft dark:bg-slate-950 dark:text-white"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <header
        className={[
          "z-10 overflow-hidden border-b border-slate-200 bg-slate-50/95 px-4 backdrop-blur transition-[padding] duration-200 ease-out dark:border-slate-800 dark:bg-slate-950/95",
          headerCollapsed ? "pb-2 pt-[max(8px,env(safe-area-inset-top))]" : "pb-3 pt-[max(12px,env(safe-area-inset-top))]"
        ].join(" ")}
      >
        <div
          aria-hidden={headerCollapsed}
          className={[
            "overflow-hidden transition-[max-height,opacity,visibility] duration-200 ease-out",
            headerCollapsed ? "invisible max-h-0 opacity-0" : "visible max-h-48 opacity-100"
          ].join(" ")}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Обновлено: {formatUpdatedAt(schedule.updatedAt)}
              </p>
            </div>
          </div>

          <div className="horizontal-scroll-lock -mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
            <IconButton
              active={settings.viewMode === "full"}
              ariaLabel="Детальный вид"
              onClick={() => updateSettings({ viewMode: "full" })}
            >
              <FullViewIcon />
            </IconButton>
            <IconButton
              active={settings.viewMode === "short"}
              ariaLabel="Краткий вид"
              onClick={() => updateSettings({ viewMode: "short" })}
            >
              <ShortViewIcon />
            </IconButton>
            <IconButton
              ariaLabel={settings.theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
              onClick={() => updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}
            >
              {settings.theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </IconButton>
            <IconButton
              active={settings.showHidden}
              ariaLabel={settings.showHidden ? "Скрыть прошедшие события" : "Показать скрытые события"}
              onClick={() => updateSettings({ showHidden: !settings.showHidden })}
            >
              {settings.showHidden ? <EyeIcon /> : <EyeOffIcon />}
            </IconButton>
            <button
              type="button"
              onClick={goToCurrent}
              className="min-h-10 shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white active:bg-sky-700"
            >
              К текущему
            </button>
          </div>

          <div className="horizontal-scroll-lock -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() => updateSettings({ selectedTypes: [...EVENT_TYPES] })}
              className="min-h-9 shrink-0 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Все
            </button>
            {EVENT_TYPES.map((type) => {
              const meta = TYPE_META[type];
              const active = selectedTypesSet.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleType(type)}
                  className={[
                    "min-h-9 shrink-0 rounded-full border px-3 text-sm font-bold transition",
                    active ? "shadow-sm" : "bg-white text-slate-500 opacity-70 dark:bg-slate-900 dark:text-slate-400"
                  ].join(" ")}
                  style={
                    active
                      ? {
                          backgroundColor: meta.bg,
                          borderColor: meta.border,
                          color: meta.text
                        }
                      : undefined
                  }
                >
                  {meta.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        <nav
          className={[
            "horizontal-scroll-lock -mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none transition-[margin] duration-200 ease-out",
            headerCollapsed ? "mt-0" : "mt-3"
          ].join(" ")}
          aria-label="Дни"
        >
          {visibleDays.map((day) => {
            const active = day.id === selectedDayId;
            const past = isDayPast(day, nowRef.current);
            return (
              <button
                key={day.id}
                type="button"
                onClick={() => selectDay(day.id)}
                className={[
                  "min-h-10 shrink-0 rounded-lg border px-3 text-sm font-bold transition",
                  active
                    ? "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950"
                    : "border-slate-200 bg-white text-slate-700 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
                  past && settings.showHidden ? "opacity-60" : ""
                ].join(" ")}
              >
                {day.title}
              </button>
            );
          })}
        </nav>
      </header>

      {visibleDays.length === 0 ? (
        <main className="flex flex-1 items-center justify-center px-5 text-center text-slate-500 dark:text-slate-400">
          Нет видимых дней. Включите «Показать скрытые».
        </main>
      ) : (
        <main
          ref={horizontalRef}
          onScroll={handleHorizontalScroll}
          className="horizontal-scroll-lock flex flex-1 snap-x snap-mandatory overflow-x-auto scroll-smooth scrollbar-none"
        >
          {visibleDays.map((day) => {
            const events = getVisibleEvents(day);
            const dayPast = isDayPast(day, nowRef.current);

            return (
              <section
                key={day.id}
                ref={(node) => {
                  pageRefs.current[day.id] = node;
                  if (node) {
                    dayScrollTopRef.current[day.id] = node.scrollTop;
                  }
                }}
                className="day-scroll-lock h-full w-full shrink-0 snap-start overflow-y-auto px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-4"
                onScroll={(event) => handleDayScroll(day.id, event)}
                aria-label={day.title}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black">{day.title}</h2>
                    {dayPast && settings.showHidden ? (
                      <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">Прошедший день</p>
                    ) : null}
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    {events.length}
                  </div>
                </div>

                {events.length > 0 ? (
                  <div className="space-y-3">
                    {events.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        past={isEventPast(event, nowRef.current)}
                        current={isEventCurrent(event, nowRef.current)}
                        showPastMarker={settings.showHidden}
                        refCallback={(node) => {
                          eventRefs.current[event.id] = node;
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    Нет событий по выбранным фильтрам.
                  </div>
                )}
              </section>
            );
          })}
        </main>
      )}
    </div>
  );
}

function EventCard({
  event,
  past,
  current,
  showPastMarker,
  refCallback
}: {
  event: ScheduleEvent;
  past: boolean;
  current: boolean;
  showPastMarker: boolean;
  refCallback: (node: HTMLElement | null) => void;
}) {
  const meta = TYPE_META[event.type];
  const duration = formatDuration(event);
  const hasStatusBadges = current || (past && showPastMarker) || Boolean(event.choiceGroupId);

  return (
    <article
      ref={refCallback}
      className={[
        "rounded-lg border-l-4 border-y border-r bg-white p-4 shadow-sm transition dark:bg-slate-900",
        past && showPastMarker ? "opacity-60" : "",
        current ? "ring-2 ring-sky-400" : "border-slate-200 dark:border-slate-800"
      ].join(" ")}
      style={{ borderLeftColor: meta.border }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400">
          <span>{formatEventTime(event)}</span>
          {duration ? <span>· {duration}</span> : null}
        </div>
        <h3 className="mt-2 text-lg font-black leading-snug text-slate-950 dark:text-white">{event.title}</h3>
      </div>

      {hasStatusBadges ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {current ? (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-200">
              Сейчас
            </span>
          ) : null}
          {past && showPastMarker ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Прошло
            </span>
          ) : null}
          {event.choiceGroupId ? (
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-500 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:ring-slate-700">
              Параллельный трек
            </span>
          ) : null}
        </div>
      ) : null}

      {event.location?.name || event.location?.address || event.location?.mapUrl ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-950">
          {event.location.name ? <p className="font-bold text-slate-800 dark:text-slate-100">{event.location.name}</p> : null}
          {event.location.address ? <p className="mt-1 text-slate-600 dark:text-slate-300">{event.location.address}</p> : null}
          {event.location.mapUrl ? (
            <a
              href={event.location.mapUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex font-bold text-sky-700 dark:text-sky-300"
            >
              Открыть карту
            </a>
          ) : null}
        </div>
      ) : null}

      {event.description ? <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{event.description}</p> : null}

      {event.warning ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          Важно: {event.warning}
        </p>
      ) : null}

      {event.links?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {event.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300"
            >
              {link.title}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export default App;
