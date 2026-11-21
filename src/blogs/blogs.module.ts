import { Module } from '@nestjs/common';
import { BlogsController } from './blogs.controller.js';
import { BlogsService } from './blogs.service.js';

@Module({
  controllers: [BlogsController],
  providers: [BlogsService],
})
export class BlogsModule {}
