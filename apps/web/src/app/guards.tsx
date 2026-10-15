/**
 * 路由守卫：恢复登录期间显示过渡画面；没登录的去登录页（登录后回到原来要去的地址）；登录了就不再停在登录、注册页。
 */

import { Navigate, Outlet, useLocation } from "react-router";

import { Splash } from "../pages/Splash.tsx";
import { AppShell } from "../shell/AppShell.tsx";
import { useApp } from "../state/AppProvider.tsx";

type FromState = { from?: string } | null;

export function RequireAuth() {
  const { status } = useApp();
  const location = useLocation();
  if (status === "restoring") return <Splash />;
  if (status === "signedOut") {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <AppShell />;
}

export function GuestOnly() {
  const { status } = useApp();
  const location = useLocation();
  if (status === "restoring") return <Splash />;
  if (status === "signedIn") {
    const from = (location.state as FromState)?.from;
    return <Navigate to={from?.startsWith("/") ? from : "/playthroughs"} replace />;
  }
  return <Outlet />;
}
