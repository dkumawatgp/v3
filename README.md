# ai-mfe-test

A production-ready Node.js CLI tool built with TypeScript for analyzing and generating.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn

## Installation

Install dependencies:

```bash
npm install
```

## Development

Run the CLI tool in development mode using tsx:

```bash
npm run dev analyze <url>
npm run dev generate <url>
```

Or directly:

```bash
npm run dev -- analyze https://example.com
npm run dev -- generate https://example.com
```

## Building

Build the project for production:

```bash
npm run build
```

This will create a `dist` folder with the compiled JavaScript files.

## Running (Production)

After building, run the CLI tool:

```bash
npm start analyze <url>
npm start generate <url>
```

Or if installed globally or linked:

```bash
ai-mfe-test analyze https://example.com
ai-mfe-test generate https://example.com
```

## Project Structure

```
.
├── src/
│   ├── cli/
│   │   └── index.ts      # CLI entry point
│   ├── core/
│   │   ├── analyze.ts    # Analyze functionality
│   │   └── generate.ts   # Generate functionality
│   └── utils/
│       └── logger.ts     # Logging utilities
├── dist/                 # Compiled output (generated)
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## Commands

### analyze

Analyze a URL:

```bash
ai-mfe-test analyze <url>
```

### generate

Generate from a URL:

```bash
ai-mfe-test generate <url>
```

## License

MIT
