import * as smap from "source-map-support"; smap.install();
import * as fs from "fs";
// import { sprintf } from "sprintf-js";
import * as Discord from "discord.js";
import * as JSON5 from "json5";
import JSONDB = require("node-json-db"); // tslint:disable-line
// import * as merge from "deepmerge";
import * as ejs from "ejs";
import * as R from "ramda";
import * as moment from "moment";
import * as H from "awpteamoose/helpers";

const db = new JSONDB("DB", true, true);
const tryGet: {
	<T> (jdb: JSONDB, dataPath: string, fallback: T): T;
	(jdb: JSONDB, dataPath: string): JSONValue;
} = <T> (jdb: JSONDB, dataPath: string, fallback?: T): JSONValue | T => {
	try {
		return jdb.getData(dataPath);
	} catch (e) {
		return fallback;
	}
};
const client = new Discord.Client();

type TemplateKey = "reset" | "never" | "me_print" | "me_no_data" | "me_saved" | "who_print" | "who_no_data" |
	"ready_alert" | "ready_timeout" | "starting" | "picking_timeout" | "lets_go" | "already_added" | "add_success" | "not_added" |
	"removed" | "ready_error_not_playing" | "ready_error_already" | "ready_success" | "pick_error_NaN" |
	"pick_error_wrong_number" | "pick_error_already_picked" | "picks_remaining" | "map_list" | "map_error_not_added" |
	"map_error_NaN" | "map_error_wrong_map" | "map_vote_success" | "status_gather" | "status_gather_empty" |
	"status_ready" | "status_picking" | "help" | "fatkid_me_never" | "fatkid_me_print" | "fatkid_never" | "fatkid_print" |
	"top10_no_games" | "top10_print";

interface Config {
	readonly botToken: string;
	readonly commandDelimeter: string;
	readonly updateIcon: boolean;
	readonly teamSize: number;
	readonly pugChannels: Array<string>;
	readonly mapVoting: boolean;
	readonly maps: Array<string>;
	readonly mockUsers: Array<string> | undefined;
	readonly locale: string;
	readonly strings: { [key in TemplateKey]: string };
}

let config = JSON5.parse(fs.readFileSync("config.json5").toString()) as Config;
try {
	const localConfig = JSON5.parse(fs.readFileSync("local_config.json5").toString());
	config = { ...config, ...localConfig };
} catch (e) {}
const unindent = R.mapObjIndexed((str: string): string => str.replace(/\t+/g, ""));

const icons = new Array<number>(13).fill(0).map((_, i) => fs.readFileSync(`assets/${i}.png`)); // 0.png .. 12.png

// * Some helper functions * \\
const mentionToUserID = (mention: string): string | undefined => {
	const id = mention.match(/(?:<@|<@!)(\d+)(?:>)/);
	if (!id) return;
	return id[1];
};

const realName = (member: Discord.GuildMember): string => {
	if (member.nickname) {
		return member.nickname;
	} else {
		return member.user.username;
	}
};

let templateString: (str: TemplateKey, extraData?: object) => string;

const unready = (players: Array<Player>): Array<Player> =>
	players.filter((player) => player.state !== PlayerState.Ready);

const ready = (players: Array<Player>): Array<Player> =>
	players.filter((player) => player.state === PlayerState.Ready);

const team = (teamID: number) => (players: Array<Player>): Array<Player> =>
	players.filter((player) => player.team === teamID);

const available = (players: Array<Player>): Array<Player> =>
	players.filter((player) => player.team === 0);

const captainOf = (teamID: number) => (players: Array<Player>): Player =>
	players.find((player) => player.team === teamID && player.state === PlayerState.Captain) as Player;

const mapVotes = (players: Array<Player>): Array<MapEntry> => {
	return players.pipe(
		R.filter((player: Player) => player.mapVote >= 0), // disregard players that haven't voted
		R.map((player: Player): string => config.maps[player.mapVote]),
		R.reduce((acc: Array<MapEntry>, map: string) => {
			const e = acc.find((entry) => entry.map === map);
			if (e) e.votes += 1;
			return acc;
		}, config.maps.pipe(R.map(H.factory(MapEntry)))),
		R.sort((a: MapEntry, b: MapEntry) => b.votes - a.votes),
	);
};

