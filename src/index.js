#!/usr/bin/env node
import "babel-polyfill";
require("source-map-support").install();

import * as fs from "fs";
import * as Discord from "discord.js";
import JSON5 from "json5";
import JsonDB from "node-json-db";
import * as ejs from "ejs";
import * as R from "ramda";
import moment from "moment";
import * as H from "awpteamoose/helpers";

type JSONValue = ?string | ?number | ?boolean | ?JSONObject | ?JSONArray;
type JSONObject = { [key: string]: ?JSONValue };
type JSONArray = Array<JSONValue>;

const db = new JsonDB("DB", true, true);

if (!process.argv[2]) {
	console.log("Usage: discord-pugbot [--init | --run]");
	process.exit(0);
}

if (process.argv[2] === "--init") {
	fs.writeFileSync("config.json5", fs.readFileSync(`${__dirname}/../config.json5`));
	if (!fs.existsSync("assets")) fs.mkdirSync("assets");
	for (let i = 0; i <= 12; i += 1)
		fs.writeFileSync(`assets/${i}.png`, fs.readFileSync(`${__dirname}/../assets/${i}.png`));
	process.exit(0);
}

if (!process.argv[2] === "--run") process.exit(0);

interface Config {
	botToken: string;
	commandDelimeter: string;
	updateIcon: boolean;
	teamSize: number;
	pugChannels: Array<string>;
	mapVoting: boolean;
	maps: Array<string>;
	mockUsers: ?Array<string>;
	locale: string;
	strings: { [key: string]: string };
	version: string;
}

const config: Config = JSON5.parse(fs.readFileSync("config.json5").toString());

const pckg = JSON.parse(fs.readFileSync(`${__dirname}/../package.json`, "utf8"));
if (pckg.version !== config.version) {
	let incompatible = false;
	const defaultConfig: Config = JSON5.parse(fs.readFileSync(`${__dirname}/../config.json5`, "utf8"));
	const oldConfig: any = {}; // eslint-disable-line

	// Example of schema migration
	// if (!config.version) {
	if (false) { // eslint-disable-line
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
		const res = JSON5.stringify(oldConfig, undefined, "\t").replace(/\\t/g, "\t").replace(/\\n/g, "\\n\\\n");
		fs.writeFileSync("config.old.json5", res);

		console.log("Your config version doesn't match the package, probably it was created with an older version");
		console.log("All the incompatible settings were copied to config.old.json5");
		console.log("Please fix the issues and restart.");

		process.exit(0);
	}
}

declare function tryGet<T>(jdb: JsonDB, dataPath: string, fallback: T): T;
declare function tryGet(jdb: JsonDB, dataPath: string): JSONValue;
function tryGet<T>(jdb: JsonDB, dataPath: string, fallback?: T): JSONValue | T {
	try {
		return jdb.getData(dataPath);
	} catch (e) {
		return fallback;
	}
}
const client = new Discord.Client();

type TemplateKey = "reset" | "never" | "not_server_member" | "me_print" | "me_no_data" | "me_saved" | "who_print" | "who_no_data" |
	"ready_alert" | "ready_timeout" | "starting" | "picking_timeout" | "lets_go" | "already_added" | "add_success" | "not_added" |
	"removed" | "ready_error_not_playing" | "ready_error_already" | "ready_success" | "pick_error_NaN" |
	"pick_error_wrong_number" | "pick_error_already_picked" | "picks_remaining" | "map_list" | "map_error_not_added" |
	"map_error_NaN" | "map_error_wrong_map" | "map_vote_success" | "status_gather" | "status_gather_empty" |
	"status_ready" | "status_picking" | "help" | "fatkid_me_never" | "fatkid_me_print" | "fatkid_never" | "fatkid_print" |
	"top10_no_games" | "top10_print";

const icons = R.repeat(0, 13).map((_, i) => fs.readFileSync(`assets/${i}.png`)); // 0.png .. 12.png

// * Some helper functions * \\
const unindent = R.mapObjIndexed((str: string): string => str.replace(/\t+/g, ""));

