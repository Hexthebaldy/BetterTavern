/**
 * 路由。登录、注册、协议之外的页面都在外壳（侧栏 / Tab 栏）里。阅读页、剧本详情、角色卡、工作台、模型、外部服务、
 * 设置按需加载（首屏只带存档、剧本和角色）。
 * 网页端按大屏重排后，地址和 App 不再完全一样：剧本和角色分成 /scenarios、/characters；模型从设置里拿出来是 /models；
 * 外部服务是设置的子页面 /settings/tools；账户在设置页的“账户”一格。旧地址（/library、/tools、/settings/models、
 * /settings/model/:id、/settings/account）都跳到新地址。
 */

import { createBrowserRouter, Navigate, useParams } from "react-router";

import { ForgotPage } from "../pages/auth/ForgotPage.tsx";
import { LoginPage } from "../pages/auth/LoginPage.tsx";
import { RegisterPage } from "../pages/auth/RegisterPage.tsx";
import { VerifyPage } from "../pages/auth/VerifyPage.tsx";
import { CharactersPage, LibraryRedirect, ScenariosPage } from "../pages/library/LibraryPage.tsx";
import { NotFound } from "../pages/NotFound.tsx";
import { Splash } from "../pages/Splash.tsx";
import { StoriesPage } from "../pages/stories/StoriesPage.tsx";
import { GuestOnly, RequireAuth } from "./guards.tsx";

const models = () => import("../pages/models/ModelsPage.tsx");

/** 旧地址 /settings/model/:id → /models/:id */
function ModelRedirect() {
  const { id = "" } = useParams();
  return <Navigate to={`/models/${encodeURIComponent(id)}`} replace />;
}

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
      { path: "/scenarios", element: <ScenariosPage /> },
      { path: "/characters", element: <CharactersPage /> },
      { path: "/library", element: <LibraryRedirect /> },
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
      { path: "/models", lazy: async () => ({ Component: (await models()).ModelsPage }) },
      { path: "/models/:id", lazy: async () => ({ Component: (await models()).ModelsPage }) },
      {
        path: "/settings/tools",
        lazy: async () => ({ Component: (await import("../pages/tools/ToolsPage.tsx")).ToolsPage }),
      },
      { path: "/tools", element: <Navigate to="/settings/tools" replace /> },
      {
        path: "/settings",
        lazy: async () => ({ Component: (await import("../pages/settings/SettingsPage.tsx")).SettingsPage }),
      },
      { path: "/settings/models", element: <Navigate to="/models" replace /> },
      { path: "/settings/model/:id", element: <ModelRedirect /> },
      { path: "/settings/account", element: <Navigate to="/settings" replace /> },
      {
        path: "/dev/probe",
        lazy: async () => ({ Component: (await import("../pages/settings/ProbePage.tsx")).ProbePage }),
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
