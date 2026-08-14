import React, { createContext, useContext, useState, useCallback, useMemo } from "react";

interface ActivityCountContextValue {
  activityCount: number | null;
  setActivityCount: (count: number | null) => void;
}

const ActivityCountContext = createContext<ActivityCountContextValue>({
  activityCount: null,
  setActivityCount: () => {},
});

export function ActivityCountProvider({ children }: { children: React.ReactNode }) {
  const [activityCount, setActivityCount] = useState<number | null>(null);

  const handleSetActivityCount = useCallback((count: number | null) => {
    setActivityCount(count);
  }, []);

  const value = useMemo<ActivityCountContextValue>(
    () => ({ activityCount, setActivityCount: handleSetActivityCount }),
    [activityCount, handleSetActivityCount]
  );

  return <ActivityCountContext.Provider value={value}>{children}</ActivityCountContext.Provider>;
}

// Hook used by the Activity list page to publish its filtered row count to the
// sidebar badge. Pushing `null` (on unmount / no filters) restores the global
// pending count so the badge never gets stuck on a stale value.
export function useActivityCountSync(): (count: number | null) => void {
  const { setActivityCount } = useContext(ActivityCountContext);
  return setActivityCount;
}

// Hook used by the sidebar to read the currently published filtered count.
export function useActivityCount(): number | null {
  const { activityCount } = useContext(ActivityCountContext);
  return activityCount;
}