const mentionToUserID = (mention: string): ?string => {
	const id = mention.match(/(?:<@|<@!)(\d+)(?:>)/);
	if (!id) return;
	return id[1];
};

let templateString: (str: TemplateKey, extraData?: {}) => string;

const realName = (guild: Discord.Guild, userResolvable: Discord.UserResolvable): string => {
	const member = guild.member(userResolvable);
	if (!member) return `<@${userResolvable.toString()}> (${templateString("not_server_member")})`;
	if (member.nickname) return member.nickname;
	return member.user.username;
};

const unready = (players: Array<Player>): Array<Player> =>
	players.filter((player) => player.state !== "Ready");

const ready = (players: Array<Player>): Array<Player> =>
	players.filter((player) => player.state === "Ready");

const team = (teamID: number) => (players: Array<Player>): Array<Player> =>
	players.filter((player) => player.team === teamID);

const available = (players: Array<Player>): Array<Player> =>
	players.filter((player) => player.team === 0);

const captainOf = (teamID: number) => (players: Array<Player>) =>
	players.find((player) => player.team === teamID && player.state === "Captain");

const mapVotes = (players: Array<Player>): Array<MapEntry> => {
	return R.pipe(
		R.filter((player: Player) => player.mapVote >= 0), // disregard players that haven't voted
		R.map((player: Player): string => config.maps[player.mapVote]),
		R.reduce((acc: Array<MapEntry>, map: string) => {
			const e = acc.find((entry) => entry.map === map);
			if (e) e.votes += 1;
			return acc;
		}, R.pipe(R.map(makeMapEntry))(config.maps)),
		R.sort((a: MapEntry, b: MapEntry) => b.votes - a.votes)
	)(players);
};

const mapWinner = (players: Array<Player>): MapEntry => R.pipe(
	mapVotes,
	R.filter((entry: MapEntry) => entry.votes === mapVotes(players)[0].votes),
	H.pickRandom,
)(players);
// * * * * * \\

type Phase = "Gather" | "ReadyUp" | "Picking";
type PlayerState = "SignedUp" | "Ready" | "Picked" | "Captain";

type MapEntry = {|
	map: string;
	votes: number;
|};
const makeMapEntry = (map: string): MapEntry => { return { map, votes: 0 }; };

type Player = {|
	state: PlayerState;
	team: number;
	mapVote: number;
	user: Discord.User;
|};
const makePlayer = (user: Discord.User): Player => {
	return {
		user,
		state: "SignedUp",
		team: 0,
		mapVote: -1,
	};
};

type State = {|
	phase: Phase;
	players: Array<Player>;
	picker: ?Player;
	picksRemaining: number;
	teamSize: number;
	readyFinished: () => void;
	picksFinished: () => void;
|};
const makeState = (): State => {
	return {
		phase: "Gather",
		players: [],
		picker: undefined,
		picksRemaining: 0,
		readyFinished: () => {},
		picksFinished: () => {},
	};
};
const resetState = (state: State) => {
	state.readyFinished();
	state.picksFinished();
	state.phase = "Gather";
	state.players = [];
	state.picker = undefined;
	state.picksRemaining = 0;
	state.readyFinished = () => {};
	state.picksFinished = () => {};
};