const mapWinner = (players: Array<Player>): MapEntry => players.pipe(
	mapVotes,
	R.filter((entry: MapEntry) => entry.votes === mapVotes(players)[0].votes),
	H.pickRandom,
);
// * * * * * \\

const enum Phase {
	Gather,
	ReadyUp,
	Picking,
}

const enum PlayerState {
	SignedUp,
	Ready,
	Picked,
	Captain,
}

class MapEntry {
	map: string;
	votes = 0;

	constructor(map: string) {
		this.map = map;
	}
}

class Player {
	state = PlayerState.SignedUp;
	team = 0;
	mapVote = -1;
	user: Discord.User;

	constructor(user: Discord.User) {
		this.user = user;
	}
}

class State {
	phase = Phase.Gather;
	players = new Array<Player>();
	picker: Player | undefined;
	picksRemaining = 0;
	readyFinished: () => void = () => {};
	picksFinished: () => void = () => {};

	reset = (): void => {
		this.readyFinished();
		this.picksFinished();
		this.phase = Phase.Gather;
		this.players = new Array<Player>();
		this.picker = undefined;
		this.picksRemaining = 0;
		this.readyFinished = () => {};
		this.picksFinished = () => {};
	}
}

const states: { [key: string]: State } = {};
const commands: { [key: string]: (msg: Discord.Message, args: Array<string>, state: State) => void } = {};
commands.me = (msg, args, state) => {
	const datapath = `/${msg.guild.id}/${msg.channel.id}/users/${msg.author.id}`;
	if (args.length === 0) {
		const info = tryGet(db, `${datapath}/info`);
		if (info) msg.reply(templateString("me_print", { info }));
		else msg.reply(templateString("me_no_data"));
	} else {
		db.push(`${datapath}/info`, args.join(" "));
		msg.reply(templateString("me_saved"));
	}
};
commands.who = (msg, args, state) => {
	if (!args[0]) return;
	const id = mentionToUserID(args[0]);
	if (!id) return;
	const name = realName(msg.guild.member(id));
	const info = tryGet(db, `/${msg.guild.id}/${msg.channel.id}/users/${id}/info`);

	if (info) msg.reply(templateString("who_print", { name, info }));
	else msg.reply(templateString("who_no_data", { name }));
};
commands.fatkid = (msg, args, state) => {
	if (args.length === 0) {
		const fatkidTimes = tryGet(db, `/${msg.guild.id}/${msg.channel.id}/users/${msg.author.id}/fatkid`);
		if (!fatkidTimes)
			msg.reply(templateString("fatkid_me_never"));
		else
			msg.reply(templateString("fatkid_me_print", { fatkidTimes }));
	} else {
		const id = mentionToUserID(args[0]);
		if (!id) return;
		const fatkid = msg.guild.member(id);
		const fatkidTimes = tryGet(db, `/${msg.guild.id}/${msg.channel.id}/users/${fatkid.id}/fatkid`);
		if (!fatkidTimes)
			msg.reply(templateString("fatkid_never", { name: realName(fatkid) }));
		else
			msg.reply(templateString("fatkid_print", { fatkidTimes, name: realName(fatkid) }));
	}
};

commands.top10 = (msg, args, state) => {
	interface PlayerData {
		name: string;
		gamesPlayed: number;
	}

	const players = tryGet(db, `/${msg.guild.id}/${msg.channel.id}/users`, {} as { [key: string]: JSONObject });
	const top10 = R.keys(players).pipe(
		R.map((id: string) => {
			const player: JSONObject = players[id] || { };
			return { name: realName(msg.guild.member(id)), gamesPlayed: player.gamesPlayed as number || 0 };
		}),
		R.filter((p: PlayerData) => p.gamesPlayed > 0),
		R.sort((a: PlayerData, b: PlayerData) => b.gamesPlayed - a.gamesPlayed),
		R.take<PlayerData>(10),
	);

	if (top10.length === 0)
		msg.reply(templateString("top10_no_games"));
	else
		msg.reply(templateString("top10_print", { top10 }));
};

