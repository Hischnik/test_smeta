import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MICRO,
  divCeil,
  divRoundHalfUp,
  formatQty,
  kopecksToInput,
  microToInput,
  parseDecimal,
  toKopecks,
  workAmountKopecks,
} from '../shared/money.js';
import { computeMaterialLine, computeMaterialQuantity } from '../shared/calc.js';

test('parseDecimal принимает запятую, точку и пробелы', () => {
  assert.equal(parseDecimal('12,5'), 12_500_000n);
  assert.equal(parseDecimal('12.5'), 12_500_000n);
  assert.equal(parseDecimal('1 234,56'), 1_234_560_000n);
  assert.equal(parseDecimal('0,000001'), 1n);
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('abc'), null);
});

test('округление половину вверх', () => {
  assert.equal(divRoundHalfUp(5n, 2n), 3n);
  assert.equal(divRoundHalfUp(4n, 2n), 2n);
  assert.equal(divRoundHalfUp(1n, 3n), 0n);
  assert.equal(divRoundHalfUp(2n, 3n), 1n);
});

test('деньги переводятся в копейки точно', () => {
  assert.equal(toKopecks('450,50'), 45_050);
  assert.equal(toKopecks('450.505'), 45_051);
  assert.equal(toKopecks('0,01'), 1);
  assert.equal(toKopecks('0,004'), 0);
  assert.equal(kopecksToInput(45_050), '450,50');
  assert.equal(kopecksToInput(45_000), '450');
});

test('стоимость работы = объём × цена, без float-погрешностей', () => {
  assert.equal(workAmountKopecks(70_050, 32_500_000n), 2_276_625);
  assert.equal(workAmountKopecks(1, 500_000n), 1);
  assert.equal(workAmountKopecks(100_000, 333_333n), 33_333);
});

test('автоматический расчёт упаковок округляет вверх', () => {
  const computed = computeMaterialQuantity({
    calcArea: parseDecimal('35'),
    consumptionRate: parseDecimal('10'),
    packageSize: parseDecimal('30'),
  });
  assert.equal(computed.requiredMicro, 350_000_000n);
  assert.equal(computed.packages, 12n);
  assert.equal(computed.quantityMicro, 12n * MICRO);
});

test('материал: авто и ручной режим, корректировка количества', () => {
  const auto = computeMaterialLine({
    mode: 'auto',
    quantity: null,
    priceKopecks: 45_000,
    calcArea: parseDecimal('35'),
    consumptionRate: parseDecimal('10'),
    packageSize: parseDecimal('30'),
  });
  assert.equal(auto.quantityMicro, 12n * MICRO);
  assert.equal(auto.amountKopecks, 540_000);

  const manual = computeMaterialLine({
    mode: 'manual',
    quantity: parseDecimal('12,5'),
    priceKopecks: 45_000,
    calcArea: parseDecimal('35'),
    consumptionRate: parseDecimal('10'),
    packageSize: parseDecimal('30'),
  });
  assert.equal(manual.quantityMicro, 12_500_000n);
  assert.equal(manual.amountKopecks, 562_500);
});

test('материал без упаковки считается по целым единицам', () => {
  const computed = computeMaterialQuantity({
    calcArea: parseDecimal('5'),
    consumptionRate: parseDecimal('1,5'),
    packageSize: null,
  });
  assert.equal(computed.packages, 8n);
  assert.equal(computed.quantityMicro, 8n * MICRO);
});

test('форматирование количеств', () => {
  assert.equal(formatQty(12_500_000n, 3), '12,5');
  assert.equal(formatQty(12_000_000n, 3), '12');
  assert.equal(microToInput(1_234_567n, 3), '1,235');
  assert.equal(divCeil(10n, 3n), 4n);
  assert.equal(divCeil(9n, 3n), 3n);
});
