import { getCompany, updateCompany } from '../services/company.js';
import { actorOf } from './guards.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';

/**
 * `/api/v1/company` (spec §39, §7.1).
 *
 * The signed-in user's «virksomhetsprofil»: name, organisation number,
 * industry description and the services the company delivers. Both handlers
 * are two lines because the shape of this layer is fixed — resolve the actor,
 * hand off — and everything worth arguing about (who may write, what a valid
 * organisation number is, whether a company exists yet) is in the service.
 */
export function registerCompanyRoutes(app: ApiInstance, ctx: ApiContext): void {
  app.get('/company', async (request) => ({ company: await getCompany(ctx, actorOf(request)) }));

  app.patch('/company', async (request) => ({
    company: await updateCompany(ctx, actorOf(request), request.body),
  }));
}
