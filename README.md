# TiddeliHome
This is an app (planned PWA) that enables control of a Home Assistant using Gemini live audio (a  google API still in beta). You can speak very freely (in any supported language) controlling switches and lights and get sensor information of your home. The overall idea is tha the App pull HAs configuration (using websocket), does some filtering and send all that to AI. Using this information the AI can then act with HA REST commands - all in parallell with the audio dialog. There is no specific backend logic, just the web server that feeds the app ("web page")

Questions like this are possible:
- "Turn on/off specific lamps"
- "Turn off all lamps in the kitchen and in the living room"
- "What lamps are turned on in the kitchen"
- "What is the temperature in the living room"
- "What rooms do I have"
- Turn on all window lamps
- "How tall is Barack Obama?" (Yes, as this app uses hosted Gemini AI, it can answer "any" question)


Some todos:
- help wht confuiguration
- more on UI
- more extensible (upload of docs for AI to use)
- more documentation in particular around configuration
- more finetuning of dialog 
- more configuration management in UI
- figure how to run this on HA
- Turn this into a mobile app (PWA)

## NOTE
- This is very much work in progress, but it kind'a works - for me.
- There is some complexity with HA confuguration (CORS, certificate etc)
- Stay tuned, I will evolve this to a decent first probably Q1 2026. No point in trying to contribute code yet.
- You will need your own Google API key, long lived HA token
- You may need some HA configuration, for example provide names that suits a spoken dialog (I will document this shortly)


## Security/integrity
TBD

## Design
There is tech info in the file design.md. But this is very much work in progress

## License
TBD, but it will be free for any non-commercial use.


### Third-Party Components
TBD

