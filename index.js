"use strict";
function randomInt(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min)) + min;
};

// TODO: use collection.find
function hasUser(array, user2) {
	console.assert(user2.id);
	return array.some((user1) => user1.id === user2.id);
};

var config = require('./config.json');
var fs = require('fs');
var Discord = require('discord.js');
var client = new Discord.Client();

var icons = [];
for (var i = 0; i <= 12; i++)
	icons.push(fs.readFileSync(`./icons/${i}.png`));

var playerDB = new require('./sqlite3-promises.js').make();
playerDB
	.open('players.sqlite3')
	.then(() => playerDB.run(`CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY NOT NULL UNIQUE, info TEXT, fatkid INTEGER DEFAULT 0)`));
	// .then(() => playerDB.get(`PRAGMA user_version`))
	// .then((data) => { if (data.user_version < 1) playerDB.run(`ALTER TABLE players ADD COLUMN fatkid INTEGER DEFAULT 0; ALTER TABLE players`) })
	// .then(() => playerDB.run(`PRAGMA user_version = 1`));

var phases = {
	"GATHER": 0,
	"READY_UP": 1,
	"PICKING": 2
}

client.on("ready", () => {
	console.log("Ready to begin! Serving in " + client.channels.array().length + " channels");

	// TODO: spin this for every guild so the bot can be used on multiple guilds with only one instance
	var guild = client.guilds.first();
	var member = guild.member(client.user);

	var participants;
	var phase;
	var ready;
	var readyTimeout;
	var captains;
	var teams;
	var picksRemaining;
	var turn;
	var picksTimeout;

	var iconStatus = () => guild.setIcon(icons[participants.length]);

	function nickname(user) {
		var guildMember = guild.member(user);
		if (!guildMember || !guildMember.nickname) return user.username;
		return guildMember.nickname;
	}

	function reset() {
		participants = [];
		phase = phases.GATHER;
		clearTimeout(readyTimeout);
		clearTimeout(picksTimeout);
		iconStatus();
	};
	reset();

	var commands = {};
	commands.add = (msg) => {
		if (msg.channel.name !== "lfg") return;
		if (phase !== phases.GATHER)
			return msg.reply(`PUG in progress!`);
		if (hasUser(participants, msg.author))
			return msg.reply(`you're already added! ${participants.length}/12`);

		participants.push(msg.author);
		msg.reply(`added! ${participants.length}/12`);
		iconStatus();

		if (participants.length >= 12) {
			var mentions = "1 minute to \`!ready\`\n";
			participants.forEach((p, i) => mentions += `${p} `);
			msg.channel.sendMessage(mentions);
			phase = phases.READY_UP;
			ready = [];

			readyTimeout = setTimeout(() => {
				var unready = [];
				unready = participants.filter((p) => !hasUser(ready, p));
				var reply = `PUG is cancelled, only ${ready.length}/12 readied up!\nUnready removed: `;
				unready.forEach((p) => reply += `${p}, `);
				reply = reply.substring(0, reply.length - 2);
				msg.channel.sendMessage(reply);

				// Reset, but keep the ready ones in
				reset();
				participants = ready;
				iconStatus();
			}, 1000 * 60);
		};
	};
	// TODO: some form of !unready?
	commands.ready = (msg) => {
		if (msg.channel.name !== "lfg") return;
		if (phase !== phases.READY_UP) return;

		if (hasUser(ready, msg.author))
			return msg.reply(`you've already readied up! ${ready.length}/12`);

		if (!hasUser(participants, msg.author))
			return msg.reply(`you're not participating! ${ready.length}/12`);

		ready.push(msg.author);
		msg.reply(`you're ready! ${ready.length}/12`);

		if (ready.length !== 12) return;

		captains = [];
		captains[0] = participants[randomInt(0, 11)];
		participants = participants.filter((p) => p.id !== captains[0].id);
		captains[1] = participants[randomInt(0, 10)];
		participants = participants.filter((p) => p.id !== captains[1].id);
		// participants now - players available for picking

		var mentions = "";
		participants.forEach((p, i) => mentions += `${i+1}. ${p}\n`);

		msg.channel.sendMessage(
			`PUG is starting!\n` +
			`${mentions}\n` +
			`Captains are ${captains[0]} (picks first, Team 1) and ${captains[1]} (picks second, Team 2)\n` +
			`\`!pick X\` to pick player number X\n` +
			`Pick order is 1-2-2-2-2-1\n`
		);

		picksRemaining = 1;
		turn = 0;
		teams = [[captains[0]], [captains[1]]];
		clearTimeout(readyTimeout);
		phase = phases.PICKING;

		picksTimeout = setTimeout(() => {
			msg.channel.sendMessage(`PUG is cancelled, the pick phase is taking too long for some reason.`);
			reset();
		}, 1000 * 60 * 5);
	};
	commands.pick = (msg, args) => {
		if (msg.author.id !== captains[turn].id) return;
		if (isNaN(args[1])) return msg.reply(`not a number!`);
		var number = parseInt(args[1] - 1);
		if (number < 0 || number >= participants.length) return msg.reply(`there is no such player!`);
		var picked = participants[number];
		teams[turn].push(picked);
		participants = participants.filter((p) => p.id !== picked.id);
		picksRemaining--;

		if (picksRemaining === 0) {
			picksRemaining = 2;
			turn = turn === 0 ? 1 : 0;
		}

		if (participants.length === 1)
		{
			teams[turn].push(participants[0]);
			if (playerDB.ready)
				playerDB.run(`INSERT OR IGNORE INTO players (id) VALUES ('${msg.author.id}')`).then(() => playerDB.run(`UPDATE players SET fatkid=(fatkid + 1) WHERE id='${msg.author.id}'`));

			var results = `:ok: \nTeam 1:\n`;
			teams[0].forEach((p, i) => results += `${i+1}. ${p}\n`);
			results += `\nTeam 2:\n`;
			teams[1].forEach((p, i) => results += `${i+1}. ${p}\n`);
			results += `\nLET'S FUCKING GO! WOOOOO!\n`;
			msg.channel.sendMessage(results);
			clearTimeout(picksTimeout);
			return reset();
		}

		var response = `${captains[turn]}, ${picksRemaining} pick${picksRemaining === 2 ? 's':''}\n`;
		participants.forEach((p, i) => response += `${i+1}. ${p}\n`);
		msg.channel.sendMessage(response);
	};
	commands.remove = (msg) => {
		if (msg.channel.name !== "lfg") return;
		if (phase !== phases.GATHER) return;

		if (!hasUser(participants, msg.author))
			return msg.reply(`you're not added! ${participants.length}/12`);
		participants = participants.filter((p) => p.id !== msg.author.id);
		msg.reply(`removed! ${participants.length}/12`);
		iconStatus();
	};
	commands.status = (msg) => {
		if (phase === phases.GATHER) {
			if (participants.length == 0)
				return msg.reply("noone's signed up! 0/12");

			var response = "participants are: ";
			participants.forEach((p) => response += `${nickname(p)}, `);
			response = response.substring(0, response.length - 2);
			msg.reply(`${response}. ${participants.length}/12`);
		} else if (phase === phases.READY_UP) {
			var unready = [];
			unready = participants.filter((p) => !hasUser(ready, p));
			var reply = `Unready: `;
			unready.forEach((p) => reply += `${p}, `);
			reply = reply.substring(0, reply.length - 2);
			msg.reply(reply);
		} else if (phase === phases.PICKING) {
			var msgTeams = `${msg.author},\nCurrently picked for Team 1:\n`;
			teams[0].forEach((p, i) => msgTeams += `${i+1}. ${p}\n`);
			msgTeams += `\nCurrently picked for Team 2:\n`;
			teams[1].forEach((p, i) => msgTeams += `${i+1}. ${p}\n`);
			msg.channel.sendMessage(msgTeams);
		};
	};
	commands.help = (msg) => {
		return msg.reply(`available commands: \`!help\`, \`!status\`, \`!add\` (only #lfg), \`!remove\` (only #lfg), \`!me <info>\`, \`!who @mention\`, \`!fatkid @mention\`. Once 12 players are added, the bot will ask everyone to !ready. Then the PUG will start and 2 random players will be chosen as captains.`);
	};
	commands.mock = (msg, args) => {
		if (!guild.member(msg.author).hasPermission("ADMINISTRATOR")) return;
		var id = args[1];
		msg.author = {
			"id": id,
			"username": `Mock${id}`,
			"toString": () => `<@${id}>`
		};

		if (commands[args[2]])
			commands[args[2]](msg, args.slice(2));
	};
	commands.force = (msg, args) => {
		if (!guild.member(msg.author).hasPermission("ADMINISTRATOR")) return;
		var id = msg.content.match(/(?:<@|<@!)(\d+)(?:>)/);
		if (!id) return;
		id = id[1];
		var subject = guild.member(id).user;

		msg.author = subject;
		if (commands[args[2]])
			commands[args[2]](msg, args.slice(2));
	};
	commands.reset = (msg) => {
		if (!guild.member(msg.author).hasPermission("ADMINISTRATOR")) return;
		reset();
		msg.reply("PUGBOT reset!");
	};
	commands.mocks = (msg, args) => {
		if (!guild.member(msg.author).hasPermission("ADMINISTRATOR")) return;
		var me = msg.author;
		for (var i = 1; i <= 12; i ++) {
			var mockArgs = ["mock", i.toString(), args[1]];
			msg.author = me;
			commands.mock(msg, mockArgs);
		};
	};
	commands.me = (msg, args) => {
		if (!playerDB.ready) return;
		var info = args.slice(1).join(" ").replace(/\'/g,'\'\'');
		playerDB.run(`INSERT OR IGNORE INTO players (id) VALUES ('${msg.author.id}')`).then(() => playerDB.run(`UPDATE players SET info='${info}' WHERE id=${msg.author.id}`));
		msg.reply("gotcha!");
	};
	commands.who = (msg, args) => {
		if (!playerDB.ready) return;
		var id = args[1] ? args[1].match(/(?:<@|<@!)(\d+)(?:>)/) : null;
		if (!id) return;
		id = id[1];
		playerDB
			.all(`SELECT info FROM players WHERE id='${id}'`)
			.then((rows) => msg.reply((rows[0] && rows[0].info) ? `${nickname(guild.member(id).user)} is ${rows[0].info}` : `nothing on this player yet!`));
	};
	commands.fatkid = (msg, args) => {
		if (!playerDB.ready) return;
		var id = args[1] ? args[1].match(/(?:<@|<@!)(\d+)(?:>)/) : null;
		if (!id) return;
		id = id[1];
		playerDB
			.all(`SELECT fatkid FROM players WHERE id='${id}'`)
			.then((rows) => msg.reply(rows[0] ? `${nickname(guild.member(id).user)} has been the fat kid ${rows[0].fatkid} times` : `this player hasn't been a fat kid yet!`));
	};
	// Aliases
	commands.join = commands.add;
	commands.leave = commands.remove;
	commands.r = commands.ready;
	commands.m = commands.mock;
	commands.info = commands.help;
	commands.p = commands.pick;
	commands.fat = commands.fatkid;

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
});

client.login(config.discord.bot_token);
