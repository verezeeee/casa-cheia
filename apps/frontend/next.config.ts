import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Gera `.next/standalone` — um servidor Node self-contido (só os arquivos
  // e dependências de produção realmente usados, via tracing do próprio
  // Next), que é o que o Dockerfile copia pro estágio de runtime. Sem isso,
  // a imagem final precisaria do `node_modules` inteiro do monorepo.
  output: 'standalone',
};

export default nextConfig;
