"use strict";
function randomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
};

function hasUser(array, user2) {
	console.assert(user2.id);
	return array.some((user1) => user1.id === user2.id);
};

var config = require('./config.json');
var Discord = require('discord.js');
var client = new Discord.Client();

client.on("ready", () => {
    console.log("Ready to begin! Serving in " + client.channels.array().length + " channels");
});

var participants = [];
var ready_up = false;
var ready = [];
var ready_timeout;

var commands = {};
commands.add = (msg) => {
	if (msg.channel.name !== "lfg") return;
	if (ready_up)
		return msg.reply(`PUG ready-up is in progress`);
	if (hasUser(participants, msg.author))
		return msg.reply(`you're already added! ${participants.length}/12`);

	// unreachable in the current implementation
	// if (participants.length >= 12)
	//     return msg.reply(`sorry, mate, it's full! 12/12`);

	participants.push(msg.author);
	msg.reply(`added! ${participants.length}/12`);

	if (participants.length >= 12)
	{
		var mentions = "1 minute to !ready\n";
		participants.forEach((p, i) => mentions += `${p} `);
		msg.channel.sendMessage(mentions);
		ready_up = true;

		ready_timeout = setTimeout(() => {
			var unready = [];
			unready = participants.filter((p) => !hasUser(ready, p));
			var reply = `PUG is cancelled, only ${ready.length}/12 readied up!\nUnready removed: `;
			unready.forEach((p) => reply += `${p.username}, `);
			reply = reply.substring(0, reply.length - 2);
			msg.channel.sendMessage(reply);

			// Reset, but keep the ready ones in
			participants = ready;
			ready = [];
			ready_up = false;
		}, 1000 * 60);
	};
};
commands.ready = (msg) => {
	if (msg.channel.name !== "lfg") return;
	if (!ready_up) return;

	if (hasUser(ready, msg.author))
		return msg.reply(`you've already readied up! ${ready.length}/12`);

	if (!hasUser(participants, msg.author))
		return msg.reply(`you're not participating! ${ready.length}/12`);

	ready.push(msg.author);
	msg.reply(`you're ready! ${ready.length}/12`);

	if (ready.length !== 12) return;
	var mentions = "";
	participants.forEach((p, i) => mentions += `${i+1}. ${p}\n`);

	var cap1 = participants[randomInt(0, 11)];
	participants = participants.filter((p) => p.id !== cap1.id);
	var cap2 = participants[randomInt(0, 10)];
	participants = participants.filter((p) => p.id !== cap2.id);
	// participants now - players available for picking

	msg.channel.sendMessage(
		`PUG is starting!\n` +
		`${mentions}\n` +
		`Captains are ${cap1} (picks first, Team 1) and ${cap2} (picks second, Team 2)\n` +
		`Pick order is 1-2-2-2-2-1\n`
	);

	// Reset
	participants = [];
	ready = [];
	ready_up = false;
	clearTimeout(ready_timeout);
}
commands.remove = (msg) => {
	if (msg.channel.name !== "lfg") return;
	if (ready_up) return;
	if (!hasUser(participants, msg.author))
		return msg.reply(`you're not added! ${participants.length}/12`);

	participants = participants.filter((p) => p.id !== msg.author.id);
	msg.reply(`removed! ${participants.length}/12`);
};
commands.status = (msg) => {
	if (participants.length == 0) {
		return msg.reply("noone's signed up! 0/12");
	}
	var response = "participants are: ";
	participants.forEach((p) => response += `${p.username}, `);
	response = response.substring(0, response.length - 2);
	msg.reply(`${response}. ${participants.length}/12`);
};
commands.help = (msg) => {
	msg.reply(`available commands: !help, !status, !add (only #lfg), !remove (only #lfg). Once 12 players are added, the PUG will start and 2 random players will be chosen as captains. More advanced features coming soon.`);
};
commands.mock = (msg, args) => {
	return; // comment to enable dev mode
	var id = args[1];
	msg.author = {
		"id": id,
		"username": `Mock${id}`,
		"toString": () => `<@${id}>`
	};

	if (commands[args[2]])
		commands[args[2]](msg, args.slice(2));
};
// Aliases
commands.join = commands.add;
commands.leave = commands.remove;
commands.r = commands.ready;
commands.m = commands.mock;
commands.info = commands.help;

client.on('message', msg => {
	if (msg.content[0] !== "!") return; // not a command
	msg.content = msg.content.substring(1); // strip away the '!'
	var args = msg.content.split(" ");
	var command = args[0];

	if (commands[command])
		commands[command](msg, args);
});

client.on('disconnected', function () {
    console.log('Disconnected.');
    process.exit(1);
});

client.login(config.discord.bot_token);
