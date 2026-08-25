import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { loadEnv } from '@salesmaster/config';
import { Money } from '@salesmaster/domain';
import { InvoiceStatus, PaymentStatus, QuoteStatus, type Prisma } from '@salesmaster/database';
import type {
  CreateInvoiceInput,
  CreateQuoteInput,
  RecordInvoicePaymentInput,
  SendInvoiceInput,
} from '@salesmaster/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { EMAIL_ADAPTER, type EmailAdapter } from '../notifications/email/email-adapter.interface';
import { SMS_ADAPTER, type SmsAdapter } from '../notifications/sms/sms-adapter.interface';
import { QrService } from '../common/qr/qr.service';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
    private readonly qr: QrService,
  ) {}

  /** The public view link, QR-encoded — scan it at the counter to pull up the invoice on a phone. */
  async getQrCode(
    tenantId: string,
    invoiceId: string,
  ): Promise<{ dataUrl: string; viewUrl: string }> {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const viewUrl = `${loadEnv().APP_URL}/public/invoices/${invoice.publicToken}`;
    return { dataUrl: await this.qr.toDataUrl(viewUrl), viewUrl };
  }

  private async generateInvoiceNumber(tx: PrismaTx, tenantId: string): Promise<string> {
    const count = await tx.invoice.count({ where: { tenantId } });
    const year = new Date().getFullYear();
    return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async createInvoice(tenantId: string, actorUserId: string, input: CreateInvoiceInput) {
    const [branch, customer] = await Promise.all([
      this.prisma.client.branch.findFirst({ where: { id: input.branchId, tenantId } }),
      this.prisma.client.customer.findFirst({ where: { id: input.customerId, tenantId } }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');
    if (!customer) throw new NotFoundException('Customer not found');

    const currency = input.currency;
    let subtotal = Money.zero(currency);
    let taxTotal = Money.zero(currency);
    let discountTotal = Money.zero(currency);

    const computedLines = input.lines.map((line) => {
      const unitPrice = Money.of(line.unitPrice, currency);
      const tax = Money.of(line.taxAmount, currency);
      const discount = Money.of(line.discountAmount, currency);
      const lineSubtotal = unitPrice.multiply(line.quantity);
      const lineTotal = lineSubtotal.subtract(discount).add(tax);

      subtotal = subtotal.add(lineSubtotal);
      taxTotal = taxTotal.add(tax);
      discountTotal = discountTotal.add(discount);

      return { ...line, unitPrice, tax, discount, lineTotal };
    });

    const total = subtotal.subtract(discountTotal).add(taxTotal);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const number = await this.generateInvoiceNumber(tx, tenantId);
          const invoice = await tx.invoice.create({
            data: {
              tenantId,
              branchId: input.branchId,
              customerId: input.customerId,
              number,
              status: InvoiceStatus.ISSUED,
              dueDate: input.dueDate,
              subtotal: subtotal.toDecimalString(),
              taxTotal: taxTotal.toDecimalString(),
              discountTotal: discountTotal.toDecimalString(),
              total: total.toDecimalString(),
              currency,
              notes: input.notes,
              termsText: input.termsText,
              publicToken: nanoid(32),
              lines: {
                create: computedLines.map((l) => ({
                  tenantId,
                  variantId: l.variantId,
                  description: l.description,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice.toDecimalString(),
                  taxAmount: l.tax.toDecimalString(),
                  discountAmount: l.discount.toDecimalString(),
                  lineTotal: l.lineTotal.toDecimalString(),
                })),
              },
            },
            include: { lines: true },
          });

          await this.audit.record(
            {
              tenantId,
              actorUserId,
              action: 'invoices.created',
              entityType: 'Invoice',
              entityId: invoice.id,
            },
            tx,
          );
          await this.outbox.publish(
            {
              aggregateType: 'Invoice',
              aggregateId: invoice.id,
              eventType: 'invoice.issued',
              payload: { invoiceId: invoice.id, tenantId },
            },
            tx,
          );

          return invoice;
        });
      } catch (err: unknown) {
        const isUniqueViolation = (err as { code?: string })?.code === 'P2002';
        if (isUniqueViolation && attempt < 2) continue;
        throw err;
      }
    }
    throw new Error('Failed to allocate a unique invoice number after retries');
  }

  async recordPayment(
    tenantId: string,
    actorUserId: string,
    invoiceId: string,
    input: RecordInvoicePaymentInput,
  ) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.VOID)
      throw new BadRequestException('Cannot record a payment on a void invoice');

    const currency = invoice.currency;
    const amount = Money.of(input.amount, currency);
    const total = Money.of(invoice.total.toString(), currency);
    const alreadyPaid = Money.of(invoice.amountPaid.toString(), currency);
    const newPaid = alreadyPaid.add(amount);

    if (newPaid.compare(total) > 0) {
      throw new BadRequestException('Payment exceeds the outstanding invoice balance');
    }

    return this.prisma.client.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          tenantId,
          invoiceId,
          method: input.method,
          amount: amount.toDecimalString(),
          currency,
          reference: input.reference,
          status: PaymentStatus.COMPLETED,
        },
      });

      const status =
        newPaid.compare(total) === 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: newPaid.toDecimalString(), status },
      });

      await this.audit.record(
        {
          tenantId,
          actorUserId,
          action: 'invoices.payment_recorded',
          entityType: 'Invoice',
          entityId: invoiceId,
          metadata: { amount: amount.toDecimalString() },
        },
        tx,
      );
      if (status === InvoiceStatus.PAID) {
        await this.outbox.publish(
          {
            aggregateType: 'Invoice',
            aggregateId: invoiceId,
            eventType: 'invoice.paid',
            payload: { invoiceId, tenantId },
          },
          tx,
        );
      }

      return updated;
    });
  }

  async voidInvoice(tenantId: string, actorUserId: string, invoiceId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.PAID)
      throw new BadRequestException(
        'A fully paid invoice cannot be voided; issue a credit note instead',
      );

    const updated = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VOID, voidedAt: new Date() },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'invoices.voided',
      entityType: 'Invoice',
      entityId: invoiceId,
    });
    return updated;
  }

  /**
   * On-demand delivery, distinct from the automatic invoice.issued/paid
   * outbox-driven emails (apps/worker) — this is a cashier explicitly
   * clicking "Send" and wanting to know right now whether it actually went
   * out, so it calls the adapter directly rather than queuing it. Honest
   * result: `delivered` reflects what the adapter actually reports, never
   * assumed true just because the request didn't throw.
   */
  async send(tenantId: string, actorUserId: string, invoiceId: string, input: SendInvoiceInput) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { customer: true, tenant: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.publicTokenRevokedAt) {
      throw new BadRequestException("This invoice's public link has been revoked");
    }

    const viewUrl = `${loadEnv().APP_URL}/public/invoices/${invoice.publicToken}`;
    const message = `Invoice ${invoice.number} from ${invoice.tenant.displayName}: ${invoice.currency} ${invoice.total.toString()}. View and pay: ${viewUrl}`;

    let result: { delivered: boolean; provider: string };
    if (input.channel === 'email') {
      if (!invoice.customer.email) {
        throw new BadRequestException('This customer has no email address on file');
      }
      result = await this.email.send({
        to: invoice.customer.email,
        subject: `Invoice ${invoice.number} from ${invoice.tenant.displayName}`,
        text: message,
      });
    } else {
      if (!invoice.customer.phone) {
        throw new BadRequestException('This customer has no phone number on file');
      }
      result = await this.sms.send({ to: invoice.customer.phone, body: message });
    }

    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'invoices.sent',
      entityType: 'Invoice',
      entityId: invoiceId,
      metadata: { channel: input.channel, delivered: result.delivered, provider: result.provider },
    });

    return result;
  }

  async revokePublicLink(tenantId: string, actorUserId: string, invoiceId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const updated = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { publicTokenRevokedAt: new Date() },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'invoices.public_link_revoked',
      entityType: 'Invoice',
      entityId: invoiceId,
    });
    return updated;
  }

  async getPublicInvoice(token: string) {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { publicToken: token },
      include: { lines: true, customer: true, payments: true },
    });
    if (!invoice || invoice.publicTokenRevokedAt) {
      throw new NotFoundException('Invoice link not found or revoked');
    }
    return invoice;
  }

  async list(tenantId: string) {
    return this.prisma.client.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { lines: true, payments: true, customer: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  // --- Quotes ---------------------------------------------------------------

  async createQuote(tenantId: string, input: CreateQuoteInput) {
    const currency = input.currency;
    let subtotal = Money.zero(currency);
    const lines = input.lines.map((l) => {
      const unitPrice = Money.of(l.unitPrice, currency);
      const lineTotal = unitPrice.multiply(l.quantity);
      subtotal = subtotal.add(lineTotal);
      return { ...l, unitPrice, lineTotal };
    });

    return this.prisma.client.quote.create({
      data: {
        tenantId,
        branchId: input.branchId,
        customerId: input.customerId,
        status: QuoteStatus.DRAFT,
        subtotal: subtotal.toDecimalString(),
        total: subtotal.toDecimalString(),
        currency,
        expiresAt: input.expiresAt,
        lines: {
          create: lines.map((l) => ({
            tenantId,
            variantId: l.variantId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice.toDecimalString(),
            lineTotal: l.lineTotal.toDecimalString(),
          })),
        },
      },
      include: { lines: true },
    });
  }

  async convertQuoteToInvoice(tenantId: string, actorUserId: string, quoteId: string) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, tenantId },
      include: { lines: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.status === QuoteStatus.CONVERTED)
      throw new BadRequestException('Quote already converted');

    const invoice = await this.createInvoice(tenantId, actorUserId, {
      branchId: quote.branchId,
      customerId: quote.customerId,
      currency: quote.currency,
      lines: quote.lines.map((l) => ({
        variantId: l.variantId,
        description: l.description ?? 'Item',
        quantity: l.quantity,
        unitPrice: Number(l.unitPrice),
        taxAmount: 0,
        discountAmount: 0,
      })),
    });

    await this.prisma.client.quote.update({
      where: { id: quoteId },
      data: { status: QuoteStatus.CONVERTED, convertedInvoiceId: invoice.id },
    });

    return invoice;
  }
}
