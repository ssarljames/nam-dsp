/**
 * The guided tour's stops, in order. Each one finds its element by a
 * `data-tour` attribute, so the tour does not depend on class names. A stop
 * whose element is not on screen (the headphones notice once dismissed, the
 * POST slot while every POST effect is placed) is skipped.
 */
export interface TourStep {
  /** Matches the element's `data-tour` attribute. */
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: 'live',
    title: 'LIVE switch',
    body:
      'The master switch. Nothing reaches your headphones until it is on, and it always starts off. ' +
      'Press Space at any time, from anywhere, to cut the sound instantly.',
  },
  {
    target: 'input-device',
    title: 'Input device',
    body: 'Where the sound comes from. Choose your audio interface here.',
  },
  {
    target: 'output-device',
    title: 'Output device',
    body: 'Where the sound goes: the interface or device your headphones are plugged into. Needs a Chromium browser.',
  },
  {
    target: 'latency',
    title: 'Latency',
    body: 'An estimate of the delay between playing a note and hearing it. Lower is better; a wired USB interface helps.',
  },
  {
    target: 'level',
    title: 'Input level',
    body:
      'What your interface is sending, before any processing. Set the gain knob on your interface so your ' +
      'loudest notes stay just short of the top.',
  },
  {
    target: 'tuner',
    title: 'Tuner',
    body: 'Opens a chromatic tuner. It works whether LIVE is on or off, so you can tune in silence.',
  },
  {
    target: 'guide',
    title: 'Guide',
    body: 'The full guide: every panel and control explained, shortcuts, troubleshooting, and a button to replay this tour.',
  },
  {
    target: 'advisory',
    title: 'Use headphones',
    body: 'Monitoring through speakers makes a feedback loop. Click “Got it” to hide this notice for good.',
  },
  {
    target: 'tray',
    title: 'Effects tray',
    body: 'Effects waiting to be used. Drag Chorus, Tremolo, Delay or Reverb onto the POST slot, or Drive onto the PRE slot, to add it to the chain, or focus a chip and press Enter.',
  },
  {
    target: 'chain-gate',
    title: 'Noise gate',
    body:
      'The signal chain starts here and runs left to right. The gate silences hiss and hum between notes: stop ' +
      'playing, see where the noise sits on the meter, and set THRESHOLD just above it. Turn it on with the ' +
      'switch in its title.',
  },
  {
    target: 'chain-input',
    title: 'Input gain',
    body:
      'GAIN sets how hard you drive the amp model: more gain means more distortion, not just more volume.',
  },
  {
    target: 'slot-pre',
    title: 'PRE slot',
    body: 'A place for effects before the amp. Drag Drive here from the tray: overdrive to distortion, in front of the amp model.',
  },
  {
    target: 'chain-drive',
    title: 'Drive',
    body:
      'GAIN sets how hard it clips, TONE darkens or brightens it, LEVEL trims the output. SOFT, HARD and ASYM ' +
      'choose the clipping character.',
  },
  {
    target: 'nam',
    title: 'Amp model (NAM)',
    body:
      'The heart of the rig. Press the ↑ button to select a .nam file from your device (TONE3000 has ' +
      'thousands for free), then turn the switch on. Hover the ⓘ for where to find models. Your files stay in ' +
      'this browser; nothing is sent to a server.',
  },
  {
    target: 'cab',
    title: 'Cabinet (IR)',
    body:
      'Select a speaker-cabinet impulse response (.wav) from your device and switch it on. Leave it off if your model is a ' +
      '“full rig” capture, which already includes a cab.',
  },
  {
    target: 'slot-post',
    title: 'POST slot',
    body: 'Drop effects from the tray here. Once placed, drag an effect by its title to reorder it, or remove it with ×.',
  },
  {
    target: 'chain-eq',
    title: 'EQ',
    body: 'Bass, mid and treble for the final shape of the tone, plus a LEVEL to match its volume against bypass.',
  },
  {
    target: 'chain-output',
    title: 'Output volume',
    body: 'The master volume, the last stage before your headphones. No power switch can bypass it.',
  },
  {
    target: 'presets',
    title: 'Presets',
    body:
      'Save the whole rig as a preset and recall it later. Ctrl+S saves, [ and ] step through presets, and / ' +
      'opens the list. Your current sound is also kept automatically between visits.',
  },
  {
    target: 'log',
    title: 'Message log',
    body: 'Notices, warnings and errors appear here. It opens by itself the first time something goes wrong.',
  },
];
