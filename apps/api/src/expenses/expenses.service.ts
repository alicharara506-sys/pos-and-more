import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateExpenseInput, ListExpensesQuery } from '@salesmaster/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, actorUserId: string, input: CreateExpenseInput) {
    const branch = await this.prisma.client.branch.findFirst({
      where: { id: input.branchId, tenantId },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const category = await this.prisma.client.expenseCategory.findFirst({
      where: { id: input.categoryId, tenantId },
    });
    if (!category) throw new NotFoundException('Expense category not found');

    const expense = await this.prisma.client.expense.create({
      data: {
        tenantId,
        branchId: input.branchId,
        categoryId: input.categoryId,
        vendor: input.vendor,
        amount: input.amount,
        taxAmount: input.taxAmount,
        date: input.date,
        paymentAccount: input.paymentAccount,
        notes: input.notes,
        receiptUrl: input.receiptUrl,
        createdByUserId: actorUserId,
      },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'expenses.created',
      entityType: 'Expense',
      entityId: expense.id,
    });
    return expense;
  }

  async list(tenantId: string, query: ListExpensesQuery) {
    const expenses = await this.prisma.client.expense.findMany({
      where: {
        tenantId,
        branchId: query.branchId,
        categoryId: query.categoryId,
        date: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
      },
      include: { category: true },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { date: 'desc' },
    });
    return { expenses, page: query.page, pageSize: query.pageSize };
  }

  async listCategories(tenantId: string) {
    return this.prisma.client.expenseCategory.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(tenantId: string, name: string) {
    return this.prisma.client.expenseCategory.create({ data: { tenantId, name } });
  }
}
