#!/usr/bin/env node
"use strict";

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

require("babel-polyfill");

var _fs = require("fs");

var fs = _interopRequireWildcard(_fs);

var _discord = require("discord.js");

var Discord = _interopRequireWildcard(_discord);

var _json = require("json5");

var _json2 = _interopRequireDefault(_json);

var _nodeJsonDb = require("node-json-db");

var _nodeJsonDb2 = _interopRequireDefault(_nodeJsonDb);

var _ejs = require("ejs");

var ejs = _interopRequireWildcard(_ejs);

var _ramda = require("ramda");

var R = _interopRequireWildcard(_ramda);

var _moment = require("moment");

var _moment2 = _interopRequireDefault(_moment);

var _helpers = require("awpteamoose/helpers");

var H = _interopRequireWildcard(_helpers);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

require("source-map-support").install();

const db = new _nodeJsonDb2.default("DB", true, true);

if (!process.argv[2]) {
	console.log("Usage: discord-pugbot [--init | --run]");
	process.exit(0);
}

if (process.argv[2] === "--init") {
	fs.writeFileSync("config.json5", fs.readFileSync(`${__dirname}/../config.json5`));
	if (!fs.existsSync("assets")) fs.mkdirSync("assets");
	for (let i = 0; i <= 12; i += 1) fs.writeFileSync(`assets/${i}.png`, fs.readFileSync(`${__dirname}/../assets/${i}.png`));
	process.exit(0);
}

if (!process.argv[2] === "--run") process.exit(0);

const config = _json2.default.parse(fs.readFileSync("config.json5").toString());

const pckg = JSON.parse(fs.readFileSync(`${__dirname}/../package.json`, "utf8"));
if (pckg.version !== config.version) {
	let incompatible = false;
	const defaultConfig = _json2.default.parse(fs.readFileSync(`${__dirname}/../config.json5`, "utf8"));
	const oldConfig = {}; // eslint-disable-line

	// Example of schema migration
	// if (!config.version) {
	if (false) {
		// eslint-disable-line
		incompatible = true;
		oldConfig.strings = {};
		oldConfig.strings["add_success"] = config.strings["add_success"];
		oldConfig.strings["status_gather"] = config.strings["status_gather"];
		oldConfig.strings["status_picking"] = config.strings["status_picking"];

		config.strings["add_success"] = defaultConfig.strings["add_success"];
		config.strings["status_gather"] = defaultConfig.strings["status_gather"];
		config.strings["status_picking"] = defaultConfig.strings["status_picking"];
	}

	if (incompatible) {
		// $FlowFixMe
		const res = _json2.default.stringify(oldConfig, undefined, "\t").replace(/\\t/g, "\t").replace(/\\n/g, "\\n\\\n");
		fs.writeFileSync("config.old.json5", res);

		console.log("Your config version doesn't match the package, probably it was created with an older version");
		console.log("All the incompatible settings were copied to config.old.json5");
		console.log("Please fix the issues and restart.");

		process.exit(0);
	}
}

function tryGet(jdb, dataPath, fallback) {
	try {
		return jdb.getData(dataPath);
	} catch (e) {
		return fallback;
	}
}
const client = new Discord.Client();

const icons = R.repeat(0, 13).map((_, i) => fs.readFileSync(`assets/${i}.png`)); // 0.png .. 12.png

// * Some helper functions * \\
const unindent = R.mapObjIndexed(str => str.replace(/\t+/g, ""));

const mentionToUserID = mention => {
	const id = mention.match(/(?:<@|<@!)(\d+)(?:>)/);
	if (!id) return;
	return id[1];
};

let templateString;

const realName = (guild, userResolvable) => {
	const member = guild.member(userResolvable);
	if (!member) return `<@${userResolvable.toString()}> (${templateString("not_server_member")})`;
	if (member.nickname) return member.nickname;
	return member.user.username;
};

const unready = players => players.filter(player => player.state !== "Ready");

const ready = players => players.filter(player => player.state === "Ready");

const team = teamID => players => players.filter(player => player.team === teamID);

const available = players => players.filter(player => player.team === 0);

const captainOf = teamID => players => players.find(player => player.team === teamID && player.state === "Captain");

