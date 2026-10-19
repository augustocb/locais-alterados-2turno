// Gera public/dados.json a partir do arquivo do TSE "Seções Eleitorais Alteradas no Segundo Turno".
// Sem dependências: roda com Node 18+ (o mesmo da Vercel).
//
// Entrada:
//   dados/tse/*.csv ou *.csv.zip            arquivo exportado do painel de Capilaridade do TSE (o mais recente é usado)
//   dados/enderecos_locais_1turno.csv.gz    endereços dos locais de votação do 1º turno (já incluído no projeto)
//   dados/municipios.csv                    coordenadas dos municípios (baixado automaticamente se não existir)
// Saída:
//   public/dados.json

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_TSE = path.join(RAIZ, 'dados', 'tse');
const ARQ_ENDERECOS = path.join(RAIZ, 'dados', 'enderecos_locais_1turno.csv.gz');
const ARQ_MUNICIPIOS = path.join(RAIZ, 'dados', 'municipios.csv');
const URL_MUNICIPIOS = 'https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv';
const SAIDA = path.join(RAIZ, 'public', 'dados.json');

const UF_POR_CODIGO = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

// ---------- utilidades ----------
const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

function similaridade(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

function lerCSV(texto, sep) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const campos = (l) => {
    const out = []; let atual = ''; let aspas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (aspas) {
        if (c === '"' && l[i + 1] === '"') { atual += '"'; i++; }
        else if (c === '"') aspas = false;
        else atual += c;
      } else if (c === '"') aspas = true;
      else if (c === sep) { out.push(atual); atual = ''; }
      else atual += c;
    }
    out.push(atual);
    return out;
  };
  const cab = campos(linhas[0]).map((h) => h.trim().toLowerCase());
  return linhas.slice(1).map((l) => {
    const v = campos(l); const o = {};
    cab.forEach((h, i) => { o[h] = (v[i] ?? '').trim(); });
    return o;
  });
}

// Lê o primeiro arquivo de um .zip (formato simples gerado pelo TSE).
function lerZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido: diretório central não encontrado');
  let p = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP inválido');
    const metodo = buf.readUInt16LE(p + 10);
    const hora = buf.readUInt16LE(p + 12), dia = buf.readUInt16LE(p + 14);
    const tamComp = buf.readUInt32LE(p + 20);
    const nLen = buf.readUInt16LE(p + 28), eLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + nLen).toString('latin1');
    p += 46 + nLen + eLen + cLen;
    if (!nome.toLowerCase().endsWith('.csv')) continue;
    const inicio = offLocal + 30 + buf.readUInt16LE(offLocal + 26) + buf.readUInt16LE(offLocal + 28);
    const dadosComp = buf.slice(inicio, inicio + tamComp);
    const conteudo = metodo === 0 ? dadosComp : zlib.inflateRawSync(dadosComp);
    const data = new Date(1980 + (dia >> 9), ((dia >> 5) & 15) - 1, dia & 31, hora >> 11, (hora >> 5) & 63);
    return { nome, conteudo, data };
  }
  throw new Error('Nenhum .csv encontrado dentro do ZIP');
}

function decodificar(buf) {
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? buf.toString('latin1') : utf8; // o TSE costuma usar Latin-1
}

