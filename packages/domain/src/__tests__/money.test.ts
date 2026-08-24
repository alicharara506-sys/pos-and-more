import { describe, expect, it } from 'vitest';
import { Money } from '../money';

describe('Money', () => {
  it('adds and subtracts without floating point drift', () => {
    let total = Money.zero('USD');
    for (let i = 0; i < 1000; i++) {
      total = total.add(Money.of('0.1', 'USD'));
    }
    expect(total.toDecimalString()).toBe('100.00');
  });

  it('throws on cross-currency arithmetic', () => {
    const usd = Money.of(10, 'USD');
    const eur = Money.of(10, 'EUR');
    expect(() => usd.add(eur)).toThrow();
  });

  it('computes percentage tax correctly', () => {
    const price = Money.of('19.99', 'USD');
    const tax = price.percentage('8.25').round();
    expect(tax.toDecimalString()).toBe('1.65');
  });

  it('converts to/from cents without rounding error', () => {
    const m = Money.fromCents(1999, 'USD');
    expect(m.toDecimalString()).toBe('19.99');
    expect(m.toCents()).toBe(1999);
  });
});
