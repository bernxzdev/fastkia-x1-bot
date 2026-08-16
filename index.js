const express = require('express');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
} = require('discord.js');
const supabase = require('./supabase');
const { CORES, buildRankingPageEmbed, medalhaOuIndice } = require('./helpers');
const {
  getTorneioAtivo,
  getInscritos,
  buildInscricoesEmbed,
  buildInscricoesRow,
  criarPartidasRodada,
  getTodasPartidas,
  verificarEAvancarRodada,
  buildChaveamentoEmbed,
  registrarCampeao,
} = require('./torneios');
require('dotenv').config();

// ---------- servidor HTTP de keep-alive (Render Free + UptimeRobot) ----------

const app = express();
app.get('/', (req, res) => res.send('Fastkia X1 está online 🏆'));
app.listen(process.env.PORT || 3000, () => console.log('Servidor HTTP de keep-alive rodando'));

// ---------- cliente Discord ----------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Fastkia X1 online como ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'duelos de X1 ⚽', type: ActivityType.Watching }],
    status: 'online',
  });
});

// ---------- helpers de ranking geral ----------

async function buscarRanking(guildId) {
  const { data, error } = await supabase
    .from('x1_wins')
    .select('user_id, username')
    .eq('guild_id', guildId);

  if (error || !data) return [];

  const contagem = {};
  for (const row of data) {
    if (!contagem[row.user_id]) {
      contagem[row.user_id] = { user_id: row.user_id, username: row.username, total: 0 };
    }
    contagem[row.user_id].total++;
  }

  return Object.values(contagem).sort((a, b) => b.total - a.total);
}

