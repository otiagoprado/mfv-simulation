/**
 * Lê um percentual salvo em um elemento. O padrão só vale quando o campo está ausente
 * ou inválido: 0 é um valor real e não pode virar 100%.
 */
export function percentValue(value: unknown, fallback = 100) {
  const number = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : fallback;
}
