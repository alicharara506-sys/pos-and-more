import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'sm_session_token';
const TENANT_KEY = 'sm_current_tenant_id';

/**
 * The session token is a bearer credential equivalent to a password —
 * expo-secure-store backs onto the OS keychain (iOS) / Keystore-encrypted
 * SharedPreferences (Android), not plain AsyncStorage, which is why it's
 * used here specifically for the token (AsyncStorage is fine for the
 * non-secret cached tenant selection).
 */
export async function saveSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function loadSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export { TENANT_KEY };