const mapVotes = players => {
	return R.pipe(R.filter(player => player.mapVote >= 0), // disregard players that haven't voted
	R.map(player => config.maps[player.mapVote]), R.reduce((acc, map) => {
		const e = acc.find(entry => entry.map === map);
		if (e) e.votes += 1;
		return acc;
	}, R.pipe(R.map(makeMapEntry))(config.maps)), R.sort((a, b) => b.votes - a.votes))(players);
};

const mapWinner = players => R.pipe(mapVotes, R.filter(entry => entry.votes === mapVotes(players)[0].votes), H.pickRandom)(players);
// * * * * * \\

const makeMapEntry = map => {
	return { map, votes: 0 };
};

const makePlayer = user => {
	return {
		user,
		state: "SignedUp",
		team: 0,
		mapVote: -1
	};
};

const makeState = () => {
	return {
		phase: "Gather",
		players: [],
		picker: undefined,
		picksRemaining: 0,
		readyFinished: () => {},
		picksFinished: () => {}
	};
};
const resetState = state => {
	state.readyFinished();
	state.picksFinished();
	state.phase = "Gather";
	state.players = [];
	state.picker = undefined;
	state.picksRemaining = 0;
	state.readyFinished = () => {};
	state.picksFinished = () => {};
};

const states = {};

const commands = {};
commands.me = (msg, channel, args) => {
	const datapath = `/${msg.guild.id}/${channel.id}/users/${msg.author.id}`;
	if (args.length === 0) {
		const info = tryGet(db, `${datapath}/info`);
		if (info) msg.reply(templateString("me_print", { info }));else msg.reply(templateString("me_no_data"));
	} else {
		db.push(`${datapath}/info`, args.join(" "));
		msg.reply(templateString("me_saved"));
	}
};
commands.who = (msg, channel, args) => {
	if (!args[0]) return;
	const id = mentionToUserID(args[0]);
	if (!id) return;
	const name = realName(msg.guild, id);
	const info = tryGet(db, `/${msg.guild.id}/${channel.id}/users/${id}/info`);

	if (info) msg.reply(templateString("who_print", { name, info }));else msg.reply(templateString("who_no_data", { name }));
};
commands.fatkid = (msg, channel, args) => {
	if (args.length === 0) {
		const fatkidTimes = tryGet(db, `/${msg.guild.id}/${channel.id}/users/${msg.author.id}/fatkid`);
		if (!fatkidTimes) msg.reply(templateString("fatkid_me_never"));else msg.reply(templateString("fatkid_me_print", { fatkidTimes }));
	} else {
		const id = mentionToUserID(args[0]);
		if (!id) return;
		const fatkidTimes = tryGet(db, `/${msg.guild.id}/${channel.id}/users/${id}/fatkid`);
		if (!fatkidTimes) msg.reply(templateString("fatkid_never", { name: realName(msg.guild, id) }));else msg.reply(templateString("fatkid_print", { fatkidTimes, name: realName(msg.guild, id) }));
	}
};

commands.top10 = (msg, channel) => {

	const players = tryGet(db, `/${msg.guild.id}/${channel.id}/users`, {});
	const top10 = R.pipe(R.keys, R.map(id => {
		const player = players[id] || {};
		return { name: realName(msg.guild, id), gamesPlayed: player.gamesPlayed || 0 };
	}), R.filter(p => p.gamesPlayed > 0), R.sort((a, b) => b.gamesPlayed - a.gamesPlayed), R.take(10))(players);

	if (top10.length === 0) msg.reply(templateString("top10_no_games"));else msg.reply(templateString("top10_print", { top10 }));
};

const startReady = (() => {
	var _ref = _asyncToGenerator(function* (channel, state) {
		state.phase = "ReadyUp";

		channel.send(templateString("ready_alert"));

		let readyFinished = false;
		state.readyFinished = function () {
			readyFinished = true;
		};
		yield H.delay(1000 * 60);
		if (readyFinished) return;

		channel.send(templateString("ready_timeout"));
		state.players = ready(state.players);
		state.players.forEach(function (player) {
			return player.state = "SignedUp";
		});
		state.phase = "Gather";

		if (config.updateIcon && config.pugChannels[0] === channel.name) channel.guild.setIcon(icons[state.players.length]);
	});

	return function startReady(_x, _x2) {
		return _ref.apply(this, arguments);
	};
})();

