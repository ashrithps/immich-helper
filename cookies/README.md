# Cookie Files for Authentication

This directory contains cookie files for yt-dlp to authenticate with various platforms.

## Supported Platforms

- **YouTube**: `youtube-cookie.txt`
- **Instagram**: `instagram-cookie.txt`
- **Reddit**: `reddit-cookie.txt`

## How to Export Cookies

### Method 1: Browser Extension (Recommended)
1. Install a cookie export extension:
   - Chrome: "Get cookies.txt LOCALLY" or "cookies.txt"
   - Firefox: "cookies.txt" addon
2. Navigate to the platform (youtube.com, instagram.com, or reddit.com)
3. Make sure you're logged in
4. Export cookies in Netscape format
5. Save as the appropriate filename in this directory

### Method 2: yt-dlp Built-in (Chrome/Edge)
```bash
# For YouTube
yt-dlp --cookies-from-browser chrome --write-info-json --skip-download "https://youtube.com/watch?v=dQw4w9WgXcQ"

# For Instagram  
yt-dlp --cookies-from-browser chrome --write-info-json --skip-download "https://instagram.com/p/example"

# For Reddit
yt-dlp --cookies-from-browser chrome --write-info-json --skip-download "https://reddit.com/r/example/comments/id/title/"
```

### Method 3: Manual Browser Export
1. Open Developer Tools (F12)
2. Go to Application/Storage tab
3. Click on Cookies → Select domain
4. Copy cookie data and format as Netscape format

## File Format
Cookie files should be in Netscape format:
```
# Netscape HTTP Cookie File
domain	flag	path	secure	expiration	name	value
.youtube.com	TRUE	/	TRUE	1234567890	session_token	abc123...
.reddit.com	TRUE	/	TRUE	1234567890	reddit_session	def456...
```

## Security Notes
- ⚠️ **Never commit cookie files to git** - they contain authentication tokens
- 🔄 **Rotate cookies regularly** - they expire and should be refreshed
- 🔒 **Keep files secure** - treat them like passwords

## Usage
When you make requests to supported platforms, the appropriate cookie file will be automatically used if available.