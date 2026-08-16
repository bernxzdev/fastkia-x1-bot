const supabase = require('./supabase');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CORES } = require('./helpers');

async function getTorneioAtivo(guildId) {
  const { data } = await supabase
    .from('x1_torneios')
    .select('*')
    .eq('guild_id', guildId)
    .in('status', ['inscricoes', 'andamento'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function getInscritos(torneioId) {
  const { data } = await supabase
    .from('x1_inscritos')
    .select('*')
    .eq('torneio_id', torneioId)
    .order('created_at', { ascending: true });
  return data || [];
}

function embaralhar(array) {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function buildInscricoesEmbed(torneio, inscritos) {
  const lista = inscritos.length
    ? inscritos.map((p, i) => `${i + 1}. ${p.username}`).join('\n')
    : 'Nenhum inscrito ainda.';

  return new EmbedBuilder()
    .setColor(CORES.principal)
    .setTitle(`🎮 Inscrições abertas — ${torneio.nome}`)
    .setDescription('Clique no botão abaixo para entrar no campeonato de x1!')
    .addFields({ name: `Inscritos (${inscritos.length})`, value: lista })
    .setFooter({ text: 'Fastkia X1' })
    .setTimestamp();
}

function buildInscricoesRow(torneioId, encerrado = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`entrar_x1_${torneioId}`)
      .setLabel(encerrado ? 'Inscrições encerradas' : '✅ Entrar no campeonato')
      .setStyle(encerrado ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(encerrado)
  );
}

// Gera as partidas de uma rodada a partir de uma lista de jogadores [{id, username}]
async function criarPartidasRodada(torneioId, rodada, jogadores) {
  const lista = rodada === 1 ? embaralhar(jogadores) : jogadores;
  const partidas = [];

  for (let i = 0; i < lista.length; i += 2) {
    const j1 = lista[i];
    const j2 = lista[i + 1] || null;

    partidas.push({
      torneio_id: torneioId,
      rodada,
      jogador1_id: j1.id,
      jogador1_username: j1.username,
      jogador2_id: j2 ? j2.id : null,
      jogador2_username: j2 ? j2.username : null,
      bye: !j2,
      vencedor_id: !j2 ? j1.id : null,
      vencedor_username: !j2 ? j1.username : null,
    });
  }

  await supabase.from('x1_partidas').insert(partidas);
}

async function getPartidasRodada(torneioId, rodada) {
  const { data } = await supabase
    .from('x1_partidas')
    .select('*')
    .eq('torneio_id', torneioId)
    .eq('rodada', rodada)
    .order('id', { ascending: true });
  return data || [];
}

async function getTodasPartidas(torneioId) {
  const { data } = await supabase
    .from('x1_partidas')
    .select('*')
    .eq('torneio_id', torneioId)
    .order('rodada', { ascending: true })
    .order('id', { ascending: true });
  return data || [];
}

// Verifica se a rodada terminou; se sim, gera a próxima ou finaliza o torneio
async function verificarEAvancarRodada(torneioId, rodadaAtual) {
  const partidas = await getPartidasRodada(torneioId, rodadaAtual);
  const pendentes = partidas.filter(p => !p.vencedor_id);
  if (pendentes.length > 0) return { avancou: false };

  if (partidas.length === 1) {
    await supabase.from('x1_torneios').update({ status: 'finalizado' }).eq('id', torneioId);
    return { avancou: false, finalizado: true, vencedor: partidas[0] };
  }

  const vencedores = partidas.map(p => ({ id: p.vencedor_id, username: p.vencedor_username }));
  const novaRodada = rodadaAtual + 1;
  await criarPartidasRodada(torneioId, novaRodada, vencedores);

  return { avancou: true, novaRodada };
}

function buildChaveamentoEmbed(torneio, partidasPorRodada) {
  const embed = new EmbedBuilder()
    .setColor(CORES.info)
    .setTitle(`🥊 Chaveamento — ${torneio.nome}`)
    .setFooter({ text: 'Fastkia X1' })
    .setTimestamp();

  const rodadas = Object.keys(partidasPorRodada).sort((a, b) => a - b);

  for (const rodada of rodadas) {
    const texto = partidasPorRodada[rodada].map(p => {
      if (p.bye) return `🔹 ${p.jogador1_username} passou direto (bye)`;
      if (p.vencedor_id) {
        return `✅ **${p.jogador1_username}** ${p.placar1 ?? '?'} x ${p.placar2 ?? '?'} **${p.jogador2_username}** — venceu: **${p.vencedor_username}**`;
      }
      return `⏳ ${p.jogador1_username} vs ${p.jogador2_username} (aguardando placar)`;
    }).join('\n');

    embed.addFields({ name: `Rodada ${rodada}`, value: texto || 'Sem partidas.' });
  }

  return embed;
}

async function registrarCampeao(torneio, partidaFinal) {
  await supabase.from('x1_wins').insert({
    guild_id: torneio.guild_id,
    user_id: partidaFinal.vencedor_id,
    username: partidaFinal.vencedor_username,
    campeonato: torneio.nome,
    registered_by: 'Fastkia X1 (automático)',
  });
}

module.exports = {
  getTorneioAtivo,
  getInscritos,
  buildInscricoesEmbed,
  buildInscricoesRow,
  criarPartidasRodada,
  getPartidasRodada,
  getTodasPartidas,
  verificarEAvancarRodada,
  buildChaveamentoEmbed,
  registrarCampeao,
};