const startPicking = (() => {
	var _ref2 = _asyncToGenerator(function* (channel, state) {
		state.phase = "Picking";

		state.readyFinished();
		state.readyFinished = function () {};

		for (let i = 1; i <= 2; i += 1) {
			const captain = R.pipe(available, H.pickRandom)(state.players);
			captain.state = "Captain";
			captain.team = i;
		}

		channel.send(templateString("starting"));

		state.picker = captainOf(1)(state.players);
		state.picksRemaining = 1;

		let picksFinished = false;
		state.picksFinished = function () {
			picksFinished = true;
		};
		yield H.delay(5 * 1000 * 60);
		if (picksFinished) return;
		channel.send(templateString("picking_timeout"));
		resetState(state);

		if (config.updateIcon && config.pugChannels[0] === channel.name) channel.guild.setIcon(icons[state.players.length]);
	});

	return function startPicking(_x3, _x4) {
		return _ref2.apply(this, arguments);
	};
})();

const startGame = (channel, state) => {
	if (config.mapVoting) channel.send(templateString("lets_go", { map: mapWinner(state.players).map }));else channel.send(templateString("lets_go"));

	R.pipe(R.map(player => player.user.id), R.forEach(id => {
		const gamesPath = `/${channel.guild.id}/${channel.id}/users/${id}/gamesPlayed`;
		const gamesPlayed = tryGet(db, gamesPath, 0);
		db.push(gamesPath, gamesPlayed + 1);
	}))(state.players);

	const match = {
		when: (0, _moment2.default)().toJSON(),
		teams: R.pipe(R.map(t => R.pipe(team(t), R.map(player => {
			return { id: player.user.id, captain: player.state === "Captain" };
		}))(state.players)))([1, 2])
	};

	const matchesPath = `/${channel.guild.id}/${channel.id}/matches`;
	const matches = tryGet(db, matchesPath, []);
	matches.push(match);
	db.push(matchesPath, matches);

	resetState(state);

	if (config.updateIcon && config.pugChannels[0] === channel.name) channel.guild.setIcon(icons[state.players.length]);
};

commands.add = (msg, channel, args, state) => {
	if (state.phase !== "Gather") return;

	if (state.players.find(player => player.user.id === msg.author.id)) {
		msg.reply(templateString("already_added"));
		return;
	}

	// Allow custom teamSize
	if (state.players.length === 0) {
		state.teamSize = config.customTeamSize ? Number(args[0]) : config.teamSize;
	}

	if (state.players.length === 0 && isNaN(state.teamSize)) {
		state.teamSize = config.teamSize;
	}

	state.players.push(makePlayer(msg.author));
	msg.reply(templateString("add_success"));

	if (config.updateIcon && config.pugChannels[0] === channel.name) msg.guild.setIcon(icons[state.players.length]);

	if (state.players.length === state.teamSize * 2) startReady(channel, state);
};
commands.join = commands.add;

commands.remove = (msg, channel, args, state) => {
	if (state.phase !== "Gather") return;

	const idx = state.players.findIndex(player => player.user.id === msg.author.id);
	if (idx === -1) {
		msg.reply(templateString("not_added"));
		return;
	}

	state.players.splice(idx, 1);
	msg.reply(templateString("removed"));

	if (config.updateIcon && config.pugChannels[0] === channel.name) msg.guild.setIcon(icons[state.players.length]);
};

commands.ready = (msg, channel, args, state) => {
	if (state.phase !== "ReadyUp") return;
	const thisPlayer = state.players.find(player => player.user.id === msg.author.id);

	if (!thisPlayer) {
		msg.reply(templateString("ready_error_not_playing"));
		return;
	}
	if (thisPlayer.state === "Ready") {
		msg.reply(templateString("ready_error_already"));
		return;
	}
	thisPlayer.state = "Ready";
	msg.reply(templateString("ready_success"));

	if (ready(state.players).length === state.teamSize * 2) startPicking(channel, state);
};
commands.r = commands.ready;

