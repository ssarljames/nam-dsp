import {
  type ConstraintIssue,
  type DeviceInfoLike,
  verifyInputSettings,
} from './deviceSelection';

export interface DeviceSnapshot {
  inputs: DeviceInfoLike[];
  outputs: DeviceInfoLike[];
  raw: MediaDeviceInfo[];
}

export interface OpenInputResult {
  stream: MediaStream;
  settings: MediaTrackSettings;
  issues: ConstraintIssue[];
  /** Reported input latency in seconds; 0 when the browser does not say. */
  trackLatencySec: number;
}

/** Exactly the constraints spec §7 requires. Do not soften any of them. */
function inputConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48000,
      latency: 0,
    } as MediaTrackConstraints,
    video: false,
  };
}

export class DeviceRepository {
  /** `setSinkId` is Chromium-only; everything else degrades to system default. */
  static outputSelectionSupported(): boolean {
    return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  }

  /**
   * enumerateDevices() returns empty labels until permission is granted, so we
   * take a throwaway stream first and stop it immediately. The real stream is
   * acquired afterwards with the real constraints.
   */
  async requestPermission(): Promise<boolean> {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of probe.getTracks()) track.stop();
      return true;
    } catch {
      return false;
    }
  }

  async enumerate(): Promise<DeviceSnapshot> {
    const raw = await navigator.mediaDevices.enumerateDevices();
    const mapped: DeviceInfoLike[] = raw.map((d) => ({
      deviceId: d.deviceId,
      kind: d.kind as DeviceInfoLike['kind'],
      label: d.label,
      groupId: d.groupId,
    }));
    return {
      inputs: mapped.filter((d) => d.kind === 'audioinput'),
      outputs: mapped.filter((d) => d.kind === 'audiooutput'),
      raw,
    };
  }

  async openInput(deviceId: string): Promise<OpenInputResult> {
    const stream = await navigator.mediaDevices.getUserMedia(inputConstraints(deviceId));
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('the input stream has no audio track');

    const settings = track.getSettings();
    return {
      stream,
      settings,
      issues: verifyInputSettings(settings),
      trackLatencySec: (settings as { latency?: number }).latency ?? 0,
    };
  }

  /** Returns an unsubscribe function. */
  onDeviceChange(callback: () => void): () => void {
    const handler = () => callback();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }
}
