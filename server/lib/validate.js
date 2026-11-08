import { HttpError } from './http.js';
import { microToInput, parseDecimal, toKopecks } from '../../shared/money.js';

export function asObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Ожидается объект в теле запроса');
  }
  return body;
}

export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function textValue(value, label, { required = false, max = 5000 } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new HttpError(422, `Укажите ${label.toLowerCase()}`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HttpError(422, `${label}: неверный тип данных`);
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw new HttpError(422, `Укажите ${label.toLowerCase()}`);
    return null;
  }
  if (text.length > max) {
    throw new HttpError(422, `${label}: не более ${max} символов`);
  }
  return text;
}

const MAX_DECIMAL_MICRO = 1_000_000_000n * 1_000_000n; // 1 млрд единиц

export function decimalValue(value, label, {
  required = false,
  min = 0n,
  max = MAX_DECIMAL_MICRO,
  allowNegative = false,
} = {}) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    if (required) throw new HttpError(422, `Укажите ${label.toLowerCase()}`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HttpError(422, `${label}: введите число`);
  }
  const micro = parseDecimal(value);
  if (micro === null) throw new HttpError(422, `${label}: введите число, например 12,5`);
  if (!allowNegative && micro < 0n) throw new HttpError(422, `${label}: значение не может быть отрицательным`);
  if (micro < min) throw new HttpError(422, `${label}: слишком маленькое значение`);
  if (micro > max) throw new HttpError(422, `${label}: слишком большое значение`);
  return microToInput(micro, 6);
}

export function priceKopecksValue(value, label = 'Цена', { required = false } = {}) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    if (required) throw new HttpError(422, `Укажите ${label.toLowerCase()}`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HttpError(422, `${label}: введите число`);
  }
  const kopecks = toKopecks(value);
  if (kopecks === null) throw new HttpError(422, `${label}: введите число, например 450 или 450,50`);
  if (kopecks < 0) throw new HttpError(422, `${label}: значение не может быть отрицательным`);
  if (kopecks > 1_000_000_000_000) throw new HttpError(422, `${label}: слишком большое значение`);
  return Math.round(kopecks);
}

export function passwordValue(value, label = 'Пароль', { required = true, max = 200 } = {}) {
  if (typeof value !== 'string') {
    if (required) throw new HttpError(422, `Укажите ${label.toLowerCase()}`);
    return null;
  }
  if (!value) {
    if (required) throw new HttpError(422, `Укажите ${label.toLowerCase()}`);
    return null;
  }
  if (value.length > max) throw new HttpError(422, `${label}: не более ${max} символов`);
  return value;
}

export function boolValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function intValue(value, label, { required = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(422, `Укажите ${label.toLowerCase()}`);
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(422, `${label}: некорректное значение`);
  }
  return number;
}

export function oneOf(value, allowed, label, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value);
  if (!allowed.includes(text)) throw new HttpError(422, `${label}: недопустимое значение`);
  return text;
}
