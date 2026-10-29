/**
 * Self-contained smoke check executed inside an unprivileged read-only image.
 * Only synthetic HTML and temporary storage are used.
 */
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertHtmlToRtf, validateRtf } from '../src/conversion/rtf.js';
import { publishSignatureSnapshot } from '../src/publish/snapshot.js';

const base = await mkdtemp(join(tmpdir(), 'signaturee-container-test-'));
try {
  const output = join(base, 'output');
  await mkdir(output, { mode: 0o700 });
  const html = '<html><head><meta charset="utf-8"></head><body>' +
    '<p>Alex Müller &amp; Test</p></body></html>';
  const rtf = await convertHtmlToRtf({ html });
  validateRtf(rtf);
  const result = await publishSignatureSnapshot({
    rootDirectory: output, accountName: 'example.user',
    signatures: [{ key: 'DEMO', html, text: 'Alex Müller & Test', rtf }],
  });
  const published = await readFile(join(result.snapshotPath, 'DEMO.rtf'));
  if (Buffer.compare(Buffer.from(rtf), published) !== 0) {
    throw new Error('RTF mismatch after publishing');
  }
  console.log('PASS: Non-root container rendered and published synthetic RTF.');
} finally {
  await rm(base, { recursive: true, force: true });
}