const startReady = async (channel: Discord.TextChannel, state: State): Promise<void> => {
	state.phase = Phase.ReadyUp;

	channel.send(templateString("ready_alert"));

	let readyFinished = false;
	state.readyFinished = () => readyFinished = true;
	await H.delay(1000 * 60);
	if (readyFinished) return;

	channel.send(templateString("ready_timeout"));
	state.players = ready(state.players);
	state.players.forEach((player) => player.state = PlayerState.SignedUp);
	state.phase = Phase.Gather;

	if (config.updateIcon && config.pugChannels[0] === channel.name)
		channel.guild.setIcon(icons[state.players.length]);
};

const startPicking = async (channel: Discord.TextChannel, state: State): Promise<void> => {
	state.phase = Phase.Picking;

	state.readyFinished();
	state.readyFinished = () => {};

	for (let i = 1; i <= 2; i += 1) {
		const captain = state.players.pipe(available, H.pickRandom);
		captain.state = PlayerState.Captain;
		captain.team = i;
	}

	channel.send(templateString("starting"));

	state.picker = captainOf(1)(state.players);
	state.picksRemaining = 1;

	let picksFinished = false;
	state.picksFinished = () => picksFinished = true;
	await H.delay(5 * 1000 * 60);
	if (picksFinished) return;
	channel.send(templateString("picking_timeout"));
	state.reset();

	if (config.updateIcon && config.pugChannels[0] === channel.name)
		channel.guild.setIcon(icons[state.players.length]);
};

interface Match {
	when: string;
	teams: Array<Array<{ id: string, captain: boolean}>>;
}

const startGame = (channel: Discord.TextChannel, state: State): void => {
	channel.send(templateString("lets_go"));

	state.players.pipe(
		R.map((player: Player) => player.user.id),
		R.forEach((id) => {
			const gamesPath = `/${channel.guild.id}/${channel.id}/users/${id}/gamesPlayed`;
			const gamesPlayed = tryGet(db, gamesPath, 0);
			db.push(gamesPath, gamesPlayed + 1);
		}),
	);

	const match: Match = {
		when: moment().toJSON(),
		teams: [1, 2].pipe(
			R.map((t: number) => state.players.pipe(
				team(t),
				R.map((player: Player) => { return { id: player.user.id, captain: player.state === PlayerState.Captain }; }),
			)),
		),
	};

	const matchesPath = `/${channel.guild.id}/${channel.id}/matches`;
	const matches = tryGet(db, matchesPath, new Array<Match>());
	matches.push(match);
	db.push(matchesPath, matches);

	state.reset();

	if (config.updateIcon && config.pugChannels[0] === channel.name)
		channel.guild.setIcon(icons[state.players.length]);
};

commands.add = (msg, args, state) => {
	if (state.phase !== Phase.Gather) return;

	if (state.players.find((player) => player.user.id === msg.author.id)) {
		msg.reply(templateString("already_added"));
		return;
	}
	state.players.push(new Player(msg.author));
	msg.reply(templateString("add_success"));

	if (config.updateIcon && config.pugChannels[0] === (msg.channel as Discord.TextChannel).name)
		msg.guild.setIcon(icons[state.players.length]);

	if (state.players.length === config.teamSize * 2)
		startReady(msg.channel as Discord.TextChannel, state);
};
commands.join = commands.add;

commands.remove = (msg, args, state) => {
	if (state.phase !== Phase.Gather) return;

	const idx = state.players.findIndex((player) => player.user.id === msg.author.id);
	if (idx === -1) {
		msg.reply(templateString("not_added"));
		return;
	}

	state.players.splice(idx, 1);
	msg.reply(templateString("removed"));

	if (config.updateIcon && config.pugChannels[0] === (msg.channel as Discord.TextChannel).name)
		msg.guild.setIcon(icons[state.players.length]);
};

