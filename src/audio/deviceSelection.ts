/**
 * Pure device-selection logic, kept apart from the browser APIs so it can be
 * tested against fixture lists rather than real hardware.
 */

export interface DeviceInfoLike {
  deviceId: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
  label: string;
  groupId: string;
}

/**
 * Labels of interfaces a guitarist is plausibly plugged into. Missing an entry
 * is harmless — it only changes which device is offered first.
 */
export const INTERFACE_LABEL_PATTERN =
  /scarlett|focusrite|clarett|vocaster|behringer|umc\d|presonus|audiobox|revelator|steinberg|\bur\d|motu|m-?audio|m-?track|audient|\bid\d{2}\b|komplete audio|native instruments|\brme\b|babyface|fireface|apogee|ssl\s?2|\bvolt\b|goxlr|zoom\s?[uh]\d|usb audio codec|usb audio device/i;

const byKind = (devices: DeviceInfoLike[], kind: DeviceInfoLike['kind']) =>
  devices.filter((d) => d.kind === kind);

const findById = (list: DeviceInfoLike[], id: string | null | undefined) =>
  id ? list.find((d) => d.deviceId === id) : undefined;

export function pickDefaultInput(
  devices: DeviceInfoLike[],
  preferredId?: string | null,
): string | null {
  const inputs = byKind(devices, 'audioinput');
  if (inputs.length === 0) return null;

  const preferred = findById(inputs, preferredId);
  if (preferred) return preferred.deviceId;

  const iface = inputs.find((d) => INTERFACE_LABEL_PATTERN.test(d.label));
  if (iface) return iface.deviceId;

  // Same prefix test as pickDefaultOutput. The real id is literally "default",
  // but Windows also exposes a "communications" default and vendors suffix it,
  // so the two pickers must at least agree with each other.
  const systemDefault = inputs.find((d) => d.deviceId.startsWith('default'));
  return (systemDefault ?? inputs[0]).deviceId;
}

export function pickDefaultOutput(
  devices: DeviceInfoLike[],
  selectedInputId?: string | null,
  preferredId?: string | null,
): string | null {
  const outputs = byKind(devices, 'audiooutput');
  if (outputs.length === 0) return null;

  const preferred = findById(outputs, preferredId);
  if (preferred) return preferred.deviceId;

  // Same physical box as the input, where the browser tells us the grouping.
  const input = findById(byKind(devices, 'audioinput'), selectedInputId);
  if (input) {
    const sameGroup = outputs.find((d) => d.groupId === input.groupId);
    if (sameGroup) return sameGroup.deviceId;
  }

  const iface = outputs.find((d) => INTERFACE_LABEL_PATTERN.test(d.label));
  if (iface) return iface.deviceId;

  const systemDefault = outputs.find((d) => d.deviceId.startsWith('default'));
  return (systemDefault ?? outputs[0]).deviceId;
}

export interface Reconciliation {
  deviceId: string | null;
  /** True when the previous selection is gone — the UI must say so out loud. */
  fellBack: boolean;
}

export function reconcileSelection(
  kind: 'audioinput' | 'audiooutput',
  previousId: string | null,
  devices: DeviceInfoLike[],
  selectedInputId?: string | null,
): Reconciliation {
  const list = byKind(devices, kind);
  if (previousId && list.some((d) => d.deviceId === previousId)) {
    return { deviceId: previousId, fellBack: false };
  }

  const fallback =
    kind === 'audioinput'
      ? pickDefaultInput(devices)
      : pickDefaultOutput(devices, selectedInputId);

  return { deviceId: fallback, fellBack: previousId !== null };
}

export interface ConstraintIssue {
  setting: string;
  expected: string;
  actual: string;
  /** `violated` — the browser did something else. `unreported` — it did not say. */
  severity: 'violated' | 'unreported';
}

/**
 * The subset of MediaTrackSettings this checks. The three flags are typed
 * `boolean | string` because that is what the DOM declares: the spec lets a
 * browser report echo cancellation as "all" or "remote-only" rather than a
 * plain boolean. Anything that is not exactly `false` is a violation either
 * way, and the reported value is passed through so the UI can show what the
 * browser actually said.
 */
type SettingsLike = {
  echoCancellation?: boolean | string;
  noiseSuppression?: boolean | string;
  autoGainControl?: boolean | string;
  channelCount?: number;
  sampleRate?: number;
};

/**
 * Browsers silently ignore constraints they cannot satisfy. Leaving any of the
 * three processing flags on gives a gated, pumped, latency-added signal that
 * sounds broken for guitar, so every one of them is checked after the fact.
 */
export function verifyInputSettings(settings: SettingsLike): ConstraintIssue[] {
  const issues: ConstraintIssue[] = [];

  for (const flag of ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const) {
    const actual = settings[flag];
    if (actual === undefined) {
      issues.push({ setting: flag, expected: 'false', actual: 'not reported', severity: 'unreported' });
    } else if (actual !== false) {
      issues.push({ setting: flag, expected: 'false', actual: String(actual), severity: 'violated' });
    }
  }

  // These two get the same treatment as the flags above, deliberately. Gating
  // on `!== undefined` alone would make a setting the browser never reported
  // indistinguishable from one it confirmed — "no news is good news" is exactly
  // the assumption this function exists to avoid making.
  if (settings.channelCount === undefined) {
    issues.push({
      setting: 'channelCount',
      expected: '1',
      actual: 'not reported',
      severity: 'unreported',
    });
  } else if (settings.channelCount !== 1) {
    issues.push({
      setting: 'channelCount',
      expected: '1',
      actual: String(settings.channelCount),
      severity: 'violated',
    });
  }

  if (settings.sampleRate === undefined) {
    issues.push({
      setting: 'sampleRate',
      expected: '48000',
      actual: 'not reported',
      severity: 'unreported',
    });
  } else if (settings.sampleRate !== 48000) {
    issues.push({
      setting: 'sampleRate',
      expected: '48000',
      actual: `${settings.sampleRate} (a hidden resampler is in the path)`,
      severity: 'violated',
    });
  }

  return issues;
}
