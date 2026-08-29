import { Controller, Get, Header, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  PublicTournamentTableMapDto,
  TournamentClockDto,
} from '@poker-system/shared';
import { TournamentClockService } from './tournament-clock.service';
import { TournamentService } from './tournament.service';

/**
 * Conta da TV do salão: 8 telas × 2 rotas × 1 req/s × 60s = 960 req/min — e
 * todas saindo do MESMO IP (o NAT do clube), que é a chave do
 * `ThrottlerGuard`. O limite global de 300/min (`app.module.ts`) barraria já no
 * primeiro minuto, com 429 na TV do meio do salão. 2000/min cobre as 8 telas
 * com ~2x de folga (ou 16 telas sem retoque) e continua longe de ser um canal
 * de scraping: a rota não devolve dado sensível nem é cara (uma query só).
 */
const DISPLAY_POLLING_THROTTLE = { default: { ttl: 60_000, limit: 2000 } };

/**
 * Leitura PÚBLICA para as telas do salão (MT-BE-08) — sem `JwtAuthGuard`: a TV
 * do clube não faz login, e um token de serviço numa tela pendurada na parede
 * é pior do que rota aberta.
 *
 * O prefixo é `display/tournaments` e não `tournaments/`: o `@Get(':id')` de
 * `TournamentController` é catch-all e engoliria qualquer rota irmã.
 *
 * FRONTEIRA DE CONFIANÇA: nada aqui pode expor `userId`, e-mail, documento ou
 * saldo — só nome, mesa, assento e fichas. Quem monta o payload é
 * `toPublicTournamentTableMapDto`, por lista de permissão.
 *
 * NÃO MIGRADO para `/clubes/:clubeId/...` (CL-BE-06): esta rota não tem
 * sessão de usuário, então não há `user.id` para o `ClubeMembershipGuard`
 * confirmar contra um `:clubeId` — a TV do salão não tem como provar que
 * "pertence" a clube nenhum.
 *
 * RISCO FUTURO (documentado, não resolvido aqui): hoje a aplicação inteira
 * fala com o Postgres pela `DATABASE_URL` do owner `poker`, que BYPASSA RLS
 * — é por isso que esta rota funciona sem clube algum no contexto. No dia em
 * que a conexão migrar para `DATABASE_URL_APP` (role `poker_app`, sujeito às
 * políticas de CL-DB-03 — troca ainda não feita, fora do escopo desta
 * tarefa), toda query aqui vai devolver ZERO linhas: RLS filtra por
 * `app.current_clube_id`, e nada nesta rota chama `withClube` para setá-lo.
 * A correção nesse dia é resolver o `clubeId` a partir do `tournamentId` (um
 * `SELECT clube_id FROM tournaments WHERE id = ...` antes de tudo) e então
 * chamar `PrismaService.withClube(clubeId, ...)` para o resto da leitura —
 * SEM exigir membership, porque esta rota continua pública. Não implementado
 * agora porque não há RLS em produção ainda para quebrar.
 */
@Controller('display/tournaments')
export class TournamentDisplayController {
  constructor(
    private readonly tournamentService: TournamentService,
    private readonly clockService: TournamentClockService,
  ) {}

  // `no-store` (e não `no-cache`): proxy do salão guardando 1s de relógio é
  // exatamente o que faz duas TVs mostrarem tempos diferentes.
  @Get(':id/clock')
  @Throttle(DISPLAY_POLLING_THROTTLE)
  @Header('Cache-Control', 'no-store')
  async getClock(@Param('id') id: string): Promise<TournamentClockDto> {
    return this.clockService.read(id);
  }

  @Get(':id/tables')
  @Throttle(DISPLAY_POLLING_THROTTLE)
  @Header('Cache-Control', 'no-store')
  async getTables(
    @Param('id') id: string,
  ): Promise<PublicTournamentTableMapDto> {
    return this.tournamentService.readPublicTableMap(id);
  }
}
