import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CommerceConnectionStatus,
  CommerceProvider,
  ExternalObjectType,
  SyncDataDomain,
  SyncDirection,
  SyncJobStatus,
} from '@salesmaster/database';
import type { CanonicalProduct } from '@salesmaster/integrations';
import type { CreateCommerceConnectionInput } from '@salesmaster/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorRegistry } from './connector-registry';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly registry: ConnectorRegistry,
  ) {}

  async createConnection(
    tenantId: string,
    actorUserId: string,
    input: CreateCommerceConnectionInput,
  ) {
    const connector = this.registry.resolve(input.provider, input.storeUrl);

    let authorized;
    try {
      authorized = await connector.authorize(input.credentials);
    } catch (err) {
      throw new BadRequestException(
        `Could not connect to ${input.provider}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const connection = await this.prisma.client.commerceConnection.create({
      data: {
        tenantId,
        provider: input.provider,
        name: input.name,
        storeUrl: input.storeUrl,
        credentialsEncrypted: this.encryption.encrypt(JSON.stringify(authorized.credentials)),
        status: CommerceConnectionStatus.CONNECTED,
      },
    });

    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'integrations.connection_created',
      entityType: 'CommerceConnection',
      entityId: connection.id,
      metadata: { provider: input.provider, storeUrl: input.storeUrl },
    });

    return this.sanitize(connection);
  }

  async listConnections(tenantId: string) {
    const connections = await this.prisma.client.commerceConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map((c) => this.sanitize(c));
  }

  async getConnectionHealth(tenantId: string, connectionId: string) {
    const connection = await this.getOwnedConnection(tenantId, connectionId);
    const [lastJobs, deliveredCount, deadLetterCount] = await Promise.all([
      this.prisma.client.syncJob.findMany({
        where: { connectionId },
        orderBy: { startedAt: 'desc' },
        take: 5,
      }),
      this.prisma.client.webhookDelivery.count({
        where: { connectionId, processedAt: { not: null } },
      }),
      this.prisma.client.webhookDelivery.count({ where: { connectionId, error: { not: null } } }),
    ]);
    return {
      connection: this.sanitize(connection),
      recentSyncJobs: lastJobs,
      webhooksDelivered: deliveredCount,
      webhooksFailed: deadLetterCount,
    };
  }

  async testConnection(tenantId: string, connectionId: string) {
    const connection = await this.getOwnedConnection(tenantId, connectionId);
    const connector = this.registry.resolve(connection.provider, connection.storeUrl ?? '');
    const credentials = this.decryptCredentials(connection.credentialsEncrypted);

    const health = await connector.testConnection(credentials);

    await this.prisma.client.commerceConnection.update({
      where: { id: connectionId },
      data: health.healthy
        ? { status: CommerceConnectionStatus.CONNECTED, lastError: null }
        : {
            status: CommerceConnectionStatus.ERROR,
            lastError: health.message,
            lastErrorAt: new Date(),
          },
    });

    return health;
  }

  async disconnect(tenantId: string, actorUserId: string, connectionId: string) {
    await this.getOwnedConnection(tenantId, connectionId);
    const connection = await this.prisma.client.commerceConnection.update({
      where: { id: connectionId },
      data: { status: CommerceConnectionStatus.DISCONNECTED },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'integrations.connection_disconnected',
      entityType: 'CommerceConnection',
      entityId: connectionId,
    });
    return this.sanitize(connection);
  }

  /**
   * Pulls every page of products from the connector and upserts them into
   * the canonical catalog via ExternalObjectMap — a re-run (or a webhook
   * replay hitting the same product) updates the existing mapped record
   * rather than creating a duplicate (spec §13.4, acceptance test #8's
   * dedup requirement, applied here to products as well as orders).
   */
  async syncProducts(tenantId: string, actorUserId: string, connectionId: string) {
    const connection = await this.getOwnedConnection(tenantId, connectionId);
    const connector = this.registry.resolve(connection.provider, connection.storeUrl ?? '');
    const credentials = this.decryptCredentials(connection.credentialsEncrypted);

    const job = await this.prisma.client.syncJob.create({
      data: {
        tenantId,
        connectionId,
        domain: SyncDataDomain.PRODUCTS,
        direction: SyncDirection.PULL,
        status: SyncJobStatus.RUNNING,
      },
    });

    let itemsProcessed = 0;
    try {
      let cursor: string | undefined;
      do {
        const page = await connector.pullProducts(credentials, cursor);
        for (const product of page.items) {
          await this.upsertCanonicalProduct(tenantId, connectionId, product);
          itemsProcessed++;
        }
        cursor = page.nextCursor;
      } while (cursor);

      await this.prisma.client.syncJob.update({
        where: { id: job.id },
        data: { status: SyncJobStatus.SUCCEEDED, itemsProcessed, finishedAt: new Date() },
      });
      await this.prisma.client.commerceConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncAt: new Date(),
          status: CommerceConnectionStatus.CONNECTED,
          lastError: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.client.syncJob.update({
        where: { id: job.id },
        data: {
          status: SyncJobStatus.FAILED,
          itemsProcessed,
          error: message,
          finishedAt: new Date(),
        },
      });
      await this.prisma.client.commerceConnection.update({
        where: { id: connectionId },
        data: {
          status: CommerceConnectionStatus.ERROR,
          lastError: message,
          lastErrorAt: new Date(),
        },
      });
      throw err;
    }

    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'integrations.products_synced',
      entityType: 'CommerceConnection',
      entityId: connectionId,
      metadata: { itemsProcessed },
    });

    return { itemsProcessed };
  }

  /**
   * Creates or updates a canonical Product/ProductVariant for one external
   * product. If a ProductVariant with the same SKU already exists for this
   * tenant (a merchant who manually created it before connecting the
   * store), it is LINKED via ExternalObjectMap rather than duplicated —
   * this is the "detect duplicates and update the existing mapped record"
   * requirement extended to the first-sync merge case.
   */
  private async upsertCanonicalProduct(
    tenantId: string,
    connectionId: string,
    product: CanonicalProduct,
  ): Promise<void> {
    const existingMap = await this.prisma.client.externalObjectMap.findUnique({
      where: {
        connectionId_externalType_externalId: {
          connectionId,
          externalType: ExternalObjectType.PRODUCT,
          externalId: product.externalId,
        },
      },
    });

    let productId: string;
    if (existingMap) {
      productId = existingMap.canonicalId;
      await this.prisma.client.product.update({
        where: { id: productId },
        data: { name: product.name, description: product.description },
      });
    } else {
      const created = await this.prisma.client.product.create({
        data: { tenantId, name: product.name, description: product.description },
      });
      productId = created.id;
      await this.prisma.client.externalObjectMap.create({
        data: {
          tenantId,
          connectionId,
          externalType: ExternalObjectType.PRODUCT,
          externalId: product.externalId,
          canonicalType: 'Product',
          canonicalId: productId,
        },
      });
    }

    for (const variant of product.variants) {
      await this.upsertCanonicalVariant(tenantId, connectionId, productId, variant);
    }
  }

  private async upsertCanonicalVariant(
    tenantId: string,
    connectionId: string,
    productId: string,
    variant: CanonicalProduct['variants'][number],
  ): Promise<void> {
    const existingMap = await this.prisma.client.externalObjectMap.findUnique({
      where: {
        connectionId_externalType_externalId: {
          connectionId,
          externalType: ExternalObjectType.VARIANT,
          externalId: variant.externalId,
        },
      },
    });

    if (existingMap) {
      await this.prisma.client.productVariant.update({
        where: { id: existingMap.canonicalId },
        data: { retailPrice: variant.price.amount, barcode: variant.barcode },
      });
      return;
    }

    // First sync: link to an existing SKU match rather than duplicate it.
    const bySku = variant.sku
      ? await this.prisma.client.productVariant.findUnique({
          where: { tenantId_sku: { tenantId, sku: variant.sku } },
        })
      : null;

    const canonicalVariantId = bySku
      ? bySku.id
      : (
          await this.prisma.client.productVariant.create({
            data: {
              tenantId,
              productId,
              sku: variant.sku || `EXT-${variant.externalId}`,
              barcode: variant.barcode,
              costPrice: '0',
              retailPrice: variant.price.amount,
              reorderPoint: 0,
              reorderBuffer: 0,
            },
          })
        ).id;

    await this.prisma.client.externalObjectMap.create({
      data: {
        tenantId,
        connectionId,
        externalType: ExternalObjectType.VARIANT,
        externalId: variant.externalId,
        canonicalType: 'ProductVariant',
        canonicalId: canonicalVariantId,
      },
    });
  }

  /**
   * Pushes current stock levels for every mapped variant to the connected
   * store. Only variants this connection has already synced (i.e. have an
   * ExternalObjectMap row) are pushed — never a guess at what external id
   * an unmapped variant might have.
   */
  async pushInventory(tenantId: string, actorUserId: string, connectionId: string) {
    const connection = await this.getOwnedConnection(tenantId, connectionId);
    const connector = this.registry.resolve(connection.provider, connection.storeUrl ?? '');
    const credentials = this.decryptCredentials(connection.credentialsEncrypted);

    const maps = await this.prisma.client.externalObjectMap.findMany({
      where: { tenantId, connectionId, externalType: ExternalObjectType.VARIANT },
    });

    const job = await this.prisma.client.syncJob.create({
      data: {
        tenantId,
        connectionId,
        domain: SyncDataDomain.INVENTORY,
        direction: SyncDirection.PUSH,
        status: SyncJobStatus.RUNNING,
      },
    });

    const updates = await Promise.all(
      maps.map(async (m) => {
        const balances = await this.prisma.client.inventoryBalance.findMany({
          where: { tenantId, variantId: m.canonicalId },
        });
        const quantity = balances.reduce((sum, b) => sum + b.quantity, 0);
        return { externalVariantId: m.externalId, quantity };
      }),
    );

    const result = await connector.pushInventory(credentials, updates);

    await this.prisma.client.syncJob.update({
      where: { id: job.id },
      data: {
        status: result.failed.length === 0 ? SyncJobStatus.SUCCEEDED : SyncJobStatus.FAILED,
        itemsProcessed: result.succeeded.length,
        error: result.failed.length > 0 ? JSON.stringify(result.failed) : undefined,
        finishedAt: new Date(),
      },
    });
    await this.prisma.client.commerceConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    });

    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'integrations.inventory_pushed',
      entityType: 'CommerceConnection',
      entityId: connectionId,
      metadata: { succeeded: result.succeeded.length, failed: result.failed.length },
    });

    return result;
  }

  /**
   * Inbound webhook handling: verifies the signature before touching
   * anything, then dedupes on (connectionId, externalEventId) — a replayed
   * delivery is a harmless no-op via the unique constraint, never a
   * double-applied change (acceptance test #8).
   */
  async handleWebhook(
    connectionId: string,
    headers: Record<string, string>,
    rawBody: Buffer,
  ): Promise<{ deduplicated: boolean }> {
    const connection = await this.prisma.client.commerceConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) throw new NotFoundException('Unknown connection');

    const connector = this.registry.resolve(connection.provider, connection.storeUrl ?? '');
    const credentials = this.decryptCredentials(connection.credentialsEncrypted);

    // An invalid/missing signature is the caller's fault (401), never a 500
    // — same posture as TokenService.verifyOneTimeToken for auth tokens.
    const verified = await connector
      .verifyWebhook(credentials, { headers, rawBody })
      .catch((err) => {
        throw new UnauthorizedException(
          err instanceof Error ? err.message : 'Webhook signature verification failed',
        );
      });

    try {
      await this.prisma.client.webhookDelivery.create({
        data: {
          tenantId: connection.tenantId,
          connectionId,
          externalEventId: verified.eventId,
          eventType: verified.eventType,
          payload: verified.payload as object,
          signatureVerified: true,
        },
      });
    } catch (err) {
      const isUniqueViolation = (err as { code?: string })?.code === 'P2002';
      if (isUniqueViolation) return { deduplicated: true };
      throw err;
    }

    try {
      const events = await connector.normalize(verified.payload);
      for (const event of events) {
        if (event.type === 'product.updated') {
          await this.upsertCanonicalProduct(connection.tenantId, connectionId, event.product);
        }
        // order.* events are recorded via the WebhookDelivery row above for
        // traceability; materializing them into Sale records requires a
        // merchant-configured default branch/stock-location per connection,
        // which is not implemented in this phase — see docs/integrations.md.
      }
      await this.prisma.client.webhookDelivery.updateMany({
        where: { connectionId, externalEventId: verified.eventId },
        data: { processedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Webhook processing failed for connection ${connectionId}: ${message}`);
      await this.prisma.client.webhookDelivery.updateMany({
        where: { connectionId, externalEventId: verified.eventId },
        data: { error: message },
      });
    }

    return { deduplicated: false };
  }

  private async getOwnedConnection(tenantId: string, connectionId: string) {
    const connection = await this.prisma.client.commerceConnection.findFirst({
      where: { id: connectionId, tenantId },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    return connection;
  }

  private decryptCredentials(encrypted: string): Record<string, string> {
    return JSON.parse(this.encryption.decrypt(encrypted));
  }

  /** Never returns credentialsEncrypted to a client — the whole point of encrypting it. */
  private sanitize<T extends { credentialsEncrypted: string }>(
    connection: T,
  ): Omit<T, 'credentialsEncrypted'> {
    const { credentialsEncrypted: _omit, ...rest } = connection;
    return rest;
  }
}
