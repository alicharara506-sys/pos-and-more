import { Injectable } from '@nestjs/common';
import { CommerceProvider } from '@salesmaster/database';
import { createWooCommerceConnector, type CommerceConnector } from '@salesmaster/integrations';

/**
 * Resolves a `CommerceConnector` instance for a given provider + store URL.
 * This is the ONE place that maps a provider enum to a concrete connector
 * implementation — every other service in this module only ever talks to
 * the `CommerceConnector` interface (spec §13.1: adding a platform should
 * not require touching core sales/inventory logic).
 */
@Injectable()
export class ConnectorRegistry {
  resolve(provider: CommerceProvider, storeUrl: string): CommerceConnector {
    switch (provider) {
      case CommerceProvider.WOOCOMMERCE:
        return createWooCommerceConnector(storeUrl);
      case CommerceProvider.SHOPIFY:
        throw new Error(
          'Shopify connector is not implemented in this phase — see docs/integrations.md',
        );
      case CommerceProvider.UNIVERSAL_REST:
        throw new Error(
          'A universal REST connection requires per-store field-mapping configuration supplied by the caller; ' +
            'use the UniversalRestConnector class directly rather than the registry for now.',
        );
      default:
        throw new Error(`Unknown commerce provider: ${provider}`);
    }
  }
}
