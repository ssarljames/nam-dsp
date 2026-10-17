import type { ReactNode } from 'react';

/**
 * The tutorial's text, one topic per entry. The first group is the general
 * walkthrough; the second has one entry per panel, in the order they sit on
 * screen. Figures quoted here (ranges, frequencies, limits) come from
 * params.ts and the engine headers — change them there and here together.
 */
export interface TutorialTopic {
  id: string;
  group: 'Getting started' | 'Panels' | 'Reference';
  title: string;
  body: ReactNode;
}

const Keys = ({ children }: { children: ReactNode }) => <kbd className="tutorial__kbd">{children}</kbd>;

export const TUTORIAL_TOPICS: readonly TutorialTopic[] = [
  {
    id: 'welcome',
    group: 'Getting started',
    title: 'Welcome',
    body: (
      <>
        <p className="tutorial__lead">
          Sarlifier is a guitar rig that runs in your browser. Plug a guitar into an audio
          interface and it runs the signal through a noise gate, a neural amp model (NAM), a
          cabinet impulse response, effects and an EQ, then out to your headphones. Nothing
          leaves your computer.
        </p>
        <h3>What you need</h3>
        <ul>
          <li>
            <strong>An audio interface</strong> with an instrument (Hi-Z) input. A laptop's
            built-in microphone works but sounds nothing like a guitar DI.
          </li>
          <li>
            <strong>Headphones.</strong> Monitoring a live input through speakers makes a
            feedback loop, and it can get very loud very fast.
          </li>
          <li>
            <strong>A Chromium browser</strong> (Chrome, Edge, Brave). Other browsers can play
            the audio but can't choose an output device.
          </li>
        </ul>
        <h3>How the screen is laid out</h3>
        <ol>
          <li>
            <strong>The session bar</strong> across the top: the LIVE switch, the input and
            output device pickers, the latency estimate, the input level meter, the tuner and
            this help.
          </li>
          <li>
            <strong>The effects tray</strong> below it, holding effects you can drag into the
            chain.
          </li>
          <li>
            <strong>The signal chain</strong>, which reads left to right in the order the sound
            travels: NOISE GATE → INPUT → PRE → AMP AND CAB → effects → EQ → OUTPUT.
          </li>
          <li>
            <strong>The preset bar</strong> at the bottom, for saving and recalling whole setups.
          </li>
          <li>
            <strong>The message log</strong>, the terminal button in the bottom-right corner.
          </li>
        </ol>
        <h3>Where the amp models come from</h3>
        <ul>
          <li>
            <a href="https://www.neuralampmodeler.com/" target="_blank" rel="noreferrer">
              <strong>Neural Amp Modeler</strong>
            </a>{' '}
            is the open-source project behind the <code>.nam</code> format. It trains a neural
            network to copy a real amp, pedal or whole rig, and has the tools and guides for
            making captures of your own gear. Sarlifier runs the same NAM engine in your
            browser.
          </li>
          <li>
            <a href="https://www.tone3000.com/" target="_blank" rel="noreferrer">
              <strong>TONE3000</strong>
            </a>{' '}
            is a free library of thousands of <code>.nam</code> captures and cab IRs shared by
            players. Download one, then select it from your device with the ↑ button in AMP AND CAB. Check
            whether a capture is amp-only or a full rig, which tells you whether to turn CAB on
            (see <em>Amp and cab</em>).
          </li>
        </ul>
        <p>
          Each panel has its own page in the list on the left. If this is your first time,
          start with <em>Before you start</em> and then <em>First sound</em>.
        </p>
      </>
    ),
  },
  {
    id: 'before-you-start',
    group: 'Getting started',
    title: 'Before you start',
    body: (
      <>
        <p className="tutorial__lead">
          What happens the first time you open the app, before any sound is made.
        </p>
        <h3>The start screen</h3>
        <p>
          The app opens on a start screen with a single <strong>Start audio</strong> button.
          Browsers only allow audio to start after you click something, and this is that click.
          It then asks for your microphone and sets up the audio engine.
        </p>
        <h3>Microphone permission</h3>
        <ul>
          <li>
            Your browser asks whether this site may use your microphone. That's how any web
            page gets audio from an audio interface, so choose <strong>Allow</strong>. The audio
            is processed on your computer and never leaves it.
          </li>
          <li>
            Chrome can remember the choice, so you won't be asked on every visit.
          </li>
          <li>
            <strong>If you clicked Block</strong>, the app stops with an error in the message log.
            Click the icon to the left of the address bar, set Microphone to Allow, and reload
            the page.
          </li>
        </ul>
        <h3>The headphones notice</h3>
        <p>
          Once audio is running, a banner above the chain reminds you to use headphones and that{' '}
          <Keys>Space</Keys> is the panic mute. Click <strong>Got it</strong> and it won't come
          back in this browser.
        </p>
        <h3>The guided tour</h3>
        <p>
          The first time the rig is ready, a short tour dims the page and lights up each
          control in turn, with a note beside it. Use <strong>Next</strong> and{' '}
          <strong>Back</strong> (or <Keys>→</Keys> <Keys>←</Keys>), or <strong>Skip tour</strong>{' '}
          (or <Keys>Esc</Keys>) to leave. It won't start by itself again; replay it any time
          with <strong>Take the tour</strong> at the top of this guide.
        </p>
        <h3>Starting muted</h3>
        <p>
          Audio starts with LIVE off, so nothing reaches your ears until you turn it on. Your
          last sound and devices are restored automatically, and loading a preset never turns
          LIVE on.
        </p>
      </>
    ),
  },
  {
    id: 'first-sound',
    group: 'Getting started',
    title: 'First sound, step by step',
    body: (
      <>
        <p className="tutorial__lead">
          The app always starts muted. Here is the safe way to get from silence to a playing
          rig.
        </p>
        <ol className="tutorial__steps">
          <li>
            <strong>Put your headphones on</strong> and turn the interface's headphone level
            down.
          </li>
          <li>
            <strong>Choose your devices.</strong> In the session bar, set INPUT to your audio
            interface and OUTPUT to where your headphones are plugged in (usually the same
            interface). Your choices are remembered for next time.
          </li>
          <li>
            <strong>Set the input level.</strong> Play hard and watch the LEVEL meter on the
            right of the session bar. Adjust the gain knob <em>on your interface</em> until the
            loudest notes stay just short of the top. Too hot and it clips before the app ever
            sees it; too quiet and the amp model sounds thin and noisy.
          </li>
          <li>
            <strong>Load an amp model.</strong> No models come with the app. Download a{' '}
            <code>.nam</code> file (from TONE3000, for example), press the ↑ button in AMP AND CAB,
            select the file from your device, and turn the NAM power switch on. After that it's in the
            dropdown for good.
          </li>
          <li>
            <strong>Add a cabinet.</strong> Select a cab impulse response (.wav) from your device and turn the
            CAB switch on, unless your model already includes a cab (see <em>Amp and cab</em>).
          </li>
          <li>
            <strong>Go live.</strong> Flip the LIVE switch. Its LED lights and sound starts
            flowing. Bring the headphone level up slowly.
          </li>
          <li>
            <strong>Balance the levels.</strong> Use OUTPUT VOLUME for overall loudness, and each
            stage's LEVEL to match its sound against its bypassed sound.
          </li>
          <li>
            <strong>Save it.</strong> Press <Keys>Ctrl</Keys> <Keys>S</Keys>, or click Save in the
            preset bar, to keep the setup as a preset.
          </li>
        </ol>
        <div className="tutorial__callout tutorial__callout--warn">
          <strong>Panic mute:</strong> press <Keys>Space</Keys> at any time, from anywhere on the
          page, to cut the sound at once. Flip LIVE to bring it back.
        </div>
      </>
    ),
  },
  {
    id: 'controls',
    group: 'Getting started',
    title: 'Using knobs and sliders',
    body: (
      <>
        <p className="tutorial__lead">
          The controls are built to feel like hardware. A few habits make them much faster to
          use.
        </p>
        <h3>Knobs</h3>
        <table className="tutorial__table">
          <tbody>
            <tr>
              <th>Drag up / down</th>
              <td>
                Turns the knob. The pointer is hidden and locked while you drag, so you can keep
                going without running off the screen. About 200 px of travel covers the whole
                range.
              </td>
            </tr>
            <tr>
              <th>
                <Keys>Shift</Keys> + drag
              </th>
              <td>Fine adjustment, five times slower.</td>
            </tr>
            <tr>
              <th>
                <Keys>Ctrl</Keys> / <Keys>⌘</Keys> + drag
              </th>
              <td>Coarse adjustment, three times faster.</td>
            </tr>
            <tr>
              <th>Mouse wheel</th>
              <td>One step per notch. The page does not scroll while the pointer is on a knob.</td>
            </tr>
            <tr>
              <th>Double-click</th>
              <td>Back to the default value. The delay's TIME knob is the exception: a click there is a tap-tempo tap.</td>
            </tr>
            <tr>
              <th>Keyboard</th>
              <td>
                Click or <Keys>Tab</Keys> to a knob, then <Keys>↑</Keys> <Keys>↓</Keys> (or{' '}
                <Keys>←</Keys> <Keys>→</Keys>) for one step, <Keys>PgUp</Keys>{' '}
                <Keys>PgDn</Keys> for ten, <Keys>Home</Keys> <Keys>End</Keys> for the minimum
                and maximum.
              </td>
            </tr>
          </tbody>
        </table>
        <h3>Sliders (faders)</h3>
        <p>
          Levels, the EQ bands and the gate threshold are sliders. Drag the thumb, or focus the
          slider and use the arrow keys. Double-click puts the slider back to its default. The
          small tick on each track marks the value worth finding by feel: 0 dB on gains and
          levels.
        </p>
        <h3>Detents</h3>
        <p>
          Controls that go both ways (gain, EQ bands, levels) snap to 0 dB when you pass close to
          it, like the centre click on a real pot. Keep dragging and it lets go.
        </p>
        <h3>Tapers</h3>
        <p>
          Not every control moves evenly. OUTPUT VOLUME puts −12 dB at the half-way point, so the
          useful range is spread across most of the travel. The delay's TIME and the chorus's
          RATE work the same way, giving more room to the shorter times and slower rates.
        </p>
        <h3>Power switches</h3>
        <p>
          Every stage that can be turned off has a small switch in its title bar. When a stage
          is on, its title lights up. A bypassed stage is taken out of the sound completely,
          including its LEVEL.
        </p>
      </>
    ),
  },
  {
    id: 'signal-flow',
    group: 'Getting started',
    title: 'How the signal flows',
    body: (
      <>
        <p className="tutorial__lead">
          Knowing the order of the stages explains most of what you hear.
        </p>
        <div className="tutorial__flow" aria-label="Signal flow">
          {['Interface', 'Noise gate', 'Input gain', 'Drive', 'NAM amp', 'Cab IR', 'Chorus / Tremolo / Delay / Reverb', 'EQ', 'Output volume', 'Headphones'].map(
            (stage, i, all) => (
              <span key={stage} className="tutorial__flow-step">
                <span className="tutorial__flow-box">{stage}</span>
                {i < all.length - 1 && <span className="tutorial__flow-arrow" aria-hidden="true">→</span>}
              </span>
            ),
          )}
        </div>
        <ul>
          <li>
            <strong>The gate runs first</strong>, before INPUT gain, so its threshold is measured
            against what the interface actually sends. Changing INPUT gain does not change where
            the gate opens.
          </li>
          <li>
            <strong>INPUT gain feeds the amp model.</strong> A NAM responds like the real amp it
            was captured from: more input means more drive and compression, not just more
            volume.
          </li>
          <li>
            <strong>Drive sits between them</strong>, like a pedal in front of an amp: INPUT gain
            sets how hard it is hit, and the amp model hears what it puts out.
          </li>
          <li>
            <strong>Effects come after the cab</strong>, like effects in an amp's loop. The
            chorus, tremolo, delay and reverb can run in any order.
          </li>
          <li>
            <strong>The EQ is last</strong>, so it shapes the finished tone, amp and cab
            included.
          </li>
          <li>
            <strong>OUTPUT VOLUME belongs to no stage.</strong> No power switch can take it out
            of the path.
          </li>
        </ul>
        <p>
          The input is mono. It is processed once and sent to both the left and right
          headphone channels.
        </p>
      </>
    ),
  },
  {
    id: 'session-bar',
    group: 'Panels',
    title: 'Session bar',
    body: (
      <>
        <p className="tutorial__lead">
          The strip across the top of the page holds the controls you need all the time.
        </p>
        <h3>LIVE switch</h3>
        <p>
          The master switch: nothing reaches the output unless it is on. The lever position, the
          LED and the legend colour all show its state. The app always starts with it off.
          Pressing <Keys>Space</Keys> flips it off from anywhere.
        </p>
        <h3>INPUT and OUTPUT</h3>
        <p>
          The devices the sound comes from and goes to. Switching the input mid-song swaps
          without a gap. If a device is unplugged, the app falls back to the system default and
          says so in the message log. When it comes back, choose it again. Choosing an output
          needs a Chromium browser; elsewhere the picker is greyed out and the system default is
          used.
        </p>
        <h3>LATENCY</h3>
        <p>
          An estimate of the delay between playing a note and hearing it, worked out from what
          the browser reports. Desktop browsers usually land somewhere between 15 and 40 ms.
          Measuring it exactly needs a physical loopback cable. For lower latency, use a
          dedicated interface rather than built-in audio, and close other apps that are using
          audio.
        </p>
        <h3>LEVEL meter</h3>
        <p>
          What the interface sends, before any processing. Use it to set your interface's gain
          knob. It keeps working while LIVE is off, so you can set levels in silence.
        </p>
        <h3>Tuner and help</h3>
        <p>
          The tuning-fork button opens the tuner; the question mark opens this guide.
        </p>
      </>
    ),
  },
  {
    id: 'input',
    group: 'Panels',
    title: 'Input',
    body: (
      <>
        <p className="tutorial__lead">
          The first panel in the chain trims the signal on its way into the amp model.
        </p>
        <dl className="tutorial__params">
          <dt>GAIN</dt>
          <dd>
            −24 to +24 dB, default 0 dB, snaps at 0. Turn it up to drive the amp model harder,
            down to clean it up. It is the digital version of how hard you hit a real amp's
            input.
          </dd>
        </dl>
        <h3>Tips</h3>
        <ul>
          <li>
            Get the level right with the interface's own gain knob first, using the LEVEL meter.
            Use this knob afterwards to taste.
          </li>
          <li>
            Many NAM models were captured with a particular input level in mind. If a
            high-gain model sounds fizzy or a clean model breaks up too early, this is the knob
            to try.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'gate',
    group: 'Panels',
    title: 'Noise gate',
    body: (
      <>
        <p className="tutorial__lead">
          Cuts the hiss and hum between notes. It is the most useful with high-gain models,
          which make every bit of noise louder.
        </p>
        <dl className="tutorial__params">
          <dt>THRESHOLD</dt>
          <dd>
            −80 to 0 dB, default −60 dB. The gate opens when the signal rises above this and
            closes when it falls back below. At −80 dB it never closes.
          </dd>
        </dl>
        <h3>The meter beside it</h3>
        <p>
          The bar next to the slider shows your input level on the same scale as THRESHOLD. To
          set it, stop playing and mute the strings, watch where the noise sits on the meter,
          and set the threshold just above it. Then play: quiet notes should still come
          through.
        </p>
        <p>
          The part of the signal below the threshold shows in grey, the part above it in colour,
          so you can see at a glance what the gate will let through.
        </p>
        <h3>How it behaves</h3>
        <ul>
          <li>It opens almost instantly (0.5 ms), so picking attack is never cut.</li>
          <li>
            It closes only after the signal has stayed 6 dB below the threshold for 10 ms, then
            fades out over about 100 ms, so sustained notes don't chatter.
          </li>
          <li>
            These timings are fixed. THRESHOLD is the only control.
          </li>
          <li>The gate is off by default. Turn it on with the switch in its title.</li>
        </ul>
        <div className="tutorial__callout">
          Set too high, the gate chops off note tails and quiet playing. If sustain seems to
          stop dead, lower the threshold.
        </div>
      </>
    ),
  },
  {
    id: 'amp-cab',
    group: 'Panels',
    title: 'Amp and cab',
    body: (
      <>
        <p className="tutorial__lead">
          The heart of the rig. The top half loads a Neural Amp Modeler capture, the bottom half
          a speaker cabinet impulse response.
        </p>
        <div className="tutorial__callout">
          <strong>Quick reminder in the panel:</strong> hover (or tap) the <strong>ⓘ</strong>{' '}
          beside NAM or CAB for what the file is, where to download one, and how to load it.
        </div>
        <h3>NAM (the amp)</h3>
        <p>
          A <code>.nam</code> file is a neural-network capture of a real amp, pedal or whole
          rig. Pick one from the dropdown, then turn the NAM power switch on.
        </p>
        <ul>
          <li>
            <strong>No models come with the app.</strong> Captures belong to the people who
            made them, so you bring your own. The dropdown lists the files you have added from your device.
          </li>
          <li>
            <strong>Your own models:</strong> press the ↑ button and select a{' '}
            <code>.nam</code> file of up to 8 MB from your device. Thousands are shared free online, for example
            on{' '}
            <a href="https://www.tone3000.com/" target="_blank" rel="noreferrer">
              TONE3000
            </a>
            . Once the engine accepts it, the file is saved locally in this browser (never sent
            to a server) and appears under <em>Your files</em> in the dropdown from then on, even after a
            restart or offline.
          </li>
          <li>
            <strong>Removing a saved file:</strong> select it and click the bin button.
          </li>
          <li>
            <strong>LEVEL</strong> (−24 to +24 dB, snaps at 0) sets the volume only while the
            model is on. Use it to match the model's loudness to the bypassed sound, so switching
            doesn't jump in volume.
          </li>
          <li>
            The <strong>+</strong> button is a placeholder for chaining a second model, for
            example a drive pedal into an amp. It doesn't do anything yet.
          </li>
        </ul>
        <h3>CAB (the speaker cabinet)</h3>
        <p>
          A guitar amp on its own sounds harsh and buzzy; the speaker cabinet is what makes it
          sound like a recorded guitar. An impulse response (IR) is a measurement of a real
          cabinet and microphone.
        </p>
        <ul>
          <li>
            Press the ↑ button, select a <code>.wav</code> IR from your device, then turn the CAB
            switch on. IRs are saved in this browser just like models.
          </li>
          <li>
            Stereo files are mixed to mono. The IR is normalised, so different files come out at
            similar volumes.
          </li>
          <li>
            Only the first 4096 samples (about 85 ms at 48 kHz) are used. Longer files, such as
            room reverbs, have their tail cut and faded, and the message log says so. Ordinary
            cab IRs are much shorter than this.
          </li>
          <li>
            <strong>LEVEL</strong> works like the NAM's: it sets the volume only while the cab is
            on.
          </li>
        </ul>
        <div className="tutorial__callout">
          <strong>Full-rig captures already include a cab.</strong> If a model's name says
          "full rig", "FRFR" or names a cabinet, leave CAB off, or you'll be filtering the sound
          through two cabinets and it will sound muffled. Amp-only captures ("head", "DI") need
          CAB on.
        </div>
        <h3>When a file is missing</h3>
        <p>
          If a preset or your last session names a model or IR that isn't on this device, the
          dropdown shows <em>Missing: name</em> and the stage stays bypassed rather than playing
          something else. Select the file from your device again, or pick another one.
        </p>
      </>
    ),
  },
  {
    id: 'effects',
    group: 'Panels',
    title: 'Effects tray and slots',
    body: (
      <>
        <p className="tutorial__lead">
          Effects live in the tray under the session bar until you place them in the chain.
        </p>
        <h3>Adding an effect</h3>
        <ul>
          <li>
            <strong>Drag</strong> a chip from the tray and drop it on its slot: Drive goes on{' '}
            <strong>PRE</strong>, Chorus, Tremolo, Delay and Reverb on <strong>POST</strong>. The slot lights up
            while you drag something it accepts, and once it holds effects a line shows the gap
            the new one will go into. Dragging works with touch too.
          </li>
          <li>
            <strong>Keyboard:</strong> <Keys>Tab</Keys> to a chip and press <Keys>Enter</Keys>.
            The effect is added after any that are already placed.
          </li>
          <li>
            While an effect is in the chain, its chip in the tray shows it as in use.
          </li>
        </ul>
        <h3>Reordering and removing</h3>
        <ul>
          <li>
            Drag an effect by its <strong>title</strong> onto another effect. Drop it on the
            left half to put it before, or the right half to put it after. From the keyboard,
            focus the title and press <Keys>←</Keys> / <Keys>→</Keys>.
          </li>
          <li>
            Chorus before delay gives delay repeats that are chorused too; delay before chorus
            gives chorused repeats of a cleaner signal. Reverb usually goes last, so the
            repeats get reverb too; put it first for echoes of a reverberant sound. Tremolo
            before the delay and reverb lets the repeats and the tail soften the pulse; after
            the reverb, the tail chops in time too, like an amp's own tremolo. Try them.
          </li>
          <li>
            The <strong>×</strong> in the title takes the effect out and puts its chip back in
            the tray. The power switch next to it only bypasses it and keeps its place.
          </li>
        </ul>
        <h3>What's available</h3>
        <p>
          Drive (PRE), Chorus, Tremolo, Delay and Reverb (POST) work now. Compressor and Boost are shown
          so you can see what's coming, but can't be placed yet.
        </p>
        <h3>Moving around a long chain</h3>
        <p>
          On a narrow screen the chain scrolls sideways. Drag on an empty part of the chain (the
          arrows between panels) to pan it, or hold <Keys>Alt</Keys> and drag anywhere.
        </p>
      </>
    ),
  },
  {
    id: 'drive',
    group: 'Panels',
    title: 'Drive',
    body: (
      <>
        <p className="tutorial__lead">
          A dirt pedal in the PRE slot, before the amp model: from a light overdrive to a heavy
          distortion. Drag the Drive chip from the tray onto PRE, or focus it and press{' '}
          <Keys>Enter</Keys>.
        </p>
        <dl className="tutorial__params">
          <dt>GAIN</dt>
          <dd>
            +6 to +48 dB, default +27 dB. How hard the signal hits the clipper. The output is
            level-matched, so turning it up changes the character more than the loudness.
          </dd>
          <dt>TONE</dt>
          <dd>
            0–100 %, default 50 %. A treble roll-off after the clipping, from dark (800 Hz) to
            bright (12 kHz). Half-way is about 3 kHz.
          </dd>
          <dt>LEVEL</dt>
          <dd>
            −24 to +24 dB, snaps at 0. The output trim, for matching the pedal against bypass or
            pushing the amp model harder.
          </dd>
        </dl>
        <h3>Clipping type</h3>
        <ul>
          <li>
            <strong>SOFT</strong>: smooth, round clipping, like an overdrive. Touch-sensitive and
            warm.
          </li>
          <li>
            <strong>HARD</strong>: a firm, square clip, like a distortion pedal. Tighter and more
            aggressive.
          </li>
          <li>
            <strong>ASYM</strong>: the two halves of the wave clip differently, like a tube,
            adding even harmonics for a thicker, more complex sound.
          </li>
        </ul>
        <p>
          Click a type, or focus the switch and use <Keys>←</Keys> <Keys>→</Keys>. Switching
          fades over 10 ms, so it doesn't click.
        </p>
        <h3>Starting points</h3>
        <ul>
          <li>
            <strong>Boost a high-gain amp:</strong> SOFT, GAIN +8 dB, TONE 60 %, LEVEL +6 dB. It
            tightens the low end and pushes the amp harder.
          </li>
          <li>
            <strong>Crunch into a clean amp:</strong> ASYM, GAIN +24 dB, TONE 50 %.
          </li>
          <li>
            <strong>Full distortion:</strong> HARD, GAIN +40 dB, TONE 35 %, into a clean amp model.
          </li>
        </ul>
        <div className="tutorial__callout">
          Drive runs before the amp model, so the amp's own gain and the cab still shape it. With
          a high-gain model, a little drive goes a long way.
        </div>
      </>
    ),
  },
  {
    id: 'chorus',
    group: 'Panels',
    title: 'Chorus',
    body: (
      <>
        <p className="tutorial__lead">
          Blends in a copy of the signal with a slowly moving delay, giving that shimmering,
          doubled sound.
        </p>
        <dl className="tutorial__params">
          <dt>LEVEL</dt>
          <dd>0–100 %, default 50 %. How much of the moving copy is mixed in.</dd>
          <dt>RATE</dt>
          <dd>
            0.05–5 Hz, default 0.8 Hz. How fast the sweep moves. Slow rates are lush; fast rates
            head towards vibrato. Half-way on the knob is 0.8 Hz.
          </dd>
          <dt>DEPTH</dt>
          <dd>0–100 %, default 50 %. How far the delay sweeps, and so how much the pitch wobbles.</dd>
        </dl>
        <h3>Starting points</h3>
        <ul>
          <li>
            <strong>Subtle clean shimmer:</strong> LEVEL 40 %, RATE 0.5 Hz, DEPTH 30 %.
          </li>
          <li>
            <strong>80s thick chorus:</strong> LEVEL 60 %, RATE 1 Hz, DEPTH 70 %.
          </li>
          <li>
            <strong>Leslie-style wobble:</strong> LEVEL 70 %, RATE 4 Hz, DEPTH 40 %.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'tremolo',
    group: 'Panels',
    title: 'Tremolo',
    body: (
      <>
        <p className="tutorial__lead">
          The volume rises and falls in time, from a slow vintage sway to a hard, choppy
          stutter. Drag the Tremolo chip from the tray onto POST, or focus it and press{' '}
          <Keys>Enter</Keys>.
        </p>
        <dl className="tutorial__params">
          <dt>LEVEL</dt>
          <dd>
            −24 to +24 dB, snaps at 0. The output trim. A tremolo only ever turns the sound
            down, so it is quieter on average than bypass; turn LEVEL up a little to match.
          </dd>
          <dt>RATE</dt>
          <dd>
            0.5–15 Hz, default 4 Hz. Pulses per second. Half-way on the knob is 4 Hz, so the
            slower, swaying speeds get more room.
          </dd>
          <dt>DEPTH</dt>
          <dd>
            0–100 %, default 50 %. How far the volume falls at the bottom of each pulse. At
            100 % it falls to silence.
          </dd>
        </dl>
        <h3>Wave</h3>
        <p>The four buttons under the knobs show the shape of each pulse.</p>
        <ul>
          <li>
            <strong>Sine</strong>: smooth and round, the classic amp tremolo.
          </li>
          <li>
            <strong>Triangle</strong>: a steadier, more even throb.
          </li>
          <li>
            <strong>Square</strong>: hard on and off, for a stuttering chop. Its edges are
            softened over a couple of milliseconds, so it never clicks.
          </li>
          <li>
            <strong>Saw</strong>: each pulse swells up, then drops, like a note played
            backwards. Softening the drop means that at fast rates it doesn't quite reach
            silence.
          </li>
        </ul>
        <p>
          Click a wave, or focus the switch and use <Keys>←</Keys> <Keys>→</Keys>. Changing
          wave mid-pulse doesn't click either.
        </p>
        <h3>Tap tempo</h3>
        <p>
          <strong>Click the RATE knob in time with the music</strong>, without dragging. After
          two or more taps the tremolo makes one pulse per tap, at the average gap between your
          last few taps. For two pulses per beat, tap eighth notes. A pause of more than two
          seconds starts a new count. Tapping sets the speed, not where the pulses fall: they
          run at your tempo but are not lined up with your taps. Dragging the knob still works
          normally. Because clicks are taps, double-clicking RATE does not reset it.
        </p>
        <h3>Starting points</h3>
        <ul>
          <li>
            <strong>Vintage amp tremolo:</strong> SINE, RATE 5 Hz, DEPTH 50 %, LEVEL +2 dB.
          </li>
          <li>
            <strong>Surf:</strong> TRIANGLE, RATE 6–7 Hz, DEPTH 70 %, ahead of a SPRING reverb.
          </li>
          <li>
            <strong>Helicopter chop:</strong> SQUARE, RATE 8 Hz, DEPTH 100 %.
          </li>
          <li>
            <strong>Slow swells:</strong> SAW, RATE 1–2 Hz tapped to the beat, DEPTH 80 %.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'delay',
    group: 'Panels',
    title: 'Delay',
    body: (
      <>
        <p className="tutorial__lead">A simple mono echo, from tight slapback to long repeats.</p>
        <dl className="tutorial__params">
          <dt>LEVEL</dt>
          <dd>0–100 %, default 30 %. How loud the repeats are next to the dry sound.</dd>
          <dt>TIME</dt>
          <dd>
            20–1000 ms, default 350 ms. The gap between repeats. Half-way on the knob is 250 ms,
            so short times get more room.
          </dd>
          <dt>FEEDBACK</dt>
          <dd>
            0–90 %, default 35 %. How much of each repeat is fed back in, and so how many
            repeats you hear. It stops at 90 % so it can never run away into endless noise.
          </dd>
        </dl>
        <h3>Tap tempo</h3>
        <p>
          <strong>Click the TIME knob in time with the music</strong>, without dragging. After two
          or more taps the delay time follows the average gap between your last few taps, so the
          repeats land on the beat. A pause of more than two seconds starts a new count. Dragging the knob still works normally. Because clicks are taps, double-clicking
          TIME does not reset it.
        </p>
        <h3>Starting points</h3>
        <ul>
          <li>
            <strong>Slapback (rockabilly, country):</strong> TIME 80–120 ms, FEEDBACK 0–10 %,
            LEVEL 35 %.
          </li>
          <li>
            <strong>Lead thickener:</strong> TIME 300–450 ms, FEEDBACK 25 %, LEVEL 20–25 %.
          </li>
          <li>
            <strong>Ambient:</strong> TIME 600–900 ms, FEEDBACK 60–75 %, LEVEL 40 %.
          </li>
        </ul>
        <div className="tutorial__callout">
          Changing TIME while repeats are still sounding bends their pitch, like a tape echo.
          That's expected.
        </div>
      </>
    ),
  },
  {
    id: 'reverb',
    group: 'Panels',
    title: 'Reverb',
    body: (
      <>
        <p className="tutorial__lead">
          A space around the sound, from a small room to a long, shimmering wash. Drag the Reverb
          chip from the tray onto POST, or focus it and press <Keys>Enter</Keys>.
        </p>
        <dl className="tutorial__params">
          <dt>MIX</dt>
          <dd>
            0–100 %, default 30 %. Up to 50 % the reverb is added on top of the full dry sound.
            Above 50 % the dry sound fades out, until at 100 % you hear only the reverb, which is
            handy for ambient pads.
          </dd>
          <dt>DECAY</dt>
          <dd>
            0–100 %, default 50 %. How long the tail lasts. The readout shows the time in seconds
            for the current type: from 0.2–2.5 s for ROOM up to 3–30 s for AMBIENT.
          </dd>
          <dt>TONE</dt>
          <dd>
            0–100 %, default 50 %. How bright the reverb is. Lower settings let the highs die
            away sooner, for a darker, warmer tail.
          </dd>
          <dt>PRE-DELAY</dt>
          <dd>
            0–250 ms, default 20 ms. A gap before the reverb starts, so the attack of each note
            stays clear. Half-way on the knob is 40 ms.
          </dd>
          <dt>The fifth knob</dt>
          <dd>0–100 %, default 50 %. Its name and job change with the type; see below.</dd>
        </dl>
        <h3>Types</h3>
        <ul>
          <li>
            <strong>ROOM</strong>: a small, short space. <strong>EARLY</strong> sets how loud the
            first reflections are; more sounds like a smaller, harder room.
          </li>
          <li>
            <strong>HALL</strong>: a big, smooth reverb with a long tail. <strong>MOD</strong>{' '}
            adds slow movement to the tail, for a lusher sound.
          </li>
          <li>
            <strong>PLATE</strong>: bright and dense, the classic studio reverb for leads.{' '}
            <strong>MOD</strong> as for HALL.
          </li>
          <li>
            <strong>SPRING</strong>: the drippy, bouncy sound of an amp's spring tank.{' '}
            <strong>DRIP</strong> sets how much the springs boing.
          </li>
          <li>
            <strong>SHIMMER</strong>: each pass through the reverb climbs an octave, for a
            rising, choir-like pad. <strong>SHIMMER</strong> sets how much octave goes in.
          </li>
          <li>
            <strong>AMBIENT</strong>: a huge wash that swells in after each note.{' '}
            <strong>BLOOM</strong> sets how slowly it builds.
          </li>
        </ul>
        <p>
          Click a type, or focus the switch and use the arrow keys. Changing type restarts the
          tail; it fades out quickly first, so it doesn't click.
        </p>
        <h3>Trails</h3>
        <p>
          With <strong>TRAILS</strong> on (the default), switching the reverb off with its power
          switch lets the tail ring out naturally, as most reverb pedals do. With it off,
          switching off cuts the tail at once. Removing the reverb with <strong>×</strong> always
          cuts it.
        </p>
        <h3>Starting points</h3>
        <ul>
          <li>
            <strong>Amp spring:</strong> SPRING, MIX 25 %, DECAY 40 %, TONE 40 %, DRIP 60 %.
          </li>
          <li>
            <strong>Lead plate:</strong> PLATE, MIX 25 %, DECAY 45 %, PRE-DELAY 30 ms, MOD 30 %.
          </li>
          <li>
            <strong>Shimmer pad:</strong> SHIMMER, MIX 50 %, DECAY 70 %, SHIMMER 70 %, into a
            clean amp model.
          </li>
          <li>
            <strong>Ambient swell:</strong> AMBIENT, MIX 70 %, DECAY 75 %, BLOOM 80 %, with the
            reverb after the delay.
          </li>
        </ul>
        <div className="tutorial__callout">
          The reverb is mono, like the rest of the rig: it adds depth and space, not stereo
          width.
        </div>
      </>
    ),
  },
  {
    id: 'eq',
    group: 'Panels',
    title: 'EQ',
    body: (
      <>
        <p className="tutorial__lead">
          A three-band tone stack at the end of the chain, for the final shape of the sound.
        </p>
        <dl className="tutorial__params">
          <dt>BASS</dt>
          <dd>
            ±12 dB, low shelf at 100 Hz. Adds weight and thump, or tightens a boomy tone when
            cut.
          </dd>
          <dt>MID</dt>
          <dd>
            ±12 dB, broad peak at 800 Hz. The range that decides whether a guitar cuts through a
            mix (boost) or sits back in a scooped, heavy tone (cut).
          </dd>
          <dt>TREBLE</dt>
          <dd>
            ±12 dB, high shelf at 3.2 kHz. Adds bite and clarity, or tames fizz and harshness
            when cut.
          </dd>
          <dt>LEVEL</dt>
          <dd>
            ±24 dB. Makes up volume while the EQ is on, so a big boost or cut can be matched
            against bypass.
          </dd>
        </dl>
        <p>
          All the bands snap to 0 dB (flat). The EQ is on by default and has no effect while
          every band is at 0.
        </p>
        <h3>Tips</h3>
        <ul>
          <li>Cutting usually sounds more natural than boosting. Cut what you don't like first.</li>
          <li>
            If a high-gain model sounds fizzy, try TREBLE −3 to −6 dB before reaching for a
            different model.
          </li>
          <li>
            Toggle the EQ's power switch to compare. If it jumps in volume, correct it with
            LEVEL.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'output',
    group: 'Panels',
    title: 'Output',
    body: (
      <>
        <p className="tutorial__lead">The master volume, the last thing before your headphones.</p>
        <dl className="tutorial__params">
          <dt>VOLUME</dt>
          <dd>
            −∞ to +6 dB, default −6 dB. Half-way is −12 dB, so most of the travel is in the
            range you actually listen at. At the bottom it is fully silent.
          </dd>
        </dl>
        <ul>
          <li>
            No power switch can take it out of the path. It always applies.
          </li>
          <li>
            If the sound distorts harshly even with a clean model, the output may be too hot:
            bring VOLUME down and turn up your headphones instead.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'presets',
    group: 'Panels',
    title: 'Presets',
    body: (
      <>
        <p className="tutorial__lead">
          A preset saves the whole rig: every knob and slider, which stages are on, which model
          and IR are loaded, the Drive and its clipping type, and which effects are placed and in
          what order.
        </p>
        <h3>The preset bar</h3>
        <ul>
          <li>
            <strong>‹ and ›</strong> step to the previous or next preset.
          </li>
          <li>
            <strong>The name</strong> opens the list, where you can search, pick, rename (
            <Keys>F2</Keys>) or delete (<Keys>Del</Keys>) presets, or type a name and save the
            current setup as a new one. The count shows where you are, for example 2 / 7.
          </li>
          <li>
            <strong>A dot next to the name</strong> means you've changed something since the
            preset was loaded.
          </li>
          <li>
            <strong>Save</strong> writes the changes into the current preset. It reads{' '}
            <em>Save changes</em> when there is something to save and <em>Saved</em> when there
            isn't. With no preset loaded, it asks for a name. On a phone, Save is in the ⋯ menu.
          </li>
          <li>
            <strong>⋯</strong> has Save as new, Rename, Duplicate, Revert changes, Delete and the
            list of shortcuts.
          </li>
          <li>
            After loading or deleting a preset, a short message appears with an{' '}
            <strong>Undo</strong> button. Undoing a delete puts the preset back where it was.
          </li>
        </ul>
        <h3>What a preset stores, and what it doesn't</h3>
        <ul>
          <li>
            <strong>Stored:</strong> every control's value; the power state of the gate, NAM,
            cab, EQ and effects; the NAM model and cab IR; which effects are placed and in what
            order.
          </li>
          <li>
            <strong>Not stored:</strong> your input and output devices (they belong to this
            computer, not the sound) and the LIVE switch. <strong>Loading a preset never
            unmutes.</strong>
          </li>
          <li>
            A preset is the whole sound. Loading one saved without an effect takes it out of the
            chain.
          </li>
        </ul>
        <h3>The list</h3>
        <ul>
          <li>
            The search box matches preset names <em>and</em> the model or IR each preset uses,
            so typing an amp's name finds every preset built on it.
          </li>
          <li>
            Each row shows a one-line summary (model · IR · effects in order), and a ✓ marks the
            loaded preset.
          </li>
          <li>
            From the keyboard: <Keys>↑</Keys> <Keys>↓</Keys> to move, <Keys>Enter</Keys> to load,{' '}
            <Keys>Home</Keys> <Keys>End</Keys> for the first and last, <Keys>F2</Keys> to rename,{' '}
            <Keys>Del</Keys> to delete, <Keys>Esc</Keys> to close.
          </li>
          <li>
            Names can be up to 40 characters and must be unique. The <em>Save as new</em> field
            at the bottom of the list saves the current sound under a new name.
          </li>
        </ul>
        <h3>Switching presets</h3>
        <ul>
          <li>
            The name changes straight away, and the sound follows about 200 ms later. Tapping{' '}
            <Keys>[</Keys> <Keys>]</Keys> quickly through several presets only loads the one you
            stop on.
          </li>
          <li>
            Only what differs is changed. If two presets use the same amp model it isn't
            reloaded, so switching between them is seamless.
          </li>
          <li>
            <strong>Unsaved changes are discarded when you switch, without asking.</strong> A{' '}
            <em>Changes discarded</em> message appears with <strong>Undo</strong>, which brings
            them back. Save first if you want to keep them.
          </li>
        </ul>
        <h3>Preset shortcuts</h3>
        <table className="tutorial__table">
          <tbody>
            <tr>
              <th>
                <Keys>[</Keys> <Keys>]</Keys>
              </th>
              <td>Previous or next preset</td>
            </tr>
            <tr>
              <th>
                <Keys>1</Keys> – <Keys>9</Keys>
              </th>
              <td>Jump to that preset</td>
            </tr>
            <tr>
              <th>
                <Keys>/</Keys> or <Keys>Ctrl</Keys> <Keys>K</Keys>
              </th>
              <td>Open the preset list</td>
            </tr>
            <tr>
              <th>
                <Keys>Ctrl</Keys> <Keys>S</Keys>
              </th>
              <td>Save</td>
            </tr>
            <tr>
              <th>
                <Keys>Ctrl</Keys> <Keys>Shift</Keys> <Keys>S</Keys>
              </th>
              <td>Save as new</td>
            </tr>
            <tr>
              <th>
                <Keys>Esc</Keys>
              </th>
              <td>Close the list</td>
            </tr>
          </tbody>
        </table>
        <p>
          The shortcuts don't fire while you are typing in a text box or while a window like this
          one is open.
        </p>
        <div className="tutorial__callout">
          Presets store the <em>names</em> of your model and IR files, not the files themselves.
          A preset that names a file you've since removed is marked with <strong>!</strong> in
          the list. Everything else in it still loads; that stage stays bypassed, and a message
          says which file is missing. Select a file with the same name from your device and the preset works again.
          Nothing in the preset itself is changed.
        </div>
      </>
    ),
  },
  {
    id: 'tuner',
    group: 'Panels',
    title: 'Tuner',
    body: (
      <>
        <p className="tutorial__lead">
          A chromatic tuner, opened with the tuning-fork button in the session bar.
        </p>
        <ul>
          <li>
            It listens to the raw input, before any processing, so it works whether LIVE is on
            or off. Flip LIVE off to tune silently.
          </li>
          <li>
            The large letter is the nearest note, with its octave (E2 is a standard low E).
            Sharps are used, not flats.
          </li>
          <li>
            The number and needle show how far off you are, in cents (hundredths of a semitone).
            Negative is flat, positive is sharp. The needle lights up within ±5 cents.
          </li>
          <li>Tuned to A = 440 Hz. It covers the whole bass and guitar range.</li>
          <li>
            Play single notes and let them ring. Chords and heavy distortion confuse it.
          </li>
          <li>
            Close it with the Close button, <Keys>Esc</Keys>, or a click outside it.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'log',
    group: 'Panels',
    title: 'Message log',
    body: (
      <>
        <p className="tutorial__lead">
          The terminal button in the bottom-right corner opens the message log. Every notice,
          warning and error the app produces goes here.
        </p>
        <ul>
          <li>
            A badge on the button counts messages you haven't seen, and its colour shows the most
            serious one.
          </li>
          <li>The first time an error happens, the log opens by itself so it can't go unnoticed.</li>
          <li>
            Typical entries: a model or IR that loaded or failed, a device that disappeared, an
            IR that was cut short, or the browser ignoring an input setting.
          </li>
          <li>
            <Keys>Esc</Keys> closes it.
          </li>
        </ul>
        <div className="tutorial__callout">
          If the log warns that the browser <em>did not honour the input constraints</em>, it
          has turned on echo cancellation, noise suppression or automatic gain for your input.
          The guitar will sound gated and pumping. Try another browser, or check your system's
          audio settings for "enhancements".
        </div>
      </>
    ),
  },
  {
    id: 'shortcuts',
    group: 'Reference',
    title: 'Keyboard shortcuts',
    body: (
      <>
        <table className="tutorial__table">
          <tbody>
            <tr>
              <th>
                <Keys>Space</Keys>
              </th>
              <td>Panic mute. Works from anywhere except while typing in a text box.</td>
            </tr>
            <tr>
              <th>
                <Keys>[</Keys> <Keys>]</Keys>
              </th>
              <td>Previous / next preset</td>
            </tr>
            <tr>
              <th>
                <Keys>1</Keys> – <Keys>9</Keys>
              </th>
              <td>Jump to a preset</td>
            </tr>
            <tr>
              <th>
                <Keys>/</Keys> or <Keys>Ctrl</Keys> <Keys>K</Keys>
              </th>
              <td>Open the preset list</td>
            </tr>
            <tr>
              <th>
                <Keys>Ctrl</Keys> <Keys>S</Keys>
              </th>
              <td>Save the preset</td>
            </tr>
            <tr>
              <th>
                <Keys>Ctrl</Keys> <Keys>Shift</Keys> <Keys>S</Keys>
              </th>
              <td>Save as a new preset</td>
            </tr>
            <tr>
              <th>
                <Keys>↑</Keys> <Keys>↓</Keys> <Keys>←</Keys> <Keys>→</Keys>
              </th>
              <td>Nudge the focused knob or slider one step</td>
            </tr>
            <tr>
              <th>
                <Keys>PgUp</Keys> <Keys>PgDn</Keys>
              </th>
              <td>Nudge the focused knob ten steps</td>
            </tr>
            <tr>
              <th>
                <Keys>Home</Keys> <Keys>End</Keys>
              </th>
              <td>Focused knob to its minimum / maximum</td>
            </tr>
            <tr>
              <th>
                <Keys>←</Keys> <Keys>→</Keys> on an effect's title
              </th>
              <td>Move the effect earlier or later in the chain</td>
            </tr>
            <tr>
              <th>
                <Keys>Enter</Keys> on a tray chip
              </th>
              <td>Add that effect to the chain</td>
            </tr>
            <tr>
              <th>
                <Keys>Alt</Keys> + drag
              </th>
              <td>Pan the signal chain sideways</td>
            </tr>
            <tr>
              <th>
                <Keys>Esc</Keys>
              </th>
              <td>Close the tuner, this guide, the preset list or the message log</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: 'your-data',
    group: 'Reference',
    title: 'Your data and privacy',
    body: (
      <>
        <p className="tutorial__lead">
          Everything you do in Sarlifier stays on your computer. There is no account and no
          server storing your files, and none of your data is sent anywhere. The only network
          traffic is the app downloading its own files and checking for updates.
        </p>
        <div className="tutorial__callout">
          <strong>Your files never leave this computer.</strong> When you select a{' '}
          <code>.nam</code> model or <code>.wav</code> IR from your device, the file is copied into
          this browser's own storage on this computer. It is <em>never</em> sent to a server. The
          same goes for your presets and settings. Your guitar audio is processed entirely on
          your computer too, and is never recorded or transmitted.
        </div>
        <h3>What is saved automatically</h3>
        <ul>
          <li>
            <strong>Your current sound</strong>: every control, which stages are on, the loaded
            model and IR, the effects and their order, and which preset is loaded, including
            unsaved changes (the dot stays). Close the tab or reload and it is all still there.
          </li>
          <li>
            <strong>Your chosen input and output devices</strong>, when you pick them yourself.
          </li>
          <li>
            <strong>Your presets.</strong>
          </li>
          <li>
            <strong>The models and IRs you've selected</strong>, so they stay in the dropdowns and
            work offline.
          </li>
          <li>Whether you have dismissed the headphones notice and finished the guided tour.</li>
        </ul>
        <h3>Where it lives</h3>
        <p>
          Settings and presets are in the browser's local storage; your model and IR files are in its
          IndexedDB database. Both belong to this site, in this browser, on this computer.
        </p>
        <ul>
          <li>
            <strong>Another browser or computer starts empty.</strong> Nothing syncs, and there
            is no export yet.
          </li>
          <li>
            <strong>Clearing site data deletes it all</strong>: presets, settings and saved model and IR files.
            The same happens with "Clear browsing data" if cookies and site data are included.
            Keep your original <code>.nam</code> and <code>.wav</code> files somewhere safe.
          </li>
          <li>
            <strong>Private / incognito windows</strong> may refuse to save. Presets then work
            for that session only and are gone when the window closes.
          </li>
          <li>
            To remove a single saved file, select it and use the bin button in its panel.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'troubleshooting',
    group: 'Reference',
    title: 'Troubleshooting',
    body: (
      <>
        <dl className="tutorial__faq">
          <dt>I hear nothing.</dt>
          <dd>
            Check, in order: LIVE is on (LED lit); the LEVEL meter moves when you play (if not,
            the wrong INPUT is selected or the interface's gain is at zero); OUTPUT VOLUME isn't
            at the bottom; OUTPUT is the device your headphones are plugged into.
          </dd>
          <dt>It's loud, harsh and buzzy.</dt>
          <dd>
            An amp-only model is playing without a cab. Load a cab IR and turn CAB on.
          </dd>
          <dt>It's dull and muffled.</dt>
          <dd>
            Probably two cabinets: a full-rig model with CAB on as well. Turn CAB off. Otherwise
            try some TREBLE.
          </dd>
          <dt>Notes cut off, or the sound pumps.</dt>
          <dd>
            Lower the gate's THRESHOLD. If the gate is off, check the message log for a warning
            about input constraints: the browser may be applying its own noise suppression.
          </dd>
          <dt>Crackles or dropouts.</dt>
          <dd>
            Close other heavy tabs and apps, keep the laptop on mains power, and avoid Bluetooth
            headphones, which add delay and glitches. Very large <code>.nam</code> models need
            more processing power; try a smaller one.
          </dd>
          <dt>There's a noticeable delay when I play.</dt>
          <dd>
            Browser audio has more latency than a hardware rig. Use a wired USB interface rather
            than built-in audio, and never Bluetooth. The LATENCY readout shows the estimate.
          </dd>
          <dt>My model file won't load.</dt>
          <dd>
            It must be a <code>.nam</code> file of 8 MB or less. The message log says why a file
            was rejected.
          </dd>
          <dt>The model dropdown is empty.</dt>
          <dd>
            That's expected on a first visit: no models come with the app. Select a{' '}
            <code>.nam</code> file from your device (see <em>Amp and cab</em>).
          </dd>
          <dt>I can't choose an output device.</dt>
          <dd>That needs a Chromium browser. Other browsers use the system default output.</dd>
          <dt>Does it work offline?</dt>
          <dd>
            Yes. Once loaded, the app is cached, and the models and IRs you've selected are stored in
            the browser. You can install it from the browser's address bar as an app.
            When a new version is out, a window asks you to update.
          </dd>
        </dl>
      </>
    ),
  },
  {
    id: 'about',
    group: 'Reference',
    title: 'About and licences',
    body: (
      <>
        <p className="tutorial__lead">
          Sarlifier is an independent project. It is not made by, affiliated with or endorsed
          by Neural Amp Modeler or TONE3000.
        </p>
        <h3>Models and impulse responses</h3>
        <p>
          No <code>.nam</code> models or cab IRs are distributed with the app. The files you
          load are your own, stay in your browser, and are never sent to any server (see{' '}
          <em>Your data and privacy</em>). When you
          download captures from a site such as TONE3000, that site's terms and each
          creator's wishes apply to how you use them.
        </p>
        <h3>Open-source software</h3>
        <p>
          The audio engine is built on{' '}
          <a href="https://github.com/sdatkinson/NeuralAmpModelerCore" target="_blank" rel="noreferrer">
            NeuralAmpModelerCore
          </a>{' '}
          (MIT licence), with Eigen (MPL 2.0) and nlohmann/json (MIT), compiled with Emscripten.
          The interface uses React and Workbox (MIT).{' '}
          <a href="/third-party-licenses.txt" target="_blank" rel="noreferrer">
            Read the full licence texts
          </a>
          .
        </p>
        <h3>Gear names</h3>
        <p>
          Amp, pedal and cabinet names that appear in model file names are trademarks of their
          owners. They only describe the gear a capture copies.
        </p>
      </>
    ),
  },
];