commands.pick = (msg, channel, args, state) => {
	if (state.phase !== "Picking") return;
	if (!state.picker) throw new Error("Picking phase without a picker");
	if (msg.author.id !== state.picker.user.id) return;
	const id = Number(args[0]) - 1;
	if (isNaN(id)) {
		msg.reply(templateString("pick_error_NaN"));
		return;
	}
	if (!state.players[id] || state.players[id].state === "Captain") {
		msg.reply(templateString("pick_error_wrong_number"));
		return;
	}
	if (state.players[id].state === "Picked") {
		msg.reply(templateString("pick_error_already_picked"));
		return;
	}

	const picked = state.players[id];
	picked.state = "Picked";
	if (!state.picker) throw new Error("NO PICKER WUT");

	picked.team = state.picker.team;
	state.picksRemaining -= 1;

	if (state.picksRemaining === 0) {
		state.picksRemaining = 2;
		state.picker = captainOf(state.picker.team === 1 ? 2 : 1)(state.players);
	}

	if (available(state.players).length === 1) {
		const fatkid = available(state.players)[0];
		fatkid.state = "Picked";
		if (!state.picker) throw new Error("NO PICKER WUT");
		fatkid.team = state.picker.team;

		const fatkidPath = `/${msg.guild.id}/${channel.id}/users/${fatkid.user.id}/fatkid`;
		const fatkidTimes = tryGet(db, fatkidPath, 0);
		db.push(fatkidPath, fatkidTimes + 1);

		state.picksFinished();
		state.picksFinished = () => {};
		state.picker = undefined;

		startGame(channel, state);
		return;
	}

	channel.send(templateString("picks_remaining"));
};
commands.p = commands.pick;

commands.maps = msg => {
	if (!config.mapVoting) return;
	msg.reply(templateString("map_list"));
};

commands.votemap = (msg, channel, args, state) => {
	if (!config.mapVoting) return;
	const idx = state.players.findIndex(player => player.user.id === msg.author.id);
	if (idx === -1) {
		msg.reply(templateString("map_error_not_added"));
		return;
	}

	const mapID = Number(args[0]) - 1; // our list is 1-indexed
	if (isNaN(mapID)) {
		msg.reply(templateString("map_error_NaN"));
		return;
	}

	const map = config.maps[mapID];
	if (!map) {
		msg.reply(templateString("map_error_wrong_map"));
		return;
	}

	state.players[idx].mapVote = mapID;
	msg.reply(templateString("map_vote_success", { map }));
};

commands.status = (msg, channel, args, state) => {
	switch (state.phase) {
		case "Gather":
			if (state.players.length > 0) msg.reply(templateString("status_gather"));else msg.reply(templateString("status_gather_empty"));
			break;
		case "ReadyUp":
			msg.reply(templateString("status_ready"));
			break;
		case "Picking":
			channel.send(templateString("status_picking"));
			break;
		default:
			throw new Error("WTF PHASE IS FUCKED UP");
	}
};

commands.help = msg => {
	msg.reply(templateString("help"));return;
};

commands.reset = (msg, channel, args, state) => {
	if (!msg.member.hasPermission("ADMINISTRATOR")) return;
	msg.reply(templateString("reset"));
	resetState(state);

	if (config.updateIcon && config.pugChannels[0] === channel.name) msg.guild.setIcon(icons[state.players.length]);
};

commands.force = (msg, channel, args, state) => {
	if (!msg.member.hasPermission("ADMINISTRATOR")) return;

	const id = mentionToUserID(args[0]);
	if (!id) return;

	const member = msg.guild.member(id);
	if (!member) return;

	msg.member = member;
	msg.author = member.user;
	if (commands[args[1]]) commands[args[1]](msg, channel, args.slice(2), state);
};

commands.mock = (msg, channel, args, state) => {
	if (!msg.member.hasPermission("ADMINISTRATOR")) return;

	const id = Number(args[0]);

	if (!config.mockUsers) return;
	const mockMember = msg.guild.member(config.mockUsers[id - 1]);
	if (!mockMember) throw new Error();
	msg.member = mockMember;
	msg.author = mockMember.user;
	if (commands[args[1]]) commands[args[1]](msg, channel, args.slice(2), state);
};
commands.m = commands.mock;

commands.mocks = (msg, channel, args, state) => {
	if (!config.mockUsers) return;
	const mockUsers = config.mockUsers;
	if (!msg.member.hasPermission("ADMINISTRATOR")) return;

	if (args[0] === "pick") {
		while (state.picker) {
			msg.author = state.picker.user;
			const randomAvailable = R.pipe(available, H.pickRandom)(state.players);
			args[1] = (state.players.findIndex(player => player.user.id === randomAvailable.user.id) + 1).toString();
			commands.pick(msg, channel, args.slice(1), state);
		}
		return;
	}

	if (args[0] === "votemap") {
		for (let i = 0; i < state.teamSize * 2; i += 1) {
			const mockMember = msg.guild.member(mockUsers[i]);
			if (!mockMember) throw new Error();
			msg.member = mockMember;
			msg.author = mockMember.user;
			args[1] = (H.randomIndex(config.maps) + 1).toString();
			commands.votemap(msg, channel, args.slice(1), state);
		}
		return;
	}

	for (let i = 0; i < state.teamSize * 2; i += 1) {
		const mockMember = msg.guild.member(mockUsers[i]);
		if (!mockMember) throw new Error();
		msg.member = mockMember;
		msg.author = mockMember.user;
		if (commands[args[0]]) commands[args[0]](msg, channel, args.slice(1), state);
	}
};
commands.ms = commands.mocks;

