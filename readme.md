## discord-pugbot

<a href="https://www.npmjs.com/package/discord-pugbot"><img src="https://img.shields.io/npm/v/discord-pugbot.svg?maxAge=3600" alt="NPM version" /></a>
<a href="https://www.npmjs.com/package/discord-pugbot"><img src="https://img.shields.io/npm/dt/discord-pugbot.svg?maxAge=3600" alt="NPM downloads" /></a>
<a href="https://david-dm.org/hydrabolt/discord-pugbot"><img src="https://david-dm.org/awpteamoose/pugbot.svg?maxAge=3600" alt="Dependencies" /></a>

<a href="https://patreon.com/awpteamoose"><img src="https://s3.amazonaws.com/patreon_public_assets/toolbox/patreon.png" height="20" alt="Support me on Patreon!" /></a>

### Installation
0. Install `nodejs` and `npm`
	* Windows: https://nodejs.org/dist/v7.6.0/node-v7.6.0-x64.msi
	* Ubuntu: `sudo apt-get install nodejs && sudo apt-get install npm && sudo ln -s "$(which nodejs)" /usr/bin/node`
	* Other: you probably know better
1. Run `npm install -g discord-pugbot --production`
2. Navigate to a folder where you would like to store configuration for the bot.
3. Run `discord-pugbot --init`
4. Go to https://discordapp.com/developers/applications/me/create
5. Fill in the name & avatar (if you like)
6. `Create Application`
7. `Create a Bot User`
8. Copy the bot's `Client ID`
9. Invite the bot to your server `https://discordapp.com/api/oauth2/authorize?scope=bot&permissions=8&client_id=<Client ID>`
10. Press `click to reveal` next to `Token` and copy it
11. Open [config.js](https://github.com/Awpteamoose/discord-pugbot/blob/master/config.js) and paste the `Token`
12. Configure the bot to your liking
13. `discord-pugbot --run`
