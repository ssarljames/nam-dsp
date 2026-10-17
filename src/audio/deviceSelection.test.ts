import { describe, expect, it } from 'vitest';
import {
  type DeviceInfoLike,
  pickDefaultInput,
  pickDefaultOutput,
  reconcileSelection,
  verifyInputSettings,
} from './deviceSelection';

const device = (
  deviceId: string,
  kind: DeviceInfoLike['kind'],
  label: string,
  groupId = deviceId,
): DeviceInfoLike => ({ deviceId, kind, label, groupId });

const devices: DeviceInfoLike[] = [
  device('default', 'audioinput', 'Default - Built-in Microphone', 'builtin'),
  device('builtin-in', 'audioinput', 'Built-in Microphone', 'builtin'),
  device('scarlett-in', 'audioinput', 'Scarlett 2i2 USB Analog Stereo', 'scarlett'),
  device('default-out', 'audiooutput', 'Default - Built-in Speakers', 'builtin'),
  device('builtin-out', 'audiooutput', 'Built-in Speakers', 'builtin'),
  device('scarlett-out', 'audiooutput', 'Scarlett 2i2 USB Analog Stereo', 'scarlett'),
];

describe('pickDefaultInput', () => {
  it('prefers a recognised audio interface over the built-in microphone', () => {
    expect(pickDefaultInput(devices)).toBe('scarlett-in');
  });

  it('honours a still-present preferred device', () => {
    expect(pickDefaultInput(devices, 'builtin-in')).toBe('builtin-in');
  });

  it('ignores a preferred device that has gone away', () => {
    expect(pickDefaultInput(devices, 'unplugged')).toBe('scarlett-in');
  });

  it('falls back to the system default when no interface is recognised', () => {
    const plain = devices.filter((d) => !d.label.includes('Scarlett'));
    expect(pickDefaultInput(plain)).toBe('default');
  });

  it('returns null when there are no inputs at all', () => {
    expect(pickDefaultInput(devices.filter((d) => d.kind === 'audiooutput'))).toBeNull();
  });
});

describe('pickDefaultOutput', () => {
  it('prefers the output in the same group as the selected input', () => {
    expect(pickDefaultOutput(devices, 'scarlett-in')).toBe('scarlett-out');
  });

  it('honours a still-present preferred device over the group match', () => {
    expect(pickDefaultOutput(devices, 'scarlett-in', 'builtin-out')).toBe('builtin-out');
  });

  it('falls back to the system default when nothing matches', () => {
    const plain = devices.filter((d) => !d.label.includes('Scarlett'));
    expect(pickDefaultOutput(plain, 'builtin-in')).toBe('default-out');
  });
});

describe('reconcileSelection', () => {
  it('keeps a selection that is still present', () => {
    expect(reconcileSelection('audioinput', 'scarlett-in', devices)).toEqual({
      deviceId: 'scarlett-in',
      fellBack: false,
    });
  });

  it('falls back and says so when the selected device disappears', () => {
    const unplugged = devices.filter((d) => d.deviceId !== 'scarlett-in');
    expect(reconcileSelection('audioinput', 'scarlett-in', unplugged)).toEqual({
      deviceId: 'default',
      fellBack: true,
    });
  });

  it('reports no device rather than throwing when the list empties', () => {
    expect(reconcileSelection('audioinput', 'scarlett-in', [])).toEqual({
      deviceId: null,
      fellBack: true,
    });
  });

  it('does not report a fallback when there was no previous selection', () => {
    expect(reconcileSelection('audioinput', null, devices)).toEqual({
      deviceId: 'scarlett-in',
      fellBack: false,
    });
  });

  it('reconciles an output selection through the output picker', () => {
    expect(reconcileSelection('audiooutput', 'scarlett-out', devices, 'scarlett-in')).toEqual({
      deviceId: 'scarlett-out',
      fellBack: false,
    });

    const unplugged = devices.filter((d) => d.deviceId !== 'scarlett-out');
    expect(reconcileSelection('audiooutput', 'scarlett-out', unplugged, 'scarlett-in')).toEqual({
      deviceId: 'default-out',
      fellBack: true,
    });
  });
});

describe('verifyInputSettings', () => {
  const good = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 48000,
  };

  it('passes a fully honoured constraint set', () => {
    expect(verifyInputSettings(good)).toEqual([]);
  });

  it('flags processing that the browser left switched on', () => {
    const issues = verifyInputSettings({ ...good, autoGainControl: true });
    expect(issues).toHaveLength(1);
    expect(issues[0].setting).toBe('autoGainControl');
    expect(issues[0].severity).toBe('violated');
  });

  it('flags all three processing flags independently', () => {
    const issues = verifyInputSettings({
      ...good,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(issues.map((i) => i.setting).sort()).toEqual([
      'autoGainControl',
      'echoCancellation',
      'noiseSuppression',
    ]);
  });

  it('flags a sample-rate mismatch, because that means a hidden resampler', () => {
    const issues = verifyInputSettings({ ...good, sampleRate: 44100 });
    expect(issues).toHaveLength(1);
    expect(issues[0].setting).toBe('sampleRate');
    expect(issues[0].actual).toContain('44100');
  });

  it('flags a string-valued processing flag, which the spec permits browsers to report', () => {
    const issues = verifyInputSettings({ ...good, echoCancellation: 'all' });
    expect(issues).toHaveLength(1);
    expect(issues[0].setting).toBe('echoCancellation');
    expect(issues[0].severity).toBe('violated');
    expect(issues[0].actual).toBe('all');
  });

  it('reports an unreported setting separately from a violated one', () => {
    const issues = verifyInputSettings({ ...good, echoCancellation: undefined });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('unreported');
  });

  it('does not treat an unreported channelCount as a pass', () => {
    const issues = verifyInputSettings({ ...good, channelCount: undefined });
    expect(issues).toHaveLength(1);
    expect(issues[0].setting).toBe('channelCount');
    expect(issues[0].severity).toBe('unreported');
  });

  it('does not treat an unreported sampleRate as a pass', () => {
    const issues = verifyInputSettings({ ...good, sampleRate: undefined });
    expect(issues).toHaveLength(1);
    expect(issues[0].setting).toBe('sampleRate');
    expect(issues[0].severity).toBe('unreported');
  });

  it('separates a violated numeric from an unreported one', () => {
    const issues = verifyInputSettings({ ...good, channelCount: 2, sampleRate: undefined });
    expect(issues).toHaveLength(2);
    const bySetting = Object.fromEntries(issues.map((i) => [i.setting, i.severity]));
    expect(bySetting.channelCount).toBe('violated');
    expect(bySetting.sampleRate).toBe('unreported');
  });
});
