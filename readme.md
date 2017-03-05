## discord-pugbot

<a href="https://www.npmjs.com/package/discord-pugbot"><img src="https://img.shields.io/npm/v/discord-pugbot.svg?maxAge=3600" alt="NPM version" /></a>
<a href="https://www.npmjs.com/package/discord-pugbot"><img src="https://img.shields.io/npm/dt/discord-pugbot.svg?maxAge=3600" alt="NPM downloads" /></a>
<a href="https://david-dm.org/hydrabolt/discord-pugbot"><img src="https://david-dm.org/awpteamoose/pugbot.svg?maxAge=3600" alt="Dependencies" /></a>

### Installation
1. Install nodejs
	* Windows: https://nodejs.org/dist/v7.6.0/node-v7.6.0-x64.msi
	* Ubuntu: `sudo apt-get install nodejs && sudo apt-get install npm && sudo ln -s "$(which nodejs)" /usr/bin/node`
	* Other: you probably know better
2. Register an app with discord
	1. Go to https://discordapp.com/developers/applications/me/create
	2. Fill in the name & avatar (if you like)
	3. `Create Application`
	4. `Create a Bot User`
	5. Press `click to reveal` next to Token
	6. Paste the token into [config.json5](https://github.com/Awpteamoose/pugbot-typescript/blob/master/config.json5)
	7. Copy the bot's `Client ID`
	8. Invite the bot to your server `https://discordapp.com/api/oauth2/authorize?client_id=<Client ID>&scope=bot&permissions=0`
3. Open [config.json5](https://github.com/Awpteamoose/pugbot-typescript/blob/master/config.json5) again and configure the bot to your liking
4. Launch the bot itself
	1. Navigate to the bot folder
	2. `npm install`
	3. `npm start`
