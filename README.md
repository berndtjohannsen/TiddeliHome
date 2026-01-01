# TiddeliHome
This is an app (Chrome PWA) that enables control of a Home Assistant (HA) using Gemini live audio (a google API still in beta). You can speak very freely (in any supported language) controlling switches and lights and get sensor information from your home. The overall idea is that the App pull HAs configuration (using HA websocket), does some filtering and then sends all to AI. Using this information the AI can then control HA using REST commands - all in parallell with the audio dialog. There is no specific backend, just the web server that feeds the App/web page.

Questions like this are possible (in mulitple languages):
- "Turn on/off specific lamps"
- "Turn off all lamps in the kitchen and in the living room"
- "What lamps are turned on in the kitchen"
- "What is the temperature in the living room and"
- "What rooms do I have"
- "What is the weather tomorrow"
- "Turn on all window lamps and how tall is Barack Obama". (Yes, as this app uses hosted Gemini AI, it can answer "any" question if so configured)

You can use the App without HA asking general questions, but this will so far not bring much additional value to using the Gemini App.

The app is here: [https://berndtjohannsen.github.io/TiddeliHome/](https://berndtjohannsen.github.io/TiddeliHome/)
 It runs in the browser, as a windows App, as an App on android and (not tested) on Iphone/IOS.

 <img width="221" height="465" alt="image" src="https://github.com/user-attachments/assets/4393b53b-19a8-45b8-93d9-e920c930ba53" />



## TODOs 
- Configuration upload
- Improve version management (e.g button to check for new version)
- more on-line help in particular related to configuration
- more finetuning of dialog (VAD, bargein in)
- test on different phones android/IOS
- New features/ideas:
* upload of private docs for AI to use in the dialog
* "wakeword"
* Calendar access
* Email access
* More dynamic personal data (like current position)
* AI driven help


## NOTE
- This is work in progress, but it kind'a works - for me.
- There is complexity with HA confuguration (CORS, certificate etc) I will document this more
- The App will need a google API key for you to download (from google)
- Stay tuned, I will evolve this to a decent first probably Q1 2026. No point in trying to contribute code yet.
- Yoy will need long lived Home Assistant token
- You may need to tune some HA configuration, for example providing names that suits a spoken dialog. But AI is pretty clever even without this.


## Security/integrity
- These are the main things to manage/consider:
- You will need your own google API key, I will document (or you can google) how to protect this best (at a minimum provide a cost limit). Likely you can get a decent service at a very low cost. Maybe even free.
- You will need to provide an access token to Home Assistant
- You will need to provision the access URL to Home Assistant
- These keys are all stored in the App, currently in clear text (though not exposed in the UI)
- If you use my github-page as host, you will need to configure CORS in HA
- You can of course host this on the same server as HA, which limites CORS complexity
- The area is subject to TODO
  
## Design
There is tech info in the file design.md. But this is work in progress

## License
TBD, but it will be free for any non-commercial use.

### Third-Party Components
This project uses the following third-party libraries and tools:

#### Runtime Dependencies
- **@google/genai** (^1.31.0) - Google Gemini Live API client library
  - Purpose: Provides the SDK for connecting to Google's Gemini Live API for real-time audio streaming
  - License: Apache 2.0 (commercial use permitted)
  - Website: https://ai.google.dev/

#### Development Dependencies
- **Vite** (^6.2.0) - Build tool and development server
  - Purpose: Fast build tool, HMR, TypeScript compilation, and production bundling
  - License: MIT (commercial use permitted)
  - Website: https://vitejs.dev/

- **TypeScript** (^5.8.2) - TypeScript compiler
  - Purpose: Type-safe JavaScript development
  - License: Apache 2.0 (commercial use permitted)
  - Website: https://www.typescriptlang.org/

- **Tailwind CSS** (^4.1.18) - Utility-first CSS framework
  - Purpose: Styling and UI design
  - License: MIT (commercial use permitted)
  - Website: https://tailwindcss.com/

- **@tailwindcss/vite** (^4.1.18) - Tailwind CSS Vite plugin
  - Purpose: Integrates Tailwind CSS with Vite build process
  - License: MIT (commercial use permitted)

- **vite-plugin-mkcert** (^1.17.9) - HTTPS certificate plugin for development
  - Purpose: Automatically generates and trusts local HTTPS certificates for development
  - License: MIT (commercial use permitted)
  - Note: Only used in development, not included in production builds

- **@types/node** (^22.14.0) - TypeScript type definitions for Node.js
  - Purpose: TypeScript support for Node.js APIs
  - License: MIT (commercial use permitted)

**License Note**: All listed dependencies use permissive licenses (MIT or Apache 2.0) that allow commercial use. However, you should verify the current license terms of each package before commercial deployment, as licenses may change over time.

