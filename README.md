# Simulador MFV

Aplicação web para criar, comparar e imprimir cenários de Mapeamento de Fluxo de Valor (MFV).

## Recursos

- Estado atual como base sincronizada para vários cenários futuros, sem retorno das alterações
- Cadastro de processos, tempos, setup, lote, operadores, disponibilidade, qualidade, estoques e esperas
- Cálculo de takt time, capacidade efetiva, gargalo, perdas acumuladas e lead time
- Sequência do fluxo definida pelas setas de material (empurrado, físico, transporte e puxado), com a posição no mapa como alternativa
- Cenários rápidos de demanda, setup, disponibilidade, qualidade e recurso no gargalo
- Comparação Estado Atual × Estados Futuros com deltas de capacidade, atravessamento, WIP, operadores, qualidade e carga máxima
- Execução visual do fluxo com caixas em movimento, carregamento de caminhões, filas, WIP e orientação de gargalos
- Teste de estresse do Estado Futuro com turnos, intervalos, falha por processo, atraso de fornecedor e transporte, além de filas, bloqueios e identificação do momento da ruptura
- Biblioteca de símbolos e fluxos inspirada no padrão visual das planilhas MFV
- Fabricação por lotes por processo, com lote de produção, lote de transferência, atraso no lead time e efeito no teste de estresse
- Salvamento local no navegador, com aviso quando o armazenamento está cheio
- Projeto completo em arquivo .json para backup, troca entre computadores e envio a outras pessoas
- Relatório preparado para impressão ou PDF
- Testes automatizados do motor de cálculo, da ordem do fluxo, da fabricação por lotes, do motor de estresse e da sincronização unilateral entre Estado Atual e Estado Futuro
- Manual integrado em oito passos, exibido na primeira visita e sempre acessível pela sidebar

## Desenvolvimento

```bash
pnpm install
pnpm run dev
```

Para validar a versão de produção:

```bash
pnpm run typecheck
pnpm test
pnpm run build
```
