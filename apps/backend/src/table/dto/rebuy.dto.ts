import { Matches } from 'class-validator';
import { DECIMAL_PATTERN } from './sit-at-table.dto';

export class RebuyDto {
  @Matches(DECIMAL_PATTERN, {
    message: 'buyInAmount deve ser um decimal monetário, ex: "100.00".',
  })
  buyInAmount!: string;
}
