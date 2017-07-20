#!/usr/bin/env node
import "babel-polyfill";

import fs from "fs";
import * as Discord from "discord.js";
import JsonDB from "node-json-db";
import R from "ramda";
import moment from "moment";
import { transform } from "babel-core";
import smp from "source-map-support";
import * as H from "helpers";
import baseConfig from "config";

smp.install();

if (!process.argv[2]) {
	console.log("Usage: discord-pugbot [--init | --run]");
	process.exit(0);
}

if (process.argv[2] === "--init") {
	fs.writeFileSync("config.js", fs.readFileSync(`${__dirname}/../src/config.js`));
	if (!fs.existsSync("assets")) fs.mkdirSync("assets");
	for (let i = 0; i <= 12; i += 1)
		fs.writeFileSync(`assets/${i}.png`, fs.readFileSync(`${__dirname}/../assets/${i}.png`));
	process.exit(0);
}

if (!process.argv[2] === "--run") process.exit(0);

// TODO: check with flow
const configFile = fs.readFileSync("config.js").toString().replace(/\t/g, "");
const config: typeof baseConfig = eval(transform(configFile, { extends: `${__dirname}/../.babelrc` }).code);
const db = new JsonDB("DB", true, true);
const client = new Discord.Client();

// const pckg = JSON.parse(fs.readFileSync(`${__dirname}/../package.json`, "utf8"));
// if (pckg.version !== config.version) {
//     let incompatible = false;
//     const defaultConfig: Config = JSON5.parse(fs.readFileSync(`${__dirname}/../config.json5`, "utf8"));
//     const oldConfig: any = {}; // eslint-disable-line

//     if (!config.version) {
//         incompatible = true;
//         oldConfig.strings = {};
//         oldConfig.strings["add_success"] = config.strings["add_success"];
//         oldConfig.strings["status_gather"] = config.strings["status_gather"];
//         oldConfig.strings["status_picking"] = config.strings["status_picking"];

//         config.strings["add_success"] = defaultConfig.strings["add_success"];
//         config.strings["status_gather"] = defaultConfig.strings["status_gather"];
//         config.strings["status_picking"] = defaultConfig.strings["status_picking"];
//     }

//     if (incompatible) {
//         const res = JSON5.stringify(oldConfig, undefined, "\t").replace(/\\t/g, "\t").replace(/\\n/g, "\\n\\\n");
//         fs.writeFileSync("config.old.json5", res);

//         console.log("Your config version doesn't match the package, probably it was created with an older version");
//         console.log("All the incompatible settings were copied to config.old.json5");
//         console.log("Please fix the issues and restart.");

//         process.exit(0);
//     }
// }

const tryGetFallback = <T>(jdb: JsonDB, dataPath: string, fallback: T): T => {
	try {
		return jdb.getData(dataPath);
	} catch (e) {
		return fallback;
	}
};

const tryGetAny = (jdb: JsonDB, dataPath: string): any => {
	try {
		return jdb.getData(dataPath);
	} catch (e) {}
};

const icons = R.repeat(0, 13).map((_, i) => fs.readFileSync(`assets/${i}.png`)); // 0.png .. 12.png

// * Some helper functions * \\
const mentionToUserID = (mention: string): ?string => {
	const id = mention.match(/(?:<@|<@!)(\d+)(?:>)/);
	if (!id) return;
	return id[1];
};

