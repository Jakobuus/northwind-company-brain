import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BrainAreaDto {
  @IsString()
  @MaxLength(40)
  slug: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  leads?: string[];

  @IsOptional()
  @IsString()
  ownerUserId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  topics?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readerGroups?: string[];
}

export class BrainMemberDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  groups?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  home?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  rankOverride?: number | null;
}

export class UpdateBrainAccessDto {
  @IsArray()
  @ArrayMaxSize(11) // 10 departments + the core row the client echoes back
  @ValidateNested({ each: true })
  @Type(() => BrainAreaDto)
  areas: BrainAreaDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => BrainMemberDto)
  members?: BrainMemberDto[];
}

export class MoveBrainNoteDto {
  @IsIn(['dept', 'dept-core', 'core'])
  to: 'dept' | 'dept-core' | 'core';
}

export class CreatePromotionRequestDto {
  @IsIn(['dept-core', 'core'])
  to: 'dept-core' | 'core';
}
