# TiddeliHome
This is an app (planned PWA) that enables control of a Home Assistant using Gemini live audio (using a google API still in beta). You can speak very freely (in any supported language) controlling switches and lights and get sensor information of your home. The overall idea is that the App pull HAs configuration (using websocket), does some filtering and send all that to AI. Using this information the AI can then control HA using REST commands - all in parallell with the audio dialog. There is no specific backend logic, just the web server that feeds the app ("web page")

Questions like this are possible (in mulitple languages):
- "Turn on/off specific lamps"
- "Turn off all lamps in the kitchen and in the living room"
- "What lamps are turned on in the kitchen"
- "What is the temperature in the living room"
- "What rooms do I have"
- Turn on all window lamps and how tall is Barack Obama. Yes, as this app uses hosted Gemini AI, it can answer "any" question if so configured


Some todos:
- more configuration help
- more extensible (upload of docs for AI to use)
- more finetuning of dialog 
- figure how to run this hosted on Home Assistant (should be straight-foward)

## NOTE
- This is work in progress, but it kind'a works - for me.
- There is complexity with HA confuguration (CORS, certificate etc) I will document this more
- Stay tuned, I will evolve this to a decent first probably Q1 2026. No point in trying to contribute code yet.
- You will need your own Google API key, 
- Yoy will need long lived HA token
- You may need to tune some HA configuration, for example providing names that suits a spoken dialog. But AI is pretty clever (I will document this shortly)


## Security/integrity
TBD 

## Design
There is tech info in the file design.md. But this is very much work in progress

## License
TBD, but it will be free for any non-commercial use.


### Third-Party Components
TBD

