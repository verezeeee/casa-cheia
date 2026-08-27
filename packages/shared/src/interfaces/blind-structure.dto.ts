import { BlindLevelDto } from './blind-level.dto';

/**
 * Preset reutilizável de estrutura de blinds ("Turbo 20min", "Deepstack").
 *
 * É catálogo, não torneio: ao criar um torneio os níveis são COPIADOS POR
 * VALOR: editar o preset depois NÃO altera nenhum torneio já criado.
 */
export interface BlindStructureDto {
  id: string;

  name: string;

  /** Níveis em ordem de `levelNumber`. */
  levels: BlindLevelDto[];
}
