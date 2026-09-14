export const NOTICE_AUTO_DISMISS_MS = 7_000;

export function scheduleNoticeDismiss(dismiss: () => void, delay = NOTICE_AUTO_DISMISS_MS) {
  const timer = setTimeout(dismiss, delay);
  return () => clearTimeout(timer);
}
