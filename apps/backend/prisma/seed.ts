import { PrismaClient } from '../src/generated/prisma';
import * as argon2 from 'argon2';

import { ARGON2_OPTIONS } from '../src/common/crypto/password-hasher.service';

/**
 * Seed de desenvolvimento (`pnpm --filter @poker-system/backend db:seed`).
 *
 * Cria o mínimo para o ambiente local sair do zero DEPOIS da multi-tenancy
 * (CL-DB-01): um clube, um usuário e o vínculo ADMIN entre os dois. Sem o
 * clube não há nada a semear — mesa, torneio e carteira têm `clube_id` NOT
 * NULL e não existem fora de um tenant.
 *
 * IDEMPOTENTE por construção: todo `upsert` usa a chave NATURAL do registro
 * (documento do clube, e-mail do usuário, o par clube+usuário), nunca um id
 * sorteado. Rodar duas vezes converge para o mesmo estado em vez de estourar
 * em unique violation ou duplicar o clube.
 *
 * NÃO cria mesas nem torneios: são dado operacional, e um clube recém-criado
 * legitimamente não tem nenhum. Quem precisar deles no ambiente local os cria
 * pela API, que é o caminho que valida as regras de negócio.
 */
const prisma = new PrismaClient();

/** Documento fictício do clube de desenvolvimento (somente dígitos). */
const SEED_CLUBE_DOCUMENT = '00000000000191';
const SEED_ADMIN_EMAIL = 'admin@casacheia.dev';

/**
 * Senha do usuário seed. Configurável por ambiente para que o seed também
 * sirva a um staging; o default só existe para o `docker compose up` local.
 * Este seed nunca deve ser executado em produção.
 */
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';

async function main(): Promise<void> {
  const clube = await prisma.clube.upsert({
    where: { document: SEED_CLUBE_DOCUMENT },
    update: {},
    create: {
      name: 'Clube Casa Cheia (dev)',
      document: SEED_CLUBE_DOCUMENT,
    },
  });

  // O e-mail é normalizado (trim + lowercase) pela CAMADA DE APLICAÇÃO — o
  // banco compara `text` case-sensitive (ver nota em identity.prisma). Como o
  // seed escreve direto no banco, a constante já vem normalizada.
  const passwordHash = await argon2.hash(SEED_ADMIN_PASSWORD, ARGON2_OPTIONS);

  const admin = await prisma.user.upsert({
    where: { email: SEED_ADMIN_EMAIL },
    // `update` vazio de propósito: reexecutar o seed não pode RESETAR a senha
    // de um usuário que já existe no ambiente.
    update: {},
    create: {
      email: SEED_ADMIN_EMAIL,
      passwordHash,
      name: 'Administrador do Clube',
      emailVerifiedAt: new Date(),
    },
  });

  // O papel vive na ARESTA usuário↔clube, não no usuário (o antigo
  // `User.role` foi removido nesta onda).
  await prisma.clubeMembership.upsert({
    where: { clubeId_userId: { clubeId: clube.id, userId: admin.id } },
    update: { role: 'ADMIN', status: 'ACTIVE' },
    create: { clubeId: clube.id, userId: admin.id, role: 'ADMIN' },
  });

  // Carteira do admin NESTE clube. Saldo não atravessa clube: a chave é o par
  // (usuário, clube), não o usuário sozinho.
  await prisma.wallet.upsert({
    where: { userId_clubeId: { userId: admin.id, clubeId: clube.id } },
    // Nunca sobrescreve `balance`: o saldo é derivado do ledger e um seed que
    // o zerasse quebraria a invariante SUM(transactions) == balance.
    update: {},
    create: { userId: admin.id, clubeId: clube.id },
  });

  console.log(`Clube:   ${clube.name} (${clube.id})`);
  console.log(`Admin:   ${admin.email} / ${SEED_ADMIN_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    // Sai com código não-zero para que `db:seed` falhe de verdade no CI/script
    // em vez de fingir sucesso.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
