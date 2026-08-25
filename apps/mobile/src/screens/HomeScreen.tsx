import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '../auth/AuthContext';
import { syncCatalogDown } from '../sync/catalog-sync';
import { startSyncService, type SyncServiceHandle } from '../sync/sync-service';
import { PosScreen } from './PosScreen';
import { QueueScreen } from './QueueScreen';

type Tab = 'pos' | 'queue';

export function HomeScreen() {
  const { user, currentTenantId, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('pos');
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const syncHandleRef = useRef<SyncServiceHandle | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentTenantId) return;
    syncHandleRef.current = startSyncService(currentTenantId);
    return () => syncHandleRef.current?.stop();
  }, [currentTenantId]);

  async function handleSyncCatalog() {
    if (!currentTenantId) return;
    setCatalogSyncing(true);
    try {
      await syncCatalogDown(currentTenantId);
    } catch {
      // Honest failure: the catalog just stays whatever it was cached as before. No fake "synced" state.
    } finally {
      setCatalogSyncing(false);
    }
  }

  if (!currentTenantId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>
          This account has no business set up yet. Use the web app to complete onboarding first.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{tab === 'pos' ? 'Sell' : 'Sync queue'}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: isOnline ? '#16a34a' : '#dc2626' }]} />
            <Text style={styles.statusText}>
              {isOnline ? 'Online' : 'Offline — sales are queued locally'}
            </Text>
          </View>
        </View>
        <Pressable onPress={handleSyncCatalog} disabled={catalogSyncing}>
          <Text style={styles.syncLink}>{catalogSyncing ? 'Syncing…' : 'Refresh catalog'}</Text>
        </Pressable>
      </View>

      <View style={styles.content}>{tab === 'pos' ? <PosScreen /> : <QueueScreen />}</View>

      <View style={styles.tabBar}>
        <Pressable style={styles.tabButton} onPress={() => setTab('pos')}>
          <Text style={[styles.tabLabel, tab === 'pos' && styles.tabLabelActive]}>Sell</Text>
        </Pressable>
        <Pressable style={styles.tabButton} onPress={() => setTab('queue')}>
          <Text style={[styles.tabLabel, tab === 'queue' && styles.tabLabelActive]}>
            Sync queue
          </Text>
        </Pressable>
        <Pressable style={styles.tabButton} onPress={() => logout()}>
          <Text style={styles.tabLabel}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { textAlign: 'center', color: '#6b7280' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 12, color: '#6b7280' },
  syncLink: { color: '#1d4ed8', fontSize: 13, fontWeight: '500' },
  content: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { fontSize: 13, color: '#6b7280' },
  tabLabelActive: { color: '#1d4ed8', fontWeight: '700' },
});
