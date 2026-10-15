import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";

import { HttpError } from "./api.ts";
import { Layout } from "./components/Layout.tsx";
import { Logs } from "./pages/Logs.tsx";
import { Overview } from "./pages/Overview.tsx";
import { RequestDetail, Requests } from "./pages/Requests.tsx";
import { Stories, StoryDetail } from "./pages/Stories.tsx";
import { TurnDetail } from "./pages/TurnDetail.tsx";
import { PhoneProvider } from "./phoneContext.tsx";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // 404 是“没有这条”，重试也不会有
      retry: (count, error) => !(error instanceof HttpError && error.status === 404) && count < 1,
      refetchOnWindowFocus: true,
      staleTime: 1000,
    },
  },
});

function NotFound() {
  return (
    <div className="page">
      <h1>没有这个页面</h1>
      <Link to="/">回概览</Link>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <PhoneProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Overview />} />
              <Route path="stories" element={<Stories />} />
              <Route path="stories/:id" element={<StoryDetail />} />
              <Route path="turns/:id" element={<TurnDetail />} />
              <Route path="requests" element={<Requests />} />
              <Route path="requests/:id" element={<RequestDetail />} />
              <Route path="logs" element={<Logs />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </PhoneProvider>
    </QueryClientProvider>
  </StrictMode>,
);
