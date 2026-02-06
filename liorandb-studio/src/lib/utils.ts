export function parseConnectionUri(uri: string): {
  username: string;
  password: string;
  host: string;
  port: number;
} {
  const regex = /^lioran:\/\/([^:]+):([^@]+)@([^:]+):(\d+)$/;
  const match = uri.match(regex);

  if (!match) {
    throw new Error('Invalid connection URI format. Expected: lioran://username:password@host:port');
  }

  return {
    username: match[1],
    password: match[2],
    host: match[3],
    port: parseInt(match[4], 10),
  };
}

export function formatConnectionUri(
  username: string,
  password: string,
  host: string,
  port: number
): string {
  return `lioran://${username}:${password}@${host}:${port}`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function formatJSON(obj: any, indent: number = 2): string {
  return JSON.stringify(obj, null, indent);
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator?.clipboard) {
    return navigator.clipboard.writeText(text);
  } else {
    return new Promise((resolve, reject) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        resolve();
      } catch (err) {
        reject(err);
      }
      document.body.removeChild(textarea);
    });
  }
}
