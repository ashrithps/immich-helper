const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const YTDlpWrap = require('yt-dlp-wrap').default;
const temp = require('temp');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

temp.track();

async function downloadFromUrl(url) {
  try {
    console.log(`Downloading from URL: ${url}`);
    
    // Create temporary directory
    const tempDir = temp.mkdirSync('immich-download');
    
    // Create YTDlpWrap instance (uses system yt-dlp)
    const ytDlpWrap = new YTDlpWrap();
    
    // Configure output filename template
    const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');
    
    // Download options
    const options = [
      '--format', 'best[height<=1080]', // Limit to 1080p
      '--no-playlist',
      '--output', outputTemplate
    ];
    
    // Execute yt-dlp download
    const subprocess = ytDlpWrap.exec([url, ...options]);
    
    // Wait for download to complete
    await new Promise((resolve, reject) => {
      subprocess.on('error', reject);
      subprocess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`yt-dlp exited with code ${code}`));
        }
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
  try {
    const apiKey = req.body.apiKey || req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    let fileBuffer, filename, contentType;
    let tempFilePath = null;

    // Check if this is a file upload or URL download
    if (req.file) {
      // Direct file upload (existing flow)
      fileBuffer = req.file.buffer;
      filename = req.file.originalname || 'image.jpg';
      contentType = req.file.mimetype;
    } else if (req.body.url && req.body.url.trim() !== '') {
      // URL download using yt-dlp (only if URL is not blank)
      const downloadedFile = await downloadFromUrl(req.body.url.trim());
      tempFilePath = downloadedFile.path;
      fileBuffer = fs.readFileSync(downloadedFile.path);
      filename = downloadedFile.filename;
      contentType = getContentType(downloadedFile.filename);
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
      return res.status(400).json({
        error: 'Download failed',
        message: 'Could not download media from the provided URL. Please check if the URL is valid and accessible.',
        details: error.message
      });
    }
    
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'Immich server error',
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