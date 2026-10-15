/**
 * 路由：地址和 App 的 expo-router 一一对应，浏览器的前进、后退和 App 的导航一致。
 * 登录、注册之外的页面都在外壳（侧栏 / 导航条 / Tab 栏）里。
 */

import { createBrowserRouter, Navigate } from "react-router";

import { LoginPage } from "../pages/auth/LoginPage.tsx";
import { RegisterPage } from "../pages/auth/RegisterPage.tsx";
import { LibraryPage } from "../pages/library/LibraryPage.tsx";
import { NotFound } from "../pages/NotFound.tsx";
import { PlayRoute } from "../pages/play/PlayPage.tsx";
import { ScenarioPage } from "../pages/scenario/ScenarioPage.tsx";
import { AccountBody } from "../pages/settings/AccountBody.tsx";
import { ModelPage } from "../pages/settings/ModelBody.tsx";
import { ModelsBody } from "../pages/settings/ModelsBody.tsx";
import { ProbeBody } from "../pages/settings/ProbeBody.tsx";
import { SettingsIndex, SettingsLayout } from "../pages/settings/SettingsLayout.tsx";
import { StoriesPage } from "../pages/stories/StoriesPage.tsx";
import { GuestOnly, RequireAuth } from "./guards.tsx";

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Navigate to="/playthroughs" replace /> },
      { path: "/playthroughs", element: <StoriesPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/scenario/:id", element: <ScenarioPage /> },
      { path: "/play/:id", element: <PlayRoute /> },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsIndex /> },
          { path: "models", element: <ModelsBody /> },
          { path: "model/:id", element: <ModelPage /> },
          { path: "account", element: <AccountBody /> },
        ],
      },
      { path: "/dev", element: <SettingsLayout />, children: [{ path: "probe", element: <ProbeBody /> }] },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
