import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUserPayload } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import {
  blogIdParamSchema,
  blogListQuerySchema,
  blogSlugOrIdParamSchema,
  createBlogSchema,
  updateBlogSchema,
  type BlogListQuery,
  type CreateBlogInput,
  type UpdateBlogInput,
} from './blogs.schemas.js';
import { BlogsService } from './blogs.service.js';

/**
 * Blog posts. Public reads for the shop; everything else is admin only.
 * Archive lifecycle (src/common/archive/archive.ts):
 *   PATCH :id/archive → PATCH :id/unarchive (restore) or DELETE :id (archived only)
 * Cover images are uploaded with POST /cms/upload.
 */
@Controller('blogs')
export class BlogsController {
  constructor(private readonly blogsService: BlogsService) {}

  /** `?q=&category=&page=&limit=`; `?archived=only|include` for admins only. */
  @Public()
  @Get()
  findAll(@Query({ schema: blogListQuerySchema }) query: BlogListQuery, @CurrentUser() user?: AuthUserPayload) {
    return this.blogsService.findAll(query, user?.role === UserRole.ADMIN);
  }

  @Public()
  @Get(':slugOrId')
  findOne(@Param('slugOrId', { schema: blogSlugOrIdParamSchema }) slugOrId: string, @CurrentUser() user?: AuthUserPayload) {
    return this.blogsService.findOne(slugOrId, user?.role === UserRole.ADMIN);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body({ schema: createBlogSchema }) body: CreateBlogInput) {
    return this.blogsService.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/archive')
  archive(@Param('id', { schema: blogIdParamSchema }) id: string) {
    return this.blogsService.archive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/unarchive')
  unarchive(@Param('id', { schema: blogIdParamSchema }) id: string) {
    return this.blogsService.unarchive(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id', { schema: blogIdParamSchema }) id: string, @Body({ schema: updateBlogSchema }) body: UpdateBlogInput) {
    return this.blogsService.update(id, body);
  }

  /** Permanent. The post must be archived first (409 otherwise). */
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id', { schema: blogIdParamSchema }) id: string) {
    return this.blogsService.remove(id);
  }
}
