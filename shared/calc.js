/**
 * Расчёты смет. Используется и на сервере, и в браузере,
 * чтобы предпросмотр в интерфейсе совпадал с сохранёнными значениями.
 */
import {
  MICRO,
  divCeil,
  divRoundHalfUp,
  materialAmountKopecks,
  mulDecimal,
  workAmountKopecks,
} from './money.js';

/**
 * Автоматический расчёт количества упаковок материала.
 * required = площадь × норма расхода (в единицах расхода).
 * packages = ceil(required / размер упаковки).
 * Возвращает количества в микроединицах.
 */
export function computeMaterialQuantity({ calcArea, consumptionRate, packageSize }) {
  if (calcArea === null || calcArea === undefined) return null;
  if (consumptionRate === null || consumptionRate === undefined) return null;
  const requiredMicro = mulDecimal(calcArea, consumptionRate);
  if (requiredMicro <= 0n) {
    return { requiredMicro: 0n, packages: 0n, quantityMicro: 0n };
  }
  const packageMicro = packageSize && packageSize > 0n ? packageSize : MICRO;
  const packages = divCeil(requiredMicro, packageMicro);
  return { requiredMicro, packages, quantityMicro: packages * MICRO };
}

/**
 * Итоговые значения строки материала.
 * mode = 'auto' — количество считается по площади и норме;
 * mode = 'manual' — количество вводит администратор.
 */
export function computeMaterialLine({
  mode,
  quantity,
  priceKopecks,
  calcArea = null,
  consumptionRate = null,
  packageSize = null,
}) {
  let quantityMicro = quantity ?? null;
  let requiredMicro = null;
  let packages = null;
  if (mode === 'auto') {
    const computed = computeMaterialQuantity({ calcArea, consumptionRate, packageSize });
    if (computed) {
      quantityMicro = computed.quantityMicro;
      requiredMicro = computed.requiredMicro;
      packages = computed.packages;
    }
  }
  if (quantityMicro === null) quantityMicro = 0n;
  return {
    quantityMicro,
    requiredMicro,
    packages,
    amountKopecks: materialAmountKopecks(priceKopecks, quantityMicro),
  };
}

/** Сумма строки работы: объём × цена. */
export function computeWorkLine({ quantity, priceKopecks }) {
  const quantityMicro = quantity ?? 0n;
  return {
    quantityMicro,
    amountKopecks: workAmountKopecks(priceKopecks, quantityMicro),
  };
}

/** Стоимость с округлением до копейки для произвольного десятичного количества. */
export function lineAmount(priceKopecks, quantityMicro) {
  return Number(divRoundHalfUp(BigInt(priceKopecks) * quantityMicro, MICRO));
}

/** Сумма списка строк (в копейках). */
export function sumKopecks(lines) {
  return lines.reduce((acc, line) => acc + (Number(line.amountKopecks) || 0), 0);
}

export function groupedTotals(lines) {
  let works = 0;
  let materials = 0;
  for (const line of lines) {
    if (line.kind === 'work') works += Number(line.amountKopecks) || 0;
    else materials += Number(line.amountKopecks) || 0;
  }
  return { works, materials, total: works + materials };
}
