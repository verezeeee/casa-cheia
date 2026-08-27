import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BlindLevelInputDto } from './blind-level-input.dto';

/**
 * Criação (POST) e substituição (PUT) de um preset de blinds.
 *
 * O mesmo DTO serve aos dois verbos porque o `update` REESCREVE a grade
 * inteira — não existe edição parcial de nível no preset (ver
 * `BlindStructureService.update`).
 */
export class CreateBlindStructureDto {
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /**
   * Grade completa. `levelNumber` precisa ser sequencial de 1 a N, sem buracos
   * nem repetição — validado no service (regra sobre o CONJUNTO de linhas, que
   * um validador de campo único não expressa).
   */
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BlindLevelInputDto)
  levels!: BlindLevelInputDto[];
}
