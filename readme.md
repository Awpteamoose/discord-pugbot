## PUGBOT

### Installation
1. Install nodejs
	1. https://nodejs.org/dist/v6.9.1/node-v6.9.1-x64.msi
	2. should be self-explanatory?
2. Register an app with discord
	1. Go to https://discordapp.com/developers/applications/me/create
	2. Fill in the name
	3. `Create Application`
	4. `Create a Bot User`
	5. Press `click to reveal` next to Token
	6. Rename `config.json.example` to `config.json` and fill in the token
	7. Copy the bot's `Client ID`
	8. Invite the bot  to https://discordapp.com/api/oauth2/authorize?client_id=<Client ID>&scope=bot&permissions=0
3. Launch the bot itself
	1. Navigate to the bot folder
	2. `npm install`
	3. `npm start`
