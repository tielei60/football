import { shallowRef } from "vue";
export type ConfirmOptions = { title?: string; confirmText?: string; cancelText?: string; danger?: boolean };
type Pending = { message: string; options: ConfirmOptions; resolve: (answer: boolean) => void };
const queue: Pending[] = [];
export const activeConfirmation = shallowRef<Pending | null>(null);
export function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ message, options, resolve });
    advance();
  });
}
function advance() {
  if (!activeConfirmation.value) activeConfirmation.value = queue.shift() || null;
}
export function answerConfirmation(answer: boolean) {
  const current = activeConfirmation.value;
  if (!current) return;
  activeConfirmation.value = null;
  current.resolve(answer);
  // Leave one frame for the closing dialog to restore focus before another opens.
  setTimeout(advance, 0);
}

// Invalidate all requests before resolving promises: continuations must never act
// on a page that has already been left, nor revive a queued old confirmation.
export function cancelAllConfirmations() {
  const pending = activeConfirmation.value ? [activeConfirmation.value, ...queue] : [...queue];
  queue.length = 0;
  activeConfirmation.value = null;
  for (const request of pending) request.resolve(false);
}
