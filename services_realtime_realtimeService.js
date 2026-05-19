/**
 * ============================================================
 * APEX AI — Realtime / Messaging Service (Local DB)
 * No Supabase. Uses channelTable + messageTable from localDB.
 * BroadcastChannel provides real-time sync across tabs.
 * ============================================================
 */

import { channelTable, messageTable, subscribe, DB_KEYS } from './services_local_localDB'

export const MESSAGE_TYPE = {
  TEXT:     'text',
  ALERT:    'alert',
  SYSTEM:   'system',
  LOCATION: 'location',
}

export const realtimeService = {

  fetchChannels() {
    return channelTable.list().sort((a, b) =>
      new Date(b.updated_at) - new Date(a.updated_at)
    )
  },

  fetchMessages(channelId, limit = 100) {
    return messageTable
      .list({ channel_id: channelId })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .slice(-limit)
  },

  sendMessage(channelId, content, type = MESSAGE_TYPE.TEXT, senderName = 'Operator') {
    const msg = messageTable.create({
      channel_id:  channelId,
      content,
      type,
      sender_name: senderName,
    })
    // Update channel last message + timestamp
    try {
      channelTable.update(channelId, {
        last_message: content,
        updated_at:   new Date().toISOString(),
      })
    } catch {}
    return msg
  },

  createChannel(name, type = 'ops') {
    return channelTable.create({
      name,
      type,
      unread:       0,
      last_message: '',
    })
  },

  deleteChannel(channelId) {
    channelTable.delete(channelId)
    // Also remove messages for this channel
    const msgs = messageTable.list({ channel_id: channelId })
    msgs.forEach(m => messageTable.delete(m.id))
  },

  markRead(channelId) {
    try { channelTable.update(channelId, { unread: 0 }) } catch {}
  },

  // Subscribe to new messages in a channel via BroadcastChannel
  subscribeToChannel(channelId, callback) {
    return subscribe(DB_KEYS.MESSAGES, (event) => {
      if (event.event === 'INSERT' && event.payload?.channel_id === channelId) {
        callback(event.payload)
      }
    })
  },

  subscribeToChannels(callback) {
    return subscribe(DB_KEYS.CHANNELS, () => callback())
  },
}

export default realtimeService
