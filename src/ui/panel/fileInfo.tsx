/**
 * What goes in the ⓘ tooltips beside NAM and CAB: what the file is, where to
 * get one, and how to load it. Kept short — the guide's "Amp and cab" page has
 * the long version.
 */

const TONE3000 = 'https://www.tone3000.com/';
const NAM_SITE = 'https://www.neuralampmodeler.com/';

const Link = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

export function NamFileInfo() {
  return (
    <>
      <p className="info-tip__title">NAM amp model (.nam)</p>
      <p>
        A neural-network capture of a real amp, pedal or whole rig, made with Neural Amp
        Modeler. It plays like the gear it was captured from.
      </p>
      <p className="info-tip__head">Where to get one</p>
      <ul>
        <li>
          <Link href={TONE3000}>TONE3000</Link>: thousands of free captures. Search for an amp,
          open it and download the <code>.nam</code> file.
        </li>
        <li>
          Capture your own gear with the tools at <Link href={NAM_SITE}>neuralampmodeler.com</Link>.
        </li>
      </ul>
      <p className="info-tip__head">How to load it</p>
      <ol>
        <li>
          Press <strong>↑</strong> and select the <code>.nam</code> file from your device (up to
          8 MB).
        </li>
        <li>Turn the NAM power switch on.</li>
      </ol>
      <p className="info-tip__note">
        “Full rig” captures already include a cabinet: leave CAB off for those. The file is saved
        in this browser only and never sent to a server.
      </p>
    </>
  );
}

export function IrFileInfo() {
  return (
    <>
      <p className="info-tip__title">Cabinet impulse response (.wav)</p>
      <p>
        A short recording of how a real speaker cabinet and microphone colour the sound. An
        amp-only model sounds harsh and buzzy without one.
      </p>
      <p className="info-tip__head">Where to get one</p>
      <ul>
        <li>
          <Link href={TONE3000}>TONE3000</Link> hosts free cab IRs as well as amp models.
        </li>
        <li>
          Many cabinet makers and IR companies give away free packs. Packs usually come as a
          .zip: unzip it and pick a <code>.wav</code>.
        </li>
      </ul>
      <p className="info-tip__head">How to load it</p>
      <ol>
        <li>
          Press <strong>↑</strong> and select the <code>.wav</code> file from your device.
        </li>
        <li>Turn the CAB power switch on.</li>
      </ol>
      <p className="info-tip__note">
        Mono or stereo both work; only the first ~85 ms is used, which covers any normal cab IR.
        Skip this if your NAM model is a “full rig” capture. The file is saved in this browser only
        and never sent to a server.
      </p>
    </>
  );
}
