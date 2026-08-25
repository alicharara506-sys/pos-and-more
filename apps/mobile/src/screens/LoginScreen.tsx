import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth, ApiError } from '../auth/AuthContext';

export function LoginScreen() {
  const { login, completeMfa } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.mfaRequired && result.mfaChallengeToken) {
        setMfaChallengeToken(result.mfaChallengeToken);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfa() {
    if (!mfaChallengeToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await completeMfa(mfaChallengeToken, mfaCode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SalesMaster Pro</Text>
      <Text style={styles.subtitle}>
        Sign in to start selling — offline sales sync automatically once you're back online.
      </Text>

      {mfaChallengeToken ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="6-digit authenticator code"
            keyboardType="number-pad"
            maxLength={6}
            value={mfaCode}
            onChangeText={setMfaCode}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={styles.button} onPress={handleMfa} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify</Text>
            )}
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={styles.button} onPress={handleLogin} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#666', marginBottom: 24, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 15,
  },
  button: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  error: { color: '#dc2626', marginBottom: 8, fontSize: 13 },
});
