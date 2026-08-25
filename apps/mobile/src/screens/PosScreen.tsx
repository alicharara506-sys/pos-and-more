import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { CreateSaleInput } from '@salesmaster/contracts';
import { useAuth } from '../auth/AuthContext';
import {
  decrementCachedStock,
  getActiveBranch,
  listCachedVariants,
  type ActiveBranch,
  type CachedVariant,
} from '../db/catalog-cache';
import { mutationQueue } from '../sync/queue';

interface CartLine {
  variantId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

export function PosScreen() {
  const { currentTenantId } = useAuth();
  const [variants, setVariants] = useState<CachedVariant[]>([]);
  const [branch, setBranch] = useState<ActiveBranch | undefined>();
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setVariants(await listCachedVariants());
    setBranch(await getActiveBranch());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variants;
    return variants.filter(
      (v) => v.productName.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q),
    );
  }, [variants, search]);

  function addToCart(v: CachedVariant) {
    setCart((c) => {
      const existing = c.find((l) => l.variantId === v.id);
      if (existing)
        return c.map((l) => (l.variantId === v.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...c,
        {
          variantId: v.id,
          name: v.productName,
          sku: v.sku,
          unitPrice: Number(v.retailPrice),
          quantity: 1,
        },
      ];
    });
  }

  const total = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  async function handleCharge() {
    if (!branch || !currentTenantId || cart.length === 0) return;
    setConfirmation(null);

    const clientMutationId = Crypto.randomUUID();
    const payload: CreateSaleInput = {
      clientMutationId,
      branchId: branch.branchId,
      registerId: branch.registerId ?? undefined,
      stockLocationId: branch.stockLocationId,
      lines: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity, discountAmount: 0 })),
      payments: [{ method: 'CASH', amount: Number(total.toFixed(2)) }],
      currency: 'USD',
    };

    // This is the entire offline path: enqueue locally and return
    // immediately. No network call happens here — whether the device is
    // online or not is irrelevant to this function. SyncEngine (wired in
    // src/sync/sync-service.ts) picks this up and POSTs it to /sales with
    // the same clientMutationId, which the API's unique constraint makes
    // idempotent — see apps/api/test/integration/sales.spec.ts.
    await mutationQueue.enqueue({
      id: clientMutationId,
      kind: 'sale.create',
      endpoint: '/sales',
      payload,
    });

    for (const line of cart) {
      await decrementCachedStock(line.variantId, line.quantity);
    }

    setConfirmation(`Sale queued — $${total.toFixed(2)}. Will sync automatically.`);
    setCart([]);
    await reload();
  }

  if (!branch) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>
          No branch data cached yet. Connect to the internet once to sync your catalog.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search products or SKU…"
        value={search}
        onChangeText={setSearch}
      />

      <FlatList
        data={filtered}
        keyExtractor={(v) => v.id}
        style={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.productRow}
            onPress={() => addToCart(item)}
            disabled={item.availableQuantity <= 0}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{item.productName}</Text>
              <Text style={styles.productMeta}>
                {item.sku} · {item.availableQuantity} on hand
              </Text>
            </View>
            <Text style={styles.productPrice}>${item.retailPrice}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No cached products match.</Text>}
      />

      <View style={styles.cart}>
        <Text style={styles.cartTitle}>Cart ({cart.length})</Text>
        {cart.map((line) => (
          <Text key={line.variantId} style={styles.cartLine}>
            {line.quantity} × {line.name} — ${(line.unitPrice * line.quantity).toFixed(2)}
          </Text>
        ))}
        <Text style={styles.total}>Total: ${total.toFixed(2)}</Text>
        {confirmation && <Text style={styles.confirmation}>{confirmation}</Text>}
        <Pressable
          style={[styles.chargeButton, cart.length === 0 && styles.chargeButtonDisabled]}
          onPress={handleCharge}
          disabled={cart.length === 0}
        >
          <Text style={styles.chargeButtonText}>Charge (Cash)</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  search: {
    margin: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  list: { flex: 1 },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  productName: { fontSize: 15, fontWeight: '500' },
  productMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  productPrice: { fontSize: 15, fontWeight: '600' },
  emptyText: { textAlign: 'center', color: '#6b7280', padding: 24 },
  cart: { borderTopWidth: 1, borderTopColor: '#e5e7eb', padding: 16 },
  cartTitle: { fontWeight: '600', marginBottom: 6 },
  cartLine: { fontSize: 13, color: '#374151' },
  total: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  confirmation: { color: '#16a34a', marginTop: 6, fontSize: 13 },
  chargeButton: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  chargeButtonDisabled: { opacity: 0.4 },
  chargeButtonText: { color: '#fff', fontWeight: '600' },
});
