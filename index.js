const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { spawn } = require('child_process');
const temp = require('temp');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

temp.track();

function copyCookieFileToTemp(sourcePath, cookieFileName) {
  try {
    // Create a temporary file for the cookie
    const tempCookieFile = temp.path({ suffix: `-${cookieFileName}` });
    
    // Copy the cookie file to temp location with proper permissions
    fs.copyFileSync(sourcePath, tempCookieFile);
    
    // Ensure we have read/write permissions
    fs.chmodSync(tempCookieFile, 0o644);
    
    console.log(`Copied cookie file to temp: ${tempCookieFile}`);
    return tempCookieFile;
  } catch (error) {
    console.warn(`Failed to copy cookie file ${sourcePath}:`, error.message);
    return null;
  }
}

function getCookieFileForUrl(url) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    
    // Map domains to cookie files
    const cookieMap = {
      'youtube.com': 'youtube-cookie.txt',
      'www.youtube.com': 'youtube-cookie.txt',
      'youtu.be': 'youtube-cookie.txt',
      'm.youtube.com': 'youtube-cookie.txt',
      'instagram.com': 'instagram-cookie.txt',
      'www.instagram.com': 'instagram-cookie.txt'
    };
    
    const cookieFile = cookieMap[domain];
    if (cookieFile) {
      const cookiePath = path.join(__dirname, 'cookies', cookieFile);
      // Check if cookie file exists
      if (fs.existsSync(cookiePath)) {
        console.log(`Found cookie file: ${cookieFile} for domain: ${domain}`);
        // Copy to temp location with proper permissions
        return copyCookieFileToTemp(cookiePath, cookieFile);
      } else {
        console.log(`Cookie file ${cookieFile} not found for domain: ${domain}`);
      }
    }
    
    return null;
  } catch (error) {
    console.warn('Error parsing URL for cookie detection:', error.message);
    return null;
  }
}

async function downloadFromUrl(url) {
  try {
    console.log(`Downloading from URL: ${url}`);
    
    // Create temporary directory
    const tempDir = temp.mkdirSync('immich-download');
    
    // Configure output filename template
    const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');
    
    // yt-dlp command arguments with flexible format selection
    const args = [
      url,
      '--format', 'best[height<=1080]/best[height<=720]/best', // Try 1080p, then 720p, then best available
      '--no-playlist',
      '--output', outputTemplate
    ];
    
    // Add cookie file if available for this domain
    const cookieFile = getCookieFileForUrl(url);
    if (cookieFile) {
      args.push('--cookies', cookieFile);
    }
    
    // Execute yt-dlp using spawn
    await new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', args);
      
      let stderr = '';
      
      ytdlp.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ytdlp.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
        }
      });
      
      ytdlp.on('error', (error) => {
        reject(new Error(`Failed to start yt-dlp: ${error.message}`));
      });
    });
    
    // Find the downloaded file
    const files = fs.readdirSync(tempDir);
    if (files.length === 0) {
      throw new Error('No files were downloaded');
    }
    
    const downloadedFile = files[0];
    const filePath = path.join(tempDir, downloadedFile);
    
    return {
      path: filePath,
      filename: downloadedFile
    };
    
  } catch (error) {
    console.error('Download error:', error.message);
    throw new Error(`Failed to download from URL: ${error.message}`);
  }
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

const app = express();
const port = process.env.PORT || 3000;

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

app.use(express.json());

