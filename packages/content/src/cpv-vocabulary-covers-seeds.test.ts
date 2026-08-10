import { describe, expect, it } from 'vitest';
import { cpvLabel } from '@luma/domain';
import { SERVICE_TEMPLATE_SEEDS } from './service-templates.js';

/**
 * The test that keeps `@luma/domain`'s CPV vocabulary honest as the seeds change.
 *
 * It lives here rather than beside the vocabulary because `@luma/domain` is the
 * bottom of the dependency graph and imports nothing from the workspace;
 * `@luma/content` already depends on it, so the edge only goes one way from
 * this side.
 *
 * The seeds are imported rather than listed, deliberately. A hardcoded list of
 * codes would keep passing after someone adds a ninth template, and the failure
 * would first appear as a results page showing a supplier the raw digits
 * `79993000` where it promised a Norwegian name.
 */

describe('every CPV code in the service templates has a Norwegian name', () => {
  for (const seed of SERVICE_TEMPLATE_SEEDS) {
    const codes = [...seed.cpvInclude, ...seed.cpvExclude];

    it(`${seed.slug} (${codes.length} codes)`, () => {
      const unnamed = codes.filter((code) => cpvLabel(code) === code);
      expect(unnamed, `add these to CPV_VOCABULARY: ${unnamed.join(', ')}`).toEqual([]);
    });
  }
});
