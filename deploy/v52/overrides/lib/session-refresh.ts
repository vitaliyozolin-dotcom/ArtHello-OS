type SessionRefreshOptions<T> = {
  request: () => Promise<Response>;
  onAuthenticated: (user: T) => void;
  onExpired: () => void;
  windowTarget: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
};

/** Revalidate a mounted identity without reviving it after logout/unmount. */
export function startSessionRefresh<T>(options: SessionRefreshOptions<T>) {
  let disposed = false;
  let pending = false;
  const refresh = async () => {
    if (disposed || pending || options.documentTarget.visibilityState === "hidden") return;
    pending = true;
    try {
      const response = await options.request();
      if (disposed) return;
      if (response.status === 401 || response.status === 403) {
        options.onExpired();
      } else if (response.ok) {
        const user = await response.json() as T;
        if (!disposed) options.onAuthenticated(user);
      }
      // Transport errors do not become a new identity or an extra permission.
    } catch { /* Retry when connectivity returns or the next interval elapses. */ }
    finally { pending = false; }
  };
  const onWake = () => { void refresh(); };
  options.windowTarget.addEventListener("focus", onWake);
  options.documentTarget.addEventListener("visibilitychange", onWake);
  const timer = options.schedule(onWake, 60_000);
  return () => {
    disposed = true;
    options.cancel(timer);
    options.windowTarget.removeEventListener("focus", onWake);
    options.documentTarget.removeEventListener("visibilitychange", onWake);
  };
}
