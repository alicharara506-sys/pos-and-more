-- CreateEnum
CREATE TYPE "CommerceProvider" AS ENUM ('WOOCOMMERCE', 'SHOPIFY', 'UNIVERSAL_REST');

-- CreateEnum
CREATE TYPE "CommerceConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncDataDomain" AS ENUM ('PRODUCTS', 'INVENTORY', 'ORDERS', 'CUSTOMERS');

-- CreateEnum
CREATE TYPE "SyncSourceOfTruth" AS ENUM ('SALESMASTER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ExternalObjectType" AS ENUM ('PRODUCT', 'VARIANT', 'ORDER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('PULL', 'PUSH');

-- CreateTable
CREATE TABLE "CommerceConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "CommerceProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "storeUrl" TEXT,
    "credentialsEncrypted" TEXT NOT NULL,
    "syncConfig" JSONB NOT NULL DEFAULT '{}',
    "status" "CommerceConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalObjectMap" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalType" "ExternalObjectType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "canonicalType" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalObjectMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "domain" "SyncDataDomain" NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "cursor" TEXT,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommerceConnection_tenantId_provider_idx" ON "CommerceConnection"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "ExternalObjectMap_tenantId_canonicalType_canonicalId_idx" ON "ExternalObjectMap"("tenantId", "canonicalType", "canonicalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalObjectMap_connectionId_externalType_externalId_key" ON "ExternalObjectMap"("connectionId", "externalType", "externalId");

-- CreateIndex
CREATE INDEX "SyncJob_tenantId_connectionId_domain_idx" ON "SyncJob"("tenantId", "connectionId", "domain");

-- CreateIndex
CREATE INDEX "SyncJob_status_startedAt_idx" ON "SyncJob"("status", "startedAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_connectionId_receivedAt_idx" ON "WebhookDelivery"("tenantId", "connectionId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_connectionId_externalEventId_key" ON "WebhookDelivery"("connectionId", "externalEventId");

-- AddForeignKey
ALTER TABLE "CommerceConnection" ADD CONSTRAINT "CommerceConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalObjectMap" ADD CONSTRAINT "ExternalObjectMap_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CommerceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CommerceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CommerceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
