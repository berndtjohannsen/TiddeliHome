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

