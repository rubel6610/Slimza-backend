import { Controller, Get, Param } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/decorators/public.decorator.js';
import { WellnessHubService } from './wellness-hub.service.js';

const slugParam = z.string().trim().toLowerCase().min(1).max(80);

/**
 * Wellness Product Hub (docs/WELLNESS_HUB.md).
 *   Public: GET /wellness-hub/:slug → { group, products }
 * Groups are edited through the CMS: PUT /cms/wellness_hub (admin).
 */
@Controller('wellness-hub')
export class WellnessHubController {
  constructor(private readonly hub: WellnessHubService) {}

  @Public()
  @Get(':slug')
  group(@Param('slug', { schema: slugParam }) slug: string) {
    return this.hub.publicGroup(slug);
  }
}
