import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';

function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {user ? <HomeScreen /> : <LoginScreen />}
      <StatusBar style="auto" />
    </View>
  );
}

/**
 * Offline-first POS: login and catalog refresh need connectivity, but
 * every sale rung up in HomeScreen/PosScreen is written to the local
 * SQLite mutation queue first and synced in the background — see
 * src/sync/sync-service.ts and docs/offline-sync.md.
 */
export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
});
