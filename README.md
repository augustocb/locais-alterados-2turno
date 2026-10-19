# Locais de votação alterados · 2º turno 2026

Página estática com mapa, resumo por estado e lista pesquisável das seções eleitorais que vão votar em outro local no 2º turno, a partir do arquivo publicado pelo TSE.

Não usa banco de dados. Um script transforma o CSV do TSE em `public/dados.json`, e a página lê esse arquivo.

## Estrutura

```
dados/
  tse/                              ← coloque aqui o arquivo do TSE (.csv ou .csv.zip)
  enderecos_locais_1turno.csv.gz    endereços dos locais de votação (1º turno)
  municipios.csv                    coordenadas dos municípios (baixado no 1º build)
scripts/gerar-dados.mjs             gera public/dados.json (Node 18+, sem dependências)
public/                             o site: index.html, styles.css, app.js, dados.json
vercel.json                         diz à Vercel para rodar o script e publicar a pasta public
```

## Publicar na Vercel (uma vez)

1. Crie um repositório no GitHub e envie esta pasta inteira.
2. Na Vercel: **Add New → Project**, importe o repositório e clique em **Deploy**. As configurações já estão em `vercel.json`, então não é preciso mudar nada.
3. No build, a Vercel baixa as coordenadas dos municípios e gera o `dados.json`. O log mostra um resumo, por exemplo: `✓ 1106 seções, 343 mudanças de local, 201 municípios, 23 UFs`.

## Atualizar os dados (todo dia)

1. No painel de Capilaridade do TSE (sig.tse.jus.br → Eleitorado da eleição → Capilaridade → Seções Eleitorais Alteradas no Segundo Turno), exporte a lista do país inteiro.
2. Substitua o arquivo em `dados/tse/`. Pode ser o `.zip` como vem do TSE. Se houver mais de um arquivo na pasta, o script usa o mais recente.
3. Faça commit e push. A Vercel publica a versão nova sozinha em cerca de 1 minuto.

Para conferir antes de publicar: `npm run build` (precisa do Node 18 ou mais novo) e abra `public/index.html` com um servidor local (`npm run dev`).

## Detalhes

- **Pontos do mapa:** ficam no centro de cada município (coordenadas da base pública [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros)), com tamanho proporcional ao número de seções. Depois do primeiro `npm run build` local, faça commit de `dados/municipios.csv` para o build não depender do download.
- **Endereços:** vêm dos dados de votação por seção do 1º turno (TSE). Um local que não funcionou no 1º turno aparece como “endereço não informado”.
- **Tipo de mudança:** “Mesmo endereço”, “Mesma rua”, “Outro endereço” ou “Novo local” (sem endereço para comparar), definido pela comparação do texto dos endereços.
- **Mapa base:** OpenStreetMap (sem chave; exige manter a atribuição). A política de uso do OSM não permite tráfego muito alto: se o site passar de dezenas de milhares de visitas por dia, troque a URL dos tiles em `public/app.js` por um provedor com chave (MapTiler, Stadia, CARTO).
- **Filtros compartilháveis:** a busca e o estado ficam no endereço da página (ex.: `.../#uf=BA&q=jequie`).
- Esta página é independente e não oficial. A orientação ao eleitor é sempre confirmar no Autoatendimento Eleitoral do TSE ou no e-Título.