export const realName = (guild: Discord.Guild, userResolvable: Discord.UserResolvable): string => {
	const member = guild.member(userResolvable);
	if (!member) return `<@${userResolvable.toString()}> (${config.strings.notServerMember})`;
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

const captainOf = (teamID: number) => (players: Array<Player>): Player => {
	const captain = players.find((player) => player.team === teamID && player.state === "Captain");
	if (!captain) throw new Error("trying to find a captain when there isn't one");
	return captain;
};

export const mapVotes = (players: Array<Player>, min: number = 0): Array<MapEntry> => {
	return R.pipe(
		R.filter((player: Player) => player.mapVote >= 0), // disregard players that haven't voted
		R.map((player: Player): string => config.maps[player.mapVote]),
		R.reduce((acc: Array<MapEntry>, map: string) => {
			const e = acc.find((entry) => entry.map === map);
			if (e) e.votes += 1;
			return acc;
		}, R.pipe(R.map(makeMapEntry))(config.maps)),
		R.sort((a: MapEntry, b: MapEntry) => b.votes - a.votes),
		R.filter((e: MapEntry) => e.votes >= min),
	)(players);
};

const mapWinner = (players: Array<Player>): MapEntry => R.pipe(
	mapVotes,
	R.filter((entry: MapEntry) => entry.votes === mapVotes(players)[0].votes),
	H.pickRandom,
)(players);
// * * * * * \\

export type MapEntry = {|
	map: string,
	votes: number,
|};
const makeMapEntry = (map: string): MapEntry => { return { map, votes: 0 }; };

export type Player = {|
	state: "SignedUp" | "Ready" | "Picked" | "Captain",
	team: number,
	mapVote: number,
	user: Discord.User,
|};
type PlayerData = {|
	name: string,
	gamesPlayed: number,
|};

const makePlayer = (user: Discord.User): Player => {
	return {
		user,
		state: "SignedUp",
		team: 0,
		mapVote: -1,
	};
};

type Match = {|
	when: string,
	teams: Array<Array<{ id: string, captain: boolean }>>,
|};

export type GatherState = {|
	phase: "Gather",
	players: Array<Player>,
|};

export type ReadyUpState = {|
	phase: "ReadyUp",
	players: Array<Player>,
	readyFinished: () => void,
|};

export type PickingState = {|
	phase: "Picking",
	players: Array<Player>,
	picker: Player,
	picksRemaining: number,
	picksFinished: () => void,
|};

export type State = GatherState | ReadyUpState | PickingState;
const makeState = (): GatherState => {
	return {
		phase: "Gather",
		players: [],
	};
};
const resetState = (state: State) => {
	if (state.phase === "ReadyUp") {
		state.readyFinished();
	} else if (state.phase === "Picking") {
		state.picksFinished();
	}
	state = ((state: any): GatherState);
	state.phase = "Gather";
	state.players = [];
};

const states: { [key: string]: State } = {};
type Command = (msg: Discord.Message, channel: Discord.TextChannel, args: Array<string>, state: State) => mixed;
const commands: { [key: string]: Command } = {};
commands.me = (msg, channel, args) => {
	const datapath = `/${msg.guild.id}/${channel.id}/users/${msg.author.id}`;
	if (args.length === 0) {
		const info = tryGetAny(db, `${datapath}/info`);
		msg.reply(config.strings.me(info));
	} else {
		db.push(`${datapath}/info`, args.join(" "));
		msg.reply(config.strings.meSaved);
	}
};
commands.who = (msg, channel, args) => {
	if (!args[0]) return;
	const id = mentionToUserID(args[0]);
	if (!id) return;
	const name = realName(msg.guild, id);
	const info = tryGetAny(db, `/${msg.guild.id}/${channel.id}/users/${id}/info`);

	msg.reply(config.strings.who(name, info));
};
commands.fatkid = (msg, channel, args) => {
	if (args.length === 0) {
		const fatkidTimes = tryGetFallback(db, `/${msg.guild.id}/${channel.id}/users/${msg.author.id}/fatkid`, 0);
		msg.reply(config.strings.fatkidMe(fatkidTimes));
	} else {
		const id = mentionToUserID(args[0]);
		if (!id) return;
		const fatkidTimes = tryGetFallback(db, `/${msg.guild.id}/${channel.id}/users/${id}/fatkid`, 0);
		msg.reply(config.strings.fatkid(fatkidTimes, realName(msg.guild, id)));
	}
};

commands.top10 = (msg, channel) => {
	const players = tryGetFallback(db, `/${msg.guild.id}/${channel.id}/users`, {});
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

	msg.reply(config.strings.top10(top10));
};

const startReady = async (channel: Discord.TextChannel, state: State): Promise<void> => {
	state = ((state: any): ReadyUpState);
	state.phase = "ReadyUp";

	channel.send(config.strings.readyAlert(unready(state.players)));

	let readyFinished = false;
	state.readyFinished = () => {
		readyFinished = true;
	};
	await H.delay(1000 * 60);
	if (readyFinished) return;

	channel.send(config.strings.readyTimeout(unready(state.players)));
	state = ((state: any): GatherState);
	state.players = ready(state.players);
	state.players.forEach((player) => player.state = "SignedUp");
	state.phase = "Gather";

	if (config.updateIcon && config.pugChannels[0] === channel.name)
		channel.guild.setIcon(icons[state.players.length]);
};

const startPicking = async (channel: Discord.TextChannel, state: State): Promise<void> => {
	if (state.phase !== "ReadyUp") throw new Error();
	state = (state: ReadyUpState);

	state.readyFinished();

	state = ((state: any): PickingState);
	state.phase = "Picking";

	for (let i = 1; i <= 2; i += 1) {
		const captain = R.pipe(available, H.pickRandom)(state.players);
		captain.state = "Captain";
		captain.team = i;
	}

	const captain1 = captainOf(1)(state.players);
	if (!captain1) throw new Error();
	const captain2 = captainOf(2)(state.players);
	if (!captain2) throw new Error();
	channel.send(config.strings.starting(state.players, [captain1, captain2]));

	state.picker = captain1;
	state.picksRemaining = 1;

	let picksFinished = false;
	state.picksFinished = () => {
		picksFinished = true;
	};
	await H.delay(5 * 1000 * 60);
	if (picksFinished) return;
	channel.send(config.strings.pickingTimeout);
	resetState(state);

	if (config.updateIcon && config.pugChannels[0] === channel.name)
		channel.guild.setIcon(icons[state.players.length]);
};

const startGame = (channel: Discord.TextChannel, state: State): void => {
	const team1 = team(1)(state.players);
	const team2 = team(2)(state.players);
	if (config.mapVoting)
		channel.send(config.strings.letsGo(team1, team2, mapWinner(state.players).map));
	else
		channel.send(config.strings.letsGo(team1, team2));

	R.pipe(
		R.map((player: Player) => player.user.id),
		R.forEach((id) => {
			const gamesPath = `/${channel.guild.id}/${channel.id}/users/${id}/gamesPlayed`;
			const gamesPlayed = tryGetFallback(db, gamesPath, 0);
			db.push(gamesPath, gamesPlayed + 1);
		}),
	)(state.players);

	const match: Match = {
		when: moment().toJSON(),
		teams: R.pipe(
			R.map((t: number): Array<{ id: string, captain: boolean }> => R.pipe(
				team(t),
				R.map((player: Player) => { return { id: player.user.id, captain: player.state === "Captain" }; }),
			)(state.players)),
		)([1, 2]),
	};

	const matchesPath = `/${channel.guild.id}/${channel.id}/matches`;
	const matches: Array<Match> = tryGetFallback(db, matchesPath, []);
	matches.push(match);
	db.push(matchesPath, matches);

	resetState(state);

	if (config.updateIcon && config.pugChannels[0] === channel.name)
		channel.guild.setIcon(icons[state.players.length]);
};

commands.add = (msg, channel, args, state) => {
	if (state.phase !== "Gather") return;

	if (state.players.find((player) => player.user.id === msg.author.id)) {
		return msg.reply(config.strings.alreadyAdded(state.players));
	}
	state.players.push(makePlayer(msg.author));
	msg.reply(config.strings.addSuccess(state.players));

	if (config.updateIcon && config.pugChannels[0] === (channel: Discord.TextChannel).name)
		msg.guild.setIcon(icons[state.players.length]);

	if (state.players.length === config.teamSize * 2)
		startReady((channel: Discord.TextChannel), state);
};
commands.join = commands.add;

commands.remove = (msg, channel, args, state) => {
	if (state.phase !== "Gather") return;

	const idx = state.players.findIndex((player) => player.user.id === msg.author.id);
	if (idx === -1) {
		return msg.reply(config.strings.notAdded(state.players));
	}

	state.players.splice(idx, 1);
	msg.reply(config.strings.removed(state.players));

	if (config.updateIcon && config.pugChannels[0] === (channel: Discord.TextChannel).name)
		msg.guild.setIcon(icons[state.players.length]);
};

commands.ready = (msg, channel, args, state) => {
	if (state.phase !== "ReadyUp") return;
	state = (state: ReadyUpState);
	const thisPlayer = state.players.find((player) => player.user.id === msg.author.id);

	if (!thisPlayer) {
		return msg.reply(config.strings.readyErrorNotPlaying(ready(state.players)));
	}
	if (thisPlayer.state === "Ready") {
		return msg.reply(config.strings.readyErrorAlready(ready(state.players)));
	}
	thisPlayer.state = "Ready";
	msg.reply(config.strings.readySuccess(ready(state.players)));

	if (ready(state.players).length === config.teamSize * 2)
		startPicking((channel: Discord.TextChannel), state);
};
commands.r = commands.ready;

commands.pick = (msg, channel, args, state) => {
	if (state.phase !== "Picking") return;
	state = (state: PickingState);

	if (msg.author.id !== state.picker.user.id) return;
	const id = Number(args[0]) - 1;
	if (isNaN(id)) {
		return msg.reply(config.strings.pickErrorNaN);
	}
	if (!state.players[id] || state.players[id].state === "Captain") {
		return msg.reply(config.strings.pickErrorWrongNumber);
	}
	if (state.players[id].state === "Picked") {
		return msg.reply(config.strings.pickErrorAlreadyPicked);
	}

	const picked = state.players[id];
	picked.state = "Picked";

	picked.team = state.picker.team;
	state.picksRemaining -= 1;

	if (state.picksRemaining === 0) {
		state.picksRemaining = 2;
		state.picker = captainOf(state.picker.team === 1 ? 2 : 1)(state.players);
	}

	if (available(state.players).length === 1) {
		const fatkid = available(state.players)[0];
		fatkid.state = "Picked";
		fatkid.team = state.picker.team;

		const fatkidPath = `/${msg.guild.id}/${channel.id}/users/${fatkid.user.id}/fatkid`;
		const fatkidTimes = tryGetFallback(db, fatkidPath, 0);
		db.push(fatkidPath, fatkidTimes + 1);

		state.picksFinished();

		return startGame((channel: Discord.TextChannel), state);
	}

	channel.send(config.strings.picksRemaining(state.players, state.picker, state.picksRemaining));
};
commands.p = commands.pick;

commands.maps = (msg) => {
	if (!config.mapVoting) return;
	msg.reply(config.strings.mapList);
};

commands.votemap = (msg, channel, args, state) => {
	if (!config.mapVoting) return;
	const idx = state.players.findIndex((player) => player.user.id === msg.author.id);
	if (idx === -1) {
		return msg.reply(config.strings.mapErrorNotAdded);
	}

	const mapID = Number(args[0]) - 1; // our list is 1-indexed
	if (isNaN(mapID)) {
		return msg.reply(config.strings.mapErrorNaN);
	}

	const map = config.maps[mapID];
	if (!map) {
		return msg.reply(config.strings.mapErrorWrongMap);
	}

	state.players[idx].mapVote = mapID;
	msg.reply(config.strings.mapVoteSuccess(map, mapVotes(state.players, 1)));
};

commands.status = (msg, channel, args, state) => {
	let line;
	const matches = tryGetFallback(db, `/${msg.guild.id}/${msg.channel.id}/matches`, ([]: Array<Match>));
	if (matches.length === 0) {
		line = config.strings.never;
	} else {
		const last = R.last(matches);
		if (!last) throw new Error();
		line = moment(last.when).locale(config.locale).fromNow();
	}

	if (state.phase === "Gather")
		msg.reply(config.strings.status.Gather(state, msg.guild, line));
	else
		msg.reply(config.strings.status[state.phase](state));
};

commands.help = (msg) => msg.reply(config.strings.help);

commands.reset = (msg, channel, args, state) => {
	if (!msg.member.hasPermission("ADMINISTRATOR")) return;
	msg.reply(config.strings.reset);
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
		while (state.phase === "Picking") {
			msg.author = state.picker.user;
			const randomAvailable = R.pipe(available, H.pickRandom)(state.players);
			args[1] = (state.players.findIndex((player) => player.user.id === randomAvailable.user.id) + 1).toString();
			commands.pick(msg, channel, args.slice(1), state);
		}
		return;
	}

	if (args[0] === "votemap") {
		for (let i = 0; i < config.teamSize * 2; i += 1) {
			const mockMember = msg.guild.member(mockUsers[i]);
			if (!mockMember) throw new Error();
			msg.member = mockMember;
			msg.author = mockMember.user;
			args[1] = (H.randomIndex(config.maps) + 1).toString();
			commands.votemap(msg, channel, args.slice(1), state);
		}
		return;
	}

	for (let i = 0; i < config.teamSize * 2; i += 1) {
		const mockMember = msg.guild.member(mockUsers[i]);
		if (!mockMember) throw new Error();
		msg.member = mockMember;
		msg.author = mockMember.user;
		if (commands[args[0]])
			commands[args[0]](msg, channel, args.slice(1), state);
	}
};
commands.ms = commands.mocks;

// commands.eval = (msg, args, state) => {
//     if (msg.author.id !== "96338667253006336") return;
//     try { msg.reply(eval(args.join(" "))); } catch (e) { }; // tslint:disable-line
// };

client.once("ready", () => {
	console.log("Booting up!");

	client.guilds.forEach((guild) => {
		if (config.updateIcon) guild.setIcon(icons[0]);

		guild.channels.forEach((channel) => {
			if (channel.type !== "text") return;
			if (!config.pugChannels.some((name) => name === channel.name)) return;
			states[channel.id] = makeState();
		});
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

		if (commands[command])
			commands[command](msg, channel, args, state);
	});
});

client.on("ready", () => {
	console.log("Ready!");
});

client.on("disconnect", () => {
	console.log("Disconnected!");
});

client.login(config.botToken);
