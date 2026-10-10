import type { AppError, ChannelResult, ReminderAction } from '../shared/contracts';
export class CommandError extends Error {
  constructor(readonly detail: AppError) { super(detail.message); }
}
export function emptyPayload(value: unknown): void {
  if (value !== undefined) throw new CommandError({ code: 'INVALID_COMMAND', message: '此操作不接受参数' });
}
export function payload(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommandError({ code: 'INVALID_COMMAND', message: '无效的操作参数' });
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(fields, key))) throw new CommandError({ code: 'INVALID_COMMAND', message: '操作参数不匹配' });
  return fields;
}
export function identity(value: unknown): { id: string; generation: number } {
  const fields = value as Record<string, unknown>;
  if (typeof fields.id !== 'string' || fields.id.length > 100 || !fields.id || !Number.isSafeInteger(fields.generation) || (fields.generation as number) < 0) throw new CommandError({ code: 'INVALID_COMMAND', message: '提醒标识无效' });
  return { id: fields.id, generation: fields.generation as number };
}
export function reminderAction(value: unknown): ReminderAction {
  if (value !== 'acknowledge' && value !== 'skip' && value !== 'snooze') throw new CommandError({ code: 'INVALID_COMMAND', message: '未知的提醒操作' });
  return value;
}
export function channelResults(value: unknown): ChannelResult[] {
  if (!Array.isArray(value) || value.length > 2 || value.length === 0) throw new CommandError({ code: 'INVALID_COMMAND', message: '无效的提醒结果' });
  const results: ChannelResult[] = value.map(item => {
    const fields = payload(item, ['channel', 'success', 'message']);
    if ((fields.channel !== 'visual' && fields.channel !== 'sound') || typeof fields.success !== 'boolean' || typeof fields.message !== 'string' || fields.message.length > 300) throw new CommandError({ code: 'INVALID_COMMAND', message: '无效的通道结果' });
    return { channel: fields.channel, success: fields.success, message: fields.message };
  });
  if (new Set(results.map(result => result.channel)).size !== results.length) throw new CommandError({ code: 'INVALID_COMMAND', message: '提醒通道不能重复' });
  return results;
}
export function trustedSource(source: string, expected: string | undefined): boolean {
  return !!expected && source === expected;
}