app.post('/upload', upload.single('image'), async (req, res) => {
  let tempFilePath = null; // Declare at function scope for cleanup access
  
  try {
    const apiKey = req.body.apiKey || req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    let fileBuffer, filename, contentType;

    // Check if this is a file upload or URL download
    if (req.file) {
      console.log('Processing file upload:', req.file.originalname, req.file.mimetype, `${req.file.size} bytes`);
      
      // Check if the uploaded "file" is actually a URL (common with iOS Shortcuts)
      if (req.file.mimetype === 'text/plain' && req.file.size < 1000) {
        const possibleUrl = req.file.buffer.toString('utf8').trim();
        // Clean up URL (iOS sometimes converts : to ::: and / to :)
        const cleanUrl = possibleUrl
          .replace(/:::/g, '://')  // Fix protocol
          .replace(/:(?!\/\/)/g, '/');  // Fix path separators (: to /) but keep ://
        
        if (cleanUrl.match(/^https?:\/\/.+/)) {
          console.log('Detected URL in text file, processing as URL download:', cleanUrl);
          // Process as URL download instead of file upload
          const downloadedFile = await downloadFromUrl(cleanUrl);
          tempFilePath = downloadedFile.path;
          fileBuffer = fs.readFileSync(downloadedFile.path);
          filename = downloadedFile.filename;
          contentType = getContentType(downloadedFile.filename);
          console.log('Downloaded file:', filename, contentType, `${fileBuffer.length} bytes`);
        } else {
          return res.status(400).json({ 
            error: 'Invalid file type',
            message: 'Text files are not supported. Please upload an image/video file or provide a URL in the request body.'
          });
        }
      } else {
        // Regular file upload
        fileBuffer = req.file.buffer;
        filename = req.file.originalname || 'image.jpg';
        contentType = req.file.mimetype;
      }
    } else if (req.body.url && req.body.url.trim() !== '') {
      // URL download using yt-dlp (only if URL is not blank)
      console.log('Processing URL download:', req.body.url.trim());
      const downloadedFile = await downloadFromUrl(req.body.url.trim());
      tempFilePath = downloadedFile.path;
      fileBuffer = fs.readFileSync(downloadedFile.path);
      filename = downloadedFile.filename;
      contentType = getContentType(downloadedFile.filename);
      console.log('Downloaded file:', filename, contentType, `${fileBuffer.length} bytes`);
    } else {
      return res.status(400).json({ error: 'Either image file or URL is required' });
    }

    const immichUrl = process.env.IMMICH_SERVER_URL;
    if (!immichUrl) {
      return res.status(500).json({ error: 'Immich server URL not configured' });
    }

    const formData = new FormData();
    formData.append('assetData', fileBuffer, {
      filename: filename,
      contentType: contentType
    });

    const deviceAssetId = `ios-shortcut-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const deviceId = process.env.DEVICE_ID || 'ios-shortcut-device';
    
    formData.append('deviceAssetId', deviceAssetId);
    formData.append('deviceId', deviceId);
    formData.append('fileCreatedAt', new Date().toISOString());
    formData.append('fileModifiedAt', new Date().toISOString());

    console.log(`Uploading to Immich: ${immichUrl}/api/assets`);
    console.log('Form data fields:', Object.keys(formData._streams || {}));
    console.log('Headers:', { ...formData.getHeaders(), 'x-api-key': '***' });
    
    const response = await axios.post(`${immichUrl}/api/assets`, formData, {
      headers: {
        ...formData.getHeaders(),
        'x-api-key': apiKey,
      },
      timeout: 30000
    });

    res.json({
      success: true,
      message: req.file ? 'Image uploaded successfully to Immich' : 'Media downloaded and uploaded successfully to Immich',
      source: req.file ? 'file_upload' : 'url_download',
      immichResponse: response.data
    });

    // Clean up temporary file if it was created
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temporary file:', cleanupError.message);
      }
    }

  } catch (error) {
    console.error('Upload/Download error:', error.message);
    
    // Clean up temporary file on error
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temporary file on error:', cleanupError.message);
      }
    }
    
    // Handle download-specific errors
    if (error.message.includes('Failed to download from URL')) {
      let errorResponse = {
        error: 'Download failed',
        message: 'Could not download media from the provided URL. Please check if the URL is valid and accessible.',
        details: error.message
      };
      
      // Check for format-related errors
      if (error.message.includes('Requested format is not available') || 
          error.message.includes('Use --list-formats')) {
        errorResponse.error = 'Format not available';
        errorResponse.message = 'The requested video quality is not available for this media. This might be an image post or the video format is incompatible.';
        errorResponse.suggestion = 'Try a different URL or check if this is an image post rather than a video.';
        return res.status(400).json(errorResponse);
      }
      
      // Check for authentication-related errors
      if (error.message.includes('Sign in to confirm') || 
          error.message.includes('bot') || 
          error.message.includes('authentication') ||
          error.message.includes('cookies')) {
        
        // Try to detect the domain for specific guidance
        const urlMatch = error.message.match(/Processing URL download: (https?:\/\/[^\s]+)/);
        let domain = 'the platform';
        if (urlMatch) {
          try {
            domain = new URL(urlMatch[1]).hostname.replace('www.', '');
          } catch (e) {}
        }
        
        errorResponse.error = 'Authentication required';
        errorResponse.message = `The platform detected bot-like behavior and requires authentication. Please add cookie files to enable authenticated downloads.`;
        errorResponse.suggestion = `Add a ${domain === 'youtube.com' ? 'youtube-cookie.txt' : domain === 'instagram.com' ? 'instagram-cookie.txt' : 'cookie'} file to the cookies/ directory. See the cookies/README.md for instructions.`;
      }
      
      return res.status(400).json(errorResponse);
    }
    
    if (error.response) {
      console.error('Immich server error details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });
      
      return res.status(error.response.status).json({
        error: 'Immich server error',
        status: error.response.status,
        statusText: error.response.statusText,
        details: error.response.data
      });
    }
    
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Cannot connect to Immich server'
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Immich helper server running on port ${port}`);
  console.log(`Immich server: ${process.env.IMMICH_SERVER_URL || 'Not configured'}`);
});