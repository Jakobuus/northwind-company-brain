import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { BrainClient } from './brain-client';
import { BrainController } from './brain.controller';
import { BrainService } from './brain.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [BrainController],
  providers: [BrainService, BrainClient],
  exports: [BrainService],
})
export class BrainModule {}
