import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from '@salesmaster/contracts';
import { CustomerStatus } from '@salesmaster/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, actorUserId: string, input: CreateCustomerInput) {
    const customer = await this.prisma.client.customer.create({
      data: {
        tenantId,
        name: input.name,
        company: input.company,
        email: input.email,
        phone: input.phone,
        birthday: input.birthday,
        taxId: input.taxId,
        notes: input.notes,
        creditLimit: input.creditLimit,
        paymentTermsDays: input.paymentTermsDays,
        tags: input.tags,
        consentMarketing: input.consentMarketing,
      },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'customers.created',
      entityType: 'Customer',
      entityId: customer.id,
    });
    return customer;
  }

  async update(
    tenantId: string,
    actorUserId: string,
    customerId: string,
    input: UpdateCustomerInput,
  ) {
    const existing = await this.prisma.client.customer.findFirst({
      where: { id: customerId, tenantId },
    });
    if (!existing) throw new NotFoundException('Customer not found');

    const customer = await this.prisma.client.customer.update({
      where: { id: customerId },
      data: {
        name: input.name,
        company: input.company,
        email: input.email,
        phone: input.phone,
        birthday: input.birthday,
        taxId: input.taxId,
        notes: input.notes,
        creditLimit: input.creditLimit,
        paymentTermsDays: input.paymentTermsDays,
        tags: input.tags,
        consentMarketing: input.consentMarketing,
        status: input.status as CustomerStatus | undefined,
      },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'customers.updated',
      entityType: 'Customer',
      entityId: customerId,
    });
    return customer;
  }

  async list(tenantId: string, query: ListCustomersQuery) {
    const customers = await this.prisma.client.customer.findMany({
      where: {
        tenantId,
        status: query.status,
        tags: query.tag ? { has: query.tag } : undefined,
        OR: query.search
          ? [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
    });
    return { customers, page: query.page, pageSize: query.pageSize };
  }

  async get(tenantId: string, customerId: string) {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id: customerId, tenantId },
      include: { addresses: true, loyaltyAccount: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const [sales, invoices] = await Promise.all([
      this.prisma.client.sale.findMany({
        where: { tenantId, customerId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.client.invoice.findMany({
        where: { tenantId, customerId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return { customer, timeline: { sales, invoices } };
  }
}
