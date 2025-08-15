# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

- `npm start` - Start the production server
- `npm run dev` - Start the development server
- `npm install` - Install dependencies

## Architecture Overview

This is a Node.js Express proxy server that acts as a bridge between iOS Shortcuts and an Immich photo management server. The application has a single-file architecture with the main logic in `index.js`.

### Core Functionality

The server accepts image uploads from iOS devices via the `/upload` endpoint and forwards them to a configured Immich server. It handles:

- **File Upload Processing**: Uses multer with memory storage to handle multipart file uploads (50MB limit)
- **API Key Passthrough**: Accepts API keys from iOS shortcuts via request body or headers and forwards them to Immich
- **Metadata Generation**: Automatically generates required Immich metadata (deviceAssetId, deviceId, timestamps) that iOS shortcuts cannot provide
- **Error Translation**: Converts Immich server errors and connection issues into user-friendly responses

### Environment Configuration

The application requires environment variables defined in `.env` (use `.env.example` as template):
- `IMMICH_SERVER_URL` - Target Immich server URL (required)
- `PORT` - Server port (defaults to 3000)
- `DEVICE_ID` - Device identifier for uploads (defaults to 'ios-shortcut-device')

### Request Flow

1. iOS Shortcut sends POST to `/upload` with image file and API key
2. Server validates file and API key presence
3. Server creates FormData with image buffer and generated metadata
4. Server forwards request to Immich `/api/assets` endpoint
5. Server returns Immich response or formatted error to iOS client

The `/health` endpoint provides basic server status for monitoring.