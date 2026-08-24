import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Placeholder entry point. The native mobile app — including the
 * SQLite-backed offline-first POS, mutation queue, and sync engine
 * described in docs/offline-sync.md — is scoped for a future build phase
 * and is NOT implemented yet. This screen exists so the Expo project boots
 * and is honest about that status rather than a fake "coming soon" polish
 * pass. See README.md for the current phase's actual scope.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>SalesMaster Pro</Text>
      <Text style={styles.subtitle}>Mobile app scaffold — offline POS not yet implemented.</Text>
      <Text style={styles.body}>
        This phase shipped the web app and API (see apps/web, apps/api). The React Native app, local
        SQLite cache, and mutation-queue sync engine are planned for a later phase — see
        docs/offline-sync.md for the design.
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 16, textAlign: 'center' },
  body: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 20 },
});
