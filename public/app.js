(() => {
  'use strict';

  const NOMES_UF = {
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
    ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
    PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
    RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
  };
  // posição aproximada de cada estado numa grade 7 × 8 (coluna, linha)
  const GRADE = {
    RR: [2, 0], AP: [3, 0],
    AC: [0, 1], AM: [1, 1], PA: [2, 1], MA: [3, 1], CE: [4, 1], RN: [5, 1],
    RO: [1, 2], TO: [2, 2], PI: [3, 2], PE: [4, 2], PB: [5, 2],
    MT: [1, 3], GO: [2, 3], BA: [3, 3], SE: [4, 3], AL: [5, 3],
    MS: [1, 4], DF: [2, 4], MG: [3, 4], ES: [4, 4],
    PR: [1, 5], SP: [2, 5], RJ: [3, 5],
    SC: [1, 6],
    RS: [1, 7],
  };
  const TIPOS = {
    endereco_diferente: { rotulo: 'Outro endereço', classe: 'selo-diferente' },
    sem_endereco: { rotulo: 'Novo local', classe: 'selo-sem' },
    mesma_rua: { rotulo: 'Mesmo endereço ou rua', classe: 'selo-mesma' },
  };
  const POR_PAGINA = 40;

  const $ = (s) => document.querySelector(s);
  const fmt = new Intl.NumberFormat('pt-BR');
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const titulo = (s) => String(s).toLowerCase().replace(/(^|[\s\-'(/])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());
  const el = (tag, attrs = {}, ...filhos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f != null) n.append(f.nodeType ? f : document.createTextNode(f));
    return n;
  };
  const listaSecoes = (s) => (s.length > 12 ? `${s.slice(0, 12).join(', ')} e mais ${s.length - 12}` : s.join(', '));

  const estado = { q: '', uf: '', ocultarMesma: false, limite: POR_PAGINA };
  let dados, filtradas = [], mapa = null, camada = null, municipiosPorId = new Map();

  // ---------- estado na URL (para compartilhar um filtro) ----------
  function lerURL() {
    const p = new URLSearchParams(location.hash.slice(1));
    estado.q = p.get('q') || '';
    estado.uf = (p.get('uf') || '').toUpperCase();
    estado.ocultarMesma = p.get('ocultar') === '1';
  }
  function gravarURL() {
    const p = new URLSearchParams();
    if (estado.q) p.set('q', estado.q);
    if (estado.uf) p.set('uf', estado.uf);
    if (estado.ocultarMesma) p.set('ocultar', '1');
    const h = p.toString();
    history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  }

  // ---------- topo ----------
  function renderTopo() {
    const t = dados.totais;
    const data = dados.dataArquivo ? `arquivo do TSE de ${dados.dataArquivo}` : 'dados do TSE';
    $('#carimbo').textContent = `Atualizado em ${dados.geradoEm} · ${data}`;
    $('#rodape-arquivo').textContent = `Arquivo processado: ${dados.arquivo} · gerado em ${dados.geradoEm}`;
    const kpis = [
      [t.secoes, 'seções mudaram de local'],
      [t.eleitores, 'eleitores afetados'],
      [t.mudancas, 'locais de votação trocados'],
      [t.municipios, 'municípios'],
      [t.ufs, t.ufs === 1 ? 'estado' : 'estados'],
    ];
    $('#kpis').replaceChildren(...kpis.map(([v, r]) => el('div', { class: 'kpi' },
      el('span', { class: 'kpi-valor', text: fmt.format(v) }), el('span', { class: 'kpi-rotulo', text: r }))));
  }

  // ---------- estados ----------
  function nivel(v, max) { return v ? Math.max(1, Math.ceil(5 * Math.sqrt(v / max))) : 0; }

  function renderEstados() {
    const porUF = Object.fromEntries(dados.porUF.map((u) => [u.uf, u]));
    const max = Math.max(1, ...dados.porUF.map((u) => u.secoes));

    $('#grade-uf').replaceChildren(...Object.entries(GRADE).map(([uf, [c, l]]) => {
      const u = porUF[uf];
      const v = u ? u.secoes : 0;
      const b = el('button', {
        class: 'uf', type: 'button', 'data-uf': uf, 'data-nivel': nivel(v, max),
        style: `grid-column:${c + 1};grid-row:${l + 1}`,
        'aria-pressed': String(estado.uf === uf),
        'aria-label': `${NOMES_UF[uf]}: ${v ? `${fmt.format(v)} seções alteradas` : 'nenhuma alteração'}`,
        title: `${NOMES_UF[uf]}: ${v ? `${fmt.format(v)} seções · ${fmt.format(u.eleitores)} eleitores` : 'nenhuma alteração'}`,
        disabled: !v,
        onclick: () => alternarUF(uf),
      }, el('b', { text: uf }), el('span', { text: v ? fmt.format(v) : '—' }));
      return b;
    }));

    $('#barras').replaceChildren(...dados.porUF.map((u) => el('li', {},
      el('button', {
        class: 'barra', type: 'button', 'data-uf': u.uf, 'aria-pressed': String(estado.uf === u.uf),
        title: `${NOMES_UF[u.uf]}: ${fmt.format(u.secoes)} seções em ${fmt.format(u.municipios)} município(s), ${fmt.format(u.eleitores)} eleitores`,
        onclick: () => alternarUF(u.uf),
      },
      el('span', { class: 'barra-uf', text: u.uf }),
      el('span', { class: 'barra-trilho' }, el('span', { class: 'barra-preenchido', style: `width:${(100 * u.secoes / max).toFixed(1)}%` })),
      el('span', { class: 'barra-num' }, fmt.format(u.secoes), el('small', { text: ` · ${fmt.format(u.eleitores)} eleit.` }))))));

    const semAlteracao = Object.keys(GRADE).filter((uf) => !porUF[uf]);
    $('#legenda').replaceChildren(
      el('span', { class: 'legenda-escala' }, 'menos ', ...[1, 2, 3, 4, 5].map((n) => el('i', { style: `background:var(--escala-${n})` })), ' mais seções'),
      el('span', { class: 'legenda-escala' }, el('i', { style: 'background:var(--vazio)' }), ' sem alteração na lista'),
      semAlteracao.length ? el('span', { text: `Sem alterações: ${semAlteracao.join(', ')}` }) : null,
    );

    const sel = $('#filtro-uf');
    sel.replaceChildren(el('option', { value: '', text: 'Todos os estados' }),
      ...dados.porUF.slice().sort((a, b) => NOMES_UF[a.uf].localeCompare(NOMES_UF[b.uf], 'pt-BR'))
        .map((u) => el('option', { value: u.uf, text: `${NOMES_UF[u.uf]} (${fmt.format(u.secoes)})` })));
  }

  function marcarUFsAtivas() {
    document.querySelectorAll('[data-uf]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.uf === estado.uf)));
    $('#filtro-uf').value = estado.uf;
  }

  function alternarUF(uf) {
    estado.uf = estado.uf === uf ? '' : uf;
    aplicar({ ajustarMapa: true });
    if (estado.uf) document.querySelector('.explorar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- filtro ----------
  function preparar() {
    for (const m of dados.mudancas) {
      m._texto = ` ${norm([m.municipio, m.uf, NOMES_UF[m.uf], m.de, m.para, m.endDe, m.endPara].join(' '))} `;
      m._nums = new Set([String(m.zona), ...m.secoes.map(String)]);
    }
    municipiosPorId = new Map(dados.municipios.map((x) => [x.id, x]));
  }

  function filtrar() {
    const termos = norm(estado.q).split(' ').filter(Boolean);
    return dados.mudancas.filter((m) => {
      if (estado.uf && m.uf !== estado.uf) return false;
      if (estado.ocultarMesma && m.tipo === 'mesma_rua') return false;
      return termos.every((t) => (/^\d+$/.test(t) ? m._nums.has(String(Number(t))) || m._texto.includes(` ${t} `) : m._texto.includes(t)));
    });
  }

  function aplicar({ ajustarMapa = false, manterLimite = false } = {}) {
    if (!manterLimite) estado.limite = POR_PAGINA;
    filtradas = filtrar();
    marcarUFsAtivas();
    $('#busca').value !== estado.q && ($('#busca').value = estado.q);
    $('#ocultar-mesma-rua').checked = estado.ocultarMesma;
    $('#limpar').hidden = !(estado.q || estado.uf || estado.ocultarMesma);
    gravarURL();
    renderLista();
    renderMapa(ajustarMapa);
  }

  // ---------- lista ----------
  function itemLista(m) {
    const tipo = TIPOS[m.tipo] || TIPOS.sem_endereco;
    const end = (txt, vazio) => el('span', { class: `local-end${txt ? '' : ' vazio'}`, text: txt ? titulo(txt) : vazio });
    return el('li', { class: 'item' },
      el('div', { class: 'item-cab' },
        el('span', { class: 'item-cidade', text: `${titulo(m.municipio)} · ${m.uf}` }),
        el('span', { class: 'item-meta', text: `Zona ${m.zona}` }),
        el('span', { class: `selo ${tipo.classe}`, text: tipo.rotulo })),
      el('div', { class: 'trajeto' },
        el('div', { class: 'ponto de', 'aria-hidden': 'true' }, el('i')),
        el('div', { class: 'local de' },
          el('span', { class: 'local-rotulo', text: 'Votava em' }),
          el('span', { class: 'local-nome', text: titulo(m.de) }),
          end(m.endDe, 'Endereço não informado')),
        el('div', { class: 'ponto para', 'aria-hidden': 'true' }, el('i')),
        el('div', { class: 'local para' },
          el('span', { class: 'local-rotulo', text: 'Vai votar em' }),
          el('span', { class: 'local-nome', text: titulo(m.para) }),
          end(m.endPara, 'Endereço não informado: o local não funcionou no 1º turno'))),
      el('div', { class: 'item-rodape' },
        el('span', {}, m.secoes.length === 1 ? 'Seção ' : 'Seções ', el('strong', { text: listaSecoes(m.secoes) })),
        el('span', {}, el('strong', { text: fmt.format(m.eleitores) }), ' eleitores')));
  }

  function renderLista() {
    const total = filtradas.length;
    const secoes = filtradas.reduce((s, m) => s + m.secoes.length, 0);
    const eleit = filtradas.reduce((s, m) => s + m.eleitores, 0);
    const filtro = estado.uf ? `${NOMES_UF[estado.uf]}: ` : '';
    $('#contagem').textContent = total
      ? `${filtro}${fmt.format(total)} ${total === 1 ? 'troca de local' : 'trocas de local'} · ${fmt.format(secoes)} ${secoes === 1 ? 'seção' : 'seções'} · ${fmt.format(eleit)} ${eleit === 1 ? 'eleitor' : 'eleitores'}`
      : '';
    const visiveis = filtradas.slice(0, estado.limite);
    $('#lista').replaceChildren(...(total
      ? visiveis.map(itemLista)
      : [el('li', { class: 'vazio-msg' },
          'Nenhuma seção alterada encontrada com esse filtro. ',
          el('br'), 'Se a sua seção não aparece aqui, ela provavelmente continua no mesmo local, mas confirme no TSE.')]));
    const resto = total - visiveis.length;
    $('#mais').hidden = resto <= 0;
    $('#mais').textContent = `Mostrar mais (${fmt.format(resto)} restantes)`;
  }

  // ---------- mapa ----------
  function iniciarMapa() {
    const aviso = $('#mapa-aviso');
    if (typeof window.L === 'undefined') {
      aviso.hidden = false; aviso.textContent = 'Não foi possível carregar o mapa. A lista abaixo continua funcionando.';
      return;
    }
    const temCoord = dados.municipios.some((m) => m.lat != null);
    if (!temCoord) { aviso.hidden = false; aviso.textContent = 'As coordenadas dos municípios não estão disponíveis nesta versão dos dados.'; }

    mapa = L.map('mapa', { scrollWheelZoom: false, zoomSnap: 0.5, attributionControl: true }).fitBounds([[-33.8, -73.9], [5.3, -34.8]]);
    const escuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/${escuro ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
      subdomains: 'abcd', maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(mapa);
    camada = L.layerGroup().addTo(mapa);
    mapa.on('focus', () => mapa.scrollWheelZoom.enable());
    mapa.on('blur', () => mapa.scrollWheelZoom.disable());
  }

  function popup(mun, lista) {
    const secoes = lista.reduce((s, m) => s + m.secoes.length, 0);
    const eleit = lista.reduce((s, m) => s + m.eleitores, 0);
    const mostrar = lista.slice(0, 5);
    return el('div', {},
      el('div', { class: 'pop-titulo', text: `${titulo(mun.nome)} · ${mun.uf}` }),
      el('div', { class: 'pop-sub', text: `${fmt.format(secoes)} ${secoes === 1 ? 'seção' : 'seções'} · ${fmt.format(eleit)} eleitores` }),
      el('ul', { class: 'pop-lista' },
        ...mostrar.map((m) => el('li', { text: `${titulo(m.de)} → ${titulo(m.para)}` })),
        lista.length > mostrar.length ? el('li', { text: `e mais ${lista.length - mostrar.length}…` }) : null),
      el('button', {
        class: 'pop-botao', type: 'button',
        onclick: () => {
          estado.uf = mun.uf; estado.q = mun.nome; aplicar();
          $('#lista').scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }, 'Ver na lista'));
  }

  function renderMapa(ajustar) {
    if (!mapa) return;
    camada.clearLayers();
    const grupos = new Map();
    for (const m of filtradas) { if (!grupos.has(m.mun)) grupos.set(m.mun, []); grupos.get(m.mun).push(m); }
    const pontos = [];
    const cor = getComputedStyle(document.documentElement).getPropertyValue('--destaque').trim() || '#c2410c';
    for (const [id, lista] of grupos) {
      const mun = municipiosPorId.get(id);
      if (!mun || mun.lat == null) continue;
      const secoes = lista.reduce((s, m) => s + m.secoes.length, 0);
      const r = Math.min(26, 5 + Math.sqrt(secoes) * 2.4);
      L.circleMarker([mun.lat, mun.lon], { radius: r, color: '#ffffff', weight: 1.5, fillColor: cor, fillOpacity: 0.78 })
        .bindTooltip(`${titulo(mun.nome)} · ${mun.uf}: ${fmt.format(secoes)} ${secoes === 1 ? 'seção' : 'seções'}`, { direction: 'top' })
        .bindPopup(() => popup(mun, lista), { maxWidth: 300 })
        .addTo(camada);
      pontos.push([mun.lat, mun.lon]);
    }
    if (ajustar) {
      if (pontos.length) mapa.fitBounds(L.latLngBounds(pontos).pad(0.25), { maxZoom: 9 });
      else mapa.fitBounds([[-33.8, -73.9], [5.3, -34.8]]);
    }
  }

  // ---------- eventos ----------
  function ligar() {
    let t;
    $('#busca').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { estado.q = e.target.value; aplicar({ ajustarMapa: true }); }, 180);
    });
    $('#filtro-uf').addEventListener('change', (e) => { estado.uf = e.target.value; aplicar({ ajustarMapa: true }); });
    $('#ocultar-mesma-rua').addEventListener('change', (e) => { estado.ocultarMesma = e.target.checked; aplicar(); });
    $('#limpar').addEventListener('click', () => { estado.q = ''; estado.uf = ''; estado.ocultarMesma = false; aplicar({ ajustarMapa: true }); });
    $('#mais').addEventListener('click', () => { estado.limite += POR_PAGINA * 2; aplicar({ manterLimite: true }); });
  }

  async function iniciar() {
    try {
      const r = await fetch(`dados.json?v=${Date.now().toString(36).slice(0, -4)}`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      dados = await r.json();
    } catch (e) {
      $('#carimbo').textContent = 'Não foi possível carregar os dados. Tente recarregar a página.';
      return;
    }
    lerURL();
    preparar();
    renderTopo();
    renderEstados();
    iniciarMapa();
    ligar();
    aplicar({ ajustarMapa: Boolean(estado.uf || estado.q) });
  }

  iniciar();
})();
