const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

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
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const apiKey = req.body.apiKey || req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const immichUrl = process.env.IMMICH_SERVER_URL;
    if (!immichUrl) {
      return res.status(500).json({ error: 'Immich server URL not configured' });
    }

    const formData = new FormData();
    formData.append('assetData', req.file.buffer, {
      filename: req.file.originalname || 'image.jpg',
      contentType: req.file.mimetype
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
      message: 'Image uploaded successfully to Immich',
      immichResponse: response.data
    });

  } catch (error) {
    console.error('Upload error:', error.message);
    
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