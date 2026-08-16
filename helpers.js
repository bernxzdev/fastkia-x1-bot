const { EmbedBuilder } = require('discord.js');

const CORES = {
  ouro: 0xffd700,
  principal: 0xffcc00,
  info: 0x00b0f4,
  perfil: 0x9b59b6,
  erro: 0xe74c3c,
  sucesso: 0x2ecc71,
};

const MEDALHAS = ['🥇', '🥈', '🥉'];

function medalhaOuIndice(pos) {
  return MEDALHAS[pos] || `\`${pos + 1}.\``;
}

function baseEmbed(cor) {
  return new EmbedBuilder()
    .setColor(cor)
    .setFooter({ text: 'Fastkia X1' })
    .setTimestamp();
}

function buildRankingPageEmbed(ranking, page, totalPages, totalJogadores) {
  const inicio = page * 10;
  const pagina = ranking.slice(inicio, inicio + 10);

  const descricao = pagina
    .map((r, i) => {
      const pos = inicio + i;
      const titulo = r.total === 1 ? 'título' : 'títulos';
      return `${medalhaOuIndice(pos)} **${r.username}** — ${r.total} ${titulo}`;
    })
    .join('\n');

  return baseEmbed(CORES.principal)
    .setTitle('📊 Ranking Fastkia X1')
    .setDescription(descricao || 'Sem dados nesta página.')
    .setFooter({ text: `Fastkia X1 • Página ${page + 1}/${totalPages} • ${totalJogadores} jogador(es) no total` });
}

module.exports = { CORES, MEDALHAS, medalhaOuIndice, baseEmbed, buildRankingPageEmbed };
