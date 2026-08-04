import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { checkUnauthorized } from "./session";

const SUPPORT_CHAT_TIMEOUT_MS = 60_000;

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const isSupportChat =
    method === "POST" && url.includes("/api/support/chat");

  const controller = isSupportChat ? new AbortController() : null;
  const timeoutId =
    controller &&
    setTimeout(() => controller.abort(), SUPPORT_CHAT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller?.signal,
    });

    // A 401 on an authenticated endpoint means the session is gone, not that
    // this particular call failed. Signing out here rather than at each call
    // site is what stops the app rendering a dead session's data.
    checkUnauthorized(url, res.status);

    await throwIfResNotOk(res);
    return res;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const res = await fetch(url, {
      credentials: "include",
    });

    checkUnauthorized(url, res.status);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
