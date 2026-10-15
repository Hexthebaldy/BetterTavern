/**
 * 路由：地址和 App 的 expo-router 一一对应，浏览器的前进、后退和 App 的导航一致。
 * 登录、注册之外的页面都在外壳（侧栏 / 导航条 / Tab 栏）里。
 */

import { createBrowserRouter, Navigate } from "react-router";

import { LoginPage } from "../pages/auth/LoginPage.tsx";
import { RegisterPage } from "../pages/auth/RegisterPage.tsx";
import { LibraryPage } from "../pages/library/LibraryPage.tsx";
import { NotFound } from "../pages/NotFound.tsx";
import { Pending } from "../pages/Pending.tsx";
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
      { path: "/scenario/:id", element: <Pending title="剧本" /> },
      { path: "/play/:id", element: <Pending title="故事" /> },
      { path: "/settings", element: <Pending title="设置" /> },
      { path: "/settings/models", element: <Pending title="模型" /> },
      { path: "/settings/model/:id", element: <Pending title="模型" /> },
      { path: "/settings/account", element: <Pending title="账户" /> },
      { path: "/dev/probe", element: <Pending title="连接测试" /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