commands.invite = (msg, channel, args, state) => {
	if (config.clientId) {
		msg.reply(templateString("invite"));
	}
};

// commands.eval = (msg, args, state) => {
//     if (msg.author.id !== "96338667253006336") return;
//     try { msg.reply(eval(args.join(" "))); } catch (e) { }; // tslint:disable-line
// };

function addGuild(guild) {
	if (config.updateIcon) guild.setIcon(icons[0]);

	return initStateForGuild(guild);
}

function initStateForGuild(guild) {
	var channelsFound = false;
	guild.channels.forEach(channel => {
		if (channel.type !== "text") return;
		if (!config.pugChannels.some(name => name === channel.name)) return;
		states[channel.id] = makeState();
		channelsFound = true;
	});
	return channelsFound;
}

client.once("ready", () => {
	console.log("Booting up!");

	client.guilds.forEach(guild => {
		if (!addGuild(guild)) {
			guild.defaultChannel.sendMessage(ejs.render(unindent(config.strings).channels_not_found, _extends({}, config)));
			guild.owner.sendMessage(ejs.render(unindent(config.strings).channels_not_found, _extends({}, config)));
		}
	});

	client.on("message", msg => {
		if (msg.author.id === client.user.id) return; // don't react to my own messages
		const channel = msg.channel.type === "text" ? msg.channel : undefined;
		if (!channel) return; // only care about text channels
		const state = states[msg.channel.id];
		if (!state) return; // not a pug channel
		if (msg.content[0] !== config.commandDelimeter) return; // not a command
		let args = msg.content.split(" ");
		const command = args[0].substring(1); // strip away the command delimeter
		args = args.splice(1); // don't really care about the command itself

		templateString = (str, extraData) => {
			const templateData = {
				listNames: players => players.reduce((acc, player) => `${acc}${realName(msg.guild, player.user)}, `, "").slice(0, -2),
				listMentions: players => players.reduce((acc, player) => `${acc}${player.user.toString()}, `, "").slice(0, -2),
				ready: () => ready(state.players),
				unready: () => unready(state.players),
				isCaptain: player => player.state === "Captain",
				captain1: () => {
					const cap = captainOf(1)(state.players);return cap && cap.user;
				},
				captain2: () => {
					const cap = captainOf(2)(state.players);return cap && cap.user;
				},
				team1: () => team(1)(state.players),
				team2: () => team(2)(state.players),
				mapVotes: () => mapVotes(state.players).filter(e => e.votes > 0),
				last: () => {
					const matches = tryGet(db, `/${msg.guild.id}/${msg.channel.id}/matches`, []);
					if (matches.length === 0) return templateString("never");
					const last = R.last(matches);
					if (!last) throw new Error();
					return (0, _moment2.default)(last.when).locale(config.locale).fromNow();
				}
			};

			if (unindent(config.strings)[str]) return ejs.render(unindent(config.strings)[str], _extends({}, config, state, templateData, extraData));
			return ejs.render(str, _extends({}, config, state, templateData, extraData));
		};

		if (commands[command]) commands[command](msg, channel, args, state);
	});
});

client.on("ready", () => {
	console.log("Ready!");
});

client.on("disconnect", () => {
	console.log("Disconnected!");
});

client.on('guildCreate', function (guild) {
	if (!addGuild(guild)) {
		guild.defaultChannel.sendMessage(ejs.render(unindent(config.strings).channels_not_found, _extends({}, config)));
		guild.owner.sendMessage(ejs.render(unindent(config.strings).channels_not_found, _extends({}, config)));
	}
});

client.on('channelUpdate', function (channel) {
	if (channel.guild) {
		initStateForGuild(channel.guild);
	}
});

client.on('channelCreate', function (channel) {
	if (channel.guild) {
		initStateForGuild(channel.guild);
	}
});

client.login(config.botToken);
//# sourceMappingURL=index.js.map