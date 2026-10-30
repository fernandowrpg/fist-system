# FIST: Ultra Edition — sistema para Foundry VTT (v13 / v14)

Sistema não oficial para **FIST: Ultra Edition**, o RPG de mercenários paranormais da CLAYMORE.

## Instalação
No Foundry, em **Game Systems → Install System**, cole a URL do manifest:

```
https://github.com/fernandowrpg/fist-system/releases/latest/download/system.json
```

Ou baixe `fist.zip` da [última release](https://github.com/fernandowrpg/fist-system/releases/latest) e extraia em `Data/systems/fist`.

## O que vem
- **Ficha de operativo** no estilo do "Operative Profile" do livro, com abas Criação / Dossiê / Arsenal / Arquivo.
- **Assistente de criação passo a passo** (5 etapas do livro) + botão *Merc aleatório* (como o fistref.com).
- **Compendiums arrastáveis** que alteram a ficha sozinhos: 216 traits (atributos, MAX HP, ARMOR, WAR DICE e item concedido já equipado), 36 roles, armas/armaduras, 36 tags de arma, itens e gadgets CYCLOPS, 79 inimigos/NPCs prontos, 36 veículos, 4 operativos de exemplo, 14 tabelas roláveis e um manual.
- Rolagens 2D6 + atributo com faixas falha/parcial/sucesso/ultra, vantagem, ajuda, 3D6 melhores/piores dois, WAR DICE (qualquer jogador pode gastar no rolar de outro pelo cartão do chat), dano com/sem ARMOR.
- Nova missão, Rendezvous, Avanço, Inserção de emergência, CHOKE, regras opcionais (munição, war dice explosivos, sudden death, carga).
- Terminal **FIST R.E.F.** (botão na aba Atores) com os geradores e as tabelas.
- **Sim, mas...** para o referee: nos sucessos parciais (7-9) o cartão de rolagem ganha um botão (só o referee vê) que abre a tabela de sucessos parciais do marcador de página (D66, ou 1D6 por categoria, ou escolha direta). Também na aba Atores e via `game.fist.partialSuccess()`; há ainda a RollTable *Partial successes: Yes, but... (D66)* no compêndio de tabelas.
- Interface em pt-BR e inglês.

## Desenvolvimento
Os compendiums são gerados a partir de `src/` (a pasta `packs/` não é versionada):

```
npm install
npm run build:packs
```

## Releases automáticas
Aumente `version` em `system.json` e faça push na `main`. O workflow [Release](.github/workflows/release.yml) gera os packs, empacota `fist.zip` e publica a release `vX.Y.Z` com o `system.json` (manifest) e o zip.

Veja `LICENSE.txt` (texto das regras CC BY-SA 4.0).