const states: { [key: string]: State } = {};
type Command = (msg: Discord.Message, channel: Discord.TextChannel, args: Array<string>, state: State) => void;
const commands: { [key: string]: Command } = {};
commands.me = (msg, channel, args) => {
	const datapath = `/${msg.guild.id}/${channel.id}/users/${msg.author.id}`;
	if (args.length === 0) {
		const info = tryGet(db, `${datapath}/info`);
		if (info) msg.reply(templateString("me_print", { info }));
		else msg.reply(templateString("me_no_data"));
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

	if (info) msg.reply(templateString("who_print", { name, info }));
	else msg.reply(templateString("who_no_data", { name }));
};
commands.fatkid = (msg, channel, args) => {
	if (args.length === 0) {
		const fatkidTimes = tryGet(db, `/${msg.guild.id}/${channel.id}/users/${msg.author.id}/fatkid`);
		if (!fatkidTimes)
			msg.reply(templateString("fatkid_me_never"));
		else
			msg.reply(templateString("fatkid_me_print", { fatkidTimes }));
	} else {
		const id = mentionToUserID(args[0]);
		if (!id) return;
		const fatkidTimes = tryGet(db, `/${msg.guild.id}/${channel.id}/users/${id}/fatkid`);
		if (!fatkidTimes)
			msg.reply(templateString("fatkid_never", { name: realName(msg.guild, id) }));
		else
			msg.reply(templateString("fatkid_print", { fatkidTimes, name: realName(msg.guild, id) }));
	}
};

commands.top10 = (msg, channel) => {
	interface PlayerData {
		name: string;
		gamesPlayed: number;
	}

	const players = tryGet(db, `/${msg.guild.id}/${channel.id}/users`, ({}: JSONObject));
	const top10 = R.pipe(
		R.keys,
		R.map((id) => {
			const player = players[id] || { };
			return { name: realName(msg.guild, id), gamesPlayed: (player.gamesPlayed: number) || 0 };
		}),
		R.filter((p: PlayerData) => p.gamesPlayed > 0),
		R.sort((a: PlayerData, b: PlayerData) => b.gamesPlayed - a.gamesPlayed),
		R.take(10),
	)(players);

	if (top10.length === 0)
		msg.reply(templateString("top10_no_games"));
	else
		msg.reply(templateString("top10_print", { top10 }));
};

const startReady = async (channel: Discord.TextChannel, state: State): Promise<void> => {
	state.phase = "ReadyUp";

	channel.send(templateString("ready_alert"));

	let readyFinished = false;
	state.readyFinished = () => {
		readyFinished = true;
	};
	await H.delay(1000 * 60);
	if (readyFinished) return;

	channel.send(templateString("ready_timeout"));
	state.players = ready(state.players);
	state.players.forEach((player) => player.state = "SignedUp");
	state.phase = "Gather";

	if (config.updateIcon && config.pugChannels[0] === channel.name)
		channel.guild.setIcon(icons[state.players.length]);
};

const startPicking = async (channel: Discord.TextChannel, state: State): Promise<void> => {
	state.phase = "Picking";

	state.readyFinished();
	state.readyFinished = () => {};

	for (let i = 1; i <= 2; i += 1) {
		const captain = R.pipe(available, H.pickRandom)(state.players);
		captain.state = "Captain";
		captain.team = i;
	}

	channel.send(templateString("starting"));

	state.picker = captainOf(1)(state.players);
	state.picksRemaining = 1;

	let picksFinished = false;
	state.picksFinished = () => {
		picksFinished = true;
	};
	await H.delay(5 * 1000 * 60);
	if (picksFinished) return;
	channel.send(templateString("picking_timeout"));
	resetState(state);

	if (config.updateIcon && config.pugChannels[0] === channel.name)
		channel.guild.setIcon(icons[state.players.length]);
};

interface Match {
	when: string;
	teams: Array<Array<{ id: string; captain: boolean }>>;
}

const startGame = (channel: Discord.TextChannel, state: State): void => {
	if (config.mapVoting)
		channel.send(templateString("lets_go", { map: mapWinner(state.players).map }));
	else
		channel.send(templateString("lets_go"));

	R.pipe(
		R.map((player: Player) => player.user.id),
		R.forEach((id) => {
			const gamesPath = `/${channel.guild.id}/${channel.id}/users/${id}/gamesPlayed`;
			const gamesPlayed = tryGet(db, gamesPath, 0);
			db.push(gamesPath, gamesPlayed + 1);
		}),
	)(state.players);

	const match: Match = {
		when: moment().toJSON(),
		teams: R.pipe(
			R.map((t: number): Array<Player> => R.pipe(
				team(t),
				R.map((player: Player) => { return { id: player.user.id, captain: player.state === "Captain" }; }),
			)(state.players)),
		)([1, 2]),
	};

	const matchesPath = `/${channel.guild.id}/${channel.id}/matches`;
	const matches = tryGet(db, matchesPath, ([]: Array<Match>));
	matches.push(match);
	db.push(matchesPath, matches);

	resetState(state);

	if (config.updateIcon && config.pugChannels[0] === channel.name)
		channel.guild.setIcon(icons[state.players.length]);
};

commands.add = (msg, channel, args, state) => {
	if (state.phase !== "Gather") return;

	if (state.players.find((player) => player.user.id === msg.author.id)) {
		msg.reply(templateString("already_added"));
		return;
	}

	// Allow custom teamSize
	if(state.players.length === 0) {
		state.teamSize = config.customTeamSize ? Number(args[0]) : config.teamSize;
	}

	if(state.players.length === 0 && isNaN(state.teamSize)) {
		state.teamSize = config.teamSize;
	}

	state.players.push(makePlayer(msg.author));
	msg.reply(templateString("add_success"));

	if (config.updateIcon && config.pugChannels[0] === (channel: Discord.TextChannel).name)
		msg.guild.setIcon(icons[state.players.length]);

	if (state.players.length === state.teamSize * 2)
		startReady((channel: Discord.TextChannel), state);
};
commands.join = commands.add;

commands.remove = (msg, channel, args, state) => {
	if (state.phase !== "Gather") return;

	const idx = state.players.findIndex((player) => player.user.id === msg.author.id);
	if (idx === -1) {
		msg.reply(templateString("not_added"));
		return;
	}

	state.players.splice(idx, 1);
	msg.reply(templateString("removed"));

	if (config.updateIcon && config.pugChannels[0] === (channel: Discord.TextChannel).name)
		msg.guild.setIcon(icons[state.players.length]);
};

commands.ready = (msg, channel, args, state) => {
	if (state.phase !== "ReadyUp") return;
	const thisPlayer = state.players.find((player) => player.user.id === msg.author.id);

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

	if (ready(state.players).length === state.teamSize * 2)
		startPicking((channel: Discord.TextChannel), state);
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

		startGame((channel: Discord.TextChannel), state);
		return;
	}

	channel.send(templateString("picks_remaining"));
};
commands.p = commands.pick;

