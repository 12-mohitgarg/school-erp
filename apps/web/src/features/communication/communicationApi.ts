import { api, unwrap, unwrapPaged, queryString, type Envelope, type Paged } from '@/lib/api';
import type { AnnouncementRow } from '@/features/api/endpoints';

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  priority: string;
  module: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export const communicationApi = api.injectEndpoints({
  endpoints: (build) => ({
    announcements: build.query<Paged<AnnouncementRow>, { page?: number; limit?: number; category?: string }>({
      query: (params) => `/communication/announcements${queryString(params)}`,
      transformResponse: unwrapPaged<AnnouncementRow>,
      providesTags: ['Announcement'],
    }),

    createAnnouncement: build.mutation<AnnouncementRow, Record<string, unknown>>({
      query: (body) => ({ url: '/communication/announcements', method: 'POST', body }),
      transformResponse: unwrap<AnnouncementRow>,
      invalidatesTags: ['Announcement', 'Notification'],
    }),

    notifications: build.query<Paged<NotificationRow> & { unreadCount: number }, { page?: number; unread?: boolean }>({
      query: (params) => `/communication/notifications${queryString(params)}`,
      transformResponse: (response: Envelope<NotificationRow[]>) => {
        const paged = unwrapPaged<NotificationRow>(response);
        return { ...paged, unreadCount: Number(paged.extra?.['unreadCount'] ?? 0) };
      },
      providesTags: ['Notification'],
    }),

    /**
     * Lightweight badge poll. Requests a single row because only the meta
     * counter is needed — fetching a full page every minute would be waste.
     */
    unreadCount: build.query<{ unreadCount: number }, void>({
      query: () => '/communication/notifications?limit=1&unread=true',
      transformResponse: (response: Envelope<NotificationRow[]>) => ({
        unreadCount: Number(response.meta?.['unreadCount'] ?? 0),
      }),
      providesTags: ['Notification'],
    }),

    markNotificationsRead: build.mutation<void, { ids?: string[] }>({
      query: (body) => ({ url: '/communication/notifications/read', method: 'POST', body }),
      invalidatesTags: ['Notification'],
    }),

    /** People this user is allowed to start a conversation with. */
    contacts: build.query<
      Array<{ userId: string; name: string; role: string; detail: string }>,
      void
    >({
      query: () => '/communication/contacts',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['Conversation'],
    }),

    startConversation: build.mutation<
      { id: string },
      { participantUserIds: string[]; studentId?: string; title?: string }
    >({
      query: (body) => ({
        url: '/communication/conversations',
        method: 'POST',
        body: { ...body, type: 'DIRECT' },
      }),
      transformResponse: unwrap<{ id: string }>,
      invalidatesTags: ['Conversation'],
    }),

    conversations: build.query<Array<Record<string, unknown>>, void>({
      query: () => '/communication/conversations',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['Conversation'],
    }),

    messages: build.query<Paged<Record<string, unknown>>, { conversationId: string; page?: number }>({
      query: ({ conversationId, ...params }) =>
        `/communication/conversations/${conversationId}/messages${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Conversation'],
    }),

    sendMessage: build.mutation<Record<string, unknown>, { conversationId: string; body: string }>({
      query: ({ conversationId, ...body }) => ({
        url: `/communication/conversations/${conversationId}/messages`,
        method: 'POST',
        body,
      }),
      transformResponse: unwrap,
      invalidatesTags: ['Conversation'],
    }),
  }),
});

export const {
  useAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useNotificationsQuery,
  useUnreadCountQuery,
  useMarkNotificationsReadMutation,
  useContactsQuery,
  useStartConversationMutation,
  useConversationsQuery,
  useMessagesQuery,
  useSendMessageMutation,
} = communicationApi;
