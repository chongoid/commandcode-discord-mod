function truncate(value: string, max = 90): string {return [...value].length <= max ? value : `${[...value].slice(0, max - 1).join('')}…`;}

export function redact(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s'";]+/gi, '$1[redacted]')
    .replace(/\b(api[_-]?key|token|password|secret|client[_-]?secret)\s*=\s*[^\s;&]+/gi, '$1=[redacted]')
    .replace(/:\/\/[^\s/@:]+:[^\s/@]+@/g, '://[redacted]@')
    .replace(/([?&](?:token|key|secret|signature|sig)=)[^&#\s]+/gi, '$1[redacted]');
}

export function toolContext(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const obj = input as Record<string, unknown>;
  const keys = name === 'shell_command' || name === 'monitor_command' ? ['description'] : name === 'grep' || name === 'glob' ? ['pattern'] : name.startsWith('web_') ? ['query', 'url'] : name === 'agent' ? ['description'] : ['file_path', 'path', 'description'];
  for (const key of keys) if (typeof obj[key] === 'string') return truncate(redact(obj[key] as string).replace(/\s+/g, ' '));
  if (Array.isArray(obj.paths) && obj.paths.length) return truncate(`${String(obj.paths[0])}${obj.paths.length > 1 ? ` +${obj.paths.length - 1}` : ''}`);
  return undefined;
}
