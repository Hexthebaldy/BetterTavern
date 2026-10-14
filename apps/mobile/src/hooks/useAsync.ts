/**
 * 简单的数据加载：首次进入页面和每次回到页面时取一次，可手动刷新。
 * （TanStack Query 接入后由它取代，见 docs/client.md。）
 */

import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

export type AsyncState<T> = {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** 下拉刷新中（已有数据时再取） */
  refreshing: boolean;
  reload: () => Promise<void>;
  setData: (update: (current: T | undefined) => T | undefined) => void;
};

export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const ticket = useRef(0);
  const hasData = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    const mine = (ticket.current += 1);
    if (hasData.current) setRefreshing(true);
    else setLoading(true);
    try {
      const value = await run();
      if (mine !== ticket.current) return;
      hasData.current = true;
      setDataState(value);
      setError(null);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e);
    } finally {
      if (mine === ticket.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [run]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => {
        ticket.current += 1; // 离开页面后迟到的结果不再写入
      };
    }, [reload]),
  );

  const setData = useCallback((update: (current: T | undefined) => T | undefined) => {
    setDataState((current) => update(current));
  }, []);

  return { data, error, loading, refreshing, reload, setData };
}