commands.maps = (msg) => {
	if (!config.mapVoting) return;
	msg.reply(templateString("map_list"));
};

commands.votemap = (msg, channel, args, state) => {
	if (!config.mapVoting) return;
	const idx = state.players.findIndex((player) => player.user.id === msg.author.id);
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
			if (state.players.length > 0)
				msg.reply(templateString("status_gather"));
			else
				msg.reply(templateString("status_gather_empty"));
			break;
		case "ReadyUp":
			msg.reply(templateString("status_ready"));
			break;
		case "Picking":
			channel.send(templateString("status_picking"));
			break;
		default: throw new Error("WTF PHASE IS FUCKED UP");
	}
};

commands.help = (msg) => { msg.reply(templateString("help")); return; };

commands.reset = (msg, channel, args, state) => {
	if (!msg.member.hasPermission("ADMINISTRATOR")) return;
	msg.reply(templateString("reset"));
	resetState(state);

	if (config.updateIcon && config.pugChannels[0] === (channel: Discord.TextChannel).name)
		msg.guild.setIcon(icons[state.players.length]);
};

commands.force = (msg, channel, args, state) => {
	if (!msg.member.hasPermission("ADMINISTRATOR")) return;

	const id = mentionToUserID(args[0]);
	if (!id) return;

	const member = msg.guild.member(id);
	if (!member) return;

	msg.member = member;
	msg.author = member.user;
	if (commands[args[1]])
		commands[args[1]](msg, channel, args.slice(2), state);
};

commands.mock = (msg, channel, args, state) => {
	if (!msg.member.hasPermission("ADMINISTRATOR")) return;

	const id = Number(args[0]);

	if (!config.mockUsers) return;
	const mockMember = msg.guild.member(config.mockUsers[id - 1]);
	if (!mockMember) throw new Error();
	msg.member = mockMember;
	msg.author = mockMember.user;
	if (commands[args[1]])
		commands[args[1]](msg, channel, args.slice(2), state);
};
commands.m = commands.mock;

