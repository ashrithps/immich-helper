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
      'www.instagram.com': 'instagram-cookie.txt',
      'reddit.com': 'reddit-cookie.txt',
      'www.reddit.com': 'reddit-cookie.txt',
      'old.reddit.com': 'reddit-cookie.txt'
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

async function downloadWithGalleryDl(url, tempDir, cookieFile = null) {
  try {
    console.log(`Trying gallery-dl for URL: ${url}`);
    
    // gallery-dl command arguments
    const args = [
      url,
      '--destination', tempDir,
      '--directory', '',  // Empty directory template to avoid subdirectories
      '--filename', '{num:>02}_{filename}.{extension}' // Add numbering for multiple files
    ];
    
    // Add cookie file if available
    if (cookieFile) {
      args.push('--cookies', cookieFile);
    }
    
    // Execute gallery-dl using spawn
    await new Promise((resolve, reject) => {
      const gallerydl = spawn('gallery-dl', args);
      
      let stderr = '';
      
      gallerydl.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      gallerydl.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`gallery-dl exited with code ${code}: ${stderr}`));
        }
      });
      
      gallerydl.on('error', (error) => {
        reject(new Error(`Failed to start gallery-dl: ${error.message}`));
      });
    });
    
    return true;
  } catch (error) {
    console.error('Gallery-dl error:', error.message);
    throw error;
  }
}

async function resolveRedirectUrl(url) {
  try {
    console.log(`resolveRedirectUrl: Starting with URL: ${url}`);
    
    // Check if this is already a Reddit media redirect URL
    if (url.includes('reddit.com/media?url=')) {
      console.log(`Detected Reddit media redirect URL: ${url}`);
      try {
        const urlParams = new URL(url);
        const directImageUrl = urlParams.searchParams.get('url');
        if (directImageUrl) {
          console.log(`Extracted direct image URL from Reddit media redirect: ${directImageUrl}`);
          return directImageUrl;
        } else {
          console.log(`No 'url' parameter found in Reddit media redirect: ${url}`);
        }
      } catch (parseError) {
        console.warn(`Failed to parse Reddit media redirect URL: ${parseError.message}`);
      }
    }
    
    // For Reddit mobile share URLs, resolve to the actual post URL
    if (url.includes('reddit.com/r/') && url.includes('/s/')) {
      console.log(`Resolving Reddit mobile share URL: ${url}`);
      try {
        const response = await axios.get(url, {
          maxRedirects: 5,
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; immich-helper/1.0)'
          }
        });
        
        // Extract the actual post URL from the response
        const finalUrl = response.request.res.responseUrl || response.config.url;
        console.log(`Resolved to: ${finalUrl}`);
        
        // Check if the resolved URL is a Reddit media redirect
        if (finalUrl && finalUrl.includes('reddit.com/media?url=')) {
          console.log(`Detected Reddit media redirect in resolved URL: ${finalUrl}`);
          try {
            const urlParams = new URL(finalUrl);
            const directImageUrl = urlParams.searchParams.get('url');
            if (directImageUrl) {
              console.log(`Extracted direct image URL from Reddit media redirect: ${directImageUrl}`);
              return directImageUrl;
            } else {
              console.log(`No 'url' parameter found in resolved Reddit media redirect: ${finalUrl}`);
            }
          } catch (parseError) {
            console.warn(`Failed to parse resolved Reddit media redirect URL: ${parseError.message}`);
          }
        }
        
        // If we got a standard Reddit post URL, try to detect if it redirects to media
        if (finalUrl && finalUrl.includes('reddit.com/r/') && finalUrl.includes('/comments/')) {
          console.log(`Testing Reddit post URL for media redirects: ${finalUrl}`);
          try {
            // Make a request to see if Reddit redirects to a media URL
            const mediaResponse = await axios.get(finalUrl, {
              maxRedirects: 5,
              timeout: 10000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; immich-helper/1.0)'
              }
            });
            
            const mediaFinalUrl = mediaResponse.request.res.responseUrl || mediaResponse.config.url;
            console.log(`Reddit post URL resolved to: ${mediaFinalUrl}`);
            
            if (mediaFinalUrl && mediaFinalUrl.includes('reddit.com/media?url=')) {
              console.log(`Detected Reddit media redirect from post URL: ${mediaFinalUrl}`);
              try {
                const urlParams = new URL(mediaFinalUrl);
                const directImageUrl = urlParams.searchParams.get('url');
                if (directImageUrl) {
                  console.log(`Extracted direct image URL from post redirect: ${directImageUrl}`);
                  return directImageUrl;
                }
              } catch (parseError) {
                console.warn(`Failed to parse media redirect from post URL: ${parseError.message}`);
              }
            }
          } catch (mediaError) {
            console.warn(`Failed to test Reddit post URL for media redirects: ${mediaError.message}`);
          }
        }
        
        return finalUrl || url;
      } catch (axiosError) {
        console.warn(`Failed to resolve Reddit share URL ${url}: ${axiosError.message}`);
        return url;
      }
    }
    
    console.log(`resolveRedirectUrl: No resolution needed for URL: ${url}`);
    return url;
  } catch (error) {
    console.warn(`Failed to resolve redirect for ${url}:`, error.message);
    return url; // Return original URL if resolution fails
  }
}