function dataBR(d) {
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

// ---------- 1. arquivo do TSE ----------
function carregarArquivoTSE() {
  const arquivos = fs.existsSync(PASTA_TSE)
    ? fs.readdirSync(PASTA_TSE).filter((f) => /\.(csv|zip)$/i.test(f)).map((f) => {
        const full = path.join(PASTA_TSE, f);
        return { f, full, mtime: fs.statSync(full).mtimeMs };
      })
    : [];
  if (!arquivos.length) throw new Error(`Coloque o arquivo do TSE (.csv ou .csv.zip) em ${PASTA_TSE}`);
  arquivos.sort((a, b) => b.mtime - a.mtime);
  if (arquivos.length > 1) console.warn(`! Há ${arquivos.length} arquivos em dados/tse; usando o mais recente: ${arquivos[0].f}`);
  const { f, full } = arquivos[0];
  const buf = fs.readFileSync(full);
  if (/\.zip$/i.test(f)) {
    const z = lerZip(buf);
    return { nome: f, texto: decodificar(z.conteudo), dataArquivo: z.data };
  }
  return { nome: f, texto: decodificar(buf), dataArquivo: null };
}

// ---------- 2. endereços ----------
function carregarEnderecos() {
  const porZona = new Map(); const porMunicipio = new Map();
  if (!fs.existsSync(ARQ_ENDERECOS)) { console.warn('! Base de endereços não encontrada; a lista sairá sem endereços.'); return { porZona, porMunicipio }; }
  const linhas = lerCSV(zlib.gunzipSync(fs.readFileSync(ARQ_ENDERECOS)).toString('utf8'), ';');
  for (const r of linhas) {
    const base = `${r.uf}|${norm(r.municipio)}|`;
    porZona.set(`${base}${Number(r.zona)}|${norm(r.local)}`, r.endereco);
    const k = `${base}${norm(r.local)}`;
    if (!porMunicipio.has(k)) porMunicipio.set(k, r.endereco);
  }
  return { porZona, porMunicipio };
}

// ---------- 3. coordenadas dos municípios ----------
async function carregarMunicipios() {
  if (!fs.existsSync(ARQ_MUNICIPIOS)) {
    try {
      console.log('Baixando coordenadas dos municípios…');
      const r = await fetch(URL_MUNICIPIOS, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.writeFileSync(ARQ_MUNICIPIOS, await r.text());
    } catch (e) {
      console.warn(`! Não foi possível baixar as coordenadas (${e.message}). O mapa ficará sem pontos.`);
      return new Map();
    }
  }
  const mapa = new Map();
  for (const r of lerCSV(fs.readFileSync(ARQ_MUNICIPIOS, 'utf8'), ',')) {
    const uf = UF_POR_CODIGO[Number(r.codigo_uf)];
    const lat = Number(r.latitude), lon = Number(r.longitude);
    if (!uf || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!mapa.has(uf)) mapa.set(uf, []);
    mapa.get(uf).push({ chave: norm(r.nome), lat, lon });
  }
  return mapa;
}

function acharCoordenada(municipios, uf, nome) {
  const lista = municipios.get(uf); if (!lista) return null;
  const alvo = norm(nome);
  const exato = lista.find((m) => m.chave === alvo);
  if (exato) return exato;
  // nomes abreviados pelo TSE (ex.: "BOM JESUS" → "BOM JESUS DE GOIÁS")
  const prefixo = lista.filter((m) => m.chave.startsWith(`${alvo} `));
  if (prefixo.length === 1) return prefixo[0];
  let melhor = null, nota = 0;
  for (const m of lista) { const s = similaridade(alvo, m.chave); if (s > nota) { nota = s; melhor = m; } }
  return nota >= 0.85 ? melhor : null;
}

// ---------- 4. classificação da mudança ----------
function rua(end) {
  return norm(String(end).replace(/\(.*?\)/g, ''))
    .split(/\b(?:N|NO|NUMERO|S N|SN|KM|COM|BAIRRO)\b|\d/)[0].trim();
}
function tipoMudanca(endDe, endPara) {
  if (!endPara) return 'sem_endereco';
  if (!endDe) return 'endereco_diferente';
  if (norm(endDe) === norm(endPara)) return 'mesmo_endereco';
  const a = rua(endDe), b = rua(endPara);
  if (a.length > 5 && b.length > 5 && similaridade(a, b) >= 0.85) return 'mesma_rua';
  return 'endereco_diferente';
}

// ---------- principal ----------
async function main() {
  const tse = carregarArquivoTSE();
  const linhas = lerCSV(tse.texto, ';');
  const obrig = ['sg_uf', 'nm_municipio', 'nr_zona', 'nr_secao', 'nm_local_votacao_inicial', 'nm_local_votacao_final'];
  const faltando = obrig.filter((c) => !(c in (linhas[0] || {})));
  if (faltando.length) throw new Error(`O arquivo ${tse.nome} não tem as colunas: ${faltando.join(', ')}`);

  const enderecos = carregarEnderecos();
  const municipios = await carregarMunicipios();
  const buscaEnd = (uf, mun, zona, local) =>
    enderecos.porZona.get(`${uf}|${norm(mun)}|${zona}|${norm(local)}`)
    ?? enderecos.porMunicipio.get(`${uf}|${norm(mun)}|${norm(local)}`) ?? null;

  // agrupa por mudança (mesmo local de origem → mesmo destino)
  const grupos = new Map();
  for (const r of linhas) {
    if (r.nm_pais && norm(r.nm_pais) !== 'BRASIL') continue; // exterior não entra no mapa
    const uf = r.sg_uf, zona = Number(r.nr_zona);
    const k = [uf, r.nm_municipio, zona, r.nm_local_votacao_inicial, r.nm_local_votacao_final].join('|');
    if (!grupos.has(k)) {
      grupos.set(k, { uf, municipio: r.nm_municipio, zona, de: r.nm_local_votacao_inicial, para: r.nm_local_votacao_final, secoes: [], eleitores: 0 });
    }
    const g = grupos.get(k);
    g.secoes.push(Number(r.nr_secao));
    g.eleitores += Number(r.qt_eleitores) || 0;
  }

  const semCoord = new Set();
  const munis = new Map();
  const mudancas = [...grupos.values()].map((g) => {
    g.secoes.sort((a, b) => a - b);
    const endDe = buscaEnd(g.uf, g.municipio, g.zona, g.de);
    const endPara = buscaEnd(g.uf, g.municipio, g.zona, g.para);
    const idMun = `${g.uf}|${norm(g.municipio)}`;
    if (!munis.has(idMun)) {
      const c = acharCoordenada(municipios, g.uf, g.municipio);
      if (!c) semCoord.add(`${g.municipio}/${g.uf}`);
      munis.set(idMun, { id: idMun, uf: g.uf, nome: g.municipio, lat: c?.lat ?? null, lon: c?.lon ?? null });
    }
    return { ...g, mun: idMun, endDe, endPara, tipo: tipoMudanca(endDe, endPara) };
  }).sort((a, b) => a.uf.localeCompare(b.uf) || a.municipio.localeCompare(b.municipio, 'pt-BR') || a.zona - b.zona || a.de.localeCompare(b.de, 'pt-BR'));

  const porUF = {};
  for (const m of mudancas) {
    const u = (porUF[m.uf] ??= { uf: m.uf, secoes: 0, eleitores: 0, mudancas: 0, municipios: new Set() });
    u.secoes += m.secoes.length; u.eleitores += m.eleitores; u.mudancas += 1; u.municipios.add(m.mun);
  }
  const resumoUF = Object.values(porUF).map((u) => ({ ...u, municipios: u.municipios.size })).sort((a, b) => b.secoes - a.secoes);

  const saida = {
    geradoEm: dataBR(new Date()),
    arquivo: tse.nome,
    dataArquivo: tse.dataArquivo ? tse.dataArquivo.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null,
    totais: {
      secoes: mudancas.reduce((s, m) => s + m.secoes.length, 0),
      eleitores: mudancas.reduce((s, m) => s + m.eleitores, 0),
      mudancas: mudancas.length,
      municipios: munis.size,
      ufs: resumoUF.length,
    },
    porUF: resumoUF,
    municipios: [...munis.values()],
    mudancas,
  };
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify(saida));

  const t = saida.totais;
  console.log(`✓ ${tse.nome}: ${t.secoes} seções, ${t.mudancas} mudanças de local, ${t.municipios} municípios, ${t.ufs} UFs`);
  console.log(`✓ Endereço do novo local encontrado em ${mudancas.filter((m) => m.endPara).length} de ${mudancas.length} mudanças`);
  if (municipios.size && semCoord.size) {
    const lista = [...semCoord];
    console.warn(`! ${lista.length} município(s) sem coordenadas (ficam fora do mapa, mas aparecem na lista): ${lista.slice(0, 20).join(', ')}${lista.length > 20 ? '…' : ''}`);
  }
  console.log(`✓ Gerado ${path.relative(RAIZ, SAIDA)} (${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
