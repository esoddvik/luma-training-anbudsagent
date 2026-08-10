import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MACHINE_SIGNATURE_HEADER,
  machineSignatureMatches,
  signMachineRequest,
} from './machine-signature';

const SECRET = 'test-secret-not-real';
const BODY = '{"apply":true}';

describe('machineSignatureMatches', () => {
  it('accepts a digest produced with the same secret and body', () => {
    expect(machineSignatureMatches(BODY, signMachineRequest(BODY, SECRET), SECRET)).toBe(true);
  });

  it('rejects a digest over a different body', () => {
    // The whole point of signing the payload rather than sending a token: a
    // captured call cannot be edited into a different instruction.
    expect(
      machineSignatureMatches('{"apply":false}', signMachineRequest(BODY, SECRET), SECRET),
    ).toBe(false);
  });

  it('rejects a digest produced with a different secret', () => {
    expect(machineSignatureMatches(BODY, signMachineRequest(BODY, 'another-secret'), SECRET)).toBe(
      false,
    );
  });

  it('rejects a missing signature rather than treating absence as a pass', () => {
    expect(machineSignatureMatches(BODY, null, SECRET)).toBe(false);
    expect(machineSignatureMatches(BODY, undefined, SECRET)).toBe(false);
    expect(machineSignatureMatches(BODY, '', SECRET)).toBe(false);
  });

  it('returns false rather than throwing on a wrong-length signature', () => {
    // `timingSafeEqual` throws when the buffers differ in length. A thrown 500
    // is an oracle: it tells a caller their guess was the wrong shape, which a
    // 401 does not. This is the case the length check exists for.
    expect(() => machineSignatureMatches(BODY, 'abc', SECRET)).not.toThrow();
    expect(machineSignatureMatches(BODY, 'abc', SECRET)).toBe(false);
  });

  it('rejects a correct digest in the wrong case', () => {
    // Hex is lowercase from `digest('hex')`. Accepting either case would mean
    // normalising before comparison, which is a second code path to get wrong.
    const upper = signMachineRequest(BODY, SECRET).toUpperCase();
    expect(machineSignatureMatches(BODY, upper, SECRET)).toBe(false);
  });

  it('signs the empty body, so a bare dry run is authenticable', () => {
    // `/synk-tjenestemaler` treats an empty body as `{ apply: false }`, which
    // is the cheapest way to ask whether anything is drifting.
    expect(machineSignatureMatches('', signMachineRequest('', SECRET), SECRET)).toBe(true);
  });

  it('produces the digest an external caller would compute independently', () => {
    // Guards the algorithm and encoding, not just self-consistency: a change
    // from sha256 or from hex would keep every test above green while breaking
    // every caller that signs with openssl or a shell script.
    const external = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
    expect(signMachineRequest(BODY, SECRET)).toBe(external);
  });

  it('names the header both routes read', () => {
    expect(MACHINE_SIGNATURE_HEADER).toBe('x-luma-signature');
  });
});
