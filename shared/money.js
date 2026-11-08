/**
 * Точная десятичная арифметика для денег и количеств.
 *
 * Деньги в базе и API хранятся целыми числами в копейках (никогда не float).
 * Количества и площади хранятся как десятичные строки, а в вычислениях —
 * как BigInt с фиксированной шкалой 10^6 (микроединицы).
 */

export const MICRO = 1_000_000n;
export const SCALE = 6;

const DECIMAL_RE = /^[+-]?(\d+)(?:[.,](\d+))?$/;

function pow10(n) {
  let r = 1n;
  for (let i = 0; i < n; i += 1) r *= 10n;
  return r;
}

/** Округление деления половину вверх (работает для положительных чисел). */
export function divRoundHalfUp(numerator, denominator) {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  const q = n / denominator;
  const rem = n % denominator;
  const rounded = rem * 2n >= denominator ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Разбор десятичного ввода в микроединицы. Возвращает BigInt или null. */
export function parseDecimal(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value;
  let raw = String(value).trim();
  if (!raw) return null;
  raw = raw.replace(/\u00a0|\u202f|\s/g, '');
  const match = DECIMAL_RE.exec(raw);
  if (!match) return null;
  const sign = raw.startsWith('-') ? -1n : 1n;
  const whole = match[1];
  let fraction = match[2] ?? '';
  let micro;
  if (fraction.length > SCALE) {
    // Лишние знаки округляем половину вверх, чтобы не терять точность молча.
    const keep = fraction.slice(0, SCALE);
    const rest = fraction.slice(SCALE);
    micro = BigInt(whole) * MICRO + BigInt(keep || '0');
    if (rest && rest[0] >= '5') micro += 1n;
  } else {
    micro = BigInt(whole) * MICRO + BigInt((fraction + '0'.repeat(SCALE)).slice(0, SCALE) || '0');
  }
  return sign * micro;
}

export function requireDecimal(value, field = 'значение') {
  const parsed = parseDecimal(value);
  if (parsed === null) throw new ValidationError(`Некорректное число: ${field}`);
  return parsed;
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
  }
}

/** Умножение двух десятичных (в микроединицах), результат в микроединицах. */
export function mulDecimal(a, b) {
  return divRoundHalfUp(a * b, MICRO);
}

/** Деление с округлением вверх (для упаковок). */
export function divCeil(a, b) {
  if (b <= 0n) throw new Error('divisor must be positive');
  const n = a < 0n ? 0n : a;
  const q = n / b;
  return n % b === 0n ? q : q + 1n;
}

/** Pабота: сумма строки в копейках. */
export function workAmountKopecks(priceKopecks, quantityMicro) {
  return Number(divRoundHalfUp(BigInt(priceKopecks) * quantityMicro, MICRO));
}

/** Стоимость материала: цена за упаковку × количество упаковок. */
export function materialAmountKopecks(priceKopecks, quantityMicro) {
  return workAmountKopecks(priceKopecks, quantityMicro);
}

/** Перевод рублей (строка/число) в копейки. Точный, половина вверх. */
export function toKopecks(value) {
  const micro = parseDecimal(value);
  if (micro === null) return null;
  return Number(divRoundHalfUp(micro, 10_000n));
}

/** Копейки в десятичную строку рублей (для input-полей). */
export function kopecksToInput(kopecks) {
  const value = Number(kopecks) || 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const rub = Math.floor(abs / 100);
  const kop = abs % 100;
  return kop === 0 ? `${sign}${rub}` : `${sign}${rub},${String(kop).padStart(2, '0')}`;
}

/** Микроединицы в компактную строку с запятой. */
export function microToInput(micro, maxFractionDigits = 3) {
  if (micro === null || micro === undefined) return '';
  const fractionDigits = Math.min(Math.max(maxFractionDigits, 0), SCALE);
  const value = micro < 0n ? -micro : micro;
  const unit = pow10(BigInt(SCALE - fractionDigits));
  const rounded = divRoundHalfUp(value, unit);
  const scaled = Number(rounded);
  const base = 10 ** fractionDigits;
  const whole = Math.floor(scaled / base);
  let fraction = String(scaled % base).padStart(fractionDigits, '0').replace(/0+$/, '');
  const sign = micro < 0n ? '-' : '';
  return fraction ? `${sign}${whole},${fraction}` : `${sign}${whole}`;
}

export function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatQty(micro, maximumFractionDigits = 3) {
  if (micro === null || micro === undefined) return '—';
  const number = Number(micro) / 1e6;
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(number);
}

const CURRENCY_LOCALES = {
  RUB: 'ru-RU',
  KZT: 'ru-KZ',
  BYN: 'ru-BY',
  USD: 'en-US',
  EUR: 'de-DE',
  UAH: 'uk-UA',
  GEL: 'ka-GE',
  AMD: 'hy-AM',
  UZS: 'uz-UZ',
};

export function formatMoney(kopecks, currency = 'RUB') {
  const value = (Number(kopecks) || 0) / 100;
  const locale = CURRENCY_LOCALES[currency] ?? 'ru-RU';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${formatNumber(value, 2)} ₽`;
  }
}

export function formatMoneyPlain(kopecks, currency = 'RUB') {
  const value = (Number(kopecks) || 0) / 100;
  const number = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
  const symbols = { RUB: '₽', USD: '$', EUR: '€', KZT: '₸', BYN: 'Br', UAH: '₴', GEL: '₾', AMD: '֏', UZS: 'soʻm' };
  return `${number} ${symbols[currency] ?? currency}`;
}

export function currencySymbol(currency = 'RUB') {
  const symbols = { RUB: '₽', USD: '$', EUR: '€', KZT: '₸', BYN: 'Br', UAH: '₴', GEL: '₾', AMD: '֏', UZS: 'soʻm' };
  return symbols[currency] ?? currency;
}
