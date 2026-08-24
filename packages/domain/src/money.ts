import Decimal from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * Decimal-safe monetary value paired with an ISO 4217 currency code.
 * Never use JS `number` for money — floating point causes cent-level drift
 * over thousands of transactions.
 */
export class Money {
  private readonly amount: Decimal;
  readonly currency: string;

  private constructor(amount: Decimal.Value, currency: string) {
    this.amount = new Decimal(amount);
    this.currency = currency.toUpperCase();
  }

  static of(amount: Decimal.Value, currency: string): Money {
    return new Money(amount, currency);
  }

  static zero(currency: string): Money {
    return new Money(0, currency);
  }

  /** Construct from integer minor units (cents). */
  static fromCents(cents: number, currency: string): Money {
    return new Money(new Decimal(cents).dividedBy(100), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  multiply(factor: Decimal.Value): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  percentage(percent: Decimal.Value): Money {
    return new Money(this.amount.times(percent).dividedBy(100), this.currency);
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  compare(other: Money): number {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount);
  }

  /** Round to the currency's minor unit (assumes 2 decimals; extend for JPY etc. if needed). */
  round(decimals = 2): Money {
    return new Money(this.amount.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP), this.currency);
  }

  toCents(): number {
    return this.amount.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  }

  toDecimalString(decimals = 2): string {
    return this.amount.toFixed(decimals);
  }

  toNumber(): number {
    return this.amount.toNumber();
  }
}