commands.ready = (msg, args, state) => {
	if (state.phase !== Phase.ReadyUp) return;
	const thisPlayer = state.players.find((player) => player.user.id === msg.author.id);

	if (!thisPlayer) {
		msg.reply(templateString("ready_error_not_playing"));
		return;
	}
	if (thisPlayer.state === PlayerState.Ready) {
		msg.reply(templateString("ready_error_already"));
		return;
	}
	thisPlayer.state = PlayerState.Ready;
	msg.reply(templateString("ready_success"));

	if (ready(state.players).length === config.teamSize * 2)
		startPicking(msg.channel as Discord.TextChannel, state);
};
commands.r = commands.ready;

commands.pick = (msg, args, state) => {
	if (state.phase !== Phase.Picking) return;
	if (!state.picker) return console.error("Picking phase without a picker");
	if (msg.author.id !== state.picker.user.id) return;
	const id = Number(args[0]) - 1;
	if (isNaN(id)) {
		msg.reply(templateString("pick_error_NaN"));
		return;
	}
	if (!state.players[id] || state.players[id].state === PlayerState.Captain) {
		msg.reply(templateString("pick_error_wrong_number"));
		return;
	}
	if (state.players[id].state === PlayerState.Picked) {
		msg.reply(templateString("pick_error_already_picked"));
		return;
	}

	const picked = state.players[id];
	picked.state = PlayerState.Picked;
	picked.team = state.picker.team;
	state.picksRemaining -= 1;

	if (state.picksRemaining === 0) {
		state.picksRemaining = 2;
		state.picker = captainOf(state.picker.team === 1 ? 2 : 1)(state.players);
	}

	if (available(state.players).length === 1) {
		const fatkid = available(state.players)[0];
		fatkid.state = PlayerState.Picked;
		fatkid.team = state.picker.team;

		const fatkidPath = `/${msg.guild.id}/${msg.channel.id}/users/${fatkid.user.id}/fatkid`;
		const fatkidTimes = tryGet(db, fatkidPath, 0);
		db.push(fatkidPath, fatkidTimes + 1);

		state.picksFinished();
		state.picksFinished = () => {};
		state.picker = undefined;

		startGame(msg.channel as Discord.TextChannel, state);
		return;
	}

	msg.reply(templateString("picks_remaining"));
};
commands.p = commands.pick;

commands.maps = (msg, args, state) => {
	msg.reply(templateString("map_list"));
};

