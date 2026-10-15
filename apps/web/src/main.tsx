/** 入口：数据缓存 → 界面偏好 → 主题 → 登录状态 → 路由 */

import "./theme/tokens.css";
import "./theme/base.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { ApiError } from "@bettertavern/core/api/client";

import { router } from "./app/router.tsx";
import { installDiagnostics } from "./observability/setup.ts";
import { AppProvider } from "./state/AppProvider.tsx";
import { PrefsProvider } from "./state/PrefsProvider.tsx";
import { ThemeProvider } from "./theme/ThemeProvider.tsx";

installDiagnostics();

const queries = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx 是确定的结果（没有、没权限），重试没有意义；连不上和 5xx 再试两次
      retry: (count, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      staleTime: 10_000,
      // 没有下拉刷新：回到标签页、窗口回到前台时自动刷新
      refetchOnWindowFocus: true,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("index.html 里没有 #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <PrefsProvider>
        <ThemeProvider>
          <AppProvider>
            <RouterProvider router={router} />
          </AppProvider>
        </ThemeProvider>
      </PrefsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