function rowRanking(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ranking_prev_${page}`)
      .setLabel('◀ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`ranking_next_${page}`)
      .setLabel('Próxima ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page + 1 >= totalPages)
  );
}

async function avancarAteTravar(torneioId, rodadaInicial) {
  let resultado = await verificarEAvancarRodada(torneioId, rodadaInicial);
  while (resultado.avancou) {
    resultado = await verificarEAvancarRodada(torneioId, resultado.novaRodada);
  }
  return resultado;
}

// ---------- autocomplete ----------

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  const { commandName } = interaction;
  const focused = interaction.options.getFocused(true);

  if (commandName === 'placar' && focused.name === 'partida') {
    const torneio = await getTorneioAtivo(interaction.guildId);
    if (!torneio) return interaction.respond([]);

    const { data } = await supabase
      .from('x1_partidas')
      .select('id, rodada, jogador1_username, jogador2_username')
      .eq('torneio_id', torneio.id)
      .is('vencedor_id', null)
      .not('jogador2_id', 'is', null)
      .order('rodada', { ascending: true });

    const opcoes = (data || [])
      .map(p => ({ name: `R${p.rodada}: ${p.jogador1_username} vs ${p.jogador2_username}`.slice(0, 100), value: String(p.id) }))
      .filter(o => o.name.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25);

    return interaction.respond(opcoes);
  }

  if (focused.name === 'campeonato') {
    const { data } = await supabase
      .from('x1_wins')
      .select('campeonato')
      .eq('guild_id', interaction.guildId)
      .not('campeonato', 'is', null);

    const unicos = [...new Set((data || []).map(d => d.campeonato))]
      .filter(c => c.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25);

    return interaction.respond(unicos.map(c => ({ name: c, value: c })));
  }

  return interaction.respond([]);
});

// ---------- botão: entrar no campeonato ----------

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('entrar_x1_')) return;

  const torneioId = interaction.customId.replace('entrar_x1_', '');

  const { data: torneio } = await supabase.from('x1_torneios').select('*').eq('id', torneioId).maybeSingle();
  if (!torneio || torneio.status !== 'inscricoes') {
    return interaction.reply({ content: 'As inscrições para esse campeonato já foram encerradas.', ephemeral: true });
  }

  const { data: existente } = await supabase
    .from('x1_inscritos')
    .select('id')
    .eq('torneio_id', torneioId)
    .eq('user_id', interaction.user.id)
    .maybeSingle();

  if (existente) {
    return interaction.reply({ content: 'Você já está inscrito nesse campeonato!', ephemeral: true });
  }

  await supabase.from('x1_inscritos').insert({
    torneio_id: torneioId,
    user_id: interaction.user.id,
    username: interaction.user.username,
  });

  const inscritos = await getInscritos(torneioId);
  const embed = buildInscricoesEmbed(torneio, inscritos);

  await interaction.update({ embeds: [embed] });
  await interaction.followUp({ content: '✅ Você entrou no campeonato!', ephemeral: true });
});

// ---------- botões: paginação do ranking ----------

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('ranking_')) return;

  const [, direcao, paginaAtualStr] = interaction.customId.split('_');
  let page = parseInt(paginaAtualStr, 10);
  page = direcao === 'next' ? page + 1 : page - 1;

  const ranking = await buscarRanking(interaction.guildId);
  const totalPages = Math.max(1, Math.ceil(ranking.length / 10));
  page = Math.min(Math.max(page, 0), totalPages - 1);

  const embed = buildRankingPageEmbed(ranking, page, totalPages, ranking.length);
  if (page === 0 && ranking[0]) {
    const primeiro = await client.users.fetch(ranking[0].user_id).catch(() => null);
    if (primeiro) embed.setThumbnail(primeiro.displayAvatarURL());
  }

  await interaction.update({ embeds: [embed], components: [rowRanking(page, totalPages)] });
});

// ---------- comandos ----------

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId } = interaction;

  try {
    // /vitoria
    if (commandName === 'vitoria') {
      const jogador = interaction.options.getUser('jogador');
      const campeonato = interaction.options.getString('campeonato') || 'Sem nome';

      await supabase.from('x1_wins').insert({
        guild_id: guildId,
        user_id: jogador.id,
        username: jogador.username,
        campeonato,
        registered_by: interaction.user.username,
      });

      const embed = new EmbedBuilder()
        .setColor(CORES.sucesso)
        .setTitle('🏆 Vitória registrada!')
        .setThumbnail(jogador.displayAvatarURL())
        .setDescription(`**${jogador.username}** venceu o campeonato **${campeonato}**`)
        .setFooter({ text: `Fastkia X1 • Registrado por ${interaction.user.username}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // /removervitoria
    if (commandName === 'removervitoria') {
      const jogador = interaction.options.getUser('jogador');

      const { data: ultima } = await supabase
        .from('x1_wins')
        .select('id, campeonato, created_at')
        .eq('guild_id', guildId)
        .eq('user_id', jogador.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!ultima) {
        return interaction.reply({ content: `**${jogador.username}** não tem vitórias registradas.`, ephemeral: true });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmar_remover').setLabel('Confirmar remoção').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancelar_remover').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
      );

      const embedConfirm = new EmbedBuilder()
        .setColor(CORES.erro)
        .setTitle('⚠️ Confirmar remoção')
        .setDescription(`Remover a vitória de **${jogador.username}** no campeonato **${ultima.campeonato}**?\nEssa ação não pode ser desfeita.`);

      const resposta = await interaction.reply({ embeds: [embedConfirm], components: [row], ephemeral: true, fetchReply: true });

      const filtro = i => i.user.id === interaction.user.id;
      try {
        const clique = await resposta.awaitMessageComponent({ filter: filtro, time: 15000 });

        if (clique.customId === 'confirmar_remover') {
          await supabase.from('x1_wins').delete().eq('id', ultima.id);
          await clique.update({
            embeds: [new EmbedBuilder().setColor(CORES.sucesso).setDescription(`✅ Vitória de **${jogador.username}** (${ultima.campeonato}) removida.`)],
            components: [],
          });
        } else {
          await clique.update({
            embeds: [new EmbedBuilder().setColor(CORES.info).setDescription('Operação cancelada.')],
            components: [],
          });
        }
      } catch {
        await interaction.editReply({ content: 'Tempo esgotado, operação cancelada.', embeds: [], components: [] });
      }
    }

    // /ranking
    if (commandName === 'ranking') {
      const ranking = await buscarRanking(guildId);

      if (ranking.length === 0) {
        return interaction.reply('Ainda não há vitórias registradas neste servidor.');
      }

      const totalPages = Math.max(1, Math.ceil(ranking.length / 10));
      const embed = buildRankingPageEmbed(ranking, 0, totalPages, ranking.length);

      const primeiro = await client.users.fetch(ranking[0].user_id).catch(() => null);
      if (primeiro) embed.setThumbnail(primeiro.displayAvatarURL());

      const components = totalPages > 1 ? [rowRanking(0, totalPages)] : [];
      await interaction.reply({ embeds: [embed], components });
    }

    // /perfil
    if (commandName === 'perfil') {
      const jogador = interaction.options.getUser('jogador') || interaction.user;

      const { data } = await supabase
        .from('x1_wins')
        .select('campeonato, created_at')
        .eq('guild_id', guildId)
        .eq('user_id', jogador.id)
        .order('created_at', { ascending: false });

      if (!data || data.length === 0) {
        return interaction.reply(`**${jogador.username}** ainda não ganhou nenhum campeonato.`);
      }

      const ranking = await buscarRanking(guildId);
      const posicao = ranking.findIndex(r => r.user_id === jogador.id);

      const lista = data.slice(0, 5).map(w => `• ${w.campeonato}`).join('\n');

      const embed = new EmbedBuilder()
        .setColor(CORES.perfil)
        .setTitle(`Perfil de ${jogador.username}`)
        .setThumbnail(jogador.displayAvatarURL())
        .addFields(
          { name: 'Total de títulos', value: `${data.length}`, inline: true },
          { name: 'Posição no ranking', value: posicao >= 0 ? medalhaOuIndice(posicao) : 'N/A', inline: true },
          { name: 'Últimos campeonatos', value: lista || 'N/A' }
        )
        .setFooter({ text: 'Fastkia X1' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // /historico
    if (commandName === 'historico') {
      const quantidade = Math.min(interaction.options.getInteger('quantidade') || 10, 25);
      const campeonatoFiltro = interaction.options.getString('campeonato');

      let query = supabase
        .from('x1_wins')
        .select('username, campeonato, created_at')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(quantidade);

      if (campeonatoFiltro) query = query.eq('campeonato', campeonatoFiltro);

      const { data } = await query;

      if (!data || data.length === 0) {
        return interaction.reply('Nenhuma vitória encontrada com esse filtro.');
      }

      const descricao = data
        .map(w => `🕐 <t:${Math.floor(new Date(w.created_at).getTime() / 1000)}:R> — **${w.username}** venceu **${w.campeonato}**`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor(CORES.info)
        .setTitle('📜 Histórico de vitórias')
        .setDescription(descricao)
        .setFooter({ text: 'Fastkia X1' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // /estatisticas
    if (commandName === 'estatisticas') {
      const { data } = await supabase
        .from('x1_wins')
        .select('user_id, username, campeonato')
        .eq('guild_id', guildId);

      if (!data || data.length === 0) {
        return interaction.reply('Ainda não há dados suficientes para estatísticas.');
      }

      const porJogador = {};
      const porCampeonato = {};

      for (const row of data) {
        porJogador[row.user_id] = porJogador[row.user_id] || { username: row.username, total: 0 };
        porJogador[row.user_id].total++;
        porCampeonato[row.campeonato] = (porCampeonato[row.campeonato] || 0) + 1;
      }

      const maiorCampeao = Object.values(porJogador).sort((a, b) => b.total - a.total)[0];
      const campeonatoMaisDisputado = Object.entries(porCampeonato).sort((a, b) => b[1] - a[1])[0];

      const embed = new EmbedBuilder()
        .setColor(CORES.ouro)
        .setTitle('📈 Estatísticas — Fastkia X1')
        .addFields(
          { name: 'Total de vitórias registradas', value: `${data.length}`, inline: true },
          { name: 'Jogadores com título', value: `${Object.keys(porJogador).length}`, inline: true },
          { name: 'Campeonatos distintos', value: `${Object.keys(porCampeonato).length}`, inline: true },
          { name: 'Maior campeão', value: `${maiorCampeao.username} (${maiorCampeao.total} títulos)` },
          { name: 'Campeonato mais disputado', value: `${campeonatoMaisDisputado[0]} (${campeonatoMaisDisputado[1]} edições)` }
        )
        .setFooter({ text: 'Fastkia X1' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // /campeonato criar | fechar | cancelar
    if (commandName === 'campeonato') {
      const sub = interaction.options.getSubcommand();

      if (sub === 'criar') {
        const nome = interaction.options.getString('nome');

        const ativo = await getTorneioAtivo(guildId);
        if (ativo) {
          return interaction.reply({ content: `Já existe um campeonato ativo (**${ativo.nome}**). Use \`/campeonato cancelar\` antes de criar outro.`, ephemeral: true });
        }

        const { data: torneio } = await supabase.from('x1_torneios').insert({
          guild_id: guildId,
          nome,
          status: 'inscricoes',
          canal_id: interaction.channelId,
          criado_por: interaction.user.username,
        }).select().single();

        const embed = buildInscricoesEmbed(torneio, []);
        const row = buildInscricoesRow(torneio.id);

        const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
        await supabase.from('x1_torneios').update({ mensagem_id: msg.id }).eq('id', torneio.id);
      }

      if (sub === 'fechar') {
        const torneio = await getTorneioAtivo(guildId);
        if (!torneio || torneio.status !== 'inscricoes') {
          return interaction.reply({ content: 'Não há campeonato com inscrições abertas.', ephemeral: true });
        }

        const inscritos = await getInscritos(torneio.id);
        if (inscritos.length < 2) {
          return interaction.reply({ content: 'É preciso pelo menos 2 inscritos para fechar as inscrições.', ephemeral: true });
        }

        await supabase.from('x1_torneios').update({ status: 'andamento' }).eq('id', torneio.id);
        await criarPartidasRodada(torneio.id, 1, inscritos.map(i => ({ id: i.user_id, username: i.username })));

        const resultado = await avancarAteTravar(torneio.id, 1);

        if (resultado.finalizado) {
          await registrarCampeao(torneio, resultado.vencedor);
          const embed = new EmbedBuilder()
            .setColor(CORES.ouro)
            .setTitle(`🏆 ${torneio.nome} finalizado!`)
            .setDescription(`Campeão: **${resultado.vencedor.vencedor_username}**`);
          return interaction.reply({ embeds: [embed] });
        }

        const todas = await getTodasPartidas(torneio.id);
        const porRodada = {};
        for (const p of todas) {
          porRodada[p.rodada] = porRodada[p.rodada] || [];
          porRodada[p.rodada].push(p);
        }

        const embed = buildChaveamentoEmbed(torneio, porRodada);
        await interaction.reply({ content: `Inscrições encerradas com **${inscritos.length}** participante(s). Chaveamento gerado!`, embeds: [embed] });
      }

      if (sub === 'cancelar') {
        const torneio = await getTorneioAtivo(guildId);
        if (!torneio) {
          return interaction.reply({ content: 'Não há campeonato ativo para cancelar.', ephemeral: true });
        }
        await supabase.from('x1_torneios').update({ status: 'cancelado' }).eq('id', torneio.id);
        await interaction.reply(`Campeonato **${torneio.nome}** foi cancelado.`);
      }
    }

    // /chaveamento
    if (commandName === 'chaveamento') {
      const torneio = await getTorneioAtivo(guildId);
      if (!torneio) {
        return interaction.reply({ content: 'Não há campeonato ativo neste servidor.', ephemeral: true });
      }

      if (torneio.status === 'inscricoes') {
        const inscritos = await getInscritos(torneio.id);
        return interaction.reply({ embeds: [buildInscricoesEmbed(torneio, inscritos)] });
      }

      const todas = await getTodasPartidas(torneio.id);
      const porRodada = {};
      for (const p of todas) {
        porRodada[p.rodada] = porRodada[p.rodada] || [];
        porRodada[p.rodada].push(p);
      }

      await interaction.reply({ embeds: [buildChaveamentoEmbed(torneio, porRodada)] });
    }

    // /placar
    if (commandName === 'placar') {
      const partidaId = interaction.options.getString('partida');
      const placar1 = interaction.options.getInteger('placar1');
      const placar2 = interaction.options.getInteger('placar2');

      if (placar1 === placar2) {
        return interaction.reply({ content: 'Não pode dar empate em x1! Ajuste o placar.', ephemeral: true });
      }

      const { data: partida } = await supabase.from('x1_partidas').select('*').eq('id', partidaId).maybeSingle();
      if (!partida || partida.vencedor_id) {
        return interaction.reply({ content: 'Partida não encontrada ou já finalizada.', ephemeral: true });
      }

      const vencedorId = placar1 > placar2 ? partida.jogador1_id : partida.jogador2_id;
      const vencedorUsername = placar1 > placar2 ? partida.jogador1_username : partida.jogador2_username;

      await supabase.from('x1_partidas').update({
        placar1, placar2, vencedor_id: vencedorId, vencedor_username: vencedorUsername,
      }).eq('id', partidaId);

      const { data: torneio } = await supabase.from('x1_torneios').select('*').eq('id', partida.torneio_id).single();

      const embedPlacar = new EmbedBuilder()
        .setColor(CORES.sucesso)
        .setTitle('⚽ Placar registrado')
        .setDescription(`**${partida.jogador1_username}** ${placar1} x ${placar2} **${partida.jogador2_username}**\nVencedor: **${vencedorUsername}**`);

      await interaction.reply({ embeds: [embedPlacar] });

      const resultado = await avancarAteTravar(partida.torneio_id, partida.rodada);

      if (resultado.finalizado) {
        await registrarCampeao(torneio, resultado.vencedor);
        const embedFinal = new EmbedBuilder()
          .setColor(CORES.ouro)
          .setTitle(`🏆 ${torneio.nome} finalizado!`)
          .setDescription(`Campeão do campeonato: **${resultado.vencedor.vencedor_username}** 🎉`);
        await interaction.followUp({ embeds: [embedFinal] });
      }
    }

    // /ajuda
    if (commandName === 'ajuda') {
      const embed = new EmbedBuilder()
        .setColor(CORES.principal)
        .setTitle('🤖 Fastkia X1 — Comandos')
        .setDescription('Bot de ranking e campeonatos de x1 no FIFA.')
        .addFields(
          { name: '/campeonato criar', value: 'Abre inscrições com botão de entrada (admin/mod).' },
          { name: '/campeonato fechar', value: 'Fecha inscrições e gera o chaveamento automático (admin/mod).' },
          { name: '/campeonato cancelar', value: 'Cancela o campeonato ativo (admin/mod).' },
          { name: '/chaveamento', value: 'Mostra os inscritos ou o chaveamento atual.' },
          { name: '/placar', value: 'Registra o resultado de uma partida do campeonato (admin/mod).' },
          { name: '/vitoria', value: 'Registra manualmente o vencedor de um campeonato (admin/mod).' },
          { name: '/removervitoria', value: 'Remove a última vitória de um jogador, com confirmação (admin/mod).' },
          { name: '/ranking', value: 'Mostra o ranking geral, com paginação.' },
          { name: '/perfil', value: 'Mostra o total de títulos e posição de um jogador.' },
          { name: '/historico', value: 'Lista as últimas vitórias registradas.' },
          { name: '/estatisticas', value: 'Números gerais do servidor.' }
        )
        .setFooter({ text: 'Fastkia X1' });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Deu erro ao processar o comando.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
