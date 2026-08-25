import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { QueueItem, QueueItemStatus } from '@salesmaster/offline-sync';
import { mutationQueue } from '../sync/queue';

const STATUS_LABEL: Record<QueueItemStatus, string> = {
  pending: 'Waiting to sync',
  syncing: 'Syncing…',
  synced: 'Synced',
  failed: 'Retrying soon',
  dead: 'Needs attention',
};

const STATUS_COLOR: Record<QueueItemStatus, string> = {
  pending: '#6b7280',
  syncing: '#2563eb',
  synced: '#16a34a',
  failed: '#d97706',
  dead: '#dc2626',
};

export function QueueScreen() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const all = await mutationQueue.listAll();
    // Most recent first, so a cashier sees what they just rang up at the top.
    setItems([...all].sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleRetry(id: string) {
    await mutationQueue.manualRetry(id);
    await load();
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      contentContainerStyle={items.length === 0 ? styles.emptyContainer : undefined}
      ListEmptyComponent={
        <Text style={styles.emptyText}>
          No offline sales yet — they'll show up here the moment you charge one.
        </Text>
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kind}>{item.kind}</Text>
            <Text style={[styles.status, { color: STATUS_COLOR[item.status] }]}>
              {STATUS_LABEL[item.status]}
            </Text>
            {item.lastError && <Text style={styles.error}>{item.lastError}</Text>}
            <Text style={styles.timestamp}>{new Date(item.createdAt).toLocaleString()}</Text>
          </View>
          {item.status === 'dead' && (
            <Pressable style={styles.retryButton} onPress={() => handleRetry(item.id)}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#6b7280', textAlign: 'center', padding: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  kind: { fontSize: 14, fontWeight: '500' },
  status: { fontSize: 13, marginTop: 2 },
  error: { fontSize: 12, color: '#dc2626', marginTop: 2 },
  timestamp: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
  retryButton: {
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
