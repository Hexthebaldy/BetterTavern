/**
 * 路由：地址和 App 的 expo-router 一一对应，浏览器的前进、后退和 App 的导航一致。
 * 登录、注册、协议之外的页面都在外壳（侧栏 / 导航条 / Tab 栏）里。阅读页、剧本详情、角色卡、工作台、设置按需加载（首屏只带故事和剧本库）。
 */

import { createBrowserRouter, Navigate } from "react-router";

import { ForgotPage } from "../pages/auth/ForgotPage.tsx";
import { LoginPage } from "../pages/auth/LoginPage.tsx";
import { RegisterPage } from "../pages/auth/RegisterPage.tsx";
import { VerifyPage } from "../pages/auth/VerifyPage.tsx";
import { LibraryPage } from "../pages/library/LibraryPage.tsx";
import { NotFound } from "../pages/NotFound.tsx";
import { Splash } from "../pages/Splash.tsx";
import { StoriesPage } from "../pages/stories/StoriesPage.tsx";
import { GuestOnly, RequireAuth } from "./guards.tsx";

const settings = () => import("../pages/settings/SettingsLayout.tsx");

const legal = () => import("../pages/legal/LegalPage.tsx");

export const router = createBrowserRouter([
  // 协议页面：登录前后都能打开（注册页、设置、App 里有链接）
  ...(["terms", "privacy", "rules"] as const).map((doc) => ({
    path: `/${doc}`,
    hydrateFallbackElement: <Splash />,
    lazy: async () => {
      const { LegalPage } = await legal();
      return { Component: () => <LegalPage doc={doc} /> };
    },
  })),
  {
    element: <GuestOnly />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/verify", element: <VerifyPage /> },
      { path: "/forgot", element: <ForgotPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    // 直接打开按需加载的页面（阅读页、设置）时，加载完之前显示过渡画面
    hydrateFallbackElement: <Splash />,
    children: [
      { path: "/", element: <Navigate to="/playthroughs" replace /> },
      { path: "/playthroughs", element: <StoriesPage /> },
      { path: "/library", element: <LibraryPage /> },
      {
        path: "/scenario/:id",
        lazy: async () => ({ Component: (await import("../pages/scenario/ScenarioPage.tsx")).ScenarioPage }),
      },
      {
        path: "/scenario/new",
        lazy: async () => ({
          Component: (await import("../pages/scenario/ScenarioFormPage.tsx")).ScenarioFormPage,
        }),
      },
      {
        path: "/scenario/:id/edit",
        lazy: async () => ({
          Component: (await import("../pages/scenario/ScenarioFormPage.tsx")).ScenarioFormPage,
        }),
      },
      {
        path: "/card/:id",
        lazy: async () => ({ Component: (await import("../pages/cards/CardPage.tsx")).CardPage }),
      },
      {
        path: "/workbench",
        lazy: async () => ({ Component: (await import("../pages/workbench/WorkbenchHome.tsx")).WorkbenchHome }),
      },
      {
        path: "/workbench/d/:id",
        lazy: async () => ({ Component: (await import("../pages/workbench/DraftPage.tsx")).DraftPage }),
      },
      {
        path: "/play/:id",
        lazy: async () => ({ Component: (await import("../pages/play/PlayPage.tsx")).PlayRoute }),
      },
      {
        path: "/settings",
        lazy: async () => ({ Component: (await settings()).SettingsLayout }),
        children: [
          { index: true, lazy: async () => ({ Component: (await settings()).SettingsIndex }) },
          {
            path: "models",
            lazy: async () => ({ Component: (await import("../pages/settings/ModelsBody.tsx")).ModelsBody }),
          },
          {
            path: "model/:id",
            lazy: async () => ({ Component: (await import("../pages/settings/ModelBody.tsx")).ModelPage }),
          },
          {
            path: "tools",
            lazy: async () => ({ Component: (await import("../pages/settings/ToolsBody.tsx")).ToolsBody }),
          },
          {
            path: "account",
            lazy: async () => ({
              Component: (await import("../pages/settings/AccountBody.tsx")).AccountBody,
            }),
          },
        ],
      },
      {
        path: "/dev",
        lazy: async () => ({ Component: (await settings()).SettingsLayout }),
        children: [
          {
            path: "probe",
            lazy: async () => ({ Component: (await import("../pages/settings/ProbeBody.tsx")).ProbeBody }),
          },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
