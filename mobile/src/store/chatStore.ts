import { create } from 'zustand';

/**
 * Whether the Swachham assistant is open.
 *
 * Kept in a store so the launcher can live on a screen while the chat modal
 * stays mounted at the tab-navigator level. That separation is what keeps
 * Select Items from remounting when the chat opens or closes — the items and
 * quantities already chosen are never touched.
 */
interface ChatState {
  isOpen: boolean;
  /**
   * Whether the "Hi! I am Swachham" bubble has already been shown.
   *
   * Kept here rather than in the launcher so it survives the screen being
   * remounted: the greeting appears once for the session, not on every
   * render or every return to Select Items.
   */
  greetingShown: boolean;
  open: () => void;
  close: () => void;
  markGreetingShown: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  greetingShown: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  markGreetingShown: () => set({ greetingShown: true }),
}));

export default useChatStore;
