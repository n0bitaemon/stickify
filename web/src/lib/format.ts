export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Infinity],
  ];
  let value = diff;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return '';
}

export const ACCEPTED_FILES = '.png,.jpg,.jpeg,.webp,.gif,.svg,.webm,.mp4,.mov,.tgs,.zip,.wastickers,image/*,video/webm,video/mp4';

/** Brand-ish colour for each platform (a coloured dot + name only, no trademarked logos). */
export const PLATFORM_COLORS: Record<string, string> = {
  telegram: '#2aabee',
  whatsapp: '#25d366',
  imessage: '#0a84ff',
  signal: '#3a76f0',
  discord: '#5865f2',
  viber: '#7360f2',
  facebook: '#a033ff',
  file: '#8b8b9e',
};

export const SOURCE_LABELS: Record<string, string> = { file: 'Files', telegram: 'Telegram', signal: 'Signal', whatsapp: 'WhatsApp' };

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
