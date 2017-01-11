"use strict";
function randomInt(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max + 1 - min)) + min;
};

// TODO: use collection.find
function hasUser(array, user2) {
	console.assert(user2.id);
	return array.some((user1) => user1.id === user2.id);
};

Array.prototype.randomElement = function () {
	return this[randomInt(0, this.length - 1)];
}

var fs = require('fs');
var sprintf = require('sprintf-js').sprintf;
var Discord = require('discord.js');
var client = new Discord.Client();

var config = require('./config.json');
if (!fs.existsSync('./DB.json'))
	fs.writeFileSync('./DB.json', '{}');
var DB = require('./DB.json');
function saveDB() {
	fs.writeFileSync('./DB.json', JSON.stringify(DB));
};

if (!DB.players) {
	DB.players = {};
	saveDB();
}

var icons = [];
for (var i = 0; i <= config.team_size; i++)
	icons.push(fs.readFileSync(`./icons/${i}.png`));

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
	var map_votes;

	var iconStatus = () => { if (config.update_icon) guild.setIcon(icons[participants.length]) };

	var queue_status = () => `${participants.length}/${config.team_size}`;

	var map_status = () => Object.keys(map_votes)
		.reduce((acc, id) => {
			var map = map_votes[id];
			var existing = acc.find(vote => vote.map == map);
			if (existing) {
				existing.votes++;
			} else {
				acc.push({ "map": map, "votes": 1 });
			};
			return acc;
		}, [])
		.sort((a, b) => b.votes - a.votes);

	var play_map = () => {
		var votes = map_status();
		return votes[0] ? votes.filter(vote => vote.votes >= votes[0].votes).randomElement().map : config.map_pool.randomElement();
	};

	var nickname = (user) => {
		var guildMember = guild.member(user);
		if (!guildMember || !guildMember.nickname) return user.username;
		return guildMember.nickname;
	};

	var reset = () => {
		participants = [];
		map_votes = {};
		phase = phases.GATHER;
		clearTimeout(readyTimeout);
		clearTimeout(picksTimeout);
		iconStatus();
	};
	reset();

	var commands = {};
	commands.add = (msg) => {
		if (msg.channel.name !== config.pug_channel_name) return;
		if (phase !== phases.GATHER)
			return msg.reply(config.strings.pug_in_progress);
		if (hasUser(participants, msg.author))
			return msg.reply(sprintf(config.strings.already_added, queue_status()));

		participants.push(msg.author);
		msg.reply(sprintf(config.strings.add_success, queue_status()));
		iconStatus();

		if (participants.length >= config.team_size) {
			var mentions = "1 minute to \`!ready\`\n";
			participants.forEach((p, i) => mentions += `${p} `);
			msg.channel.sendMessage(mentions);
			phase = phases.READY_UP;
			ready = [];

			readyTimeout = setTimeout(() => {
				var unready = [];
				unready = participants.filter((p) => !hasUser(ready, p));
				var reply = `PUG is cancelled, only ${ready.length}/${config.team_size} readied up!\nUnready removed: `;
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
		if (msg.channel.name !== config.pug_channel_name) return;
		if (phase !== phases.READY_UP) return;

		if (hasUser(ready, msg.author))
			return msg.reply(`you've already readied up! ${ready.length}/${config.team_size}`);

		if (!hasUser(participants, msg.author))
			return msg.reply(`you're not participating! ${ready.length}/${config.team_size}`);

		ready.push(msg.author);
		msg.reply(`you're ready! ${ready.length}/${config.team_size}`);

		if (ready.length !== config.team_size) return;

		captains = [];
		captains[0] = ready.randomElement();
		ready = ready.filter((p) => p.id !== captains[0].id);
		captains[1] = ready.randomElement();
		ready = ready.filter((p) => p.id !== captains[1].id);
		// ready now - players available for picking

		var mentions = "";
		ready.forEach((p, i) => mentions += `${i+1}. ${p}\n`);

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
		if (number < 0 || number >= ready.length) return msg.reply(`there is no such player!`);
		var picked = ready[number];
		teams[turn].push(picked);
		ready = ready.filter((p) => p.id !== picked.id);
		picksRemaining--;

		if (picksRemaining === 0) {
			picksRemaining = 2;
			turn = turn === 0 ? 1 : 0;
		};

		if (ready.length === 1)
		{
			teams[turn].push(ready[0]);
			var fatkid = ready[0].id

			if (!DB.players[fatkid])
				DB.players[fatkid] = {};

			if (!DB.players[fatkid].fatkid)
				DB.players[fatkid].fatkid = 1;
			else
				DB.players[fatkid].fatkid++;

			var results = `:ok: \nTeam 1:\n`;
			teams[0].forEach((p, i) => results += `${i+1}. ${p}\n`);
			results += `\nTeam 2:\n`;
			teams[1].forEach((p, i) => results += `${i+1}. ${p}\n`);
			results += `\nMap: **${play_map()}**\nLET'S FUCKING GO! WOOOOO!\n`;
			msg.channel.sendMessage(results);
			clearTimeout(picksTimeout);

			participants.forEach((p) => {
				if (!DB.players[p.id])
					DB.players[p.id] = {};

				if (!DB.players[p.id].gamesPlayed)
					DB.players[p.id].gamesPlayed = 1;
				else
					DB.players[p.id].gamesPlayed++;
			});

			DB.lastPlayed = new Date().toISOString().
				replace(/T/, ' ').   // replace T with a space
				replace(/\..+/, ''); // delete the dot and everything after

			saveDB();
			return reset();
		};

		var response = `${captains[turn]}, ${picksRemaining} pick${picksRemaining === 2 ? 's':''}\n`;
		ready.forEach((p, i) => response += `${i+1}. ${p}\n`);
		msg.channel.sendMessage(response);
	};
	commands.remove = (msg) => {
		if (msg.channel.name !== config.pug_channel_name) return;
		if (phase !== phases.GATHER) return;

		if (!hasUser(participants, msg.author))
			return msg.reply(`you're not added! ${queue_status()}`);

		map_votes[msg.author.id] = undefined;
		participants = participants.filter((p) => p.id !== msg.author.id);
		msg.reply(`removed! ${queue_status()}`);
		iconStatus();
	};
	var append_map_votes = (reply) => {
		var votes = map_status();
		if (votes[0]) {
			reply += '\nMap votes:\n';
			votes.forEach((vote) => reply += `**${vote.map}** - ${vote.votes}, `);
		}
		reply = reply.substring(0, reply.length - 2);
		return reply;
	};
	commands.status = (msg) => {
		if (phase === phases.GATHER) {
			if (participants.length === 0)
				return msg.reply(`Last PUG played: ${DB.lastPlayed || 'never'}\nNoone's signed up! 0/${config.team_size}`);

			var reply = `Last PUG played: ${DB.lastPlayed || 'never'}\n${queue_status()}, participants are:\n`;
			participants.forEach((p) => reply += `${nickname(p)}\n`);
			reply = append_map_votes(reply);
			iconStatus();
			msg.reply(reply);
		} else if (phase === phases.READY_UP) {
			var unready = [];
			unready = participants.filter((p) => !hasUser(ready, p));
			var reply = `Type \`!ready\` to ready up!. Unready: `;
			unready.forEach((p) => reply += `${p}, `);
			reply = reply.substring(0, reply.length - 2);
			reply = append_map_votes(reply);
			msg.reply(reply);
		} else if (phase === phases.PICKING) {
			var reply = `${msg.author},\nCurrently picked for Team 1:\n`;
			teams[0].forEach((p, i) => reply += `${i+1}. ${p}\n`);
			reply += `\nCurrently picked for Team 2:\n`;
			teams[1].forEach((p, i) => reply += `${i+1}. ${p}\n`);
			reply = append_map_votes(reply);
			msg.channel.sendMessage(reply);
		};
	};
	commands.help = (msg) => msg.reply(sprintf(config.strings.help.join("\n"), config));
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
		for (var i = 1; i <= config.team_size; i ++) {
			var mockArgs = ["mock", i.toString(), args[1]];
			msg.author = me;
			commands.mock(msg, mockArgs);
		};
	};
	commands.me = (msg, args) => {
		var info = args.slice(1).join(" ").replace(/\'/g,'\'\'');
		if (!DB.players[msg.author.id])
			DB.players[msg.author.id] = {};
		DB.players[msg.author.id].info = info;
		saveDB();
		msg.reply('gotcha!');
	};
	commands.who = (msg, args) => {
		var id = args[1] ? args[1].match(/(?:<@|<@!)(\d+)(?:>)/) : null;
		if (!id) return;
		id = id[1];
		if (!DB.players[id] || !DB.players[id].info)
			return msg.reply('nothing on this player yet!');
		msg.reply(`${nickname(guild.member(id).user)} is ${DB.players[id].info}`);
	};
	commands.fatkid = (msg, args) => {
		var id = args[1] ? args[1].match(/(?:<@|<@!)(\d+)(?:>)/) : null;
		if (!id) return;
		id = id[1];
		if (!DB.players[id] || !DB.players[id].fatkid)
			return msg.reply("this player hasn't been a fat kid yet!");
		msg.reply(`${nickname(guild.member(id).user)} has been the fat kid ${DB.players[id].fatkid} times`);
	};
	commands.top = (msg, args) => {
		var top10 = [];
		for (var i = 0; i < 10; i++) {
			for (var id in DB.players) {
				var gamesPlayed = DB.players[id].gamesPlayed;
				if (!gamesPlayed) continue;
				if (top10.some((p) => p.id === id)) continue;
				if (!top10[i] || gamesPlayed > top10[i].gamesPlayed)
					top10[i] = { "id": id, "gamesPlayed": gamesPlayed };
			};
		};
		var results = `games played: \n`;
		top10.forEach((p, i) => results += `${i+1}. ${guild.member(p.id) ? nickname(guild.member(p.id).user) : p.id} - ${p.gamesPlayed}\n`);
		msg.reply(results);
	};
	commands.gamesPlayedReset = (msg, args) => {
		if (!guild.member(msg.author).hasPermission("ADMINISTRATOR")) return;
		for (var id in DB.players) {
			DB.players[id].gamesPlayed = 0;
		};
		saveDB();
		msg.reply("games counter for each player has been reset!");
	};
	commands.maps = (msg) => {
		var reply_str = "Available maps:";
		config.map_pool.forEach((mapname) => {
			reply_str += `\n**${mapname}**`;
		});
		reply_str += `\n\nType \`!map <mapname>\` to vote for a map`;
		msg.reply(reply_str);
	};
	commands.votemap = (msg, args) => {
		var mapname = args.slice(1).join(" ");
		if (!hasUser(participants, msg.author)) return msg.reply("only added players may vote for a map!");
		if (config.map_pool.indexOf(mapname) <= -1) return msg.reply("no such map exists!");
		map_votes[msg.author.id] = mapname;
		var reply = `you voted for **${mapname}**`;
		reply = append_map_votes(reply);
		msg.reply(reply);
	};
	// Aliases
	commands.join = commands.add;
	commands.leave = commands.remove;
	commands.r = commands.ready;
	commands.m = commands.mock;
	commands.info = commands.help;
	commands.p = commands.pick;
	commands.fat = commands.fatkid;
	commands.top10 = commands.top;

	client.on('message', msg => {
		if (msg.content[0] !== config.command_delimeter) return; // not a command
		msg.content = msg.content.substring(1); // strip away the command delimeter
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
