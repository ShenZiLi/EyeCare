import { describe, expect, it } from 'vitest';
import { channelResults, emptyPayload, identity, payload, reminderAction, trustedSource } from '../../app/main/ipc-validation';

describe('renderer command boundary', () => {
  it('rejects arbitrary command fields and absent required fields', () => {
    expect(() => payload({ id: 'reminder', generation: 1, shell: 'calc' }, ['id', 'generation'])).toThrow('操作参数不匹配');
    expect(() => payload({ id: 'reminder' }, ['id', 'generation'])).toThrow();
    expect(() => payload([], [])).toThrow();
    expect(() => payload(Object.create({ id: 'x', generation: 1 }), ['id', 'generation'])).toThrow();
    expect(() => emptyPayload(undefined)).not.toThrow();
    for (const value of [null, {}, [], 'x']) expect(() => emptyPayload(value)).toThrow();
  });
  it('accepts a parameterless manual pause and rejects obsolete timed pause payloads', () => {
    expect(() => emptyPayload(undefined)).not.toThrow();
    for (const durationMinutes of [15, 30, 60, null]) {
      expect(() => emptyPayload({ durationMinutes })).toThrow('此操作不接受参数');
    }
  });
  it('only accepts bounded identifiers and allowed actions', () => {
    expect(identity({ id: 'real-123', generation: 2 })).toEqual({ id: 'real-123', generation: 2 });
    for (const invalid of [NaN, Infinity, -1, 0.5, '1']) expect(() => identity({ id: 'x', generation: invalid })).toThrow();
    expect(() => identity({ id: 'x'.repeat(101), generation: 0 })).toThrow();
    expect(() => reminderAction('restart')).toThrow();
    try { reminderAction('snooze'); throw new Error('obsolete command accepted'); } catch (error) { expect(error).toMatchObject({ detail: { code: 'INVALID_COMMAND' } }); }
    expect(reminderAction('acknowledge')).toBe('acknowledge'); expect(reminderAction('skip')).toBe('skip');
  });
  it('validates playback reports without accepting renderer-defined channels', () => {
    expect(channelResults([{ channel: 'sound', success: false, message: '设备不可用' }])).toEqual([{ channel: 'sound', success: false, message: '设备不可用' }]);
    for (const report of [[], [{ channel: 'shell', success: true, message: '' }], [{ channel: 'visual', success: 'yes', message: '' }], [{ channel: 'visual', success: true, message: 'x'.repeat(301) }]]) expect(() => channelResults(report)).toThrow();
    expect(() => channelResults([{ channel: 'sound', success: true, message: '' }, { channel: 'sound', success: false, message: '' }])).toThrow();
  });
  it('authorizes only the exact application surface URL registered for a window', () => {
    const expected = 'http://localhost:5173/?surface=overlay';
    expect(trustedSource(expected, expected)).toBe(true);
    for (const source of ['http://localhost:9999/?surface=overlay', 'http://localhost:5173/other?surface=overlay', 'http://localhost:5173/?surface=main', 'file:///C:/untrusted.html', 'http://localhost:5173/?surface=overlay&other=1']) expect(trustedSource(source, expected)).toBe(false);
    expect(trustedSource('file:///C:/app/index.html?surface=main', 'file:///C:/app/index.html?surface=main')).toBe(true);
    expect(trustedSource('file:///C:/app/index.html?surface=main', undefined)).toBe(false);
  });
});