commands.mocks = (msg, channel, args, state) => {
	if (!config.mockUsers) return;
	const mockUsers: Array<string> = config.mockUsers;
	if (!msg.member.hasPermission("ADMINISTRATOR")) return;

	if (args[0] === "pick") {
		while (state.picker) {
			msg.author = state.picker.user;
			const randomAvailable = R.pipe(available, H.pickRandom)(state.players);
			args[1] = (state.players.findIndex((player) => player.user.id === randomAvailable.user.id) + 1).toString();
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
		if (commands[args[0]])
			commands[args[0]](msg, channel, args.slice(1), state);
	}
};
commands.ms = commands.mocks;

commands.invite = (msg, channel, args, state) => {
	if(config.clientId) {
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
	guild.channels.forEach((channel) => {
		if (channel.type !== "text") return;
		if (!config.pugChannels.some((name) => name === channel.name)) return;
		states[channel.id] = makeState();
		channelsFound = true;
	});
	return channelsFound;
}

client.once("ready", () => {
	console.log("Booting up!");

	client.guilds.forEach((guild) => {
		if(!addGuild(guild)) {
	    	guild.defaultChannel.sendMessage(ejs.render(unindent(config.strings).channels_not_found, { ...config }));
	    	guild.owner.sendMessage(ejs.render(unindent(config.strings).channels_not_found, { ...config }));
	    }
	});

	client.on("message", (msg: Discord.Message) => {
		if (msg.author.id === client.user.id) return; // don't react to my own messages
		const channel: ?Discord.TextChannel = (msg.channel.type === "text") ? msg.channel : undefined;
		if (!channel) return; // only care about text channels
		const state = states[msg.channel.id];
		if (!state) return; // not a pug channel
		if (msg.content[0] !== config.commandDelimeter) return; // not a command
		let args = msg.content.split(" ");
		const command = args[0].substring(1); // strip away the command delimeter
		args = args.splice(1); // don't really care about the command itself

		templateString = (str, extraData) => {
			const templateData = {
				listNames: (players: Array<Player>): string => players.reduce((acc, player) =>
					`${acc}${realName(msg.guild, player.user)}, `, "").slice(0, -2),
				listMentions: (players: Array<Player>): string => players.reduce((acc, player) =>
					`${acc}${player.user.toString()}, `, "").slice(0, -2),
				ready: () => ready(state.players),
				unready: () => unready(state.players),
				isCaptain: (player: Player): boolean => player.state === "Captain",
				captain1: () => { const cap = captainOf(1)(state.players); return cap && cap.user; },
				captain2: () => { const cap = captainOf(2)(state.players); return cap && cap.user; },
				team1: () => team(1)(state.players),
				team2: () => team(2)(state.players),
				mapVotes: () => mapVotes(state.players).filter((e: MapEntry) => e.votes > 0),
				last: () => {
					const matches = tryGet(db, `/${msg.guild.id}/${msg.channel.id}/matches`, ([]: Array<Match>));
					if (matches.length === 0) return templateString("never");
					const last = R.last(matches);
					if (!last) throw new Error();
					return moment(last.when).locale(config.locale).fromNow();
				},
			};

			if (unindent(config.strings)[str])
				return ejs.render(unindent(config.strings)[str], { ...config, ...state, ...templateData, ...extraData });
			return ejs.render(str, { ...config, ...state, ...templateData, ...extraData });
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

client.on('guildCreate', function(guild) {
    if(!addGuild(guild)) {
    	guild.defaultChannel.sendMessage(ejs.render(unindent(config.strings).channels_not_found, { ...config }));
    	guild.owner.sendMessage(ejs.render(unindent(config.strings).channels_not_found, { ...config }));
    }
});

client.on('channelUpdate', function(channel) {
	if(channel.guild) {
    	initStateForGuild(channel.guild);
    }
});

client.on('channelCreate', function(channel) {
	if(channel.guild) {
    	initStateForGuild(channel.guild);
    }
});

client.login(config.botToken);