async function downloadFromUrl(url) {
  try {
    console.log(`Downloading from URL: ${url}`);
    
    // Resolve redirects for mobile share URLs
    console.log(`Calling resolveRedirectUrl for: ${url}`);
    const resolvedUrl = await resolveRedirectUrl(url);
    console.log(`resolveRedirectUrl returned: ${resolvedUrl}`);
    if (resolvedUrl !== url) {
      console.log(`Using resolved URL: ${resolvedUrl}`);
      url = resolvedUrl;
    } else {
      console.log(`No URL resolution needed for: ${url}`);
    }
    
    // Note: Instagram Stories are supported but may be unreliable
    if (url.includes('instagram.com/s/')) {
      console.log('Warning: Instagram Stories download may be unreliable and might download multiple stories from the user.');
    }
    
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
    
    // Try yt-dlp first, fallback to gallery-dl for images
    let downloadSuccess = false;
    let lastError = null;
    
    try {
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
      
      downloadSuccess = true;
    } catch (error) {
      lastError = error;
      console.log('yt-dlp failed, trying gallery-dl as fallback...');
      
      // Check if it's a "No video formats found" error - likely an image post
      if (error.message.includes('No video formats found') || 
          error.message.includes('Requested format is not available')) {
        
        try {
          await downloadWithGalleryDl(url, tempDir, cookieFile);
          downloadSuccess = true;
          console.log('Successfully downloaded with gallery-dl');
        } catch (galleryError) {
          console.error('Gallery-dl also failed:', galleryError.message);
          // Throw the original yt-dlp error since that's the primary downloader
          throw lastError;
        }
      } else {
        // Not a format issue, throw the original error
        throw lastError;
      }
    }
    
    // Find all downloaded files
    const files = fs.readdirSync(tempDir);
    if (files.length === 0) {
      throw new Error('No files were downloaded');
    }
    
    // Sort files to maintain order for multi-image posts
    files.sort();
    
    // Return all files for multi-image support
    return {
      tempDir: tempDir,
      files: files.map(filename => ({
        path: path.join(tempDir, filename),
        filename: filename
      }))
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
          const downloadResult = await downloadFromUrl(cleanUrl);
          
          // Handle multiple files from text file URL (same logic as body URL)
          if (downloadResult.files && downloadResult.files.length > 1) {
            console.log(`Downloaded ${downloadResult.files.length} files from carousel post via text file`);
            
            const immichUrl = process.env.IMMICH_SERVER_URL;
            if (!immichUrl) {
              return res.status(500).json({ error: 'Immich server URL not configured' });
            }
            
            const uploadResults = [];
            const errors = [];
            
            // Upload each file individually
            for (let i = 0; i < downloadResult.files.length; i++) {
              const file = downloadResult.files[i];
              try {
                console.log(`Uploading file ${i + 1}/${downloadResult.files.length}: ${file.filename}`);
                
                const fileBuffer = fs.readFileSync(file.path);
                const contentType = getContentType(file.filename);
                
                const formData = new FormData();
                formData.append('assetData', fileBuffer, {
                  filename: file.filename,
                  contentType: contentType
                });

                const deviceAssetId = `ios-shortcut-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`;
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
                
                uploadResults.push({
                  filename: file.filename,
                  success: true,
                  immichResponse: response.data
                });
                
              } catch (uploadError) {
                console.error(`Failed to upload ${file.filename}:`, uploadError.message);
                errors.push({
                  filename: file.filename,
                  error: uploadError.message
                });
              }
            }
            
            // Clean up temp directory
            try {
              downloadResult.files.forEach(file => fs.unlinkSync(file.path));
              fs.rmdirSync(downloadResult.tempDir);
            } catch (cleanupError) {
              console.warn('Failed to cleanup temporary files:', cleanupError.message);
            }
            
            // Return results
            return res.json({
              success: uploadResults.length > 0,
              message: `Uploaded ${uploadResults.length}/${downloadResult.files.length} images from carousel post`,
              source: 'file_url_download_carousel',
              totalFiles: downloadResult.files.length,
              successfulUploads: uploadResults.length,
              results: uploadResults,
              errors: errors.length > 0 ? errors : undefined
            });
          } else {
            // Single file download
            const singleFile = downloadResult.files[0];
            tempFilePath = singleFile.path;
            fileBuffer = fs.readFileSync(singleFile.path);
            filename = singleFile.filename;
            contentType = getContentType(singleFile.filename);
            console.log('Downloaded file:', filename, contentType, `${fileBuffer.length} bytes`);
          }
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
      const urlToDownload = req.body.url.trim();
      console.log('Processing URL download:', urlToDownload);
      const downloadResult = await downloadFromUrl(urlToDownload);
      
      // Handle multiple files from gallery downloads
      if (downloadResult.files && downloadResult.files.length > 1) {
        console.log(`Downloaded ${downloadResult.files.length} files from carousel post`);
        
        const immichUrl = process.env.IMMICH_SERVER_URL;
        if (!immichUrl) {
          return res.status(500).json({ error: 'Immich server URL not configured' });
        }
        
        const uploadResults = [];
        const errors = [];
        
        // Upload each file individually
        for (let i = 0; i < downloadResult.files.length; i++) {
          const file = downloadResult.files[i];
          try {
            console.log(`Uploading file ${i + 1}/${downloadResult.files.length}: ${file.filename}`);
            
            const fileBuffer = fs.readFileSync(file.path);
            const contentType = getContentType(file.filename);
            
            const formData = new FormData();
            formData.append('assetData', fileBuffer, {
              filename: file.filename,
              contentType: contentType
            });

            const deviceAssetId = `ios-shortcut-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`;
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
            
            uploadResults.push({
              filename: file.filename,
              success: true,
              immichResponse: response.data
            });
            
          } catch (uploadError) {
            console.error(`Failed to upload ${file.filename}:`, uploadError.message);
            errors.push({
              filename: file.filename,
              error: uploadError.message
            });
          }
        }
        
        // Clean up temp directory
        try {
          downloadResult.files.forEach(file => fs.unlinkSync(file.path));
          fs.rmdirSync(downloadResult.tempDir);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temporary files:', cleanupError.message);
        }
        
        // Return results
        return res.json({
          success: uploadResults.length > 0,
          message: `Uploaded ${uploadResults.length}/${downloadResult.files.length} images from carousel post`,
          source: 'url_download_carousel',
          totalFiles: downloadResult.files.length,
          successfulUploads: uploadResults.length,
          results: uploadResults,
          errors: errors.length > 0 ? errors : undefined
        });
      } else {
        // Single file download (original logic)
        const singleFile = downloadResult.files[0];
        tempFilePath = singleFile.path;
        fileBuffer = fs.readFileSync(singleFile.path);
        filename = singleFile.filename;
        contentType = getContentType(singleFile.filename);
        console.log('Downloaded file:', filename, contentType, `${fileBuffer.length} bytes`);
      }
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
      
      // Check for Instagram Stories specifically (check both body URL and error message content)
      if (error.message.includes('Unsupported URL') && 
          (error.message.includes('instagram.com/s/') || 
           (req.body.url && req.body.url.includes('instagram.com/s/')))) {
        errorResponse.error = 'Instagram Stories URL format not supported';
        errorResponse.message = 'This Instagram Stories URL format is not recognized by yt-dlp';
        errorResponse.details = 'yt-dlp expects Stories URLs in format: instagram.com/stories/username/ or instagram.com/stories/highlights/ID/';
        errorResponse.suggestion = 'Try copying the direct story URL from Instagram web (not the mobile share URL) or use regular posts (/p/) or reels (/reel/) instead.';
        return res.status(400).json(errorResponse);
      }
      
      // Check for Reddit URLs that still failed after resolution
      if (error.message.includes('Unsupported URL') && 
          (error.message.includes('reddit.com/media?url=') || 
           error.message.includes('reddit.com') ||
           (req.body.url && req.body.url.includes('reddit.com')))) {
        errorResponse.error = 'Reddit URL not supported';
        errorResponse.message = 'This Reddit URL format is not supported by the download tools';
        errorResponse.details = 'Reddit URLs may redirect to formats not supported by yt-dlp or gallery-dl';
        errorResponse.suggestion = 'Try using the direct Reddit post URL: reddit.com/r/subreddit/comments/postid/title/ - open the post on desktop Reddit and copy the URL from the address bar.';
        return res.status(400).json(errorResponse);
      }
      
      // Check for other unsupported URL errors
      if (error.message.includes('Unsupported URL')) {
        errorResponse.error = 'Unsupported URL format';
        errorResponse.message = 'This URL format is not supported by the download tools.';
        errorResponse.suggestion = 'Please check that you\'re using a direct link to a post, reel, or video from a supported platform.';
        return res.status(400).json(errorResponse);
      }
      
      // Check for format-related errors (these should be handled by gallery-dl fallback now)
      if (error.message.includes('Requested format is not available') || 
          error.message.includes('Use --list-formats') ||
          error.message.includes('No video formats found')) {
        errorResponse.error = 'Media not accessible';
        errorResponse.message = 'Could not download this media. Both video (yt-dlp) and image (gallery-dl) downloaders failed.';
        errorResponse.suggestion = 'This may be a private post, unsupported platform, or require authentication. Try adding cookie files if not already present.';
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
        errorResponse.suggestion = `Add a ${domain === 'youtube.com' ? 'youtube-cookie.txt' : domain === 'instagram.com' ? 'instagram-cookie.txt' : domain === 'reddit.com' ? 'reddit-cookie.txt' : 'cookie'} file to the cookies/ directory. See the cookies/README.md for instructions.`;
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