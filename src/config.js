/* eslint-disable indent */
/* eslint-disable max-len */
import * as Discord from "discord.js";
import { mapVotes, realName } from "./index";
import type { State, PickingState, Player, MapEntry } from "./index";

type Players = Array<Player>;

const version = "3.0.0";
const botToken = "";
const commandDelimeter = "!"; // only 1 character
const updateIcon = false; // will change the server icon from zero to teamSize * 2 if true
const teamSize = 5;
const locale = "en"; // used only for time expressions
const pugChannels = ["pug", "purple_pug"]; // The bot will have separate state for every channel
const mapVoting = false;
const maps = [
	"King's Row",
	"de_dust2",
	"Aerowalk",
	"Kafe Dostoyevsky",
];
const mockUsers = [];

const total = (players: Players): string => `${players.length}/${teamSize * 2}`;
const mentions = (players: Players): string => players.reduce((acc, player) =>
	`${acc}${player.user.toString()}, `,"").slice(0, -2);
const listTeam = (players: Players): string => players.reduce((acc, player, i) =>
	`${acc}\n${i + 1}. ${player.user.toString()}`, "");
const listNames = (guild: Discord.Guild, players: Players): string => players.reduce((acc, player) =>
	`${acc}${realName(guild, player.user)}, `, "").slice(0, -2);
const listPicks = (players: Players): string => players.reduce((acc: string, player: Player, i: number) => {
	if (player.team === 0) {
		return `${acc}\n:white_check_mark: ${i + 1}. ${player.user.toString()}`;
	}
	return `${acc}\n:x: ${i + 1}. ~~${player.user.toString()}~~ - Team ${player.team} ${player.state === "Captain" ? "**CAPTAIN**" : ""}`;
}, "");
const listMapVotes = (votes: Array<MapEntry>): string => votes.reduce((acc, entry) =>
	`${acc}${entry.votes} - **${entry.map}**, `, "").slice(0, -2);
