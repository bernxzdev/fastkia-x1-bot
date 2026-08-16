const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('vitoria')
    .setDescription('Registra a vitória de um jogador em um campeonato de x1')
    .addUserOption(opt =>
      opt.setName('jogador').setDescription('Quem venceu').setRequired(true))
    .addStringOption(opt =>
      opt.setName('campeonato').setDescription('Nome/edição do campeonato')
        .setRequired(false).setAutocomplete(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('removervitoria')
    .setDescription('Remove a última vitória registrada de um jogador (com confirmação)')
    .addUserOption(opt =>
      opt.setName('jogador').setDescription('De quem remover').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Mostra o ranking de campeonatos de x1 ganhos'),

  new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Mostra quantos campeonatos um jogador já ganhou')
    .addUserOption(opt =>
      opt.setName('jogador').setDescription('Deixe vazio para ver o seu').setRequired(false)),

  new SlashCommandBuilder()
    .setName('historico')
    .setDescription('Mostra as últimas vitórias registradas no servidor')
    .addIntegerOption(opt =>
      opt.setName('quantidade').setDescription('Quantas mostrar (padrão 10, máx 25)').setRequired(false))
    .addStringOption(opt =>
      opt.setName('campeonato').setDescription('Filtrar por campeonato')
        .setRequired(false).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('estatisticas')
    .setDescription('Estatísticas gerais do servidor no Fastkia X1'),

  new SlashCommandBuilder()
    .setName('ajuda')
    .setDescription('Mostra todos os comandos do Fastkia X1'),
].map(cmd => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registrando slash commands globalmente...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Comandos registrados com sucesso! (pode levar até 1h para propagar em todos os servidores)');
  } catch (error) {
    console.error(error);
  }
})();
