import apiClient from './api';
import { ApiResponse } from '../types';

/**
 * Swachham assistant API.
 *
 * Uses the same axios client as every other module, so the bearer token and
 * base URL are the ones the app already has. No prompt, no rules and no
 * credentials live in the app — it sends a message and renders the reply.
 */

export interface ChatReply {
  reply: string;
  /** Follow-up questions to offer as chips under the answer. */
  suggestions: string[];
}

export interface ChatWelcome {
  greeting: string;
  suggestions: string[];
}

/** Which part of the app the question was asked from. */
export type ChatSection = 'business' | 'customer' | 'general';

export const chatApi = {
  getWelcome: async (): Promise<ApiResponse<ChatWelcome>> => {
    const response = await apiClient.get<ApiResponse<ChatWelcome>>('/api/chat/welcome');
    return response.data;
  },

  send: async (message: string, section: ChatSection = 'general'): Promise<ApiResponse<ChatReply>> => {
    const response = await apiClient.post<ApiResponse<ChatReply>>('/api/chat', {
      message,
      section,
    });
    return response.data;
  },
};

export default chatApi;