commands.votemap = (msg, args, state) => {
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

commands.status = (msg, args, state) => {
	switch (state.phase) {
		case Phase.Gather:
			if (state.players.length > 0)
				msg.reply(templateString("status_gather"));
			else
				msg.reply(templateString("status_gather_empty"));
			break;
		case Phase.ReadyUp:
			msg.reply(templateString("status_ready"));
			break;
		case Phase.Picking:
			msg.reply(templateString("status_picking"));
			break;
		default: return console.error("WTF PHASE IS FUCKED UP");
	}
};

commands.help = (msg, args, state) => {
	msg.reply(templateString("help"));
};

commands.reset = (msg, args, state) => {
	if (!msg.guild.member(msg.author).hasPermission("ADMINISTRATOR")) return;
	msg.reply(templateString("reset"));
	state.reset();

	if (config.updateIcon && config.pugChannels[0] === (msg.channel as Discord.TextChannel).name)
		msg.guild.setIcon(icons[state.players.length]);
};

commands.force = (msg, args, state) => {
	if (!msg.guild.member(msg.author).hasPermission("ADMINISTRATOR")) return;

	const id = mentionToUserID(args[0]);
	if (!id) return;

	const subject = msg.guild.member(id).user;
	if (!subject) return;

	msg.author = subject;
	if (commands[args[1]])
		commands[args[1]](msg, args.slice(2), state);
};

commands.mock = (msg, args, state) => {
	if (!config.mockUsers) return;
	if (!msg.guild.member(msg.author).hasPermission("ADMINISTRATOR")) return;

	const id = Number(args[0]);

	msg.author = msg.guild.member(config.mockUsers[id - 1]).user;
	if (commands[args[1]])
		commands[args[1]](msg, args.slice(2), state);
};
commands.m = commands.mock;

commands.mocks = (msg, args, state) => {
	if (!config.mockUsers) return;
	if (!msg.guild.member(msg.author).hasPermission("ADMINISTRATOR")) return;

	if (args[0] === "pick") {
		while (state.picker) {
			msg.author = state.picker.user;
			const randomAvailable = state.players.pipe(available, H.pickRandom);
			args[1] = (state.players.findIndex((player) => player.user.id === randomAvailable.user.id) + 1).toString();
			commands.pick(msg, args.slice(1), state);
		}
		return;
	}

	if (args[0] === "votemap") {
		for (let i = 0; i < config.teamSize * 2; i += 1) {
			msg.author = msg.guild.member(config.mockUsers[i]).user;
			args[1] = (H.randomIndex(config.maps) + 1).toString();
			commands.votemap(msg, args.slice(1), state);
		}
		return;
	}

	for (let i = 0; i < config.teamSize * 2; i += 1) {
		msg.author = msg.guild.member(config.mockUsers[i]).user;
		if (commands[args[0]])
			commands[args[0]](msg, args.slice(1), state);
	}
};
commands.ms = commands.mocks;

commands.eval = (msg, args, state) => {
	if (msg.author.id !== "96338667253006336") return;
	try { msg.reply(eval(args.join(" "))); } catch (e) { }; // tslint:disable-line
};

client.once("ready", () => {
	console.log("Booting up!");

	client.guilds.forEach((guild) => {
		if (config.updateIcon) guild.setIcon(icons[0]);

		guild.channels.forEach((channel) => {
			if (channel.type !== "text") return;
			if (!config.pugChannels.some((name) => name === channel.name)) return;
			states[channel.id] = new State();
		});
	});

	client.on("message", (msg) => {
		if (msg.author.id === client.user.id) return; // don't react to my own messages
		if (msg.channel.type !== "text") return; // only care about text channels
		const state = states[msg.channel.id];
		if (!state) return; // not a pug channel
		if (msg.content[0] !== config.commandDelimeter) return; // not a command
		let args = msg.content.split(" ");
		const command = args[0].substring(1); // strip away the command delimeter
		args = args.splice(1); // don't really care about the command itself

		templateString = (str, extraData) => {
			const templateData = {
				listNames: (players: Array<Player>): string => players.reduce((acc, player) =>
					`${acc}${realName(msg.guild.member(player.user))}, `, "").slice(0, -2),
				listMentions: (players: Array<Player>): string => players.reduce((acc, player) =>
					`${acc}${player.user}, `, "").slice(0, -2),
				ready: () => ready(state.players),
				unready: () => unready(state.players),
				isCaptain: (player: Player): boolean => player.state === PlayerState.Captain,
				captain1: () => captainOf(1)(state.players).user,
				captain2: () => captainOf(2)(state.players).user,
				team1: () => team(1)(state.players),
				team2: () => team(2)(state.players),
				mapVotes: () => mapVotes(state.players).filter((e: MapEntry) => e.votes > 0),
				mapWinner: () => mapWinner(state.players),
				last: () => {
					const matches = tryGet(db, `/${msg.guild.id}/${msg.channel.id}/matches`, new Array<Match>());
					if (matches.length === 0) return templateString("never");
					return moment(R.last(matches).when).locale(config.locale).fromNow();
				},
			};

			// TODO: consider evaling template strings
			/*
			 * var data = "dick";
			 * var template = "I like ${data} the most";
			 * var result = eval(`(()=>\`${b}\`)()`);
			 *
			 * Pros: nicer, shorter
			 * Cons: somewhat weird to avoid extensive whitespace
			 */
			if (unindent(config.strings)[str])
				return ejs.render(unindent(config.strings)[str], { ...config, ...state, ...templateData, ...extraData });
			return ejs.render(str, { ...config, ...state, ...templateData, ...extraData });
		};

		if (commands[command]) commands[command](msg, args, state);
	});
});

client.on("ready", () => {
	console.log("Ready!");
});

client.on("disconnect", () => {
	console.log("Disconnected!");
});

client.login(config.botToken);
