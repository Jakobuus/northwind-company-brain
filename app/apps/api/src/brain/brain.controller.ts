import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BRAIN_MAX_UPLOAD_BYTES,
  BrainAccessResponse,
  BrainLinkResponse,
  BrainMoveResponse,
  BrainNotesResponse,
  BrainPromotionRequestItem,
  BrainPromotionRequestsResponse,
  BrainUploadResponse,
  TokenPayload,
} from '@app-starter/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { BrainService } from './brain.service';
import {
  CreatePromotionRequestDto,
  MoveBrainNoteDto,
  UpdateBrainAccessDto,
} from './dto/update-brain-access.dto';

type Req = { user: TokenPayload };

/** Organization-scoped company brain routes (membership is checked in the service). */
@ApiTags('brain')
@Controller('organizations/:organizationId/brain')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
export class BrainController {
  constructor(private readonly brain: BrainService) {}

  @Get('view')
  @ApiOperation({ summary: 'Signed URL of the caller’s view of the brain graph' })
  view(@Request() req: Req, @Param('organizationId') orgId: string): Promise<BrainLinkResponse> {
    return this.brain.getViewLink(req.user.sub, orgId);
  }

  @Get('demo-personas')
  @ApiOperation({ summary: 'Demo only: view links for the "view as" selector (owner or dept lead)' })
  demoPersonas(@Request() req: Req, @Param('organizationId') orgId: string) {
    return this.brain.getDemoPersonas(req.user.sub, orgId);
  }

  @Get('mcp-link')
  @ApiOperation({ summary: 'Per-person MCP link for Claude / ChatGPT' })
  mcpLink(@Request() req: Req, @Param('organizationId') orgId: string): Promise<BrainLinkResponse> {
    return this.brain.getMcpLink(req.user.sub, orgId);
  }

  @Get('notes')
  @ApiOperation({ summary: 'Notes the caller may read' })
  notes(@Request() req: Req, @Param('organizationId') orgId: string): Promise<BrainNotesResponse> {
    return this.brain.listNotes(req.user.sub, orgId);
  }

  @Get('access')
  @ApiOperation({ summary: 'Departments and members (details for OWNER/ADMIN only)' })
  getAccess(@Request() req: Req, @Param('organizationId') orgId: string): Promise<BrainAccessResponse> {
    return this.brain.getAccess(req.user.sub, orgId);
  }

  @Put('access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace departments and member settings (OWNER/ADMIN)' })
  putAccess(
    @Request() req: Req,
    @Param('organizationId') orgId: string,
    @Body() body: UpdateBrainAccessDto,
  ): Promise<BrainAccessResponse> {
    return this.brain.updateAccess(req.user.sub, orgId, body);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file into the brain (author = caller)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BRAIN_MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @Request() req: Req,
    @Param('organizationId') orgId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number; mimetype?: string },
    @Body()
    body: {
      layer?: string;
      dept?: string;
      area?: string;
      access?: string;
      allow?: string | string[];
    },
  ): Promise<BrainUploadResponse> {
    const allow = (Array.isArray(body.allow) ? body.allow : [body.allow ?? ''])
      .flatMap((v) => String(v).split(','))
      .map((v) => v.trim())
      .filter(Boolean);
    return this.brain.upload(req.user.sub, orgId, {
      file,
      layer: body.layer,
      dept: body.dept,
      area: body.area,
      access: body.access,
      allow,
    });
  }

  @Post('notes/:noteId/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a note to another layer (the brain decides if the caller may)' })
  move(
    @Request() req: Req,
    @Param('organizationId') orgId: string,
    @Param('noteId') noteId: string,
    @Body() body: MoveBrainNoteDto,
  ): Promise<BrainMoveResponse> {
    return this.brain.moveNote(req.user.sub, orgId, noteId, body.to);
  }

  @Post('notes/:noteId/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Commit a private note to my department' })
  commit(
    @Request() req: Req,
    @Param('organizationId') orgId: string,
    @Param('noteId') noteId: string,
  ): Promise<BrainMoveResponse> {
    return this.brain.moveNote(req.user.sub, orgId, noteId, 'dept');
  }

  @Post('notes/:noteId/promotion-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ask my department leads to promote a note' })
  requestPromotion(
    @Request() req: Req,
    @Param('organizationId') orgId: string,
    @Param('noteId') noteId: string,
    @Body() body: CreatePromotionRequestDto,
  ): Promise<BrainPromotionRequestItem> {
    return this.brain.createPromotionRequest(req.user.sub, orgId, noteId, body.to);
  }

  @Get('promotion-requests')
  @ApiOperation({ summary: 'My requests, plus pending ones for departments I lead' })
  promotionRequests(
    @Request() req: Req,
    @Param('organizationId') orgId: string,
  ): Promise<BrainPromotionRequestsResponse> {
    return this.brain.listPromotionRequests(req.user.sub, orgId);
  }

  @Post('promotion-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a promotion request (department leads only)' })
  approve(
    @Request() req: Req,
    @Param('organizationId') orgId: string,
    @Param('requestId') requestId: string,
  ): Promise<BrainPromotionRequestItem> {
    return this.brain.decidePromotionRequest(req.user.sub, orgId, requestId, true);
  }

  @Post('promotion-requests/:requestId/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a promotion request (department leads only)' })
  decline(
    @Request() req: Req,
    @Param('organizationId') orgId: string,
    @Param('requestId') requestId: string,
  ): Promise<BrainPromotionRequestItem> {
    return this.brain.decidePromotionRequest(req.user.sub, orgId, requestId, false);
  }
}
