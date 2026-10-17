// Writes public/third-party-licenses.txt: the licence of every third-party
// component that ships inside the app — compiled into the WASM engine or
// bundled into the JS — read from the components' own files, so the notice
// cannot drift from what is actually built. Run after bumping a dependency:
//
//   npm run gen:licenses
//
// Needs the NeuralAmpModelerCore submodule, node_modules and the pinned
// .emsdk/ to be present; it fails rather than write an incomplete notice.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nam = join(root, 'engine/third_party/NeuralAmpModelerCore');
const read = (path) => readFileSync(join(root, path), 'utf8').trim();
const version = (pkg) => JSON.parse(read(`node_modules/${pkg}/package.json`)).version;

// nlohmann/json ships in the submodule as a single header with no LICENSE file
// beside it; its header carries the SPDX identifier and copyright line.
function nlohmannLicense() {
  const header = readFileSync(join(nam, 'Dependencies/nlohmann/json.hpp'), 'utf8');
  const copyright = header.match(/SPDX-FileCopyrightText: (.+)/)?.[1];
  if (!copyright || !header.includes('SPDX-License-Identifier: MIT')) {
    throw new Error('nlohmann/json.hpp no longer declares MIT — check its licence by hand');
  }
  return `MIT License

Copyright (c) ${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
}

const components = [
  {
    name: 'NeuralAmpModelerCore v0.5.4',
    url: 'https://github.com/sdatkinson/NeuralAmpModelerCore',
    use: 'Neural Amp Modeler inference, compiled into the WASM engine.',
    license: read('engine/third_party/NeuralAmpModelerCore/LICENSE'),
  },
  {
    name: 'Eigen',
    url: 'https://gitlab.com/libeigen/eigen',
    use:
      'Linear algebra, compiled into the WASM engine. Used unmodified; its source ' +
      'is available at the URL above (MPL 2.0 §3.2).',
    license: `${read('engine/third_party/NeuralAmpModelerCore/Dependencies/eigen/COPYING.README')}\n\n${read(
      'engine/third_party/NeuralAmpModelerCore/Dependencies/eigen/COPYING.MPL2',
    )}`,
  },
  {
    name: 'JSON for Modern C++ (nlohmann/json)',
    url: 'https://github.com/nlohmann/json',
    use: 'Parses .nam model files, compiled into the WASM engine.',
    license: nlohmannLicense(),
  },
  {
    name: 'Emscripten',
    url: 'https://github.com/emscripten-core/emscripten',
    use: 'Compiler runtime and JavaScript glue for the WASM engine.',
    license: read('.emsdk/upstream/emscripten/LICENSE'),
  },
  ...['react', 'react-dom', 'scheduler'].map((pkg) => ({
    name: `${pkg} ${version(pkg)}`,
    url: 'https://github.com/facebook/react',
    use: 'User interface, bundled into the app.',
    license: read(`node_modules/${pkg}/LICENSE`),
  })),
  ...['workbox-window', 'workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies'].map(
    (pkg) => ({
      name: `${pkg} ${version(pkg)}`,
      url: 'https://github.com/GoogleChrome/workbox',
      use: 'Offline support (service worker), bundled into the app.',
      license: read(`node_modules/${pkg}/LICENSE`),
    }),
  ),
];

const rule = '='.repeat(78);
const text = [
  'Sarlifier — third-party software notices',
  '',
  'Sarlifier includes the following third-party software. Each is used under the',
  'licence reproduced below.',
  '',
  'No amp models (.nam) or impulse responses (.wav) are distributed with the app.',
  'Any you load are your own files and stay in your browser.',
  '',
  ...components.flatMap((c) => [rule, c.name, c.url, c.use, rule, '', c.license, '']),
].join('\n');

writeFileSync(join(root, 'public/third-party-licenses.txt'), text);
console.log(`Wrote public/third-party-licenses.txt (${components.length} components).`);
