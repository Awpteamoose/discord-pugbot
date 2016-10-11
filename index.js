"use strict";
function randomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

var config = require('./config.json');
var Discord = require('discord.js');
var client = new Discord.Client();

client.on("ready", () => {
    console.log("Ready to begin! Serving in " + client.channels.array().length + " channels");
});

var participants = [];

var commands = {
	"add": (msg) => {
		if (msg.channel.name !== "lfg") return;
		if (participants.some((p) => p.id === msg.author.id))
			return msg.reply(`you're already added! ${participants.length}/12`);

		if (participants.length >= 12)
			return msg.reply(`sorry, mate, it's full! 12/12`);

		participants.push(msg.author);
		msg.reply(`added! ${participants.length}/12`);

		if (participants.length >= 12)
		{
			var cap1 = participants[randomInt(0, 11)];
			participants = participants.filter((p) => p.id !== cap1.id);
			var cap2 = participants[randomInt(0, 10)];

			msg.channel.sendMessage(`@everyone PUG is starting! Your captains are <@${cap1.id}> and <@${cap2.id}>!`);
			participants = [];
		}
	},
	"remove": (msg) => {
		if (msg.channel.name !== "lfg") return;
		if (!participants.some((p) => p.id === msg.author.id))
			return msg.reply(`you're not added! ${participants.length}/12`);

		participants = participants.filter((p) => p.id !== msg.author.id);
		msg.reply(`removed! ${participants.length}/12`);
	},
	"status": (msg) => {
		if (participants.length == 0) {
			return msg.reply("noone's signed up! 0/12");
		}
		var response = "participants are: ";
		for (var i = 0; i < participants.length; i++)
		{
			response += participants[i].username + ", ";
		}
		response = response.substring(0, response.length - 2);
		msg.reply(`${response}. ${participants.length}/12`);
	},
	"help": (msg) => {
		msg.reply(`available commands: !help, !status, !add (only #lfg), !remove (only #lfg). Once 12 players are added, the PUG will start and 2 random players will be chosen as captains. More advanced features coming soon.`);
	}
}


client.on('message', msg => {
	if (msg.content[0] !== "!") return; // not a command
	msg.content = msg.content.substring(1); // strip away the !

	if (commands[msg.content])
		commands[msg.content](msg);
});

client.on('disconnected', function () {
    console.log('Disconnected.');
    process.exit(1);
});

client.login(config.discord.bot_token);