const recountVotes = (players: Players): string => mapVoting ? `
	${mapVotes(players, 1).length > 0 ? `
		Map votes:
		${listMapVotes(mapVotes(players, 1))}`
		:
		`Noone has voted for a map yet! \`${d}maps\` to see the list and \`${d}votemap\` to choose one!`
	}` : ""
;

const d = commandDelimeter;

const strings = {
	reset: "PUGBOT reset!",
	never: "never",
	notServerMember: "not on server",
	pugInProgress: "PUG in progress!",
	alreadyAdded: (players: Players) => `you're already added! ${total(players)}`,
	notAdded: (players: Players) => `you're not added! ${total(players)}`,
	addSuccess: (players: Players) => `added! ${total(players)}
		${mapVoting ? `\`${d}maps\` to see the map list and \`${d}votemap\` to pick one! ` : ""}`,
	removed: (players: Players) => `removed! ${total(players)}`,
	readyErrorAlready: (ready: Players) => `you've already readied up! ${total(ready)}`,
	readyErrorNotPlaying: (ready: Players) => `you're not participating! ${total(ready)}`,
	readySuccess: (ready: Players) => `you're ready! ${total(ready)}`,
	meSaved: "gotcha!",
	me: (info: string) => info ?
		`you're ${info}` :
		"nothing on you yet!",
	who: (name: string, info: string) => info ?
		`${name} is ${info}` :
		`nothing on ${name} yet!`,
	fatkidMe: (fatkidTimes: number) => (fatkidTimes === 0) ?
		"you have never been a fat kid!" :
		`you have been the fat kid ${fatkidTimes} times`,
	fatkid: (fatkidTimes: number, name: string) => (fatkidTimes === 0) ?
		`${name} hasn't been a fat kid yet!` :
		`${name} has been the fat kid ${fatkidTimes} times`,
	mapErrorNotAdded: "only added players may vote for a map!",
	mapErrorNaN: "not a number!",
	mapErrorWrongMap: "no such map exists!",
	pickingTimeout: "PUG is cancelled, the pick phase is taking too long for some reason.",
	pickErrorNaN: "not a number!",
	pickErrorWrongNumber: "there is no such player!",
	pickErrorAlreadyPicked: "this player is already picked!",
	top10: (top10: Array<*>) => (top10.length === 0) ? "noone has played any games yet!" :
		`games played: ${top10.reduce((acc, entry) => `${acc}\n${entry.name} - ${entry.gamesPlayed}`, "")}`,
	mapVoteSuccess: (map: string, votes: Array<MapEntry>) => `you voted for **${map}** ${votes.length > 0 ? `
		Map votes:
		${listMapVotes(votes)}` : ""}`,
	mapList: `
		Available maps: ${maps.reduce((acc, map, i) => `${acc}\n${i + 1}. ${map}`, "")}

		Type \`${d}votemap #\` to vote for a map number #`,
	readyAlert: (unready: Players) => `1 minute to \`${d}ready\`, type \`${d}status\` to check who isn't \`${d}ready\`
		Unready: ${mentions(unready)}`,
	status: {
		ReadyUp: (s: State) => `type \`${d}ready\` to ready up!
			Unready: ${mentions(s.players)}`,
		Gather: (s: State, guild: Discord.Guild, last: string) => `Last PUG played: ${last}
			${(s.players.length === 0) ?
				`Noone's signed up! ${total(s.players)}`
				:
				`Participants are: ${listNames(guild, s.players)}
				${total(s.players)}
				${recountVotes(s.players)}`
			}`,
		Picking: (s: State) => {
			s = ((s: any): PickingState);
			return `
				It's ${s.picker.user.toString()}'s turn, \`${d}pick\` ${s.picksRemaining} more: ${listPicks(s.players)}
				${recountVotes(s.players)}
			`;
		},
	},
	readyTimeout: (unready: Players) => `PUG is cancelled, only ${(teamSize * 2) - unready.length}/${teamSize * 2} readied up!
		Unready removed: ${mentions(unready)}`,
	starting: (players: Players, captains: [Player, Player]) => `PUG is starting! ${listPicks(players)}

		Captains are ${captains[0].user.toString()} (picks first, Team 1) and ${captains[1].user.toString()} (picks second, Team 2)
		\`${d}pick X\` to pick player number X
		Pick order is 1-2-2-2-2-1`,
	picksRemaining: (players: Players, picker: Player, picks: number) =>
		`${picker.user.toString()}, \`${d}pick\` ${picks} more: ${listPicks(players)}`,
	letsGo: (team1: Players, team2: Players, map?: string) => `:ok:
		Team 1: ${listTeam(team1)}

		Team 2: ${listTeam(team2)}

		${map ? `Map: **${map}**` : "\n"}
		LET'S FUCKING GO! WOOOOOO!`,
	help: `available commands:
		\`${d}help\` - display this blob
		\`${d}status\` - display current PUG status
		\`${d}add\` - join the PUG queue
		\`${d}remove\` - remove yourself from the PUG queue
		\`${d}ready\` - ready yourself up when the queue is full, unready players will be kicked after a minute
		\`${d}pick #\` (only captains) - pick the player number # during the drafting phase ${!mapVoting ? "" : `
		\`${d}maps\` - show a list of available maps
		\`${d}votemap <mapname>\` - vote for a map called <mapname>`
		}
		\`${d}me <info>\` - save some info about yourself
		\`${d}who @mention\` - display saved info about @mention
		\`${d}fatkid @mention\` - display how many times @mention was picked last
		\`${d}top10\` - display 10 most active PUGgers

		Once ${teamSize * 2} players are added, the bot will ask everyone to \`${d}ready\`. Then the PUG will start and 2 random players will be chosen as captains.
		After the drafting phase, the most popular map will be chosen (randomly in case of a tie).`,
};

export default {
	version,
	botToken,
	commandDelimeter,
	updateIcon,
	teamSize,
	locale,
	pugChannels,
	mapVoting,
	maps,
	mockUsers,
	strings,
};
