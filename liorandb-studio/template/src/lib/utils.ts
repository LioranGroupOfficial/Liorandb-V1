import { ConnectionConfig } from '@/types';

export function parseConnectionUri(uri: string): ConnectionConfig {
  const value = uri.trim();

  if (value.startsWith('lioran://')) {
    const match = value.match(/^lioran:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)$/);

    if (!match) {
      throw new Error(
        'Invalid lioran URI. Expected: lioran://username:password@host:port'
      );
    }

    return {
      uri: value,
      username: decodeURIComponent(match[1]),
      host: match[3],
      port: Number(match[4]),
      protocol: 'lioran',
    };
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error();
    }

    return {
      uri: parsed.toString().replace(/\/$/, ''),
      host: parsed.hostname,
      port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
      protocol: parsed.protocol === 'https:' ? 'https' : 'http',
    };
  } catch {
    throw new Error(
      'Invalid host URI. Use http://host:port, https://host:port, or lioran://user:pass@host:port'
    );
  }
}

export function formatConnectionUri(
  username: string,
  password: string,
  host: string,
  port: number
): string {
  return `lioran://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}

export function formatHttpUri(protocol: 'http' | 'https', host: string, port: number): string {
  return `${protocol}://${host}:${port}`;
}

export function safeStringify(value: unknown, indent = 2): string {
  try {
    return JSON.stringify(value, null, indent);
  } catch {
    return String(value);
  }
}

export function formatDate(date: Date | string): string {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleString();
}

export function formatJSON(obj: unknown, indent = 2): string {
  return safeStringify(obj, indent);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value);
}

export function truncateMiddle(value: string, maxLength = 42): string {
  if (value.length <= maxLength) return value;

  const half = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, half)}...${value.slice(-half)}`;
}

export function getDocumentPreview(doc: Record<string, unknown>): string {
  const entries = Object.entries(doc).filter(([key]) => key !== '_id');

  if (entries.length === 0) {
    return '{}';
  }

  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${formatInlineValue(value)}`)
    .join('  |  ');
}

export function formatInlineValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return '{...}';
  return String(value);
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator?.clipboard) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      document.body.removeChild(textarea);
    }
  });
}
